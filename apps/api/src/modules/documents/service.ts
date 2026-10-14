import {
  ALLOWED_FILE_TYPES,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PARTS,
  UPLOAD_PART_BYTES,
  UPLOAD_REQUEST_MAX_BYTES,
  mimeFromFileName,
  normalizeAligned,
  searchTerms,
  uuidv7,
  type AllowedMimeType,
  type DocumentMeta,
  type UploadStart,
  type UploadedPart,
} from '@mynotes/shared';
import { authSecret } from '../../env';
import { ApiError, badRequest, notFound, tooLarge } from '../../lib/errors';
import { hmacBase64Url, hmacVerify, randomToken, toBase64Url } from '../../lib/crypto';
import { all, first, num, str, strOrNull, stmt, versionedUpdate, type Bindable, type Row } from '../../lib/db';
import { activityStmt, assertReference } from '../../lib/helpers';
import { keyset, pageOf, type SortSpec } from '../../lib/pagination';
import { nowIso } from '../../lib/time';

export const SIGNED_LINK_TTL_SECONDS = 5 * 60;

export function toDocument(r: Row): DocumentMeta {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    title: str(r.title),
    description: str(r.description),
    originalName: str(r.original_name),
    mimeType: str(r.mime_type),
    sizeBytes: num(r.size_bytes),
    status: str(r.status) as DocumentMeta['status'],
    uploadedAt: strOrNull(r.uploaded_at),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const docSearchText = (title: string, originalName: string, description: string) =>
  normalizeAligned(`${title} ${originalName} ${description}`.normalize('NFC'));

export async function getDocumentRow(db: D1Database, userId: string, id: string): Promise<Row | null> {
  return first(db, 'SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, userId);
}

const SORT: SortSpec = { expr: 'created_at', field: 'created_at', dir: 'DESC' };

export async function listDocuments(
  db: D1Database,
  userId: string,
  q: {
    topicId?: string | undefined;
    type?: 'pdf' | 'image' | 'other' | undefined;
    q?: string | undefined;
    status?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  let where = 'user_id = ? AND deleted_at IS NULL';
  const binds: Bindable[] = [userId];
  if (q.topicId === 'none') where += ' AND topic_id IS NULL';
  else if (q.topicId) {
    where += ' AND topic_id = ?';
    binds.push(q.topicId);
  }
  if (q.type === 'pdf') where += " AND mime_type = 'application/pdf'";
  else if (q.type === 'image') where += " AND mime_type LIKE 'image/%'";
  else if (q.type === 'other') where += " AND mime_type <> 'application/pdf' AND mime_type NOT LIKE 'image/%'";
  if (q.status) {
    where += ' AND status = ?';
    binds.push(q.status);
  }
  for (const term of searchTerms(q.q ?? '')) {
    where += ' AND instr(search_text, ?) > 0';
    binds.push(term);
  }
  const page = keyset(SORT, q.cursor);
  const rows = await all(
    db,
    `SELECT * FROM documents WHERE ${where}${page.where} ${page.orderBy} LIMIT ?`,
    ...binds,
    ...page.binds,
    q.limit + 1,
  );
  const { items, nextCursor } = pageOf(rows, q.limit, SORT);
  return { items: items.map(toDocument), nextCursor };
}

export interface CreateDocumentInput {
  id?: string | undefined;
  topicId: string | null;
  title?: string | undefined;
  description: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

function assertAllowedType(originalName: string, mimeType: string): AllowedMimeType {
  const byName = mimeFromFileName(originalName);
  if (!byName || !(mimeType in ALLOWED_FILE_TYPES)) {
    throw new ApiError('unsupported_media_type', 'Tipo de arquivo não suportado');
  }
  // Browsers report markdown inconsistently; trust the extension for text files.
  if (byName !== mimeType && !(byName.startsWith('text/') && mimeType.startsWith('text/'))) {
    throw new ApiError('unsupported_media_type', 'A extensão do arquivo não corresponde ao tipo informado');
  }
  return byName;
}

/** Registers the metadata; the binary is sent next with PUT /documents/{id}/content. */
export async function createDocument(
  db: D1Database,
  userId: string,
  input: CreateDocumentInput,
): Promise<{ document: DocumentMeta; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM documents WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { document: toDocument(existing), created: false };
  }
  const mime = assertAllowedType(input.originalName, input.mimeType);
  // Files larger than one request are uploaded in parts; only R2's own capacity bounds the size.
  if (input.sizeBytes > UPLOAD_MAX_BYTES) throw tooLarge('Arquivo maior do que o armazenamento suporta');
  await assertReference(db, 'topics', input.topicId, userId);
  const originalName = input.originalName.normalize('NFC');
  const title = (input.title?.trim() || originalName.replace(/\.[^.]+$/, '')).normalize('NFC').slice(0, 300);
  const now = nowIso();
  const row = await first(
    db,
    `INSERT INTO documents (id, user_id, topic_id, title, description, original_name, mime_type, size_bytes,
                            status, search_text, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?) RETURNING *`,
    id,
    userId,
    input.topicId,
    title,
    input.description,
    originalName,
    mime,
    input.sizeBytes,
    docSearchText(title, originalName, input.description),
    now,
    now,
  );
  return { document: toDocument(row!), created: true };
}

/** Checks the file signature so a renamed executable/HTML cannot pass as a PDF or image. */
function signatureMatches(mime: string, head: Uint8Array): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (s: string, offset = 0) => [...s].every((ch, i) => head[offset + i] === ch.charCodeAt(0));
  switch (mime) {
    case 'application/pdf':
      return ascii('%PDF-');
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/webp':
      return ascii('RIFF') && ascii('WEBP', 8);
    case 'application/epub+zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(0x50, 0x4b, 0x03, 0x04);
    case 'text/plain':
    case 'text/markdown':
      return !head.includes(0);
    default:
      return false;
  }
}

/** Content-Length of an upload request (whole file or one part), within what a Worker accepts. */
function bodyLength(request: Request): number {
  const length = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (!Number.isFinite(length) || length <= 0) throw badRequest('Content-Length obrigatório');
  if (length > UPLOAD_REQUEST_MAX_BYTES) throw tooLarge('Envie arquivos grandes em partes');
  if (!request.body) throw badRequest('Corpo da requisição vazio');
  return length;
}

/**
 * Streams the request body to R2 under a new random key, validates the file
 * signature, then atomically switches the document to the new object.
 * Files larger than one request use the multipart functions below.
 */
export async function uploadContent(env: Env, userId: string, id: string, request: Request): Promise<DocumentMeta> {
  const db = env.DB;
  const doc = await getDocumentRow(db, userId, id);
  if (!doc) throw notFound('Documento');
  const length = bodyLength(request);
  const mime = str(doc.mime_type);

  const key = `files/${userId}/${randomToken(24)}`;
  const { readable, writable } = new FixedLengthStream(length);
  const pipe = request.body!.pipeTo(writable); // checked by bodyLength()
  try {
    await Promise.all([
      env.FILES.put(key, readable, {
        httpMetadata: { contentType: mime },
        customMetadata: { documentId: id },
      }),
      pipe,
    ]);
  } catch {
    if (doc.status === 'pending') {
      await db.prepare("UPDATE documents SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(id).run();
    }
    throw badRequest('Falha ao receber o arquivo. Tente novamente.');
  }
  return finalizeUpload(env, userId, doc, key, length);
}

/**
 * The object is fully stored under `key`: checks its signature, then points
 * the document to it (removing the previous file, if any).
 */
async function finalizeUpload(env: Env, userId: string, doc: Row, key: string, length: number): Promise<DocumentMeta> {
  const db = env.DB;
  const id = str(doc.id);
  const mime = str(doc.mime_type);
  const head = await env.FILES.get(key, { range: { offset: 0, length: 16 } });
  const bytes = new Uint8Array(head ? await head.arrayBuffer() : new ArrayBuffer(0));
  if (!signatureMatches(mime, bytes)) {
    await env.FILES.delete(key);
    throw new ApiError('unsupported_media_type', 'O conteúdo do arquivo não corresponde ao tipo informado');
  }

  const now = nowIso();
  const oldKey = strOrNull(doc.storage_key);
  const [updated] = await db.batch([
    stmt(
      db,
      `UPDATE documents SET storage_key = ?, status = 'ready', size_bytes = ?, uploaded_at = ?, updated_at = ?,
              version = version + 1
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`,
      key,
      length,
      now,
      now,
      id,
      userId,
    ),
    activityStmt(db, userId, 'document', id, 'uploaded', str(doc.title)),
  ]);
  const row = (updated?.results as Row[] | undefined)?.[0];
  if (!row) {
    await env.FILES.delete(key);
    throw notFound('Documento');
  }
  if (oldKey && oldKey !== key) await env.FILES.delete(oldKey);
  return toDocument(row);
}

/* ---------------------------------------------------- upload in parts -- */

/**
 * The client keeps no server state between parts: a token signed with
 * AUTH_SECRET binds the account, document, R2 key and upload id, so a part
 * can never target another key or another user's file.
 */
interface UploadTicket {
  d: string; // document
  u: string; // user
  k: string; // R2 key
  m: string; // R2 multipart upload id
  e: number; // expiry (ms)
}

const TICKET_TTL_MS = 24 * 3600 * 1000;

async function signTicket(env: Env, ticket: UploadTicket): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(ticket)));
  return `${body}.${await hmacBase64Url(authSecret(env), `upload:${body}`)}`;
}

