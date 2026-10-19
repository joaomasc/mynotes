import {
  MIND_MAP_MAX_BYTES,
  VIEW_KEY_PATTERN,
  searchTerms,
  zViewLayoutData,
  type BrokenReference,
  type GraphEntityType,
  type NoteRole,
  type Reference,
  type TopicContext,
  type ViewLayout,
  type ViewLayoutData,
} from '@mynotes/shared';
import { ApiError, badRequest, notFound, tooLarge } from '../../lib/errors';
import { all, first, num, numOrNull, parseJson, str, strOrNull, stmt, type Bindable, type Row } from '../../lib/db';
import { NOTE_SUMMARY_COLS, reindexNotes, toBacklink, toNoteSummary } from '../notes/service';
import { toReading } from '../readings/service';
import { nowIso } from '../../lib/time';

/* ------------------------------------------------------------- suggest */

/** `annotation` selects page annotations; `note` selects notes and reviews. */
export const SUGGEST_TYPES = ['topic', 'note', 'reading', 'annotation', 'document', 'concept'] as const;
type SuggestType = (typeof SUGGEST_TYPES)[number];

const TYPE_ORDER: Record<SuggestType, number> = { topic: 0, reading: 1, note: 2, annotation: 3, document: 4, concept: 5 };

function reference(type: GraphEntityType, r: Row, extra: Partial<Reference> = {}): Reference {
  return {
    type,
    id: str(r.id),
    title: str(r.title),
    exists: true,
    topicId: strOrNull(r.topic_id),
    role: null,
    readingId: null,
    readingTitle: null,
    page: null,
    materialType: null,
    ...extra,
  };
}

/**
 * Items matching what the user typed after `/` in the editor (all words,
 * accent-insensitive; title matches first). With an empty query, the most
 * recently updated items.
 */
export async function suggest(
  db: D1Database,
  userId: string,
  q: { q: string; types?: string | undefined; limit: number },
): Promise<Reference[]> {
  const requested = (q.types ?? '').split(',').filter((t): t is SuggestType => (SUGGEST_TYPES as readonly string[]).includes(t));
  const types = requested.length > 0 ? requested : [...SUGGEST_TYPES];
  const terms = searchTerms(q.q);
  const first0 = terms[0] ?? '';
  // `search` is the normalized text column, aligned with the title at its start.
  const match = (search: string) => terms.map(() => `instr(${search}, ?) > 0`).join(' AND ') || '1';
  // Exact title, then title prefix, then title containing the text, then other matches.
  const rank = (search: string, titleCol: string) =>
    terms.length
      ? `CASE WHEN substr(${search}, 1, length(${titleCol})) = ? THEN 0
              WHEN instr(substr(${search}, 1, length(${titleCol})), ?) = 1 THEN 1
              WHEN instr(substr(${search}, 1, length(${titleCol})), ?) > 0 THEN 2 ELSE 3 END`
      : '0';
  const rankBinds: Bindable[] = terms.length ? [terms.join(' '), first0, first0] : [];

  const statements = types.map((type) => {
    switch (type) {
      case 'topic':
        return stmt(
          db,
          `SELECT id, title, parent_id AS topic_id, updated_at, ${rank('search_text', 'title')} AS rank FROM topics
            WHERE user_id = ? AND deleted_at IS NULL AND ${match('search_text')} ORDER BY rank, length(title), updated_at DESC LIMIT ?`,
          ...rankBinds,
          userId,
          ...terms,
          q.limit,
        );
      case 'note':
        return stmt(
          db,
          `SELECT n.id, n.title, n.topic_id, n.role, n.reading_id, r.title AS reading_title, n.updated_at,
                  ${rank('n.search_text', 'n.title')} AS rank
             FROM notes n LEFT JOIN readings r ON r.id = n.reading_id AND r.user_id = n.user_id
            WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.role <> 'annotation' AND ${match('n.search_text')}
            ORDER BY rank, length(n.title), n.updated_at DESC LIMIT ?`,
          ...rankBinds,
          userId,
          ...terms,
          q.limit,
        );
      case 'annotation':
        // Found by their own text or by the book's title ("O Capital").
        return stmt(
          db,
          `SELECT n.id, n.title, n.topic_id, n.role, n.reading_id, n.page, r.title AS reading_title, n.updated_at, 1 AS rank
             FROM notes n LEFT JOIN readings r ON r.id = n.reading_id AND r.user_id = n.user_id
            WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.role = 'annotation'
              AND ${match(`(n.search_text || ' ' || COALESCE(r.search_text, ''))`)}
            ORDER BY r.title, n.page LIMIT ?`,
          userId,
          ...terms,
          q.limit,
        );
      case 'reading':
        return stmt(
          db,
          `SELECT id, title, topic_id, material_type, author, updated_at, ${rank('search_text', 'title')} AS rank FROM readings
            WHERE user_id = ? AND ${match('search_text')} ORDER BY rank, length(title), updated_at DESC LIMIT ?`,
          ...rankBinds,
          userId,
          ...terms,
          q.limit,
        );
      case 'document':
        return stmt(
          db,
          `SELECT id, title, topic_id, updated_at, ${rank('search_text', 'title')} AS rank FROM documents
            WHERE user_id = ? AND deleted_at IS NULL AND ${match('search_text')} ORDER BY rank, length(title), updated_at DESC LIMIT ?`,
          ...rankBinds,
          userId,
          ...terms,
          q.limit,
        );
      case 'concept':
        return stmt(
          db,
          `SELECT id, name AS title, topic_id, updated_at, ${rank('search_text', 'name')} AS rank FROM concepts
            WHERE user_id = ? AND ${match('search_text')} ORDER BY rank, length(title), updated_at DESC LIMIT ?`,
          ...rankBinds,
          userId,
          ...terms,
          q.limit,
        );
    }
  });
  const results = await db.batch<Row>(statements);
  const items = types.flatMap((type, i) =>
    (results[i]?.results ?? []).map((r) => {
      const ref =
        type === 'note' || type === 'annotation'
          ? reference('note', r, {
              role: (strOrNull(r.role) ?? 'note') as NoteRole,
              readingId: strOrNull(r.reading_id),
              readingTitle: strOrNull(r.reading_title),
              page: numOrNull(r.page),
            })
          : reference(type, r, type === 'reading' ? { materialType: strOrNull(r.material_type) } : {});
      return { ref, rank: num(r.rank), order: TYPE_ORDER[type], updatedAt: str(r.updated_at) };
    }),
  );
  items.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.order - b.order ||
      a.ref.title.length - b.ref.title.length ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return items.slice(0, q.limit).map((i) => i.ref);
}

