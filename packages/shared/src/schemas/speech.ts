import { z } from 'zod';
import { SPEECH_MAX_SECONDS, SPEECH_TIMELINE_STEP } from '../constants';
import {
  CRITERION_STATES,
  SPEECH_CRITERIA,
  SPEECH_MARK_KINDS,
  SPEECH_MODES,
  SPEECH_TYPES,
  TEXT_AI_CRITERIA,
} from '../speech/criteria';
import { zDate, zDateTime, zId, zVersion } from './common';

const seconds = z.number().min(0).max(SPEECH_MAX_SECONDS + 60);
const ratio = z.number().min(0).max(1);
const count = z.number().int().min(0);
const rate = z.number().min(0).max(10_000);
const TIMELINE_MAX = Math.ceil((SPEECH_MAX_SECONDS + 60) / SPEECH_TIMELINE_STEP);

/** A transcribed word, with times in seconds from the start of the recording. */
export const zSpeechWord = z.object({ text: z.string().max(100), start: seconds, end: seconds });
export type SpeechWord = z.infer<typeof zSpeechWord>;

/** A Whisper segment: its text and how confident the recognition was. */
export const zSpeechSegment = z.object({
  start: seconds,
  end: seconds,
  text: z.string().max(2000),
  avgLogprob: z.number().min(-100).max(0).nullable(),
});
export type SpeechSegment = z.infer<typeof zSpeechSegment>;

/**
 * Loudness and pitch every SPEECH_TIMELINE_STEP seconds, for the charts.
 * `db`: dBFS rounded (relative to the microphone), null when silent;
 * `f0`: pitch in Hz rounded, null when unvoiced.
 */
export const zSpeechTimeline = z.object({
  step: z.literal(SPEECH_TIMELINE_STEP),
  db: z.array(z.number().int().min(-120).max(0).nullable()).max(TIMELINE_MAX),
  f0: z.array(z.number().int().min(40).max(600).nullable()).max(TIMELINE_MAX),
});
export type SpeechTimeline = z.infer<typeof zSpeechTimeline>;

export const zSpeechMark = z.object({
  kind: z.enum(SPEECH_MARK_KINDS),
  start: seconds,
  end: seconds,
  /** The words involved (or the duration, for pauses). */
  text: z.string().max(300),
});
export type SpeechMark = z.infer<typeof zSpeechMark>;

const zTop = z.array(z.object({ text: z.string().max(60), count })).max(10);

/** Everything measured in a talk (computed in the browser, see speech/metrics.ts). */
export const zSpeechMetrics = z.object({
  durationSeconds: seconds,
  speakingSeconds: seconds,
  wordCount: count,
  pace: z.object({
    wpm: rate,
    articulationWpm: rate,
    windows: z.array(z.object({ start: seconds, wpm: rate })).max(100),
  }),
  pauses: z.object({ betweenIdeas: count, hesitations: count, blanks: count, longest: seconds }),
  fillers: z.object({ count, perMinute: rate, top: zTop }),
  weakWords: z.object({ count, perMinute: rate, top: zTop }),
  repetition: z.object({ count, perMinute: rate, words: z.array(z.string().max(60)).max(20) }),
  sentences: z.object({ count, avgWords: rate, longCount: count }),
  volume: z.object({ meanDb: z.number().min(-120).max(0).nullable(), sdDb: z.number().min(0).max(120).nullable(), measured: count, dropped: count }),
  pitch: z.object({
    pvq: z.number().min(0).max(5).nullable(),
    sdSemitones: z.number().min(0).max(48).nullable(),
    meanHz: z.number().min(0).max(600).nullable(),
    validFrames: count,
    windows: z.array(z.object({ start: seconds, pvq: z.number().min(0).max(5) })).max(200),
  }),
  finalContour: z.object({ measured: count, rising: count, falling: count, flat: count }),
  articulation: z.object({ unclearSeconds: seconds, unclearShare: ratio.nullable() }),
  targetSeconds: z.number().int().min(15).max(SPEECH_MAX_SECONDS).nullable(),
  marks: z.array(zSpeechMark).max(2000),
});
export type SpeechMetrics = z.infer<typeof zSpeechMetrics>;

