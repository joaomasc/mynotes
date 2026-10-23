import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { runReviewReminders } from '../src/modules/review/reminders';
import { scoreOf, validGenerated } from '../src/modules/review/ai';
import { streaks } from '../src/modules/review/stats';
import { toBase64Url } from '../src/lib/crypto';
import { client, setupOwner } from './helpers';
import { answer, callTools, mockOpenAI, toolOutputs } from './openai-mock';
import { installSemanticFakes } from './semantic-fakes';

/*
 * Revisar (docs/revisar.md): scope by topic subtree, cards and FSRS, sessions
 * that count in Estudo, and the AI (questions grounded in the notes,
 * corrections by key points, free recall). OpenAI is always mocked.
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

const TODAY = new Date().toISOString().slice(0, 10);
const paragraphs = (...lines: string[]) => ({ type: 'doc', content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });

async function topic(title: string, parentId: string | null = null) {
  return (await http.post('/topics', { title, parentId })).body.data;
}
async function note(title: string, topicId: string | null, ...lines: string[]) {
  const res = await http.post('/notes', { title, topicId, content: paragraphs(...lines) });
  expect(res.status).toBe(201);
  return res.body.data;
}
async function card(body: Record<string, unknown>) {
  const res = await http.post('/review/cards', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as any[];
}
const fronts = (cards: { front: string }[]) => cards.map((c) => c.front).sort();
const queue = async (topicIds: string[], mode = 'due', limit?: number) =>
  (await http.get(`/review/queue?today=${TODAY}&mode=${mode}${topicIds.length ? `&topicIds=${topicIds.join(',')}` : ''}${limit ? `&limit=${limit}` : ''}`)).body.data;

/** A → B → C, plus B2 (sibling of B) and D (another root), one card in each. */
async function tree() {
  const A = await topic('A');
  const B = await topic('B', A.id);
  const C = await topic('C', B.id);
  const B2 = await topic('B2', A.id);
  const D = await topic('D');
  for (const [t, name] of [
    [A, 'a'],
    [B, 'b'],
    [C, 'c'],
    [B2, 'b2'],
    [D, 'd'],
  ] as const) {
    await card({ kind: 'basic', front: `pergunta ${name}`, back: `resposta ${name}`, topicId: t.id });
  }
  return { A, B, C, B2, D };
}

describe('scope: a topic with all its descendants', () => {
  it('selecting A covers B and C; selecting B covers only B and C', async () => {
    const { A, B, C, D } = await tree();
    expect(fronts((await queue([A.id])).cards)).toEqual(['pergunta a', 'pergunta b', 'pergunta b2', 'pergunta c']);
    expect(fronts((await queue([B.id])).cards)).toEqual(['pergunta b', 'pergunta c']);
    expect(fronts((await queue([C.id])).cards)).toEqual(['pergunta c']);
    expect(fronts((await queue([B.id, D.id])).cards)).toEqual(['pergunta b', 'pergunta c', 'pergunta d']);
    // No selection: everything.
    expect((await queue([])).cards).toHaveLength(5);

    const info = (await http.get(`/review/scope?today=${TODAY}&topicIds=${B.id}`)).body.data;
    expect(info).toMatchObject({ topics: 2, cards: 2, new: 2, due: 0 });
  });

  it('cards follow their note: moving the note moves them, trashing it hides them', async () => {
    const { B, D } = await tree();
    const n = await note('Fotossíntese', B.id, 'A fotossíntese transforma luz em energia química nas plantas.');
    await card({ kind: 'basic', front: 'O que a fotossíntese transforma?', back: 'Luz em energia química', noteId: n.id, sourceQuote: 'transforma luz em energia química' });
    expect(fronts((await queue([B.id])).cards)).toContain('O que a fotossíntese transforma?');

    await http.post(`/notes/${n.id}/move`, { baseVersion: n.version, topicId: D.id });
    expect(fronts((await queue([B.id])).cards)).not.toContain('O que a fotossíntese transforma?');
    expect(fronts((await queue([D.id])).cards)).toContain('O que a fotossíntese transforma?');

    await http.del(`/notes/${n.id}`);
    expect(fronts((await queue([])).cards)).not.toContain('O que a fotossíntese transforma?');
  });

  it('annotations of a book belong to the book’s topic', async () => {
    const { C } = await tree();
    const book = (await http.post('/readings', { title: 'Biologia', topicId: C.id })).body.data;
    const ann = (await http.post('/notes', { role: 'annotation', readingId: book.id, page: 12, content: paragraphs('A mitocôndria produz ATP para a célula.') })).body.data;
    const [c] = await card({ kind: 'cloze', front: 'A {{c1::mitocôndria}} produz ATP.', noteId: ann.id });
    expect(c.topicId).toBe(C.id);
    expect(fronts((await queue([C.id])).cards)).toContain('A {{c1::mitocôndria}} produz ATP.');
  });
});