/* ------------------------------------------------------------- resolve */

const RESOLVABLE: GraphEntityType[] = ['topic', 'note', 'reading', 'document', 'concept'];

/**
 * Current state of referenced items: title (references show the current
 * title, so renaming never breaks them) or `exists: false` for deleted/
 * trashed targets (broken references the user can repair).
 */
export async function resolve(db: D1Database, userId: string, refsParam: string): Promise<Reference[]> {
  const refs = [
    ...new Map(
      refsParam
        .split(',')
        .map((pair) => pair.split(':'))
        .filter((p): p is [GraphEntityType, string] => p.length === 2 && RESOLVABLE.includes(p[0] as GraphEntityType) && /^[0-9a-f-]{36}$/.test(p[1]!))
        .map(([type, id]) => [`${type}:${id}`, { type, id }] as const),
    ).values(),
  ];
  if (refs.length > 100) throw badRequest('No máximo 100 referências por consulta');
  const byType = new Map<GraphEntityType, string[]>();
  for (const r of refs) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);

  const sql: Record<GraphEntityType, (ph: string) => string> = {
    topic: (ph) => `SELECT id, title, parent_id AS topic_id FROM topics WHERE user_id = ? AND deleted_at IS NULL AND id IN (${ph})`,
    note: (ph) => `SELECT n.id, n.title, n.topic_id, n.role, n.reading_id, n.page, r.title AS reading_title
                     FROM notes n LEFT JOIN readings r ON r.id = n.reading_id AND r.user_id = n.user_id
                    WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.id IN (${ph})`,
    reading: (ph) => `SELECT id, title, topic_id, material_type FROM readings WHERE user_id = ? AND id IN (${ph})`,
    document: (ph) => `SELECT id, title, topic_id FROM documents WHERE user_id = ? AND deleted_at IS NULL AND id IN (${ph})`,
    concept: (ph) => `SELECT id, name AS title, topic_id FROM concepts WHERE user_id = ? AND id IN (${ph})`,
  };
  // D1 binds at most 100 parameters per statement.
  const jobs = [...byType].flatMap(([type, ids]) =>
    Array.from({ length: Math.ceil(ids.length / 90) }, (_, i) => ids.slice(i * 90, i * 90 + 90)).map((chunk) => ({
      type,
      statement: stmt(db, sql[type](chunk.map(() => '?').join(',')), userId, ...chunk),
    })),
  );
  const found = new Map<string, Reference>();
  if (jobs.length > 0) {
    const results = await db.batch<Row>(jobs.map((j) => j.statement));
    results.forEach((res, i) => {
      const type = jobs[i]!.type;
      for (const r of res.results ?? []) {
        found.set(
          `${type}:${str(r.id)}`,
          reference(type, r, {
            role: type === 'note' ? ((strOrNull(r.role) ?? 'note') as NoteRole) : null,
            readingId: strOrNull(r.reading_id),
            readingTitle: strOrNull(r.reading_title),
            page: numOrNull(r.page),
            materialType: strOrNull(r.material_type),
          }),
        );
      }
    });
  }
  return refs.map(
    (r) =>
      found.get(`${r.type}:${r.id}`) ?? {
        type: r.type,
        id: r.id,
        title: '',
        exists: false,
        topicId: null,
        role: null,
        readingId: null,
        readingTitle: null,
        page: null,
        materialType: null,
      },
  );
}

