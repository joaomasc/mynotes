import { z } from 'zod';
import {
  ANSWER_MAX,
  CARD_BACK_MAX,
  CARD_FRONT_MAX,
  CARD_KINDS,
  CARD_ORIGINS,
  CARD_STATUSES,
  GENERATED_KINDS,
  KEY_POINTS_MAX,
  KEY_POINT_MAX,
  REVIEW_MODES,
  SOURCE_QUOTE_MAX,
} from '../review/cards';
import { DEFAULT_RETENTION } from '../review/schedule';
import { zDate, zDateTime, zId, zVersion } from './common';

/* ------------------------------------------------------------ settings -- */

export const zReviewScopePreset = z.object({
  id: zId,
  name: z.string().trim().min(1, 'Dê um nome à seleção').max(80),
  topicIds: z.array(zId).min(1).max(50),
});
export type ReviewScopePreset = z.infer<typeof zReviewScopePreset>;

/** Review settings (settings key "review"). */
export const zReviewSettings = z.object({
  /** Chance of remembering when an item comes back. */
  desiredRetention: z.number().min(0.8).max(0.97).default(DEFAULT_RETENTION),
  /** New items introduced per day (the rest wait). */
  newPerDay: z.number().int().min(0).max(200).default(20),
  /** Items in a session. */
  sessionSize: z.number().int().min(5).max(200).default(20),
  /** Ask "how sure are you?" before showing the answer. */
  askConfidence: z.boolean().default(true),
  reminder: z
    .object({
      enabled: z.boolean().default(false),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido').default('08:00'),
      /** Minutes east of UTC of the device that set it (Brasília: -180). */
      tzOffsetMinutes: z.number().int().min(-840).max(840).default(-180),
    })
    .default({ enabled: false, time: '08:00', tzOffsetMinutes: -180 }),
  /** Named selections of topics. */
  scopes: z.array(zReviewScopePreset).max(30).default([]),
  /** The last selection (comes back the next time). */
  lastTopicIds: z.array(zId).max(50).default([]),
});
export type ReviewSettings = z.infer<typeof zReviewSettings>;

/* --------------------------------------------------------------- cards -- */

const zKeyPoints = z.array(z.string().trim().min(1).max(KEY_POINT_MAX)).max(KEY_POINTS_MAX);

export const zSchedulingState = z.object({
  phase: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  due: zDateTime,
  stability: z.number(),
  difficulty: z.number(),
  scheduledDays: z.number().int(),
  learningSteps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReview: zDateTime.nullable(),
});

export const zReviewCard = z.object({
  id: zId,
  kind: z.enum(CARD_KINDS),
  status: z.enum(CARD_STATUSES),
  origin: z.enum(CARD_ORIGINS),
  /** Cards created together (cloze numbers, the reverse of a card): one per session. */
  groupId: zId,
  /** The topic it belongs to: the note's (or the book's, for annotations), or its own. */
  topicId: zId.nullable(),
  topicTitle: z.string().nullable(),
  noteId: zId.nullable(),
  noteTitle: z.string().nullable(),
  front: z.string(),
  back: z.string(),
  /** Cloze cards: which blank this card hides. */
  clozeIndex: z.number().int().nullable(),
  keyPoints: z.array(z.string()),
  sourceQuote: z.string(),
  /** The quoted passage is no longer in the note. */
  sourceChanged: z.boolean(),
  /** Lapsed many times. */
  leech: z.boolean(),
  schedule: zSchedulingState,
  version: zVersion,
  createdAt: zDateTime,
  updatedAt: zDateTime,
});
export type ReviewCard = z.infer<typeof zReviewCard>;

export const zReviewCardCreate = z
  .object({
    id: zId.optional(),
    kind: z.enum(CARD_KINDS),
    front: z.string().trim().min(1, 'Escreva a pergunta').max(CARD_FRONT_MAX),
    back: z.string().trim().max(CARD_BACK_MAX).default(''),
    keyPoints: zKeyPoints.default([]),
    /** Needed without a note (with a note, the note's topic is used). */
    topicId: zId.nullable().default(null),
    noteId: zId.nullable().default(null),
    sourceQuote: z.string().trim().max(SOURCE_QUOTE_MAX).default(''),
    /** Also create the reverse card (back → front). Basic cards only. */
    reverse: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'cloze' && v.kind !== 'essay' && v.kind !== 'open' && !v.back) {
      ctx.addIssue({ code: 'custom', path: ['back'], message: 'Escreva a resposta' });
    }
    if ((v.kind === 'open' || v.kind === 'essay') && v.keyPoints.length === 0 && !v.back) {
      ctx.addIssue({ code: 'custom', path: ['keyPoints'], message: 'Liste o que uma boa resposta precisa ter (ou escreva uma resposta modelo)' });
    }
  });
