import { createRoute, z } from '@hono/zod-openapi';
import {
  zTopic,
  zTopicCreate,
  zTopicDeleteQuery,
  zTopicDetail,
  zTopicMove,
  zTopicUpdate,
  zTopicWithCounts,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, ok, secured } from '../../lib/openapi';
import * as topics from './service';

const tags = ['Assuntos'];

export function topicRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/topics',
      tags,
      summary: 'Árvore completa de assuntos (lista plana com contagens)',
      security: secured,
      responses: { 200: ok(z.array(zTopicWithCounts)), ...errors },
    }),
    async (c) => c.json({ data: await topics.listTopics(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/topics',
      tags,
      summary: 'Criar assunto (idempotente pelo id)',
      security: secured,
      request: { body: jsonBody(zTopicCreate) },
      responses: { 201: ok(zTopic, 'Criado'), 200: ok(zTopic, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { topic, created } = await topics.createTopic(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: topic }, 201) : c.json({ data: topic }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/topics/{id}',
      tags,
      summary: 'Assunto com ancestrais e subassuntos',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zTopicDetail), ...errors },
    }),
    async (c) => c.json({ data: await topics.getTopicDetail(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/topics/{id}',
      tags,
      summary: 'Editar assunto',
      security: secured,
      request: { params: idParam, body: jsonBody(zTopicUpdate) },
      responses: { 200: ok(zTopic), ...errors },
    }),
    async (c) => {
      const topic = await topics.updateTopic(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: topic }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/topics/{id}/move',
      tags,
      summary: 'Mover ou reordenar assunto',
      security: secured,
      request: { params: idParam, body: jsonBody(zTopicMove) },
      responses: { 200: ok(zTopic), ...errors },
    }),
    async (c) => {
      const topic = await topics.moveTopic(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: topic }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/topics/{id}',
      tags,
      summary: 'Enviar assunto para a lixeira',
      description:
        'mode=trash_all envia subassuntos, notas e documentos junto; mode=move_to_parent move o conteúdo para o assunto pai.',
      security: secured,
      request: { params: idParam, query: zTopicDeleteQuery },
      responses: { 200: ok(z.object({ batchId: z.string(), affected: z.number().int() })), ...errors },
    }),
    async (c) => {
      const result = await topics.deleteTopic(
        c.env.DB,
        c.get('userId'),
        c.req.valid('param').id,
        c.req.valid('query').mode,
      );
      return c.json({ data: result }, 200);
    },
  );
}
