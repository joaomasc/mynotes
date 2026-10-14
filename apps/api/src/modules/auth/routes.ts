import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  zAuthResponse,
  zChallengeResponse,
  zChangePasswordRequest,
  zLoginRequest,
  zPreloginRequest,
  zPreloginResponse,
  zRefreshRequest,
  zSession,
  zUser,
} from '@mynotes/shared';
import type { AppEnv } from '../../env';
import { notFound } from '../../lib/errors';
import { errors, idParam, jsonBody, noContent, ok, publicErrors, secured } from '../../lib/openapi';
import * as auth from './service';

const tags = ['Autenticação'];

function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export function authRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/prelogin',
      tags,
      summary: 'Parâmetros de derivação da senha (Argon2id) para o usuário',
      request: { body: jsonBody(zPreloginRequest) },
      responses: { 200: ok(zPreloginResponse), ...publicErrors },
    }),
    async (c) => {
      const { username } = c.req.valid('json');
      return c.json({ data: { kdf: await auth.prelogin(c.env, username) } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/login',
      tags,
      summary: 'Entrar e registrar a chave pública deste dispositivo',
      request: { body: jsonBody(zLoginRequest) },
      responses: { 200: ok(zAuthResponse), 401: errors[401], ...publicErrors },
    }),
    async (c) => {
      const body = c.req.valid('json');
      return c.json({ data: await auth.login(c.env, body, clientIp(c.req.raw)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/challenge',
      tags,
      summary: 'Desafio de uso único para renovar a sessão',
      responses: { 200: ok(zChallengeResponse), ...publicErrors },
    }),
    async (c) => c.json({ data: await auth.issueChallenge(c.env) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/refresh',
      tags,
      summary: 'Renovar o token de acesso com a assinatura do dispositivo',
      request: { body: jsonBody(zRefreshRequest) },
      responses: { 200: ok(zAuthResponse), 401: errors[401], ...publicErrors },
    }),
    async (c) => c.json({ data: await auth.refresh(c.env, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/logout',
      tags,
      summary: 'Encerrar a sessão atual',
      security: secured,
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await auth.revokeSession(c.env.DB, c.get('userId'), c.get('sessionId'));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/auth/me',
      tags,
      summary: 'Usuário autenticado',
      security: secured,
      responses: { 200: ok(zUser), ...errors },
    }),
    async (c) => c.json({ data: await auth.getUser(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/auth/sessions',
      tags,
      summary: 'Sessões ativas',
      security: secured,
      responses: { 200: ok(z.array(zSession)), ...errors },
    }),
    async (c) => c.json({ data: await auth.listSessions(c.env.DB, c.get('userId'), c.get('sessionId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/auth/sessions/{id}',
      tags,
      summary: 'Revogar uma sessão',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      if (!(await auth.revokeSession(c.env.DB, c.get('userId'), id))) throw notFound('Sessão');
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/sessions/revoke-others',
      tags,
      summary: 'Revogar todas as outras sessões',
      security: secured,
      responses: { 200: ok(z.object({ revoked: z.number().int() })), ...errors },
    }),
    async (c) => {
      const revoked = await auth.revokeOtherSessions(c.env.DB, c.get('userId'), c.get('sessionId'));
      return c.json({ data: { revoked } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/password',
      tags,
      summary: 'Alterar a senha (revoga as outras sessões)',
      security: secured,
      request: { body: jsonBody(zChangePasswordRequest) },
      responses: { 204: noContent, 403: errors[401], ...errors },
    }),
    async (c) => {
      await auth.changePassword(c.env, c.get('userId'), c.get('sessionId'), c.req.valid('json'));
      return c.body(null, 204);
    },
  );
}
