import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLES,
  LEVEL_1,
  METHOD_IDS,
  SPEECH_METHODS,
  SPEECH_PATH,
  addDays,
  alignWords,
  calibratedLimits,
  checkGoals,
  checkReading,
  computeSpeechMetrics,
  computeStreak,
  dueSkills,
  isoWeek,
  lessonPassed,
  lessonXp,
  nextStep,
  parseReadText,
  pathProgress,
  plainReadText,
  practiceSkill,
  reviewLesson,
  warmupFor,
  type AcousticFrame,
  type SkillState,
  type SpeechWord,
} from '../src';

const words = (text: string, start = 0, step = 0.4): SpeechWord[] =>
  text.split(/\s+/).map((w, i) => ({ text: w, start: start + i * step, end: start + i * step + step * 0.9 }));

describe('speaking path content', () => {
  it('has unique, stable ids and valid exercises', () => {
    const ids = SPEECH_PATH.flatMap((l) => [l.id, l.challenge.id, ...l.units.flatMap((u) => [u.id, u.challenge.id, ...u.lessons.map((x) => x.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const unit of SPEECH_PATH.flatMap((l) => l.units)) {
      expect(unit.lessons.length).toBeGreaterThanOrEqual(2);
      for (const e of unit.lessons.flatMap((l) => l.exercises)) {
        if (e.type === 'recognize') expect(e.answer).toBeLessThan(e.options.length);
        if (e.type === 'readAloud') expect(parseReadText(e.text).words.length).toBeGreaterThan(2);
        if ('method' in e && e.method) expect(METHOD_IDS).toContain(e.method);
      }
    }
    for (const m of Object.values(SPEECH_METHODS)) expect(m.parts.length).toBeGreaterThanOrEqual(3);
  });

  it('walks the path in order and lets a level challenge skip the level', () => {
    expect(nextStep(new Set())).toMatchObject({ kind: 'lesson', lesson: { id: 'u1-l1' } });
    expect(nextStep(new Set(['u1-l1', 'u1-l2', 'u1-l3']))).toMatchObject({ kind: 'challenge', challenge: { id: 'u1-desafio' } });
    expect(nextStep(new Set(['u1-l1', 'u1-l2', 'u1-l3', 'u1-desafio']))).toMatchObject({ kind: 'lesson', lesson: { id: 'u2-l1' } });
    const allUnits = new Set(LEVEL_1.units.map((u) => u.challenge.id));
    expect(nextStep(allUnits)).toMatchObject({ kind: 'levelChallenge' });
    expect(nextStep(new Set(['n1-desafio']))).toMatchObject({ kind: 'lesson', lesson: { id: 'u6-l1' } });
    expect(nextStep(new Set(['n1-desafio', 'n2-desafio', 'n3-desafio']))).toBeNull();
    expect(pathProgress(new Set(['n1-desafio', 'n2-desafio', 'n3-desafio']))).toBe(1);
    expect(SPEECH_PATH.flatMap((l) => l.units).map((u) => u.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(pathProgress(new Set())).toBe(0);
  });

  it('passes a lesson when the talk met its goals and most exercises were right', () => {
    const lesson = LEVEL_1.units[1]!.lessons[1]!; // concept, recognize, readAloud, shortTalk
    expect(lessonPassed(lesson.exercises, [true, false, true, true])).toBe(true);
    expect(lessonPassed(lesson.exercises, [true, true, true, false])).toBe(false);
    expect(lessonPassed(lesson.exercises, [false, false, true, true])).toBe(false);
    expect(lessonXp(lesson, [true, true, true, true])).toBe(2 + 5 + 10 + 20 + 10);
  });
});

describe('streak', () => {
  it('counts consecutive days and keeps today open', () => {
    expect(computeStreak(['2026-10-18', '2026-10-19'], '2026-10-20')).toMatchObject({ current: 2, todayDone: false });
    expect(computeStreak(['2026-10-18', '2026-10-19', '2026-10-20'], '2026-10-20')).toMatchObject({ current: 3, todayDone: true, best: 3 });
  });

  it('forgives one missed day per week, never two in a row', () => {
    // Wed, Thu, (Fri missed), Sat, Sun — same ISO week.
    const s = computeStreak(['2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18'], '2026-10-18');
    expect(s).toMatchObject({ current: 4, frozen: ['2026-10-16'] });
    // Two misses in a row break it.
    expect(computeStreak(['2026-10-14', '2026-10-17'], '2026-10-17').current).toBe(1);
    // A second miss in the same week breaks it too.
    expect(computeStreak(['2026-10-12', '2026-10-14', '2026-10-16'], '2026-10-16').current).toBe(1);
  });

  it('remembers the best streak', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-10'];
    expect(computeStreak(days, '2026-10-10')).toMatchObject({ current: 1, best: 4 });
  });

  it('knows ISO weeks', () => {
    expect(isoWeek('2026-10-19')).toBe('2026-W43');
    expect(isoWeek('2026-10-18')).toBe('2026-W42');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('skills and reviews', () => {
  it('levels up with practice and schedules the next review', () => {
    let s: SkillState = { skill: 'fillers', xp: 0, level: 0, lastPracticedOn: null, nextReviewOn: null };
    s = practiceSkill(s, true, '2026-10-20');
    expect(s).toMatchObject({ xp: 10, level: 0, nextReviewOn: '2026-10-21' });
    s = practiceSkill(s, true, '2026-10-21');
    expect(s).toMatchObject({ xp: 20, level: 1, nextReviewOn: '2026-10-23' });
    s = practiceSkill(s, false, '2026-10-23');
    expect(s.nextReviewOn).toBe('2026-10-24');
    expect(dueSkills([s], '2026-10-24').map((x) => x.skill)).toEqual(['fillers']);
    expect(dueSkills([s], '2026-10-23')).toEqual([]);
  });

  it('builds a review lesson from what was already taught, ending with a talk', () => {
    expect(reviewLesson('pauses', '2026-10-20', new Set())).toBeNull();
    const lesson = reviewLesson('pauses', '2026-10-20', new Set(['u3-l1', 'u3-l2', 'u3-l3']))!;
    expect(lesson.exercises.length).toBeGreaterThanOrEqual(2);
    expect(lesson.exercises.at(-1)!.type).toBe('shortTalk');
    expect(lesson.exercises.some((e) => e.type === 'concept')).toBe(false);
  });

  it('gives a daily warm-up that stays the same all day', () => {
    expect(warmupFor('2026-10-20')).toEqual(warmupFor('2026-10-20'));
    expect(warmupFor('2026-10-20', ['pitchVariation'])[2]!.type).toBe('readAloud');
    expect(warmupFor('2026-10-20', ['articulation'])).toHaveLength(5);
  });
});

describe('reading aloud', () => {
  it('parses pauses, emphasis and the ending', () => {
    const t = parseReadText('A reunião é *amanhã*, | não hoje. ↘');
    expect(t).toEqual({ words: ['A', 'reunião', 'é', 'amanhã,', 'não', 'hoje.'], pauses: [3], emphasis: [3], ending: 'falling' });
    expect(plainReadText('Esse é o plano? ↗')).toBe('Esse é o plano?');
  });

  it('aligns the reading with the transcript and finds skipped words', () => {
    const { match, missed, accuracy } = alignWords(['O', 'rato', 'roeu', 'a', 'roupa', 'do', 'rei'], words('o rato reu a roupa do rei'));
    expect(missed).toEqual([2]);
    expect(match[4]).toBe(4);
    expect(accuracy).toBeCloseTo(6 / 7);
  });

  it('checks the marked pause, emphasis and falling ending from the audio', () => {
    const said = [
      { text: 'Não', start: 0, end: 0.4 },
      { text: 'é', start: 0.5, end: 0.7 },
      { text: 'o', start: 0.8, end: 0.9 },
      { text: 'preço,', start: 1, end: 1.6 },
      { text: 'é', start: 2.4, end: 2.6 },
      { text: 'o', start: 2.7, end: 2.8 },
      { text: 'prazo.', start: 2.9, end: 3.6 },
    ];
    const frames: AcousticFrame[] = Array.from({ length: 200 }, (_, i) => {
      const t = i * 0.02;
      const voiced = t < 1.6 || (t >= 2.4 && t < 3.6);
      const loud = t >= 1 && t < 1.6; // “preço” stressed
      const f0 = t >= 3.15 && t < 3.6 ? 180 * 2 ** ((-8 * (t - 3.15)) / 0.45 / 12) : 180;
      return { voiced, db: voiced ? (loud ? -14 : -20) : -70, f0: voiced ? f0 : null };
    });
    const { checks, accuracy } = checkReading('Não é o *preço*, | é o prazo. ↘', said, frames);
    expect(accuracy).toBe(1);
    expect(checks.map((c) => [c.label, c.passed])).toEqual([
      ['Pausa depois de “preço,”', true],
      ['Ênfase em “preço,”', true],
      ['Final da frase descendo', true],
    ]);
  });
});

describe('goals and calibration', () => {
  const m = computeSpeechMetrics({ frames: [], words: words(Array.from({ length: 100 }, () => 'palavra').join(' ') + ' né né.', 0, 0.42), segments: [], targetSeconds: null });

  it('checks goals over the metrics, leaving the model-judged ones for later', () => {
    const { results, passed } = checkGoals(
      [{ metric: 'wpm', min: 130, max: 160 }, { metric: 'fillersPerMinute', max: 3 }, { metric: 'criterion', id: 'centralIdea', atLeast: 'good' }],
      m,
      null,
    );
    expect(results.map((r) => r.passed)).toEqual([true, true, null]);
    expect(passed).toBe(true);
    expect(checkGoals([{ metric: 'criterion', id: 'centralIdea', atLeast: 'good' }], m, null).passed).toBe(false);
    expect(checkGoals([], m, null).passed).toBe(true);
  });

  it('applies the calibrated limits', () => {
    const l = calibratedLimits({ paceMin: 120, paceMax: 150, pvqGood: 0.12, finalDropDb: null });
    expect(l.paceGood).toEqual([120, 150]);
    expect(l.paceAttention).toEqual([100, 170]);
    expect(l.pvqGood).toBe(0.12);
    expect(l.finalDropDb).toBe(6);
  });

  it('backs up every setting the app saves', () => {
    for (const key of ['ui', 'notes', 'study_timer', 'study_goals', 'speech']) {
      expect(BACKUP_TABLES.settings.row.safeParse({ key, value: '{}', version: 1, updated_at: '2026-10-20T00:00:00.000Z' }).success).toBe(true);
    }
  });
});
