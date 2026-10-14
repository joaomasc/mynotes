import type { TrashItem } from '@mynotes/shared';
import { notFound } from '../../lib/errors';
import { all, first, num, str, strOrNull, stmt } from '../../lib/db';
import { activityStmt } from '../../lib/helpers';
import { nowIso } from '../../lib/time';

type TrashType = 'topic' | 'note' | 'document';
const TABLE: Record<TrashType, string> = { topic: 'topics', note: 'notes', document: 'documents' };

/**
 * Lists trash roots: topics that are the top of their delete batch, plus
 * notes/documents deleted on their own. Items deleted together with a topic
 * are represented by that topic (batchSize counts all of them).
 */
export async function listTrash(db: D1Database, userId: string): Promise<TrashItem[]> {
  const rows = await all(
    db,
    `SELECT 'topic' AS type, id, title, deleted_at, delete_batch FROM topics t
      WHERE user_id = ? AND deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM topics p WHERE p.id = t.parent_id AND p.delete_batch = t.delete_batch)
     UNION ALL
     SELECT 'note', id, title, deleted_at, delete_batch FROM notes n
      WHERE user_id = ? AND deleted_at IS NOT NULL
        AND (delete_batch IS NULL OR NOT EXISTS (SELECT 1 FROM topics WHERE delete_batch = n.delete_batch))
     UNION ALL
     SELECT 'document', id, title, deleted_at, delete_batch FROM documents d
      WHERE user_id = ? AND deleted_at IS NOT NULL
        AND (delete_batch IS NULL OR NOT EXISTS (SELECT 1 FROM topics WHERE delete_batch = d.delete_batch))
     ORDER BY deleted_at DESC LIMIT 500`,
    userId,
    userId,
    userId,
  );
  const sizes = await all<{ b: string; n: number }>(
    db,
    `SELECT b, SUM(n) AS n FROM (
       SELECT delete_batch AS b, COUNT(*) AS n FROM topics WHERE user_id = ? AND delete_batch IS NOT NULL GROUP BY b
       UNION ALL SELECT delete_batch, COUNT(*) FROM notes WHERE user_id = ? AND delete_batch IS NOT NULL GROUP BY delete_batch
       UNION ALL SELECT delete_batch, COUNT(*) FROM documents WHERE user_id = ? AND delete_batch IS NOT NULL GROUP BY delete_batch
     ) GROUP BY b`,
    userId,
    userId,
    userId,
  );
  const sizeOf = new Map(sizes.map((s) => [s.b, num(s.n)]));
  return rows.map((r) => {
    const batchId = strOrNull(r.delete_batch);
    return {
      type: r.type as TrashType,
      id: str(r.id),
      title: str(r.title) || 'Sem título',
      deletedAt: str(r.deleted_at),
      batchId,
      batchSize: batchId ? (sizeOf.get(batchId) ?? 1) : 1,
    };
  });
}