async function readTicket(env: Env, token: string, userId: string, documentId: string): Promise<UploadTicket> {
  const invalid = () => badRequest('Envio inválido ou expirado. Envie o arquivo de novo.');
  const [body, sig] = token.split('.');
  if (!body || !sig || !(await hmacVerify(authSecret(env), `upload:${body}`, sig))) throw invalid();
  let ticket: UploadTicket;
  try {
    ticket = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  } catch {
    throw invalid();
  }
  if (ticket.d !== documentId || ticket.u !== userId || ticket.e < Date.now()) throw invalid();
  return ticket;
}

/** Starts an upload in parts for a document (new random key, like single uploads). */
export async function startMultipartUpload(env: Env, userId: string, id: string): Promise<UploadStart> {
  const doc = await getDocumentRow(env.DB, userId, id);
  if (!doc) throw notFound('Documento');
  const key = `files/${userId}/${randomToken(24)}`;
  const upload = await env.FILES.createMultipartUpload(key, {
    httpMetadata: { contentType: str(doc.mime_type) },
    customMetadata: { documentId: id },
  });
  const token = await signTicket(env, { d: id, u: userId, k: key, m: upload.uploadId, e: Date.now() + TICKET_TTL_MS });
  return { token, partSize: UPLOAD_PART_BYTES };
}

