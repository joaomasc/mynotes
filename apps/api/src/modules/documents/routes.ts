import { createRoute, z } from '@hono/zod-openapi';
import {
  API_PREFIX,
  UPLOAD_MAX_PARTS,
  zDocument,
  zDocumentCreate,
  zDocumentListQuery,
  zDocumentUpdate,
  zId,
  zPageQuery,
  zSignedLink,
  zUploadAbort,
  zUploadComplete,
  zUploadPartQuery,
  zUploadStart,
  zUploadedPart,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { notFound } from '../../lib/errors';
import { errors, idParam, jsonBody, noContent, ok, okPage, secured } from '../../lib/openapi';
import * as docs from './service';

const tags = ['Documentos'];
const binary = z.string().openapi({ type: 'string', format: 'binary' });

export function documentRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/documents',
      tags,
      summary: 'Listar documentos com filtros e busca',
      security: secured,
      request: { query: zDocumentListQuery.extend(zPageQuery.shape) },
      responses: { 200: okPage(zDocument), ...errors },
    }),
    async (c) => {
      const page = await docs.listDocuments(c.env.DB, c.get('userId'), c.req.valid('query'));
      return c.json({ data: page.items, meta: { nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/documents',
      tags,
      summary: 'Registrar documento (envie o arquivo em seguida em /content)',
      security: secured,
      request: { body: jsonBody(zDocumentCreate) },
      responses: { 201: ok(zDocument, 'Criado'), 200: ok(zDocument, 'Já existia'), ...errors },
    }),
    async (c) => {
      const { document, created } = await docs.createDocument(c.env.DB, c.get('userId'), c.req.valid('json'));
      return created ? c.json({ data: document }, 201) : c.json({ data: document }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/documents/{id}',
      tags,
      summary: 'Metadados do documento',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zDocument), ...errors },
    }),
    async (c) => {
      const row = await docs.getDocumentRow(c.env.DB, c.get('userId'), c.req.valid('param').id);
      if (!row) throw notFound('Documento');
      return c.json({ data: docs.toDocument(row) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/documents/{id}',
      tags,
      summary: 'Editar metadados do documento',
      security: secured,
      request: { params: idParam, body: jsonBody(zDocumentUpdate) },
      responses: { 200: ok(zDocument), ...errors },
    }),
    async (c) => {
      const doc = await docs.updateDocument(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: doc }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/documents/{id}',
      tags,
      summary: 'Enviar documento para a lixeira',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await docs.trashDocument(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/documents/{id}/content',
      tags,
      summary: 'Enviar o arquivo binário (streaming para o R2)',
      description: 'Exige Content-Length. O tipo é validado pela assinatura do arquivo.',
      security: secured,
      request: { params: idParam, body: { content: { 'application/octet-stream': { schema: binary } } } },
      responses: { 200: ok(zDocument), 413: errors[400], 415: errors[400], ...errors },
    }),
    async (c) => {
      const doc = await docs.uploadContent(c.env, c.get('userId'), c.req.valid('param').id, c.req.raw);
      return c.json({ data: doc }, 200);
    },
  );

  /* Files larger than one request: start, send parts, complete (or abort). */
  app.openapi(
    createRoute({
      method: 'post',
      path: '/documents/{id}/uploads',
      tags,
      summary: 'Iniciar envio em partes (arquivos grandes)',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zUploadStart), ...errors },
    }),
    async (c) => c.json({ data: await docs.startMultipartUpload(c.env, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/documents/{id}/uploads/parts/{partNumber}',
      tags,
      summary: 'Enviar uma parte (streaming para o R2)',
      description: 'Exige Content-Length. Todas as partes, exceto a última, devem ter o tamanho informado no início.',
      security: secured,
      request: {
        params: z.object({ id: zId, partNumber: z.coerce.number().int().min(1).max(UPLOAD_MAX_PARTS) }),
        query: zUploadPartQuery,
        body: { content: { 'application/octet-stream': { schema: binary } } },
      },
      responses: { 200: ok(zUploadedPart), 413: errors[400], ...errors },
    }),
    async (c) => {
      const { id, partNumber } = c.req.valid('param');
      const part = await docs.uploadPart(c.env, c.get('userId'), id, partNumber, c.req.valid('query').token, c.req.raw);
      return c.json({ data: part }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/documents/{id}/uploads/complete',
      tags,
      summary: 'Concluir envio em partes (valida o arquivo e o anexa ao documento)',
      security: secured,
      request: { params: idParam, body: jsonBody(zUploadComplete) },
      responses: { 200: ok(zDocument), 415: errors[400], ...errors },
    }),
    async (c) => {
      const { token, parts } = c.req.valid('json');
      return c.json({ data: await docs.completeMultipartUpload(c.env, c.get('userId'), c.req.valid('param').id, token, parts) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/documents/{id}/uploads/abort',
      tags,
      summary: 'Cancelar envio em partes',
      security: secured,
      request: { params: idParam, body: jsonBody(zUploadAbort) },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await docs.abortMultipartUpload(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json').token);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/documents/{id}/content',
      tags,
      summary: 'Baixar o arquivo (autenticado, com suporte a Range)',
      security: secured,
      request: { params: idParam, query: z.object({ download: z.enum(['0', '1']).optional() }) },
      responses: {
        200: { content: { 'application/octet-stream': { schema: binary } }, description: 'Arquivo' },
        206: { description: 'Conteúdo parcial' },
        ...errors,
      },
    }),
    async (c) => {
      const row = await docs.getDocumentRow(c.env.DB, c.get('userId'), c.req.valid('param').id);
      if (!row) throw notFound('Documento');
      return docs.serveContent(c.env, row, c.req.raw, c.req.valid('query').download === '1' ? 'attachment' : 'inline');
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/documents/{id}/link',
      tags,
      summary: 'Gerar link assinado de curta duração (5 min) para abrir/baixar',
      security: secured,
      request: { params: idParam, body: jsonBody(z.object({ download: z.boolean().default(false) })) },
      responses: { 200: ok(zSignedLink), ...errors },
    }),
    async (c) => {
      const base = `${new URL(c.req.url).origin}${API_PREFIX}`;
      const link = await docs.createSignedLink(
        c.env,
        c.get('userId'),
        c.req.valid('param').id,
        base,
        c.req.valid('json').download,
      );
      return c.json({ data: link }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/files/{id}',
      tags,
      summary: 'Acesso por link assinado (público, expira em minutos)',
      request: {
        params: z.object({ id: zId }),
        query: z.object({ exp: z.string().max(20), dl: z.enum(['0', '1']).optional(), sig: z.string().max(100) }),
      },
      responses: {
        200: { content: { 'application/octet-stream': { schema: binary } }, description: 'Arquivo' },
        403: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const query = c.req.valid('query');
      const row = await docs.verifySignedLink(c.env, id, query);
      return docs.serveContent(c.env, row, c.req.raw, query.dl === '1' ? 'attachment' : 'inline');
    },
  );
}
