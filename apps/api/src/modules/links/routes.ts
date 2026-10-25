import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { zLinkAccept, zLinkExplain, zLinkScanResult, zLinkSuggestion, zLinkSuggestionsQuery, zLinkSuggestionsResult, zRelationWithTitles } from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import { acceptSuggestion, dismissSuggestion, explainSuggestions, listSuggestions, scanPending } from './service';

const tags = ['Ligações sugeridas'];

export function linkRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/links/suggestions',
      tags,
      summary: 'Notas e conceitos parecidos no sentido que ainda não estão ligados',
      description: 'Com `type` e `id`: as sugestões de um item (procuradas na hora se o texto mudou). Sem eles: as abertas de tudo (para o grafo).',
      security: secured,
      request: { query: zLinkSuggestionsQuery },
      responses: { 200: ok(zLinkSuggestionsResult), ...errors },
    }),
    async (c) => c.json({ data: await listSuggestions(c.env, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/links/suggestions/explain',
      tags,
      summary: 'A IA explica sugestões ainda sem explicação (tipo de relação e uma frase)',
      description: 'Usa a OpenAI e conta no orçamento diário da IA. Cada par é explicado uma vez só.',
      security: secured,
      request: { body: jsonBody(zLinkExplain) },
      responses: { 200: ok(z.array(zLinkSuggestion)), ...errors },
    }),
    async (c) => c.json({ data: await explainSuggestions(c.env, c.get('userId'), c.req.valid('json').ids) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/links/suggestions/{id}/accept',
      tags,
      summary: 'Ligar: cria a relação no grafo',
      security: secured,
      request: { params: idParam, body: jsonBody(zLinkAccept) },
      responses: { 200: ok(z.object({ relation: zRelationWithTitles })), ...errors },
    }),
    async (c) => c.json({ data: await acceptSuggestion(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/links/suggestions/{id}/dismiss',
      tags,
      summary: 'Dispensar: a sugestão não volta mais',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await dismissSuggestion(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/links/scan',
      tags,
      summary: 'Procurar agora ligações para os itens novos ou alterados (um lote)',
      security: secured,
      responses: { 200: ok(zLinkScanResult), ...errors },
    }),
    async (c) => c.json({ data: await scanPending(c.env, c.get('userId'), 10) }, 200),
  );
}