/** One criterion of the rubric with its state and the number behind it. */
export const zCriterionResult = z.object({
  id: z.enum(SPEECH_CRITERIA),
  state: z.enum(CRITERION_STATES),
  /** What was found (“148 palavras/min”, or the model's evidence). */
  value: z.string().max(2000),
  /** The reference used (“130 a 160”). */
  reference: z.string().max(300),
  source: z.enum(['measured', 'textAi', 'audioAi']),
  /** Original sentence and a better version (model criteria only). */
  original: z.string().max(2000).nullable(),
  rewrite: z.string().max(2000).nullable(),
});
export type CriterionResult = z.infer<typeof zCriterionResult>;

export const zSpeechImprovement = z.object({
  title: z.string().max(200),
  detail: z.string().max(2000),
  original: z.string().max(2000).nullable(),
  rewrite: z.string().max(2000).nullable(),
});
export type SpeechImprovement = z.infer<typeof zSpeechImprovement>;

/** The model's reading of the transcript. */
export const zSpeechEvaluation = z.object({
  criteria: z.array(zCriterionResult.extend({ id: z.enum(TEXT_AI_CRITERIA) })).max(TEXT_AI_CRITERIA.length),
  improvements: z.array(zSpeechImprovement).max(3),
  exercise: z.string().max(2000),
  summary: z.string().max(2000),
  model: z.string().max(100),
  evaluatedAt: zDateTime,
});
export type SpeechEvaluation = z.infer<typeof zSpeechEvaluation>;

export const zSpeechAttemptCreate = z.object({
  /** Client-generated (UUID v7), so a retried save never duplicates the talk. */
  id: zId,
  mode: z.enum(SPEECH_MODES),
  speechType: z.enum(SPEECH_TYPES),
  topicId: zId.nullable().default(null),
  theme: z.string().trim().max(300).default(''),
  /** The lesson or challenge it was recorded in (null: free practice). */
  lessonId: z.string().max(64).nullable().default(null),
  /** For an answer to the board: the talk the question was about. */
  parentId: zId.nullable().default(null),
  startedAt: zDateTime,
  /** Calendar day in the user's time zone (streaks are counted on it). */
  localDay: zDate,
  transcript: z.string().max(40_000),
  words: z.array(zSpeechWord).max(5000),
  segments: z.array(zSpeechSegment).max(2000),
  timeline: zSpeechTimeline,
  metrics: zSpeechMetrics,
});
export type SpeechAttemptCreate = z.infer<typeof zSpeechAttemptCreate>;

export const zSpeechAttemptSummary = z.object({
  id: zId,
  mode: z.enum(SPEECH_MODES),
  speechType: z.enum(SPEECH_TYPES),
  topicId: zId.nullable(),
  theme: z.string(),
  startedAt: zDateTime,
  localDay: zDate,
  durationSeconds: z.number(),
  score: z.number().int().min(0).max(100).nullable(),
  evaluated: z.boolean(),
  wpm: z.number(),
  fillersPerMinute: z.number(),
  pvq: z.number().nullable(),
  lessonId: z.string().nullable(),
  parentId: zId.nullable(),
  createdAt: zDateTime,
});
export type SpeechAttemptSummary = z.infer<typeof zSpeechAttemptSummary>;

export const zSpeechAttempt = zSpeechAttemptSummary.extend({
  transcript: z.string(),
  words: z.array(zSpeechWord),
  segments: z.array(zSpeechSegment),
  timeline: zSpeechTimeline,
  metrics: zSpeechMetrics,
  /** Measured criteria, recomputed by the server from the metrics. */
  measured: z.array(zCriterionResult),
  evaluation: zSpeechEvaluation.nullable(),
  /** Questions the board asked about this talk. */
  questions: z.array(z.string()).nullable(),
  rubricVersion: z.number().int(),
  version: zVersion,
  updatedAt: zDateTime,
});
export type SpeechAttempt = z.infer<typeof zSpeechAttempt>;

export const zSpeechEvaluate = z.object({
  /** Evaluate again even if there is already an evaluation. */
  force: z.boolean().default(false),
});
export type SpeechEvaluate = z.infer<typeof zSpeechEvaluate>;

export const zSpeechListQuery = z.object({ topicId: zId.optional() });

export const zSpeechQuestionsRequest = z.object({
  /** Ask new questions even if the board already asked some. */
  force: z.boolean().default(false),
});
