/** Identifiers of the rubric (docs/oratoria.md), shared by the schemas and the rubric itself. */

export const SPEECH_DIMENSIONS = ['content', 'language', 'voice', 'presence'] as const;
export type SpeechDimension = (typeof SPEECH_DIMENSIONS)[number];

/** Criteria computed from the recording and the transcript, at no cost. */
export const MEASURED_CRITERIA = [
  'time',
  'sentences',
  'fillers',
  'weakWords',
  'repetition',
  'pace',
  'pauses',
  'volume',
  'pitchVariation',
  'finalContour',
  'articulation',
] as const;

/** Criteria judged by the model reading the transcript. */
export const TEXT_AI_CRITERIA = ['opening', 'centralIdea', 'development', 'transitions', 'conclusion', 'correctness', 'precision'] as const;

/** Criteria judged by a model listening to the audio (full evaluation, a later stage). */
export const AUDIO_AI_CRITERIA = ['stability', 'confidence', 'naturalness', 'emphasis', 'energy'] as const;

export const SPEECH_CRITERIA = [...MEASURED_CRITERIA, ...TEXT_AI_CRITERIA, ...AUDIO_AI_CRITERIA] as const;
export type SpeechCriterionId = (typeof SPEECH_CRITERIA)[number];
export type MeasuredCriterionId = (typeof MEASURED_CRITERIA)[number];
export type TextAiCriterionId = (typeof TEXT_AI_CRITERIA)[number];

/** “na”: not enough data to judge (too short, no pitch detected…) or not evaluated. */
export const CRITERION_STATES = ['good', 'attention', 'improve', 'na'] as const;
export type CriterionState = (typeof CRITERION_STATES)[number];

export const SPEECH_TYPES = ['explain', 'persuasive', 'impromptu', 'qa'] as const;
export type SpeechType = (typeof SPEECH_TYPES)[number];

/** free: any theme; explain: explain a topic of the user's notes (content is checked against them). */
export const SPEECH_MODES = ['free', 'explain'] as const;
export type SpeechMode = (typeof SPEECH_MODES)[number];

export const SPEECH_MARK_KINDS = ['filler', 'weak', 'repetition', 'hesitation', 'blank', 'unclear', 'rising', 'drop', 'long'] as const;
export type SpeechMarkKind = (typeof SPEECH_MARK_KINDS)[number];
