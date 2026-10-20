import { expect, vi } from 'vitest';

/*
 * Scripted OpenAI Responses API: each step answers one request to
 * /v1/responses, in order, as JSON or as a stream (SSE). Request bodies are
 * kept for assertions. Tests never reach OpenAI.
 */

export const FAKE_KEY = 'sk-test-fake-key-never-sent';
export const usage = {
  input_tokens: 1200,
  input_tokens_details: { cached_tokens: 200 },
  output_tokens: 80,
  output_tokens_details: { reasoning_tokens: 20 },
};

export type Step = (body: any) => object | Response;

const message = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const calls = (list: [name: string, args: unknown][]) => [
  { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [] },
  ...list.map(([name, args], i) => ({
    type: 'function_call',
    id: `fc_${i}`,
    call_id: `call_${Math.random().toString(36).slice(2)}`,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  })),
];

/** A final text answer (JSON, or SSE when the request asked for a stream). */
export const answer =
  (text: string): Step =>
  (body) => {
    const response = { id: 'resp_text', status: 'completed', output: [message(text)], usage };
    if (!body.stream) return response;
    // Streamed in two pieces, like the real API.
    const half = Math.ceil(text.length / 2);
    return sse([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_text.delta', delta: text.slice(0, half) },
      { type: 'response.output_text.delta', delta: text.slice(half) },
      { type: 'response.completed', response },
    ]);
  };

export const callTools =
  (...list: [name: string, args: unknown][]): Step =>
  (body) => {
    const response = { id: 'resp_tools', status: 'completed', output: calls(list), usage };
    return body.stream ? sse([{ type: 'response.completed', response }]) : response;
  };

/** Searches the hosted web_search tool ran within a response (on OpenAI's side). */
const searchCalls = (queries: string[]) =>
  queries.map((query, i) => ({ type: 'web_search_call', id: `ws_${i}`, status: 'completed', action: { type: 'search', query } }));

/** The model searched the web and answered, citing pages with url_citation annotations. */
export const webAnswer =
  (text: string, queries: string[], pages: { url: string; title: string }[]): Step =>
  (body) => {
    const annotations = pages.map((p) => ({ type: 'url_citation', url: p.url, title: p.title, start_index: 0, end_index: text.length }));
    const output = [...searchCalls(queries), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] }];
    const response = { id: 'resp_web', status: 'completed', output, usage };
    if (!body.stream) return response;
    return sse([
      ...queries.map((_, i) => ({ type: 'response.web_search_call.searching', item_id: `ws_${i}` })),
      { type: 'response.output_text.delta', delta: text },
      { type: 'response.completed', response },
    ]);
  };

/** The model searched the web, then asked for MyNotes tools. */
export const searchThenCall =
  (queries: string[], ...list: [name: string, args: unknown][]): Step =>
  (body) => {
    const response = { id: 'resp_web_tools', status: 'completed', output: [...searchCalls(queries), ...calls(list)], usage };
    return body.stream ? sse([{ type: 'response.completed', response }]) : response;
  };

export function sse(events: ({ type: string } & Record<string, unknown>)[]): Response {
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export function mockOpenAI(steps: Step[]) {
  const bodies: any[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.openai.com/v1/responses')) throw new Error(`unexpected fetch: ${url}`);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const step = steps[bodies.length - 1];
    if (!step) throw new Error('no scripted OpenAI response left');
    const out = step(body);
    return out instanceof Response ? out : Response.json(out);
  });
  return { spy, bodies };
}

/** Ends the OpenAI mock only (other spies stay). */
export const restoreFetch = () => (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();

/** Outputs the backend sent back to the model for its tool calls, in order. */
export const toolOutputs = (body: any): any[] =>
  body.input
    .filter((i: any) => i.type === 'function_call_output')
    .map((i: any) => JSON.parse(String(i.output).replace(/… \[resultado truncado\]$/, '')));

/** The automatic context sent before the user's message (null when there was none). */
export const automaticData = (body: any): string | null =>
  body.input.find((i: any) => i.role === 'user' && String(i.content).startsWith('[Dados recuperados automaticamente'))?.content ?? null;

/** Parses a server-sent event stream into { event, data } pairs. */
export function parseSse(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => ({
      event: /^event: (.*)$/m.exec(b)?.[1] ?? 'message',
      data: JSON.parse(
        b
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n'),
      ),
    }));
}
