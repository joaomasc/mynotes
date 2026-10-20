import { ApiError } from '../../lib/errors';
import type { AiConfig, TokenUsage } from './config';

/**
 * Minimal client for the OpenAI Responses API (POST /v1/responses).
 *
 * A hand-written wrapper instead of the SDK: the Worker uses one endpoint, and
 * on the Workers Free plan (10 ms of CPU per request) a large SDK bundle costs
 * startup time on every cold start. It also keeps retries explicit — a hidden
 * retry of a request that was already processed would be billed twice.
 */

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Items sent back to the model are passed through unchanged (reasoning items included). */
export type InputItem = Record<string, unknown>;

export interface FunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
}

export interface UrlCitation {
  type: 'url_citation';
  url: string;
  title?: string;
}

export interface MessageItem {
  type: 'message';
  role: 'assistant';
  content: { type: string; text?: string; refusal?: string; annotations?: ({ type: string } & Partial<UrlCitation>)[] }[];
}

/** A search the hosted web_search tool ran (on OpenAI's side, billed per call). */
export interface WebSearchCallItem {
  type: 'web_search_call';
  id: string;
  status: string;
  action?: { type?: string; query?: string; queries?: string[]; url?: string };
}

export type OutputItem = FunctionCallItem | MessageItem | WebSearchCallItem | ({ type: string } & Record<string, unknown>);

export interface ResponsesResult {
  id: string;
  status: 'completed' | 'incomplete' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | string;
  output: OutputItem[];
  usage: TokenUsage;
  incompleteReason: string | null;
}

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

/** OpenAI's hosted web search: it runs on OpenAI's side, not in the Worker. */
export interface WebSearchTool {
  type: 'web_search';
  search_context_size: 'low' | 'medium' | 'high';
  user_location: { type: 'approximate'; country: string; timezone: string };
}

export interface ResponsesRequest {
  instructions: string;
  input: InputItem[];
  tools: (FunctionTool | WebSearchTool)[];
  toolChoice: 'auto' | 'none';
  /** Ceiling of hosted tool calls (web searches) in this response; function calls do not count. */
  maxHostedToolCalls?: number;
  /** Overrides the configured timeout (turns with web search take longer). */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readUsage(u: unknown): TokenUsage {
  const usage = (u ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** Error details from OpenAI never contain the key, but redact anything that looks like one. */
const redact = (text: string) => text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…').slice(0, 300);

function logFailure(kind: string, status: number, code: string, message: string) {
  console.error(JSON.stringify({ level: 'error', msg: 'openai request failed', kind, status, code, error: redact(message) }));
}

/** Maps an OpenAI failure to a user-facing error (Portuguese, no internals). */
function toApiError(status: number, body: { error?: { code?: string; type?: string; message?: string } } | null, model: string): ApiError {
  const code = body?.error?.code ?? body?.error?.type ?? '';
  const message = body?.error?.message ?? '';
  logFailure('http', status, code, message);
  if (status === 401 || status === 403) {
    return new ApiError(
      'service_unavailable',
      'A OpenAI recusou a chave configurada (inválida, revogada ou sem permissão). Verifique OPENAI_API_KEY no servidor.',
    );
  }
  if (status === 404 || code === 'model_not_found') {
    return new ApiError('service_unavailable', `O modelo “${model}” não está disponível para esta chave. Ajuste OPENAI_MODEL.`);
  }
  if (status === 429 && /insufficient_quota|billing|quota/i.test(`${code} ${message}`)) {
    return new ApiError(
      'service_unavailable',
      'A conta da OpenAI está sem crédito ou atingiu o limite de gastos. Confira Billing e Limits no painel da OpenAI.',
    );
  }
  if (status === 429) {
    return new ApiError('rate_limited', 'A OpenAI limitou as requisições por alguns instantes. Tente de novo em seguida.', undefined, {
      'Retry-After': '20',
    });
  }
  if (status >= 500) return new ApiError('service_unavailable', 'A OpenAI está indisponível no momento. Tente de novo em instantes.');
  return new ApiError('internal_error', 'A OpenAI recusou a requisição do assistente. Tente reformular a mensagem.');
}

/**
 * Creates one model response. Data is not stored at OpenAI (`store: false`);
 * reasoning items come back with encrypted content and are passed back
 * unchanged within the same turn.
 *
 * Retries once, only when the request certainly did not run: 5xx answers and
 * rate limits (not quota errors) before any output. Timeouts are not retried.
 */
export async function createResponse(cfg: AiConfig & { apiKey: string }, req: ResponsesRequest): Promise<ResponsesResult> {
  const body = requestBody(cfg, req, false);

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? cfg.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logFailure(timeout ? 'timeout' : 'network', 0, '', err instanceof Error ? err.message : String(err));
      throw new ApiError(
        'service_unavailable',
        timeout ? 'A OpenAI demorou demais para responder. Tente de novo.' : 'Não foi possível conectar à OpenAI agora.',
      );
    }
    if (res.ok) return toResult((await res.json()) as Parameters<typeof toResult>[0]);
    const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; type?: string; message?: string } } | null;
    const quota = /insufficient_quota|billing/i.test(`${errBody?.error?.code ?? ''} ${errBody?.error?.type ?? ''}`);
    const retryable = (res.status >= 500 || (res.status === 429 && !quota)) && attempt === 0;
    if (retryable) {
      const after = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(after) && after > 0 && after <= 3 ? after * 1000 : 800);
      continue;
    }
    throw toApiError(res.status, errBody, cfg.model);
  }
}

