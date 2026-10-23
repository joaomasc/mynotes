/**
 * Cloze deletions, Anki style: `{{c1::resposta}}` or `{{c1::resposta::dica}}`.
 * Blanks with the same number are hidden together (one card per number); a
 * blank without a number (`{{resposta}}`) is a card of its own.
 */

export interface ClozeBlank {
  index: number;
  answer: string;
  hint: string | null;
  start: number;
  end: number;
}

const CLOZE_RE = /\{\{(?:c(\d{1,2})::)?([\s\S]+?)(?:::([^{}]*?))?\}\}/g;

export function parseCloze(text: string): ClozeBlank[] {
  const raw: { n: number | null; answer: string; hint: string | null; start: number; end: number }[] = [];
  for (const m of text.matchAll(CLOZE_RE)) {
    const answer = m[2]!.trim();
    if (!answer) continue;
    raw.push({ n: m[1] ? Number(m[1]) : null, answer, hint: m[3]?.trim() || null, start: m.index, end: m.index + m[0].length });
  }
  let next = Math.max(0, ...raw.map((b) => b.n ?? 0)) + 1;
  return raw.map((b) => ({ index: b.n !== null && b.n > 0 ? b.n : next++, answer: b.answer, hint: b.hint, start: b.start, end: b.end }));
}

/** Card numbers in the text, ascending. */
export function clozeIndices(text: string): number[] {
  return [...new Set(parseCloze(text).map((b) => b.index))].sort((a, b) => a - b);
}

export type ClozeSegment = { text: string; blank: null } | { text: string; blank: 'active' | 'other'; answer: string; hint: string | null };

/** The text in pieces: plain text, the blanks of this card and the other blanks (shown filled). */
export function clozeSegments(text: string, index: number): ClozeSegment[] {
  const out: ClozeSegment[] = [];
  let at = 0;
  for (const b of parseCloze(text)) {
    if (b.start > at) out.push({ text: text.slice(at, b.start), blank: null });
    out.push({ text: b.answer, blank: b.index === index ? 'active' : 'other', answer: b.answer, hint: b.hint });
    at = b.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), blank: null });
  return out;
}

/** Plain text versions: the question (`[…]` in the blanks), the answer and the full sentence. */
export function renderCloze(text: string, index: number): { prompt: string; answer: string; full: string } {
  const segs = clozeSegments(text, index);
  const prompt = segs.map((s) => (s.blank === 'active' ? `[${s.hint ?? '…'}]` : s.text)).join('');
  const answer = segs
    .filter((s) => s.blank === 'active')
    .map((s) => s.text)
    .join(' · ');
  return { prompt, answer, full: segs.map((s) => s.text).join('') };
}

/** The text with the markers removed (what the note says). */
export function clozePlain(text: string): string {
  return clozeSegments(text, 0)
    .map((s) => s.text)
    .join('');
}
