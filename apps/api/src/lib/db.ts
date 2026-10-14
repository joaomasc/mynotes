import { notFound, versionConflict } from './errors';
import { nowIso } from './time';

export type Row = Record<string, unknown>;
export type Bindable = string | number | null;

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
export const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function first<T = Row>(db: D1Database, sql: string, ...binds: Bindable[]): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
}

export async function all<T = Row>(db: D1Database, sql: string, ...binds: Bindable[]): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<T>();
  return res.results;
}

export async function run(db: D1Database, sql: string, ...binds: Bindable[]): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...binds)
    .run();
}

export function stmt(db: D1Database, sql: string, ...binds: Bindable[]): D1PreparedStatement {
  return db.prepare(sql).bind(...binds);
}

/** `?, ?, ?` placeholder list. */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/** Names of tables/columns used below are always code constants, never user input. */
export interface VersionedUpdate {
  table: string;
  id: string;
  userId: string;
  baseVersion: number;
  set: Record<string, Bindable>;
  /** Whether the table has `deleted_at` (soft delete). */
  trashable?: boolean;
  /** Override the ownership predicate for child tables without user_id. */
  ownerSql?: { sql: string; binds: Bindable[] };
  now?: string;
}

/** Builds an optimistic-concurrency UPDATE: applies only if the version matches. */
export function versionedUpdateStmt(db: D1Database, u: VersionedUpdate): D1PreparedStatement {
  const cols = Object.keys(u.set);
  const assignments = [...cols.map((c) => `${c} = ?`), 'version = version + 1', 'updated_at = ?'];
  const owner = u.ownerSql ?? { sql: 'user_id = ?', binds: [u.userId] };
  const sql =
    `UPDATE ${u.table} SET ${assignments.join(', ')} ` +
    `WHERE id = ? AND ${owner.sql} AND version = ?` +
    (u.trashable ? ' AND deleted_at IS NULL' : '') +
    ' RETURNING *';
  return db.prepare(sql).bind(...cols.map((c) => u.set[c]!), u.now ?? nowIso(), u.id, ...owner.binds, u.baseVersion);
}

/**
 * Runs a versioned update. On failure distinguishes "not found" from a
 * version conflict, returning the current server copy in the 409 details.
 */
export async function versionedUpdate<T>(
  db: D1Database,
  u: VersionedUpdate,
  load: () => Promise<T | null>,
  what: string,
): Promise<Row> {
  const row = await versionedUpdateStmt(db, u).first<Row>();
  if (row) return row;
  const current = await load();
  if (!current) throw notFound(what);
  throw versionConflict(current);
}

/** Interprets the result of a RETURNING statement inside a batch. */
export function returned(result: D1Result | undefined): Row | null {
  const rows = (result?.results ?? []) as Row[];
  return rows[0] ?? null;
}
