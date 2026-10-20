/**
 * Reference ranges of the speaking rubric (docs/oratoria.md). Starting points,
 * not laws: the calibration step will let the user override them, so every
 * threshold lives here instead of inside the metrics or the rubric.
 */
export interface SpeechLimits {
  /** Words per minute considered comfortable for exposition. */
  paceGood: [min: number, max: number];
  /** Outside this range the pace needs work. */
  paceAttention: [min: number, max: number];
  /** Silences shorter than this are part of speech, not pauses. */
  pauseMinSeconds: number;
  /** A silence this long is a blank. */
  blankSeconds: number;
  /** Hesitation pauses (mid-sentence) per minute. */
  hesitationsGood: number;
  hesitationsAttention: number;
  fillersGood: number;
  fillersAttention: number;
  weakWordsGood: number;
  weakWordsAttention: number;
  /** Extra repetitions of the same content word per minute. */
  repetitionGood: number;
  repetitionAttention: number;
  /** Average words per sentence. */
  sentenceGood: number;
  sentenceAttention: number;
  /** A sentence longer than this is flagged on its own. */
  sentenceLong: number;
  /** Loudness lost in the last part of a sentence, in dB. */
  finalDropDb: number;
  /** Share of sentences that lose loudness at the end. */
  dropShareGood: number;
  dropShareAttention: number;
  /** Pitch variation quotient (sd ÷ mean of F0); below the first value the speech is monotone. */
  pvqGood: number;
  pvqAttention: number;
  /** Pitch slope at the end of a statement, in semitones per second. */
  contourSlope: number;
  /** Share of statements ending with a rising pitch. */
  risingShareGood: number;
  risingShareAttention: number;
  /** Whisper segments below this average log-probability count as unclear. */
  unclearLogprob: number;
  unclearShareGood: number;
  unclearShareAttention: number;
  /** Duration within this fraction of the target is on time. */
  timeGood: number;
  timeAttention: number;
}

export const DEFAULT_SPEECH_LIMITS: SpeechLimits = {
  paceGood: [130, 160],
  paceAttention: [110, 180],
  pauseMinSeconds: 0.25,
  blankSeconds: 3,
  hesitationsGood: 1,
  hesitationsAttention: 3,
  fillersGood: 2,
  fillersAttention: 5,
  weakWordsGood: 1,
  weakWordsAttention: 3,
  repetitionGood: 1,
  repetitionAttention: 3,
  sentenceGood: 20,
  sentenceAttention: 35,
  sentenceLong: 35,
  finalDropDb: 6,
  dropShareGood: 0.2,
  dropShareAttention: 0.4,
  // A study on automatic rating of presentations separated monotone from dynamic speech at 0.16.
  pvqGood: 0.16,
  pvqAttention: 0.11,
  contourSlope: 3,
  risingShareGood: 0.25,
  risingShareAttention: 0.45,
  unclearLogprob: -0.7,
  unclearShareGood: 0.1,
  unclearShareAttention: 0.25,
  timeGood: 0.1,
  timeAttention: 0.25,
};
