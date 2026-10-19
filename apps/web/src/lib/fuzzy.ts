import { normalizeSearch } from '@mynotes/shared';

/**
 * Fuzzy match of a query against a title (letters in order, not necessarily
 * together), ignoring case and accents. Higher is better; null = no match.
 * Consecutive letters, word starts and a matching prefix score more, so
 * "ocap" finds "O Capital" before "Organização da capela".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalizeSearch(query).replace(/\s+/g, '');
  if (!q) return 0;
  const t = normalizeSearch(text);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || t[found - 1] === ' ' || t[found - 1] === '-' || t[found - 1] === '/';
    score += found === prev + 1 ? 8 : wordStart ? 6 : 1;
    score -= Math.min(found - ti, 6) * 0.5;
    prev = found;
    ti = found + 1;
  }
  const plain = normalizeSearch(query);
  if (t.startsWith(plain)) score += 20;
  else if (t.includes(plain)) score += 10;
  // Shorter titles win ties ("Marx" over "Marxismo e sociedade").
  return score - t.length * 0.05;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, text(item));
    if (score !== null) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}
