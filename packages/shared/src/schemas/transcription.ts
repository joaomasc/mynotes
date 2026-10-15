import { z } from 'zod';
import { DICTATION_AUDIO_MAX_BYTES, DICTATION_PROMPT_MAX } from '../constants';

const BASE64_MAX = Math.ceil(DICTATION_AUDIO_MAX_BYTES / 3) * 4;

/** One dictated segment: base64 WAV (PCM) plus the text written just before it. */
export const zTranscriptionCreate = z.object({
  audio: z.string().min(100).max(BASE64_MAX, 'Trecho de áudio longo demais'),
  prompt: z.string().max(DICTATION_PROMPT_MAX).optional(),
});
export type TranscriptionCreate = z.infer<typeof zTranscriptionCreate>;

export const zTranscription = z.object({
  text: z.string(),
  /** Seconds of audio processed. */
  durationSeconds: z.number().nonnegative(),
});
export type Transcription = z.infer<typeof zTranscription>;
