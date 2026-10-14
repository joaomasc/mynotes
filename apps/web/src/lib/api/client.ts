import type { ApiErrorBody, ApiErrorCode, PageMeta } from '@mynotes/shared';
import { API_BASE } from '../config';
import { randomId } from '../encoding';
import { syncStatus } from '../sync/status';

/** Error returned by the API (safe, user-facing message). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never reached the server or the response was lost. */
export class NetworkError extends Error {
  constructor(message = 'Sem conexão com o servidor') {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isVersionConflict(err: unknown): err is ApiError & { details: { current: unknown } } {
  return err instanceof ApiError && err.code === 'version_conflict';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Algo deu errado. Tente novamente.';
}

/** Supplied by the auth layer: current access token and a refresh hook. */
export interface TokenSource {
  token(): string | null;
  /** Obtains a new access token, or null when the session is gone. */
  refresh(): Promise<string | null>;
  /** Called when the session is definitely invalid. */
  onUnauthenticated(): void;
}

let tokens: TokenSource | null = null;
export function setTokenSource(source: TokenSource | null): void {
  tokens = source;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query | undefined;
  body?: unknown;
  /** Raw body (e.g. file upload); skips JSON encoding. */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  /** Public endpoint: do not attach or refresh the token. */
  anonymous?: boolean;
  signal?: AbortSignal | undefined;
  /** Retries on network failures (mutations are retried with the same Idempotency-Key). */
  retries?: number;
  /** Count this request in the sync indicator (default: mutations only). */
  track?: boolean;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // non-JSON error (proxy, outage)
  }
  if (body?.error) {
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details, body.error.requestId);
  }
  return new ApiError(
    res.status,
    res.status >= 500 ? 'internal_error' : 'bad_request',
    res.status >= 500 ? 'O servidor está indisponível no momento.' : 'Requisição inválida',
  );
}

/**
 * Performs an API request. Mutations carry an Idempotency-Key that is reused
 * across retries, so a retry after a lost response never applies twice.
 * A 401 triggers one token refresh and a single replay.
 */
export async function request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const mutating = MUTATING.has(method);
  const track = opts.track ?? mutating;
  const idempotencyKey = mutating ? randomId(18) : null;
  const maxRetries = opts.retries ?? (mutating ? 2 : 2);

  const send = async (token: string | null): Promise<Response> => {
    const headers = new Headers(opts.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    let body: BodyInit | undefined = opts.rawBody;
    if (opts.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(opts.body);
    }
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(buildUrl(path, opts.query), {
          method,
          headers,
          body,
          signal: opts.signal ?? null,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if ([502, 503, 504].includes(res.status) && attempt < maxRetries && !opts.rawBody) {
          attempt++;
          await sleep(500 * 3 ** (attempt - 1));
          continue;
        }
        return res;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (attempt >= maxRetries || opts.rawBody) throw new NetworkError();
        attempt++;
        await sleep(500 * 3 ** (attempt - 1));
      }
    }
  };

  if (track) syncStatus.begin();
  try {
    let res = await send(opts.anonymous ? null : (tokens?.token() ?? null));
    if (res.status === 401 && !opts.anonymous && tokens) {
      const fresh = await tokens.refresh();
      if (!fresh) {
        tokens.onUnauthenticated();
        throw await parseError(res);
      }
      res = await send(fresh);
      if (res.status === 401) {
        tokens.onUnauthenticated();
      }
    }
    if (!res.ok) throw await parseError(res);
    if (track) syncStatus.succeed();
    return res;
  } catch (err) {
    if (track) {
      if (err instanceof NetworkError) syncStatus.fail(err.message, true);
      else syncStatus.fail(errorMessage(err));
    }
    throw err;
  }
}

async function dataOf<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const api = {
  get: async <T>(path: string, query?: Query, signal?: AbortSignal) =>
    dataOf<T>(await request('GET', path, { query, signal })),
  page: async <T>(path: string, query?: Query, signal?: AbortSignal) => {
    const res = await request('GET', path, { query, signal });
    return (await res.json()) as { data: T[]; meta: PageMeta };
  },
  post: async <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    dataOf<T>(await request('POST', path, { ...opts, body: body ?? {} })),
  patch: async <T>(path: string, body: unknown, opts: RequestOptions = {}) =>
    dataOf<T>(await request('PATCH', path, { ...opts, body })),
  put: async <T>(path: string, body: unknown, opts: RequestOptions = {}) =>
    dataOf<T>(await request('PUT', path, { ...opts, body })),
  del: async <T = void>(path: string, query?: Query) => dataOf<T>(await request('DELETE', path, { query })),
  /** Authenticated binary download. */
  blob: async (path: string, query?: Query, signal?: AbortSignal) =>
    (await request('GET', path, { query, signal, track: false })).blob(),
};
