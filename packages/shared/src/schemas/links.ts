import { z } from 'zod';
import { RELATION_KINDS } from '../constants';
import { zDateTime, zId } from './common';

/**
 * Suggested links (docs/grafo-memoria.md › Ligações sugeridas): notes and
 * concepts close in meaning that are not linked yet. The user links them
 * (a relation in the graph) or dismisses them for good.
 */

export const LINKABLE_TYPES = ['note', 'concept'] as const;
export type LinkableType = (typeof LINKABLE_TYPES)[number];

/** Kinds the AI may suggest (every relation kind but "references", which comes from citations). */
export const SUGGESTED_KINDS = RELATION_KINDS.filter((k) => k !== 'references');

export const zLinkEnd = z.object({
  type: z.enum(LINKABLE_TYPES),
  id: zId,
  title: z.string(),
  topicId: zId.nullable(),
});
export type LinkEnd = z.infer<typeof zLinkEnd>;

export const zLinkSuggestion = z.object({
  id: zId,
  a: zLinkEnd,
  b: zLinkEnd,
  /** Similarity of meaning (cosine, 0–1). */
  score: z.number(),
  /** Relation the AI suggests (null: not explained yet). */
  kind: z.enum(RELATION_KINDS).nullable(),
  /** ab: a → b (e.g. "a depends on b"); ba: the other way. */
  direction: z.enum(['ab', 'ba']),
  /** Why they connect, in one sentence (empty until explained). */
  reason: z.string(),
  explained: z.boolean(),
  status: z.enum(['open', 'accepted', 'dismissed']),
  createdAt: zDateTime,
});
export type LinkSuggestion = z.infer<typeof zLinkSuggestion>;

export const zLinkSuggestionsQuery = z.object({
  /** One item's suggestions (scanned on the spot when its text changed); without it, the open ones of everything. */
  type: z.enum(LINKABLE_TYPES).optional(),
  id: zId.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const zLinkSuggestionsResult = z.object({
  suggestions: z.array(zLinkSuggestion),
  /** The item is not in the semantic index yet (new or just edited): try again in a minute. */
  pending: z.boolean(),
  /** Semantic search is not available on this server. */
  unavailable: z.boolean(),
});
export type LinkSuggestionsResult = z.infer<typeof zLinkSuggestionsResult>;

export const zLinkExplain = z.object({ ids: z.array(zId).min(1).max(10) });

export const zLinkAccept = z.object({
  kind: z.enum(RELATION_KINDS).optional(),
  direction: z.enum(['ab', 'ba']).optional(),
  label: z.string().trim().max(200).default(''),
});
export type LinkAccept = z.input<typeof zLinkAccept>;

export const zLinkScanResult = z.object({ scanned: z.number().int(), found: z.number().int(), more: z.boolean() });