async function trashedRow(db: D1Database, userId: string, type: TrashType, id: string) {
  const row = await first(
    db,
    `SELECT id, title, delete_batch, ${type === 'topic' ? 'parent_id' : 'topic_id'} AS ref FROM ${TABLE[type]}
      WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
    id,
    userId,
  );
  if (!row) throw notFound('Item da lixeira');
  return row;
}

export async function restore(db: D1Database, userId: string, type: TrashType, id: string): Promise<number> {
  const row = await trashedRow(db, userId, type, id);
  const now = nowIso();
  const batch = strOrNull(row.delete_batch);

  if (type === 'topic' && batch) {
    const res = await db.batch([
      // Batch members whose parent is gone (still trashed elsewhere) are restored at the root.
      stmt(
        db,
        `UPDATE topics SET parent_id = NULL
          WHERE user_id = ? AND delete_batch = ? AND parent_id IN (
            SELECT id FROM topics WHERE deleted_at IS NOT NULL AND delete_batch IS NOT ?)`,
        userId,
        batch,
        batch,
      ),
      stmt(
        db,
        `UPDATE topics SET deleted_at = NULL, delete_batch = NULL, updated_at = ?, version = version + 1
          WHERE user_id = ? AND delete_batch = ?`,
        now,
        userId,
        batch,
      ),
      stmt(
        db,
        `UPDATE notes SET deleted_at = NULL, delete_batch = NULL, updated_at = ?, version = version + 1
          WHERE user_id = ? AND delete_batch = ?`,
        now,
        userId,
        batch,
      ),
      stmt(
        db,
        `UPDATE documents SET deleted_at = NULL, delete_batch = NULL, updated_at = ?, version = version + 1
          WHERE user_id = ? AND delete_batch = ?`,
        now,
        userId,
        batch,
      ),
      activityStmt(db, userId, 'topic', id, 'restored', str(row.title)),
    ]);
    return res.slice(1, 4).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }

  // Single note/document (or a topic without batch): reattach to the root
  // when the original topic/parent is no longer available.
  const refCol = type === 'topic' ? 'parent_id' : 'topic_id';
  await db.batch([
    stmt(
      db,
      `UPDATE ${TABLE[type]} SET
          ${refCol} = CASE WHEN ${refCol} IN (SELECT id FROM topics WHERE deleted_at IS NULL) THEN ${refCol} ELSE NULL END,
          deleted_at = NULL, delete_batch = NULL, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ?`,
      now,
      id,
      userId,
    ),
    activityStmt(db, userId, type, id, 'restored', str(row.title)),
  ]);
  return 1;
}

async function deleteObjects(files: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    try {
      await files.delete(keys.slice(i, i + 1000));
    } catch (err) {
      // The rows are already gone; log the count only (keys are not sensitive but not useful either).
      console.error(JSON.stringify({ level: 'error', msg: 'r2 delete failed', count: keys.length, error: String(err) }));
    }
  }
}

/** Permanently deletes an item (a topic purges its whole delete batch). */
export async function purge(env: Env, userId: string, type: TrashType, id: string): Promise<number> {
  const db = env.DB;
  const row = await trashedRow(db, userId, type, id);
  const batch = strOrNull(row.delete_batch);

  if (type === 'topic' && batch) {
    const docs = await all<{ storage_key: string | null }>(
      db,
      'SELECT storage_key FROM documents WHERE user_id = ? AND delete_batch = ?',
      userId,
      batch,
    );
    const res = await db.batch([
      stmt(db, 'DELETE FROM notes WHERE user_id = ? AND delete_batch = ?', userId, batch),
      stmt(db, 'DELETE FROM documents WHERE user_id = ? AND delete_batch = ?', userId, batch),
      stmt(db, 'DELETE FROM topics WHERE user_id = ? AND delete_batch = ?', userId, batch),
    ]);
    await deleteObjects(env.FILES, docs.map((d) => d.storage_key).filter((k): k is string => !!k));
    return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }

  let key: string | null = null;
  if (type === 'document') {
    key = strOrNull((await first(db, 'SELECT storage_key FROM documents WHERE id = ?', id))?.storage_key);
  }
  await db.prepare(`DELETE FROM ${TABLE[type]} WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`).bind(id, userId).run();
  if (key) await deleteObjects(env.FILES, [key]);
  return 1;
}

export async function emptyTrash(env: Env, userId: string): Promise<number> {
  const db = env.DB;
  const docs = await all<{ storage_key: string | null }>(
    db,
    'SELECT storage_key FROM documents WHERE user_id = ? AND deleted_at IS NOT NULL',
    userId,
  );
  const res = await db.batch([
    stmt(db, 'DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL', userId),
    stmt(db, 'DELETE FROM documents WHERE user_id = ? AND deleted_at IS NOT NULL', userId),
    stmt(db, 'DELETE FROM topics WHERE user_id = ? AND deleted_at IS NOT NULL', userId),
  ]);
  await deleteObjects(env.FILES, docs.map((d) => d.storage_key).filter((k): k is string => !!k));
  return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}
