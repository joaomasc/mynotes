import {
  normalizeAligned,
  searchTerms,
  uuidv7,
  type Reading,
  type ReadingCreate,
  type ReadingUpdate,
} from '@mynotes/shared';
import { badRequest, notFound } from '../../lib/errors';
import { all, first, num, numOrNull, str, strOrNull, stmt, versionedUpdate, type Bindable, type Row } from '../../lib/db';
import { activityStmt, assertReference } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { nowIso } from '../../lib/time';

export function toReading(r: Row): Reading {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    documentId: strOrNull(r.document_id),
    title: str(r.title),
    author: str(r.author),
    materialType: str(r.material_type) as Reading['materialType'],
    status: str(r.status) as Reading['status'],
    totalPages: numOrNull(r.total_pages),
    currentPage: numOrNull(r.current_page),
    progressPercent: numOrNull(r.progress_percent),
    startedOn: strOrNull(r.started_on),
    completedOn: strOrNull(r.completed_on),
    dueOn: strOrNull(r.due_on),
    priority: num(r.priority),
    notes: str(r.notes),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const COLUMNS: Record<string, string> = {
  topicId: 'topic_id',
  documentId: 'document_id',
  title: 'title',
  author: 'author',
  materialType: 'material_type',
  status: 'status',
  totalPages: 'total_pages',
  currentPage: 'current_page',
  progressPercent: 'progress_percent',
  startedOn: 'started_on',
  completedOn: 'completed_on',
  dueOn: 'due_on',
  priority: 'priority',
  notes: 'notes',
};

const readingSearchText = (title: string, author: string, notes: string) =>
  normalizeAligned(`${title} ${author} ${notes}`.normalize('NFC'));

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Keeps status, dates and progress coherent: completing sets the completion
 * date and full progress; starting sets the start date.
 */
function applyRules(r: Partial<Reading>): Partial<Reading> {
  const out = { ...r };
  if (out.totalPages != null && out.currentPage != null && out.currentPage > out.totalPages) {
    throw badRequest('A página atual não pode ser maior que o total de páginas');
  }
  if (out.status === 'completed') {
    out.completedOn ??= today();
    out.startedOn ??= out.completedOn;
    if (out.totalPages != null) out.currentPage = out.totalPages;
    out.progressPercent = 100;
  } else {
    if (out.status === 'in_progress') out.startedOn ??= today();
    if (out.status === 'not_started' || out.status === 'in_progress') out.completedOn = null;
    if (out.totalPages != null && out.currentPage != null) {
      out.progressPercent = Math.round((out.currentPage / out.totalPages) * 1000) / 10;
    }
  }
  if (out.startedOn && out.completedOn && out.completedOn < out.startedOn) {
    throw badRequest('A data de conclusão não pode ser anterior à de início');
  }
  return out;
}

export async function getReadingRow(db: D1Database, userId: string, id: string) {
  return first(db, 'SELECT * FROM readings WHERE id = ? AND user_id = ?', id, userId);
}

const SORTS: Record<string, SortSpec> = {
  updated: { expr: 'updated_at', field: 'updated_at', dir: 'DESC' },
  due: { expr: "COALESCE(due_on, '9999-12-31')", field: 'due_sort', dir: 'ASC' },
  priority: { expr: 'priority', field: 'priority', dir: 'DESC' },
  title: { expr: 'title', field: 'title', dir: 'ASC' },
};

export async function listReadings(
  db: D1Database,
  userId: string,
  q: {
    status?: string | undefined;
    topicId?: string | undefined;
    overdue?: string | undefined;
    q?: string | undefined;
    sort: string;
    cursor?: string | undefined;
    limit: number;
  },
) {
  let where = 'user_id = ?';
  const binds: Bindable[] = [userId];
  if (q.status) {
    where += ' AND status = ?';
    binds.push(q.status);
  }
  if (q.topicId) {
    where += ' AND topic_id = ?';
    binds.push(q.topicId);
  }
  if (q.overdue === 'true') {
    where += " AND status <> 'completed' AND due_on IS NOT NULL AND due_on < ?";
    binds.push(today());
  }
  for (const term of searchTerms(q.q ?? '')) {
    where += ' AND instr(search_text, ?) > 0';
    binds.push(term);
  }
  const sort = SORTS[q.sort] ?? SORTS.updated!;
  const page = keyset(sort, q.cursor);
  const rows = await all(
    db,
    `SELECT *, COALESCE(due_on, '9999-12-31') AS due_sort FROM readings WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`,
    ...binds,
    ...page.binds,
    q.limit + 1,
  );
  const { items, nextCursor } = pageOf(rows, q.limit, sort);
  return { items: items.map(toReading), nextCursor };
}

async function checkRefs(db: D1Database, userId: string, r: Partial<Reading>) {
  if (r.topicId !== undefined) await assertReference(db, 'topics', r.topicId, userId);
  if (r.documentId !== undefined) await assertReference(db, 'documents', r.documentId, userId);
}

export async function createReading(
  db: D1Database,
  userId: string,
  input: Required<Omit<ReadingCreate, 'id'>> & { id?: string | undefined },
): Promise<{ reading: Reading; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM readings WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { reading: toReading(existing), created: false };
  }
  const r = applyRules({ ...input, title: input.title.normalize('NFC') }) as Reading;
  await checkRefs(db, userId, r);
  const now = nowIso();
  const cols = Object.values(COLUMNS);
  const values = Object.keys(COLUMNS).map((k) => (r as unknown as Record<string, Bindable>)[k] ?? null);
  const [inserted] = await db.batch([
    stmt(
      db,
      `INSERT INTO readings (id, user_id, ${cols.join(', ')}, search_text, version, created_at, updated_at)
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, 1, ?, ?) RETURNING *`,
      id,
      userId,
      ...values,
      readingSearchText(r.title, r.author, r.notes),
      now,
      now,
    ),
    activityStmt(db, userId, 'reading', id, 'created', r.title),
  ]);
  return { reading: toReading((inserted?.results as Row[])[0]!), created: true };
}

