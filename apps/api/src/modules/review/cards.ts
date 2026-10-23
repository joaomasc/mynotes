import {
  CARD_KINDS,
  LEECH_LAPSES,
  clozeIndices,
  clozePlain,
  interleave,
  isCorrect,
  newSchedulingState,
  nextState,
  normalizeSearch,
  retrievability,
  sourceProbe,
  uuidv7,
  zReviewEvaluation,
  zReviewSettings,
  type CardKind,
  type ReviewAnswer,
  type ReviewCard,
  type ReviewCardCreate,
  type ReviewLog,
  type ReviewMode,
  type ReviewQueue,
  type ReviewSettings,
  type SchedulingState,
  zReviewAnswer,
  zReviewCardCreate,
  zReviewCardUpdate,
} from '@mynotes/shared';
import type { z } from 'zod';
import { badRequest, conflict, notFound, versionConflict } from '../../lib/errors';
import { all, first, num, numOrNull, parseJson, placeholders, str, strOrNull, stmt, type Bindable, type Row } from '../../lib/db';
import { assertReference } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { nowIso } from '../../lib/time';
import { CARD_FROM, CARD_LIVE, CARD_TOPIC, scopeOf } from './scope';

/* ------------------------------------------------------------ settings -- */

export async function reviewSettings(db: D1Database, userId: string): Promise<ReviewSettings> {
  const row = await first(db, "SELECT value FROM settings WHERE user_id = ? AND key = 'review'", userId);
  const parsed = zReviewSettings.safeParse(parseJson(row?.value, {}));
  return parsed.success ? parsed.data : zReviewSettings.parse({});
}

/* ------------------------------------------------------------- reading -- */

export const CARD_COLUMNS = `c.*, ${CARD_TOPIC} AS eff_topic_id, n.title AS note_title, t.title AS topic_title,
  (c.source_probe <> '' AND n.id IS NOT NULL AND instr(n.search_text, c.source_probe) = 0) AS source_changed`;
export const CARD_JOINED = `${CARD_FROM} LEFT JOIN topics t ON t.id = ${CARD_TOPIC}`;

export function scheduleOf(r: Row): SchedulingState {
  return {
    phase: num(r.phase) as SchedulingState['phase'],
    due: str(r.due),
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    scheduledDays: num(r.scheduled_days),
    learningSteps: num(r.learning_steps),
    reps: num(r.reps),
    lapses: num(r.lapses),
    lastReview: strOrNull(r.last_review),
  };
}

