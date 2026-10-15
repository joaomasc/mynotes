import {
  GRAPH_ENTITY_TYPES,
  SEARCH_ENTITY_TYPES,
  SETTINGS_SCHEMAS,
  searchTerms,
  uuidv7,
  type ActivityEvent,
  type Dashboard,
  type EntityType,
  type Favorite,
  type FavoriteEntityType,
  type Graph,
  type GraphEdge,
  type GraphEntityType,
  type GraphNode,
  type NoteRole,
  type SearchEntityType,
  type SearchResult,
  type Setting,
  type SettingKey,
} from '@mynotes/shared';
import { ApiError, badRequest, notFound } from '../../lib/errors';
import { all, first, num, parseJson, str, strOrNull, stmt, type Bindable, type Row } from '../../lib/db';
import { assertEntity, entityKey, resolveEntities } from '../../lib/entities';
import { SUBTREE_SQL, activityStmt } from '../../lib/helpers';
import { encodeCursor, decodeCursor } from '../../lib/pagination';
import { isoBefore, nowIso } from '../../lib/time';
import { NOTE_SUMMARY_COLS, toNoteSummary } from '../notes/service';
import { upcomingGoals } from '../plans/service';
import { toReading } from '../readings/service';
import { hydrateSessions } from '../study/service';
import { listTopics } from '../topics/service';

/* ------------------------------------------------------------------ graph */

const GRAPH_LIMIT_PER_TYPE = 600;

const GRAPH_SOURCES: Record<GraphEntityType, { table: string; title: string; topic: string; trashable: boolean }> = {
  topic: { table: 'topics', title: 'title', topic: 'parent_id', trashable: true },
  note: { table: 'notes', title: 'title', topic: 'topic_id', trashable: true },
  document: { table: 'documents', title: 'title', topic: 'topic_id', trashable: true },
  reading: { table: 'readings', title: 'title', topic: 'topic_id', trashable: false },
  concept: { table: 'concepts', title: 'name', topic: 'topic_id', trashable: false },
};

