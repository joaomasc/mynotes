import { uuidv7, type StudySession, type StudySessionCreate, type StudySessionUpdate, type StudyStats } from '@mynotes/shared';
import { badRequest, notFound, versionConflict } from '../../lib/errors';
import { all, first, num, numOrNull, str, strOrNull, stmt, versionedUpdateStmt, type Bindable, type Row } from '../../lib/db';
import { activityStmt, assertReference, assertReferences } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { nowIso } from '../../lib/time';

function toSession(r: Row, noteIds: string[], documentIds: string[]): StudySession {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    startedAt: str(r.started_at),
    durationSeconds: num(r.duration_seconds),
    objective: str(r.objective),
    notes: str(r.notes),
    progressRating: numOrNull(r.progress_rating),
    source: str(r.source) as StudySession['source'],
    noteIds,
    documentIds,
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

/** Loads the note/document references for a set of sessions in two queries. */
export async function hydrateSessions(db: D1Database, rows: Row[]): Promise<StudySession[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => str(r.id));
  const marks = ids.map(() => '?').join(',');
  const [notes, docs] = await db.batch<{ session_id: string; ref: string }>([
    stmt(db, `SELECT session_id, note_id AS ref FROM study_session_notes WHERE session_id IN (${marks})`, ...ids),
    stmt(db, `SELECT session_id, document_id AS ref FROM study_session_documents WHERE session_id IN (${marks})`, ...ids),
  ]);
  const group = (res: D1Result<{ session_id: string; ref: string }> | undefined) => {
    const map = new Map<string, string[]>();
    for (const r of res?.results ?? []) map.set(r.session_id, [...(map.get(r.session_id) ?? []), r.ref]);
    return map;
  };
  const n = group(notes);
  const d = group(docs);
  return rows.map((r) => toSession(r, n.get(str(r.id)) ?? [], d.get(str(r.id)) ?? []));
}

async function sessionRow(db: D1Database, userId: string, id: string) {
  return first(db, 'SELECT * FROM study_sessions WHERE id = ? AND user_id = ?', id, userId);
}

export async function getSession(db: D1Database, userId: string, id: string): Promise<StudySession> {
  const row = await sessionRow(db, userId, id);
  if (!row) throw notFound('Sessão de estudo');
  return (await hydrateSessions(db, [row]))[0]!;
}

const SORT: SortSpec = { expr: 'started_at', field: 'started_at', dir: 'DESC' };

export async function listSessions(
  db: D1Database,
  userId: string,
  q: { from?: string | undefined; to?: string | undefined; topicId?: string | undefined; cursor?: string | undefined; limit: number },
) {
  let where = 'user_id = ?';
  const binds: Bindable[] = [userId];
  if (q.from) {
    where += ' AND started_at >= ?';
    binds.push(q.from);
  }
  if (q.to) {
    where += ' AND started_at < ?';
    binds.push(q.to);
  }
  if (q.topicId) {
    where += ' AND topic_id = ?';
    binds.push(q.topicId);
  }
  const page = keyset(SORT, q.cursor);
  const rows = await all(
    db,
    `SELECT * FROM study_sessions WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`,
    ...binds,
    ...page.binds,
    q.limit + 1,
  );
  const { items, nextCursor } = pageOf(rows, q.limit, SORT);
  return { items: await hydrateSessions(db, items), nextCursor };
}

/**
 * Replaces a session's references. Applied only if the write in the same
 * batch succeeded (the session now has exactly this version and timestamp).
 */
function refStatements(
  db: D1Database,
  sessionId: string,
  version: number,
  updatedAt: string,
  noteIds: string[],
  documentIds: string[],
) {
  const guard = 'EXISTS (SELECT 1 FROM study_sessions WHERE id = ? AND version = ? AND updated_at = ?)';
  const g = [sessionId, version, updatedAt] as const;
  const out = [
    stmt(db, `DELETE FROM study_session_notes WHERE session_id = ? AND ${guard}`, sessionId, ...g),
    stmt(db, `DELETE FROM study_session_documents WHERE session_id = ? AND ${guard}`, sessionId, ...g),
  ];
  for (const id of new Set(noteIds)) {
    out.push(
      stmt(
        db,
        `INSERT OR IGNORE INTO study_session_notes (session_id, note_id) SELECT ?, ? WHERE ${guard}`,
        sessionId,
        id,
        ...g,
      ),
    );
  }
  for (const id of new Set(documentIds)) {
    out.push(
      stmt(
        db,
        `INSERT OR IGNORE INTO study_session_documents (session_id, document_id) SELECT ?, ? WHERE ${guard}`,
        sessionId,
        id,
        ...g,
      ),
    );
  }
  return out;
}

function assertNotFuture(startedAt: string) {
  if (Date.parse(startedAt) > Date.now() + 5 * 60 * 1000) throw badRequest('A sessão não pode começar no futuro');
}

