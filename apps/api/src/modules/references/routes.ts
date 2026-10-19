import { createRoute, z } from '@hono/zod-openapi';
import {
  zBrokenReference,
  zReference,
  zReferenceResolveQuery,
  zReferenceSuggestQuery,
  zTopicContext,
  zViewLayout,
  zViewLayoutPut,
} from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, idParam, jsonBody, ok, secured } from '../../lib/openapi';
import * as refs from './service';

const keyParam = z.object({ key: z.string().max(200) });

export function referenceRoutes(app: ApiApp) {
  const tags = ['Referências'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/references/suggest',
      tags,
      summary: 'Itens para referenciar com “/” no editor (assuntos, notas, livros, páginas anotadas…)',
      security: secured,
      request: { query: zReferenceSuggestQuery },
      responses: { 200: ok(z.array(zReference)), ...errors },
    }),
    async (c) => c.json({ data: await refs.suggest(c.env.DB, c.get('userId'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/references/broken',
      tags,
      summary: 'Referências quebradas em todas as notas (alvo excluído ou na lixeira)',
      security: secured,
      responses: { 200: ok(z.array(zBrokenReference)), ...errors },
    }),
    async (c) => c.json({ data: await refs.brokenReferences(c.env.DB, c.get('userId')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/references/resolve',
      tags,
      summary: 'Título atual e existência de itens referenciados (detecta referências quebradas)',
      security: secured,
      request: { query: zReferenceResolveQuery },
      responses: { 200: ok(z.array(zReference)), ...errors },
    }),
    async (c) => c.json({ data: await refs.resolve(c.env.DB, c.get('userId'), c.req.valid('query').refs) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/topics/{id}/context',
      tags: ['Assuntos'],
      summary: 'Livros, anotações, menções, tags e tempo de estudo ligados ao assunto',
      security: secured,
      request: { params: idParam },
      responses: { 200: ok(zTopicContext), ...errors },
    }),
    async (c) => c.json({ data: await refs.topicContext(c.env.DB, c.get('userId'), c.req.valid('param').id) }, 200),
  );

  const lt = ['Visualizações'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/layouts/{key}',
      tags: lt,
      summary: 'Disposição visual salva de uma visualização gerada (ex.: mapa mental de um assunto)',
      security: secured,
      request: { params: keyParam },
      responses: { 200: ok(zViewLayout.nullable()), ...errors },
    }),
    async (c) => c.json({ data: await refs.getLayout(c.env.DB, c.get('userId'), c.req.valid('param').key) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/layouts/{key}',
      tags: lt,
      summary: 'Salvar posições e ramos recolhidos (não altera hierarquia nem relações)',
      security: secured,
      request: { params: keyParam, body: jsonBody(zViewLayoutPut) },
      responses: { 200: ok(zViewLayout), ...errors },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const layout = await refs.putLayout(c.env.DB, c.get('userId'), c.req.valid('param').key, body.data, body.baseVersion);
      return c.json({ data: layout }, 200);
    },
  );
}
