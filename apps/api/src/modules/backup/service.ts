import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  BACKUP_TABLE_ORDER,
  backupColumns,
  uuidv7,
  type BackupManifest,
  type BackupTableName,
  type ImportMode,
  type ImportResult,
} from '@mynotes/shared';
import { z } from 'zod';
import { ApiError, badRequest, notFound } from '../../lib/errors';
import { all, first, num, str, stmt, type Bindable, type Row } from '../../lib/db';
import { nowIso } from '../../lib/time';

type TableDef = (typeof BACKUP_TABLES)[BackupTableName];

function parentOf(def: TableDef): { column: string; table: string } | null {
  return 'parent' in def ? def.parent : null;
}

/** Ownership predicate for a backup table (child tables are owned through their parent). */
function ownerWhere(table: BackupTableName, alias = ''): string {
  const def = BACKUP_TABLES[table];
  const prefix = alias ? `${alias}.` : '';
  const parent = parentOf(def);
  if (def.hasUserId || !parent) return `${prefix}user_id = ?`;
  return `${prefix}${parent.column} IN (SELECT id FROM ${parent.table} WHERE user_id = ?)`;
}

const PAGE_SIZE: Partial<Record<BackupTableName, number>> = {
  notes: 100,
  note_revisions: 100,
  mind_maps: 100,
};

/* ----------------------------------------------------------------- export */