export async function createSession(
  db: D1Database,
  userId: string,
  input: Required<Omit<StudySessionCreate, 'id'>> & { id?: string | undefined },
): Promise<{ session: StudySession; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM study_sessions WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { session: await getSession(db, userId, id), created: false };
  }
  assertNotFuture(input.startedAt);
  await assertReference(db, 'topics', input.topicId, userId);
  await assertReferences(db, 'notes', input.noteIds, userId);
  await assertReferences(db, 'documents', input.documentIds, userId);
  const now = nowIso();
  const topicTitle = input.topicId
    ? str((await first(db, 'SELECT title FROM topics WHERE id = ?', input.topicId))?.title)
    : '';
  await db.batch([
    stmt(
      db,
      `INSERT INTO study_sessions (id, user_id, topic_id, started_at, duration_seconds, objective, notes,
                                   progress_rating, source, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      userId,
      input.topicId,
      input.startedAt,
      input.durationSeconds,
      input.objective,
      input.notes,
      input.progressRating,
      input.source,
      now,
      now,
    ),
    ...refStatements(db, id, 1, now, input.noteIds, input.documentIds),
    activityStmt(db, userId, 'session', id, 'studied', topicTitle || input.objective || 'Sessão de estudo'),
  ]);
  return { session: await getSession(db, userId, id), created: true };
}

export async function updateSession(
  db: D1Database,
  userId: string,
  id: string,
  input: StudySessionUpdate,
): Promise<StudySession> {
  const current = await sessionRow(db, userId, id);
  if (!current) throw notFound('Sessão de estudo');
  if (num(current.version) !== input.baseVersion) throw versionConflict(await getSession(db, userId, id));
  if (input.startedAt) assertNotFuture(input.startedAt);
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  if (input.noteIds) await assertReferences(db, 'notes', input.noteIds, userId);
  if (input.documentIds) await assertReferences(db, 'documents', input.documentIds, userId);

  const map: Record<string, string> = {
    topicId: 'topic_id',
    startedAt: 'started_at',
    durationSeconds: 'duration_seconds',
    objective: 'objective',
    notes: 'notes',
    progressRating: 'progress_rating',
  };
  const set: Record<string, Bindable> = {};
  for (const [field, col] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) set[col] = value as Bindable;
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    versionedUpdateStmt(db, { table: 'study_sessions', id, userId, baseVersion: input.baseVersion, set, now }),
  ];
  if (input.noteIds || input.documentIds) {
    const existing = await getSession(db, userId, id);
    statements.push(
      ...refStatements(
        db,
        id,
        input.baseVersion + 1,
        now,
        input.noteIds ?? existing.noteIds,
        input.documentIds ?? existing.documentIds,
      ),
    );
  }
  const results = await db.batch(statements);
  if (!(results[0]?.results as Row[] | undefined)?.[0]) {
    throw versionConflict(await getSession(db, userId, id));
  }
  return getSession(db, userId, id);
}

export async function deleteSession(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM study_sessions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Sessão de estudo');
}

function tzModifier(offsetMinutes: number): string {
  return `${offsetMinutes >= 0 ? '+' : '-'}${Math.abs(offsetMinutes)} minutes`;
}

export async function stats(
  db: D1Database,
  userId: string,
  q: { from: string; to: string; tzOffset: number },
): Promise<StudyStats> {
  const mod = tzModifier(q.tzOffset);
  const [byDay, byTopic] = await db.batch<Row>([
    stmt(
      db,
      `SELECT date(started_at, ?) AS day, SUM(duration_seconds) AS seconds, COUNT(*) AS sessions
         FROM study_sessions WHERE user_id = ? AND started_at >= ? AND started_at < ?
        GROUP BY day ORDER BY day`,
      mod,
      userId,
      q.from,
      q.to,
    ),
    stmt(
      db,
      `SELECT topic_id, SUM(duration_seconds) AS seconds, COUNT(*) AS sessions
         FROM study_sessions WHERE user_id = ? AND started_at >= ? AND started_at < ?
        GROUP BY topic_id ORDER BY seconds DESC`,
      userId,
      q.from,
      q.to,
    ),
  ]);
  const days = (byDay?.results ?? []).map((r) => ({
    date: str(r.day),
    seconds: num(r.seconds),
    sessions: num(r.sessions),
  }));
  return {
    totalSeconds: days.reduce((s, d) => s + d.seconds, 0),
    sessionCount: days.reduce((s, d) => s + d.sessions, 0),
    activeDays: days.length,
    byDay: days,
    byTopic: (byTopic?.results ?? []).map((r) => ({
      topicId: strOrNull(r.topic_id),
      seconds: num(r.seconds),
      sessions: num(r.sessions),
    })),
  };
}
