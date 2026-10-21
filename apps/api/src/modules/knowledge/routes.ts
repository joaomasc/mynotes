import { createRoute, z } from '@hono/zod-openapi';
import {
  zConcept,
  zConceptCreate,
  zConceptUpdate,
  zId,
  zMindMap,
  zMindMapCreate,
  zMindMapListQuery,
  zMindMapSummary,
  zMindMapUpdate,
  zRelation,
  zRelationCreate,
  zRelationListQuery,
  zRelationUpdate,
  zRelationWithTitles,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import * as k from './service';

export function knowledgeRoutes(app: ApiApp) {
  /* --------------------------------------------------------- concepts */
  const ct = ['Conceitos'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/concepts',
      tags: ct,
      summary: 'Listar conceitos',
      security: secured,
      request: { query: z.object({ topicId: zId.optional() }) },
      responses: { 200: ok(z.array(zConcept)), ...errors },
    }),
    async (c) => c.json({ data: await k.listConcepts(c.env.DB, c.get('userId'), c.req.valid('query').topicId) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/concepts',
      tags: ct,
      summary: 'Criar conceito',
      security: secured,
      request: { body: jsonBody(zConceptCreate) },
      responses: { 201: ok(zConcept, 'Criado'), 200: ok(zConcept, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { concept, created } = await k.createConcept(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: concept }, 201) : c.json({ data: concept }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/concepts/{id}',
      tags: ct,
      summary: 'Obter conceito',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zConcept), ...errors },
    }),
    async (c) => c.json({ data: await k.getConcept(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/concepts/{id}',
      tags: ct,
      summary: 'Editar conceito',
      security: secured,
      request: { params: idParam, body: jsonBody(zConceptUpdate) },
      responses: { 200: ok(zConcept), ...errors },
    }),
    async (c) => {
      const concept = await k.updateConcept(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: concept }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/concepts/{id}',
      tags: ct,
      summary: 'Excluir conceito (e suas relações)',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await k.deleteConcept(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  /* -------------------------------------------------------- relations */
  const rt = ['Relações'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/relations',
      tags: rt,
      summary: 'Relações de um item (como origem ou destino)',
      security: secured,
      request: { query: zRelationListQuery },
      responses: { 200: ok(z.array(zRelationWithTitles)), ...errors },
    }),
    async (c) => {
      const { entityType, entityId } = c.req.valid('query');
      return c.json({ data: await k.listRelations(c.env.DB, c.get('userId'), entityType, entityId) }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/relations',
      tags: rt,
      summary: 'Relacionar dois itens',
      security: secured,
      request: { body: jsonBody(zRelationCreate) },
      responses: { 201: ok(zRelationWithTitles, 'Criada'), 200: ok(zRelationWithTitles, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { relation, created } = await k.createRelation(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: relation }, 201) : c.json({ data: relation }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/relations/{id}',
      tags: rt,
      summary: 'Alterar tipo ou rótulo da relação',
      security: secured,
      request: { params: idParam, body: jsonBody(zRelationUpdate) },
      responses: { 200: ok(zRelation), ...errors },
    }),
    async (c) => {
      const rel = await k.updateRelation(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: rel }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/relations/{id}',
      tags: rt,
      summary: 'Remover relação',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await k.deleteRelation(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  /* -------------------------------------------------------- mind maps */
  const mt = ['Mapas mentais'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/mind-maps',
      tags: mt,
      summary: 'Listar mapas mentais e canvas (filtros opcionais: tipo, assunto, nota)',
      security: secured,
      request: { query: zMindMapListQuery },
      responses: { 200: ok(z.array(zMindMapSummary)), ...errors },
    }),
    async (c) => c.json({ data: await k.listMindMaps(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/mind-maps',
      tags: mt,
      summary: 'Criar mapa mental (ou importar a partir de JSON)',
      security: secured,
      request: { body: jsonBody(zMindMapCreate) },
      responses: { 201: ok(zMindMap, 'Criado'), 200: ok(zMindMap, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { map, created } = await k.createMindMap(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: map }, 201) : c.json({ data: map }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/mind-maps/{id}',
      tags: mt,
      summary: 'Obter mapa mental completo',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zMindMap), ...errors },
    }),
    async (c) => c.json({ data: await k.getMindMap(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/mind-maps/{id}',
      tags: mt,
      summary: 'Salvar mapa mental',
      security: secured,
      request: { params: idParam, body: jsonBody(zMindMapUpdate) },
      responses: { 200: ok(zMindMapSummary), ...errors },
    }),
    async (c) => {
      const map = await k.updateMindMap(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: map }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/mind-maps/{id}',
      tags: mt,
      summary: 'Excluir mapa mental',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await k.deleteMindMap(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