/** Streams one part (all parts but the last must have the same size, as R2 requires). */
export async function uploadPart(
  env: Env,
  userId: string,
  id: string,
  partNumber: number,
  token: string,
  request: Request,
): Promise<UploadedPart> {
  const ticket = await readTicket(env, token, userId, id);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > UPLOAD_MAX_PARTS) throw badRequest('Parte inválida');
  const length = bodyLength(request);
  const upload = env.FILES.resumeMultipartUpload(ticket.k, ticket.m);
  const { readable, writable } = new FixedLengthStream(length);
  try {
    const [part] = await Promise.all([upload.uploadPart(partNumber, readable), request.body!.pipeTo(writable)]); // body checked by bodyLength()
    return { partNumber: part.partNumber, etag: part.etag };
  } catch {
    throw badRequest('Falha ao receber uma parte do arquivo. Tente novamente.');
  }
}

/** Joins the parts, then validates and attaches the file like a single upload. */
export async function completeMultipartUpload(
  env: Env,
  userId: string,
  id: string,
  token: string,
  parts: UploadedPart[],
): Promise<DocumentMeta> {
  const ticket = await readTicket(env, token, userId, id);
  const upload = env.FILES.resumeMultipartUpload(ticket.k, ticket.m);
  const doc = await getDocumentRow(env.DB, userId, id);
  if (!doc) {
    await upload.abort().catch(() => undefined);
    throw notFound('Documento');
  }
  let object: R2Object;
  try {
    object = await upload.complete([...parts].sort((a, b) => a.partNumber - b.partNumber));
  } catch {
    throw badRequest('Não foi possível juntar as partes do arquivo. Envie de novo.');
  }
  return finalizeUpload(env, userId, doc, ticket.k, object.size);
}