/** Live notes whose written references point to items that no longer exist (or are in the trash). */
export async function brokenReferences(db: D1Database, userId: string): Promise<BrokenReference[]> {
  const missing = (table: string, trashable: boolean) =>
    `NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = l.target_id AND t.user_id = n.user_id${trashable ? ' AND t.deleted_at IS NULL' : ''})`;
  const rows = await all(
    db,
    `SELECT l.note_id, n.title, n.topic_id, n.role, n.reading_id, n.page, l.target_type, l.target_id
       FROM note_links l JOIN notes n ON n.id = l.note_id
      WHERE n.user_id = ? AND n.deleted_at IS NULL AND (
            (l.target_type = 'note' AND ${missing('notes', true)})
         OR (l.target_type = 'topic' AND ${missing('topics', true)})
         OR (l.target_type = 'document' AND ${missing('documents', true)})
         OR (l.target_type = 'reading' AND ${missing('readings', false)})
         OR (l.target_type = 'concept' AND ${missing('concepts', false)}))
      ORDER BY n.updated_at DESC LIMIT 500`,
    userId,
  );
  return rows.map((r) => ({
    noteId: str(r.note_id),
    noteTitle: str(r.title),
    topicId: strOrNull(r.topic_id),
    role: (strOrNull(r.role) ?? 'note') as NoteRole,
    readingId: strOrNull(r.reading_id),
    page: numOrNull(r.page),
    targetType: str(r.target_type) as GraphEntityType,
    targetId: str(r.target_id),
  }));
}

/* ------------------------------------------------------- topic context */

/**
 * Everything connected to a topic besides its notes and subtopics, computed
 * from real data: books in the topic or related to it, reviews/annotations
 * that reference it, notes that mention it, tags and study time.
 */
