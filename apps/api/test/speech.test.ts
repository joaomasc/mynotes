import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSpeechMetrics, uuidv7, type SpeechWord } from '@mynotes/shared';
import { client, setupOwner } from './helpers';
import { answer, mockOpenAI, usage } from './openai-mock';

/*
 * Speaking practice: the browser measures the talk and sends the result;
 * the API recomputes the measured criteria, stores the talk and asks the
 * model (always mocked here) for the text evaluation.
 */

let http: ReturnType<typeof client>;
let userId: string;

beforeEach(async () => {
  const owner = await setupOwner();
  userId = owner.user.id;
  http = client(owner.token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** About 150 words per minute: one word every 0.4 s. */
function wordsOf(text: string, step = 0.4): SpeechWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ text: w, start: i * step, end: i * step + step * 0.9 }));
}

const SPEECH =
  'Hoje vou explicar o mercantilismo. Ele foi a política econômica dos estados europeus entre os séculos quinze e dezoito. ' +
  'Né, a ideia central era acumular ouro e prata. Para isso, os reinos protegiam a indústria e exportavam mais do que importavam. ' +
  'Eu acho que o melhor exemplo é Portugal, que controlava o comércio das colônias. Por isso, o mercantilismo explica a colonização.';

function attempt(extra: Record<string, unknown> = {}) {
  const words = wordsOf(SPEECH);
  const metrics = computeSpeechMetrics({ frames: [], words, segments: [], targetSeconds: 30 });
  return {
    id: uuidv7(),
    mode: 'free',
    speechType: 'explain',
    theme: 'Mercantilismo',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    localDay: '2026-10-20',
    transcript: SPEECH,
    words,
    segments: [{ start: 0, end: words.at(-1)!.end, text: SPEECH, avgLogprob: -0.25 }],
    timeline: { step: 0.1, db: [-20, null, -22], f0: [150, null, 160] },
    metrics,
    ...extra,
  };
}

/** A model answer in the shape of the evaluation schema. */
const MODEL_ANSWER = {
  criteria: [
    { id: 'opening', state: 'good', evidence: 'Em 0:00 anuncia o tema.', original: 'ignorado quando bom', rewrite: 'ignorado' },
    { id: 'centralIdea', state: 'good', evidence: 'Acumular metais.', original: null, rewrite: null },
    { id: 'development', state: 'attention', evidence: 'Só um exemplo.', original: 'o melhor exemplo é Portugal', rewrite: 'Dois exemplos: Portugal e Espanha…' },
    { id: 'transitions', state: 'good', evidence: '“Por isso” liga as partes.', original: null, rewrite: null },
    { id: 'conclusion', state: 'improve', evidence: 'Termina sem retomar a ideia.', original: 'Por isso, o mercantilismo explica a colonização.', rewrite: 'Ou seja: …' },
    { id: 'correctness', state: 'good', evidence: 'Correto.', original: null, rewrite: null },
    { id: 'precision', state: 'good', evidence: 'Termos claros.', original: null, rewrite: null },
  ],
  improvements: [
    { title: 'Feche retomando a ideia central', detail: 'Repita a tese em uma frase.', original: null, rewrite: 'Ou seja: riqueza era metal.' },
    { title: 'Corte o “né”', detail: 'Troque por uma pausa.', original: 'Né, a ideia', rewrite: 'A ideia' },
    { title: 'Mais um exemplo', detail: 'Cite a Espanha.', original: null, rewrite: null },
    { title: 'Quarto item (sobra)', detail: 'Não deve aparecer.', original: null, rewrite: null },
  ],
  exercise: 'Explique o mercantilismo em 1 minuto terminando com a ideia central.',
  summary: 'Fala clara e bem ordenada; falta fechar com a ideia central.',
};

