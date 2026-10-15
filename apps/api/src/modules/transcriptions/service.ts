import type { TranscriptionCreate, Transcription } from '@mynotes/shared';
import { ApiError } from '../../lib/errors';

export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

/**
 * Sentences Whisper is known to invent for silence or noise in Portuguese
 * (learned from subtitled videos).
 */
const HALLUCINATIONS = [
  /legendas? (pela|por|da) comunidade/i,
  /amara\.org/i,
  /^transcrição e legendas?\b/i,
  /inscreva-se no canal/i,
  /^obrigad[oa] por assistir/i,
];
/** Invented when a segment is only noise; kept when the user really says it within other text. */
const LONE_HALLUCINATION = /^(obrigad[oa]|tchau(,? tchau)?)[\s.!]*$/i;

/** Removes invented sentences and normalizes whitespace. */
export function cleanTranscript(text: string): string {
  const kept = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => !HALLUCINATIONS.some((re) => re.test(s)))
    .join(' ')
    .trim();
  return LONE_HALLUCINATION.test(kept) ? '' : kept;
}

/** RIFF/WAVE signature, read from the first 12 bytes (16 base64 characters). */
function isWav(base64: string): boolean {
  try {
    const head = atob(base64.slice(0, 16));
    return head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE';
  } catch {
    return false;
  }
}

/** Workers AI reports an exhausted daily allocation with these codes/messages. */
const QUOTA_ERROR = /\b(4006|3036)\b|neurons?|daily free allocation|quota/i;

/** Seconds until 00:00 UTC, when the free Workers AI allocation resets. */
function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

/**
 * Transcribes one dictated segment (Brazilian Portuguese). The audio is
 * passed through as base64 — the Worker never decodes it, keeping CPU time
 * near zero; recognition runs on Workers AI.
 */
export async function transcribe(ai: Ai, input: TranscriptionCreate): Promise<Transcription> {
  if (!isWav(input.audio)) {
    throw new ApiError('unsupported_media_type', 'O áudio deve ser enviado como WAV');
  }
  let result: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output;
  try {
    result = await ai.run(WHISPER_MODEL, {
      audio: input.audio,
      task: 'transcribe',
      language: 'pt',
      // Skips silences: fewer invented sentences.
      vad_filter: true,
      ...(input.prompt?.trim() ? { initial_prompt: input.prompt.trim() } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (QUOTA_ERROR.test(message)) {
      throw new ApiError(
        'rate_limited',
        'A cota diária gratuita de transcrição acabou. Ela renova às 21h (horário de Brasília).',
        undefined,
        { 'Retry-After': String(secondsUntilUtcMidnight()) },
      );
    }
    console.error(JSON.stringify({ level: 'error', msg: 'transcription failed', error: message.slice(0, 300) }));
    throw new ApiError('internal_error', 'Não foi possível transcrever o áudio agora. Tente de novo em instantes.');
  }
  return {
    text: cleanTranscript(result.text ?? ''),
    durationSeconds: result.transcription_info?.duration ?? 0,
  };
}