export async function updateReading(db: D1Database, userId: string, id: string, input: ReadingUpdate): Promise<Reading> {
  const currentRow = await getReadingRow(db, userId, id);
  if (!currentRow) throw notFound('Leitura');
  const current = toReading(currentRow);
  const { baseVersion, ...changes } = input;
  const merged = applyRules({ ...current, ...changes });
  await checkRefs(db, userId, changes as Partial<Reading>);

  const set: Record<string, Bindable> = {};
  for (const [field, col] of Object.entries(COLUMNS)) {
    const value = (merged as Record<string, unknown>)[field];
    if (value !== (current as unknown as Record<string, unknown>)[field]) set[col] = (value ?? null) as Bindable;
  }
  if (Object.keys(set).length === 0) return current;
  set.search_text = readingSearchText(merged.title ?? '', merged.author ?? '', merged.notes ?? '');

  const row = await versionedUpdate(
    db,
    { table: 'readings', id, userId, baseVersion, set },
    async () => {
      const r = await getReadingRow(db, userId, id);
      return r ? toReading(r) : null;
    },
    'Leitura',
  );
  if (merged.status === 'completed' && current.status !== 'completed') {
    await activityStmt(db, userId, 'reading', id, 'completed', str(row.title)).run();
  } else {
    await activityStmt(db, userId, 'reading', id, 'updated', str(row.title), 600).run();
  }
  return toReading(row);
}

export async function deleteReading(db: D1Database, userId: string, id: string): Promise<void> {
  const row = await getReadingRow(db, userId, id);
  if (!row) throw notFound('Leitura');
  await db.batch([
    stmt(db, 'DELETE FROM readings WHERE id = ? AND user_id = ?', id, userId),
    activityStmt(db, userId, 'reading', id, 'deleted', str(row.title)),
  ]);
}
