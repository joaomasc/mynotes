import { z } from 'zod';
import {
  AUDIO_AI_CRITERIA,
  CRITERIA_INFO,
  SPEECH_AUDIO_MAX_BYTES,
  SPEECH_AUDIO_RATE,
  SPEECH_EXCERPT_SECONDS,
  SPEECH_TYPE_LABELS,
  speechScore,
  zSpeechFullEvaluation,
  type CriterionResult,
  type SpeechAttempt,
} from '@mynotes/shared';
import { randomToken } from '../../lib/crypto';
import { ApiError, badRequest, notFound, tooLarge } from '../../lib/errors';
import { run, str } from '../../lib/db';
import { nowIso } from '../../lib/time';
import { aiConfig, requireReady } from '../assistant/config';
import { createChatCompletion } from '../assistant/openai';
import { assertWithinBudget, usageStatement } from '../assistant/usage';
import { attemptRow, getAttempt, toAttempt } from './service';

/**
 * Kept recordings (8 kHz mono 16-bit WAV in R2) and the full evaluation: a
 * model listening to the opening and the closing of the talk judges presence
 * and the voice itself (docs/oratoria-tecnico.md › Avaliação completa).
 */

const HEADER = 44;
const BYTES_PER_SECOND = SPEECH_AUDIO_RATE * 2;

/** Checks the canonical header the app writes: PCM, mono, 8 kHz, 16 bits, data at byte 36. */
export function isAppWav(head: Uint8Array): boolean {
  if (head.length < HEADER) return false;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const ascii = (o: number, s: string) => [...s].every((ch, i) => head[o + i] === ch.charCodeAt(0));
  return (
    ascii(0, 'RIFF') &&
    ascii(8, 'WAVE') &&
    ascii(12, 'fmt ') &&
    v.getUint16(20, true) === 1 &&
    v.getUint16(22, true) === 1 &&
    v.getUint32(24, true) === SPEECH_AUDIO_RATE &&
    v.getUint16(34, true) === 16 &&
    ascii(36, 'data')
  );
}