describe('cards', () => {
  it('creates one card per cloze number, the reverse card, and checks what each kind needs', async () => {
    const t = await topic('Biologia');
    const cloze = await card({ kind: 'cloze', front: 'A {{c1::mitocôndria}} produz {{c2::ATP}}.', topicId: t.id });
    expect(cloze.map((c) => c.clozeIndex)).toEqual([1, 2]);
    expect(new Set(cloze.map((c) => c.groupId)).size).toBe(1);

    const pair = await card({ kind: 'basic', front: 'Capital da França', back: 'Paris', reverse: true, topicId: t.id });
    expect(pair.map((c) => [c.front, c.back])).toEqual([
      ['Capital da França', 'Paris'],
      ['Paris', 'Capital da França'],
    ]);

    expect((await http.post('/review/cards', { kind: 'cloze', front: 'Sem lacuna nenhuma', topicId: t.id })).status).toBe(400);
    expect((await http.post('/review/cards', { kind: 'essay', front: 'Explique a respiração.' })).status).toBe(400);
    const essay = await card({ kind: 'essay', front: 'Explique a respiração celular.', keyPoints: ['glicose', 'ATP'], topicId: t.id });
    expect(essay[0]).toMatchObject({ kind: 'essay', keyPoints: ['glicose', 'ATP'], schedule: { phase: 0, reps: 0 } });

    // A retried request (same id) does not create the cards again.
    const id = uuidv7();
    await card({ id, kind: 'cloze', front: '{{c1::Um}} e {{c2::dois}}.', topicId: t.id });
    const again = await card({ id, kind: 'cloze', front: '{{c1::Um}} e {{c2::dois}}.', topicId: t.id });
    expect(again).toHaveLength(2);
    const all = (await http.get(`/review/cards?topicIds=${t.id}&limit=50`)).body.data;
    expect(all).toHaveLength(7);
  });

  it('notices when the quoted passage is no longer in the note', async () => {
    const t = await topic('História');
    const n = await note('Revolução', t.id, 'A Revolução Francesa começou em 1789, com a queda da Bastilha.');
    const [c] = await card({ kind: 'basic', front: 'Quando começou a Revolução Francesa?', back: '1789', noteId: n.id, sourceQuote: 'A Revolução Francesa começou em 1789' });
    expect(c).toMatchObject({ noteId: n.id, noteTitle: 'Revolução', topicId: t.id, sourceChanged: false });
    await http.patch(`/notes/${n.id}`, { baseVersion: n.version, content: paragraphs('Texto reescrito sobre outra coisa.') });
    expect((await http.get(`/review/cards/${c.id}`)).body.data.sourceChanged).toBe(true);
  });

  it('edits, suspends and resets with optimistic versions', async () => {
    const t = await topic('X');
    const [c] = await card({ kind: 'basic', front: 'F', back: 'V', topicId: t.id });
    const edited = (await http.patch(`/review/cards/${c.id}`, { baseVersion: 1, front: 'Frente nova' })).body.data;
    expect(edited).toMatchObject({ front: 'Frente nova', version: 2 });
    expect((await http.patch(`/review/cards/${c.id}`, { baseVersion: 1, back: 'x' })).status).toBe(409);
    await http.patch(`/review/cards/${c.id}`, { baseVersion: 2, status: 'suspended' });
    expect((await queue([t.id])).cards).toHaveLength(0);
    expect((await http.del(`/review/cards/${c.id}`)).status).toBe(204);
    expect((await http.get(`/review/cards/${c.id}`)).status).toBe(404);
  });
});

