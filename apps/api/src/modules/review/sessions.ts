import {
  REVIEW_MODE_LABELS,
  isConfidentError,
  isCorrect,
  uuidv7,
  zReviewSessionCreate,
  type ReviewMode,
  type ReviewSession,
  type ReviewSessionCreate,
  type ReviewSessionSummary,
} from '@mynotes/shared';
import { notFound } from '../../lib/errors';
import { all, first, num, parseJson, placeholders, str, strOrNull, stmt, type Row } from '../../lib/db';
import { activityStmt } from '../../lib/helpers';
import { nowIso } from '../../lib/time';
import { CARD_FROM, CARD_LIVE, CARD_TOPIC, LOG_CARD_FROM, scopeOf } from './scope';

function toSession(r: Row): ReviewSession {
  return {
    id: str(r.id),
    mode: str(r.mode) as ReviewMode,
    topicIds: parseJson<string[]>(r.topic_ids, []),
    localDay: str(r.local_day),
    startedAt: str(r.started_at),
    finishedAt: strOrNull(r.finished_at),
    seconds: num(r.seconds),
    reviewed: num(r.reviewed),
    correct: num(r.correct),
    studySessionId: strOrNull(r.study_session_id),
  };
}

async function sessionRow(db: D1Database, userId: string, id: string): Promise<Row> {
  const row = await first(db, 'SELECT * FROM review_sessions WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Sessão de revisão');
  return row;
}

