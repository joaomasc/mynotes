import { createRoute, z } from '@hono/zod-openapi';
import {
  PLAN_STATUSES,
  zId,
  zPlan,
  zPlanCreate,
  zPlanDetail,
  zPlanItem,
  zPlanItemCreate,
  zPlanItemUpdate,
  zPlanUpdate,
  zUpcomingGoal,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import * as plans from './service';

const tags = ['Planos de estudo'];
const itemParams = z.object({ id: zId, itemId: zId });

export function planRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/plans',
      tags,
      summary: 'Listar planos com progresso',
      security: secured,
      request: { query: z.object({ status: z.enum(PLAN_STATUSES).optional() }) },
      responses: { 200: ok(z.array(zPlan)), ...errors },
    }),
    async (c) => c.json({ data: await plans.listPlans(c.env.DB, c.get('userId'), c.req.valid('query').status) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/plans/upcoming',
      tags,
      summary: 'Próximas etapas com prazo',
      security: secured,
      responses: { 200: ok(z.array(zUpcomingGoal)), ...errors },
    }),
    async (c) => c.json({ data: await plans.upcomingGoals(c.env.DB, c.get('userId'), 50) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/plans',
      tags,
      summary: 'Criar plano',
      security: secured,
      request: { body: jsonBody(zPlanCreate) },
      responses: { 201: ok(zPlan, 'Criado'), 200: ok(zPlan, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { plan, created } = await plans.createPlan(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: plan }, 201) : c.json({ data: plan }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/plans/{id}',
      tags,
      summary: 'Plano com etapas',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zPlanDetail), ...errors },
    }),
    async (c) => c.json({ data: await plans.getPlan(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/plans/{id}',
      tags,
      summary: 'Editar plano',
      security: secured,
      request: { params: idParam, body: jsonBody(zPlanUpdate) },
      responses: { 200: ok(zPlan), ...errors },
    }),
    async (c) => {
      const plan = await plans.updatePlan(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: plan }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/plans/{id}',
      tags,
      summary: 'Excluir plano e suas etapas',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await plans.deletePlan(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/plans/{id}/items',
      tags,
      summary: 'Adicionar etapa/meta ao plano',
      security: secured,
      request: { params: idParam, body: jsonBody(zPlanItemCreate) },
      responses: { 201: ok(zPlanItem, 'Criada'), ...errors },
    }),
    async (c) => {
      const item = await plans.createPlanItem(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: item }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/plans/{id}/items/{itemId}',
      tags,
      summary: 'Editar, concluir ou reordenar etapa',
      security: secured,
      request: { params: itemParams, body: jsonBody(zPlanItemUpdate) },
      responses: { 200: ok(zPlanItem), ...errors },
    }),
    async (c) => {
      const { id, itemId } = c.req.valid('param');
      const item = await plans.updatePlanItem(c.env.DB, c.get('userId'), id, itemId, c.req.valid('json'));
      return c.json({ data: item }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/plans/{id}/items/{itemId}',
      tags,
      summary: 'Remover etapa',
      security: secured,
      request: { params: itemParams },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      const { id, itemId } = c.req.valid('param');
      await plans.deletePlanItem(c.env.DB, c.get('userId'), id, itemId);
      return c.body(null, 204);
    },
  );
}