describe('answers and sessions', () => {
  it('schedules with FSRS, brings mistakes back soon and never counts a retried answer twice', async () => {
    const t = await topic('Química');
    const [c] = await card({ kind: 'basic', front: 'H2O', back: 'Água', topicId: t.id });
    const session = (await http.post('/review/sessions', { id: uuidv7(), mode: 'due', topicIds: [t.id], localDay: TODAY })).body.data;
    expect(session).toMatchObject({ mode: 'due', topicIds: [t.id], reviewed: 0 });

    const logId = uuidv7();
    const body = { id: logId, sessionId: session.id, rating: 3, confidence: 2, durationMs: 4000, localDay: TODAY };
    const first = (await http.post(`/review/cards/${c.id}/answer`, body)).body.data;
    expect(first.card.schedule).toMatchObject({ phase: 1, reps: 1 });
    expect(first.log).toMatchObject({ rating: 3, confidence: 2, phaseBefore: 0, sessionId: session.id });
    const retry = (await http.post(`/review/cards/${c.id}/answer`, body)).body.data;
    expect(retry.card.schedule.reps).toBe(1);

    // Wrong with certainty: back to (re)learning, due within minutes.
    const wrong = (await http.post(`/review/cards/${c.id}/answer`, { id: uuidv7(), sessionId: session.id, rating: 1, confidence: 3, localDay: TODAY })).body.data;
    expect(Date.parse(wrong.card.schedule.due) - Date.now()).toBeLessThan(15 * 60_000);

    const summary = (await http.get(`/review/sessions/${session.id}`)).body.data;
    expect(summary).toMatchObject({ items: 1, firstTry: 1, session: { reviewed: 2, correct: 1 } });
    expect(summary.confidentErrors).toEqual([{ cardId: c.id, front: 'H2O' }]);
  });

  it('introduces at most the daily number of new items, one card per group', async () => {
    const t = await topic('Muitos');
    await http.put('/settings/review', { value: { newPerDay: 3 } });
    await card({ kind: 'cloze', front: '{{c1::a}} {{c2::b}} {{c3::c}} texto', topicId: t.id });
    for (let i = 0; i < 4; i++) await card({ kind: 'basic', front: `q${i}`, back: `r${i}`, topicId: t.id });
    const q = await queue([t.id]);
    expect(q.cards).toHaveLength(3);
    expect(q).toMatchObject({ newCount: 7, newLeftToday: 3 });
    expect(new Set(q.cards.map((c: any) => c.groupId)).size).toBe(3);
    // Answering one uses one of today's new items.
    await http.post(`/review/cards/${q.cards[0].id}/answer`, { id: uuidv7(), rating: 3, localDay: TODAY });
    expect((await queue([t.id])).newLeftToday).toBe(2);
    // Only open questions and essays in "questions".
    expect((await queue([t.id], 'questions')).cards).toHaveLength(0);
  });

  it('a session of a minute or more counts in Estudo', async () => {
    const t = await topic('Física');
    const [c] = await card({ kind: 'basic', front: 'F = ?', back: 'm·a', topicId: t.id });
    const session = (await http.post('/review/sessions', { id: uuidv7(), mode: 'due', topicIds: [t.id], localDay: TODAY })).body.data;
    await http.post(`/review/cards/${c.id}/answer`, { id: uuidv7(), sessionId: session.id, rating: 4, localDay: TODAY });
    const done = (await http.post(`/review/sessions/${session.id}/finish`, { seconds: 95 })).body.data;
    expect(done.session).toMatchObject({ seconds: 95, reviewed: 1, correct: 1 });
    expect(done.session.studySessionId).toBeTruthy();
    expect(done.byTopic).toEqual([{ topicId: t.id, title: 'Física', reviewed: 1, correct: 1 }]);
    const study = (await http.get('/study-sessions?limit=10')).body.data;
    expect(study[0]).toMatchObject({ source: 'review', durationSeconds: 95, topicId: t.id });
    expect(study[0].objective).toContain('Revisão');
    // Finishing again does not write a second study session.
    await http.post(`/review/sessions/${session.id}/finish`, { seconds: 100 });
    expect((await http.get('/study-sessions?limit=10')).body.data).toHaveLength(1);
  });

  it('summarizes the day and the history', async () => {
    const t = await topic('Resumo');
    const [c] = await card({ kind: 'basic', front: 'a', back: 'b', topicId: t.id });
    expect((await http.get(`/review/summary?today=${TODAY}`)).body.data).toMatchObject({ due: 0, newAvailable: 1, reviewedToday: 0, streak: 0, total: 1 });
    await http.post(`/review/cards/${c.id}/answer`, { id: uuidv7(), rating: 3, confidence: 3, localDay: TODAY });
    expect((await http.get(`/review/summary?today=${TODAY}`)).body.data).toMatchObject({ reviewedToday: 1, streak: 1 });
    const stats = (await http.get(`/review/stats?today=${TODAY}&tzOffset=-180`)).body.data;
    expect(stats.counts).toMatchObject({ total: 1, learning: 1 });
    expect(stats.forecast).toHaveLength(30);
    expect(stats.forecast[0].count).toBe(1);
    expect(stats.history.at(-1)).toEqual({ day: TODAY, reviews: 1, correct: 1 });
    expect(stats.calibration).toEqual([{ confidence: 3, answers: 1, correct: 1 }]);
    expect(streaks(['2026-10-18', '2026-10-19', '2026-10-21'], '2026-10-21')).toEqual({ current: 1, best: 2 });
    expect(streaks(['2026-10-19', '2026-10-20'], '2026-10-21')).toEqual({ current: 2, best: 2 });
  });
});

