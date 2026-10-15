import { createRoute } from '@hono/zod-openapi';
import { zTranscription, zTranscriptionCreate } from '@mynotes/shared';
import type { ApiApp } from '../../app';
import { errors, jsonBody, ok, secured } from '../../lib/openapi';
import { transcribe } from './service';

export function transcriptionRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/transcriptions',
      tags: ['Ditado'],
      summary: 'Transcrever um trecho de áudio ditado (português do Brasil)',
      description:
        'Recebe um trecho WAV em base64 (até 40 s) e devolve o texto. O áudio não é guardado. ' +
        '`prompt` é o texto escrito logo antes do ponto de inserção e ajuda no vocabulário.',
      security: secured,
      request: { body: jsonBody(zTranscriptionCreate) },
      responses: { 200: ok(zTranscription), 415: errors[400], ...errors },
    }),
    async (c) => c.json({ data: await transcribe(c.env.AI, c.req.valid('json')) }, 200),
  );
}
