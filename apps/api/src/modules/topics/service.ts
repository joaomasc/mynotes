import {
  normalizeAligned,
  uuidv7,
  type Topic,
  type TopicDetail,
  type TopicWithCounts,
} from '@mynotes/shared';
import { badRequest, notFound } from '../../lib/errors';
import { all, first, num, str, strOrNull, stmt, versionedUpdate, type Row } from '../../lib/db';
import { SUBTREE_SQL, activityStmt, assertReference, sortKeyFor } from '../../lib/helpers';
import { nowIso } from '../../lib/time';

export function toTopic(r: Row): Topic {
  return {
    id: str(r.id),
    parentId: strOrNull(r.parent_id),
    title: str(r.title),
    description: str(r.description),
    color: strOrNull(r.color),
    sortKey: str(r.sort_key),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const topicSearchText = (title: string, description: string) =>
  normalizeAligned(`${title.normalize('NFC')} ${description.normalize('NFC')}`);

const siblingScope = (userId: string, parentId: string | null, excludeId?: string) => ({
  table: 'topics',
  where: 'user_id = ? AND parent_id IS ? AND deleted_at IS NULL',
  binds: [userId, parentId],
  excludeId,
});

async function counts(db: D1Database, userId: string): Promise<Map<string, [number, number, number]>> {
  const [notes, docs, readings] = await db.batch<{ topic_id: string; n: number }>([
    stmt(
      db,
      'SELECT topic_id, COUNT(*) AS n FROM notes WHERE user_id = ? AND deleted_at IS NULL AND topic_id IS NOT NULL GROUP BY topic_id',
      userId,
    ),
    stmt(
      db,
      'SELECT topic_id, COUNT(*) AS n FROM documents WHERE user_id = ? AND deleted_at IS NULL AND topic_id IS NOT NULL GROUP BY topic_id',
      userId,
    ),
    stmt(db, 'SELECT topic_id, COUNT(*) AS n FROM readings WHERE user_id = ? AND topic_id IS NOT NULL GROUP BY topic_id', userId),
  ]);
  const map = new Map<string, [number, number, number]>();
  const add = (rows: { topic_id: string; n: number }[] | undefined, idx: 0 | 1 | 2) => {
    for (const r of rows ?? []) {
      const entry = map.get(r.topic_id) ?? [0, 0, 0];
      entry[idx] = r.n;
      map.set(r.topic_id, entry);
    }
  };
  add(notes?.results, 0);
  add(docs?.results, 1);
  add(readings?.results, 2);
  return map;
}

function withCounts(topic: Topic, c: Map<string, [number, number, number]>): TopicWithCounts {
  const [noteCount, documentCount, readingCount] = c.get(topic.id) ?? [0, 0, 0];
  return { ...topic, noteCount, documentCount, readingCount };
}

/** The whole (non-deleted) tree as a flat list ordered by parent and sort key. */
export async function listTopics(db: D1Database, userId: string): Promise<TopicWithCounts[]> {
  const [rows, c] = await Promise.all([
    all(
      db,
      'SELECT * FROM topics WHERE user_id = ? AND deleted_at IS NULL ORDER BY parent_id, sort_key, id',
      userId,
    ),
    counts(db, userId),
  ]);
  return rows.map((r) => withCounts(toTopic(r), c));
}

export async function getTopicRow(db: D1Database, userId: string, id: string): Promise<Row | null> {
  return first(db, 'SELECT * FROM topics WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, userId);
}

export async function getTopicDetail(db: D1Database, userId: string, id: string): Promise<TopicDetail> {
  const row = await getTopicRow(db, userId, id);
  if (!row) throw notFound('Assunto');
  const [ancestors, children, c] = await Promise.all([
    all(
      db,
      `WITH RECURSIVE anc(id, parent_id, title, depth) AS (
         SELECT id, parent_id, title, 0 FROM topics WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT t.id, t.parent_id, t.title, anc.depth + 1 FROM topics t JOIN anc ON t.id = anc.parent_id
          WHERE anc.depth < 10000
       ) SELECT id, parent_id, title FROM anc WHERE depth > 0 ORDER BY depth DESC`,
      id,
      userId,
    ),
    all(
      db,
      'SELECT * FROM topics WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY sort_key, id',
      userId,
      id,
    ),
    counts(db, userId),
  ]);
  return {
    topic: withCounts(toTopic(row), c),
    ancestors: ancestors.map((a) => ({ id: str(a.id), title: str(a.title), parentId: strOrNull(a.parent_id) })),
    children: children.map((r) => withCounts(toTopic(r), c)),
  };
}

export interface CreateTopicInput {
  id?: string | undefined;
  parentId: string | null;
  title: string;
  description: string;
  color: string | null;
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

/** Creates a topic. Re-sending a create with an existing id returns the existing topic. */
export async function createTopic(
  db: D1Database,
  userId: string,
  input: CreateTopicInput,
): Promise<{ topic: Topic; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM topics WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { topic: toTopic(existing), created: false };
  }
  await assertReference(db, 'topics', input.parentId, userId);
  const sortKey = await sortKeyFor(db, siblingScope(userId, input.parentId), input);
  const now = nowIso();
  const title = input.title.normalize('NFC');
  const [inserted] = await db.batch([
    stmt(
      db,
      `INSERT INTO topics (id, user_id, parent_id, title, description, color, sort_key, search_text, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
      id,
      userId,
      input.parentId,
      title,
      input.description,
      input.color,
      sortKey,
      topicSearchText(title, input.description),
      now,
      now,
    ),
    activityStmt(db, userId, 'topic', id, 'created', title),
  ]);
  return { topic: toTopic((inserted?.results as Row[])[0]!), created: true };
}

export async function updateTopic(
  db: D1Database,
  userId: string,
  id: string,
  input: { baseVersion: number; title?: string | undefined; description?: string | undefined; color?: string | null | undefined },
): Promise<Topic> {
  const current = await getTopicRow(db, userId, id);
  if (!current) throw notFound('Assunto');
  const title = (input.title ?? str(current.title)).normalize('NFC');
  const description = input.description ?? str(current.description);
  const set: Record<string, string | null> = {
    title,
    description,
    search_text: topicSearchText(title, description),
  };
  if (input.color !== undefined) set.color = input.color;
  const row = await versionedUpdate(
    db,
    { table: 'topics', id, userId, baseVersion: input.baseVersion, set, trashable: true },
    async () => {
      const r = await getTopicRow(db, userId, id);
      return r ? toTopic(r) : null;
    },
    'Assunto',
  );
  return toTopic(row);
}

/** Moves a topic under a new parent (or to the root) and/or reorders it. */
export async function moveTopic(
  db: D1Database,
  userId: string,
  id: string,
  input: { baseVersion: number; parentId: string | null; afterId?: string | null | undefined; beforeId?: string | null | undefined },
): Promise<Topic> {
  const current = await getTopicRow(db, userId, id);
  if (!current) throw notFound('Assunto');
  if (input.parentId === id) throw badRequest('Um assunto não pode ser pai de si mesmo');
  if (input.parentId) {
    await assertReference(db, 'topics', input.parentId, userId);
    const cycle = await first(db, `SELECT 1 AS hit FROM (${SUBTREE_SQL}) WHERE id = ?`, id, userId, input.parentId);
    if (cycle) throw badRequest('Não é possível mover um assunto para dentro de um de seus subassuntos');
  }
  const sortKey = await sortKeyFor(db, siblingScope(userId, input.parentId, id), input);
  const row = await versionedUpdate(
    db,
    {
      table: 'topics',
      id,
      userId,
      baseVersion: input.baseVersion,
      set: { parent_id: input.parentId, sort_key: sortKey },
      trashable: true,
    },
    async () => {
      const r = await getTopicRow(db, userId, id);
      return r ? toTopic(r) : null;
    },
    'Assunto',
  );
  return toTopic(row);
}

export type TopicDeleteMode = 'trash_all' | 'move_to_parent';

/**
 * Deletes a topic (soft delete).
 *  - trash_all: the topic, its subtopics and their notes/documents go to the
 *    trash together (one batch, restorable together).
 *  - move_to_parent: subtopics and all content move to the parent topic (or
 *    to the root / "no topic"), then only the topic goes to the trash.
 * Readings, plans, sessions, concepts and maps are never deleted with a topic;
 * in trash_all mode they keep pointing to the trashed topic so a restore
 * reconnects them.
 */
export async function deleteTopic(
  db: D1Database,
  userId: string,
  id: string,
  mode: TopicDeleteMode,
): Promise<{ batchId: string; affected: number }> {
  const current = await getTopicRow(db, userId, id);
  if (!current) throw notFound('Assunto');
  const now = nowIso();
  const batchId = uuidv7();
  const title = str(current.title);

  if (mode === 'move_to_parent') {
    const parentId = strOrNull(current.parent_id);
    const moveContent = ['notes', 'documents', 'readings', 'concepts', 'reading_plans', 'study_sessions', 'mind_maps'].map(
      (table) => stmt(db, `UPDATE ${table} SET topic_id = ? WHERE user_id = ? AND topic_id = ?`, parentId, userId, id),
    );
    const res = await db.batch([
      // Subtopics keep their relative order (their keys are reused under the new parent).
      stmt(
        db,
        'UPDATE topics SET parent_id = ?, updated_at = ?, version = version + 1 WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL',
        parentId,
        now,
        userId,
        id,
      ),
      ...moveContent,
      stmt(
        db,
        'UPDATE topics SET deleted_at = ?, delete_batch = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?',
        now,
        batchId,
        now,
        id,
        userId,
      ),
      activityStmt(db, userId, 'topic', id, 'deleted', title),
    ]);
    return { batchId, affected: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) };
  }

  const res = await db.batch([
    stmt(
      db,
      `UPDATE notes SET deleted_at = ?, delete_batch = ? WHERE user_id = ? AND deleted_at IS NULL
          AND topic_id IN (${SUBTREE_SQL})`,
      now,
      batchId,
      userId,
      id,
      userId,
    ),
    stmt(
      db,
      `UPDATE documents SET deleted_at = ?, delete_batch = ? WHERE user_id = ? AND deleted_at IS NULL
          AND topic_id IN (${SUBTREE_SQL})`,
      now,
      batchId,
      userId,
      id,
      userId,
    ),
    stmt(
      db,
      `UPDATE topics SET deleted_at = ?, delete_batch = ?, updated_at = ?, version = version + 1
        WHERE user_id = ? AND deleted_at IS NULL AND id IN (${SUBTREE_SQL})`,
      now,
      batchId,
      now,
      userId,
      id,
      userId,
    ),
    activityStmt(db, userId, 'topic', id, 'deleted', title),
  ]);
  return { batchId, affected: res.slice(0, 3).reduce((n, r) => n + (r.meta.changes ?? 0), 0) };
}
