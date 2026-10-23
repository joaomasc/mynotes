import { normalizeAligned, normalizeSearch } from '../text';

/**
 * Answers the app checks without the AI: typed answers, and the passages a
 * question claims to come from (an AI question must point to text that is
 * really in the note, or it is discarded).
 */

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalizeAnswer(text: string): string {
  return normalizeSearch(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export type TypedVerdict = 'exact' | 'close' | 'wrong';

/**
 * Compares a typed answer with the expected one, ignoring case, accents and
 * punctuation. Small slips (one letter in five) count as "close". Several
 * accepted answers can be separated by " | ".
 */
export function compareTyped(expected: string, given: string): { verdict: TypedVerdict; similarity: number } {
  const g = normalizeAnswer(given);
  let best = 0;
  for (const option of expected.split(' | ')) {
    const e = normalizeAnswer(option);
    if (!e) continue;
    if (e === g) return { verdict: 'exact', similarity: 1 };
    const sim = 1 - levenshtein(e, g) / Math.max(e.length, g.length, 1);
    best = Math.max(best, sim);
  }
  const similarity = Math.round(best * 100) / 100;
  return { verdict: g && similarity >= 0.8 ? 'close' : 'wrong', similarity };
}

/** Score (0–100) of a typed answer, which suggests the rating. */
export const typedScore = (v: TypedVerdict): number => (v === 'exact' ? 100 : v === 'close' ? 70 : 0);

/* ----------------------------------------------------------- passages -- */

/** Text compared when checking a quote: no accents, case, quotes, markup or spacing differences. */
export function quoteKey(text: string): string {
  return normalizeSearch(text)
    .replace(/[“”"'‘’«»`*_]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export const QUOTE_MIN_CHARS = 12;

/**
 * Whether a quoted passage is in the text. A quote cut with "…" is checked
 * piece by piece, in order.
 */
export function quoteFound(body: string, quote: string): boolean {
  const hay = quoteKey(body);
  const pieces = quote
    .split(/…|\.\.\.|\[\s*\.\.\.\s*\]|\[…\]/)
    .map(quoteKey)
    .filter(Boolean);
  if (pieces.length === 0 || pieces.join(' ').length < QUOTE_MIN_CHARS) return false;
  let at = 0;
  for (const p of pieces) {
    const i = hay.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}

/**
 * A short piece of the quote as it appears in `normalizeAligned(note)`
 * (notes.search_text), so the database can tell later whether the passage
 * is still in the note. Empty when no piece matches exactly.
 */
export function sourceProbe(body: string, quote: string): string {
  const hay = normalizeAligned(body);
  const list = normalizeAligned(quote).split(' ').filter(Boolean).slice(0, 60);
  // Longest pieces first; a quote that differs from the note in a dash or a comma still has an exact run of words.
  for (const size of [7, 5, 4, 3]) {
    for (let s = 0; s + size <= Math.max(list.length, size); s++) {
      const probe = list.slice(s, s + size).join(' ');
      if (probe.length >= QUOTE_MIN_CHARS && hay.includes(probe)) return probe.slice(0, 200);
    }
  }
  return '';
}
