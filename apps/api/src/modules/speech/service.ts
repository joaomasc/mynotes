import { z } from 'zod';
import {
  CRITERIA_INFO,
  RUBRIC_VERSION,
  TEXT_AI_CRITERIA,
  evaluateMeasured,
  speechScore,
  SPEECH_METHODS,
  SPEECH_TYPE_LABELS,
  calibratedLimits,
  zSpeechEvaluation,
  zSpeechFeedback,
  type CriterionResult,
  type MethodId,
  type SpeechFeedback,
  type SpeechFeedbackRequest,
  type SpeechAttempt,
  type SpeechAttemptCreate,
  type SpeechAttemptSummary,
  type SpeechEvaluation,
  type SpeechFullEvaluation,
  type SpeechMetrics,
  type SpeechMode,
  type SpeechTimeline,
  type SpeechType,
  type SpeechWord,
} from '@mynotes/shared';
import { ApiError, badRequest, notFound } from '../../lib/errors';
import { all, first, num, numOrNull, parseJson, run, str, strOrNull, type Bindable, type Row } from '../../lib/db';
import { assertReference } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { nowIso } from '../../lib/time';
import { aiConfig, costOf, requireReady } from '../assistant/config';
import { createResponse, outputText } from '../assistant/openai';
import { assertWithinBudget, usageStatement } from '../assistant/usage';
import { speechSettings } from './path';
import {
  BOARD_INSTRUCTIONS,
  BOARD_SCHEMA,
  COACH_INSTRUCTIONS,
  EVALUATION_SCHEMA,
  FEEDBACK_INSTRUCTIONS,
  FEEDBACK_SCHEMA,
  evaluationMessage,
  timedTranscript,
} from './prompt';

/* --------------------------------------------------------------- rows -- */

function toSummary(r: Row): SpeechAttemptSummary {
  return {
    id: str(r.id),
    mode: str(r.mode) as SpeechMode,
    speechType: str(r.speech_type) as SpeechType,
    topicId: strOrNull(r.topic_id),
    theme: str(r.theme),
    startedAt: str(r.started_at),
    localDay: str(r.local_day),
    durationSeconds: num(r.duration_seconds),
    score: numOrNull(r.score),
    evaluated: r.evaluation_json != null,
    wpm: num(r.wpm),
    fillersPerMinute: num(r.fillers_per_minute),
    pvq: numOrNull(r.pvq),
    lessonId: strOrNull(r.lesson_id),
    parentId: strOrNull(r.parent_id),
    projectId: strOrNull(r.project_id),
    hasAudio: r.audio_key != null || num(r.has_audio) === 1,
    createdAt: str(r.created_at),
  };
}

export function toAttempt(r: Row): SpeechAttempt {
  return {
    ...toSummary(r),
    transcript: str(r.transcript),
    words: parseJson<SpeechWord[]>(r.words_json, []),
    segments: parseJson(r.segments_json, []),
    timeline: parseJson<SpeechTimeline>(r.timeline_json, { step: 0.1, db: [], f0: [] }),
    metrics: parseJson<SpeechMetrics>(r.metrics_json, {} as SpeechMetrics),
    measured: parseJson<CriterionResult[]>(r.measured_json, []),
    evaluation: parseJson<SpeechEvaluation | null>(r.evaluation_json, null),
    questions: parseJson<string[] | null>(r.questions_json, null),
    fullEvaluation: parseJson<SpeechFullEvaluation | null>(r.full_evaluation_json, null),
    rubricVersion: num(r.rubric_version),
    version: num(r.version),
    updatedAt: str(r.updated_at),
  };
}

export async function attemptRow(db: D1Database, userId: string, id: string): Promise<Row> {
  const row = await first(db, 'SELECT * FROM speech_attempts WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Fala');
  return row;
}

/* --------------------------------------------------------------- CRUD -- */

