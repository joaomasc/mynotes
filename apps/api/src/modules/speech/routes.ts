import { createRoute } from '@hono/zod-openapi';
import {
  zPageQuery,
  zSpeechAttempt,
  zSpeechAttemptCreate,
  zSpeechAttemptSummary,
  zSpeechEvaluate,
  zSpeechListQuery,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as speech from './service';

const tags = ['Oratória'];

export function speechRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/attempts',
      tags,
      summary: 'Histórico de falas gravadas (mais recentes primeiro)',
      security: secured,
      request: { query: zSpeechListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zSpeechAttemptSummary), ...errors },
    }),
    async (c) => {
      const page = await speech.listAttempts(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/attempts',
      tags,
      summary: 'Salvar uma fala gravada',
      description:
        'O navegador mede o áudio e envia a transcrição, os tempos das palavras, a linha do tempo de volume e tom e as métricas. ' +
        'A API recalcula os critérios medidos e a nota pela régua atual. O áudio não é enviado.',
      security: secured,
      request: { body: jsonBody(zSpeechAttemptCreate) },
      responses: { 201: ok(zSpeechAttempt, 'Criada'), 200: ok(zSpeechAttempt, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { attempt, created } = await speech.createAttempt(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: attempt }, 201) : c.json({ data: attempt }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/attempts/{id}',
      tags,
      summary: 'Obter uma fala com o resultado completo',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zSpeechAttempt), ...errors },
    }),
    async (c) => c.json({ data: await speech.getAttempt(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/speech/attempts/{id}',
      tags,
      summary: 'Excluir uma fala',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await speech.deleteAttempt(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/attempts/{id}/evaluate',
      tags,
      summary: 'Avaliar a fala com a IA (estrutura, linguagem, frases reescritas)',
      description:
        'Usa a OpenAI e conta no orçamento diário da IA. Uma fala já avaliada devolve a avaliação guardada, a não ser com `force`.',
      security: secured,
      request: { params: idParam, body: jsonBody(zSpeechEvaluate) },
      responses: { 200: ok(zSpeechAttempt), ...errors },
    }),
    async (c) => {
      const attempt = await speech.evaluateAttempt(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: attempt }, 200);
    },
  );
}
