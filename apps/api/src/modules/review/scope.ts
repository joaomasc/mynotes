import type { ReviewScopeInfo } from '@mynotes/shared';
import { first, num, placeholders, type Bindable } from '../../lib/db';
import { nowIso } from '../../lib/time';

/**
 * What a selection of topics covers (docs/revisar.md › Escolher os assuntos):
 * each selected topic with all its descendants, never what is in the trash.
 * Choosing A covers A, its children B and grandchildren C; choosing only B
 * covers B and C, but not A nor B's siblings. No selection: everything.
 */

export interface Scope {
  /** SQL that opens a query with the CTE `scope(id)` (empty without a selection). */
  cte: string;
  binds: Bindable[];
  /** Predicate for a topic id expression: inside the selection (always true without one). */
  has: (topicExpr: string) => string;
}

export function scopeOf(userId: string, topicIds: string[] | undefined): Scope {
  if (!topicIds || topicIds.length === 0) return { cte: '', binds: [], has: () => '1 = 1' };
  return {
    cte: `WITH RECURSIVE scope(id) AS (
        SELECT id FROM topics WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders(topicIds.length)})
        UNION
        SELECT t.id FROM topics t JOIN scope ON t.parent_id = scope.id WHERE t.deleted_at IS NULL
      ) `,
    binds: [userId, ...topicIds],
    has: (expr) => `${expr} IN (SELECT id FROM scope)`,
  };
}

/** Cards with their note and the note's book (annotations take the book's topic). */
export const CARD_FROM = `review_cards c
  LEFT JOIN notes n ON n.id = c.note_id
  LEFT JOIN readings r ON r.id = n.reading_id`;

/** Answers with their cards (same aliases as CARD_FROM, plus l). */
export const LOG_CARD_FROM = `review_logs l JOIN review_cards c ON c.id = l.card_id
  LEFT JOIN notes n ON n.id = c.note_id
  LEFT JOIN readings r ON r.id = n.reading_id`;

/** The topic a card belongs to: its note's (or the note's book), or its own when it has no note. */
export const CARD_TOPIC = `(CASE WHEN n.id IS NOT NULL THEN COALESCE(n.topic_id, r.topic_id) ELSE c.topic_id END)`;

/** Cards whose note and topic are not in the trash. */
export const CARD_LIVE = `(n.id IS NULL OR n.deleted_at IS NULL)
  AND (${CARD_TOPIC} IS NULL OR ${CARD_TOPIC} IN (SELECT id FROM topics WHERE user_id = c.user_id AND deleted_at IS NULL))`;

/** The topic of a note (annotations and reviews of a book take the book's). */
export const NOTE_FROM = `notes n LEFT JOIN readings r ON r.id = n.reading_id`;
export const NOTE_TOPIC = 'COALESCE(n.topic_id, r.topic_id)';
export const NOTE_LIVE = `n.deleted_at IS NULL AND (${NOTE_TOPIC} IS NULL OR ${NOTE_TOPIC} IN (SELECT id FROM topics WHERE user_id = n.user_id AND deleted_at IS NULL))`;

/** Counts for the selection screen: what the selection covers and what is due. */
export async function scopeInfo(db: D1Database, userId: string, topicIds: string[] | undefined): Promise<ReviewScopeInfo> {
  const s = scopeOf(userId, topicIds);
  const now = nowIso();
  const row = await first(
    db,
    `${s.cte}SELECT
       (SELECT COUNT(*) FROM topics t WHERE t.user_id = ? AND t.deleted_at IS NULL AND ${s.has('t.id')}) AS topics,
       (SELECT COUNT(*) FROM ${NOTE_FROM} WHERE n.user_id = ? AND ${NOTE_LIVE} AND n.role = 'note' AND ${s.has(NOTE_TOPIC)}) AS notes,
       (SELECT COUNT(*) FROM ${NOTE_FROM} WHERE n.user_id = ? AND ${NOTE_LIVE} AND n.role <> 'note' AND ${s.has(NOTE_TOPIC)}) AS annotations,
       (SELECT COUNT(*) FROM concepts k WHERE k.user_id = ? AND ${s.has('k.topic_id')}
          AND (k.topic_id IS NULL OR k.topic_id IN (SELECT id FROM topics WHERE user_id = k.user_id AND deleted_at IS NULL))) AS concepts,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE c.user_id = ? AND c.status = 'active' AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}) AS cards,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE c.user_id = ? AND c.status = 'active' AND c.phase > 0 AND c.due <= ? AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}) AS due,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE c.user_id = ? AND c.status = 'active' AND c.phase = 0 AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}) AS new,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE c.user_id = ? AND c.status = 'suspended' AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}) AS suspended,
       (SELECT COUNT(*) FROM review_proposals p WHERE p.user_id = ? AND ${s.has('p.topic_id')}) AS proposals`,
    ...s.binds,
    userId,
    userId,
    userId,
    userId,
    userId,
    userId,
    now,
    userId,
    userId,
    userId,
  );
  return {
    topics: num(row?.topics),
    notes: num(row?.notes),
    annotations: num(row?.annotations),
    concepts: num(row?.concepts),
    cards: num(row?.cards),
    due: num(row?.due),
    new: num(row?.new),
    suspended: num(row?.suspended),
    proposals: num(row?.proposals),
  };
}
