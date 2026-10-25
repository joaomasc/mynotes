import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  zDate,
  zId,
  zPageQuery,
  zReviewAnswer,
  zReviewAnswerResult,
  zReviewCard,
  zReviewCardCreate,
  zReviewCardListQuery,
  zReviewCardUpdate,
  zReviewEvaluate,
  zReviewEvaluation,
  zReviewGenerate,
  zReviewGenerateResult,
  zReviewHelp,
  zReviewMemory,
  zReviewProposal,
  zReviewProposalDecision,
  zReviewProposalDecisionResult,
  zReviewQueue,
  zReviewQueueQuery,
  zReviewRecall,
  zReviewRecallCreate,
  zReviewScopeInfo,
  zReviewScopeQuery,
  zReviewSession,
  zReviewSessionCreate,
  zReviewSessionFinish,
  zReviewSessionSummary,
  zReviewStats,
  zReviewSummary,
  zReviewVariants,
  zReviewVariantsRequest,
  zTopicIdList,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as ai from './ai';
import * as cards from './cards';
import { scopeInfo } from './scope';
import * as sessions from './sessions';
import { reviewStats, reviewSummary } from './stats';

const tags = ['Revisar'];
const aiNote = 'Usa a OpenAI e conta no orçamento diário da IA.';

export function reviewRoutes(app: ApiApp) {
  /* ---------------------------------------------------------- overview -- */

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/summary',
      tags,
      summary: 'Resumo do dia: itens para revisar, novos disponíveis, sequência e perguntas esperando aprovação',
      security: secured,
      request: { query: z.object({ today: zDate }) },
      responses: { 200: ok(zReviewSummary), ...errors },
    }),
    async (c) => c.json({ data: await reviewSummary(c.env.DB, c.get('userId'), c.req.valid('query').today) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/memory',
      tags,
      summary: 'Grafo da memória: o estado do FSRS de cada cartão ativo (nota, assunto, livro)',
      description: 'Cada cartão é uma tupla [noteId, topicId, readingId, fase, estabilidade, última revisão, vencimento]; o app calcula a chance de lembrar em qualquer dia.',
      security: secured,
      responses: { 200: ok(zReviewMemory), ...errors },
    }),
    async (c) => c.json({ data: { cards: await cards.memoryCards(c.env.DB, c.get('userId')) } }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/stats',
      tags,
      summary: 'Estatísticas: memória real × desejada, previsão de 30 dias, histórico, calibração da certeza e assuntos fracos',
      security: secured,
      request: { query: z.object({ today: zDate, tzOffset: z.coerce.number().int().min(-840).max(840).default(0) }) },
      responses: { 200: ok(zReviewStats), ...errors },
    }),
    async (c) => c.json({ data: await reviewStats(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/scope',
      tags,
      summary: 'O que uma seleção de assuntos cobre (cada assunto com todos os descendentes)',
      description: 'Sem `topicIds`, considera tudo. `topicIds`: ids separados por vírgula.',
      security: secured,
      request: { query: zReviewScopeQuery },
      responses: { 200: ok(zReviewScopeInfo), ...errors },
    }),
    async (c) => c.json({ data: await scopeInfo(c.env.DB, c.get('userId'), c.req.valid('query').topicIds) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/queue',
      tags,
      summary: 'Itens de uma sessão: os que vencem e os novos do dia, um por grupo, com os assuntos misturados',
      security: secured,
      request: { query: zReviewQueueQuery },
      responses: { 200: ok(zReviewQueue), ...errors },
    }),
    async (c) => c.json({ data: await cards.buildQueue(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  /* ------------------------------------------------------------- cards -- */

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/cards',
      tags,
      summary: 'Cartões e perguntas (mais recentes primeiro)',
      security: secured,
      request: { query: zReviewCardListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zReviewCard), ...errors },
    }),
    async (c) => {
      const page = await cards.listCards(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/cards',
      tags,
      summary: 'Criar cartão (uma lacuna por número em textos com {{c1::…}}; opcionalmente também o inverso)',
      security: secured,
      request: { body: jsonBody(zReviewCardCreate) },
      responses: { 201: ok(z.array(zReviewCard), 'Criados'), ...errors },
    }),
    async (c) => c.json({ data: await cards.createCards(c.env.DB, c.get('userId'), c.req.valid('json')) }, 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/cards/{id}',
      tags,
      summary: 'Obter um cartão',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zReviewCard), ...errors },
    }),
    async (c) => c.json({ data: await cards.getCard(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/review/cards/{id}',
      tags,
      summary: 'Editar, suspender ou recomeçar um cartão',
      security: secured,
      request: { params: idParam, body: jsonBody(zReviewCardUpdate) },
      responses: { 200: ok(zReviewCard), ...errors },
    }),
    async (c) => c.json({ data: await cards.updateCard(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/review/cards/{id}',
      tags,
      summary: 'Excluir um cartão (e o histórico de respostas dele)',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await cards.deleteCard(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/cards/{id}/answer',
      tags,
      summary: 'Registrar uma resposta: o FSRS calcula quando o item volta',
      description: 'O `id` da resposta é gerado no app: repetir a mesma requisição não conta duas vezes. `reviewedAt` serve para respostas dadas sem internet.',
      security: secured,
      request: { params: idParam, body: jsonBody(zReviewAnswer) },
      responses: { 200: ok(zReviewAnswerResult), ...errors },
    }),
    async (c) => c.json({ data: await cards.answerCard(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/cards/{id}/evaluate',
      tags,
      summary: 'Corrigir com a IA a resposta a uma pergunta aberta ou dissertação (pontos-chave, só pelas notas)',
      description: `${aiNote} Não registra a resposta: o app envia a nota escolhida em /answer.`,
      security: secured,
      request: { params: idParam, body: jsonBody(zReviewEvaluate) },
      responses: { 200: ok(zReviewEvaluation), ...errors },
    }),
    async (c) => c.json({ data: await ai.evaluateAnswer(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/cards/{id}/help',
      tags,
      summary: 'Ajuda da IA para um cartão difícil: versão mais clara, cartões menores, macete',
      description: aiNote,
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zReviewHelp), ...errors },
    }),
    async (c) => c.json({ data: await ai.cardHelp(c.env, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/variants',
      tags,
      summary: 'As mesmas perguntas abertas feitas de outro jeito (mesmos pontos-chave)',
      description: `${aiNote} Só para itens já respondidos antes; não é guardado.`,
      security: secured,
      request: { body: jsonBody(zReviewVariantsRequest) },
      responses: { 200: ok(zReviewVariants), ...errors },
    }),
    async (c) => c.json({ data: await ai.questionVariants(c.env, c.get('userId'), c.req.valid('json').cardIds) }, 200),
  );

  /* -------------------------------------------------------- proposals -- */

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/generate',
      tags,
      summary: 'A IA escreve perguntas a partir das notas dos assuntos (ou de uma nota); ficam esperando aprovação',
      description: `${aiNote} Cada pergunta aponta um trecho copiado da nota; as que não batem com a nota são descartadas.`,
      security: secured,
      request: { body: jsonBody(zReviewGenerate) },
      responses: { 200: ok(zReviewGenerateResult), ...errors },
    }),
    async (c) => c.json({ data: await ai.generateQuestions(c.env, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/proposals',
      tags,
      summary: 'Perguntas da IA esperando aprovação',
      security: secured,
      request: { query: z.object({ batchId: zId.optional(), topicIds: zTopicIdList.optional() }) },
      responses: { 200: ok(z.array(zReviewProposal)), ...errors },
    }),
    async (c) => c.json({ data: await ai.listProposals(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/proposals/decide',
      tags,
      summary: 'Aprovar (com as edições) ou descartar perguntas da IA',
      security: secured,
      request: { body: jsonBody(zReviewProposalDecision) },
      responses: { 200: ok(zReviewProposalDecisionResult), ...errors },
    }),
    async (c) => c.json({ data: await ai.decideProposals(c.env.DB, c.get('userId'), c.req.valid('json')) }, 200),
  );

  /* ---------------------------------------------------------- sessions -- */

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/sessions',
      tags,
      summary: 'Sessões recentes',
      security: secured,
      request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) },
      responses: { 200: ok(z.array(zReviewSession)), ...errors },
    }),
    async (c) => c.json({ data: await sessions.listSessions(c.env.DB, c.get('userId'), c.req.valid('query').limit) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/sessions',
      tags,
      summary: 'Começar uma sessão',
      security: secured,
      request: { body: jsonBody(zReviewSessionCreate) },
      responses: { 200: ok(zReviewSession), ...errors },
    }),
    async (c) => c.json({ data: await sessions.createSession(c.env.DB, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/sessions/{id}',
      tags,
      summary: 'Resumo de uma sessão',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zReviewSessionSummary), ...errors },
    }),
    async (c) => c.json({ data: await sessions.sessionSummary(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/sessions/{id}/finish',
      tags,
      summary: 'Encerrar a sessão (a partir de 1 minuto ela também entra em Estudo)',
      security: secured,
      request: { params: idParam, body: jsonBody(zReviewSessionFinish) },
      responses: { 200: ok(zReviewSessionSummary), ...errors },
    }),
    async (c) => c.json({ data: await sessions.finishSession(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  /* ------------------------------------------------------- free recall -- */

  app.openapi(
    createRoute({
      method: 'post',
      path: '/review/recalls',
      tags,
      summary: 'Escrever tudo que lembra de um assunto: a IA compara com as notas e mostra o que faltou',
      description: aiNote,
      security: secured,
      request: { body: jsonBody(zReviewRecallCreate) },
      responses: { 200: ok(zReviewRecall), ...errors },
    }),
    async (c) => c.json({ data: await ai.createRecall(c.env, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/recalls',
      tags,
      summary: 'Recordações livres anteriores',
      security: secured,
      request: { query: z.object({ topicId: zId.optional() }) },
      responses: { 200: ok(z.array(zReviewRecall)), ...errors },
    }),
    async (c) => c.json({ data: await ai.listRecalls(c.env.DB, c.get('userId'), c.req.valid('query').topicId) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/review/recalls/{id}',
      tags,
      summary: 'Uma recordação livre com a comparação',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zReviewRecall), ...errors },
    }),
    async (c) => c.json({ data: await ai.getRecall(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );
}
