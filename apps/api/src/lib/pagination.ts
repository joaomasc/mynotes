import { badRequest } from './errors';
import type { Bindable } from './db';

/** Opaque keyset cursor: base64url(JSON array of the last row's sort values). */
export function encodeCursor(values: Bindable[]): string {
  return btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined, length: number): Bindable[] | null {
  if (!cursor) return null;
  try {
    const json = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const values = JSON.parse(json) as unknown;
    if (
      Array.isArray(values) &&
      values.length === length &&
      values.every((v) => v === null || typeof v === 'string' || typeof v === 'number')
    ) {
      return values as Bindable[];
    }
  } catch {
    // fall through
  }
  throw badRequest('Cursor de paginação inválido');
}

export interface SortSpec {
  /** SQL expression of the primary sort column (code constant). */
  expr: string;
  /** Row field holding that value, used to build the next cursor. */
  field: string;
  dir: 'ASC' | 'DESC';
}

/**
 * Keyset pagination on (expr, id). Returns the WHERE fragment, binds and
 * ORDER BY clause. `id` is the tie-breaker and is unique.
 */
export function keyset(sort: SortSpec, cursor: string | undefined, idExpr = 'id') {
  const values = decodeCursor(cursor, 2);
  const op = sort.dir === 'ASC' ? '>' : '<';
  const orderBy = `ORDER BY ${sort.expr} ${sort.dir}, ${idExpr} ${sort.dir}`;
  if (!values) return { where: '', binds: [] as Bindable[], orderBy };
  const [value, id] = values;
  return {
    where: ` AND (${sort.expr} ${op} ? OR (${sort.expr} = ? AND ${idExpr} ${op} ?))`,
    binds: [value ?? null, value ?? null, id ?? null],
    orderBy,
  };
}

/** Slices one extra row to know whether there is a next page. */
export function pageOf<T extends Record<string, unknown>>(rows: T[], limit: number, sort: SortSpec) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor([(last[sort.field] as Bindable) ?? null, last.id as Bindable]) : null;
  return { items, nextCursor };
}
