import { createRoute } from '@hono/zod-openapi';
import { zPageQuery, zReading, zReadingCreate, zReadingListQuery, zReadingUpdate } from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { notFound } from '../../lib/errors';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as readings from './service';

const tags = ['Leituras'];

export function readingRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/readings',
      tags,
      summary: 'Listar leituras (filtros: status, assunto, atrasadas, busca)',
      security: secured,
      request: { query: zReadingListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zReading), ...errors },
    }),
    async (c) => {
      const page = await readings.listReadings(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/readings',
      tags,
      summary: 'Registrar leitura',
      security: secured,
      request: { body: jsonBody(zReadingCreate) },
      responses: { 201: ok(zReading, 'Criada'), 200: ok(zReading, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { reading, created } = await readings.createReading(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: reading }, 201) : c.json({ data: reading }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/readings/{id}',
      tags,
      summary: 'Obter leitura',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zReading), ...errors },
    }),
    async (c) => {
      const row = await readings.getReadingRow(c.env.DB, c.get('userId'), c.req.valid('param').id);
      if (!row) throw notFound('Leitura');
      return c.json({ data: readings.toReading(row) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/readings/{id}',
      tags,
      summary: 'Atualizar leitura e progresso',
      security: secured,
      request: { params: idParam, body: jsonBody(zReadingUpdate) },
      responses: { 200: ok(zReading), ...errors },
    }),
    async (c) => {
      const reading = await readings.updateReading(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: reading }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/readings/{id}',
      tags,
      summary: 'Excluir leitura',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await readings.deleteReading(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