export type ReviewCardCreate = z.input<typeof zReviewCardCreate>;

export const zReviewCardUpdate = z.object({
  baseVersion: zVersion,
  front: z.string().trim().min(1).max(CARD_FRONT_MAX).optional(),
  back: z.string().trim().max(CARD_BACK_MAX).optional(),
  keyPoints: zKeyPoints.optional(),
  topicId: zId.nullable().optional(),
  status: z.enum(CARD_STATUSES).optional(),
  /** Back to "new": forgets the schedule. */
  reset: z.boolean().optional(),
});
export type ReviewCardUpdate = z.input<typeof zReviewCardUpdate>;

/** Comma-separated ids (up to 50). */
export const zIdList = z
  .string()
  .max(50 * 37)
  .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
  .pipe(z.array(zId).max(50));
/** Comma-separated topic ids (each one with its descendants). */
export const zTopicIdList = zIdList;

export const zReviewCardListQuery = z.object({
  topicIds: zTopicIdList.optional(),
  noteId: zId.optional(),
  kind: z.enum(CARD_KINDS).optional(),
  status: z.enum([...CARD_STATUSES, 'leech']).optional(),
  q: z.string().trim().max(200).optional(),
});

export const zReviewQueueQuery = z.object({
  topicIds: zTopicIdList.optional(),
  /** Only the cards of these notes ("Revisar agora" from the memory graph). */
  noteIds: zIdList.optional(),
  mode: z.enum(REVIEW_MODES).default('due'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Local date (new items per day count local days). */
  today: zDate,
});

export const zReviewQueue = z.object({
  cards: z.array(zReviewCard),
  /** Due now in the selection (all of them, not only the ones in `cards`). */
  dueCount: z.number().int(),
  /** Never reviewed, in the selection. */
  newCount: z.number().int(),
  /** New items still allowed today. */
  newLeftToday: z.number().int(),
});
export type ReviewQueue = z.infer<typeof zReviewQueue>;

/* ---------------------------------------------------------- evaluation -- */

export const zReviewEvaluation = z.object({
  points: z.array(z.object({ point: z.string(), status: z.enum(['covered', 'partial', 'missing']), evidence: z.string() })),
  /** What the answer said that contradicts the notes. */
  errors: z.array(z.object({ claim: z.string(), correction: z.string() })),
  /** When the AI thinks the note itself may be wrong or incomplete (never counts against the answer). */
  noteIssue: z.string().nullable(),
  modelAnswer: z.string(),
  feedback: z.string(),
  score: z.number().int().min(0).max(100),
  suggestedRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  model: z.string(),
  evaluatedAt: zDateTime,
});
export type ReviewEvaluation = z.infer<typeof zReviewEvaluation>;

export const zReviewEvaluate = z.object({
  answer: z.string().trim().min(1, 'Escreva a sua resposta').max(ANSWER_MAX),
  /** The question as it was asked, when the AI rephrased it. */
  prompt: z.string().trim().max(CARD_FRONT_MAX).optional(),
});

export const zReviewAnswer = z.object({
  /** Client-generated: a retried request never counts twice. */
  id: zId,
  sessionId: zId.nullable().default(null),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
  answer: z.string().max(ANSWER_MAX).default(''),
  /** The question as asked (an AI rephrasing), when different from the card. */
  prompt: z.string().max(CARD_FRONT_MAX).default(''),
  score: z.number().int().min(0).max(100).nullable().default(null),
  evaluation: zReviewEvaluation.nullable().default(null),
  /** The user disagreed with the suggested rating. */
  disputed: z.boolean().default(false),
  /** When it was answered, for answers sent later (offline). Defaults to now. */
  reviewedAt: zDateTime.optional(),
  /** Local date of the answer. */
  localDay: zDate,
});
export type ReviewAnswer = z.input<typeof zReviewAnswer>;

export const zReviewLog = z.object({
  id: zId,
  cardId: zId,
  sessionId: zId.nullable(),
  rating: z.number().int(),
  confidence: z.number().int().nullable(),
  phaseBefore: z.number().int(),
  elapsedDays: z.number(),
  scheduledDays: z.number().int(),
  durationMs: z.number().int(),
  answer: z.string(),
  prompt: z.string(),
  score: z.number().int().nullable(),
  evaluation: zReviewEvaluation.nullable(),
  disputed: z.boolean(),
  reviewedAt: zDateTime,
  localDay: zDate,
});
export type ReviewLog = z.infer<typeof zReviewLog>;

export const zReviewAnswerResult = z.object({ card: zReviewCard, log: zReviewLog });
export type ReviewAnswerResult = z.infer<typeof zReviewAnswerResult>;

/* ------------------------------------------------------------ sessions -- */

export const zReviewSessionCreate = z.object({
  id: zId,
  mode: z.enum(REVIEW_MODES),
  topicIds: z.array(zId).max(50).default([]),
  localDay: zDate,
});
export type ReviewSessionCreate = z.input<typeof zReviewSessionCreate>;

export const zReviewSessionFinish = z.object({
  /** Time spent (counts in Estudo when it is at least a minute). */
  seconds: z.number().int().min(0).max(24 * 3600),
});

export const zReviewSession = z.object({
  id: zId,
  mode: z.enum(REVIEW_MODES),
  topicIds: z.array(zId),
  localDay: zDate,
  startedAt: zDateTime,
  finishedAt: zDateTime.nullable(),
  seconds: z.number().int(),
  reviewed: z.number().int(),
  correct: z.number().int(),
  studySessionId: zId.nullable(),
});
export type ReviewSession = z.infer<typeof zReviewSession>;

export const zReviewSessionSummary = z.object({
  session: zReviewSession,
  /** Distinct items answered. */
  items: z.number().int(),
  /** Items right on the first try. */
  firstTry: z.number().int(),
  confidentErrors: z.array(z.object({ cardId: zId, front: z.string() })),
  byTopic: z.array(z.object({ topicId: zId.nullable(), title: z.string(), reviewed: z.number().int(), correct: z.number().int() })),
  recalls: z.array(z.object({ id: zId, topicTitle: z.string(), coverage: z.number().int().nullable() })),
  /** When the next item of the selection is due. */
  nextDue: zDateTime.nullable(),
});
export type ReviewSessionSummary = z.infer<typeof zReviewSessionSummary>;

/* --------------------------------------------------------------- scope -- */

export const zReviewScopeQuery = z.object({ topicIds: zTopicIdList.optional(), today: zDate });

export const zReviewScopeInfo = z.object({
  topics: z.number().int(),
  notes: z.number().int(),
  annotations: z.number().int(),
  concepts: z.number().int(),
  cards: z.number().int(),
  due: z.number().int(),
  new: z.number().int(),
  suspended: z.number().int(),
  proposals: z.number().int(),
});
export type ReviewScopeInfo = z.infer<typeof zReviewScopeInfo>;

/* ------------------------------------------------------- AI questions -- */

export const zReviewGenerate = z
  .object({
    topicIds: z.array(zId).max(50).default([]),
    /** Only this note. */
    noteId: zId.nullable().default(null),
    kinds: z.array(z.enum(GENERATED_KINDS)).min(1, 'Escolha ao menos um tipo').max(GENERATED_KINDS.length),
    count: z.number().int().min(3).max(15).default(8),
    /** connections: questions about the links between notes and concepts (graph relations). */
    focus: z.enum(['notes', 'connections']).default('notes'),
  })
  .refine((v) => v.noteId || v.topicIds.length > 0, { message: 'Escolha os assuntos ou uma nota', path: ['topicIds'] });
export type ReviewGenerate = z.input<typeof zReviewGenerate>;

export const zReviewProposal = z.object({
  id: zId,
  batchId: zId,
  kind: z.enum(CARD_KINDS),
  origin: z.enum(CARD_ORIGINS),
  front: z.string(),
  back: z.string(),
  keyPoints: z.array(z.string()),
  sourceQuote: z.string(),
  noteId: zId.nullable(),
  noteTitle: z.string().nullable(),
  topicId: zId.nullable(),
  createdAt: zDateTime,
});
export type ReviewProposal = z.infer<typeof zReviewProposal>;

export const zReviewGenerateResult = z.object({
  batchId: zId,
  proposals: z.array(zReviewProposal),
  /** Questions the AI wrote that were dropped (passage not found in the note, repeated or incomplete). */
  discarded: z.number().int(),
  /** Notes read for this batch. */
  notesRead: z.number().int(),
});
export type ReviewGenerateResult = z.infer<typeof zReviewGenerateResult>;

export const zReviewProposalDecision = z.object({
  accept: z
    .array(
      z.object({
        id: zId,
        front: z.string().trim().min(1).max(CARD_FRONT_MAX).optional(),
        back: z.string().trim().max(CARD_BACK_MAX).optional(),
        keyPoints: zKeyPoints.optional(),
      }),
    )
    .max(100)
    .default([]),
  discard: z.array(zId).max(200).default([]),
});
export type ReviewProposalDecision = z.input<typeof zReviewProposalDecision>;

export const zReviewProposalDecisionResult = z.object({ created: z.array(zReviewCard), discarded: z.number().int() });

/* --------------------------------------------------------- free recall -- */

export const zRecallEvaluation = z.object({
  ideas: z.array(
    z.object({
      idea: z.string(),
      status: z.enum(['covered', 'partial', 'missing']),
      noteId: zId.nullable(),
      noteTitle: z.string().nullable(),
      quote: z.string(),
      evidence: z.string(),
    }),
  ),
  errors: z.array(z.object({ claim: z.string(), correction: z.string(), noteId: zId.nullable() })),
  coverage: z.number().int().min(0).max(100),
  summary: z.string(),
  model: z.string(),
  evaluatedAt: zDateTime,
});
export type RecallEvaluation = z.infer<typeof zRecallEvaluation>;

export const zReviewRecallCreate = z.object({
  id: zId,
  topicId: zId,
  sessionId: zId.nullable().default(null),
  text: z.string().trim().min(20, 'Escreva um pouco mais do que você lembra').max(ANSWER_MAX),
  localDay: zDate,
});
export type ReviewRecallCreate = z.input<typeof zReviewRecallCreate>;

export const zReviewRecall = z.object({
  id: zId,
  topicId: zId.nullable(),
  topicTitle: z.string(),
  sessionId: zId.nullable(),
  text: z.string(),
  evaluation: zRecallEvaluation.nullable(),
  coverage: z.number().int().nullable(),
  localDay: zDate,
  createdAt: zDateTime,
});
export type ReviewRecall = z.infer<typeof zReviewRecall>;

/* ------------------------------------------------- help and variants -- */

export const zReviewHelp = z.object({
  /** Why it is hard to remember, in a sentence. */
  diagnosis: z.string(),
  rewrite: z.object({ front: z.string(), back: z.string() }).nullable(),
  split: z.array(z.object({ front: z.string(), back: z.string() })),
  mnemonic: z.string().nullable(),
});
export type ReviewHelp = z.infer<typeof zReviewHelp>;

export const zReviewVariantsRequest = z.object({ cardIds: z.array(zId).min(1).max(20) });
export const zReviewVariants = z.object({ variants: z.array(z.object({ cardId: zId, prompt: z.string() })) });
export type ReviewVariants = z.infer<typeof zReviewVariants>;

/* -------------------------------------------------------------- memory -- */

/** Cards as [noteId, topicId, readingId, phase, stability, lastReview, due] (see review/memory.ts). */
export const zReviewMemory = z.object({
  cards: z.array(z.tuple([zId.nullable(), zId.nullable(), zId.nullable(), z.number().int(), z.number(), zDateTime.nullable(), zDateTime])),
});
export type ReviewMemory = z.infer<typeof zReviewMemory>;

/* --------------------------------------------------------------- stats -- */

export const zReviewSummary = z.object({
  today: zDate,
  due: z.number().int(),
  newAvailable: z.number().int(),
  reviewedToday: z.number().int(),
  streak: z.number().int(),
  proposals: z.number().int(),
  leeches: z.number().int(),
  total: z.number().int(),
});
export type ReviewSummary = z.infer<typeof zReviewSummary>;

export const zReviewStats = z.object({
  today: zDate,
  desiredRetention: z.number(),
  counts: z.object({
    total: z.number().int(),
    new: z.number().int(),
    learning: z.number().int(),
    review: z.number().int(),
    suspended: z.number().int(),
    leeches: z.number().int(),
  }),
  /** Share of reviews of items already learned that were remembered, last 30 days. */
  trueRetention: z.number().nullable(),
  matureReviews30: z.number().int(),
  /** Items due on each of the next 30 days (index 0 = today, including overdue). */
  forecast: z.array(z.object({ day: zDate, count: z.number().int() })),
  /** Reviews per day, last 90 days. */
  history: z.array(z.object({ day: zDate, reviews: z.number().int(), correct: z.number().int() })),
  /** How often each confidence level was right. */
  calibration: z.array(z.object({ confidence: z.number().int(), answers: z.number().int(), correct: z.number().int() })),
  weakTopics: z.array(z.object({ topicId: zId.nullable(), title: z.string(), reviews: z.number().int(), correct: z.number().int(), lapses: z.number().int() })),
  confidentErrors: z.array(z.object({ cardId: zId, front: z.string(), reviewedAt: zDateTime })),
  streak: z.object({ current: z.number().int(), best: z.number().int() }),
});
export type ReviewStats = z.infer<typeof zReviewStats>;