describe('speech attempts', () => {
  it('stores a talk, recomputing the measured criteria and the score from the metrics', async () => {
    const body = attempt();
    const res = await http.post('/speech/attempts', body);
    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a).toMatchObject({ id: body.id, mode: 'free', speechType: 'explain', evaluated: false, rubricVersion: 1 });
    expect(a.measured.find((m: any) => m.id === 'pace')).toMatchObject({ state: 'good', source: 'measured' });
    expect(a.measured.find((m: any) => m.id === 'weakWords').value).toMatch(/eu acho que/);
    expect(a.score).toBeGreaterThan(0);
    expect(a.wpm).toBe(body.metrics.pace.wpm);

    // Saving the same talk again (a retry) returns the stored copy.
    const again = await http.post('/speech/attempts', body);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(body.id);

    const list = await http.get('/speech/attempts');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: body.id, evaluated: false });
    expect(list.body.data[0].words).toBeUndefined();

    expect((await http.del(`/speech/attempts/${body.id}`)).status).toBe(204);
    expect((await http.get(`/speech/attempts/${body.id}`)).status).toBe(404);
  });

  it('requires an existing topic to explain', async () => {
    expect((await http.post('/speech/attempts', attempt({ mode: 'explain' }))).status).toBe(400);
    expect((await http.post('/speech/attempts', attempt({ mode: 'explain', topicId: uuidv7() }))).status).toBe(400);
  });

  it('never shows one user the talks of another', async () => {
    const body = attempt();
    await http.post('/speech/attempts', body);
    const other = client((await setupOwner()).token);
    expect((await other.get(`/speech/attempts/${body.id}`)).status).toBe(404);
    expect((await other.get('/speech/attempts')).body.data).toHaveLength(0);
    expect((await other.post('/speech/attempts', body)).status).toBe(400);
  });
});

