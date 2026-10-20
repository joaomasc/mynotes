import type { ApiErrorCode } from '@mynotes/shared';
import { ApiError, NetworkError, request } from './client';

/**
 * POST that answers with server-sent events (fetch, so the bearer token and
 * the 401 refresh work like any request). Events other than `done` and
 * `error` go to `onEvent`; `done` resolves with its data, `error` rejects with
 * an ApiError. Errors before the stream starts are ordinary HTTP errors.
 */
export async function postStream<T>(
  path: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  const res = await request('POST', path, { body, retries: 0, track: false, signal, headers: { Accept: 'text/event-stream' } });
  if (!res.body) throw new NetworkError('O servidor não enviou a resposta.');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let result: { value: T } | null = null;
  let failure: ApiError | null = null;

  const handle = (block: string) => {
    const event = /^event: ?(.*)$/m.exec(block)?.[1]?.trim() ?? 'message';
    const raw = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (event === 'done') result = { value: data as T };
    else if (event === 'error') {
      const e = data as { code?: ApiErrorCode; message?: string; status?: number };
      failure = new ApiError(e.status ?? 500, e.code ?? 'internal_error', e.message ?? 'Erro interno. Tente novamente em instantes.');
    } else onEvent(event, data);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError('A conexão caiu durante a resposta. Tente de novo: o que já foi feito não se repete.');
  }
  if (failure) throw failure;
  if (!result) throw new NetworkError('A resposta foi interrompida. Tente de novo: o que já foi feito não se repete.');
  return (result as { value: T }).value;
}
