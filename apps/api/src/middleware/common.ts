import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '@mynotes/shared';
import { runtimeConfig, type AppEnv } from '../env';
import { ApiError } from '../lib/errors';

export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  const h = c.res.headers;
  h.set('X-Request-Id', requestId);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('X-Frame-Options', 'DENY');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
};

/**
 * Restrictive CORS: only exact origins from ALLOWED_ORIGINS. Authentication
 * uses bearer tokens (never cookies), so credentials are not allowed.
 */
export const corsPolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { allowedOrigins } = runtimeConfig(c.env);
  return cors({
    origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Range', 'X-Upload-Size'],
    exposeHeaders: [
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Content-Disposition',
      'ETag',
      'Retry-After',
      'X-Request-Id',
      'Idempotent-Replayed',
    ],
    maxAge: 600,
    credentials: false,
  })(c, next);
};

function errorBody(c: Context<AppEnv>, code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: c.get('requestId'),
    },
  };
}

export function zodIssues(error: ZodError) {
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Central error handler: never leaks stack traces or internals to clients. */
export function handleError(err: unknown, c: Context<AppEnv>): Response {
  if (err instanceof ApiError) {
    const res = c.json(errorBody(c, err.code, err.message, err.details), err.status as ContentfulStatusCode);
    for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v);
    return res;
  }
  if (err instanceof ZodError) {
    return c.json(errorBody(c, 'validation_error', 'Dados inválidos', zodIssues(err)), 400);
  }
  if (err instanceof HTTPException) {
    const status = err.status;
    const code: ApiErrorCode =
      status === 413
        ? 'payload_too_large'
        : status === 415
          ? 'unsupported_media_type'
          : status === 401
            ? 'unauthorized'
            : status === 404
              ? 'not_found'
              : status >= 500
                ? 'internal_error'
                : 'bad_request';
    const message =
      code === 'payload_too_large'
        ? 'Conteúdo maior que o permitido'
        : code === 'unsupported_media_type'
          ? 'Tipo de conteúdo não suportado'
          : status >= 500
            ? 'Erro interno'
            : 'Requisição inválida';
    return c.json(errorBody(c, code, message), status as ContentfulStatusCode);
  }
  // Unexpected: log minimal, non-sensitive context (no bodies, headers or query strings).
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      error: e.name,
      message: e.message.slice(0, 300),
    }),
  );
  return c.json(errorBody(c, 'internal_error', 'Erro interno. Tente novamente em instantes.'), 500);
}

export function notFoundHandler(c: Context<AppEnv>): Response {
  return c.json(errorBody(c, 'not_found', 'Rota não encontrada'), 404);
}
