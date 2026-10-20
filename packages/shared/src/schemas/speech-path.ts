import { z } from 'zod';
import { PRACTICE_KINDS } from '../speech/path';
import { SPEECH_SKILLS } from '../speech/skills';
import { zDate, zId } from './common';

/** Speaking settings (settings key “speech”): daily goal and the calibrated limits. */
export const zSpeechSettings = z.object({
  dailyGoalMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).default(10),
  /** Overrides of the rubric's reference ranges (null = default). */
  limits: z
    .object({
      paceMin: z.number().int().min(80).max(200).nullable().default(null),
      paceMax: z.number().int().min(100).max(240).nullable().default(null),
      pvqGood: z.number().min(0.05).max(0.4).nullable().default(null),
      finalDropDb: z.number().min(2).max(15).nullable().default(null),
    })
    .default({ paceMin: null, paceMax: null, pvqGood: null, finalDropDb: null }),
});
export type SpeechSettings = z.infer<typeof zSpeechSettings>;

/** One practice: a finished lesson, challenge, review, warm-up or talk. */
export const zSpeechPracticeCreate = z.object({
  /** Client-generated: a retried request never counts twice. */
  id: zId,
  kind: z.enum(PRACTICE_KINDS),
  /** Lesson or challenge id; the skill for a review. */
  refId: z.string().max(64).nullable().default(null),
  localDay: zDate,
  /** Time spent, for the daily goal. */
  seconds: z.number().int().min(0).max(3600),
  /** Whether each exercise was passed (lessons, reviews, warm-ups). */
  results: z.array(z.boolean()).max(30).default([]),
  /** The talk recorded in it (challenges, daily and free talks): the server checks its goals itself. */
  attemptId: zId.nullable().default(null),
});
export type SpeechPracticeCreate = z.input<typeof zSpeechPracticeCreate>;

export const zSkillState = z.object({
  skill: z.enum(SPEECH_SKILLS),
  xp: z.number().int(),
  level: z.number().int().min(0).max(5),
  lastPracticedOn: zDate.nullable(),
  nextReviewOn: zDate.nullable(),
});

/** A theme from the user's notes, for talks that explain what they study. */
export const zNoteTopic = z.object({
  noteId: zId,
  title: z.string(),
  topicId: zId.nullable(),
});
export type NoteTopic = z.infer<typeof zNoteTopic>;

export const zSpeechPathState = z.object({
  today: zDate,
  completed: z.array(z.string()),
  skills: z.array(zSkillState),
  totalXp: z.number().int(),
  todayXp: z.number().int(),
  todaySeconds: z.number().int(),
  streak: z.object({ current: z.number().int(), best: z.number().int(), todayDone: z.boolean(), frozen: z.array(zDate) }),
  /** XP per day, last 7 days (oldest first). */
  week: z.array(z.object({ day: zDate, xp: z.number().int() })),
  /** Theme of today's talk: from the notes on some days, general on others. */
  daily: z.object({ text: z.string(), note: zNoteTopic.nullable() }),
  /** A note to explain, for lessons whose theme comes from the notes (null: no notes yet). */
  noteTopic: zNoteTopic.nullable(),
  warmupDone: z.boolean(),
  dailyDone: z.boolean(),
  settings: zSpeechSettings,
});
export type SpeechPathState = z.infer<typeof zSpeechPathState>;

export const zSpeechPracticeResult = z.object({
  xp: z.number().int(),
  passed: z.boolean(),
  /** Whether this practice completed the lesson or challenge (first time). */
  completedNow: z.boolean(),
  state: zSpeechPathState,
});
export type SpeechPracticeResult = z.infer<typeof zSpeechPracticeResult>;

/** The model's feedback on a written exercise (fix a sentence, build a part of a talk). */
export const zSpeechFeedbackRequest = z.object({
  kind: z.enum(['fix', 'build']),
  instruction: z.string().max(1000),
  /** The weak sentence (fix) or the part being written (build). */
  context: z.string().max(1000),
  answer: z.string().trim().min(1, 'Escreva a sua resposta').max(2000),
  method: z.string().max(20).nullable().default(null),
});
export type SpeechFeedbackRequest = z.input<typeof zSpeechFeedbackRequest>;

export const zSpeechFeedback = z.object({
  verdict: z.enum(['good', 'almost', 'redo']),
  feedback: z.string(),
  suggestion: z.string(),
});
export type SpeechFeedback = z.infer<typeof zSpeechFeedback>;

/** An extra review exercise written by the model (same shape as the path's exercises). */
export const zVariantExercise = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fix'), instruction: z.string().max(500), sentence: z.string().max(500), sample: z.string().max(500), focus: z.enum(SPEECH_SKILLS) }),
  z.object({
    type: z.literal('recognize'),
    prompt: z.string().max(500),
    options: z.array(z.string().max(300)).min(2).max(4),
    answer: z.number().int().min(0).max(3),
    explanation: z.string().max(800),
  }),
  z.object({ type: z.literal('readAloud'), instruction: z.string().max(500), text: z.string().max(500) }),
]);
export type VariantExercise = z.infer<typeof zVariantExercise>;

export const zSpeechVariantsQuery = z.object({ skill: z.enum(SPEECH_SKILLS) });
