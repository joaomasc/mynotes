import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_XP, computeSpeechMetrics, lessonXp, LEVEL_1, uuidv7, type SpeechWord } from '@mynotes/shared';
import { client, setupOwner } from './helpers';
import { answer, mockOpenAI } from './openai-mock';

/*
 * The speaking path on the server: XP computed from the content, challenge
 * goals checked on the stored talk, skills, streak, daily theme, settings.
 */

let http: ReturnType<typeof client>;

beforeEach(async () => {
  http = client((await setupOwner()).token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TODAY = '2026-10-20';

/** `count` words at `wpm`, in sentences of `perSentence` words. */
function talk(count: number, wpm: number, perSentence = 10): SpeechWord[] {
  const step = 60 / wpm;
  return Array.from({ length: count }, (_, i) => ({
    text: (i + 1) % perSentence === 0 ? 'fim.' : 'palavra',
    start: i * step,
    end: i * step + step * 0.9,
  }));
}

async function saveTalk(words: SpeechWord[], extra: Record<string, unknown> = {}) {
  const metrics = computeSpeechMetrics({ frames: [], words, segments: [], targetSeconds: null });
  const res = await http.post('/speech/attempts', {
    id: uuidv7(),
    mode: 'free',
    speechType: 'explain',
    theme: 'Teste',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    localDay: TODAY,
    transcript: words.map((w) => w.text).join(' '),
    words,
    segments: [],
    timeline: { step: 0.1, db: [], f0: [] },
    metrics,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

const practice = (body: Record<string, unknown>) => http.post('/speech/practice', { id: uuidv7(), localDay: TODAY, seconds: 120, ...body });

describe('speaking path', () => {
  it('starts empty, with a general theme while there are no notes', async () => {
    const res = await http.get(`/speech/path?today=${TODAY}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      today: TODAY,
      completed: [],
      skills: [],
      totalXp: 0,
      streak: { current: 0, todayDone: false },
      noteTopic: null,
      daily: { note: null },
      warmupDone: false,
      settings: { dailyGoalMinutes: 10 },
    });
    expect(res.body.data.week).toHaveLength(7);
  });

  it('completes a lesson with XP computed from the content, only once per practice id', async () => {
    const lesson = LEVEL_1.units[0]!.lessons[0]!;
    const results = lesson.exercises.map(() => true);
    const body = { id: uuidv7(), kind: 'lesson', refId: lesson.id, results, localDay: TODAY, seconds: 300 };
    const res = await http.post('/speech/practice', body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ xp: lessonXp(lesson, results), passed: true, completedNow: true });
    const state = res.body.data.state;
    expect(state.completed).toEqual([lesson.id]);
    expect(state.todaySeconds).toBe(300);
    expect(state.streak).toMatchObject({ current: 1, todayDone: true });
    expect(state.skills.map((s: any) => s.skill).sort()).toEqual([...lesson.skills].sort());

    const again = await http.post('/speech/practice', body);
    expect(again.body.data.state.totalXp).toBe(lessonXp(lesson, results));

    // Wrong number of results, unknown lesson.
    expect((await practice({ kind: 'lesson', refId: lesson.id, results: [true] })).status).toBe(400);
    expect((await practice({ kind: 'lesson', refId: 'u99-l1', results: [] })).status).toBe(400);
  });

  it('does not complete a lesson whose talk missed its goals', async () => {
    const lesson = LEVEL_1.units[1]!.lessons[1]!;
    const results = lesson.exercises.map((e) => e.type !== 'shortTalk');
    const res = await practice({ kind: 'lesson', refId: lesson.id, results });
    expect(res.body.data).toMatchObject({ passed: false, completedNow: false });
    expect(res.body.data.state.completed).toEqual([]);
  });

  it('checks a challenge on the stored talk, not on what the browser says', async () => {
    // u2-desafio: 125–165 words/min, sentences up to 25 words, at least 1 minute.
    const good = await saveTalk(talk(180, 150), { lessonId: 'u2-desafio' });
    const res = await practice({ kind: 'challenge', refId: 'u2-desafio', attemptId: good.id });
    expect(res.body.data).toMatchObject({ passed: true, xp: CHALLENGE_XP, completedNow: true });
    expect(res.body.data.state.completed).toContain('u2-desafio');

    const rushed = await saveTalk(talk(250, 200), { lessonId: 'u2-desafio' });
    const res2 = await practice({ kind: 'challenge', refId: 'u2-desafio', attemptId: rushed.id });
    expect(res2.body.data).toMatchObject({ passed: false, completedNow: false });

    expect((await practice({ kind: 'challenge', refId: 'u2-desafio' })).status).toBe(400);
    expect((await practice({ kind: 'levelChallenge', refId: 'u2-desafio', attemptId: good.id })).status).toBe(400);
  });

  it('a passed level challenge completes the whole level', async () => {
    const t = await saveTalk(talk(375, 150, 12));
    const res = await practice({ kind: 'levelChallenge', refId: 'n1-desafio', attemptId: t.id });
    expect(res.body.data.passed).toBe(true);
    expect(res.body.data.state.completed).toEqual(['n1-desafio']);
  });

  it('daily talks train the skills the rubric judged, and count for the streak', async () => {
    const t = await saveTalk(talk(150, 150));
    await http.post('/speech/practice', { id: uuidv7(), kind: 'warmup', localDay: '2026-10-19', seconds: 120, results: [true, true] });
    const res = await practice({ kind: 'daily', attemptId: t.id });
    const s = res.body.data.state;
    expect(res.body.data.xp).toBe(20);
    expect(s.dailyDone).toBe(true);
    expect(s.streak).toMatchObject({ current: 2, todayDone: true });
    expect(s.skills.find((x: any) => x.skill === 'pace')).toMatchObject({ xp: 10, nextReviewOn: '2026-10-21' });
    expect(s.week.at(-2)).toEqual({ day: '2026-10-19', xp: 10 });
  });

  it('reviews a skill', async () => {
    const res = await practice({ kind: 'review', refId: 'pauses', results: [true, true, false, true] });
    expect(res.body.data).toMatchObject({ passed: true, xp: 25 });
    expect((await practice({ kind: 'review', refId: 'voar', results: [true] })).status).toBe(400);
  });

  it('offers a note to explain when there are notes', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto longo. '.repeat(30) }] }] };
    const note = (await http.post('/notes', { title: 'Mercantilismo', topicId: null, content: doc })).body.data;
    const res = await http.get(`/speech/path?today=${TODAY}`);
    expect(res.body.data.noteTopic).toEqual({ noteId: note.id, title: 'Mercantilismo', topicId: null });
  });

  it('applies the calibrated limits to new talks', async () => {
    const before = await saveTalk(talk(155, 155));
    expect(before.measured.find((m: any) => m.id === 'pace').state).toBe('good');
    const put = await http.put('/settings/speech', { value: { dailyGoalMinutes: 15, limits: { paceMin: 120, paceMax: 140, pvqGood: null, finalDropDb: null } } });
    expect(put.status).toBe(200);
    const after = await saveTalk(talk(155, 155));
    expect(after.measured.find((m: any) => m.id === 'pace')).toMatchObject({ state: 'attention', reference: '120 a 140 palavras/min' });
    expect((await http.get(`/speech/path?today=${TODAY}`)).body.data.settings.dailyGoalMinutes).toBe(15);
  });
});

describe('written exercise feedback', () => {
  it('asks the model for a verdict and a better version', async () => {
    const { bodies } = mockOpenAI([answer(JSON.stringify({ verdict: 'almost', feedback: 'Boa, mas ainda tem um “né”.', suggestion: 'Precisamos revisar até sexta.' }))]);
    const res = await http.post('/speech/feedback', {
      kind: 'fix',
      instruction: 'Tire os vícios.',
      context: 'Então, tipo, a gente, né, precisa revisar.',
      answer: 'A gente, né, precisa revisar até sexta.',
      method: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verdict: 'almost', feedback: 'Boa, mas ainda tem um “né”.', suggestion: 'Precisamos revisar até sexta.' });
    expect(bodies[0].text.format.name).toBe('exercise_feedback');
    expect(bodies[0].input[0].content).toContain('Resposta do estudante: A gente, né, precisa revisar até sexta.');
  });
});
