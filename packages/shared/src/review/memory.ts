import { default_w, forgetting_curve } from 'ts-fsrs';

/**
 * The memory graph (docs/grafo-memoria.md): how likely the user is to
 * remember each note, topic and book right now (or on a later day), from the
 * FSRS state of their review cards.
 */

/** What the graph needs of a card: where it belongs and its FSRS state. */
export interface MemoryCard {
  noteId: string | null;
  /** Effective topic (the note's, the book's for annotations, or the card's own). */
  topicId: string | null;
  /** The book of an annotation or review note. */
  readingId: string | null;
  phase: number;
  stability: number;
  lastReview: string | null;
  due: string;
}

/** Wire format: one tuple per card (thousands of cards stay small). */
export type MemoryTuple = [noteId: string | null, topicId: string | null, readingId: string | null, phase: number, stability: number, lastReview: string | null, due: string];

export const fromMemoryTuple = (t: MemoryTuple): MemoryCard => ({ noteId: t[0], topicId: t[1], readingId: t[2], phase: t[3], stability: t[4], lastReview: t[5], due: t[6] });

/** Chance of remembering a card at `at` (FSRS-6 forgetting curve); null for a card never reviewed. */
export function cardRetrievability(c: Pick<MemoryCard, 'phase' | 'stability' | 'lastReview'>, at: Date): number | null {
  if (c.phase === 0 || !c.lastReview || c.stability <= 0) return null;
  const elapsed = Math.max(0, (at.getTime() - Date.parse(c.lastReview)) / 86_400_000);
  return forgetting_curve(default_w, elapsed, c.stability);
}

export interface MemoryInfo {
  /** Average chance of remembering the reviewed cards (null: none reviewed yet). */
  r: number | null;
  /** Active cards. */
  cards: number;
  /** Cards already reviewed at least once. */
  reviewed: number;
  /** Cards due at `at`. */
  due: number;
}

/**
 * Memory of every graph node at `at`: a note from its cards, a book from the
 * cards of its annotations and review, a topic from every card under it
 * (subtopics included). Keys are graph keys: `note:<id>`, `topic:<id>`, `reading:<id>`.
 */
export function memoryByNode(cards: MemoryCard[], parentOf: (topicId: string) => string | null | undefined, at: Date): Map<string, MemoryInfo> {
  const acc = new Map<string, { sum: number; reviewed: number; cards: number; due: number }>();
  const add = (key: string, r: number | null, due: boolean) => {
    const a = acc.get(key) ?? { sum: 0, reviewed: 0, cards: 0, due: 0 };
    a.cards++;
    if (r !== null) {
      a.sum += r;
      a.reviewed++;
    }
    if (due) a.due++;
    acc.set(key, a);
  };
  const time = at.getTime();
  for (const c of cards) {
    const r = cardRetrievability(c, at);
    const due = c.phase > 0 && Date.parse(c.due) <= time;
    if (c.noteId) add(`note:${c.noteId}`, r, due);
    if (c.readingId) add(`reading:${c.readingId}`, r, due);
    // The topic and all its ancestors.
    const seen = new Set<string>();
    let t = c.topicId;
    while (t && !seen.has(t)) {
      seen.add(t);
      add(`topic:${t}`, r, due);
      t = parentOf(t) ?? null;
    }
  }
  const out = new Map<string, MemoryInfo>();
  for (const [key, a] of acc) out.set(key, { r: a.reviewed ? a.sum / a.reviewed : null, cards: a.cards, reviewed: a.reviewed, due: a.due });
  return out;
}

/** Tiers of the color scale, strongest first: 90% or more, 80–90, 70–80, 50–70, below 50. */
export const MEMORY_TIERS = [0.9, 0.8, 0.7, 0.5, 0] as const;
export const MEMORY_TIER_LABELS = ['90% ou mais', '80 a 90%', '70 a 80%', '50 a 70%', 'menos de 50%'] as const;

/** 0 (remembers well) to 4 (fading). */
export function memoryTier(r: number): 0 | 1 | 2 | 3 | 4 {
  const i = MEMORY_TIERS.findIndex((t) => r >= t);
  return (i < 0 ? 4 : i) as 0 | 1 | 2 | 3 | 4;
}
