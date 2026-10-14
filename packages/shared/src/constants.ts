/** Application-wide constants shared by the API and the web client. */
import kdfDefaults from './kdf-defaults.json';

export const APP_NAME = 'MyNotes';
export const API_PREFIX = '/api/v1';

/**
 * Client-side password KDF (Argon2id, memory in KiB). The server never sees
 * the password itself. Values live in kdf-defaults.json so the admin script
 * (plain Node) uses exactly the same parameters.
 */
export const DEFAULT_KDF = {
  alg: 'argon2id' as const,
  memoryKiB: kdfDefaults.memoryKiB,
  iterations: kdfDefaults.iterations,
  parallelism: kdfDefaults.parallelism,
  hashLength: 32 as const,
};

/** PBKDF2 iterations applied by the server over the client-derived key. */
export const SERVER_VERIFIER_ITERATIONS = kdfDefaults.serverIterations;

/** Bounds accepted for KDF parameters (prevents downgrade via tampered params). */
export const KDF_BOUNDS = {
  minMemoryKiB: 19456,
  maxMemoryKiB: 262144,
  minIterations: 1,
  maxIterations: 10,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_CHALLENGE_TTL_SECONDS = 60;

/**
 * Max serialized size of a note's rich-text document (bytes). D1 rows are
 * capped at 2 MB, and a note row also stores its plain and search text.
 */
export const NOTE_CONTENT_MAX_BYTES = 600_000;
export const NOTE_TITLE_MAX = 300;
export const TOPIC_TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const MIND_MAP_MAX_BYTES = 900_000;
export const NOTE_REVISIONS_KEEP = 50;
/** Minimum interval between automatic revision snapshots of the same note. */
export const NOTE_REVISION_INTERVAL_SECONDS = 10 * 60;

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

/**
 * Uploads. Workers accept request bodies up to 100 MB on Free/Pro accounts,
 * so larger files are sent in parts (R2 multipart upload): every request
 * stays below that limit and the file size is bounded only by R2.
 */
/** Files up to this size go in a single request; larger ones in parts of this size. */
export const UPLOAD_PART_BYTES = 50 * 1024 * 1024;
/** Largest body accepted by a single upload request (whole file or one part). */
export const UPLOAD_REQUEST_MAX_BYTES = 95 * 1024 * 1024;
/** R2 multipart allows 10,000 parts: about 488 GB with 50 MB parts. */
export const UPLOAD_MAX_PARTS = 10_000;
export const UPLOAD_MAX_BYTES = UPLOAD_PART_BYTES * UPLOAD_MAX_PARTS;

/**
 * File types accepted in the library. `preview` describes what the web app
 * can render in place; every other type is download-only.
 */
export const ALLOWED_FILE_TYPES = {
  'application/pdf': { ext: ['pdf'], preview: 'pdf', label: 'PDF' },
  'image/png': { ext: ['png'], preview: 'image', label: 'Imagem PNG' },
  'image/jpeg': { ext: ['jpg', 'jpeg'], preview: 'image', label: 'Imagem JPEG' },
  'image/webp': { ext: ['webp'], preview: 'image', label: 'Imagem WebP' },
  'application/epub+zip': { ext: ['epub'], preview: null, label: 'EPUB' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: ['docx'],
    preview: null,
    label: 'Documento Word',
  },
  'text/plain': { ext: ['txt'], preview: 'text', label: 'Texto' },
  'text/markdown': { ext: ['md', 'markdown'], preview: 'text', label: 'Markdown' },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_FILE_TYPES;
export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_FILE_TYPES) as AllowedMimeType[];

export function mimeFromFileName(name: string): AllowedMimeType | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const mime of ALLOWED_MIME_TYPES) {
    if ((ALLOWED_FILE_TYPES[mime].ext as readonly string[]).includes(ext)) return mime;
  }
  return null;
}

export const ENTITY_TYPES = [
  'topic',
  'note',
  'document',
  'reading',
  'concept',
  'plan',
  'mindmap',
  'session',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Entities that can be endpoints of a relation and appear in the knowledge graph. */
export const GRAPH_ENTITY_TYPES = ['topic', 'note', 'document', 'reading', 'concept'] as const;
export type GraphEntityType = (typeof GRAPH_ENTITY_TYPES)[number];

export const FAVORITE_ENTITY_TYPES = ['topic', 'note', 'document', 'reading', 'plan', 'mindmap'] as const;
export type FavoriteEntityType = (typeof FAVORITE_ENTITY_TYPES)[number];

export const SEARCH_ENTITY_TYPES = ['topic', 'note', 'document', 'reading', 'concept', 'plan', 'mindmap'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export const RELATION_KINDS = [
  'related',
  'references',
  'depends_on',
  'part_of',
  'supports',
  'contrasts',
  'example_of',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_KIND_LABELS: Record<RelationKind, string> = {
  related: 'Relacionado a',
  references: 'Referencia',
  depends_on: 'Depende de',
  part_of: 'Parte de',
  supports: 'Apoia',
  contrasts: 'Contrasta com',
  example_of: 'Exemplo de',
};

export const ENTITY_LABELS: Record<EntityType, string> = {
  topic: 'Assunto',
  note: 'Nota',
  document: 'Documento',
  reading: 'Leitura',
  concept: 'Conceito',
  plan: 'Plano',
  mindmap: 'Mapa mental',
  session: 'Sessão de estudo',
};

export const READING_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];
export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em andamento',
  completed: 'Concluída',
};

export const MATERIAL_TYPES = ['book', 'article', 'paper', 'chapter', 'video', 'course', 'other'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  book: 'Livro',
  article: 'Artigo',
  paper: 'Artigo científico',
  chapter: 'Capítulo',
  video: 'Vídeo / aula',
  course: 'Curso',
  other: 'Outro',
};

export const PLAN_STATUSES = ['active', 'completed', 'archived'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PRIORITIES = [0, 1, 2, 3] as const;
export const PRIORITY_LABELS: Record<number, string> = {
  0: 'Sem prioridade',
  1: 'Baixa',
  2: 'Média',
  3: 'Alta',
};

/**
 * What a note is: an ordinary note, the general review of a book ("Minha
 * resenha") or an annotation of one of its pages. All are notes, so they share
 * the editor, history, references, backlinks and search.
 */
export const NOTE_ROLES = ['note', 'review', 'annotation'] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];
export const NOTE_ROLE_LABELS: Record<NoteRole, string> = {
  note: 'Nota',
  review: 'Resenha',
  annotation: 'Anotação de leitura',
};

/** Optional classification of a page annotation. */
export const ANNOTATION_TYPES = ['summary', 'interpretation', 'critique', 'question', 'quote'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export const ANNOTATION_TYPE_LABELS: Record<AnnotationType, string> = {
  summary: 'Resumo',
  interpretation: 'Interpretação',
  critique: 'Crítica',
  question: 'Dúvida',
  quote: 'Citação',
};

export const TAG_MAX_LENGTH = 50;
export const NOTE_TAGS_MAX = 100;
/** Bump when the derived indexes of notes (tags) change, to reindex old rows. */
export const NOTE_INDEX_VERSION = 1;

/** Internal link scheme used inside note content: `mynotes:note/<id>`. */
export const INTERNAL_LINK_PREFIX = 'mynotes:';
export const INTERNAL_LINK_TYPES = ['note', 'topic', 'document', 'reading', 'concept'] as const;
export type InternalLinkType = (typeof INTERNAL_LINK_TYPES)[number];

export const BACKUP_FORMAT = 'mynotes-backup';
export const BACKUP_FORMAT_VERSION = 1;
