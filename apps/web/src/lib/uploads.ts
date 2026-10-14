import {
  ALLOWED_FILE_TYPES,
  UPLOAD_MAX_BYTES,
  UPLOAD_PART_BYTES,
  mimeFromFileName,
  uuidv7,
  type AllowedMimeType,
  type ApiErrorBody,
  type DocumentMeta,
  type UploadedPart,
} from '@mynotes/shared';
import { ApiError, NetworkError, buildUrl } from './api/client';
import { endpoints } from './api/endpoints';
import { getAccessToken } from './auth/session';
import { fileSize } from './format';

export function validateFile(file: File): { mime: AllowedMimeType } | { error: string } {
  const mime = mimeFromFileName(file.name);
  if (!mime) {
    const accepted = Object.values(ALLOWED_FILE_TYPES)
      .flatMap((t) => t.ext)
      .join(', ');
    return { error: `Formato não suportado. Aceitos: ${accepted}.` };
  }
  if (file.size === 0) return { error: 'O arquivo está vazio.' };
  // No practical limit: large files are sent in parts. This is R2's own capacity.
  if (file.size > UPLOAD_MAX_BYTES) return { error: `Maior do que o armazenamento suporta (${fileSize(UPLOAD_MAX_BYTES)}).` };
  return { mime };
}

function putWithProgress(
  url: string,
  file: Blob,
  mime: string,
  token: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new NetworkError('Falha de conexão durante o envio'));
    xhr.onabort = () => reject(new DOMException('Envio cancelado', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** Authenticated PUT of binary data with progress (renews the session once on 401). */
async function putAuthorized<T>(path: string, body: Blob, mime: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(path);
  let token = await getAccessToken();
  if (!token) throw new ApiError(401, 'unauthorized', 'Sessão expirada');
  let res = await putWithProgress(url, body, mime, token, onProgress, signal);
  if (res.status === 401) {
    token = await getAccessToken(true);
    if (!token) throw new ApiError(401, 'unauthorized', 'Sessão expirada');
    res = await putWithProgress(url, body, mime, token, onProgress, signal);
  }
  if (res.status >= 200 && res.status < 300) return (JSON.parse(res.body) as { data: T }).data;
  let err: ApiErrorBody | null = null;
  try {
    err = JSON.parse(res.body) as ApiErrorBody;
  } catch {
    // not JSON
  }
  throw new ApiError(res.status, err?.error.code ?? 'internal_error', err?.error.message ?? 'Falha no envio');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends a large file in parts. Each request stays below the Worker body
 * limit; a failed part is retried, and if the upload cannot finish it is
 * aborted on the server.
 */
async function uploadInParts(
  documentId: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DocumentMeta> {
  const { token, partSize } = await endpoints.documents.startUpload(documentId);
  const parts: UploadedPart[] = [];
  let sent = 0;
  try {
    for (let offset = 0, n = 1; offset < file.size; offset += partSize, n++) {
      const chunk = file.slice(offset, offset + partSize);
      for (let attempt = 1; ; attempt++) {
        try {
          parts.push(
            await putAuthorized<UploadedPart>(
              endpoints.documents.uploadPartPath(documentId, n, token),
              chunk,
              'application/octet-stream',
              (f) => onProgress((sent + f * chunk.size) / file.size),
              signal,
            ),
          );
          break;
        } catch (err) {
          const transient = err instanceof NetworkError || (err instanceof ApiError && err.status >= 500);
          if (!transient || attempt >= 4 || signal?.aborted) throw err;
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
      sent += chunk.size;
      onProgress(sent / file.size);
    }
    return await endpoints.documents.completeUpload(documentId, token, parts);
  } catch (err) {
    void endpoints.documents.abortUpload(documentId, token).catch(() => undefined);
    throw err;
  }
}

/** Sends the binary of an existing document (also used to complete imported backups). */
export async function uploadContent(
  documentId: string,
  file: Blob,
  mime: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DocumentMeta> {
  if (file.size > UPLOAD_PART_BYTES) return uploadInParts(documentId, file, onProgress, signal);
  return putAuthorized<DocumentMeta>(endpoints.documents.contentPath(documentId), file, mime, onProgress, signal);
}

/** Registers the document metadata, then uploads the file. */
export async function uploadNewDocument(
  file: File,
  topicId: string | null,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DocumentMeta> {
  const check = validateFile(file);
  if ('error' in check) throw new ApiError(400, 'bad_request', check.error);
  const meta = await endpoints.documents.create({
    id: uuidv7(),
    topicId,
    originalName: file.name,
    mimeType: check.mime,
    sizeBytes: file.size,
  });
  return uploadContent(meta.id, file, check.mime, onProgress, signal);
}

export const ACCEPT_ATTR = Object.entries(ALLOWED_FILE_TYPES)
  .flatMap(([mime, t]) => [mime, ...t.ext.map((e) => `.${e}`)])
  .join(',');
