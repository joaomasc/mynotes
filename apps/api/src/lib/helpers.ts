import { keyBetween, uuidv7, type EntityType } from '@mynotes/shared';
import { badRequest } from './errors';
import { first, stmt, type Bindable } from './db';
import { isoBefore, nowIso } from './time';

/* ----------------------------------------------------------- ownership -- */

const TABLE_LABEL: Record<string, string> = {
  topics: 'Assunto',
  notes: 'Nota',
  documents: 'Documento',
  readings: 'Leitura',
  concepts: 'Conceito',
  reading_plans: 'Plano',
  mind_maps: 'Mapa mental',
  study_sessions: 'Sessão de estudo',
};

const TRASHABLE = new Set(['topics', 'notes', 'documents']);

/**
 * Verifies that a referenced row exists, belongs to the user and is not in
 * the trash. Used when a request links to another entity (e.g. topicId).
 */
export async function assertReference(
  db: D1Database,
  table: keyof typeof TABLE_LABEL,
  id: string | null | undefined,
  userId: string,
): Promise<void> {
  if (id == null) return;
  const sql =
    `SELECT 1 AS ok FROM ${table} WHERE id = ? AND user_id = ?` + (TRASHABLE.has(table) ? ' AND deleted_at IS NULL' : '');
  const row = await first(db, sql, id, userId);
  if (!row) throw badRequest(`${TABLE_LABEL[table]} referenciado não existe`, { table, id });
}

/** Assert many references of the same table at once. */
export async function assertReferences(
  db: D1Database,
  table: keyof typeof TABLE_LABEL,
  ids: string[],
  userId: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const sql =
    `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND id IN (${unique.map(() => '?').join(',')})` +
    (TRASHABLE.has(table) ? ' AND deleted_at IS NULL' : '');
  const row = await first<{ n: number }>(db, sql, userId, ...unique);
  if ((row?.n ?? 0) !== unique.length) throw badRequest(`${TABLE_LABEL[table]} referenciado não existe`);
}

/* ------------------------------------------------------------ ordering -- */

export interface SortScope {
  table: string;
  /** SQL predicate selecting the sibling set (code constant + binds). */
  where: string;
  binds: Bindable[];
  /** Row being moved (excluded from neighbour lookups). */
  excludeId?: string | undefined;
}

/**
 * Computes a fractional sort key for placing an item after `afterId`, before
 * `beforeId`, or (by default) at the end of its sibling set.
 */
export async function sortKeyFor(
  db: D1Database,
  scope: SortScope,
  position: { afterId?: string | null | undefined; beforeId?: string | null | undefined } = {},
): Promise<string> {
  const exclude = scope.excludeId ?? '';
  const keyOf = async (id: string) => {
    const row = await first<{ sort_key: string }>(
      db,
      `SELECT sort_key FROM ${scope.table} WHERE id = ? AND ${scope.where}`,
      id,
      ...scope.binds,
    );
    if (!row) throw badRequest('Item de referência para posição não encontrado');
    return row.sort_key;
  };
  const neighbour = async (op: '>' | '<', key: string) => {
    const row = await first<{ sort_key: string }>(
      db,
      `SELECT sort_key FROM ${scope.table} WHERE ${scope.where} AND id <> ? AND sort_key ${op} ?
       ORDER BY sort_key ${op === '>' ? 'ASC' : 'DESC'} LIMIT 1`,
      ...scope.binds,
      exclude,
      key,
    );
    return row?.sort_key ?? null;
  };
  const last = async () => {
    const row = await first<{ k: string | null }>(
      db,
      `SELECT MAX(sort_key) AS k FROM ${scope.table} WHERE ${scope.where} AND id <> ?`,
      ...scope.binds,
      exclude,
    );
    return row?.k ?? null;
  };

  try {
    if (position.afterId) {
      const after = await keyOf(position.afterId);
      return keyBetween(after, await neighbour('>', after));
    }
    if (position.beforeId) {
      const before = await keyOf(position.beforeId);
      return keyBetween(await neighbour('<', before), before);
    }
    if (position.afterId === null) {
      // Explicitly first.
      const firstRow = await first<{ k: string | null }>(
        db,
        `SELECT MIN(sort_key) AS k FROM ${scope.table} WHERE ${scope.where} AND id <> ?`,
        ...scope.binds,
        exclude,
      );
      return keyBetween(null, firstRow?.k ?? null);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'ApiError') throw err;
    // Corrupt or duplicate neighbour keys: fall back to the end.
  }
  return keyBetween(await last(), null);
}

/* ------------------------------------------------------------ activity -- */

export type ActivityAction = 'created' | 'updated' | 'viewed' | 'deleted' | 'restored' | 'completed' | 'studied' | 'uploaded';

/**
 * Records an activity event. With `throttleSeconds`, skips the insert when
 * the same action for the same entity was recorded recently (autosave).
 */
export function activityStmt(
  db: D1Database,
  userId: string,
  entityType: EntityType,
  entityId: string,
  action: ActivityAction,
  title: string,
  throttleSeconds = 0,
): D1PreparedStatement {
  const now = nowIso();
  if (throttleSeconds <= 0) {
    return stmt(
      db,
      `INSERT INTO activity_events (id, user_id, entity_type, entity_id, action, title, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      uuidv7(),
      userId,
      entityType,
      entityId,
      action,
      title.slice(0, 300),
      now,
    );
  }
  return stmt(
    db,
    `INSERT INTO activity_events (id, user_id, entity_type, entity_id, action, title, occurred_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM activity_events
         WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND action = ? AND occurred_at > ?)`,
    uuidv7(),
    userId,
    entityType,
    entityId,
    action,
    title.slice(0, 300),
    now,
    userId,
    entityType,
    entityId,
    action,
    isoBefore(throttleSeconds),
  );
}

/* ---------------------------------------------------------------- misc -- */

/** SQL for the ids of a topic and all its (non-deleted) descendants. */
export const SUBTREE_SQL = `WITH RECURSIVE sub(id) AS (
    SELECT id FROM topics WHERE id = ? AND user_id = ?
    UNION
    SELECT t.id FROM topics t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL
  ) SELECT id FROM sub`;

export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