/** A WAV header for `dataBytes` of 8 kHz mono 16-bit PCM. */
export function wavHeader(dataBytes: number): Uint8Array {
  const h = new Uint8Array(HEADER);
  const v = new DataView(h.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => (h[o + i] = ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SPEECH_AUDIO_RATE, true);
  v.setUint32(28, BYTES_PER_SECOND, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

/** Streams the recording to R2 (never decoded here), then points the talk to it. */
export async function uploadAudio(env: Env, userId: string, id: string, request: Request): Promise<SpeechAttempt> {
  const row = await attemptRow(env.DB, userId, id);
  const length = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (!Number.isFinite(length) || length <= HEADER) throw badRequest('Content-Length obrigatório');
  if (length > SPEECH_AUDIO_MAX_BYTES) throw tooLarge('Gravação longa demais');
  if (!request.body) throw badRequest('Corpo da requisição vazio');

  const key = `speech/${userId}/${randomToken(24)}`;
  const { readable, writable } = new FixedLengthStream(length);
  try {
    await Promise.all([env.FILES.put(key, readable, { httpMetadata: { contentType: 'audio/wav' }, customMetadata: { attemptId: id } }), request.body.pipeTo(writable)]);
  } catch {
    throw badRequest('Falha ao receber a gravação. Tente novamente.');
  }
  const head = await env.FILES.get(key, { range: { offset: 0, length: HEADER } });
  if (!isAppWav(new Uint8Array(head ? await head.arrayBuffer() : new ArrayBuffer(0)))) {
    await env.FILES.delete(key);
    throw new ApiError('unsupported_media_type', 'A gravação deve ser WAV mono de 8 kHz e 16 bits');
  }
  await run(env.DB, 'UPDATE speech_attempts SET audio_key = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?', key, nowIso(), id, userId);
  if (row.audio_key) await env.FILES.delete(str(row.audio_key));
  return getAttempt(env.DB, userId, id);
}

export async function serveAudio(env: Env, userId: string, id: string): Promise<Response> {
  const row = await attemptRow(env.DB, userId, id);
  const obj = row.audio_key ? await env.FILES.get(str(row.audio_key)) : null;
  if (!obj) throw notFound('Gravação');
  return new Response(obj.body, {
    headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(obj.size), 'Cache-Control': 'private, no-store' },
  });
}

/** Base64 of bytes, in slices (no huge argument lists). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The audio the model hears: the whole talk when short, else its first and last SPEECH_EXCERPT_SECONDS. */
export async function excerpt(env: Env, key: string): Promise<{ wav: Uint8Array; heardSeconds: number; totalSeconds: number }> {
  const head = await env.FILES.head(key);
  if (!head) throw notFound('Gravação');
  const dataBytes = head.size - HEADER;
  const totalSeconds = dataBytes / BYTES_PER_SECOND;
  const part = SPEECH_EXCERPT_SECONDS * BYTES_PER_SECOND;
  const ranges = dataBytes <= 2 * part ? [{ offset: HEADER, length: dataBytes }] : [{ offset: HEADER, length: part }, { offset: head.size - part, length: part }];
  const chunks: Uint8Array[] = [];
  for (const r of ranges) {
    const obj = await env.FILES.get(key, { range: r });
    if (!obj) throw notFound('Gravação');
    chunks.push(new Uint8Array(await obj.arrayBuffer()));
  }
  const data = chunks.reduce((n, c) => n + c.length, 0);
  const wav = new Uint8Array(HEADER + data);
  wav.set(wavHeader(data), 0);
  let offset = HEADER;
  for (const c of chunks) {
    wav.set(c, offset);
    offset += c.length;
  }
  return { wav, heardSeconds: data / BYTES_PER_SECOND, totalSeconds };
}

const LISTEN_INSTRUCTIONS = `Você é um professor de oratória que OUVE a gravação de uma fala de um estudante brasileiro.
Em falas longas você ouve só a abertura e a conclusão (os primeiros e os últimos 45 segundos, emendados).
Julgue o que só se percebe ouvindo, com estes critérios:
${AUDIO_AI_CRITERIA.map((id) => `- ${id} (${CRITERIA_INFO[id].label}): ${CRITERIA_INFO[id].good}`).join('\n')}
Para cada critério: "state" é "good", "attention", "improve" ou "na" (não dá para julgar), e "evidence" é uma frase citando o momento (“no início”, “na conclusão”).
Em "remarks", até 3 observações práticas sobre a voz (ritmo, respiração, tom, firmeza), e em "summary" uma ou duas frases para o estudante.
Considere as medições do aplicativo como dados; não as contradiga.
Responda SOMENTE com um objeto JSON neste formato, sem texto antes ou depois:
{"criteria":[{"id":"confidence","state":"good","evidence":"…"}],"remarks":["…"],"summary":"…"}`;

const zListened = z.object({
  criteria: z.array(z.object({ id: z.string(), state: z.enum(['good', 'attention', 'improve', 'na']), evidence: z.string() })),
  remarks: z.array(z.string()).default([]),
  summary: z.string().default(''),
});

/** The JSON object in a model answer (tolerates code fences and stray text around it). */
export function jsonObjectIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The full evaluation: the model listens to the kept recording (opening and
 * closing) and judges presence and the voice. Counts against the daily
 * budget at the audio model's prices.
 */
export async function fullEvaluation(env: Env, userId: string, id: string, input: { force: boolean }): Promise<SpeechAttempt> {
  const db = env.DB;
  const row = await attemptRow(db, userId, id);
  if (row.full_evaluation_json != null && !input.force) return toAttempt(row);
  if (!row.audio_key) throw badRequest('Esta fala não tem a gravação guardada. Ative “guardar o áudio” e grave de novo.');
  const attempt = toAttempt(row);
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(db, userId, cfg, today);

  const audio = await excerpt(env, str(row.audio_key));
  const context = [
    `Tipo de fala: ${SPEECH_TYPE_LABELS[attempt.speechType]}.`,
    attempt.theme ? `Tema: ${attempt.theme}.` : '',
    `Duração total: ${Math.round(audio.totalSeconds)} s; você vai ouvir ${Math.round(audio.heardSeconds)} s${audio.heardSeconds < audio.totalSeconds - 1 ? ' (abertura e conclusão)' : ''}.`,
    'Medições do aplicativo:',
    ...attempt.measured.filter((m) => CRITERIA_INFO[m.id].dimension === 'voice').map((m) => `- ${CRITERIA_INFO[m.id].label}: ${m.value} [${m.state}]`),
  ]
    .filter(Boolean)
    .join('\n');

  const res = await createChatCompletion(cfg, {
    model: cfg.audio.model,
    maxTokens: 1500,
    timeoutMs: Math.max(cfg.timeoutMs, 90_000),
    messages: [
      { role: 'system', content: LISTEN_INSTRUCTIONS },
      {
        role: 'user',
        content: [
          { type: 'text', text: context },
          { type: 'input_audio', input_audio: { data: toBase64(audio.wav), format: 'wav' } },
        ],
      },
    ],
  });
  const p = cfg.audio;
  const textPrompt = Math.max(0, res.usage.promptTokens - res.usage.audioTokens);
  const cost = Math.round(((res.usage.audioTokens * p.audioInputPerMTok + textPrompt * p.textInputPerMTok + res.usage.completionTokens * p.textOutputPerMTok) / 1e6) * 1e8) / 1e8;
  await usageStatement(db, userId, today, { inputTokens: res.usage.promptTokens, cachedTokens: 0, outputTokens: res.usage.completionTokens, reasoningTokens: 0 }, cost, 1).run();

  const parsed = zListened.safeParse(jsonObjectIn(res.text));
  if (!parsed.success) {
    console.error(JSON.stringify({ level: 'error', msg: 'full evaluation unusable', finish: res.finishReason }));
    throw new ApiError('service_unavailable', 'A avaliação com áudio veio incompleta. Tente de novo.');
  }
  const byId = new Map(parsed.data.criteria.map((c) => [c.id, c]));
  const criteria: CriterionResult[] = AUDIO_AI_CRITERIA.map((cid) => {
    const c = byId.get(cid);
    return {
      id: cid,
      state: c?.state ?? 'na',
      value: (c?.evidence ?? 'Não avaliado.').trim().slice(0, 2000) || 'Não avaliado.',
      reference: CRITERIA_INFO[cid].good,
      source: 'audioAi',
      original: null,
      rewrite: null,
    };
  });
  const full = zSpeechFullEvaluation.parse({
    criteria,
    remarks: parsed.data.remarks.map((r) => r.trim().slice(0, 500)).filter(Boolean).slice(0, 5),
    summary: parsed.data.summary.trim().slice(0, 2000),
    heardSeconds: Math.round(audio.heardSeconds * 10) / 10,
    model: cfg.audio.model,
    evaluatedAt: nowIso(),
  });
  const score = speechScore([...attempt.measured, ...(attempt.evaluation?.criteria ?? []), ...criteria], attempt.speechType);
  await run(
    db,
    'UPDATE speech_attempts SET full_evaluation_json = ?, score = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?',
    JSON.stringify(full),
    score,
    nowIso(),
    id,
    userId,
  );
  return getAttempt(db, userId, id);
}
