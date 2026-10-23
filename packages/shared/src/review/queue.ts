/**
 * Building and running a review session: topics interleaved, a selection
 * reduced to its top topics, and the items answered wrong coming back at
 * the end of the session until they are right (successive relearning).
 */

/**
 * Spreads the items of each group evenly over the list (instead of one
 * block per group), keeping the order inside each group.
 */
export function interleave<T>(items: T[], groupOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  if (groups.size <= 1) return [...items];
  const placed: { item: T; at: number; tie: number }[] = [];
  let tie = 0;
  for (const list of groups.values()) {
    list.forEach((item, i) => placed.push({ item, at: (i + 0.5) / list.length, tie: tie++ }));
  }
  return placed.sort((a, b) => a.at - b.at || a.tie - b.tie).map((p) => p.item);
}

/**
 * The selection without topics already covered by a selected ancestor
 * (choosing A already includes its children B and grandchildren C).
 */
export function topScope(ids: string[], parentOf: (id: string) => string | null | undefined): string[] {
  const chosen = new Set(ids);
  const out: string[] = [];
  for (const id of chosen) {
    let p = parentOf(id);
    const seen = new Set([id]);
    let covered = false;
    while (p && !seen.has(p)) {
      if (chosen.has(p)) {
        covered = true;
        break;
      }
      seen.add(p);
      p = parentOf(p);
    }
    if (!covered) out.push(id);
  }
  return out;
}

/** How many times an item answered wrong may come back within one session. */
export const RELEARN_MAX = 3;

export interface QueueItem {
  cardId: string;
  /** 0 the first time; 1, 2… when it comes back after a mistake. */
  round: number;
}

/**
 * The queue after answering its first item: a mistake ("Errei") sends the
 * item back a few positions later (or to the end), up to RELEARN_MAX times.
 */
export function afterAnswer(queue: QueueItem[], rating: number, gap = 3): QueueItem[] {
  const [head, ...rest] = queue;
  if (!head) return [];
  if (rating !== 1 || head.round >= RELEARN_MAX) return rest;
  const back = { cardId: head.cardId, round: head.round + 1 };
  const at = Math.min(rest.length, gap);
  return [...rest.slice(0, at), back, ...rest.slice(at)];
}