export async function buildGraph(
  db: D1Database,
  userId: string,
  q: { types?: string | undefined; topicId?: string | undefined; structure: string },
): Promise<Graph> {
  const requested = (q.types ?? '').split(',').filter((t): t is GraphEntityType =>
    (GRAPH_ENTITY_TYPES as readonly string[]).includes(t),
  );
  const types = requested.length > 0 ? requested : [...GRAPH_ENTITY_TYPES];
  // Hierarchy is always needed to scope by topic and draw structural edges.
  const statements = types.map((type) => {
    const src = GRAPH_SOURCES[type];
    const extra =
      type === 'note' ? ', role, reading_id, page, (SELECT r.title FROM readings r WHERE r.id = notes.reading_id) AS reading_title' : '';
    let sql = `SELECT id, ${src.title} AS title, ${src.topic} AS topic_id${extra} FROM ${src.table} WHERE user_id = ?`;
    const binds: Bindable[] = [userId];
    if (src.trashable) sql += ' AND deleted_at IS NULL';
    if (q.topicId) {
      const column = type === 'topic' ? 'id' : 'topic_id';
      if (type === 'note') {
        // Reviews and annotations belong to a book: in scope when their book is.
        sql += ` AND (topic_id IN (${SUBTREE_SQL}) OR reading_id IN (SELECT id FROM readings WHERE topic_id IN (${SUBTREE_SQL})))`;
        binds.push(q.topicId, userId, q.topicId, userId);
      } else {
        sql += ` AND ${column} IN (${SUBTREE_SQL})`;
        binds.push(q.topicId, userId);
      }
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    binds.push(GRAPH_LIMIT_PER_TYPE + 1);
    return stmt(db, sql, ...binds);
  });
  statements.push(stmt(db, 'SELECT * FROM relations WHERE user_id = ? LIMIT 5000', userId));
  statements.push(
    stmt(
      db,
      `SELECT l.note_id, l.target_type, l.target_id FROM note_links l JOIN notes n ON n.id = l.note_id
        WHERE n.user_id = ? AND n.deleted_at IS NULL LIMIT 5000`,
      userId,
    ),
  );
  const results = await db.batch<Row>(statements);

  const nodes = new Map<string, GraphNode>();
  const annotates: { note: string; reading: string }[] = [];
  let truncated = false;
  types.forEach((type, i) => {
    const rows = results[i]?.results ?? [];
    if (rows.length > GRAPH_LIMIT_PER_TYPE) truncated = true;
    for (const r of rows.slice(0, GRAPH_LIMIT_PER_TYPE)) {
      const key = entityKey(type, str(r.id));
      const role = type === 'note' ? ((strOrNull(r.role) ?? 'note') as NoteRole) : null;
      // Untitled reviews and annotations are named after their book ("O Capital, p. 12").
      const book = strOrNull(r.reading_title);
      const page = r.page ? `p. ${num(r.page)}` : null;
      const fallback =
        role === 'review'
          ? book ? `Resenha: ${book}` : 'Resenha'
          : role === 'annotation'
            ? [book, page].filter(Boolean).join(', ') || 'Anotação'
            : 'Sem título';
      nodes.set(key, {
        key,
        type,
        entityId: str(r.id),
        label: str(r.title) || fallback,
        topicId: strOrNull(r.topic_id),
        role,
      });
      if (role && role !== 'note' && r.reading_id) annotates.push({ note: key, reading: entityKey('reading', str(r.reading_id)) });
    }
  });

  // A topic's map also shows the books its annotations and reviews belong to,
  // even when the book is filed under another topic (otherwise the link is lost).
  if (q.topicId && types.includes('reading')) {
    const missing = [...new Set(annotates.map((a) => a.reading))].filter((k) => !nodes.has(k)).map((k) => k.slice('reading:'.length));
    for (let i = 0; i < missing.length; i += 90) {
      const ids = missing.slice(i, i + 90);
      const rows = await all(
        db,
        `SELECT id, title, topic_id FROM readings WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
        userId,
        ...ids,
      );
      for (const r of rows) {
        const key = entityKey('reading', str(r.id));
        nodes.set(key, { key, type: 'reading', entityId: str(r.id), label: str(r.title) || 'Sem título', topicId: strOrNull(r.topic_id), role: null });
      }
    }
  }

  const edges = new Map<string, GraphEdge>();
  const addEdge = (e: Omit<GraphEdge, 'key'>) => {
    if (!nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) return;
    const key = `${e.kind}|${e.source}|${e.target}`;
    if (!edges.has(key)) edges.set(key, { ...e, key });
  };

  if (q.structure !== 'false') {
    for (const node of nodes.values()) {
      if (!node.topicId) continue;
      const parent = entityKey('topic', node.topicId);
      addEdge({
        source: parent,
        target: node.key,
        kind: node.type === 'topic' ? 'parent' : 'contains',
        relationId: null,
        label: '',
      });
    }
  }
  for (const r of results[types.length]?.results ?? []) {
    addEdge({
      source: entityKey(str(r.source_type), str(r.source_id)),
      target: entityKey(str(r.target_type), str(r.target_id)),
      kind: str(r.kind) as GraphEdge['kind'],
      relationId: str(r.id),
      label: str(r.label),
    });
  }
  for (const a of annotates) {
    addEdge({ source: a.note, target: a.reading, kind: 'annotates', relationId: null, label: '' });
  }
  for (const l of results[types.length + 1]?.results ?? []) {
    addEdge({
      source: entityKey('note', str(l.note_id)),
      target: entityKey(str(l.target_type), str(l.target_id)),
      kind: 'links_to',
      relationId: null,
      label: '',
    });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
}

/* -------------------------------------------------------------- favorites */

export async function listFavorites(db: D1Database, userId: string): Promise<Favorite[]> {
  const rows = await all(db, 'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId);
  const info = await resolveEntities(
    db,
    userId,
    rows.map((r) => ({ type: str(r.entity_type) as EntityType, id: str(r.entity_id) })),
  );
  return rows.flatMap((r) => {
    const found = info.get(entityKey(str(r.entity_type), str(r.entity_id)));
    if (!found) return [];
    return [
      {
        id: str(r.id),
        entityType: str(r.entity_type) as FavoriteEntityType,
        entityId: str(r.entity_id),
        title: found.title || 'Sem título',
        createdAt: str(r.created_at),
      },
    ];
  });
}

export async function addFavorite(
  db: D1Database,
  userId: string,
  entityType: FavoriteEntityType,
  entityId: string,
): Promise<Favorite> {
  const info = await assertEntity(db, userId, { type: entityType, id: entityId });
  await db
    .prepare(
      `INSERT INTO favorites (id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING`,
    )
    .bind(uuidv7(), userId, entityType, entityId, nowIso())
    .run();
  const row = await first(
    db,
    'SELECT * FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?',
    userId,
    entityType,
    entityId,
  );
  return {
    id: str(row!.id),
    entityType,
    entityId,
    title: info.title,
    createdAt: str(row!.created_at),
  };
}

export async function removeFavorite(db: D1Database, userId: string, entityType: string, entityId: string) {
  await db
    .prepare('DELETE FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?')
    .bind(userId, entityType, entityId)
    .run();
}

/* --------------------------------------------------------------- activity */

function toActivity(r: Row): ActivityEvent {
  return {
    id: str(r.id),
    entityType: str(r.entity_type) as ActivityEvent['entityType'],
    entityId: str(r.entity_id),
    action: str(r.action) as ActivityEvent['action'],
    title: str(r.title),
    occurredAt: str(r.occurred_at),
  };
}

export async function listActivity(db: D1Database, userId: string, cursor: string | undefined, limit: number) {
  const values = decodeCursor(cursor, 2);
  const rows = values
    ? await all(
        db,
        `SELECT * FROM activity_events WHERE user_id = ? AND action <> 'viewed'
           AND (occurred_at < ? OR (occurred_at = ? AND id < ?))
         ORDER BY occurred_at DESC, id DESC LIMIT ?`,
        userId,
        values[0] ?? '',
        values[0] ?? '',
        values[1] ?? '',
        limit + 1,
      )
    : await all(
        db,
        "SELECT * FROM activity_events WHERE user_id = ? AND action <> 'viewed' ORDER BY occurred_at DESC, id DESC LIMIT ?",
        userId,
        limit + 1,
      );
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toActivity),
    nextCursor: rows.length > limit && last ? encodeCursor([str(last.occurred_at), str(last.id)]) : null,
  };
}

export async function recordView(db: D1Database, userId: string, entityType: EntityType, entityId: string) {
  const info = (await resolveEntities(db, userId, [{ type: entityType, id: entityId }])).get(
    entityKey(entityType, entityId),
  );
  if (!info) throw notFound('Item');
  await activityStmt(db, userId, entityType, entityId, 'viewed', info.title, 300).run();
}

/** Most recently opened/edited items that still exist ("continue where you left off"). */
export async function continueItems(db: D1Database, userId: string, limit = 6): Promise<ActivityEvent[]> {
  const rows = await all(
    db,
    `SELECT entity_type, entity_id, MAX(occurred_at) AS occurred_at, MAX(id) AS id FROM activity_events
      WHERE user_id = ? AND action IN ('viewed', 'updated', 'created', 'uploaded')
        AND entity_type IN ('note', 'document', 'reading', 'topic', 'mindmap', 'plan')
        AND occurred_at > ?
      GROUP BY entity_type, entity_id ORDER BY occurred_at DESC LIMIT 30`,
    userId,
    isoBefore(90 * 86400),
  );
  const info = await resolveEntities(
    db,
    userId,
    rows.map((r) => ({ type: str(r.entity_type) as EntityType, id: str(r.entity_id) })),
  );
  return rows
    .flatMap((r) => {
      const found = info.get(entityKey(str(r.entity_type), str(r.entity_id)));
      return found ? [toActivity({ ...r, action: 'viewed', title: found.title || 'Sem título' })] : [];
    })
    .slice(0, limit);
}

/* --------------------------------------------------------------- settings */

export async function listSettings(db: D1Database, userId: string): Promise<Setting[]> {
  const rows = await all(db, 'SELECT * FROM settings WHERE user_id = ?', userId);
  return rows
    .filter((r) => str(r.key) in SETTINGS_SCHEMAS)
    .map((r) => ({
      key: str(r.key) as SettingKey,
      value: parseJson(r.value, null),
      version: num(r.version),
      updatedAt: str(r.updated_at),
    }));
}

export async function putSetting(
  db: D1Database,
  userId: string,
  key: SettingKey,
  value: unknown,
  baseVersion: number | undefined,
): Promise<Setting> {
  const parsed = SETTINGS_SCHEMAS[key].safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      'validation_error',
      'Configuração inválida',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const json = JSON.stringify(parsed.data);
  const now = nowIso();
  const current = await first(db, 'SELECT * FROM settings WHERE user_id = ? AND key = ?', userId, key);
  const toSetting = (r: Row): Setting => ({
    key,
    value: parseJson(r.value, null),
    version: num(r.version),
    updatedAt: str(r.updated_at),
  });
  if (!current) {
    const row = await first(
      db,
      `INSERT INTO settings (user_id, key, value, version, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (user_id, key) DO NOTHING RETURNING *`,
      userId,
      key,
      json,
      now,
    );
    if (row) return toSetting(row);
  }
  const latest = current ?? (await first(db, 'SELECT * FROM settings WHERE user_id = ? AND key = ?', userId, key));
  if (baseVersion === undefined || num(latest?.version) !== baseVersion) {
    throw new ApiError('version_conflict', 'A configuração foi alterada em outro dispositivo', {
      current: latest ? toSetting(latest) : null,
    });
  }
  const row = await first(
    db,
    `UPDATE settings SET value = ?, version = version + 1, updated_at = ?
      WHERE user_id = ? AND key = ? AND version = ? RETURNING *`,
    json,
    now,
    userId,
    key,
    baseVersion,
  );
  if (!row) {
    const again = await first(db, 'SELECT * FROM settings WHERE user_id = ? AND key = ?', userId, key);
    throw new ApiError('version_conflict', 'A configuração foi alterada em outro dispositivo', {
      current: again ? toSetting(again) : null,
    });
  }
  return toSetting(row);
}

/* ----------------------------------------------------------------- search */

interface SearchSource {
  table: string;
  title: string;
  snippet: string;
  topic: string;
  trashable: boolean;
  /** Extra columns returned as-is. */
  extra?: string;
}

/**
 * Snippet expressions. For notes, `search_text` is aligned character by
 * character with `title || ' ' || body_text`, so the match offset maps back
 * to the original (accented) text.
 */
const SEARCH_SOURCES: Record<SearchEntityType, SearchSource> = {
  note: {
    table: 'notes',
    title: 'title',
    snippet: `CASE WHEN instr(search_text, ?) > length(title) + 1
                THEN substr(body_text, max(1, instr(search_text, ?) - length(title) - 61), 200)
                ELSE substr(body_text, 1, 200) END`,
    topic: 'topic_id',
    trashable: true,
    extra: ', role, reading_id, page',
  },
  topic: { table: 'topics', title: 'title', snippet: 'substr(description, 1, 200)', topic: 'parent_id', trashable: true },
  document: {
    table: 'documents',
    title: 'title',
    snippet: "original_name || CASE WHEN description <> '' THEN ' — ' || substr(description, 1, 160) ELSE '' END",
    topic: 'topic_id',
    trashable: true,
  },
  reading: {
    table: 'readings',
    title: 'title',
    snippet: "author || CASE WHEN notes <> '' THEN ' — ' || substr(notes, 1, 160) ELSE '' END",
    topic: 'topic_id',
    trashable: false,
  },
  concept: { table: 'concepts', title: 'name', snippet: 'substr(description, 1, 200)', topic: 'topic_id', trashable: false },
  plan: { table: 'reading_plans', title: 'title', snippet: 'substr(goal, 1, 200)', topic: 'topic_id', trashable: false },
  mindmap: { table: 'mind_maps', title: 'title', snippet: "''", topic: 'topic_id', trashable: false },
};

export async function search(
  db: D1Database,
  userId: string,
  q: { q: string; types?: string | undefined; limit: number },
): Promise<SearchResult[]> {
  const terms = searchTerms(q.q);
  if (terms.length === 0) throw badRequest('Informe um termo de busca');
  const requested = (q.types ?? '').split(',').filter((t): t is SearchEntityType =>
    (SEARCH_ENTITY_TYPES as readonly string[]).includes(t),
  );
  const types = requested.length > 0 ? requested : [...SEARCH_ENTITY_TYPES];
  const first = terms[0]!;
  const statements = types.map((type) => {
    const s = SEARCH_SOURCES[type];
    const snippetBinds = type === 'note' ? [first, first] : [];
    const where = terms.map(() => 'instr(search_text, ?) > 0').join(' AND ');
    return stmt(
      db,
      `SELECT id, ${s.title} AS title, ${s.snippet} AS snippet, ${s.topic} AS topic_id, updated_at${s.extra ?? ''},
              CASE WHEN instr(substr(search_text, 1, length(${s.title})), ?) > 0 THEN 0 ELSE 1 END AS rank
         FROM ${s.table}
        WHERE user_id = ?${s.trashable ? ' AND deleted_at IS NULL' : ''} AND ${where}
        ORDER BY rank, updated_at DESC LIMIT ?`,
      ...snippetBinds,
      first,
      userId,
      ...terms,
      q.limit,
    );
  });
  const results = await db.batch<Row>(statements);
  const merged = types.flatMap((type, i) =>
    (results[i]?.results ?? []).map((r) => ({
      rank: num(r.rank),
      result: {
        type,
        id: str(r.id),
        title: str(r.title) || (r.role === 'review' ? 'Resenha' : r.role === 'annotation' ? 'Anotação' : 'Sem título'),
        snippet: str(r.snippet).replace(/\s+/g, ' ').trim(),
        topicId: strOrNull(r.topic_id),
        updatedAt: str(r.updated_at),
        ...(type === 'note'
          ? { role: (strOrNull(r.role) ?? 'note') as NoteRole, readingId: strOrNull(r.reading_id), page: r.page == null ? null : num(r.page) }
          : {}),
      } as SearchResult,
    })),
  );
  merged.sort((a, b) => a.rank - b.rank || b.result.updatedAt.localeCompare(a.result.updatedAt));
  const top = merged.slice(0, q.limit).map((m) => m.result);
  // Reviews and annotations are shown with the title of their book.
  const books = await resolveEntities(
    db,
    userId,
    top.flatMap((r) => (r.readingId ? [{ type: 'reading' as const, id: r.readingId }] : [])),
  );
  return top.map((r) => (r.readingId ? { ...r, readingTitle: books.get(entityKey('reading', r.readingId))?.title ?? null } : r));
}

/* -------------------------------------------------------------- dashboard */

export async function dashboard(db: D1Database, userId: string): Promise<Dashboard> {
  const today = new Date().toISOString().slice(0, 10);
  const [recentNotes, inProgress, overdue, totals, recentSessions] = await db.batch<Row>([
    stmt(
      db,
      `SELECT ${NOTE_SUMMARY_COLS} FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6`,
      userId,
    ),
    stmt(db, "SELECT * FROM readings WHERE user_id = ? AND status = 'in_progress' ORDER BY updated_at DESC LIMIT 6", userId),
    stmt(
      db,
      `SELECT * FROM readings WHERE user_id = ? AND status <> 'completed' AND due_on IS NOT NULL AND due_on < ?
        ORDER BY due_on LIMIT 6`,
      userId,
      today,
    ),
    stmt(
      db,
      `SELECT
         COALESCE(SUM(CASE WHEN started_at >= ? THEN duration_seconds END), 0) AS s7,
         COALESCE(SUM(duration_seconds), 0) AS s30,
         COALESCE(SUM(CASE WHEN started_at >= ? THEN 1 END), 0) AS n7
       FROM study_sessions WHERE user_id = ? AND started_at >= ?`,
      isoBefore(7 * 86400),
      isoBefore(7 * 86400),
      userId,
      isoBefore(30 * 86400),
    ),
    stmt(db, 'SELECT * FROM study_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 5', userId),
  ]);
  const [cont, goals, favorites, topics, sessions] = await Promise.all([
    continueItems(db, userId),
    upcomingGoals(db, userId, 6),
    listFavorites(db, userId),
    listTopics(db, userId),
    hydrateSessions(db, recentSessions?.results ?? []),
  ]);
  const t = totals?.results?.[0] ?? {};
  return {
    continueItems: cont,
    recentNotes: (recentNotes?.results ?? []).map(toNoteSummary),
    readingsInProgress: (inProgress?.results ?? []).map(toReading),
    overdueReadings: (overdue?.results ?? []).map(toReading),
    upcomingGoals: goals,
    study: {
      last7DaysSeconds: num(t.s7),
      last30DaysSeconds: num(t.s30),
      sessionsLast7Days: num(t.n7),
      recent: sessions,
    },
    favorites: favorites.slice(0, 12),
    topics: topics.filter((tp) => tp.parentId === null).slice(0, 12),
  };
}
