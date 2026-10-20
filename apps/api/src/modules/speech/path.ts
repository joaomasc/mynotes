import {
  CHALLENGE_XP,
  DAILY_TALK_XP,
  DAILY_TOPICS,
  FREE_TALK_XP,
  LEVEL_CHALLENGE_XP,
  MEASURED_SKILLS,
  SPEECH_SKILLS,
  addDays,
  challengeSkills,
  checkGoals,
  computeStreak,
  dayIndex,
  findChallenge,
  findLesson,
  lessonPassed,
  lessonXp,
  practiceSkill,
  zSpeechSettings,
  type CriterionResult,
  type NoteTopic,
  type SkillId,
  type SkillState,
  type SpeechPathState,
  type SpeechPracticeResult,
  type SpeechSettings,
  type zSpeechPracticeCreate,
} from '@mynotes/shared';
import type { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { all, first, num, parseJson, str, strOrNull, stmt, type Row } from '../../lib/db';
import { nowIso } from '../../lib/time';
import { getAttempt } from './service';

/**
 * The speaking path on the server: what was completed, skills, XP, the daily
 * goal and the streak (docs/oratoria-trilha.md › Progresso). XP is computed
 * here from the content, and challenge goals are checked on the stored talk,
 * so the numbers never depend on what the browser claims.
 */

export async function speechSettings(db: D1Database, userId: string): Promise<SpeechSettings> {
  const row = await first(db, "SELECT value FROM settings WHERE user_id = ? AND key = 'speech'", userId);
  const parsed = zSpeechSettings.safeParse(parseJson(row?.value, {}));
  return parsed.success ? parsed.data : zSpeechSettings.parse({});
}

/** A note with enough text to explain, varying by day (null when there are no notes). */
async function noteOfTheDay(db: D1Database, userId: string, today: string): Promise<NoteTopic | null> {
  const where = "user_id = ? AND deleted_at IS NULL AND role = 'note' AND title <> '' AND length(body_text) >= 200";
  const count = num((await first(db, `SELECT COUNT(*) AS n FROM notes WHERE ${where}`, userId))?.n);
  if (count === 0) return null;
  const row = await first(db, `SELECT id, title, topic_id FROM notes WHERE ${where} ORDER BY id LIMIT 1 OFFSET ?`, userId, dayIndex(today, 17, count));
  return row ? { noteId: str(row.id), title: str(row.title), topicId: strOrNull(row.topic_id) } : null;
}

function toSkill(r: Row): SkillState {
  return {
    skill: str(r.skill) as SkillId,
    xp: num(r.xp),
    level: num(r.level),
    lastPracticedOn: strOrNull(r.last_practiced_on),
    nextReviewOn: strOrNull(r.next_review_on),
  };
}

export async function pathState(db: D1Database, userId: string, today: string): Promise<SpeechPathState> {
  const weekStart = addDays(today, -6);
  const [progress, skills, totals, days, week, todayKinds] = await db.batch<Row>([
    stmt(db, 'SELECT item_id FROM speech_progress WHERE user_id = ? AND completed_at IS NOT NULL', userId),
    stmt(db, 'SELECT * FROM speech_skills WHERE user_id = ? ORDER BY skill', userId),
    stmt(
      db,
      `SELECT COALESCE(SUM(xp), 0) AS total,
              COALESCE(SUM(CASE WHEN local_day = ? THEN xp END), 0) AS today_xp,
              COALESCE(SUM(CASE WHEN local_day = ? THEN seconds END), 0) AS today_seconds
         FROM speech_practice WHERE user_id = ?`,
      today,
      today,
      userId,
    ),
    stmt(db, 'SELECT DISTINCT local_day FROM speech_practice WHERE user_id = ? AND local_day >= ? AND local_day <= ? ORDER BY local_day', userId, addDays(today, -400), today),
    stmt(db, 'SELECT local_day, SUM(xp) AS xp FROM speech_practice WHERE user_id = ? AND local_day BETWEEN ? AND ? GROUP BY local_day', userId, weekStart, today),
    stmt(db, 'SELECT DISTINCT kind FROM speech_practice WHERE user_id = ? AND local_day = ?', userId, today),
  ]);
  const settings = await speechSettings(db, userId);
  const noteTopic = await noteOfTheDay(db, userId, today);
  const t = totals?.results?.[0];
  const xpByDay = new Map((week?.results ?? []).map((r) => [str(r.local_day), num(r.xp)]));
  const kinds = new Set((todayKinds?.results ?? []).map((r) => str(r.kind)));
  // Every other day, the theme comes from the notes (when there are any).
  const fromNotes = noteTopic !== null && dayIndex(today, 3, 2) === 0;
  return {
    today,
    completed: (progress?.results ?? []).map((r) => str(r.item_id)),
    skills: (skills?.results ?? []).map(toSkill),
    totalXp: num(t?.total),
    todayXp: num(t?.today_xp),
    todaySeconds: num(t?.today_seconds),
    streak: computeStreak((days?.results ?? []).map((r) => str(r.local_day)), today),
    week: Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      return { day, xp: xpByDay.get(day) ?? 0 };
    }),
    daily: fromNotes
      ? { text: `Explique para alguém que nunca ouviu falar: ${noteTopic.title}`, note: noteTopic }
      : { text: DAILY_TOPICS[dayIndex(today, 7, DAILY_TOPICS.length)]!, note: null },
    noteTopic,
    warmupDone: kinds.has('warmup'),
    dailyDone: kinds.has('daily'),
    settings,
  };
}

/** Skills of a talk judged by the rubric: good counts as practice passed, “a melhorar” as failed. */
function skillsFromMeasured(measured: CriterionResult[]): { skill: SkillId; passed: boolean }[] {
  return measured.flatMap((m) =>
    (MEASURED_SKILLS as string[]).includes(m.id) && (m.state === 'good' || m.state === 'improve') ? [{ skill: m.id as SkillId, passed: m.state === 'good' }] : [],
  );
}