/** Starts a session (a retried request returns the same one). */
export async function createSession(db: D1Database, userId: string, raw: ReviewSessionCreate): Promise<ReviewSession> {
  const input = zReviewSessionCreate.parse(raw);
  const topicIds = [...new Set(input.topicIds)];
  if (topicIds.length) {
    const found = await first(db, `SELECT COUNT(*) AS n FROM topics WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders(topicIds.length)})`, userId, ...topicIds);
    if (num(found?.n) !== topicIds.length) throw notFound('Assunto');
  }
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO review_sessions (id, user_id, mode, topic_ids, local_day, started_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(input.id, userId, input.mode, JSON.stringify(topicIds), input.localDay, now, now, now)
    .run();
  return toSession(await sessionRow(db, userId, input.id));
}

export async function listSessions(db: D1Database, userId: string, limit = 10): Promise<ReviewSession[]> {
  const rows = await all(db, 'SELECT * FROM review_sessions WHERE user_id = ? AND (reviewed > 0 OR finished_at IS NOT NULL) ORDER BY started_at DESC LIMIT ?', userId, limit);
  return rows.map(toSession);
}

/** Titles of the selected topics, for the study session written at the end. */
async function topicTitles(db: D1Database, userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await all<{ id: string; title: string }>(db, `SELECT id, title FROM topics WHERE user_id = ? AND id IN (${placeholders(ids.length)})`, userId, ...ids);
  const byId = new Map(rows.map((r) => [r.id, r.title]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** A session of at least a minute also counts in Estudo (source "review"). */
const STUDY_MIN_SECONDS = 60;

/**
 * Ends a session: the time spent, the totals from its answers and, the
 * first time it lasted a minute or more, a study session in Estudo.
 */
export async function finishSession(db: D1Database, userId: string, id: string, input: { seconds: number }): Promise<ReviewSessionSummary> {
  const row = await sessionRow(db, userId, id);
  const session = toSession(row);
  const totals = await first(db, 'SELECT COUNT(*) AS n, SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS ok FROM review_logs WHERE session_id = ? AND user_id = ?', id, userId);
  const seconds = Math.max(session.seconds, input.seconds);
  const now = nowIso();
  const statements = [
    stmt(
      db,
      'UPDATE review_sessions SET finished_at = ?, seconds = ?, reviewed = ?, correct = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?',
      session.finishedAt ?? now,
      seconds,
      num(totals?.n),
      num(totals?.ok),
      now,
      id,
      userId,
    ),
  ];
  const recalls = await first(db, 'SELECT COUNT(*) AS n FROM review_recalls WHERE session_id = ? AND user_id = ?', id, userId);
  const worked = num(totals?.n) + num(recalls?.n) > 0;
  if (!session.studySessionId && seconds >= STUDY_MIN_SECONDS && worked) {
    const studyId = uuidv7();
    const titles = await topicTitles(db, userId, session.topicIds);
    const objective = `Revisão · ${REVIEW_MODE_LABELS[session.mode]}${titles.length ? `: ${titles.join(', ')}` : ''}`.slice(0, 1000);
    const notes = num(totals?.n) ? `${num(totals?.n)} respostas, ${num(totals?.ok)} certas.` : `${num(recalls?.n)} recordação livre.`;
    statements.push(
      stmt(
        db,
        `INSERT INTO study_sessions (id, user_id, topic_id, started_at, duration_seconds, objective, notes, progress_rating, source, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'review', 1, ?, ?)`,
        studyId,
        userId,
        session.topicIds.length === 1 ? session.topicIds[0]! : null,
        session.startedAt,
        seconds,
        objective,
        notes,
        now,
        now,
      ),
      stmt(db, 'UPDATE review_sessions SET study_session_id = ? WHERE id = ? AND user_id = ?', studyId, id, userId),
      activityStmt(db, userId, 'session', studyId, 'studied', objective),
    );
  }
  await db.batch(statements);
  return sessionSummary(db, userId, id);
}

export async function sessionSummary(db: D1Database, userId: string, id: string): Promise<ReviewSessionSummary> {
  const session = toSession(await sessionRow(db, userId, id));
  const logs = await all(
    db,
    `SELECT l.card_id, l.rating, l.confidence, l.reviewed_at, c.front, c.kind, c.cloze_index, ${CARD_TOPIC} AS topic_id, t.title AS topic_title
       FROM ${LOG_CARD_FROM} LEFT JOIN topics t ON t.id = ${CARD_TOPIC}
      WHERE l.session_id = ? AND l.user_id = ? ORDER BY l.reviewed_at, l.rowid`,
    id,
    userId,
  );
  const firstTry = new Map<string, boolean>();
  const confident = new Map<string, string>();
  const byTopic = new Map<string, { topicId: string | null; title: string; reviewed: number; correct: number }>();
  for (const l of logs) {
    const cardId = str(l.card_id);
    const rating = num(l.rating);
    if (!firstTry.has(cardId)) firstTry.set(cardId, isCorrect(rating));
    if (isConfidentError(rating, num(l.confidence))) confident.set(cardId, str(l.front));
    const key = str(l.topic_id) || '-';
    const t = byTopic.get(key) ?? { topicId: strOrNull(l.topic_id), title: str(l.topic_title) || 'Sem assunto', reviewed: 0, correct: 0 };
    t.reviewed++;
    if (isCorrect(rating)) t.correct++;
    byTopic.set(key, t);
  }
  const recalls = await all(
    db,
    'SELECT rc.id, rc.coverage, t.title FROM review_recalls rc LEFT JOIN topics t ON t.id = rc.topic_id WHERE rc.session_id = ? AND rc.user_id = ? ORDER BY rc.created_at',
    id,
    userId,
  );
  const s = scopeOf(userId, session.topicIds.length ? session.topicIds : undefined);
  const next = await first(
    db,
    `${s.cte}SELECT MIN(c.due) AS due FROM ${CARD_FROM} WHERE c.user_id = ? AND c.status = 'active' AND c.phase > 0 AND c.due > ? AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}`,
    ...s.binds,
    userId,
    nowIso(),
  );
  return {
    session,
    items: firstTry.size,
    firstTry: [...firstTry.values()].filter(Boolean).length,
    confidentErrors: [...confident].map(([cardId, front]) => ({ cardId, front })),
    byTopic: [...byTopic.values()].sort((a, b) => b.reviewed - a.reviewed),
    recalls: recalls.map((r) => ({ id: str(r.id), topicTitle: str(r.title) || 'Assunto excluído', coverage: r.coverage == null ? null : num(r.coverage) })),
    nextDue: strOrNull(next?.due),
  };
}
