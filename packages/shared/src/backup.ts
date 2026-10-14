import { z } from 'zod';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './constants';
import { zDate, zDateTime, zId } from './schemas/common';

/**
 * Backup format (version 1)
 * -------------------------
 * A ZIP archive with:
 *   manifest.json           — BackupManifest (format, version, counts, files)
 *   data/<table>.json       — array of rows for each table below
 *   files/<documentId>      — binary content of each document (when included)
 *
 * Rows mirror the database columns (snake_case) without `user_id`. JSON
 * columns (note content, mind map data, setting values) are JSON-encoded
 * strings. Authentication data (users, sessions, tokens) is never exported.
 */

const str = (max: number) => z.string().max(max);
const nullableStr = (max: number) => z.string().max(max).nullable();
const int = z.number().int();
const ts = zDateTime;

const versioned = {
  version: int.min(1),
  created_at: ts,
  updated_at: ts,
};
const trashable = {
  deleted_at: ts.nullable(),
  delete_batch: nullableStr(64),
};

export const BACKUP_TABLES = {
  topics: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      parent_id: zId.nullable(),
      title: str(300),
      description: str(20_000),
      color: nullableStr(16),
      sort_key: str(200),
      search_text: str(50_000),
      ...versioned,
      ...trashable,
    }),
  },
  notes: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      title: str(1000),
      content: str(1_000_000),
      excerpt: str(2000),
      word_count: int,
      body_text: str(1_000_000),
      search_text: str(1_000_000),
      sort_key: str(200),
      ...versioned,
      ...trashable,
    }),
  },
  note_revisions: {
    hasUserId: false,
    parent: { column: 'note_id', table: 'notes' },
    mergeByUpdatedAt: false,
    row: z.object({
      id: zId,
      note_id: zId,
      version: int,
      title: str(1000),
      content: str(1_000_000),
      word_count: int,
      created_at: ts,
    }),
  },
  note_links: {
    hasUserId: false,
    parent: { column: 'note_id', table: 'notes' },
    mergeByUpdatedAt: false,
    row: z.object({
      note_id: zId,
      target_type: z.enum(['note', 'topic', 'document', 'reading', 'concept']),
      target_id: zId,
    }),
  },
  documents: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      title: str(1000),
      description: str(20_000),
      original_name: str(500),
      mime_type: str(200),
      size_bytes: int.min(0),
      status: z.enum(['pending', 'ready', 'failed']),
      search_text: str(50_000),
      uploaded_at: ts.nullable(),
      ...versioned,
      ...trashable,
    }),
  },
  concepts: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      name: str(500),
      description: str(20_000),
      search_text: str(50_000),
      ...versioned,
    }),
  },
  readings: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      document_id: zId.nullable(),
      title: str(1000),
      author: str(1000),
      material_type: z.enum(['book', 'article', 'paper', 'chapter', 'video', 'course', 'other']),
      status: z.enum(['not_started', 'in_progress', 'completed']),
      total_pages: int.nullable(),
      current_page: int.nullable(),
      progress_percent: z.number().nullable(),
      started_on: zDate.nullable(),
      completed_on: zDate.nullable(),
      due_on: zDate.nullable(),
      priority: int.min(0).max(3),
      notes: str(20_000),
      search_text: str(50_000),
      ...versioned,
    }),
  },
  reading_plans: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      title: str(1000),
      description: str(20_000),
      goal: str(5000),
      status: z.enum(['active', 'completed', 'archived']),
      start_on: zDate.nullable(),
      target_on: zDate.nullable(),
      search_text: str(50_000),
      ...versioned,
    }),
  },
  reading_plan_items: {
    hasUserId: false,
    parent: { column: 'plan_id', table: 'reading_plans' },
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      plan_id: zId,
      title: str(1000),
      notes: str(20_000),
      reading_id: zId.nullable(),
      due_on: zDate.nullable(),
      completed_at: ts.nullable(),
      sort_key: str(200),
      ...versioned,
    }),
  },
  study_sessions: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      started_at: ts,
      duration_seconds: int.min(1),
      objective: str(5000),
      notes: str(20_000),
      progress_rating: int.min(1).max(5).nullable(),
      source: z.enum(['manual', 'timer']),
      ...versioned,
    }),
  },
  study_session_notes: {
    hasUserId: false,
    parent: { column: 'session_id', table: 'study_sessions' },
    mergeByUpdatedAt: false,
    row: z.object({ session_id: zId, note_id: zId }),
  },
  study_session_documents: {
    hasUserId: false,
    parent: { column: 'session_id', table: 'study_sessions' },
    mergeByUpdatedAt: false,
    row: z.object({ session_id: zId, document_id: zId }),
  },
  relations: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      source_type: z.enum(['topic', 'note', 'document', 'reading', 'concept']),
      source_id: zId,
      target_type: z.enum(['topic', 'note', 'document', 'reading', 'concept']),
      target_id: zId,
      kind: z.enum(['related', 'references', 'depends_on', 'part_of', 'supports', 'contrasts', 'example_of']),
      label: str(500),
      ...versioned,
    }),
  },
  mind_maps: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    row: z.object({
      id: zId,
      topic_id: zId.nullable(),
      title: str(500),
      data: str(1_000_000),
      node_count: int.min(0),
      search_text: str(200_000),
      ...versioned,
    }),
  },
  favorites: {
    hasUserId: true,
    mergeByUpdatedAt: false,
    row: z.object({
      id: zId,
      entity_type: z.enum(['topic', 'note', 'document', 'reading', 'plan', 'mindmap']),
      entity_id: zId,
      created_at: ts,
    }),
  },
  activity_events: {
    hasUserId: true,
    mergeByUpdatedAt: false,
    row: z.object({
      id: zId,
      entity_type: str(32),
      entity_id: zId,
      action: str(32),
      title: str(1000),
      occurred_at: ts,
    }),
  },
  settings: {
    hasUserId: true,
    mergeByUpdatedAt: true,
    primaryKey: 'key',
    row: z.object({
      key: z.enum(['ui', 'study_timer', 'study_goals']),
      value: str(100_000),
      version: int.min(1),
      updated_at: ts,
    }),
  },
} as const satisfies Record<
  string,
  {
    hasUserId: boolean;
    mergeByUpdatedAt: boolean;
    parent?: { column: string; table: string };
    primaryKey?: string;
    row: z.ZodObject;
  }
