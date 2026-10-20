import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  zDate,
  zSpeechFeedback,
  zSpeechFeedbackRequest,
  zSpeechPathState,
  zSpeechPracticeCreate,
  zSpeechPracticeResult,
  zSpeechQuestionsRequest,
  zSpeechProject,
  zSpeechProjectCreate,
  zSpeechProjectUpdate,
  zPushStatus,
  zPushSubscription,
  zSpeechVariantsQuery,
  zVariantExercise,
  zPageQuery,
  zSpeechAttempt,
  zSpeechAttemptCreate,
  zSpeechAttemptSummary,
  zSpeechEvaluate,
  zSpeechListQuery,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import { fullEvaluation, serveAudio, uploadAudio } from './audio';
import { pathState, recordPractice } from './path';
import * as projects from './projects';
import { pushStatus, sendTest, subscribe, unsubscribe } from './push';
import { serveVariants } from './variants';
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
      await speech.deleteAttempt(c.env, c.get('userId'), c.req.valid('param').id);
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

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/path',
      tags,
      summary: 'Estado da trilha: lições concluídas, habilidades, XP, meta diária, sequência de dias e tema do dia',
      description: '`today` é a data no fuso do usuário (a sequência de dias conta dias locais).',
      security: secured,
      request: { query: z.object({ today: zDate }) },
      responses: { 200: ok(zSpeechPathState), ...errors },
    }),
    async (c) => c.json({ data: await pathState(c.env.DB, c.get('userId'), c.req.valid('query').today) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/practice',
      tags,
      summary: 'Registrar uma prática (lição, desafio, revisão, aquecimento ou fala)',
      description:
        'O XP é calculado pela API a partir do conteúdo da trilha; as metas dos desafios são conferidas na fala salva (`attemptId`). ' +
        'O mesmo `id` enviado de novo não conta duas vezes.',
      security: secured,
      request: { body: jsonBody(zSpeechPracticeCreate) },
      responses: { 200: ok(zSpeechPracticeResult), ...errors },
    }),
    async (c) => c.json({ data: await recordPractice(c.env.DB, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/feedback',
      tags,
      summary: 'Correção de um exercício escrito pela IA (reescrever uma frase, escrever uma parte da fala)',
      description: 'Usa a OpenAI e conta no orçamento diário da IA.',
      security: secured,
      request: { body: jsonBody(zSpeechFeedbackRequest) },
      responses: { 200: ok(zSpeechFeedback), ...errors },
    }),
    async (c) => c.json({ data: await speech.writtenFeedback(c.env, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/attempts/{id}/questions',
      tags,
      summary: 'A banca: três perguntas da IA sobre a fala',
      description: 'Uma de esclarecimento, uma que desafia um argumento e uma que pede um exemplo. Ficam guardadas com a fala; `force` pede outras. Conta no orçamento diário da IA.',
      security: secured,
      request: { params: idParam, body: jsonBody(zSpeechQuestionsRequest) },
      responses: { 200: ok(zSpeechAttempt), ...errors },
    }),
    async (c) => c.json({ data: await speech.boardQuestions(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/variants',
      tags,
      summary: 'Exercícios extras para revisar uma habilidade (escritos pela IA, cada um entregue uma vez)',
      description: 'Sem a IA disponível, devolve o que já estiver guardado (talvez nada).',
      security: secured,
      request: { query: zSpeechVariantsQuery },
      responses: { 200: ok(z.array(zVariantExercise)), ...errors },
    }),
    async (c) => c.json({ data: await serveVariants(c.env, c.get('userId'), c.req.valid('query').skill) }, 200),
  );

  /* -------------------------------------------------- kept recordings -- */

  const binary = z.string().openapi({ type: 'string', format: 'binary' });

  app.openapi(
    createRoute({
      method: 'put',
      path: '/speech/attempts/{id}/audio',
      tags,
      summary: 'Guardar a gravação da fala (WAV mono de 8 kHz, streaming para o R2)',
      description: 'Exige Content-Length. A gravação não entra no backup e é apagada com a fala.',
      security: secured,
      request: { params: idParam, body: { content: { 'audio/wav': { schema: binary } } } },
      responses: { 200: ok(zSpeechAttempt), 413: errors[400], 415: errors[400], ...errors },
    }),
    async (c) => c.json({ data: await uploadAudio(c.env, c.get('userId'), c.req.valid('param').id, c.req.raw) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/attempts/{id}/audio',
      tags,
      summary: 'Ouvir a gravação guardada',
      security: secured,
      request: { params: idParam },
      responses: { 200: { content: { 'audio/wav': { schema: binary } }, description: 'Gravação' }, ...errors },
    }),
    async (c) => serveAudio(c.env, c.get('userId'), c.req.valid('param').id),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/attempts/{id}/full-evaluation',
      tags,
      summary: 'Avaliação completa: a IA ouve a gravação (abertura e conclusão) e julga a presença e a voz',
      description: 'Exige a gravação guardada. Usa o modelo de áudio da OpenAI (AI_AUDIO_MODEL) e conta no orçamento diário.',
      security: secured,
      request: { params: idParam, body: jsonBody(zSpeechEvaluate) },
      responses: { 200: ok(zSpeechAttempt), ...errors },
    }),
    async (c) => c.json({ data: await fullEvaluation(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  /* --------------------------------------------------------- projects -- */

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/projects',
      tags,
      summary: 'Seus discursos (nível 4)',
      security: secured,
      responses: { 200: ok(z.array(zSpeechProject)), ...errors },
    }),
    async (c) => c.json({ data: await projects.listProjects(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/projects',
      tags,
      summary: 'Começar um discurso',
      security: secured,
      request: { body: jsonBody(zSpeechProjectCreate) },
      responses: { 201: ok(zSpeechProject, 'Criado'), 200: ok(zSpeechProject, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { project, created } = await projects.createProject(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: project }, 201) : c.json({ data: project }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/projects/{id}',
      tags,
      summary: 'Obter um discurso',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zSpeechProject), ...errors },
    }),
    async (c) => c.json({ data: await projects.getProject(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/speech/projects/{id}',
      tags,
      summary: 'Editar um discurso (com a versão vista, para não sobrescrever outro aparelho)',
      security: secured,
      request: { params: idParam, body: jsonBody(zSpeechProjectUpdate) },
      responses: { 200: ok(zSpeechProject), ...errors },
    }),
    async (c) => c.json({ data: await projects.updateProject(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/speech/projects/{id}',
      tags,
      summary: 'Excluir um discurso (os ensaios e a nota continuam)',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await projects.deleteProject(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  /* -------------------------------------------------------- reminders -- */

  app.openapi(
    createRoute({
      method: 'get',
      path: '/speech/push',
      tags,
      summary: 'Lembretes: chave pública do servidor e quantos navegadores estão inscritos',
      security: secured,
      responses: { 200: ok(zPushStatus), ...errors },
    }),
    async (c) => c.json({ data: await pushStatus(c.env, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/push/subscriptions',
      tags,
      summary: 'Inscrever este navegador nos lembretes',
      security: secured,
      request: { body: jsonBody(zPushSubscription) },
      responses: { 200: ok(zPushStatus), ...errors },
    }),
    async (c) => c.json({ data: await subscribe(c.env, c.get('userId'), c.req.valid('json')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/push/unsubscribe',
      tags,
      summary: 'Cancelar os lembretes deste navegador',
      security: secured,
      request: { body: jsonBody(z.object({ endpoint: z.string().max(2000) })) },
      responses: { 200: ok(zPushStatus), ...errors },
    }),
    async (c) => c.json({ data: await unsubscribe(c.env, c.get('userId'), c.req.valid('json').endpoint) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/speech/push/test',
      tags,
      summary: 'Enviar um lembrete de teste para os seus navegadores',
      security: secured,
      responses: { 200: ok(z.object({ sent: z.number().int() })), ...errors },
    }),
    async (c) => c.json({ data: await sendTest(c.env, c.get('userId')) }, 200),
  );
}