type PracticeInput = z.output<typeof zSpeechPracticeCreate>;

export async function recordPractice(db: D1Database, userId: string, input: PracticeInput): Promise<SpeechPracticeResult> {
  const existing = await first(db, 'SELECT user_id, xp, passed FROM speech_practice WHERE id = ?', input.id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { xp: num(existing.xp), passed: num(existing.passed) === 1, completedNow: false, state: await pathState(db, userId, input.localDay) };
  }

  let xp = 0;
  let passed = false;
  let score: number | null = null;
  let progressItem: string | null = null;
  let practiced: { skill: SkillId; passed: boolean }[] = [];
  const attempt = input.attemptId ? await getAttempt(db, userId, input.attemptId) : null;
  const needAttempt = () => {
    if (!attempt) throw badRequest('Informe a fala gravada');
    return attempt;
  };

  switch (input.kind) {
    case 'lesson': {
      const found = findLesson(input.refId ?? '');
      if (!found) throw badRequest('Lição desconhecida');
      if (input.results.length !== found.lesson.exercises.length) throw badRequest('Resultado incompleto da lição');
      passed = lessonPassed(found.lesson.exercises, input.results);
      xp = lessonXp(found.lesson, input.results);
      progressItem = found.lesson.id;
      practiced = found.lesson.skills.map((skill) => ({ skill, passed }));
      break;
    }
    case 'challenge':
    case 'levelChallenge': {
      const found = findChallenge(input.refId ?? '');
      if (!found || (input.kind === 'challenge') !== (found.unit !== null)) throw badRequest('Desafio desconhecido');
      const a = needAttempt();
      passed = checkGoals(found.challenge.goals, a.metrics, [...a.measured, ...(a.evaluation?.criteria ?? [])]).passed;
      const full = input.kind === 'levelChallenge' ? LEVEL_CHALLENGE_XP : CHALLENGE_XP;
      xp = passed ? full : Math.ceil(full / 5);
      score = a.score;
      progressItem = found.challenge.id;
      practiced = challengeSkills(found.challenge.id).map((skill) => ({ skill, passed }));
      break;
    }
    case 'review': {
      const skill = input.refId as SkillId;
      if (!(SPEECH_SKILLS as readonly string[]).includes(skill) || input.results.length === 0) throw badRequest('Revisão inválida');
      const right = input.results.filter(Boolean).length;
      passed = right / input.results.length >= 0.6 && input.results.at(-1) === true;
      xp = Math.min(60, right * 5 + 10);
      practiced = [{ skill, passed }];
      break;
    }
    case 'warmup':
      passed = input.results.some(Boolean);
      xp = passed ? 10 : 3;
      break;
    case 'daily':
    case 'free': {
      const a = needAttempt();
      passed = true;
      xp = input.kind === 'daily' ? DAILY_TALK_XP : FREE_TALK_XP;
      score = a.score;
      practiced = skillsFromMeasured(a.measured);
      break;
    }
  }

  const now = nowIso();
  const before = progressItem ? await first(db, 'SELECT completed_at FROM speech_progress WHERE user_id = ? AND item_id = ?', userId, progressItem) : null;
  const statements = [
    stmt(
      db,
      `INSERT INTO speech_practice (id, user_id, kind, ref_id, local_day, seconds, xp, passed, attempt_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      userId,
      input.kind,
      input.refId,
      input.localDay,
      input.seconds,
      xp,
      passed ? 1 : 0,
      input.attemptId,
      now,
    ),
  ];
  if (progressItem) {
    statements.push(
      stmt(
        db,
        `INSERT INTO speech_progress (user_id, item_id, attempts, best_score, completed_at, version, updated_at)
         VALUES (?, ?, 1, ?, ?, 1, ?)
         ON CONFLICT (user_id, item_id) DO UPDATE SET
           attempts = attempts + 1,
           best_score = CASE WHEN excluded.best_score IS NULL THEN best_score
                             WHEN best_score IS NULL OR excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
           completed_at = COALESCE(completed_at, excluded.completed_at),
           version = version + 1,
           updated_at = excluded.updated_at`,
        userId,
        progressItem,
        score,
        passed ? now : null,
        now,
      ),
    );
  }
  if (practiced.length) {
    const unique = [...new Map(practiced.map((p) => [p.skill, p])).values()];
    const current = await all(db, `SELECT * FROM speech_skills WHERE user_id = ? AND skill IN (${unique.map(() => '?').join(',')})`, userId, ...unique.map((p) => p.skill));
    const byId = new Map(current.map((r) => [str(r.skill), toSkill(r)]));
    for (const p of unique) {
      const next = practiceSkill(byId.get(p.skill) ?? { skill: p.skill, xp: 0, level: 0, lastPracticedOn: null, nextReviewOn: null }, p.passed, input.localDay);
      statements.push(
        stmt(
          db,
          `INSERT INTO speech_skills (user_id, skill, xp, level, last_practiced_on, next_review_on, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (user_id, skill) DO UPDATE SET xp = excluded.xp, level = excluded.level,
             last_practiced_on = excluded.last_practiced_on, next_review_on = excluded.next_review_on,
             version = version + 1, updated_at = excluded.updated_at`,
          userId,
          p.skill,
          next.xp,
          next.level,
          next.lastPracticedOn,
          next.nextReviewOn,
          now,
        ),
      );
    }
  }
  await db.batch(statements);
  return {
    xp,
    passed,
    completedNow: passed && !!progressItem && !before?.completed_at,
    state: await pathState(db, userId, input.localDay),
  };
}
