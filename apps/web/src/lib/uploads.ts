import {
  ALLOWED_FILE_TYPES,
  UPLOAD_MAX_BYTES,
  mimeFromFileName,
  uuidv7,
  type AllowedMimeType,
  type ApiErrorBody,
  type DocumentMeta,
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
  if (file.size > UPLOAD_MAX_BYTES) return { error: `Maior que o limite de ${fileSize(UPLOAD_MAX_BYTES)}.` };
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

/** Sends the binary of an existing document (also used to complete imported backups). */
export async function uploadContent(
  documentId: string,
  file: Blob,
  mime: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DocumentMeta> {
  const url = buildUrl(endpoints.documents.contentPath(documentId));
  let token = await getAccessToken();
  if (!token) throw new ApiError(401, 'unauthorized', 'Sessão expirada');
  let res = await putWithProgress(url, file, mime, token, onProgress, signal);
  if (res.status === 401) {
    token = await getAccessToken(true);
    if (!token) throw new ApiError(401, 'unauthorized', 'Sessão expirada');
    res = await putWithProgress(url, file, mime, token, onProgress, signal);
  }
  if (res.status >= 200 && res.status < 300) return (JSON.parse(res.body) as { data: DocumentMeta }).data;
  let err: ApiErrorBody | null = null;
  try {
    err = JSON.parse(res.body) as ApiErrorBody;
  } catch {
    // not JSON
  }
  throw new ApiError(res.status, err?.error.code ?? 'internal_error', err?.error.message ?? 'Falha no envio');
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
