import { createRoute, z } from '@hono/zod-openapi';
import {
  FAVORITE_ENTITY_TYPES,
  SETTING_KEYS,
  zActivityEvent,
  zDashboard,
  zFavorite,
  zFavoriteCreate,
  zGraph,
  zGraphQuery,
  zId,
  zPageQuery,
  zSearchQuery,
  zSearchResult,
  zSetting,
  zSettingPut,
  zViewEvent,
  type SettingKey,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as o from './service';

export function overviewRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/dashboard',
      tags: ['Painel'],
      summary: 'Resumo do painel inicial',
      security: secured,
      responses: { 200: ok(zDashboard), ...errors },
    }),
    async (c) => c.json({ data: await o.dashboard(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/search',
      tags: ['Busca'],
      summary: 'Busca global (sem distinção de acentos e maiúsculas)',
      security: secured,
      request: { query: zSearchQuery },
      responses: { 200: ok(z.array(zSearchResult)), ...errors },
    }),
    async (c) => c.json({ data: await o.search(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/graph',
      tags: ['Grafo'],
      summary: 'Nós e relações do grafo de conhecimento',
      security: secured,
      request: { query: zGraphQuery },
      responses: { 200: ok(zGraph), ...errors },
    }),
    async (c) => c.json({ data: await o.buildGraph(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  const ft = ['Favoritos'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/favorites',
      tags: ft,
      summary: 'Listar favoritos',
      security: secured,
      responses: { 200: ok(z.array(zFavorite)), ...errors },
    }),
    async (c) => c.json({ data: await o.listFavorites(c.env.DB, c.get('userId')) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/favorites',
      tags: ft,
      summary: 'Favoritar item (idempotente)',
      security: secured,
      request: { body: jsonBody(zFavoriteCreate) },
      responses: { 200: ok(zFavorite), ...errors },
    }),
    async (c) => {
      const { entityType, entityId } = c.req.valid('json');
      return c.json({ data: await o.addFavorite(c.env.DB, c.get('userId'), entityType, entityId) }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/favorites/{entityType}/{entityId}',
      tags: ft,
      summary: 'Remover dos favoritos',
      security: secured,
      request: { params: z.object({ entityType: z.enum(FAVORITE_ENTITY_TYPES), entityId: zId }) },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      const { entityType, entityId } = c.req.valid('param');
      await o.removeFavorite(c.env.DB, c.get('userId'), entityType, entityId);
      return c.body(null, 204);
    },
  );

  const at = ['Atividade'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/activity',
      tags: at,
      summary: 'Histórico de atividades',
      security: secured,
      request: { query: zPageQuery },
      responses: { 200: okPage(zActivityEvent), ...errors },
    }),
    async (c) => {
      const { cursor, limit } = c.req.valid('query');
      const page = await o.listActivity(c.env.DB, c.get('userId'), cursor, limit);
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/activity/view',
      tags: at,
      summary: 'Registrar abertura de um item (alimenta "continuar de onde parou")',
      security: secured,
      request: { body: jsonBody(zViewEvent) },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      const { entityType, entityId } = c.req.valid('json');
      await o.recordView(c.env.DB, c.get('userId'), entityType, entityId);
      return c.body(null, 204);
    },
  );

  const st = ['Configurações'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/settings',
      tags: st,
      summary: 'Todas as configurações',
      security: secured,
      responses: { 200: ok(z.array(zSetting)), ...errors },
    }),
    async (c) => c.json({ data: await o.listSettings(c.env.DB, c.get('userId')) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/settings/{key}',
      tags: st,
      summary: 'Gravar configuração (com controle de versão)',
      security: secured,
      request: {
        params: z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]) }),
        body: jsonBody(zSettingPut),
      },
      responses: { 200: ok(zSetting), ...errors },
    }),
    async (c) => {
      const { value, baseVersion } = c.req.valid('json');
      const setting = await o.putSetting(c.env.DB, c.get('userId'), c.req.valid('param').key, value, baseVersion);
      return c.json({ data: setting }, 200);
    },
  );
}