function requestBody(cfg: AiConfig, req: ResponsesRequest, stream: boolean): string {
  return JSON.stringify({
    model: cfg.model,
    instructions: req.instructions,
    input: req.input,
    tools: req.tools,
    tool_choice: req.toolChoice,
    parallel_tool_calls: true,
    ...(req.maxHostedToolCalls !== undefined ? { max_tool_calls: req.maxHostedToolCalls } : {}),
    max_output_tokens: cfg.maxOutputTokens,
    ...(cfg.reasoningEffort ? { reasoning: { effort: cfg.reasoningEffort } } : {}),
    store: false,
    ...(stream ? { stream: true } : {}),
  });
}

function toResult(data: {
  id?: string;
  status?: string;
  output?: OutputItem[];
  usage?: unknown;
  incomplete_details?: { reason?: string } | null;
}): ResponsesResult {
  return {
    id: data.id ?? '',
    status: data.status ?? 'completed',
    output: Array.isArray(data.output) ? data.output : [],
    usage: readUsage(data.usage),
    incompleteReason: data.incomplete_details?.reason ?? null,
  };
}

/** Error event sent inside a stream (after HTTP 200). */
function streamError(code: string, message: string): ApiError {
  logFailure('stream', 0, code, message);
  if (/insufficient_quota|billing/i.test(code)) {
    return new ApiError('service_unavailable', 'A conta da OpenAI está sem crédito ou atingiu o limite de gastos.');
  }
  if (/rate_limit/i.test(code)) return new ApiError('rate_limited', 'A OpenAI limitou as requisições por alguns instantes. Tente de novo em seguida.');
  return new ApiError('service_unavailable', 'A OpenAI interrompeu a resposta. Tente de novo.');
}

/**
 * Same as createResponse, streamed: `onText` receives the answer as it is
 * written. The final `response.completed` event carries the whole response
 * (output items and usage), so the turn logic is the same in both modes.
 */
export async function createResponseStream(
  cfg: AiConfig & { apiKey: string },
  req: ResponsesRequest,
  onText: (delta: string) => void,
  onWebSearch: () => void = () => undefined,
): Promise<ResponsesResult> {
  const body = requestBody(cfg, req, true);
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? cfg.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logFailure(timeout ? 'timeout' : 'network', 0, '', err instanceof Error ? err.message : String(err));
      throw new ApiError('service_unavailable', timeout ? 'A OpenAI demorou demais para responder. Tente de novo.' : 'Não foi possível conectar à OpenAI agora.');
    }
    if (res.ok) break;
    const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; type?: string; message?: string } } | null;
    const quota = /insufficient_quota|billing/i.test(`${errBody?.error?.code ?? ''} ${errBody?.error?.type ?? ''}`);
    if ((res.status >= 500 || (res.status === 429 && !quota)) && attempt === 0) {
      await sleep(800);
      continue;
    }
    throw toApiError(res.status, errBody, cfg.model);
  }

  let final: Parameters<typeof toResult>[0] | null = null;
  let buffer = '';
  const handle = (block: string) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let event: { type?: string; delta?: string; response?: Parameters<typeof toResult>[0]; code?: string; message?: string; error?: { code?: string; message?: string } };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') onText(event.delta);
    else if (event.type === 'response.web_search_call.searching') onWebSearch();
    else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') final = event.response ?? null;
    else if (event.type === 'error') throw streamError(event.code ?? event.error?.code ?? '', event.message ?? event.error?.message ?? '');
  };
  try {
    const reader = res!.body!.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logFailure('stream', 0, '', err instanceof Error ? err.message : String(err));
    throw new ApiError('service_unavailable', 'A conexão com a OpenAI caiu no meio da resposta. Tente de novo.');
  }
  if (!final) throw new ApiError('service_unavailable', 'A OpenAI encerrou a resposta antes do fim. Tente de novo.');
  const result = toResult(final);
  if (result.status === 'failed') throw streamError('response_failed', 'response.failed');
  return result;
}

export function functionCalls(output: OutputItem[]): FunctionCallItem[] {
  return output.filter((item): item is FunctionCallItem => item.type === 'function_call');
}

export function webSearchCalls(output: OutputItem[]): WebSearchCallItem[] {
  return output.filter((item): item is WebSearchCallItem => item.type === 'web_search_call');
}

/** Pages the answer cites, from the API's url_citation annotations (http/https only, each URL once). */
export function urlCitations(output: OutputItem[]): { url: string; title: string }[] {
  const found = new Map<string, string>();
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const part of (item as MessageItem).content ?? []) {
      for (const a of part.annotations ?? []) {
        if (a.type !== 'url_citation' || typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) continue;
        if (!found.has(a.url)) found.set(a.url, typeof a.title === 'string' ? a.title : '');
      }
    }
  }
  return [...found].map(([url, title]) => ({ url, title }));
}

/** Visible text of the response (refusals included, as text). */
export function outputText(output: OutputItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const part of (item as MessageItem).content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
      else if (part.type === 'refusal' && typeof part.refusal === 'string') parts.push(part.refusal);
    }
  }
  return parts.join('\n').trim();
}