describe('speech evaluation', () => {
  async function explainTalk() {
    const topic = (await http.post('/topics', { title: 'Mercantilismo', parentId: null })).body.data;
    const sub = (await http.post('/topics', { title: 'Colônias', parentId: topic.id })).body.data;
    const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    await http.post('/notes', { title: 'Balança comercial', topicId: topic.id, content: doc('Exportar mais do que importar.') });
    await http.post('/notes', { title: 'Pacto colonial', topicId: sub.id, content: doc('A colônia só comercia com a metrópole.') });
    const body = attempt({ mode: 'explain', topicId: topic.id });
    expect((await http.post('/speech/attempts', body)).status).toBe(201);
    return body;
  }

  it('asks the model for a structured evaluation, with the notes of the topic and its subtopics', async () => {
    const body = await explainTalk();
    const { bodies } = mockOpenAI([answer(JSON.stringify(MODEL_ANSWER))]);
    const res = await http.post(`/speech/attempts/${body.id}/evaluate`, {});
    expect(res.status).toBe(200);

    const req = bodies[0];
    expect(req.text.format).toMatchObject({ type: 'json_schema', name: 'speech_evaluation', strict: true });
    expect(req.tools).toBeUndefined();
    expect(req.parallel_tool_calls).toBeUndefined();
    const message = req.input[0].content as string;
    expect(message).toContain('Assunto: Mercantilismo.');
    expect(message).toContain('Exportar mais do que importar.');
    expect(message).toContain('A colônia só comercia com a metrópole.');
    expect(message).toMatch(/\[0:00\] Hoje vou explicar o mercantilismo\./);
    expect(message).toMatch(/Ritmo: \d+ palavras\/min \[good/);

    const a = res.body.data;
    expect(a.evaluated).toBe(true);
    const ev = a.evaluation;
    expect(ev.criteria).toHaveLength(7);
    expect(ev.criteria.find((c: any) => c.id === 'opening')).toMatchObject({ state: 'good', original: null, rewrite: null, source: 'textAi' });
    expect(ev.criteria.find((c: any) => c.id === 'conclusion')).toMatchObject({ state: 'improve', rewrite: 'Ou seja: …' });
    expect(ev.criteria.find((c: any) => c.id === 'correctness').state).toBe('good');
    expect(ev.improvements).toHaveLength(3);
    expect(ev.model).toBe('gpt-6-luna');

    // The spend counts in the shared daily AI budget.
    const spent = await env.DB.prepare('SELECT requests, input_tokens FROM ai_usage_daily WHERE user_id = ?').bind(userId).first();
    expect(spent).toMatchObject({ requests: 1, input_tokens: usage.input_tokens });

    // Asked again: the stored evaluation, no new call.
    const again = await http.post(`/speech/attempts/${body.id}/evaluate`, {});
    expect(again.body.data.evaluation.evaluatedAt).toBe(ev.evaluatedAt);
    expect(bodies).toHaveLength(1);
  });

  it('does not judge correctness without notes to compare', async () => {
    const body = attempt();
    await http.post('/speech/attempts', body);
    const { bodies } = mockOpenAI([answer(JSON.stringify(MODEL_ANSWER))]);
    const res = await http.post(`/speech/attempts/${body.id}/evaluate`, {});
    expect(res.status).toBe(200);
    expect(bodies[0].input[0].content).not.toContain('Notas do estudante');
    expect(res.body.data.evaluation.criteria.find((c: any) => c.id === 'correctness')).toMatchObject({ state: 'na' });
  });

  it('reports an unusable answer clearly and still counts what was spent', async () => {
    const body = attempt();
    await http.post('/speech/attempts', body);
    mockOpenAI([answer('isto não é JSON')]);
    const res = await http.post(`/speech/attempts/${body.id}/evaluate`, {});
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/incompleta/);
    const spent = await env.DB.prepare('SELECT requests FROM ai_usage_daily WHERE user_id = ?').bind(userId).first();
    expect(spent).toMatchObject({ requests: 1 });
    expect((await http.get(`/speech/attempts/${body.id}`)).body.data.evaluated).toBe(false);
  });

  it('respects the daily AI budget shared with the assistant', async () => {
    const body = attempt();
    await http.post('/speech/attempts', body);
    await env.DB.prepare('INSERT INTO ai_usage_daily (user_id, day, requests, cost_usd) VALUES (?, ?, 1, 99)')
      .bind(userId, new Date().toISOString().slice(0, 10))
      .run();
    const { spy } = mockOpenAI([]);
    const res = await http.post(`/speech/attempts/${body.id}/evaluate`, {});
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/orçamento diário/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('transcription with word timings', () => {
  it('returns segments with their confidence and the words, dropping invented sentences', async () => {
    vi.spyOn(env.AI, 'run').mockImplementation((async () => ({
      text: 'Olá a todos. Legendas pela comunidade Amara.org',
      transcription_info: { duration: 4 },
      segments: [
        { start: 0.4, end: 1.6, text: ' Olá a todos.', avg_logprob: -0.31, words: [{ word: ' Olá', start: 0.4, end: 0.8 }, { word: ' a', start: 0.8, end: 0.9 }, { word: ' todos.', start: 0.9, end: 1.6 }] },
        { start: 2, end: 4, text: ' Legendas pela comunidade Amara.org', avg_logprob: -0.9, words: [{ word: ' Legendas', start: 2, end: 2.5 }] },
      ],
    })) as never);
    // A tiny valid WAV header plus silence.
    const wav = new Uint8Array(44 + 3200);
    wav.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    wav.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
    const res = await http.post('/transcriptions', { audio: btoa(String.fromCharCode(...wav)), detail: 'words' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      text: 'Olá a todos.',
      durationSeconds: 4,
      segments: [{ start: 0.4, end: 1.6, text: 'Olá a todos.', avgLogprob: -0.31 }],
      words: [
        { text: 'Olá', start: 0.4, end: 0.8 },
        { text: 'a', start: 0.8, end: 0.9 },
        { text: 'todos.', start: 0.9, end: 1.6 },
      ],
    });
  });
});
