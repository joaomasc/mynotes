import {
  EMPTY_DOC,
  NOTE_CONTENT_MAX_BYTES,
  NOTE_REVISIONS_KEEP,
  NOTE_REVISION_INTERVAL_SECONDS,
  analyzeDoc,
  makeExcerpt,
  normalizeAligned,
  utf8Length,
  uuidv7,
  type Backlink,
  type InternalLink,
  type Note,
  type NoteRevision,
  type NoteRevisionSummary,
  type NoteSummary,
  type RichTextDoc,
} from '@mynotes/shared';
import { badRequest, notFound, tooLarge, versionConflict } from '../../lib/errors';
import { all, first, num, parseJson, str, strOrNull, stmt, versionedUpdateStmt, type Row } from '../../lib/db';
import { activityStmt, assertReference, sortKeyFor } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { isoBefore, nowIso } from '../../lib/time';

const SUMMARY_COLS =
  'id, topic_id, title, excerpt, word_count, sort_key, version, created_at, updated_at';

export function toNoteSummary(r: Row): NoteSummary {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    title: str(r.title),
    excerpt: str(r.excerpt),
    wordCount: num(r.word_count),
    sortKey: str(r.sort_key),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toNote(r: Row): Note {
  return { ...toNoteSummary(r), content: parseJson<RichTextDoc>(r.content, EMPTY_DOC) };
}

interface Derived {
  content: string;
  bodyText: string;
  excerpt: string;
  wordCount: number;
  links: InternalLink[];
}

/** Sanitizes the document and computes the derived columns. */
function derive(doc: RichTextDoc): Derived {
  const analysis = analyzeDoc(doc); // strips unsafe links in place
  const content = JSON.stringify(doc);
  if (utf8Length(content) > NOTE_CONTENT_MAX_BYTES) {
    throw tooLarge(`A nota excede o tamanho máximo (${Math.round(NOTE_CONTENT_MAX_BYTES / 1000)} KB)`);
  }
  const bodyText = analysis.text.normalize('NFC');
  return {
    content,
    bodyText,
    excerpt: makeExcerpt(bodyText),
    wordCount: analysis.wordCount,
    links: analysis.links,
  };
}

const noteSearchText = (title: string, bodyText: string) => normalizeAligned(`${title} ${bodyText}`);

const notesScope = (userId: string, topicId: string | null, excludeId?: string) => ({
  table: 'notes',
  where: 'user_id = ? AND topic_id IS ? AND deleted_at IS NULL',
  binds: [userId, topicId],
  excludeId,
});

/**
 * Statements replacing a note's internal links. They only apply if the write
 * in the same batch succeeded, i.e. the note now has exactly this version and
 * timestamp (the version alone is ambiguous if it was already reached).
 */
function linkStatements(db: D1Database, noteId: string, version: number, updatedAt: string, links: InternalLink[]) {
  const guard = 'EXISTS (SELECT 1 FROM notes WHERE id = ? AND version = ? AND updated_at = ?)';
  const out = [stmt(db, `DELETE FROM note_links WHERE note_id = ? AND ${guard}`, noteId, noteId, version, updatedAt)];
  const unique = links.filter((l) => !(l.type === 'note' && l.id === noteId)).slice(0, 500);
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    out.push(
      stmt(
        db,
        `INSERT OR IGNORE INTO note_links (note_id, target_type, target_id)
         SELECT column1, column2, column3 FROM (VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')})
          WHERE ${guard}`,
        ...chunk.flatMap((l) => [noteId, l.type, l.id]),
        noteId,
        version,
        updatedAt,
      ),
    );
  }
  return out;
}