/** Discards an unfinished upload in parts (R2 also expires abandoned ones). */
export async function abortMultipartUpload(env: Env, userId: string, id: string, token: string): Promise<void> {
  const ticket = await readTicket(env, token, userId, id);
  await env.FILES.resumeMultipartUpload(ticket.k, ticket.m)
    .abort()
    .catch(() => undefined);
}

function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Serves a document's binary with Range support (used by the in-app PDF viewer). */
export async function serveContent(
  env: Env,
  doc: Row,
  request: Request,
  disposition: 'inline' | 'attachment',
): Promise<Response> {
  const key = strOrNull(doc.storage_key);
  if (!key || doc.status !== 'ready') throw notFound('Arquivo');
  const object = await env.FILES.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) throw notFound('Arquivo');

  const mime = str(doc.mime_type);
  const meta = ALLOWED_FILE_TYPES[mime as AllowedMimeType];
  const headers = new Headers();
  headers.set('Content-Type', meta?.preview === 'text' ? 'text/plain; charset=utf-8' : mime);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, no-store');
  // Only previewable types are ever served inline.
  headers.set('Content-Disposition', contentDisposition(meta?.preview ? disposition : 'attachment', str(doc.original_name)));
  if (meta?.preview === 'text') headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  if (!('body' in object)) {
    // Precondition (If-None-Match etc.) matched: nothing to send.
    return new Response(null, { status: 304, headers });
  }
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has('Range')) {
    const size = object.size;
    const offset = range.suffix !== undefined ? size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? size - offset);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function createSignedLink(
  env: Env,
  userId: string,
  id: string,
  baseUrl: string,
  download: boolean,
): Promise<{ url: string; expiresAt: string }> {
  const doc = await getDocumentRow(env.DB, userId, id);
  if (!doc || doc.status !== 'ready') throw notFound('Documento');
  const exp = Math.floor(Date.now() / 1000) + SIGNED_LINK_TTL_SECONDS;
  const dl = download ? '1' : '0';
  const sig = await hmacBase64Url(authSecret(env), `file:${id}:${exp}:${dl}`);
  const url = new URL(`${baseUrl}/files/${id}`);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('dl', dl);
  url.searchParams.set('sig', sig);
  return { url: url.toString(), expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifySignedLink(
  env: Env,
  id: string,
  params: { exp?: string | undefined; dl?: string | undefined; sig?: string | undefined },
): Promise<Row> {
  const exp = Number.parseInt(params.exp ?? '', 10);
  const dl = params.dl === '1' ? '1' : '0';
  const invalid = () => new ApiError('forbidden', 'Link expirado ou inválido');
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !params.sig) throw invalid();
  if (!(await hmacVerify(authSecret(env), `file:${id}:${exp}:${dl}`, params.sig))) throw invalid();
  const doc = await first(env.DB, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) throw invalid();
  return doc;
}

export async function updateDocument(
  db: D1Database,
  userId: string,
  id: string,
  input: { baseVersion: number; title?: string | undefined; description?: string | undefined; topicId?: string | null | undefined },
): Promise<DocumentMeta> {
  const current = await getDocumentRow(db, userId, id);
  if (!current) throw notFound('Documento');
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  const title = (input.title ?? str(current.title)).normalize('NFC');
  const description = input.description ?? str(current.description);
  const set: Record<string, Bindable> = {
    title,
    description,
    search_text: docSearchText(title, str(current.original_name), description),
  };
  if (input.topicId !== undefined) set.topic_id = input.topicId;
  const row = await versionedUpdate(
    db,
    { table: 'documents', id, userId, baseVersion: input.baseVersion, set, trashable: true },
    async () => {
      const r = await getDocumentRow(db, userId, id);
      return r ? toDocument(r) : null;
    },
    'Documento',
  );
  return toDocument(row);
}

export async function trashDocument(db: D1Database, userId: string, id: string): Promise<void> {
  const current = await getDocumentRow(db, userId, id);
  if (!current) throw notFound('Documento');
  await db.batch([
    stmt(db, 'UPDATE documents SET deleted_at = ?, delete_batch = NULL WHERE id = ? AND user_id = ?', nowIso(), id, userId),
    activityStmt(db, userId, 'document', id, 'deleted', str(current.title)),
  ]);
}