export async function exportManifest(db: D1Database, userId: string, appVersion: string): Promise<BackupManifest> {
  const results = await db.batch<{ n: number }>(
    BACKUP_TABLE_ORDER.map((table) => stmt(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${ownerWhere(table)}`, userId)),
  );
  const counts: Record<string, number> = {};
  BACKUP_TABLE_ORDER.forEach((table, i) => {
    counts[table] = num(results[i]?.results?.[0]?.n);
  });
  const files = await all<{ id: string }>(
    db,
    "SELECT id FROM documents WHERE user_id = ? AND status = 'ready' AND storage_key IS NOT NULL ORDER BY id",
    userId,
  );
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    createdAt: nowIso(),
    counts,
    files: files.map((f) => f.id),
  };
}

export async function exportTablePage(
  db: D1Database,
  userId: string,
  table: BackupTableName,
  cursor: string | undefined,
): Promise<{ rows: Row[]; nextCursor: string | null }> {
  const after = cursor ? Number.parseInt(cursor, 10) : 0;
  if (!Number.isFinite(after) || after < 0) throw badRequest('Cursor inválido');
  const limit = PAGE_SIZE[table] ?? 1000;
  const cols = backupColumns(table);
  const rows = await all(
    db,
    `SELECT rowid AS _rid, ${cols.join(', ')} FROM ${table} WHERE ${ownerWhere(table)} AND rowid > ?
      ORDER BY rowid LIMIT ?`,
    userId,
    after,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(({ _rid, ...rest }) => rest),
    nextCursor: rows.length > limit && last ? String(last._rid) : null,
  };
}

/* ----------------------------------------------------------------- import */

export async function createImportJob(
  db: D1Database,
  userId: string,
  mode: ImportMode,
  manifest: BackupManifest,
): Promise<{ jobId: string }> {
  const jobId = uuidv7();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO import_jobs (id, user_id, mode, status, manifest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(jobId, userId, mode, 'staging', JSON.stringify(manifest), now, now)
    .run();
  return { jobId };
}

async function stagingJob(db: D1Database, userId: string, jobId: string) {
  const job = await first(db, 'SELECT * FROM import_jobs WHERE id = ? AND user_id = ?', jobId, userId);
  if (!job) throw notFound('Importação');
  if (job.status !== 'staging') throw new ApiError('conflict', 'Esta importação já foi finalizada');
  return job;
}

/** Validates one chunk of rows against the table schema and stages it. */
export async function stageChunk(
  db: D1Database,
  userId: string,
  jobId: string,
  chunk: { seq: number; table: BackupTableName; rows: Record<string, unknown>[] },
): Promise<{ accepted: number }> {
  await stagingJob(db, userId, jobId);
  const schema = z.array(BACKUP_TABLES[chunk.table].row);
  const parsed = schema.safeParse(chunk.rows);
  if (!parsed.success) {
    throw new ApiError(
      'validation_error',
      `Dados inválidos na tabela ${chunk.table}`,
      parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  await db
    .prepare(
      `INSERT INTO import_chunks (job_id, seq, table_name, row_count, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (job_id, seq) DO UPDATE SET table_name = excluded.table_name, row_count = excluded.row_count, data = excluded.data`,
    )
    .bind(jobId, chunk.seq, chunk.table, parsed.data.length, JSON.stringify(parsed.data))
    .run();
  return { accepted: parsed.data.length };
}

const IMPORTED = (column = 'id') =>
  `SELECT json_extract(j.value, '$.${column}') FROM import_chunks c, json_each(c.data) j
    WHERE c.job_id = ? AND c.table_name = ?`;

/** Builds the upsert statement that applies all staged rows of one table. */
function upsertStatement(
  db: D1Database,
  table: BackupTableName,
  userId: string,
  jobId: string,
  mode: ImportMode,
): D1PreparedStatement {
  const def = BACKUP_TABLES[table];
  const cols = backupColumns(table);
  const parent = parentOf(def);
  const pk = 'primaryKey' in def ? def.primaryKey : 'id';
  const conflictTarget = table === 'settings' ? '(user_id, key)' : `(${pk})`;

  const insertCols = def.hasUserId ? ['user_id', ...cols] : cols;
  const selectExprs = cols.map((col) => {
    // Imported documents have no file yet: they wait for the binary upload.
    if (table === 'documents' && col === 'status') return "'pending'";
    if (table === 'documents' && col === 'uploaded_at') return 'NULL';
    return `json_extract(j.value, '$.${col}')`;
  });
  const select = def.hasUserId ? ['?', ...selectExprs] : selectExprs;
  const binds: Bindable[] = def.hasUserId ? [userId] : [];

  let where = 'c.job_id = ? AND c.table_name = ?';
  binds.push(jobId, table);
  if (parent) {
    where += ` AND json_extract(j.value, '$.${parent.column}') IN (SELECT id FROM ${parent.table} WHERE user_id = ?)`;
    binds.push(userId);
  }

  let conflict = 'ON CONFLICT DO NOTHING';
  const hasUpdatedAt = cols.includes('updated_at');
  if (def.mergeByUpdatedAt && hasUpdatedAt) {
    const updatable = cols.filter((c) => c !== pk && c !== 'key');
    const assignments = updatable.map((c) => {
      if (table === 'documents' && c === 'status') {
        return `status = CASE WHEN documents.storage_key IS NOT NULL AND documents.size_bytes = excluded.size_bytes
                         THEN documents.status ELSE 'pending' END`;
      }
      if (table === 'documents' && c === 'uploaded_at') {
        return `uploaded_at = CASE WHEN documents.size_bytes = excluded.size_bytes THEN documents.uploaded_at ELSE NULL END`;
      }
      return `${c} = excluded.${c}`;
    });
    const owner = def.hasUserId
      ? `${table}.user_id = excluded.user_id`
      : `${table}.${parent!.column} IN (SELECT id FROM ${parent!.table} WHERE user_id = ?)`;
    if (!def.hasUserId) binds.push(userId);
    const newer = mode === 'merge' ? ` AND excluded.updated_at > ${table}.updated_at` : '';
    conflict = `ON CONFLICT ${conflictTarget} DO UPDATE SET ${assignments.join(', ')} WHERE ${owner}${newer}`;
  }

  return db
    .prepare(
      `INSERT INTO ${table} (${insertCols.join(', ')})
       SELECT ${select.join(', ')} FROM import_chunks c, json_each(c.data) j
        WHERE ${where}
       ${conflict}`,
    )
    .bind(...binds);
}

/** Rows that exist in the database but not in the backup (removed in replace mode). */
function deleteMissingStatement(db: D1Database, table: BackupTableName, userId: string, jobId: string) {
  const def = BACKUP_TABLES[table];
  if (table === 'settings') {
    return stmt(db, `DELETE FROM settings WHERE user_id = ? AND key NOT IN (${IMPORTED('key')})`, userId, jobId, table);
  }
  if (!('id' in def.row.shape)) {
    // Join tables: drop all owned rows; the backup re-inserts the ones it has.
    return stmt(db, `DELETE FROM ${table} WHERE ${ownerWhere(table)}`, userId);
  }
  return stmt(db, `DELETE FROM ${table} WHERE ${ownerWhere(table)} AND id NOT IN (${IMPORTED()})`, userId, jobId, table);
}

/**
 * Applies a staged import in a single D1 batch (one transaction): either all
 * rows are applied or nothing changes. Tables are written in dependency order
 * with one INSERT…SELECT per table, so foreign keys (checked at the end of
 * each statement) reject dangling references; a topic cycle aborts the batch
 * through the import_guard CHECK.
 *  - merge: inserts new rows; existing rows are updated only when the backup
 *    copy is newer (updated_at). Nothing is deleted. Re-importing the same
 *    backup is a no-op, so it never duplicates data.
 *  - replace: the final state equals the backup (rows absent from it are
 *    deleted). Requires explicit confirmation.
 */
export async function commitImport(
  env: Env,
  userId: string,
  jobId: string,
  input: { chunkCount: number; confirm?: string | undefined },
): Promise<ImportResult> {
  const db = env.DB;
  const job = await stagingJob(db, userId, jobId);
  const mode = str(job.mode) as ImportMode;
  if (mode === 'replace' && input.confirm !== 'SUBSTITUIR') {
    throw badRequest('Confirme a substituição digitando SUBSTITUIR');
  }
  const staged = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM import_chunks WHERE job_id = ?', jobId);
  if (num(staged?.n) !== input.chunkCount) {
    throw badRequest('Envio incompleto: nem todas as partes do backup foram recebidas', {
      expected: input.chunkCount,
      received: num(staged?.n),
    });
  }

  // Files of documents that will be deleted (replace mode) are removed from R2 after commit.
  const doomedKeys =
    mode === 'replace'
      ? (
          await all<{ storage_key: string | null }>(
            db,
            `SELECT storage_key FROM documents WHERE user_id = ? AND storage_key IS NOT NULL AND id NOT IN (${IMPORTED()})`,
            userId,
            jobId,
            'documents',
          )
        ).map((r) => r.storage_key!)
      : [];

  const statements: D1PreparedStatement[] = [];
  if (mode === 'replace') {
    for (const table of [...BACKUP_TABLE_ORDER].reverse()) statements.push(deleteMissingStatement(db, table, userId, jobId));
  }
  for (const table of BACKUP_TABLE_ORDER) statements.push(upsertStatement(db, table, userId, jobId, mode));
  statements.push(
    stmt(
      db,
      `INSERT INTO import_guard (ok) SELECT 0 WHERE EXISTS (
         WITH RECURSIVE walk(start, cur, depth) AS (
           SELECT id, parent_id, 0 FROM topics WHERE user_id = ? AND parent_id IS NOT NULL
           UNION ALL
           SELECT w.start, t.parent_id, w.depth + 1 FROM walk w JOIN topics t ON t.id = w.cur
            WHERE w.cur <> w.start AND w.depth < 5000
         ) SELECT 1 FROM walk WHERE cur = start)`,
      userId,
    ),
    stmt(db, "UPDATE import_jobs SET status = 'committed', updated_at = ? WHERE id = ?", nowIso(), jobId),
  );

  try {
    await db.batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.prepare("UPDATE import_jobs SET status = 'failed', updated_at = ? WHERE id = ?").bind(nowIso(), jobId).run();
    if (/FOREIGN KEY|CHECK constraint|import_guard/i.test(message)) {
      throw badRequest(
        'O backup tem relacionamentos inconsistentes (referências ausentes ou ciclos na hierarquia). Nada foi alterado.',
      );
    }
    throw err;
  }

  if (doomedKeys.length > 0) {
    for (let i = 0; i < doomedKeys.length; i += 1000) await env.FILES.delete(doomedKeys.slice(i, i + 1000));
  }

  const [counts, awaiting] = await db.batch<Row>([
    stmt(db, 'SELECT table_name, SUM(row_count) AS n FROM import_chunks WHERE job_id = ? GROUP BY table_name', jobId),
    stmt(
      db,
      `SELECT id FROM documents WHERE user_id = ? AND status = 'pending' AND deleted_at IS NULL
          AND id IN (${IMPORTED()})`,
      userId,
      jobId,
      'documents',
    ),
  ]);
  await db.prepare('DELETE FROM import_chunks WHERE job_id = ?').bind(jobId).run();

  return {
    jobId,
    mode,
    counts: Object.fromEntries((counts?.results ?? []).map((r) => [str(r.table_name), num(r.n)])),
    documentsAwaitingFile: (awaiting?.results ?? []).map((r) => str(r.id)),
  };
}

export async function cancelImport(db: D1Database, userId: string, jobId: string): Promise<void> {
  const res = await db
    .prepare("DELETE FROM import_jobs WHERE id = ? AND user_id = ? AND status <> 'committed'")
    .bind(jobId, userId)
    .run();
  if (res.meta.changes === 0) throw notFound('Importação');
}
