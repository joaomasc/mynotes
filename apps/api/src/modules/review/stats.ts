import { LEECH_LAPSES, type ReviewStats, type ReviewSummary } from '@mynotes/shared';
import { all, first, num, str, strOrNull, stmt, type Row } from '../../lib/db';
import { nowIso } from '../../lib/time';
import { reviewSettings } from './cards';
import { CARD_FROM, CARD_LIVE, CARD_TOPIC, LOG_CARD_FROM } from './scope';

/** YYYY-MM-DD plus n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Current streak (ending today, or yesterday if today has no review yet) and the best one. */
export function streaks(days: string[], today: string): { current: number; best: number } {
  const set = new Set(days);
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...set].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

async function reviewDays(db: D1Database, userId: string): Promise<string[]> {
  const rows = await all<{ local_day: string }>(db, 'SELECT DISTINCT local_day FROM review_logs WHERE user_id = ? ORDER BY local_day DESC LIMIT 400', userId);
  return rows.map((r) => r.local_day);
}

/** What the sidebar, the home page and the reminder need. */
export async function reviewSummary(db: D1Database, userId: string, today: string): Promise<ReviewSummary> {
  const settings = await reviewSettings(db, userId);
  const now = nowIso();
  const live = `c.user_id = ? AND c.status = 'active' AND ${CARD_LIVE}`;
  const row = await first(
    db,
    `SELECT
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${live} AND c.phase > 0 AND c.due <= ?) AS due,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${live} AND c.phase = 0) AS fresh,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${live}) AS total,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${live} AND c.lapses >= ?) AS leeches,
       (SELECT COUNT(*) FROM review_logs WHERE user_id = ? AND local_day = ?) AS reviewed,
       (SELECT COUNT(DISTINCT card_id) FROM review_logs WHERE user_id = ? AND local_day = ? AND phase_before = 0) AS introduced,
       (SELECT COUNT(*) FROM review_proposals WHERE user_id = ?) AS proposals`,
    userId,
    now,
    userId,
    userId,
    userId,
    LEECH_LAPSES,
    userId,
    today,
    userId,
    today,
    userId,
  );
  return {
    today,
    due: num(row?.due),
    newAvailable: Math.min(num(row?.fresh), Math.max(0, settings.newPerDay - num(row?.introduced))),
    reviewedToday: num(row?.reviewed),
    streak: streaks(await reviewDays(db, userId), today).current,
    proposals: num(row?.proposals),
    leeches: num(row?.leeches),
    total: num(row?.total),
  };
}

/** Local day of a UTC timestamp for an offset in minutes east of UTC. */
export const localDayOf = (iso: string, tzOffset: number) => new Date(Date.parse(iso) + tzOffset * 60_000).toISOString().slice(0, 10);

