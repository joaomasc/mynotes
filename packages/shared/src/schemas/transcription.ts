import { z } from 'zod';
import { DICTATION_AUDIO_MAX_BYTES, DICTATION_PROMPT_MAX } from '../constants';

const BASE64_MAX = Math.ceil(DICTATION_AUDIO_MAX_BYTES / 3) * 4;

/** One dictated segment: base64 WAV (PCM) plus the text written just before it. */
export const zTranscriptionCreate = z.object({
  audio: z.string().min(100).max(BASE64_MAX, 'Trecho de áudio longo demais'),
  prompt: z.string().max(DICTATION_PROMPT_MAX).optional(),
  /** words: also return Whisper's segments (with confidence) and word timings, relative to the audio sent. */
  detail: z.enum(['text', 'words']).default('text'),
});
export type TranscriptionCreate = z.input<typeof zTranscriptionCreate>;

export const zTranscriptionWord = z.object({ text: z.string(), start: z.number(), end: z.number() });
export const zTranscriptionSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  /** Average log-probability of the segment's tokens (closer to 0 = clearer). */
  avgLogprob: z.number().nullable(),
});

export const zTranscription = z.object({
  text: z.string(),
  /** Seconds of audio processed. */
  durationSeconds: z.number().nonnegative(),
  /** Only with detail = words. */
  segments: z.array(zTranscriptionSegment).optional(),
  words: z.array(zTranscriptionWord).optional(),
});
export type Transcription = z.infer<typeof zTranscription>;
