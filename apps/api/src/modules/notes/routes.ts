import { createRoute, z } from '@hono/zod-openapi';
import {
  zBacklink,
  zId,
  zNote,
  zNoteCreate,
  zNoteListQuery,
  zNoteMove,
  zNoteRevision,
  zNoteRevisionSummary,
  zNoteSummary,
  zNoteUpdate,
  zPageQuery,
  zTagCount,
  zTagListQuery,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as notes from './service';

const tags = ['Notas'];

export function noteRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/notes',
      tags,
      summary: 'Listar notas (sem conteúdo), paginado',
      security: secured,
      request: { query: zNoteListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zNoteSummary), ...errors },
    }),
    async (c) => {
      const page = await notes.listNotes(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/notes',
      tags,
      summary: 'Criar nota (idempotente pelo id)',
      security: secured,
      request: { body: jsonBody(zNoteCreate) },
      responses: { 201: ok(zNote, 'Criada'), 200: ok(zNote, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { note, created } = await notes.createNote(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: note }, 201) : c.json({ data: note }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/notes/{id}',
      tags,
      summary: 'Obter nota com conteúdo',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zNote), ...errors },
    }),
    async (c) => c.json({ data: await notes.getNote(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/notes/{id}',
      tags,
      summary: 'Salvar nota (controle de versão otimista)',
      description: 'Retorna 409 version_conflict com a versão atual do servidor quando baseVersion está desatualizada.',
      security: secured,
      request: { params: idParam, body: jsonBody(zNoteUpdate) },
      responses: { 200: ok(zNoteSummary), 413: errors[400], ...errors },
    }),
    async (c) => {
      const summary = await notes.updateNote(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: summary }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/notes/{id}/move',
      tags,
      summary: 'Mover nota de assunto ou reordenar',
      security: secured,
      request: { params: idParam, body: jsonBody(zNoteMove) },
      responses: { 200: ok(zNoteSummary), ...errors },
    }),
    async (c) => {
      const summary = await notes.moveNote(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: summary }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/notes/{id}',
      tags,
      summary: 'Enviar nota para a lixeira',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await notes.trashNote(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/notes/{id}/revisions',
      tags,
      summary: 'Histórico de versões da nota',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(z.array(zNoteRevisionSummary)), ...errors },
    }),
    async (c) => c.json({ data: await notes.listRevisions(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/notes/{id}/revisions/{revisionId}',
      tags,
      summary: 'Conteúdo de uma versão anterior',
      security: secured,
      request: { params: z.object({ id: zId, revisionId: zId }) },
      responses: { 200: ok(zNoteRevision), ...errors },
    }),
    async (c) => {
      const { id, revisionId } = c.req.valid('param');
      return c.json({ data: await notes.getRevision(c.env.DB, c.get('userId'), id, revisionId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tags',
      tags,
      summary: 'Tags (#) usadas nas notas, com contagem',
      security: secured,
      request: { query: zTagListQuery },
      responses: { 200: ok(z.array(zTagCount)), ...errors },
    }),
    async (c) => c.json({ data: await notes.listTags(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/backlinks/{type}/{id}',
      tags,
      summary: 'Notas, resenhas e anotações que referenciam o item',
      security: secured,
      request: {
        params: z.object({ type: z.enum(['note', 'topic', 'document', 'reading', 'concept']), id: zId }),
      },
      responses: { 200: ok(z.array(zBacklink)), ...errors },
    }),
    async (c) => {
      const { type, id } = c.req.valid('param');
      return c.json({ data: await notes.backlinks(c.env.DB, c.get('userId'), type, id) }, 200);
    },
  );
}
