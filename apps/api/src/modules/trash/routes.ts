import { createRoute, z } from '@hono/zod-openapi';
import { TRASHABLE_TYPES, zId, zTrashItem, zTrashRef } from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, jsonBody, ok, secured } from '../../lib/openapi';
import * as trash from './service';

const tags = ['Lixeira'];
const zCount = z.object({ count: z.number().int() });

export function trashRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/trash',
      tags,
      summary: 'Itens na lixeira',
      security: secured,
      responses: { 200: ok(z.array(zTrashItem)), ...errors },
    }),
    async (c) => c.json({ data: await trash.listTrash(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/trash/restore',
      tags,
      summary: 'Restaurar item (assuntos restauram todo o lote excluído junto)',
      security: secured,
      request: { body: jsonBody(zTrashRef) },
      responses: { 200: ok(zCount), ...errors },
    }),
    async (c) => {
      const { type, id } = c.req.valid('json');
      return c.json({ data: { count: await trash.restore(c.env.DB, c.get('userId'), type, id) } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/trash/{type}/{id}',
      tags,
      summary: 'Excluir definitivamente (inclui arquivos no R2)',
      security: secured,
      request: { params: z.object({ type: z.enum(TRASHABLE_TYPES), id: zId }) },
      responses: { 200: ok(zCount), ...errors },
    }),
    async (c) => {
      const { type, id } = c.req.valid('param');
      return c.json({ data: { count: await trash.purge(c.env, c.get('userId'), type, id) } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/trash/empty',
      tags,
      summary: 'Esvaziar a lixeira',
      security: secured,
      responses: { 200: ok(zCount), ...errors },
    }),
    async (c) => c.json({ data: { count: await trash.emptyTrash(c.env, c.get('userId')) } }, 200),
  );
}
