import { createRoute } from '@hono/zod-openapi';
import {
  zPageQuery,
  zStudySession,
  zStudySessionCreate,
  zStudySessionListQuery,
  zStudySessionUpdate,
  zStudyStats,
  zStudyStatsQuery,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as study from './service';

const tags = ['Diário de estudos'];

export function studyRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/study-sessions',
      tags,
      summary: 'Histórico de sessões (filtro por período e assunto)',
      security: secured,
      request: { query: zStudySessionListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zStudySession), ...errors },
    }),
    async (c) => {
      const page = await study.listSessions(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/study-sessions/stats',
      tags,
      summary: 'Tempo estudado por dia e por assunto no período',
      security: secured,
      request: { query: zStudyStatsQuery },
      responses: { 200: ok(zStudyStats), ...errors },
    }),
    async (c) => c.json({ data: await study.stats(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/study-sessions',
      tags,
      summary: 'Registrar sessão de estudo',
      security: secured,
      request: { body: jsonBody(zStudySessionCreate) },
      responses: { 201: ok(zStudySession, 'Criada'), 200: ok(zStudySession, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { session, created } = await study.createSession(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: session }, 201) : c.json({ data: session }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/study-sessions/{id}',
      tags,
      summary: 'Obter sessão',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zStudySession), ...errors },
    }),
    async (c) => c.json({ data: await study.getSession(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/study-sessions/{id}',
      tags,
      summary: 'Editar sessão',
      security: secured,
      request: { params: idParam, body: jsonBody(zStudySessionUpdate) },
      responses: { 200: ok(zStudySession), ...errors },
    }),
    async (c) => {
      const session = await study.updateSession(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: session }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/study-sessions/{id}',
      tags,
      summary: 'Excluir sessão',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await study.deleteSession(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
