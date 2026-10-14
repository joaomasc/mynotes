import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzip, type Unzipped } from 'fflate';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  BACKUP_TABLE_ORDER,
  IMPORT_CHUNK_MAX_BYTES,
  zBackupManifest,
  type BackupManifest,
  type BackupTableName,
  type ImportMode,
  type ImportResult,
} from '@mynotes/shared';
import { api } from './api/client';
import { endpoints } from './api/endpoints';
import { APP_VERSION } from './config';
import { uploadContent } from './uploads';

export type Progress = (message: string, fraction?: number) => void;

/* ----------------------------------------------------------------- export */

/**
 * Builds the backup ZIP in the browser:
 *   manifest.json, data/<table>.json, files/<documentId>
 * Everything is fetched through the authenticated API.
 */
export async function exportBackup(includeFiles: boolean, progress: Progress): Promise<Blob> {
  progress('Lendo manifesto…', 0);
  const server = await endpoints.backup.manifest();
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) failure = err;
    else chunks.push(data);
  });
  const addJson = (name: string, value: unknown) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(strToU8(JSON.stringify(value)), true);
  };

  const counts: Record<string, number> = {};
  for (const [i, table] of BACKUP_TABLE_ORDER.entries()) {
    progress(`Exportando ${table}…`, (i / BACKUP_TABLE_ORDER.length) * (includeFiles ? 0.4 : 0.9));
    const rows: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    do {
      const page = await endpoints.backup.exportPage(table, cursor);
      rows.push(...page.rows);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    counts[table] = rows.length;
    addJson(`data/${table}.json`, rows);
  }

  const files: string[] = [];
  if (includeFiles) {
    for (const [i, id] of server.files.entries()) {
      progress(`Copiando arquivos (${i + 1}/${server.files.length})…`, 0.4 + (i / Math.max(1, server.files.length)) * 0.55);
      const blob = await api.blob(endpoints.documents.contentPath(id));
      const entry = new ZipPassThrough(`files/${id}`);
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
      files.push(id);
    }
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    counts,
    files,
  };
  addJson('manifest.json', manifest);
  zip.end();
  if (failure) throw failure;
  progress('Backup pronto', 1);
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/* ----------------------------------------------------------------- import */

export interface ParsedBackup {
  manifest: BackupManifest;
  tables: Record<BackupTableName, Record<string, unknown>[]>;
  files: Map<string, Uint8Array>;
  problems: string[];
}

const unzipAsync = (data: Uint8Array) =>
  new Promise<Unzipped>((resolve, reject) => unzip(data, (err, out) => (err ? reject(err) : resolve(out))));

/** Reads and validates a backup ZIP without touching the server. */
export async function readBackup(file: File): Promise<ParsedBackup> {
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  const rawManifest = entries['manifest.json'];
  if (!rawManifest) throw new Error('Arquivo sem manifest.json: não é um backup do MyNotes.');
  const manifestResult = zBackupManifest.safeParse(JSON.parse(strFromU8(rawManifest)));
  if (!manifestResult.success) {
    throw new Error('Manifesto inválido ou de uma versão de backup não suportada.');
  }
  const problems: string[] = [];
  const tables = {} as ParsedBackup['tables'];
  for (const table of BACKUP_TABLE_ORDER) {
    const raw = entries[`data/${table}.json`];
    if (!raw) {
      tables[table] = [];
      continue;
    }
    const rows = JSON.parse(strFromU8(raw)) as unknown;
    if (!Array.isArray(rows)) {
      problems.push(`${table}: formato inválido`);
      tables[table] = [];
      continue;
    }
    const valid: Record<string, unknown>[] = [];
    rows.forEach((row, i) => {
      const r = BACKUP_TABLES[table].row.safeParse(row);
      if (r.success) valid.push(r.data as Record<string, unknown>);
      else if (problems.length < 20) problems.push(`${table} #${i + 1}: ${r.error.issues[0]?.message ?? 'inválido'}`);
    });
    tables[table] = valid;
  }

  // Relationship checks inside the backup itself (the server re-checks everything).
  const topicIds = new Set(tables.topics.map((t) => t.id as string));
  const parent = new Map(tables.topics.map((t) => [t.id as string, t.parent_id as string | null]));
  for (const t of tables.topics) {
    const seen = new Set<string>();
    let cur: string | null = t.id as string;
    while (cur) {
      if (seen.has(cur)) {
        problems.push(`Ciclo na hierarquia de assuntos envolvendo “${t.title as string}”`);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
    if (t.parent_id && !topicIds.has(t.parent_id as string)) {
      problems.push(`Assunto “${t.title as string}” aponta para um assunto pai ausente`);
    }
  }

  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith('files/')) files.set(name.slice(6), data);
  }
  return { manifest: manifestResult.data, tables, files, problems };
}

function chunkRows(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let size = 0;
  for (const row of rows) {
    const s = JSON.stringify(row).length;
    if (current.length > 0 && (size + s > IMPORT_CHUNK_MAX_BYTES / 3 || current.length >= 1000)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += s;
  }
  if (current.length) out.push(current);
  return out;
}

export interface ImportOutcome {
  result: ImportResult;
  filesUploaded: number;
  filesMissing: number;
  fileErrors: string[];
}

/** Stages all rows, commits atomically, then uploads the binaries. */
export async function importBackup(
  backup: ParsedBackup,
  mode: ImportMode,
  confirm: string | undefined,
  progress: Progress,
): Promise<ImportOutcome> {
  const { jobId } = await endpoints.backup.createImport(mode, backup.manifest);
  try {
    const plan = BACKUP_TABLE_ORDER.flatMap((table) => chunkRows(backup.tables[table]).map((rows) => ({ table, rows })));
    for (const [seq, chunk] of plan.entries()) {
      progress(`Enviando dados (${seq + 1}/${plan.length})…`, (seq / Math.max(1, plan.length)) * 0.5);
      await endpoints.backup.chunk(jobId, seq, chunk.table, chunk.rows);
    }
    progress('Aplicando no servidor…', 0.55);
    const result = await endpoints.backup.commit(jobId, plan.length, confirm);

    const mimeOf = new Map(backup.tables.documents.map((d) => [d.id as string, d.mime_type as string]));
    let uploaded = 0;
    let missing = 0;
    const fileErrors: string[] = [];
    for (const [i, id] of result.documentsAwaitingFile.entries()) {
      const data = backup.files.get(id);
      if (!data) {
        missing++;
        continue;
      }
      progress(`Enviando arquivos (${i + 1}/${result.documentsAwaitingFile.length})…`, 0.6 + (i / result.documentsAwaitingFile.length) * 0.4);
      try {
        await uploadContent(id, new Blob([data as BlobPart]), mimeOf.get(id) ?? 'application/octet-stream', () => undefined);
        uploaded++;
      } catch (err) {
        fileErrors.push(`${id}: ${err instanceof Error ? err.message : 'falha'}`);
      }
    }
    progress('Importação concluída', 1);
    return { result, filesUploaded: uploaded, filesMissing: missing, fileErrors };
  } catch (err) {
    await endpoints.backup.cancel(jobId).catch(() => undefined);
    throw err;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