/* ----------------------------------------------------------------- AI -- */

const NOTE_TEXT = [
  'A fotossíntese acontece nos cloroplastos das células vegetais.',
  'Ela usa luz, água e gás carbônico para produzir glicose e liberar oxigênio.',
  'A clorofila é o pigmento que absorve a luz.',
];

describe('questions written by the AI from the notes', () => {
  it('keeps only grounded questions and waits for approval', async () => {
    const t = await topic('Botânica');
    const n = await note('Fotossíntese', t.id, ...NOTE_TEXT);
    const items = [
      { kind: 'basic', source: 'N1', front: 'Onde acontece a fotossíntese?', back: 'Nos cloroplastos', keyPoints: [], quote: 'A fotossíntese acontece nos cloroplastos das células vegetais.', connection: false },
      { kind: 'cloze', source: 'N1', front: 'A {{c1::clorofila}} é o pigmento que absorve a luz.', back: '', keyPoints: [], quote: 'A clorofila é o pigmento que absorve a luz.', connection: false },
      // The passage is not in the note: invented.
      { kind: 'basic', source: 'N1', front: 'Quem descobriu a fotossíntese?', back: 'Ingenhousz', keyPoints: [], quote: 'Jan Ingenhousz descobriu a fotossíntese em 1779.', connection: false },
      // The blank hides a word that is not in the note.
      { kind: 'cloze', source: 'N1', front: 'A fotossíntese produz {{c1::amido}}.', back: '', keyPoints: [], quote: 'para produzir glicose e liberar oxigênio', connection: false },
      { kind: 'essay', source: 'N1', front: 'Explique o que a fotossíntese usa e o que produz.', back: 'Usa luz, água e CO2; produz glicose e oxigênio.', keyPoints: ['luz, água e gás carbônico', 'glicose', 'oxigênio'], quote: 'Ela usa luz, água e gás carbônico para produzir glicose e liberar oxigênio.', connection: false },
      // A repeated question.
      { kind: 'basic', source: 'N1', front: 'Onde acontece a fotossíntese?', back: 'Cloroplastos', keyPoints: [], quote: 'A fotossíntese acontece nos cloroplastos', connection: false },
      // A source that does not exist.
      { kind: 'basic', source: 'N9', front: 'Pergunta qualquer aqui', back: 'x', keyPoints: [], quote: 'A clorofila é o pigmento', connection: false },
    ];
    const { bodies } = mockOpenAI([answer(JSON.stringify({ items }))]);
    const res = await http.post('/review/generate', { topicIds: [t.id], kinds: ['basic', 'cloze', 'essay'], count: 8 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const gen = res.body.data;
    expect(gen.proposals.map((p: any) => p.front)).toEqual([
      'Onde acontece a fotossíntese?',
      'A {{c1::clorofila}} é o pigmento que absorve a luz.',
      'Explique o que a fotossíntese usa e o que produz.',
    ]);
    expect(gen).toMatchObject({ discarded: 4, notesRead: 1 });
    expect(gen.proposals[0]).toMatchObject({ noteId: n.id, noteTitle: 'Fotossíntese', topicId: t.id, origin: 'ai' });
    expect(bodies[0].text.format.name).toBe('review_questions');
    expect(bodies[0].input[0].content).toContain('[N1] Fotossíntese');
    expect(bodies[0].instructions).toContain('SOMENTE');

    // Nothing enters the reviews before approval.
    expect((await queue([t.id])).cards).toHaveLength(0);
    expect((await http.get(`/review/scope?today=${TODAY}&topicIds=${t.id}`)).body.data.proposals).toBe(3);

    const [p1, p2, p3] = gen.proposals;
    const decided = (await http.post('/review/proposals/decide', { accept: [{ id: p1.id, back: 'Nos cloroplastos (células vegetais)' }, { id: p3.id }], discard: [p2.id] })).body.data;
    expect(decided.discarded).toBe(1);
    expect(decided.created.map((c: any) => [c.kind, c.origin, c.back])).toEqual([
      ['basic', 'ai', 'Nos cloroplastos (células vegetais)'],
      ['essay', 'ai', 'Usa luz, água e CO2; produz glicose e oxigênio.'],
    ]);
    expect(decided.created[1].sourceChanged).toBe(false);
    expect((await http.get('/review/proposals')).body.data).toHaveLength(0);
    expect((await queue([t.id])).cards).toHaveLength(2);

    // The call is in the daily AI spend.
    const spend = await env.DB.prepare('SELECT requests FROM ai_usage_daily WHERE user_id = ?').bind(userId).first<{ requests: number }>();
    expect(spend?.requests).toBe(1);
  });

  it('asks about links between notes when the focus is connections', async () => {
    const t = await topic('Economia');
    const a = await note('Inflação', t.id, 'A inflação é o aumento generalizado dos preços.');
    const b = await note('Juros', t.id, 'O banco central sobe os juros para conter a inflação.');
    // Without links there is nothing to ask.
    expect((await http.post('/review/generate', { topicIds: [t.id], kinds: ['open'], focus: 'connections' })).status).toBe(400);
    const rel = await http.post('/relations', { sourceType: 'note', sourceId: b.id, targetType: 'note', targetId: a.id, kind: 'depends_on' });
    expect(rel.status, JSON.stringify(rel.body)).toBe(201);
    const items = [
      { kind: 'open', source: 'N1', front: 'Por que o banco central sobe os juros quando há inflação?', back: 'Para conter o aumento dos preços.', keyPoints: ['conter a inflação'], quote: 'O banco central sobe os juros para conter a inflação.', connection: true },
    ];
    const { bodies } = mockOpenAI([answer(JSON.stringify({ items }))]);
    const genRes = await http.post('/review/generate', { topicIds: [t.id], kinds: ['open'], focus: 'connections' });
    expect(genRes.status, JSON.stringify(genRes.body)).toBe(200);
    const gen = genRes.body.data;
    expect(bodies[0].input[0].content).toMatch(/L1: \[N\d\] depende de \[N\d\]/);
    expect(gen.proposals[0]).toMatchObject({ origin: 'relation', kind: 'open' });
  });

  it('validates generated items without the model (unit)', () => {
    const sources = [{ ref: 'N1', type: 'note' as const, id: uuidv7(), title: 'T', topicId: null, text: 'O coração bombeia o sangue pelo corpo inteiro.' }];
    const base = { back: 'x', keyPoints: [], connection: false };
    const { valid, discarded } = validGenerated(
      [
        { ...base, kind: 'basic', source: '[n1]', front: 'O que o coração faz?', quote: 'o coracao bombeia o sangue' },
        { ...base, kind: 'essay', source: 'N1', front: 'Explique o coração.', quote: 'O coração bombeia o sangue', keyPoints: ['um só'] },
      ],
      sources,
      ['basic', 'essay'],
      new Set(),
      5,
    );
    expect(valid).toHaveLength(1);
    expect(discarded).toBe(1);
  });
});

describe('corrections by the AI (only against the notes)', () => {
  it('scores by key points, subtracts contradictions and suggests a rating', async () => {
    const t = await topic('Botânica');
    const n = await note('Fotossíntese', t.id, ...NOTE_TEXT);
    const [c] = await card({
      kind: 'essay',
      front: 'Explique a fotossíntese.',
      back: 'Usa luz, água e gás carbônico para produzir glicose e oxigênio.',
      keyPoints: ['usa luz, água e gás carbônico', 'produz glicose', 'libera oxigênio', 'acontece nos cloroplastos'],
      noteId: n.id,
      sourceQuote: NOTE_TEXT[1],
    });
    const model = {
      points: [
        { point: 'usa luz, água e gás carbônico', status: 'covered', evidence: '“usa luz e água e CO2”' },
        { point: 'produz glicose', status: 'covered', evidence: '“faz glicose”' },
        { point: 'libera oxigênio', status: 'partial', evidence: '“solta um gás”' },
        { point: 'acontece nos cloroplastos', status: 'missing', evidence: 'Não disse onde acontece.' },
      ],
      errors: [{ claim: 'acontece nas raízes', correction: 'Acontece nos cloroplastos das células vegetais.' }],
      noteIssue: null,
      modelAnswer: 'A fotossíntese usa luz, água e gás carbônico para produzir glicose e liberar oxigênio, nos cloroplastos.',
      feedback: 'Você lembrou o essencial; faltou dizer onde acontece.',
    };
    const { bodies } = mockOpenAI([answer(JSON.stringify(model))]);
    const res = await http.post(`/review/cards/${c.id}/evaluate`, { answer: 'Ela usa luz e água e CO2, faz glicose e solta um gás; acontece nas raízes.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // (1 + 1 + 0.5 + 0) / 4 = 62.5 → 63, minus 15 for one contradiction = 48.
    expect(res.body.data).toMatchObject({ score: 48, suggestedRating: 1, noteIssue: null });
    expect(bodies[0].instructions).toContain('SOMENTE as notas');
    expect(bodies[0].input[0].content).toContain('Nota “Fotossíntese” (referência)');
    expect(bodies[0].input[0].content).toContain('acontece nos cloroplastos');

    // The user disagrees and saves another rating with the correction attached.
    const saved = (await http.post(`/review/cards/${c.id}/answer`, { id: uuidv7(), rating: 2, answer: 'texto', score: 48, evaluation: res.body.data, disputed: true, localDay: TODAY })).body.data;
    expect(saved.log).toMatchObject({ rating: 2, score: 48, disputed: true });
    expect(saved.log.evaluation.points).toHaveLength(4);

    // Flashcards are not corrected by the AI.
    const [basic] = await card({ kind: 'basic', front: 'a', back: 'b', topicId: t.id });
    expect((await http.post(`/review/cards/${basic.id}/evaluate`, { answer: 'b' })).status).toBe(400);
    expect(scoreOf([{ status: 'covered' }, { status: 'covered' }], 0)).toBe(100);
    expect(scoreOf([{ status: 'covered' }], 5)).toBe(55);
  });

  it('compares free recall with the notes and keeps only verified ideas', async () => {
    const t = await topic('Botânica');
    const n = await note('Fotossíntese', t.id, ...NOTE_TEXT);
    const model = {
      ideas: [
        { idea: 'Acontece nos cloroplastos', status: 'covered', source: 'N1', quote: 'A fotossíntese acontece nos cloroplastos', evidence: 'nos cloroplastos' },
        { idea: 'Produz glicose e oxigênio', status: 'partial', source: 'N1', quote: 'para produzir glicose e liberar oxigênio', evidence: 'produz açúcar' },
        { idea: 'A clorofila absorve a luz', status: 'missing', source: 'N1', quote: 'A clorofila é o pigmento que absorve a luz.', evidence: '' },
        { idea: 'Inventada', status: 'missing', source: 'N1', quote: 'Algo que não está na nota de jeito nenhum.', evidence: '' },
      ],
      errors: [],
      summary: 'Você lembra onde acontece; reveja o papel da clorofila.',
    };
    mockOpenAI([answer(JSON.stringify(model))]);
    const res = await http.post('/review/recalls', { id: uuidv7(), topicId: t.id, text: 'A fotossíntese acontece nos cloroplastos e produz açúcar.', localDay: TODAY });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const recall = res.body.data;
    expect(recall.evaluation.ideas.map((i: any) => i.idea)).toEqual(['Acontece nos cloroplastos', 'Produz glicose e oxigênio', 'A clorofila absorve a luz']);
    expect(recall.evaluation.ideas[0]).toMatchObject({ noteId: n.id, noteTitle: 'Fotossíntese' });
    expect(recall.coverage).toBe(50);
    expect((await http.get(`/review/recalls?topicId=${t.id}`)).body.data).toHaveLength(1);
  });

  it('helps with a leech and varies questions already answered', async () => {
    const t = await topic('Difícil');
    const [c] = await card({ kind: 'open', front: 'Quais são as fases da mitose?', back: 'Prófase, metáfase, anáfase e telófase', keyPoints: ['prófase', 'metáfase', 'anáfase', 'telófase'], topicId: t.id });
    mockOpenAI([
      answer(JSON.stringify({ diagnosis: 'Quatro informações num cartão só.', rewrite: null, split: [{ front: 'Primeira fase da mitose?', back: 'Prófase' }], mnemonic: 'PROMETA ANA TELA' })),
      answer(JSON.stringify({ items: [{ id: 'Q1', prompt: 'Cite, em ordem, as etapas da divisão por mitose.' }] })),
    ]);
    const help = (await http.post(`/review/cards/${c.id}/help`, {})).body.data;
    expect(help).toMatchObject({ rewrite: null, mnemonic: 'PROMETA ANA TELA', split: [{ front: 'Primeira fase da mitose?', back: 'Prófase' }] });
    // Never answered: no variant (no call).
    expect((await http.post('/review/variants', { cardIds: [c.id] })).body.data).toEqual({ variants: [] });
    await http.post(`/review/cards/${c.id}/answer`, { id: uuidv7(), rating: 3, localDay: TODAY });
    expect((await http.post('/review/variants', { cardIds: [c.id] })).body.data).toEqual({ variants: [{ cardId: c.id, prompt: 'Cite, em ordem, as etapas da divisão por mitose.' }] });
  });
});

/* --------------------------------------------------------- assistant -- */

describe('the assistant and Revisar', () => {
  beforeEach(() => installSemanticFakes());
  const send = (message: string) => http.post('/ai/chat', { messageId: uuidv7(), message });

  it('proposes cards from a note, always waiting for confirmation, and refuses invented passages', async () => {
    const t = await topic('Botânica');
    const n = await note('Fotossíntese', t.id, ...NOTE_TEXT);
    const good = { kind: 'cloze', front: 'A {{c1::clorofila}} absorve a luz.', back: '', key_points: [], quote: 'A clorofila é o pigmento que absorve a luz.' };
    const invented = { kind: 'basic', front: 'Quem descobriu?', back: 'Ingenhousz', key_points: [], quote: 'Jan Ingenhousz descobriu a fotossíntese.' };
    const { bodies } = mockOpenAI([
      callTools(['create_review_cards', { note_id: n.id, cards: [good, invented], mode: 'execute' }]),
      callTools(['create_review_cards', { note_id: n.id, cards: [good], mode: 'execute' }]),
      answer('Confirme os cartões abaixo.'),
    ]);
    const res = await send('Crie cartões desta nota sobre fotossíntese');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(toolOutputs(bodies[1])[0]).toMatchObject({ error: 'quote_not_found' });
    // Even when the model asked to execute, the user decides.
    expect(toolOutputs(bodies[2])[1].status).toBe('awaiting_confirmation');
    expect((await queue([t.id])).cards).toHaveLength(0);
    const action = res.body.data.actions[0];
    const done = await http.post(`/ai/actions/${action.id}/confirm`);
    expect(done.body.data.action.status).toBe('executed');
    const cards = (await queue([t.id])).cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'cloze', origin: 'ai', noteId: n.id });
  });

  it('tells what is due today', async () => {
    const t = await topic('Agenda');
    await card({ kind: 'basic', front: 'a', back: 'b', topicId: t.id });
    const { bodies } = mockOpenAI([callTools(['get_review_status', {}]), answer('Você tem 1 item novo.')]);
    await send('o que tenho para revisar hoje?');
    expect(toolOutputs(bodies[1])[0]).toMatchObject({ due_now: 0, new_available_today: 1, active_items: 1, app_link: '/review' });
  });
});

/* -------------------------------------------------------------- push -- */

describe('daily review reminder', () => {
  async function keys() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    return { publicKey: toBase64Url(raw), privateKey: jwk.d! };
  }
  async function browserKeys() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    return { p256dh: toBase64Url(pub), auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
  }

  it('reminds after the chosen time when items are due and nothing was reviewed that day', async () => {
    const k = await keys();
    (env as any).VAPID_PUBLIC_KEY = k.publicKey;
    (env as any).VAPID_PRIVATE_KEY = k.privateKey;
    try {
      const t = await topic('Lembrete');
      await card({ kind: 'basic', front: 'a', back: 'b', topicId: t.id });
      await http.post('/speech/push/subscriptions', { endpoint: `https://push.example.com/${uuidv7()}`, keys: await browserKeys() });
      await http.put('/settings/review', { value: { reminder: { enabled: true, time: '08:00', tzOffsetMinutes: -180 } } });
      const sent: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        sent.push(String(input));
        return new Response(null, { status: 201 });
      });
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      await runReviewReminders(env, Date.parse(`${day}T10:30:00Z`) - 3 * 3600_000); // 04:30 local: too early
      await runReviewReminders(env, Date.parse(`${day}T11:30:00Z`)); // 08:30 local
      await runReviewReminders(env, Date.parse(`${day}T12:30:00Z`)); // once a day
      expect(sent).toHaveLength(1);
    } finally {
      delete (env as any).VAPID_PUBLIC_KEY;
      delete (env as any).VAPID_PRIVATE_KEY;
    }
  });
});