>;

export type BackupTableName = keyof typeof BACKUP_TABLES;
/** Dependency order: parents before children. */
export const BACKUP_TABLE_ORDER = Object.keys(BACKUP_TABLES) as BackupTableName[];

export function backupColumns(table: BackupTableName): string[] {
  return Object.keys(BACKUP_TABLES[table].row.shape);
}

export type BackupRow<T extends BackupTableName> = z.infer<(typeof BACKUP_TABLES)[T]['row']>;

export const zBackupManifest = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string().max(50),
  createdAt: zDateTime,
  counts: z.record(z.string(), z.number().int().min(0)),
  /** Document ids whose binary is included under files/. */
  files: z.array(zId),
});
export type BackupManifest = z.infer<typeof zBackupManifest>;

export const IMPORT_MODES = ['merge', 'replace'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const zImportJobCreate = z.object({
  mode: z.enum(IMPORT_MODES),
  manifest: zBackupManifest,
});

export const zImportChunk = z.object({
  seq: z.number().int().min(0).max(100_000),
  table: z.enum(BACKUP_TABLE_ORDER as [BackupTableName, ...BackupTableName[]]),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});

export const zImportCommit = z.object({
  /** Must equal the number of chunks uploaded; protects against partial uploads. */
  chunkCount: z.number().int().min(0),
  /** Required for mode=replace: the user typed confirmation. */
  confirm: z.literal('SUBSTITUIR').optional(),
});

export const zImportResult = z.object({
  jobId: zId,
  mode: z.enum(IMPORT_MODES),
  counts: z.record(z.string(), z.number().int()),
  /** Documents whose binary must be uploaded next. */
  documentsAwaitingFile: z.array(zId),
});
export type ImportResult = z.infer<typeof zImportResult>;

export const zExportPage = z.object({
  table: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable(),
});

/** Max serialized size of one import chunk (bytes); D1 caps values at 2 MB. */
export const IMPORT_CHUNK_MAX_BYTES = 1_500_000;
