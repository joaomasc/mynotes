import type { MiddlewareHandler } from 'hono';
import { API_PREFIX } from '@mynotes/shared';
import type { AppEnv } from '../env';
import { unauthorized } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { first } from '../lib/db';
import { nowIso } from '../lib/time';

/**
 * Routes reachable without an access token. Everything else under the API
 * prefix requires authentication (default deny).
 */
const PUBLIC_ROUTES: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/health$/ },
  { method: 'POST', pattern: /^\/auth\/(prelogin|login|challenge|refresh)$/ },
  // Short-lived HMAC-signed file links (signature checked by the handler)
  { method: 'GET', pattern: /^\/files\/[0-9a-f-]{36}$/ },
  { method: 'HEAD', pattern: /^\/files\/[0-9a-f-]{36}$/ },
  { method: 'GET', pattern: /^\/(openapi\.json|docs)$/ },
];

export function isPublicRoute(method: string, pathname: string): boolean {
  if (!pathname.startsWith(API_PREFIX)) return false;
  const path = pathname.slice(API_PREFIX.length) || '/';
  return PUBLIC_ROUTES.some((r) => r.method === method && r.pattern.test(path));
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
  return match ? match[1]! : null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'OPTIONS' || isPublicRoute(c.req.method, new URL(c.req.url).pathname)) {
    return next();
  }
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) throw unauthorized();

  const now = nowIso();
  const row = await first<{ session_id: string; user_id: string }>(
    c.env.DB,
    `SELECT s.id AS session_id, s.user_id AS user_id
       FROM access_tokens t
       JOIN sessions s ON s.id = t.session_id
      WHERE t.token_hash = ? AND t.expires_at > ?
        AND s.revoked_at IS NULL AND s.expires_at > ?`,
    await sha256(token),
    now,
    now,
  );
  if (!row) throw unauthorized('Sessão expirada ou inválida');

  c.set('userId', row.user_id);
  c.set('sessionId', row.session_id);
  return next();
};