export async function getNoteRow(db: D1Database, userId: string, id: string): Promise<Row | null> {
  return first(db, 'SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, userId);
}

export async function getNote(db: D1Database, userId: string, id: string): Promise<Note> {
  const row = await getNoteRow(db, userId, id);
  if (!row) throw notFound('Nota');
  return toNote(row);
}

const SORTS: Record<string, SortSpec> = {
  updated: { expr: 'updated_at', field: 'updated_at', dir: 'DESC' },
  created: { expr: 'created_at', field: 'created_at', dir: 'DESC' },
  manual: { expr: 'sort_key', field: 'sort_key', dir: 'ASC' },
  title: { expr: 'title', field: 'title', dir: 'ASC' },
};

export async function listNotes(
  db: D1Database,
  userId: string,
  q: { topicId?: string | undefined; sort: string; cursor?: string | undefined; limit: number },
) {
  const sort = SORTS[q.sort] ?? SORTS.updated!;
  const page = keyset(sort, q.cursor);
  let where = 'user_id = ? AND deleted_at IS NULL';
  const binds: (string | number | null)[] = [userId];
  if (q.topicId === 'none') where += ' AND topic_id IS NULL';
  else if (q.topicId) {
    where += ' AND topic_id = ?';
    binds.push(q.topicId);
  }
  const rows = await all(
    db,
    `SELECT ${SUMMARY_COLS} FROM notes WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`,
    ...binds,
    ...page.binds,
    q.limit + 1,
  );
  const { items, nextCursor } = pageOf(rows, q.limit, sort);
  return { items: items.map(toNoteSummary), nextCursor };
}

export interface CreateNoteInput {
  id?: string | undefined;
  topicId: string | null;
  title: string;
  content?: RichTextDoc | undefined;
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

export async function createNote(
  db: D1Database,
  userId: string,
  input: CreateNoteInput,
): Promise<{ note: Note; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM notes WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { note: toNote(existing), created: false };
  }
  await assertReference(db, 'topics', input.topicId, userId);
  const d = derive(input.content ?? structuredClone(EMPTY_DOC));
  const title = input.title.normalize('NFC');
  const sortKey = await sortKeyFor(db, notesScope(userId, input.topicId), input);
  const now = nowIso();
  const [inserted] = await db.batch([
    stmt(
      db,
      `INSERT INTO notes (id, user_id, topic_id, title, content, excerpt, word_count, body_text, search_text,
                          sort_key, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
      id,
      userId,
      input.topicId,
      title,
      d.content,
      d.excerpt,
      d.wordCount,
      d.bodyText,
      noteSearchText(title, d.bodyText),
      sortKey,
      now,
      now,
    ),
    ...linkStatements(db, id, 1, now, d.links),
    activityStmt(db, userId, 'note', id, 'created', title || 'Sem título'),
  ]);
  return { note: toNote((inserted?.results as Row[])[0]!), created: true };
}

export interface UpdateNoteInput {
  baseVersion: number;
  title?: string | undefined;
  content?: RichTextDoc | undefined;
  topicId?: string | null | undefined;
}

/**
 * Saves a note with optimistic concurrency. A snapshot of the previous state
 * is kept as a revision at most every NOTE_REVISION_INTERVAL_SECONDS.
 * Returns the summary (the client already holds the content it sent).
 */
export async function updateNote(
  db: D1Database,
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<NoteSummary> {
  const current = await getNoteRow(db, userId, id);
  if (!current) throw notFound('Nota');
  if (num(current.version) !== input.baseVersion) throw versionConflict(toNote(current));

  const set: Record<string, string | number | null> = {};
  const title = input.title !== undefined ? input.title.normalize('NFC') : str(current.title);
  let bodyText = str(current.body_text);
  let links: InternalLink[] | null = null;
  if (input.content !== undefined) {
    const d = derive(input.content);
    set.content = d.content;
    set.excerpt = d.excerpt;
    set.word_count = d.wordCount;
    set.body_text = d.bodyText;
    bodyText = d.bodyText;
    links = d.links;
  }
  if (input.title !== undefined) set.title = title;
  if (input.title !== undefined || input.content !== undefined) set.search_text = noteSearchText(title, bodyText);
  if (input.topicId !== undefined && input.topicId !== strOrNull(current.topic_id)) {
    await assertReference(db, 'topics', input.topicId, userId);
    set.topic_id = input.topicId;
    set.sort_key = await sortKeyFor(db, notesScope(userId, input.topicId, id));
  }
  if (Object.keys(set).length === 0) return toNoteSummary(current);

  const contentChanged = input.content !== undefined || input.title !== undefined;
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (contentChanged) {
    statements.push(
      stmt(
        db,
        `INSERT INTO note_revisions (id, note_id, version, title, content, word_count, created_at)
         SELECT ?, id, version, title, content, word_count, ? FROM notes
          WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
            AND (word_count > 0 OR title <> '')
            AND NOT EXISTS (SELECT 1 FROM note_revisions WHERE note_id = ? AND created_at > ?)`,
        uuidv7(),
        now,
        id,
        userId,
        input.baseVersion,
        id,
        isoBefore(NOTE_REVISION_INTERVAL_SECONDS),
      ),
    );
  }
  statements.push(
    versionedUpdateStmt(db, { table: 'notes', id, userId, baseVersion: input.baseVersion, set, trashable: true, now }),
  );
  const updateIdx = statements.length - 1;
  if (links) statements.push(...linkStatements(db, id, input.baseVersion + 1, now, links));
  if (contentChanged) {
    statements.push(
      stmt(
        db,
        `DELETE FROM note_revisions WHERE note_id = ? AND id NOT IN (
           SELECT id FROM note_revisions WHERE note_id = ? ORDER BY created_at DESC LIMIT ?)`,
        id,
        id,
        NOTE_REVISIONS_KEEP,
      ),
    );
  }
  statements.push(activityStmt(db, userId, 'note', id, 'updated', title || 'Sem título', 600));

  const results = await db.batch(statements);
  const row = (results[updateIdx]?.results as Row[] | undefined)?.[0];
  if (!row) {
    // Lost a race with another write between the read and the batch.
    const latest = await getNoteRow(db, userId, id);
    if (!latest) throw notFound('Nota');
    throw versionConflict(toNote(latest));
  }
  return toNoteSummary(row);
}

export async function moveNote(
  db: D1Database,
  userId: string,
  id: string,
  input: { baseVersion: number; topicId: string | null; afterId?: string | null | undefined; beforeId?: string | null | undefined },
): Promise<NoteSummary> {
  const current = await getNoteRow(db, userId, id);
  if (!current) throw notFound('Nota');
  await assertReference(db, 'topics', input.topicId, userId);
  const sortKey = await sortKeyFor(db, notesScope(userId, input.topicId, id), input);
  const row = await versionedUpdateStmt(db, {
    table: 'notes',
    id,
    userId,
    baseVersion: input.baseVersion,
    set: { topic_id: input.topicId, sort_key: sortKey },
    trashable: true,
  }).first<Row>();
  if (!row) throw versionConflict(toNote(current));
  return toNoteSummary(row);
}

export async function trashNote(db: D1Database, userId: string, id: string): Promise<void> {
  const current = await getNoteRow(db, userId, id);
  if (!current) throw notFound('Nota');
  const now = nowIso();
  await db.batch([
    stmt(
      db,
      'UPDATE notes SET deleted_at = ?, delete_batch = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      now,
      id,
      userId,
    ),
    activityStmt(db, userId, 'note', id, 'deleted', str(current.title) || 'Sem título'),
  ]);
}

export async function listRevisions(db: D1Database, userId: string, noteId: string): Promise<NoteRevisionSummary[]> {
  const note = await getNoteRow(db, userId, noteId);
  if (!note) throw notFound('Nota');
  const rows = await all(
    db,
    'SELECT id, note_id, version, title, word_count, created_at FROM note_revisions WHERE note_id = ? ORDER BY created_at DESC',
    noteId,
  );
  return rows.map((r) => ({
    id: str(r.id),
    noteId: str(r.note_id),
    version: num(r.version),
    title: str(r.title),
    wordCount: num(r.word_count),
    createdAt: str(r.created_at),
  }));
}

export async function getRevision(db: D1Database, userId: string, noteId: string, revisionId: string): Promise<NoteRevision> {
  const row = await first(
    db,
    `SELECT r.* FROM note_revisions r JOIN notes n ON n.id = r.note_id
      WHERE r.id = ? AND r.note_id = ? AND n.user_id = ?`,
    revisionId,
    noteId,
    userId,
  );
  if (!row) throw notFound('Revisão');
  return {
    id: str(row.id),
    noteId: str(row.note_id),
    version: num(row.version),
    title: str(row.title),
    wordCount: num(row.word_count),
    createdAt: str(row.created_at),
    content: parseJson<RichTextDoc>(row.content, EMPTY_DOC),
  };
}

export async function backlinks(db: D1Database, userId: string, type: string, id: string): Promise<Backlink[]> {
  const rows = await all(
    db,
    `SELECT n.id, n.title, n.topic_id, n.updated_at FROM note_links l JOIN notes n ON n.id = l.note_id
      WHERE l.target_type = ? AND l.target_id = ? AND n.user_id = ? AND n.deleted_at IS NULL
      ORDER BY n.updated_at DESC LIMIT 200`,
    type,
    id,
    userId,
  );
  return rows.map((r) => ({
    noteId: str(r.id),
    title: str(r.title),
    topicId: strOrNull(r.topic_id),
    updatedAt: str(r.updated_at),
  }));
}