export async function topicContext(db: D1Database, userId: string, topicId: string): Promise<TopicContext> {
  const topic = await first(db, 'SELECT id FROM topics WHERE id = ? AND user_id = ? AND deleted_at IS NULL', topicId, userId);
  if (!topic) throw notFound('Assunto');
  await reindexNotes(db, userId);
  const annotationCount = `(SELECT COUNT(*) FROM notes a WHERE a.reading_id = r.id AND a.user_id = r.user_id AND a.role = 'annotation' AND a.deleted_at IS NULL)`;
  const [inTopic, related, annotations, mentions, tags, study] = await db.batch<Row>([
    stmt(db, `SELECT r.*, ${annotationCount} AS annotation_count FROM readings r WHERE r.user_id = ? AND r.topic_id = ? ORDER BY r.updated_at DESC LIMIT 100`, userId, topicId),
    stmt(
      db,
      `SELECT r.*, ${annotationCount} AS annotation_count FROM readings r
        WHERE r.user_id = ? AND r.topic_id IS NOT ? AND r.id IN (
          SELECT source_id FROM relations WHERE user_id = ? AND source_type = 'reading' AND target_type = 'topic' AND target_id = ?
          UNION SELECT target_id FROM relations WHERE user_id = ? AND source_type = 'topic' AND source_id = ? AND target_type = 'reading')
        ORDER BY r.updated_at DESC LIMIT 100`,
      userId,
      topicId,
      userId,
      topicId,
      userId,
      topicId,
    ),
    stmt(
      db,
      `SELECT ${NOTE_SUMMARY_COLS.split(', ').map((c) => `n.${c}`).join(', ')}, r.title AS reading_title
         FROM notes n LEFT JOIN readings r ON r.id = n.reading_id AND r.user_id = n.user_id
        WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.role <> 'note'
          AND n.id IN (SELECT note_id FROM note_links WHERE target_type = 'topic' AND target_id = ?)
        ORDER BY r.title, n.page LIMIT 200`,
      userId,
      topicId,
    ),
    stmt(
      db,
      `SELECT n.id, n.title, n.topic_id, n.role, n.reading_id, n.page, n.excerpt, n.updated_at, NULL AS reading_title
         FROM note_links l JOIN notes n ON n.id = l.note_id
        WHERE l.target_type = 'topic' AND l.target_id = ? AND n.user_id = ? AND n.deleted_at IS NULL AND n.role = 'note'
        ORDER BY n.updated_at DESC LIMIT 100`,
      topicId,
      userId,
    ),
    stmt(
      db,
      `SELECT t.tag, COUNT(*) AS n FROM note_tags t JOIN notes n ON n.id = t.note_id
        WHERE n.user_id = ? AND n.topic_id = ? AND n.deleted_at IS NULL GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 30`,
      userId,
      topicId,
    ),
    stmt(
      db,
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total, COUNT(*) AS n, MAX(started_at) AS last_at
         FROM study_sessions WHERE user_id = ? AND topic_id = ?`,
      userId,
      topicId,
    ),
  ]);
  const s = study?.results?.[0] ?? {};
  return {
    readings: [
      ...(inTopic?.results ?? []).map((r) => ({ ...toReading(r), annotationCount: num(r.annotation_count), via: 'topic' as const })),
      ...(related?.results ?? []).map((r) => ({ ...toReading(r), annotationCount: num(r.annotation_count), via: 'relation' as const })),
    ],
    annotations: (annotations?.results ?? []).map((r) => ({ ...toNoteSummary(r), readingTitle: strOrNull(r.reading_title) })),
    mentions: (mentions?.results ?? []).map(toBacklink),
    tags: (tags?.results ?? []).map((r) => ({ tag: str(r.tag), count: num(r.n) })),
    study: { totalSeconds: num(s.total), sessionCount: num(s.n), lastAt: strOrNull(s.last_at) },
  };
}

/* -------------------------------------------------------- view layouts */

function assertViewKey(key: string): void {
  if (!VIEW_KEY_PATTERN.test(key)) throw badRequest('Visualização inválida');
}

const toLayout = (r: Row): ViewLayout => ({
  key: str(r.view_key),
  data: zViewLayoutData.parse(parseJson(r.data, {})),
  version: num(r.version),
  updatedAt: str(r.updated_at),
});

export async function getLayout(db: D1Database, userId: string, key: string): Promise<ViewLayout | null> {
  assertViewKey(key);
  const row = await first(db, 'SELECT * FROM view_layouts WHERE user_id = ? AND view_key = ?', userId, key);
  return row ? toLayout(row) : null;
}

/** Saves positions/collapsed branches of a generated view (optimistic concurrency, like settings). */
export async function putLayout(
  db: D1Database,
  userId: string,
  key: string,
  data: ViewLayoutData,
  baseVersion: number | undefined,
): Promise<ViewLayout> {
  assertViewKey(key);
  const json = JSON.stringify(data);
  if (json.length > MIND_MAP_MAX_BYTES) throw tooLarge('Layout grande demais');
  const now = nowIso();
  if (baseVersion === undefined) {
    const row = await first(
      db,
      `INSERT INTO view_layouts (user_id, view_key, data, version, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (user_id, view_key) DO NOTHING RETURNING *`,
      userId,
      key,
      json,
      now,
    );
    if (row) return toLayout(row);
  } else {
    const row = await first(
      db,
      `UPDATE view_layouts SET data = ?, version = version + 1, updated_at = ?
        WHERE user_id = ? AND view_key = ? AND version = ? RETURNING *`,
      json,
      now,
      userId,
      key,
      baseVersion,
    );
    if (row) return toLayout(row);
  }
  const current = await getLayout(db, userId, key);
  throw new ApiError('version_conflict', 'A disposição foi alterada em outro dispositivo', { current });
}
