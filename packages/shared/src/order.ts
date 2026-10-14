import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Manual ordering uses fractional index keys: inserting between two siblings
 * produces a key that sorts between them, so a move updates a single row.
 */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

export function keysBetween(before: string | null, after: string | null, n: number): string[] {
  return generateNKeysBetween(before, after, n);
}