export function toCard(r: Row): ReviewCard {
  return {
    id: str(r.id),
    kind: str(r.kind) as CardKind,
    status: str(r.status) as ReviewCard['status'],
    origin: str(r.origin) as ReviewCard['origin'],
    groupId: str(r.group_id),
    topicId: strOrNull(r.eff_topic_id),
    topicTitle: strOrNull(r.topic_title),
    noteId: strOrNull(r.note_id),
    noteTitle: r.note_id == null ? null : str(r.note_title),
    front: str(r.front),
    back: str(r.back),
    clozeIndex: numOrNull(r.cloze_index),
    keyPoints: parseJson<string[]>(r.key_points, []),
    sourceQuote: str(r.source_quote),
    sourceChanged: num(r.source_changed) === 1,
    leech: num(r.lapses) >= LEECH_LAPSES,
    schedule: scheduleOf(r),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export async function getCards(db: D1Database, userId: string, ids: string[]): Promise<ReviewCard[]> {
  if (ids.length === 0) return [];
  const rows = await all(db, `SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE c.user_id = ? AND c.id IN (${placeholders(ids.length)})`, userId, ...ids);
  const byId = new Map(rows.map((r) => [str(r.id), toCard(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function getCard(db: D1Database, userId: string, id: string): Promise<ReviewCard> {
  const [card] = await getCards(db, userId, [id]);
  if (!card) throw notFound('Cartão');
  return card;
}

/* ------------------------------------------------------------ creating -- */

/** What the card is searched by (the text without cloze markers). */
export const cardSearchText = (kind: CardKind, front: string, back: string, keyPoints: string[]) =>
  normalizeSearch(`${kind === 'cloze' ? clozePlain(front) : front} ${back} ${keyPoints.join(' ')}`).slice(0, 20_000);

export interface NewCard {
  kind: CardKind;
  front: string;
  back: string;
  keyPoints: string[];
  clozeIndex: number | null;
  origin: ReviewCard['origin'];
  topicId: string | null;
  noteId: string | null;
  sourceQuote: string;
  sourceProbe: string;
}

export function insertCardStmt(db: D1Database, userId: string, id: string, groupId: string, c: NewCard, now: string): D1PreparedStatement {
  const s = newSchedulingState(new Date(now));
  return stmt(
    db,
    `INSERT INTO review_cards (id, user_id, topic_id, note_id, group_id, kind, origin, status, front, back, cloze_index, key_points,
       source_quote, source_probe, phase, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, last_review,
       search_text, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    userId,
    c.topicId,
    c.noteId,
    groupId,
    c.kind,
    c.origin,
    c.front,
    c.back,
    c.clozeIndex,
    JSON.stringify(c.keyPoints),
    c.sourceQuote,
    c.sourceProbe,
    s.phase,
    s.due,
    s.stability,
    s.difficulty,
    s.scheduledDays,
    s.learningSteps,
    s.reps,
    s.lapses,
    s.lastReview,
    cardSearchText(c.kind, c.front, c.back, c.keyPoints),
    now,
    now,
  );
}

/** The note a card comes from: its topic (or its book's) and its text (to check the quoted passage). */
export async function sourceNote(db: D1Database, userId: string, noteId: string): Promise<{ topicId: string | null; body: string }> {
  const row = await first(
    db,
    `SELECT COALESCE(n.topic_id, r.topic_id) AS topic_id, n.body_text FROM notes n LEFT JOIN readings r ON r.id = n.reading_id
      WHERE n.id = ? AND n.user_id = ? AND n.deleted_at IS NULL`,
    noteId,
    userId,
  );
  if (!row) throw badRequest('Nota referenciada não existe', { table: 'notes', id: noteId });
  return { topicId: strOrNull(row.topic_id), body: str(row.body_text) };
}

/**
 * Prepares the cards of one request: a cloze text gives one card per blank
 * number; "also reverse" gives the back → front card. All share a group.
 */
export function expandCards(input: z.output<typeof zReviewCardCreate>, base: Omit<NewCard, 'kind' | 'front' | 'back' | 'keyPoints' | 'clozeIndex'>): NewCard[] {
  const common = { ...base, keyPoints: input.kind === 'open' || input.kind === 'essay' ? input.keyPoints : [] };
  if (input.kind === 'cloze') {
    const indices = clozeIndices(input.front);
    if (indices.length === 0) throw badRequest('Marque ao menos uma lacuna, assim: {{c1::resposta}}');
    if (indices.length > 20) throw badRequest('No máximo 20 lacunas por texto');
    return indices.map((i) => ({ ...common, kind: 'cloze', front: input.front, back: input.back, clozeIndex: i }));
  }
  const card: NewCard = { ...common, kind: input.kind, front: input.front, back: input.back, clozeIndex: null };
  if (input.reverse && (input.kind === 'basic' || input.kind === 'typed') && input.back) {
    return [card, { ...card, front: input.back, back: input.front }];
  }
  return [card];
}

export async function createCards(db: D1Database, userId: string, raw: ReviewCardCreate): Promise<ReviewCard[]> {
  const input = zReviewCardCreate.parse(raw);
  let topicId = input.topicId;
  let probe = '';
  if (input.noteId) {
    const note = await sourceNote(db, userId, input.noteId);
    topicId = note.topicId;
    if (input.sourceQuote) probe = sourceProbe(note.body, input.sourceQuote);
  } else {
    await assertReference(db, 'topics', topicId, userId);
  }
  const cards = expandCards(input, { origin: 'manual', topicId, noteId: input.noteId, sourceQuote: input.sourceQuote, sourceProbe: probe });
  const groupId = input.id ?? uuidv7();
  const ids = cards.map((_, i) => (i === 0 ? groupId : uuidv7()));
  // A retried request (same id) returns what it created the first time.
  if (await first(db, 'SELECT 1 AS ok FROM review_cards WHERE id = ? AND user_id = ?', groupId, userId)) {
    const existing = await all<{ id: string }>(db, 'SELECT id FROM review_cards WHERE group_id = ? AND user_id = ? ORDER BY cloze_index, created_at, id', groupId, userId);
    return getCards(db, userId, existing.map((r) => r.id));
  }
  const now = nowIso();
  await db.batch(cards.map((c, i) => insertCardStmt(db, userId, ids[i]!, groupId, c, now)));
  return getCards(db, userId, ids);
}

/* ------------------------------------------------------------ changing -- */

export async function updateCard(db: D1Database, userId: string, id: string, input: z.output<typeof zReviewCardUpdate>): Promise<ReviewCard> {
  const current = await getCard(db, userId, id);
  const set: Record<string, Bindable> = {};
  const front = input.front ?? current.front;
  const back = input.back ?? current.back;
  const keyPoints = input.keyPoints ?? current.keyPoints;
  if (input.front !== undefined) {
    if (current.kind === 'cloze' && !clozeIndices(front).includes(current.clozeIndex ?? 0)) {
      throw badRequest(`A lacuna c${current.clozeIndex} deste cartão não está mais no texto`);
    }
    set.front = front;
  }
  if (input.back !== undefined) {
    if ((current.kind === 'basic' || current.kind === 'typed') && !back) throw badRequest('Escreva a resposta');
    set.back = back;
  }
  if (input.keyPoints !== undefined) set.key_points = JSON.stringify(keyPoints);
  if (input.front !== undefined || input.back !== undefined || input.keyPoints !== undefined) {
    if ((current.kind === 'open' || current.kind === 'essay') && keyPoints.length === 0 && !back) {
      throw badRequest('Liste o que uma boa resposta precisa ter (ou escreva uma resposta modelo)');
    }
    set.search_text = cardSearchText(current.kind, front, back, keyPoints);
  }
  if (input.topicId !== undefined && input.topicId !== current.topicId) {
    if (current.noteId) throw badRequest('Este cartão segue o assunto da nota de onde veio');
    await assertReference(db, 'topics', input.topicId, userId);
    set.topic_id = input.topicId;
  }
  if (input.status !== undefined) set.status = input.status;
  if (input.reset) {
    const s = newSchedulingState(new Date());
    Object.assign(set, {
      phase: s.phase,
      due: s.due,
      stability: s.stability,
      difficulty: s.difficulty,
      scheduled_days: s.scheduledDays,
      learning_steps: s.learningSteps,
      reps: 0,
      lapses: 0,
      last_review: null,
    });
  }
  if (Object.keys(set).length === 0) return current;
  const cols = Object.keys(set);
  const row = await first(
    db,
    `UPDATE review_cards SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ? RETURNING id`,
    ...cols.map((c) => set[c]!),
    nowIso(),
    id,
    userId,
    input.baseVersion,
  );
  if (!row) throw versionConflict(current);
  return getCard(db, userId, id);
}

export async function deleteCard(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM review_cards WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Cartão');
}

/* ------------------------------------------------------------- listing -- */

const LIST_SORT: SortSpec = { expr: 'c.created_at', field: 'created_at', dir: 'DESC' };

export async function listCards(
  db: D1Database,
  userId: string,
  q: { topicIds?: string[] | undefined; noteId?: string | undefined; kind?: CardKind | undefined; status?: 'active' | 'suspended' | 'leech' | undefined; q?: string | undefined; cursor?: string | undefined; limit: number },
) {
  const s = scopeOf(userId, q.topicIds);
  let where = `c.user_id = ? AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}`;
  const binds: Bindable[] = [userId];
  if (q.noteId) {
    where += ' AND c.note_id = ?';
    binds.push(q.noteId);
  }
  if (q.kind) {
    where += ' AND c.kind = ?';
    binds.push(q.kind);
  }
  if (q.status === 'leech') {
    where += " AND c.status = 'active' AND c.lapses >= ?";
    binds.push(LEECH_LAPSES);
  } else if (q.status) {
    where += ' AND c.status = ?';
    binds.push(q.status);
  }
  const term = q.q ? normalizeSearch(q.q) : '';
  if (term) {
    where += ' AND instr(c.search_text, ?) > 0';
    binds.push(term);
  }
  const page = keyset(LIST_SORT, q.cursor, 'c.id');
  const rows = await all(db, `${s.cte}SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`, ...s.binds, ...binds, ...page.binds, q.limit + 1);
  const { items, nextCursor } = pageOf(rows, q.limit, LIST_SORT);
  return { items: items.map(toCard), nextCursor };
}

/* --------------------------------------------------------------- queue -- */

const KINDS_OF: Record<ReviewMode, readonly CardKind[]> = {
  due: CARD_KINDS,
  practice: CARD_KINDS,
  cards: ['basic', 'cloze', 'typed'],
  questions: ['open', 'essay'],
  recall: [],
};

/** New items already introduced today (local day), for the daily limit. */
async function newIntroducedToday(db: D1Database, userId: string, today: string): Promise<number> {
  const row = await first(db, 'SELECT COUNT(DISTINCT card_id) AS n FROM review_logs WHERE user_id = ? AND local_day = ? AND phase_before = 0', userId, today);
  return num(row?.n);
}

/**
 * The items of a session: due ones first (oldest due first) and new ones up
 * to the daily limit, one card per group (siblings wait for another day),
 * with the topics interleaved. "practice" takes the items closest to being
 * forgotten, due or not.
 */
export async function buildQueue(
  db: D1Database,
  userId: string,
  q: { topicIds?: string[] | undefined; mode: ReviewMode; limit?: number | undefined; today: string },
): Promise<ReviewQueue> {
  const settings = await reviewSettings(db, userId);
  const limit = q.limit ?? settings.sessionSize;
  const kinds = KINDS_OF[q.mode];
  const newLeftToday = Math.max(0, settings.newPerDay - (await newIntroducedToday(db, userId, q.today)));
  if (kinds.length === 0) return { cards: [], dueCount: 0, newCount: 0, newLeftToday };

  const s = scopeOf(userId, q.topicIds);
  const now = nowIso();
  const base = `c.user_id = ? AND c.status = 'active' AND c.kind IN (${placeholders(kinds.length)}) AND ${CARD_LIVE} AND ${s.has(CARD_TOPIC)}`;
  const baseBinds: Bindable[] = [userId, ...kinds];
  const counts = await first(
    db,
    `${s.cte}SELECT
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${base} AND c.phase > 0 AND c.due <= ?) AS due,
       (SELECT COUNT(*) FROM ${CARD_FROM} WHERE ${base} AND c.phase = 0) AS fresh`,
    ...s.binds,
    ...baseBinds,
    now,
    ...baseBinds,
  );

  let rows: Row[];
  if (q.mode === 'practice') {
    const reviewed = await all(db, `${s.cte}SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE ${base} AND c.phase > 0 ORDER BY c.due LIMIT 500`, ...s.binds, ...baseBinds);
    const at = new Date();
    rows = reviewed
      .map((r) => ({ r, p: retrievability(scheduleOf(r), at) }))
      .sort((a, b) => a.p - b.p)
      .map((x) => x.r);
    if (rows.length < limit) {
      rows.push(...(await all(db, `${s.cte}SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE ${base} AND c.phase = 0 ORDER BY c.created_at, c.cloze_index LIMIT ?`, ...s.binds, ...baseBinds, limit)));
    }
  } else {
    const due = await all(db, `${s.cte}SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE ${base} AND c.phase > 0 AND c.due <= ? ORDER BY c.due LIMIT ?`, ...s.binds, ...baseBinds, now, limit * 2);
    const fresh = newLeftToday > 0
      ? await all(db, `${s.cte}SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE ${base} AND c.phase = 0 ORDER BY c.created_at, c.cloze_index LIMIT ?`, ...s.binds, ...baseBinds, newLeftToday * 3)
      : [];
    rows = [...due, ...fresh];
  }

  // One card per group, the new ones within the daily limit.
  const groups = new Set<string>();
  const picked: ReviewCard[] = [];
  let newPicked = 0;
  for (const r of rows) {
    if (picked.length >= limit) break;
    const card = toCard(r);
    if (groups.has(card.groupId)) continue;
    if (card.schedule.phase === 0 && q.mode !== 'practice') {
      if (newPicked >= newLeftToday) continue;
      newPicked++;
    }
    groups.add(card.groupId);
    picked.push(card);
  }
  return {
    cards: interleave(picked, (c) => c.topicId ?? '-'),
    dueCount: num(counts?.due),
    newCount: num(counts?.fresh),
    newLeftToday,
  };
}

/* -------------------------------------------------------------- answer -- */

function toLog(r: Row): ReviewLog {
  const evaluation = zReviewEvaluation.safeParse(parseJson(r.evaluation_json, null));
  return {
    id: str(r.id),
    cardId: str(r.card_id),
    sessionId: strOrNull(r.session_id),
    rating: num(r.rating),
    confidence: numOrNull(r.confidence),
    phaseBefore: num(r.phase_before),
    elapsedDays: num(r.elapsed_days),
    scheduledDays: num(r.scheduled_days),
    durationMs: num(r.duration_ms),
    answer: str(r.answer),
    prompt: str(r.prompt),
    score: numOrNull(r.score),
    evaluation: evaluation.success ? evaluation.data : null,
    disputed: num(r.disputed) === 1,
    reviewedAt: str(r.reviewed_at),
    localDay: str(r.local_day),
  };
}

/** Answers kept for offline sessions arrive later; older than this they are refused. */
const LATE_ANSWER_DAYS = 30;

/**
 * Records one answer: FSRS computes the next state from the rating (the
 * server's clock, or the time the answer was given offline) and the card
 * and its log are written together. Retrying with the same id is a no-op.
 */
export async function answerCard(db: D1Database, userId: string, cardId: string, raw: ReviewAnswer): Promise<{ card: ReviewCard; log: ReviewLog }> {
  const input = zReviewAnswer.parse(raw);
  const existing = await first(db, 'SELECT * FROM review_logs WHERE id = ? AND user_id = ?', input.id, userId);
  if (existing) {
    if (str(existing.card_id) !== cardId) throw conflict('Esta resposta já foi registrada para outro cartão');
    return { card: await getCard(db, userId, cardId), log: toLog(existing) };
  }
  const row = await first(db, `SELECT ${CARD_COLUMNS} FROM ${CARD_JOINED} WHERE c.id = ? AND c.user_id = ? AND ${CARD_LIVE}`, cardId, userId);
  if (!row) throw notFound('Cartão');
  if (input.sessionId) await assertSession(db, userId, input.sessionId);
  const card = toCard(row);
  const settings = await reviewSettings(db, userId);

  const nowMs = Date.now();
  let at = input.reviewedAt ? Date.parse(input.reviewedAt) : nowMs;
  if (at > nowMs + 5 * 60_000) throw badRequest('Horário da resposta no futuro');
  if (at < nowMs - LATE_ANSWER_DAYS * 86_400_000) throw badRequest('Resposta antiga demais para ser registrada');
  at = Math.min(at, nowMs);
  // Answers sent out of order (offline) never go back in time.
  if (card.schedule.lastReview && at < Date.parse(card.schedule.lastReview)) at = Date.parse(card.schedule.lastReview);
  const reviewedAt = new Date(at);

  const { state, elapsedDays } = nextState(card.schedule, reviewedAt, input.rating, { desiredRetention: settings.desiredRetention, fuzz: true });
  const updatedAt = nowIso();
  const guard = 'EXISTS (SELECT 1 FROM review_cards WHERE id = ? AND version = ? AND updated_at = ?)';
  const g = [cardId, card.version + 1, updatedAt] as const;
  const results = await db.batch([
    stmt(
      db,
      `UPDATE review_cards SET phase = ?, due = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
         last_review = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?`,
      state.phase,
      state.due,
      state.stability,
      state.difficulty,
      state.scheduledDays,
      state.learningSteps,
      state.reps,
      state.lapses,
      state.lastReview,
      updatedAt,
      cardId,
      userId,
      card.version,
    ),
    stmt(
      db,
      `INSERT INTO review_logs (id, user_id, card_id, session_id, rating, confidence, phase_before, elapsed_days, scheduled_days, duration_ms,
         answer, prompt, score, evaluation_json, disputed, reviewed_at, local_day, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      input.id,
      userId,
      cardId,
      input.sessionId,
      input.rating,
      input.confidence,
      card.schedule.phase,
      elapsedDays,
      state.scheduledDays,
      input.durationMs,
      input.answer,
      input.prompt,
      input.score,
      input.evaluation ? JSON.stringify(input.evaluation) : null,
      input.disputed ? 1 : 0,
      reviewedAt.toISOString(),
      input.localDay,
      updatedAt,
      ...g,
    ),
    stmt(
      db,
      `UPDATE review_sessions SET reviewed = reviewed + 1, correct = correct + ?, version = version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND ${guard}`,
      isCorrect(input.rating) ? 1 : 0,
      updatedAt,
      input.sessionId,
      userId,
      ...g,
    ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) throw versionConflict(card);
  const log = await first(db, 'SELECT * FROM review_logs WHERE id = ?', input.id);
  return { card: await getCard(db, userId, cardId), log: toLog(log!) };
}

async function assertSession(db: D1Database, userId: string, id: string): Promise<void> {
  if (!(await first(db, 'SELECT 1 AS ok FROM review_sessions WHERE id = ? AND user_id = ?', id, userId))) throw badRequest('Sessão de revisão não existe');
}

export { toLog };
