import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { API_PREFIX, APP_NAME } from '@mynotes/shared';
import type { AppEnv } from './env';
import { Scalar } from '@scalar/hono-api-reference';
import { tooLarge, validationError } from './lib/errors';
import { ok } from './lib/openapi';
import { requireAuth } from './middleware/auth';
import { corsPolicy, handleError, notFoundHandler, requestContext, zodIssues } from './middleware/common';
import { idempotency } from './middleware/idempotency';
import { authRoutes } from './modules/auth/routes';

export const API_VERSION = '0.1.0';
const JSON_BODY_LIMIT = 2 * 1024 * 1024;

export type ApiApp = OpenAPIHono<AppEnv>;

/** Route modules registered under /api/v1. Each receives the versioned sub-app. */
export type RouteModule = (app: ApiApp) => void;

export function createApp(modules: RouteModule[] = []): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.use('*', requestContext);
  app.use('*', corsPolicy);
  app.onError(handleError);
  app.notFound(notFoundHandler);

  const api = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw validationError(zodIssues(result.error));
    },
  });

  api.use('*', async (c, next) => {
    // Streaming uploads are bounded separately by the documents module.
    if (c.req.method === 'PUT' && c.req.path.endsWith('/content')) return next();
    return bodyLimit({
      maxSize: JSON_BODY_LIMIT,
      onError: () => {
        throw tooLarge('Conteúdo maior que o permitido (2 MB)');
      },
    })(c, next);
  });
  api.use('*', requireAuth);
  api.use('*', idempotency);

  api.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['Sistema'],
      summary: 'Verificação de disponibilidade',
      responses: { 200: ok(z.object({ status: z.literal('ok'), version: z.string() })) },
    }),
    (c) => c.json({ data: { status: 'ok' as const, version: API_VERSION } }, 200),
  );

  authRoutes(api);
  for (const register of modules) register(api);

  api.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'Token de acesso de curta duração obtido em /auth/login ou /auth/refresh',
  });
  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: `${APP_NAME} API`,
      version: API_VERSION,
      description: 'API REST do MyNotes. Todas as rotas, exceto as marcadas como públicas, exigem token Bearer.',
    },
    servers: [{ url: API_PREFIX }],
  });
  api.get('/docs', Scalar({ url: `${API_PREFIX}/openapi.json`, pageTitle: `${APP_NAME} API` }));

  app.route(API_PREFIX, api);
  return app;
}
