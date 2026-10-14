import { z } from '@hono/zod-openapi';
import { zApiError, zId, zPageMeta } from '@mynotes/shared';

/** Request body helper (JSON, required). */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true as const,
});

/** `{ data: T }` success response. */
export const ok = <T extends z.ZodType>(schema: T, description = 'Sucesso') => ({
  content: { 'application/json': { schema: z.object({ data: schema }) } },
  description,
});

/** `{ data: T[], meta: { nextCursor } }` paginated response. */
export const okPage = <T extends z.ZodType>(schema: T, description = 'Página de resultados') => ({
  content: { 'application/json': { schema: z.object({ data: z.array(schema), meta: zPageMeta }) } },
  description,
});

export const noContent = { description: 'Sem conteúdo' };

const err = (description: string) => ({
  content: { 'application/json': { schema: zApiError } },
  description,
});

export const errors = {
  400: err('Requisição inválida'),
  401: err('Não autenticado'),
  404: err('Não encontrado'),
  409: err('Conflito de versão ou estado'),
  429: err('Limite de requisições'),
  500: err('Erro interno'),
};

export const publicErrors = {
  400: errors[400],
  429: errors[429],
  500: errors[500],
};

export const secured = [{ bearerAuth: [] }];

export const idParam = z.object({ id: zId });
