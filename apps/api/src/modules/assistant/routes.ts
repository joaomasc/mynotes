import { createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import {
  zAiActionDecision,
  zAiChatRequest,
  zAiChatResponse,
  zAiConversation,
  zAiConversationSummary,
  zAiIndexStatus,
  zAiIndexSync,
  zAiIndexSyncRequest,
  zAiStatus,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { ApiError } from '../../lib/errors';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import { confirmAction, rejectAction } from './actions';
import { indexStatus, resetIndex, syncKnowledgeIndex } from './knowledge-index';
import { aiStatus, chat, deleteConversation, getConversation, listConversations, prepareTurn, runTurn } from './service';

/** Error sent inside a stream (after the 200 response started): safe messages only. */
function errorEvent(err: unknown) {
  if (err instanceof ApiError) return { code: err.code, message: err.message, status: err.status };
  console.error(JSON.stringify({ level: 'error', msg: 'ai stream failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }));
  return { code: 'internal_error', message: 'Erro interno. Tente novamente em instantes.', status: 500 };
}

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
      method: 'post',
      path: '/ai/chat/stream',
      tags,
      summary: 'Enviar uma mensagem ao assistente, com a resposta em tempo real (SSE)',
      description:
        'Mesmo turno de `POST /ai/chat`, como `text/event-stream`: eventos `status` ({label}), `tool` (atividade), `delta` ({text}), ' +
        '`reset` (descartar o texto parcial), `done` (o mesmo corpo de /ai/chat) e `error` ({code, message}). ' +
        'Limites, chave ausente e mensagens repetidas respondem antes do stream, como erros HTTP comuns.',
      security: secured,
      request: { body: jsonBody(zAiChatRequest) },
      responses: {
        200: { description: 'Fluxo de eventos', content: { 'text/event-stream': { schema: z.string() } } },
        ...errors,
        ...unavailable,
      },
    }),
    async (c) => {
      const prepared = await prepareTurn(c.env, c.get('userId'), c.req.valid('json'));
      return streamSSE(c, async (stream) => {
        const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
        if (prepared.kind === 'replay') {
          await send('done', prepared.response);
          return;
        }
        const turn = runTurn(prepared, (e) => void send(e.type, e.data), { stream: true });
        // The turn finishes and is saved even if the browser disconnects.
        c.executionCtx.waitUntil(turn.then(() => undefined, () => undefined));
        try {
          await send('done', await turn);
        } catch (err) {
          await send('error', errorEvent(err));
        }
      }) as unknown as never;
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/index',
      tags,
      summary: 'Estado do índice semântico (quantos itens já estão vetorizados)',
      security: secured,
      responses: { 200: ok(zAiIndexStatus), ...errors },
    }),
    async (c) => c.json({ data: await indexStatus(c.env, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/index/sync',
      tags,
      summary: 'Indexar agora o que mudou (um lote por chamada)',
      description: '`more: true` indica que ainda há itens; chame de novo. `reset: true` refaz o índice inteiro aos poucos.',
      security: secured,
      request: { body: jsonBody(zAiIndexSyncRequest) },
      responses: { 200: ok(zAiIndexSync), ...errors, ...unavailable },
    }),
    async (c) => {
      const userId = c.get('userId');
      const body = c.req.valid('json');
      if (body.reset) await resetIndex(c.env, userId);
      try {
        // Edits of the last seconds count too: the user asked for it now.
        const result = await syncKnowledgeIndex(c.env, userId, { settleSeconds: body.settle ? 120 : 0 });
        return c.json({ data: { ...result, ...(await indexStatus(c.env, userId)) } }, 200);
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', msg: 'knowledge index sync failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }));
        throw new ApiError('service_unavailable', 'O índice semântico está indisponível agora (Workers AI ou Vectorize). A busca por palavras continua funcionando.');
      }
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
