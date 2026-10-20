import { createRoute, z } from '@hono/zod-openapi';
import { zAiActionDecision, zAiChatRequest, zAiChatResponse, zAiConversation, zAiConversationSummary, zAiStatus } from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import { confirmAction, rejectAction } from './actions';
import { aiStatus, chat, deleteConversation, getConversation, listConversations } from './service';

const tags = ['Assistente de IA'];
const unavailable = { 503: errors[500] };

export function assistantRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/status',
      tags,
      summary: 'Estado do assistente: configurado, modelo, limites e consumo dos últimos 30 dias',
      description: 'Nunca devolve a chave da OpenAI — apenas se ela está configurada.',
      security: secured,
      responses: { 200: ok(zAiStatus), ...errors },
    }),
    async (c) => c.json({ data: await aiStatus(c.env, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/chat',
      tags,
      summary: 'Enviar uma mensagem ao assistente',
      description:
        'Um turno de conversa: o modelo consulta o MyNotes por ferramentas autorizadas pelo servidor e responde citando os itens reais. ' +
        'Escritas pontuais pedidas explicitamente são executadas; lotes, sobrescritas e mudanças de hierarquia voltam como propostas em `actions`. ' +
        'Reenviar o mesmo `messageId` devolve a resposta já dada (`replayed`), sem chamar o modelo de novo.',
      security: secured,
      request: { body: jsonBody(zAiChatRequest) },
      responses: { 200: ok(zAiChatResponse), ...errors, ...unavailable },
    }),
    async (c) => {
      const body = c.req.valid('json');
      return c.json({ data: await chat(c.env, c.get('userId'), body) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/conversations',
      tags,
      summary: 'Conversas recentes (até 50)',
      security: secured,
      responses: { 200: ok(z.array(zAiConversationSummary)), ...errors },
    }),
    async (c) => c.json({ data: await listConversations(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/conversations/{id}',
      tags,
      summary: 'Conversa com mensagens, fontes e ações',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zAiConversation), ...errors },
    }),
    async (c) => c.json({ data: await getConversation(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/ai/conversations/{id}',
      tags,
      summary: 'Apagar uma conversa (o que o assistente criou no MyNotes continua)',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await deleteConversation(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/actions/{id}/confirm',
      tags,
      summary: 'Confirmar e executar uma proposta do assistente',
      description: 'Executa uma única vez (a proposta é reservada atomicamente). Os dados são validados de novo antes de gravar.',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zAiActionDecision), ...errors },
    }),
    async (c) => c.json({ data: await confirmAction(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/actions/{id}/reject',
      tags,
      summary: 'Descartar uma proposta do assistente',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zAiActionDecision), ...errors },
    }),
    async (c) => c.json({ data: await rejectAction(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );
}
