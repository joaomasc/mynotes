import type { Challenge, Exercise, ExerciseType, Lesson, Level, Unit } from './curriculum';
import { LEVEL_1 } from './content/level1';
import { DAILY_TOPICS } from './content/topics';
import { dayIndex } from './content/warmups';
import type { MethodId } from './methods';
import { REVIEW_INTERVAL_DAYS, SKILL_MAX_LEVEL, skillLevel, type SkillId } from './skills';

/**
 * The path and the rules of progress (docs/oratoria-trilha.md › Progresso):
 * XP, the daily streak with one free day per week, what comes next, skill
 * levels and reviews. Pure functions shared by the API (which stores) and
 * the app (which shows).
 */

export const SPEECH_PATH: Level[] = [LEVEL_1];

export const PRACTICE_KINDS = ['lesson', 'challenge', 'levelChallenge', 'review', 'warmup', 'daily', 'free'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

export const EXERCISE_XP: Record<ExerciseType, number> = {
  concept: 2,
  recognize: 5,
  breathing: 5,
  fix: 10,
  build: 10,
  readAloud: 10,
  articulation: 10,
  shortTalk: 20,
};
export const LESSON_BONUS_XP = 10;
export const CHALLENGE_XP = 40;
export const LEVEL_CHALLENGE_XP = 80;
export const DAILY_TALK_XP = 20;
export const FREE_TALK_XP = 15;

/* ------------------------------------------------------------ lookup -- */

export function allUnits(path: Level[] = SPEECH_PATH): { level: Level; unit: Unit }[] {
  return path.flatMap((level) => level.units.map((unit) => ({ level, unit })));
}

export function findLesson(id: string, path: Level[] = SPEECH_PATH): { level: Level; unit: Unit; lesson: Lesson } | null {
  for (const { level, unit } of allUnits(path)) {
    const lesson = unit.lessons.find((l) => l.id === id);
    if (lesson) return { level, unit, lesson };
  }
  return null;
}

/** A unit challenge (unit set) or a level challenge (unit null). */
export function findChallenge(id: string, path: Level[] = SPEECH_PATH): { level: Level; unit: Unit | null; challenge: Challenge } | null {
  for (const level of path) {
    if (level.challenge.id === id) return { level, unit: null, challenge: level.challenge };
    for (const unit of level.units) if (unit.challenge.id === id) return { level, unit, challenge: unit.challenge };
  }
  return null;
}

/** Skills a challenge trains: the unit's, or every skill of the level. */
export function challengeSkills(id: string): SkillId[] {
  const found = findChallenge(id);
  if (!found) return [];
  if (found.unit) return found.unit.skills;
  return [...new Set(found.level.units.flatMap((u) => u.skills))];
}

/* ---------------------------------------------------------- progress -- */

/** Ids of what was completed: lessons, unit challenges and level challenges. */
export type CompletedSet = ReadonlySet<string>;

export type NextStep =
  | { kind: 'lesson'; level: Level; unit: Unit; lesson: Lesson }
  | { kind: 'challenge'; level: Level; unit: Unit; challenge: Challenge }
  | { kind: 'levelChallenge'; level: Level; challenge: Challenge }
  | null;

/** A level is done when its level challenge was passed (which also skips its units). */
export const levelDone = (level: Level, done: CompletedSet) => done.has(level.challenge.id);
export const unitDone = (level: Level, unit: Unit, done: CompletedSet) => levelDone(level, done) || done.has(unit.challenge.id);
export const lessonDone = (level: Level, lessonId: string, done: CompletedSet) => levelDone(level, done) || done.has(lessonId);

/** The first thing not done yet, in path order. */
export function nextStep(done: CompletedSet, path: Level[] = SPEECH_PATH): NextStep {
  for (const level of path) {
    if (levelDone(level, done)) continue;
    for (const unit of level.units) {
      if (unitDone(level, unit, done)) continue;
      const lesson = unit.lessons.find((l) => !done.has(l.id));
      if (lesson) return { kind: 'lesson', level, unit, lesson };
      return { kind: 'challenge', level, unit, challenge: unit.challenge };
    }
    return { kind: 'levelChallenge', level, challenge: level.challenge };
  }
  return null;
}

/** Share of the path done (0–1), counting lessons and challenges. */
export function pathProgress(done: CompletedSet, path: Level[] = SPEECH_PATH): number {
  let total = 0;
  let ok = 0;
  for (const level of path) {
    for (const unit of level.units) {
      for (const l of unit.lessons) {
        total++;
        if (lessonDone(level, l.id, done)) ok++;
      }
      total++;
      if (unitDone(level, unit, done)) ok++;
    }
    total++;
    if (levelDone(level, done)) ok++;
  }
  return total ? ok / total : 0;
}

/** Methods taught by the units already done (the last one is offered first). */
export function learnedMethods(done: CompletedSet, path: Level[] = SPEECH_PATH): MethodId[] {
  const out: MethodId[] = [];
  for (const { level, unit } of allUnits(path)) {
    if (!unitDone(level, unit, done)) continue;
    for (const l of unit.lessons) for (const e of l.exercises) if ('method' in e && e.method && !out.includes(e.method)) out.push(e.method);
  }
  return out;
}

/**
 * A lesson passes when its talk reached the goals (speaking is the point)
 * and most of the other exercises were right.
 */
export function lessonPassed(exercises: Exercise[], results: boolean[]): boolean {
  const talks = exercises.flatMap((e, i) => (e.type === 'shortTalk' ? [results[i] === true] : []));
  const others = exercises.flatMap((e, i) => (e.type === 'shortTalk' ? [] : [results[i] === true]));
  const share = others.length ? others.filter(Boolean).length / others.length : 1;
  return talks.every(Boolean) && share >= 0.6;
}

/* ---------------------------------------------------------------- XP -- */

/** XP of a finished lesson: each exercise passed in full, a quarter when not, plus the completion bonus. */
export function lessonXp(lesson: Lesson, passed: boolean[]): number {
  const xp = lesson.exercises.reduce((sum, e, i) => sum + (passed[i] ? EXERCISE_XP[e.type] : Math.ceil(EXERCISE_XP[e.type] / 4)), 0);
  return xp + LESSON_BONUS_XP;
}

export function exercisesXp(exercises: Exercise[], passed: boolean[]): number {
  return exercises.reduce((sum, e, i) => sum + (passed[i] ? EXERCISE_XP[e.type] : Math.ceil(EXERCISE_XP[e.type] / 4)), 0);
}

/* ------------------------------------------------------------ streak -- */

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(toTime(day) + n * DAY_MS);

/** ISO week (Monday start) as “YYYY-Www”. */
export function isoWeek(day: string): string {
  const d = new Date(toTime(day));
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface Streak {
  current: number;
  best: number;
  /** Today already counts. */
  todayDone: boolean;
  /** Days protected by the weekly free day in the current streak. */
  frozen: string[];
}

/**
 * Consecutive days with practice. One missed day per ISO week does not break
 * it (the free day of the trail); today counts once practiced, and not
 * having practiced yet today never breaks anything.
 */
export function computeStreak(practicedDays: Iterable<string>, today: string): Streak {
  const days = new Set(practicedDays);
  const sorted = [...days].filter((d) => d <= today).sort();
  if (sorted.length === 0) return { current: 0, best: 0, todayDone: false, frozen: [] };
  let running = 0;
  let best = 0;
  let frozen: string[] = [];
  const usedWeeks = new Set<string>();
  for (let d = sorted[0]!; d < today; d = addDays(d, 1)) {
    if (days.has(d)) {
      running++;
    } else {
      // The free day only protects a streak that goes on the next day (or today, still open):
      // two misses in a row always break it.
      const next = addDays(d, 1);
      const goesOn = days.has(next) || next === today;
      if (running > 0 && goesOn && !usedWeeks.has(isoWeek(d))) {
        usedWeeks.add(isoWeek(d));
        frozen.push(d);
      } else {
        running = 0;
        frozen = [];
      }
    }
    best = Math.max(best, running);
  }
  const todayDone = days.has(today);
  const current = running + (todayDone ? 1 : 0);
  return { current, best: Math.max(best, current), todayDone, frozen: current ? frozen : [] };
}

/* ------------------------------------------------------------ skills -- */

export interface SkillState {
  skill: SkillId;
  xp: number;
  level: number;
  lastPracticedOn: string | null;
  nextReviewOn: string | null;
}

/** XP a skill earns from one practice. */
export const SKILL_XP = { passed: 10, failed: 3 } as const;

/** A skill after one practice: more XP, and the next review further away (or tomorrow, if it went badly). */
export function practiceSkill(s: SkillState, passed: boolean, today: string): SkillState {
  const xp = s.xp + (passed ? SKILL_XP.passed : SKILL_XP.failed);
  const level = Math.min(SKILL_MAX_LEVEL, skillLevel(xp));
  return {
    ...s,
    xp,
    level,
    lastPracticedOn: today,
    nextReviewOn: addDays(today, passed ? REVIEW_INTERVAL_DAYS[level]! : 1),
  };
}

/** Skills due for review today, weakest first. */
export function dueSkills(skills: SkillState[], today: string): SkillState[] {
  return skills.filter((s) => s.nextReviewOn !== null && s.nextReviewOn <= today).sort((a, b) => a.level - b.level || a.skill.localeCompare(b.skill));
}

/**
 * A review lesson for a skill: exercises taken from the lessons that taught
 * it (varying with the day), ending with a short talk focused on it.
 */
export function reviewLesson(skill: SkillId, day: string, done: CompletedSet, path: Level[] = SPEECH_PATH): Lesson | null {
  const taught = allUnits(path).flatMap(({ level, unit }) =>
    unit.lessons.filter((l) => l.skills.includes(skill) && lessonDone(level, l.id, done)),
  );
  if (taught.length === 0) return null;
  const pool = taught.flatMap((l) => l.exercises).filter((e) => e.type !== 'concept' && e.type !== 'shortTalk' && e.type !== 'build');
  const talks = taught.flatMap((l) => l.exercises).filter((e): e is Extract<Exercise, { type: 'shortTalk' }> => e.type === 'shortTalk');
  const picked: Exercise[] = [];
  for (let k = 0; k < Math.min(3, pool.length); k++) {
    const e = pool[dayIndex(day, 11 + k * 7, pool.length)]!;
    if (!picked.includes(e)) picked.push(e);
  }
  const talk = talks.length ? talks[dayIndex(day, 5, talks.length)]! : null;
  if (talk) picked.push({ ...talk, topic: { text: DAILY_TOPICS[dayIndex(day, 9, DAILY_TOPICS.length)]! } });
  return { id: `review-${skill}`, title: 'Revisão', skills: [skill], exercises: picked };
}
