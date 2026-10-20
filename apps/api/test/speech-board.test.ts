import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSpeechMetrics, uuidv7, type SpeechWord } from '@mynotes/shared';
import { client, setupOwner } from './helpers';
import { answer, mockOpenAI } from './openai-mock';

/*
 * Stage 3: the examining board (questions about a talk, answers linked to it)
 * and exercise variants written by the model for reviews.
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

const words = (text: string): SpeechWord[] => text.split(' ').map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35 }));

async function saveTalk(text: string, extra: Record<string, unknown> = {}) {
  const ws = words(text);
  const res = await http.post('/speech/attempts', {
    id: uuidv7(),
    mode: 'free',
    speechType: 'persuasive',
    theme: 'Transporte público',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    localDay: '2026-10-20',
    transcript: text,
    words: ws,
    segments: [],
    timeline: { step: 0.1, db: [], f0: [] },
    metrics: computeSpeechMetrics({ frames: [], words: ws, segments: [], targetSeconds: null }),
    ...extra,
  });
  return res;
}

const TALK = 'A cidade deveria investir em ônibus. Eles levam mais gente por real gasto. Por isso, o transporte público é a melhor escolha.';

describe('the examining board', () => {
  it('asks three questions about a talk and keeps them', async () => {
    const talk = (await saveTalk(TALK)).body.data;
    const { bodies } = mockOpenAI([answer(JSON.stringify({ questions: ['O que é “mais gente por real”?', 'E o custo de manutenção?', 'Dê um exemplo de cidade.', 'Uma quarta que sobra.'] }))]);
    const res = await http.post(`/speech/attempts/${talk.id}/questions`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.questions).toEqual(['O que é “mais gente por real”?', 'E o custo de manutenção?', 'Dê um exemplo de cidade.']);
    expect(bodies[0].text.format.name).toBe('board_questions');
    expect(bodies[0].input[0].content).toContain('A cidade deveria investir em ônibus.');

    // Asked again: the same questions, no new call.
    const again = await http.post(`/speech/attempts/${talk.id}/questions`, {});
    expect(again.body.data.questions).toHaveLength(3);
    expect(bodies).toHaveLength(1);
  });

  it('links answers to the talk and evaluates them as answers to the question', async () => {
    const talk = (await saveTalk(TALK)).body.data;
    const res = await saveTalk('Sim. A manutenção custa menos que as obras de novas avenidas, como mostrou o caso de Curitiba.', {
      speechType: 'qa',
      theme: 'E o custo de manutenção?',
      parentId: talk.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ parentId: talk.id, speechType: 'qa' });

    const { bodies } = mockOpenAI([
      answer(JSON.stringify({ criteria: [], improvements: [], exercise: 'Responda em uma frase antes de explicar.', summary: 'Respondeu direto.' })),
    ]);
    await http.post(`/speech/attempts/${res.body.data.id}/evaluate`, {});
    expect(bodies[0].input[0].content).toContain('Pergunta da banca: “E o custo de manutenção?”');
    expect(bodies[0].instructions).toContain('resposta a uma pergunta da banca');

    // The parent must be one of the user's talks.
    const other = client((await setupOwner()).token);
    const foreign = await other.post('/speech/attempts', {
      ...(await (async () => {
        const ws = words('Resposta.');
        return {
          id: uuidv7(),
          mode: 'free',
          speechType: 'qa',
          theme: 'x',
          startedAt: new Date().toISOString(),
          localDay: '2026-10-20',
          transcript: 'Resposta.',
          words: ws,
          segments: [],
          timeline: { step: 0.1, db: [], f0: [] },
          metrics: computeSpeechMetrics({ frames: [], words: ws, segments: [], targetSeconds: null }),
        };
      })()),
      parentId: talk.id,
    });
    expect(foreign.status).toBe(400);
  });

  it('reports unusable questions and still counts the spend', async () => {
    const talk = (await saveTalk(TALK)).body.data;
    mockOpenAI([answer(JSON.stringify({ questions: [] }))]);
    const res = await http.post(`/speech/attempts/${talk.id}/questions`, {});
    expect(res.status).toBe(503);
    const spent = await env.DB.prepare('SELECT requests FROM ai_usage_daily WHERE user_id = ?').bind(userId).first();
    expect(spent).toMatchObject({ requests: 1 });
  });
});

describe('exercise variants for reviews', () => {
  const item = (o: Record<string, unknown>) => ({
    type: 'fix',
    instruction: null,
    sentence: null,
    sample: null,
    prompt: null,
    options: null,
    answer: null,
    explanation: null,
    text: null,
    ...o,
  });
  const batch = {
    items: [
      item({ instruction: 'Tire os vícios.', sentence: 'Então, tipo, eu vou, né.', sample: 'Eu vou.' }),
      item({ type: 'recognize', prompt: 'Qual tem vício?', options: ['Eu vou.', 'Tipo, eu vou.', 'Vou já.'], answer: 1, explanation: '“Tipo” sobra.' }),
      item({ type: 'readAloud', instruction: 'Leia com pausas.', text: 'Primeiro, | o custo. | Depois, | o prazo. ↘' }),
      item({ type: 'recognize', prompt: 'Quebrada', options: ['a', 'b'], answer: 5, explanation: 'x' }),
      item({ type: 'fix', instruction: 'Sem frase' }),
      item({ instruction: 'Corte.', sentence: 'Aí, basicamente, acabou.', sample: 'Acabou.' }),
    ],
  };

  it('writes a batch, serves 3 at a time and each only once', async () => {
    const { bodies } = mockOpenAI([answer(JSON.stringify(batch))]);
    const first = await http.get('/speech/variants?skill=fillers');
    expect(first.status).toBe(200);
    expect(first.body.data.map((v: any) => v.type)).toEqual(['fix', 'recognize', 'readAloud']);
    expect(first.body.data[0]).toMatchObject({ focus: 'fillers', sentence: 'Então, tipo, eu vou, né.' });
    expect(bodies[0].text.format.name).toBe('exercise_variants');
    expect(bodies[0].input[0].content).toContain('Vícios de linguagem');

    // One valid item left (two were invalid): below the refill mark, a new batch is asked (here, an empty one).
    const refill = mockOpenAI([answer(JSON.stringify({ items: [] }))]);
    const second = await http.get('/speech/variants?skill=fillers');
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].sentence).toBe('Aí, basicamente, acabou.');
    expect(refill.bodies).toHaveLength(1);

    const stock = await env.DB.prepare('SELECT COUNT(*) AS n FROM speech_exercise_variants WHERE user_id = ? AND used_count = 0').bind(userId).first();
    expect(stock).toMatchObject({ n: 0 });
  });

  it('goes on without the AI: whatever is stored, or nothing', async () => {
    const original = (env as any).OPENAI_API_KEY;
    (env as any).OPENAI_API_KEY = '';
    try {
      const { spy } = mockOpenAI([]);
      const res = await http.get('/speech/variants?skill=weakWords');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (env as any).OPENAI_API_KEY = original;
    }
  });

  it('rejects unknown skills', async () => {
    expect((await http.get('/speech/variants?skill=voar')).status).toBe(400);
  });
});