export async function getAttempt(db: D1Database, userId: string, id: string): Promise<SpeechAttempt> {
  return toAttempt(await attemptRow(db, userId, id));
}

const SORT: SortSpec = { expr: 'started_at', field: 'started_at', dir: 'DESC' };
const SUMMARY_COLUMNS =
  'id, mode, speech_type, topic_id, theme, started_at, local_day, duration_seconds, score, wpm, fillers_per_minute, pvq, lesson_id, parent_id, project_id, created_at, ' +
  'CASE WHEN evaluation_json IS NULL THEN NULL ELSE 1 END AS evaluation_json, CASE WHEN audio_key IS NULL THEN 0 ELSE 1 END AS has_audio';

export async function listAttempts(
  db: D1Database,
  userId: string,
  q: { topicId?: string | undefined; projectId?: string | undefined; cursor?: string | undefined; limit: number },
) {
  let where = 'user_id = ?';
  const binds: Bindable[] = [userId];
  if (q.topicId) {
    where += ' AND topic_id = ?';
    binds.push(q.topicId);
  }
  if (q.projectId) {
    where += ' AND project_id = ?';
    binds.push(q.projectId);
  }
  const page = keyset(SORT, q.cursor);
  const rows = await all(
    db,
    `SELECT ${SUMMARY_COLUMNS} FROM speech_attempts WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`,
    ...binds,
    ...page.binds,
    q.limit + 1,
  );
  const { items, nextCursor } = pageOf(rows, q.limit, SORT);
  return { items: items.map(toSummary), nextCursor };
}

/**
 * Saves a talk. The measured criteria and the score are recomputed here from
 * the metrics, so what is stored always follows the current rubric. The id
 * comes from the browser: saving the same talk again returns the stored copy.
 */