export async function reviewStats(db: D1Database, userId: string, q: { today: string; tzOffset: number }): Promise<ReviewStats> {
  const settings = await reviewSettings(db, userId);
  const live = `c.user_id = ? AND ${CARD_LIVE}`;
  const since30 = addDays(q.today, -29);
  const since90 = addDays(q.today, -89);
  const horizon = new Date(Date.parse(`${addDays(q.today, 30)}T00:00:00Z`) - q.tzOffset * 60_000).toISOString();
  const [counts, due, history, retention, calibration, weak, confident] = await db.batch<Row>([
    stmt(
      db,
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN c.status = 'active' AND c.phase = 0 THEN 1 ELSE 0 END) AS fresh,
         SUM(CASE WHEN c.status = 'active' AND c.phase IN (1, 3) THEN 1 ELSE 0 END) AS learning,
         SUM(CASE WHEN c.status = 'active' AND c.phase = 2 THEN 1 ELSE 0 END) AS review,
         SUM(CASE WHEN c.status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
         SUM(CASE WHEN c.status = 'active' AND c.lapses >= ? THEN 1 ELSE 0 END) AS leeches
        FROM ${CARD_FROM} WHERE ${live}`,
      LEECH_LAPSES,
      userId,
    ),
    stmt(db, `SELECT c.due FROM ${CARD_FROM} WHERE ${live} AND c.status = 'active' AND c.phase > 0 AND c.due < ?`, userId, horizon),
    stmt(
      db,
      'SELECT local_day, COUNT(*) AS n, SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS ok FROM review_logs WHERE user_id = ? AND local_day >= ? GROUP BY local_day ORDER BY local_day',
      userId,
      since90,
    ),
    stmt(
      db,
      'SELECT COUNT(*) AS n, SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS ok FROM review_logs WHERE user_id = ? AND local_day >= ? AND phase_before = 2',
      userId,
      since30,
    ),
    stmt(
      db,
      `SELECT confidence, COUNT(*) AS n, SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS ok FROM review_logs
        WHERE user_id = ? AND local_day >= ? AND confidence IS NOT NULL GROUP BY confidence ORDER BY confidence`,
      userId,
      since90,
    ),
    stmt(
      db,
      `SELECT ${CARD_TOPIC} AS topic_id, t.title, COUNT(*) AS n, SUM(CASE WHEN l.rating >= 2 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN l.rating = 1 THEN 1 ELSE 0 END) AS lapses
         FROM ${LOG_CARD_FROM} LEFT JOIN topics t ON t.id = ${CARD_TOPIC}
        WHERE l.user_id = ? AND l.local_day >= ? GROUP BY ${CARD_TOPIC} HAVING COUNT(*) >= 3`,
      userId,
      since30,
    ),
    stmt(
      db,
      `SELECT l.card_id, MAX(l.reviewed_at) AS at, c.front FROM review_logs l JOIN review_cards c ON c.id = l.card_id
        WHERE l.user_id = ? AND l.local_day >= ? AND l.rating = 1 AND l.confidence = 3
        GROUP BY l.card_id ORDER BY at DESC LIMIT 10`,
      userId,
      addDays(q.today, -13),
    ),
  ]);

  const c = counts?.results?.[0] ?? {};
  const forecast = Array.from({ length: 30 }, (_, i) => ({ day: addDays(q.today, i), count: 0 }));
  for (const r of due?.results ?? []) {
    const day = localDayOf(str(r.due), q.tzOffset);
    const i = day <= q.today ? 0 : forecast.findIndex((f) => f.day === day);
    if (i >= 0) forecast[i]!.count++;
  }
  const byDay = new Map((history?.results ?? []).map((r) => [str(r.local_day), { reviews: num(r.n), correct: num(r.ok) }]));
  const ret = retention?.results?.[0];
  const days = await reviewDays(db, userId);
  return {
    today: q.today,
    desiredRetention: settings.desiredRetention,
    counts: {
      total: num(c.total),
      new: num(c.fresh),
      learning: num(c.learning),
      review: num(c.review),
      suspended: num(c.suspended),
      leeches: num(c.leeches),
    },
    trueRetention: num(ret?.n) > 0 ? Math.round((num(ret?.ok) / num(ret?.n)) * 1000) / 1000 : null,
    matureReviews30: num(ret?.n),
    forecast,
    history: Array.from({ length: 90 }, (_, i) => {
      const day = addDays(since90, i);
      return { day, ...(byDay.get(day) ?? { reviews: 0, correct: 0 }) };
    }),
    calibration: (calibration?.results ?? []).map((r) => ({ confidence: num(r.confidence), answers: num(r.n), correct: num(r.ok) })),
    weakTopics: (weak?.results ?? [])
      .map((r) => ({ topicId: strOrNull(r.topic_id), title: str(r.title) || 'Sem assunto', reviews: num(r.n), correct: num(r.ok), lapses: num(r.lapses) }))
      .sort((a, b) => a.correct / a.reviews - b.correct / b.reviews || b.reviews - a.reviews)
      .slice(0, 6),
    confidentErrors: (confident?.results ?? []).map((r) => ({ cardId: str(r.card_id), front: str(r.front), reviewedAt: str(r.at) })),
    streak: streaks(days, q.today),
  };
}

