import { createRoute, z } from '@hono/zod-openapi';
import {
  BACKUP_TABLE_ORDER,
  zBackupManifest,
  zExportPage,
  zId,
  zImportChunk,
  zImportCommit,
  zImportJobCreate,
  zImportResult,
  type BackupTableName,
} from '@mynotes/shared';
import { API_VERSION, type ApiApp } from '../../app';
import { errors, idParam, jsonBody, noContent, ok, secured } from '../../lib/openapi';
import * as backup from './service';

const tags = ['Backup'];

export function backupRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/backup/manifest',
      tags,
      summary: 'Manifesto da exportação (contagens e documentos com arquivo)',
      security: secured,
      responses: { 200: ok(zBackupManifest), ...errors },
    }),
    async (c) => c.json({ data: await backup.exportManifest(c.env.DB, c.get('userId'), API_VERSION) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/backup/export/{table}',
      tags,
      summary: 'Exportar uma tabela, paginada',
      security: secured,
      request: {
        params: z.object({ table: z.enum(BACKUP_TABLE_ORDER as [BackupTableName, ...BackupTableName[]]) }),
        query: z.object({ cursor: z.string().regex(/^\d+$/).optional() }),
      },
      responses: { 200: ok(zExportPage), ...errors },
    }),
    async (c) => {
      const { table } = c.req.valid('param');
      const page = await backup.exportTablePage(c.env.DB, c.get('userId'), table, c.req.valid('query').cursor);
      return c.json({ data: { table, rows: page.rows, nextCursor: page.nextCursor } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/backup/imports',
      tags,
      summary: 'Iniciar importação (merge ou replace)',
      security: secured,
      request: { body: jsonBody(zImportJobCreate) },
      responses: { 201: ok(z.object({ jobId: zId }), 'Criada'), ...errors },
    }),
    async (c) => {
      const { mode, manifest } = c.req.valid('json');
      return c.json({ data: await backup.createImportJob(c.env.DB, c.get('userId'), mode, manifest) }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/backup/imports/{id}/chunks',
      tags,
      summary: 'Enviar uma parte validada dos dados',
      security: secured,
      request: { params: idParam, body: jsonBody(zImportChunk) },
      responses: { 200: ok(z.object({ accepted: z.number().int() })), ...errors },
    }),
    async (c) => {
      const result = await backup.stageChunk(c.env.DB, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: result }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/backup/imports/{id}/commit',
      tags,
      summary: 'Aplicar a importação de forma atômica',
      security: secured,
      request: { params: idParam, body: jsonBody(zImportCommit) },
      responses: { 200: ok(zImportResult), ...errors },
    }),
    async (c) => {
      const result = await backup.commitImport(c.env, c.get('userId'), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ data: result }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/backup/imports/{id}',
      tags,
      summary: 'Cancelar importação não aplicada',
      security: secured,
      request: { params: idParam },
      responses: { 204: noContent, ...errors },
    }),
    async (c) => {
      await backup.cancelImport(c.env.DB, c.get('userId'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