export async function createAttempt(
  db: D1Database,
  userId: string,
  input: SpeechAttemptCreate,
): Promise<{ attempt: SpeechAttempt; created: boolean }> {
  const existing = await first(db, 'SELECT user_id FROM speech_attempts WHERE id = ?', input.id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { attempt: await getAttempt(db, userId, input.id), created: false };
  }
  if (input.mode === 'explain' && !input.topicId) throw badRequest('Escolha o assunto que você vai explicar');
  await assertReference(db, 'topics', input.topicId, userId);
  if (input.parentId && !(await first(db, 'SELECT 1 AS ok FROM speech_attempts WHERE id = ? AND user_id = ?', input.parentId, userId))) {
    throw badRequest('A fala de origem não existe');
  }
  if (input.projectId && !(await first(db, 'SELECT 1 AS ok FROM speech_projects WHERE id = ? AND user_id = ?', input.projectId, userId))) {
    throw badRequest('O discurso não existe');
  }
  if (input.timeline.db.length !== input.timeline.f0.length) throw badRequest('Linha do tempo inconsistente');

  const settings = await speechSettings(db, userId);
  const measured = evaluateMeasured(input.metrics, calibratedLimits(settings.limits));
  const now = nowIso();
  await run(
    db,
    `INSERT INTO speech_attempts (id, user_id, mode, speech_type, topic_id, theme, started_at, local_day, duration_seconds,
       transcript, words_json, segments_json, timeline_json, metrics_json, measured_json, evaluation_json, score,
       rubric_version, wpm, fillers_per_minute, pvq, lesson_id, parent_id, project_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    input.id,
    userId,
    input.mode,
    input.speechType,
    input.topicId,
    input.theme,
    input.startedAt,
    input.localDay,
    input.metrics.durationSeconds,
    input.transcript,
    JSON.stringify(input.words),
    JSON.stringify(input.segments),
    JSON.stringify(input.timeline),
    JSON.stringify(input.metrics),
    JSON.stringify(measured),
    speechScore(measured, input.speechType),
    RUBRIC_VERSION,
    input.metrics.pace.wpm,
    input.metrics.fillers.perMinute,
    input.metrics.pitch.pvq,
    input.lessonId,
    input.parentId,
    input.projectId,
    now,
    now,
  );
  return { attempt: await getAttempt(db, userId, input.id), created: true };
}

export async function deleteAttempt(env: Env, userId: string, id: string): Promise<void> {
  const row = await first<{ audio_key: string | null }>(env.DB, 'SELECT audio_key FROM speech_attempts WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Fala');
  await run(env.DB, 'DELETE FROM speech_attempts WHERE id = ? AND user_id = ?', id, userId);
  // The kept recording goes with the talk (it is not in any backup).
  if (row.audio_key) await env.FILES.delete(row.audio_key);
}

/* --------------------------------------------------------- evaluation -- */

const NOTES_MAX = 20;
const NOTE_CHARS = 1500;
const NOTES_TOTAL_CHARS = 9000;

/** The user's notes on a topic and its subtopics, most recent first, bounded. */
export async function topicNotes(db: D1Database, userId: string, topicId: string): Promise<{ title: string; text: string }[]> {
  const rows = await all<{ title: string; body_text: string }>(
    db,
    `WITH RECURSIVE tree(id) AS (
       SELECT id FROM topics WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       UNION SELECT t.id FROM topics t JOIN tree ON t.parent_id = tree.id WHERE t.deleted_at IS NULL
     )
     SELECT title, body_text FROM notes
      WHERE user_id = ? AND deleted_at IS NULL AND topic_id IN (SELECT id FROM tree) AND length(body_text) > 0
      ORDER BY updated_at DESC LIMIT ?`,
    topicId,
    userId,
    userId,
    NOTES_MAX,
  );
  const out: { title: string; text: string }[] = [];
  let total = 0;
  for (const r of rows) {
    const text = r.body_text.slice(0, Math.min(NOTE_CHARS, NOTES_TOTAL_CHARS - total));
    if (!text) break;
    out.push({ title: r.title, text });
    total += text.length;
  }
  return out;
}

const zModelAnswer = z.object({
  criteria: z.array(
    z.object({
      id: z.enum(TEXT_AI_CRITERIA),
      state: z.enum(['good', 'attention', 'improve', 'na']),
      evidence: z.string(),
      original: z.string().nullable(),
      rewrite: z.string().nullable(),
    }),
  ),
  improvements: z.array(z.object({ title: z.string(), detail: z.string(), original: z.string().nullable(), rewrite: z.string().nullable() })),
  exercise: z.string(),
  summary: z.string(),
});

const cut = (s: string | null, max: number) => (s === null ? null : s.trim().slice(0, max) || null);

/** The model's answer as stored: one entry per text criterion, bounded sizes. */
function toEvaluation(answer: z.infer<typeof zModelAnswer>, model: string, hasNotes: boolean): SpeechEvaluation {
  const byId = new Map(answer.criteria.map((c) => [c.id, c]));
  const criteria = TEXT_AI_CRITERIA.map((id) => {
    const c = byId.get(id);
    const state = !c || (id === 'correctness' && !hasNotes) ? 'na' : c.state;
    return {
      id,
      state,
      value: cut(c?.evidence ?? '', 2000) ?? (id === 'correctness' && !hasNotes ? 'Sem notas para comparar.' : 'Não avaliado.'),
      reference: CRITERIA_INFO[id].good,
      source: 'textAi' as const,
      original: state === 'good' ? null : cut(c?.original ?? null, 2000),
      rewrite: state === 'good' ? null : cut(c?.rewrite ?? null, 2000),
    };
  });
  return zSpeechEvaluation.parse({
    criteria,
    improvements: answer.improvements.slice(0, 3).map((i) => ({
      title: i.title.trim().slice(0, 200),
      detail: i.detail.trim().slice(0, 2000),
      original: cut(i.original, 2000),
      rewrite: cut(i.rewrite, 2000),
    })),
    exercise: answer.exercise.trim().slice(0, 2000),
    summary: answer.summary.trim().slice(0, 2000),
    model,
    evaluatedAt: nowIso(),
  });
}

/**
 * The model reads the transcript (and, in explain mode, the user's notes on
 * the topic) and judges structure and language, with rewritten sentences and
 * up to 3 things to improve. Counts against the daily AI budget.
 */
export async function evaluateAttempt(env: Env, userId: string, id: string, input: { force: boolean }): Promise<SpeechAttempt> {
  const db = env.DB;
  const row = await attemptRow(db, userId, id);
  if (row.evaluation_json != null && !input.force) return toAttempt(row);
  const attempt = toAttempt(row);
  if (!attempt.transcript.trim()) throw badRequest('A fala não tem texto para avaliar');
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(db, userId, cfg, today);

  const topic = attempt.topicId ? await first<{ title: string }>(db, 'SELECT title FROM topics WHERE id = ? AND user_id = ?', attempt.topicId, userId) : null;
  const notes = attempt.mode === 'explain' && attempt.topicId ? await topicNotes(db, userId, attempt.topicId) : [];
  const message = evaluationMessage({
    mode: attempt.mode,
    speechType: attempt.speechType,
    theme: attempt.theme,
    topicTitle: topic?.title ?? null,
    durationSeconds: attempt.durationSeconds,
    targetSeconds: attempt.metrics.targetSeconds,
    measured: attempt.measured,
    transcript: timedTranscript(attempt.words, attempt.transcript),
    notes,
  });

  const started = Date.now();
  const res = await createResponse(cfg, {
    instructions: COACH_INSTRUCTIONS,
    input: [{ role: 'user', content: message }],
    tools: [],
    toolChoice: 'none',
    textFormat: { name: 'speech_evaluation', schema: EVALUATION_SCHEMA },
    maxOutputTokens: Math.max(cfg.maxOutputTokens, 4000),
  });
  const cost = costOf(res.usage, cfg.prices);
  // Paid for even when the answer turns out unusable.
  await usageStatement(db, userId, today, res.usage, cost, 1).run();

  let answer: z.infer<typeof zModelAnswer>;
  try {
    if (res.status !== 'completed') throw new Error(res.incompleteReason ?? res.status);
    answer = zModelAnswer.parse(JSON.parse(outputText(res.output)));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'speech evaluation unusable', status: res.status, error: String(err).slice(0, 200) }));
    throw new ApiError('service_unavailable', 'A avaliação da IA veio incompleta. Tente avaliar de novo.');
  }
  const evaluation = toEvaluation(answer, cfg.model, notes.length > 0);
  const score = speechScore([...attempt.measured, ...evaluation.criteria, ...(attempt.fullEvaluation?.criteria ?? [])], attempt.speechType);
  const now = nowIso();
  await run(
    db,
    'UPDATE speech_attempts SET evaluation_json = ?, score = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?',
    JSON.stringify(evaluation),
    score,
    now,
    id,
    userId,
  );
  console.info(
    JSON.stringify({
      level: 'info',
      msg: 'speech evaluated',
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      cost_usd: cost,
      ms: Date.now() - started,
    }),
  );
  return getAttempt(db, userId, id);
}

/* ----------------------------------------------------------- feedback -- */

/** The model checks a written exercise (fix a sentence, write a part of a talk). Counts against the daily budget. */
export async function writtenFeedback(env: Env, userId: string, input: Required<Omit<SpeechFeedbackRequest, 'method'>> & { method: string | null }): Promise<SpeechFeedback> {
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(env.DB, userId, cfg, today);
  const method = input.method && input.method in SPEECH_METHODS ? SPEECH_METHODS[input.method as MethodId] : null;
  const message = [
    `Exercício: ${input.kind === 'fix' ? 'reescrever uma frase' : 'escrever uma parte de uma fala'}.`,
    `Instrução: ${input.instruction}`,
    `${input.kind === 'fix' ? 'Frase original' : 'Parte pedida'}: ${input.context}`,
    method ? `Método: ${method.name} (${method.parts.map((p) => p.name).join(' → ')}).` : '',
    `Resposta do estudante: ${input.answer}`,
  ]
    .filter(Boolean)
    .join('\n');
  const res = await createResponse(cfg, {
    instructions: FEEDBACK_INSTRUCTIONS,
    input: [{ role: 'user', content: message }],
    tools: [],
    toolChoice: 'none',
    textFormat: { name: 'exercise_feedback', schema: FEEDBACK_SCHEMA },
    maxOutputTokens: Math.max(cfg.maxOutputTokens, 1500),
  });
  await usageStatement(env.DB, userId, today, res.usage, costOf(res.usage, cfg.prices), 1).run();
  try {
    if (res.status !== 'completed') throw new Error(res.incompleteReason ?? res.status);
    const parsed = zSpeechFeedback.parse(JSON.parse(outputText(res.output)));
    return { verdict: parsed.verdict, feedback: parsed.feedback.trim().slice(0, 2000), suggestion: parsed.suggestion.trim().slice(0, 2000) };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'speech feedback unusable', status: res.status, error: String(err).slice(0, 200) }));
    throw new ApiError('service_unavailable', 'A correção da IA veio incompleta. Tente de novo.');
  }
}

/* -------------------------------------------------------------- board -- */

const zQuestions = z.object({ questions: z.array(z.string()) });

/**
 * The examining board: three fair but hard questions about a talk (one to
 * clarify, one that challenges an argument, one that asks for an example),
 * kept with the talk. Counts against the daily budget.
 */
export async function boardQuestions(env: Env, userId: string, id: string, input: { force: boolean }): Promise<SpeechAttempt> {
  const db = env.DB;
  const row = await attemptRow(db, userId, id);
  if (row.questions_json != null && !input.force) return toAttempt(row);
  const attempt = toAttempt(row);
  if (!attempt.transcript.trim()) throw badRequest('A fala não tem texto para a banca perguntar');
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(db, userId, cfg, today);
  const notes = attempt.mode === 'explain' && attempt.topicId ? await topicNotes(db, userId, attempt.topicId) : [];
  const message = [
    `Tipo de fala: ${SPEECH_TYPE_LABELS[attempt.speechType]}.`,
    attempt.theme ? `Tema: ${attempt.theme}.` : '',
    'Transcrição:',
    timedTranscript(attempt.words, attempt.transcript, 8000),
    ...(notes.length ? ['', 'Notas do estudante sobre o assunto:', ...notes.map((n) => `### ${n.title}\n${n.text}`)] : []),
  ]
    .filter(Boolean)
    .join('\n');
  const res = await createResponse(cfg, {
    instructions: BOARD_INSTRUCTIONS,
    input: [{ role: 'user', content: message }],
    tools: [],
    toolChoice: 'none',
    textFormat: { name: 'board_questions', schema: BOARD_SCHEMA },
    maxOutputTokens: Math.max(cfg.maxOutputTokens, 1500),
  });
  await usageStatement(db, userId, today, res.usage, costOf(res.usage, cfg.prices), 1).run();
  let questions: string[];
  try {
    if (res.status !== 'completed') throw new Error(res.incompleteReason ?? res.status);
    questions = zQuestions
      .parse(JSON.parse(outputText(res.output)))
      .questions.map((q) => q.trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 3);
    if (questions.length === 0) throw new Error('no questions');
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'board questions unusable', status: res.status, error: String(err).slice(0, 200) }));
    throw new ApiError('service_unavailable', 'A banca não conseguiu formular as perguntas. Tente de novo.');
  }
  await run(db, 'UPDATE speech_attempts SET questions_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?', JSON.stringify(questions), nowIso(), id, userId);
  return getAttempt(db, userId, id);
}
