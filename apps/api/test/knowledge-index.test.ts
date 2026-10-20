import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { chunkText, chunksOf, indexTextOf, parseVectorId, syncAllUsers, vectorId } from '../src/modules/assistant/knowledge-index';
import { api, client, setupOwner } from './helpers';
import { answer, automaticData, callTools, mockOpenAI, parseSse, sse, toolOutputs, usage } from './openai-mock';
import { installSemanticFakes, type FakeVectorize } from './semantic-fakes';

let http: ReturnType<typeof client>;
let token: string;
let userId: string;
let index: FakeVectorize;
let embed: ReturnType<typeof installSemanticFakes>['embed'];

beforeEach(async () => {
  ({ index, embed } = installSemanticFakes());
  const owner = await setupOwner();
  token = owner.token;
  userId = owner.user.id;
  http = client(token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});
async function note(title: string, body: string, topicId: string | null = null) {
  const res = await http.post('/notes', { title, topicId, content: doc(body) });
  expect(res.status).toBe(201);
  return res.body.data;
}
const sync = async (body: Record<string, unknown> = {}) => {
  const res = await http.post('/ai/index/sync', body);
  expect(res.status).toBe(200);
  return res.body.data;
};
const embeddedTexts = () => embed.mock.calls.flatMap((c) => (c[1] as { text: string[] }).text);

describe('chunks', () => {
  it('cuts long text at paragraphs into bounded, overlapping, deterministic chunks', () => {
    expect(chunkText('Curto.')).toEqual(['Curto.']);
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Parágrafo ${i}: ${'palavra '.repeat(30).trim()}.`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1200 + 160)).toBe(true);
    expect(chunkText(text)).toEqual(chunks);
    // The start of each chunk repeats the end of the previous one.
    const overlap = chunks[1]!.split('\n')[0]!;
    expect(overlap.length).toBeGreaterThan(20);
    expect(chunks[0]!.endsWith(overlap)).toBe(true);
    // Every chunk carries the item's heading.
    const t = indexTextOf('note', { title: 'Ricardo', body_text: text, role: 'note' });
    expect(chunksOf(t).every((c) => c.startsWith('Ricardo\n'))).toBe(true);
    const annotation = indexTextOf('note', { title: '', body_text: 'Fetichismo', role: 'annotation', page: 125, reading_title: 'O Capital', quote: 'A mercadoria' });
    expect(chunksOf(annotation)[0]).toBe('Anotação de “O Capital”, p. 125\nTrecho citado: A mercadoria\n\nFetichismo');
  });

  it('encodes the item in the vector id (≤ 64 bytes)', () => {
    const id = uuidv7();
    const vid = vectorId('note', id, 39);
    expect(new TextEncoder().encode(vid).length).toBeLessThanOrEqual(64);
    expect(parseVectorId(vid)).toEqual({ type: 'note', id, chunk: 39 });
    expect(parseVectorId('x:abc:1')).toBeNull();
  });
});

describe('semantic index', () => {
  it('indexes what changed, skips what did not, re-embeds edits and drops trashed items', async () => {
    const t = (await http.post('/topics', { title: 'Desenvolvimento econômico', description: 'Teorias do crescimento' })).body.data;
    const a = await note('Industrialização', 'Fábricas e protecionismo.', t.id);
    const b = await note('Comércio', 'Vantagens comparativas.');

    const first = await sync();
    expect(first).toMatchObject({ processed: 3, removed: 0, more: false, available: true, indexed: 3, total: 3 });
    expect(index.idsOf(userId)).toEqual([vectorId('note', a.id, 0), vectorId('note', b.id, 0), vectorId('topic', t.id, 0)].sort());
    const calls = embed.mock.calls.length;

    // Nothing changed: nothing is embedded again.
    expect(await sync()).toMatchObject({ processed: 0 });
    expect(embed.mock.calls.length).toBe(calls);

    // An edit re-embeds only that note; moving it (same text) does not.
    await http.patch(`/notes/${b.id}`, { baseVersion: b.version, content: doc('Vantagens comparativas de Ricardo.') });
    expect(await sync()).toMatchObject({ processed: 1 });
    expect(embeddedTexts().at(-1)).toBe('Comércio\nVantagens comparativas de Ricardo.');
    const before = embed.mock.calls.length;
    await http.post(`/notes/${b.id}/move`, { baseVersion: b.version + 1, topicId: t.id });
    expect(await sync()).toMatchObject({ processed: 1 });
    expect(embed.mock.calls.length).toBe(before);

    // Trash: the vectors and the index row go.
    expect((await http.del(`/notes/${a.id}`)).status).toBe(204);
    expect(await sync()).toMatchObject({ removed: 1, indexed: 2, total: 2 });
    expect(index.idsOf(userId)).not.toContain(vectorId('note', a.id, 0));
    expect((await http.get('/ai/index')).body.data).toMatchObject({ available: true, indexed: 2, total: 2, model: '@cf/baai/bge-m3' });

    // Reset embeds everything again.
    expect(await sync({ reset: true })).toMatchObject({ processed: 2, indexed: 2 });
  });

  it('waits for notes being edited when asked to (background runs)', async () => {
    await note('Rascunho', 'Ainda escrevendo.');
    expect(await sync({ settle: true })).toMatchObject({ processed: 0, indexed: 0, total: 1 });
    expect(await sync()).toMatchObject({ processed: 1, indexed: 1 });
  });

  it('keeps each user in its own namespace; the cron indexes every user', async () => {
    const mine = await note('Minha nota', 'Industrialização brasileira.');
    const other = await setupOwner();
    await client(other.token).post('/notes', { title: 'Nota alheia', content: doc('Fábricas no Brasil.') });
    // The cron only takes notes that stopped being edited (2 minutes).
    await env.DB.prepare('UPDATE notes SET updated_at = ? WHERE user_id IN (?, ?)').bind('2026-01-01T00:00:00.000Z', userId, other.user.id).run();
    await syncAllUsers(env as unknown as Env);
    expect(index.idsOf(userId)).toEqual([vectorId('note', mine.id, 0)]);
    expect(index.idsOf(other.user.id)).toHaveLength(1);
    // The search of one user never returns the other's vectors.
    mockOpenAI([answer('ok')]);
    const res = await http.post('/ai/chat', { messageId: uuidv7(), message: 'Notas sobre fábricas nacionais' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Nota alheia');
  });

  it('finds notes by meaning, without shared keywords, and says how each result matched', async () => {
    const n = await note('Anos 1950', 'Substituição de importações e novas fábricas.');
    await note('Receita', 'Bolo de laranja.');
    await sync();
    const { bodies } = mockOpenAI([callTools(['search_knowledge', { query: 'industrialização brasileira', types: null, limit: null }]), answer('ok')]);
    await http.post('/ai/chat', { messageId: uuidv7(), message: 'Quais notas falam sobre industrialização brasileira?' });
    // The automatic search already found it…
    expect(automaticData(bodies[0])).toContain(`mynotes:note/${n.id}`);
    // …and so does the tool, as a match by meaning.
    const [search] = toolOutputs(bodies[1]);
    expect(search.mode).toMatch(/híbrida/);
    expect(search.results[0]).toMatchObject({ id: n.id, matched: 'sentido', snippet: 'Substituição de importações e novas fábricas.' });
    expect(search.results.map((r: any) => r.title)).not.toContain('Receita');
  });

  it('falls back to the text search when the semantic index is unavailable', async () => {
    const n = await note('Ricardo', 'Teoria do valor.');
    index.available = false;
    const { bodies } = mockOpenAI([callTools(['search_knowledge', { query: 'teoria valor', types: null, limit: null }]), answer('ok')]);
    const res = await http.post('/ai/chat', { messageId: uuidv7(), message: 'Onde está a teoria do valor?' });
    expect(res.status).toBe(200);
    const [search] = toolOutputs(bodies[1]);
    expect(search).toMatchObject({ mode: 'textual (índice semântico indisponível)', results: [expect.objectContaining({ id: n.id, matched: 'texto' })] });
    expect((await http.get('/ai/index')).body.data.available).toBe(false);
    const failed = await http.post('/ai/index/sync', {});
    expect(failed.status).toBe(503);
    expect(failed.body.error.message).toMatch(/busca por palavras continua/);
  });
});

describe('streamed answers', () => {
  const stream = (body: Record<string, unknown>) => api('POST', '/ai/chat/stream', { token, body: { messageId: uuidv7(), ...body } });

  it('streams status, tool activity and text, then the saved turn', async () => {
    const n = await note('Ricardo', 'Teoria do valor-trabalho.');
    mockOpenAI([callTools(['get_note', { note_id: n.id }]), answer(`Está em [Ricardo](mynotes:note/${n.id}).`)]);
    const res = await stream({ message: 'Resuma a nota do Ricardo' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    const kinds = events.map((e) => e.event);
    expect(kinds[0]).toBe('status');
    expect(kinds).toContain('tool');
    const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(text).toBe(`Está em [Ricardo](mynotes:note/${n.id}).`);
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.assistantMessage).toMatchObject({ content: text, status: 'ok' });
    expect(done.data.assistantMessage.tools.map((t: any) => t.tool)).toEqual(['search_knowledge', 'get_note']);
    // Saved like any turn.
    const conv = await http.get(`/ai/conversations/${done.data.conversation.id}`);
    expect(conv.body.data.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  });

  it('answers limits and configuration errors before the stream starts', async () => {
    const original = (env as any).OPENAI_API_KEY;
    (env as any).OPENAI_API_KEY = '';
    try {
      const res = await stream({ message: 'Oi' });
      expect(res.status).toBe(503);
      expect(res.headers.get('Content-Type')).toContain('application/json');
    } finally {
      (env as any).OPENAI_API_KEY = original;
    }
    expect((await api('POST', '/ai/chat/stream', { body: { messageId: uuidv7(), message: 'Oi' } })).status).toBe(401);
  });

  it('reports a failure in the middle of the stream and lets the message be retried', async () => {
    const messageId = uuidv7();
    mockOpenAI([() => sse([{ type: 'error', code: 'server_error', message: 'boom' }])]);
    const res = await api('POST', '/ai/chat/stream', { token, body: { messageId, message: 'Oi' } });
    const events = parseSse(await res.text());
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'service_unavailable', message: expect.stringMatching(/interrompeu/) } });
    vi.mocked(globalThis.fetch).mockRestore();
    mockOpenAI([answer('Agora sim.')]);
    const again = parseSse(await (await api('POST', '/ai/chat/stream', { token, body: { messageId, message: 'Oi' } })).text());
    expect(again.at(-1)).toMatchObject({ event: 'done', data: { assistantMessage: { content: 'Agora sim.' } } });
  });

  it('counts the real usage of streamed answers', async () => {
    mockOpenAI([answer('ok')]);
    const events = parseSse(await (await stream({ message: 'Oi' })).text());
    expect(events.at(-1)!.data.assistantMessage.usage).toMatchObject({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens });
  });
});
