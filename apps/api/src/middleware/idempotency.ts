import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { first, run } from '../lib/db';
import { nowIso } from '../lib/time';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
/** Larger responses are not stored (the request is still applied). */
const MAX_STORED_BYTES = 256 * 1024;
/** Streaming uploads (whole files and parts) are naturally idempotent and are excluded: their bodies are large. */
const EXCLUDED = [/\/documents\/[0-9a-f-]{36}\/content$/, /\/documents\/[0-9a-f-]{36}\/uploads\/parts\/\d+$/];

/**
 * Replays the stored response when a mutating request is retried with the
 * same `Idempotency-Key` (e.g. after a network failure where the client never
 * saw the original response). A reused key with a different payload is
 * rejected. Must run after authentication.
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  if (!key || !MUTATING.has(c.req.method)) return next();
  const path = new URL(c.req.url).pathname;
  if (EXCLUDED.some((re) => re.test(path))) return next();
  if (!KEY_RE.test(key)) throw new ApiError('bad_request', 'Idempotency-Key inválida');

  const userId = c.get('userId');
  if (!userId) return next();

  const body = await c.req.text();
  const requestHash = await sha256(`${c.req.method} ${path}\n${body}`);

  const stored = await first<{ request_hash: string; status: number; response_body: string }>(
    c.env.DB,
    'SELECT request_hash, status, response_body FROM idempotency_keys WHERE user_id = ? AND key = ?',
    userId,
    key,
  );
  if (stored) {
    if (stored.request_hash !== requestHash) {
      throw new ApiError('idempotency_conflict', 'Chave de idempotência reutilizada com outro conteúdo');
    }
    return new Response(stored.status === 204 ? null : stored.response_body, {
      status: stored.status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Idempotent-Replayed': 'true',
      },
    });
  }

  await next();

  const res = c.res;
  if (res.status >= 500 || res.status === 401 || res.status === 429) return;
  const type = res.headers.get('Content-Type') ?? '';
  if (res.status !== 204 && !type.includes('application/json')) return;
  const text = res.status === 204 ? '' : await res.clone().text();
  if (text.length > MAX_STORED_BYTES) return;
  await run(
    c.env.DB,
    `INSERT INTO idempotency_keys (user_id, key, request_hash, status, response_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING`,
    userId,
    key,
    requestHash,
    res.status,
    text,
    nowIso(),
  );
};
