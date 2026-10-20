import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownToDoc, uuidv7, zMindMapData } from '@mynotes/shared';
import { aiConfig, costOf, requireReady } from '../src/modules/assistant/config';

import { hasWriteIntent } from '../src/modules/assistant/prompt';
import { api, client, setupOwner } from './helpers';
import { answer, callTools, FAKE_KEY, mockOpenAI, restoreFetch, toolOutputs } from './openai-mock';
import { installSemanticFakes } from './semantic-fakes';

/*
 * The OpenAI API is always mocked: these tests never make paid calls. Each
 * scripted step answers one request to /v1/responses, in order, and every
 * request body is kept for assertions.
 */

let http: ReturnType<typeof client>;
let token: string;
let userId: string;

beforeEach(async () => {
  installSemanticFakes();
  const owner = await setupOwner();
  token = owner.token;
  userId = owner.user.id;
  http = client(token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const send = (message: string, extra: Record<string, unknown> = {}) => http.post('/ai/chat', { messageId: uuidv7(), message, ...extra });
const text = (t: string) => ({ type: 'text', text: t });
const doc = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', content: [text(p)] })) });

async function topic(title: string, parentId: string | null = null) {
  const res = await http.post('/topics', { title, parentId });
  expect(res.status).toBe(201);
  return res.body.data;
}
async function note(title: string, body: string, topicId: string | null = null) {
  const res = await http.post('/notes', { title, topicId, content: doc(body) });
  expect(res.status).toBe(201);
  return res.body.data;
}

/* ------------------------------------------------------------ pure units -- */

describe('assistant building blocks', () => {
  it('converts Markdown into an editor document with "/" references', () => {
    const id = uuidv7();
    const md = [
      '# Ricardo',
      '',
      'A **teoria do valor** de [O Capital](mynotes:reading/' + id + '/p/12) e *Smith*.',
      '',
      '- item um',
      '  - sub item',
      '- item dois',
      '',
      '1. primeiro',
      '2. segundo',
      '',
      '> citação',
      '',
      '```',
      'código',
      '```',
      '<script>alert(1)</script> [x](javascript:alert(1))',
    ].join('\n');
    const d = markdownToDoc(md);
    expect(d.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'paragraph']);
    const para = d.content[1]!.content!;
    expect(para.find((n) => n.marks?.[0]?.type === 'bold')?.text).toBe('teoria do valor');
    expect(para.find((n) => n.type === 'reference')?.attrs).toEqual({ href: `mynotes:reading/${id}/p/12`, label: 'O Capital', heading: null });
    expect(d.content[2]!.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    // HTML stays text; unsafe links keep only their label.
    const last = JSON.stringify(d.content[6]);
    expect(last).toContain('<script>alert(1)</script>');
    expect(last).not.toContain('javascript:');
  });

  it('only treats explicit requests as authorization to write', () => {
    expect(hasWriteIntent('Crie um assunto chamado Economia Política')).toBe(true);
    expect(hasWriteIntent('Você pode adicionar esta nota ao assunto Ricardo?')).toBe(true);
    expect(hasWriteIntent('Crie uma nota que explique a teoria do valor')).toBe(true);
    expect(hasWriteIntent('Como eu organizaria essas notas?')).toBe(false);
    expect(hasWriteIntent('O que você sugere para organizar meus assuntos?')).toBe(false);
    expect(hasWriteIntent('Onde anotei a teoria do valor de Ricardo?')).toBe(false);
    expect(hasWriteIntent('Quais notas falam sobre industrialização brasileira?')).toBe(false);
  });

  it('reads safe defaults and fails clearly without a key or prices', () => {
    const base = {
      OPENAI_API_KEY: FAKE_KEY,
      AI_PRICE_INPUT_PER_MTOK: '0.10',
      AI_PRICE_CACHED_INPUT_PER_MTOK: '0.01',
      AI_PRICE_OUTPUT_PER_MTOK: '0.50',
    };
    const cfgOf = (vars: Record<string, string>) => aiConfig({ ...base, ...vars } as unknown as Env);
    expect(() => requireReady(cfgOf({}))).not.toThrow();
    expect(() => requireReady(cfgOf({ OPENAI_API_KEY: '' }))).toThrow(/OPENAI_API_KEY/);
    expect(() => requireReady(cfgOf({ OPENAI_API_KEY: 'sk-proj-EXEMPLO-FICTICIO' }))).toThrow(/OPENAI_API_KEY/);
    expect(() => requireReady(cfgOf({ AI_ENABLED: 'false' }))).toThrow(/desativado/);
    expect(() => requireReady(cfgOf({ AI_PRICE_INPUT_PER_MTOK: '' }))).toThrow(/preços/);
    expect(cfgOf({ AI_DAILY_BUDGET_USD: 'none' }).dailyBudgetUsd).toBeNull();
    const cfg = cfgOf({ AI_MAX_TOOL_CALLS: 'abc', AI_DAILY_BUDGET_USD: '-3' });
    expect(cfg.model).toBe('gpt-6-luna');
    expect(cfg.maxToolCalls).toBe(8);
    expect(cfg.dailyBudgetUsd).toBe(0.5);
    // 1000 uncached input, 200 cached, 80 output at 0.10 / 0.01 / 0.50 per 1M tokens.
    expect(costOf({ inputTokens: 1200, cachedTokens: 200, outputTokens: 80, reasoningTokens: 20 }, cfg.prices)).toBeCloseTo(0.000142, 9);
  });
});

/* -------------------------------------------------------- request checks -- */

describe('assistant: requests and limits', () => {
  it('requires authentication', async () => {
    const { spy } = mockOpenAI([]);
    const res = await api('POST', '/ai/chat', { body: { messageId: uuidv7(), message: 'oi' } });
    expect(res.status).toBe(401);
    expect((await api('GET', '/ai/status')).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates the payload and rejects empty or oversized messages', async () => {
    const { spy } = mockOpenAI([]);
    expect((await http.post('/ai/chat', { message: 'sem id' })).status).toBe(400);
    expect((await http.post('/ai/chat', { messageId: 'x', message: 'oi' })).status).toBe(400);
    expect((await send('   ')).status).toBe(400);
    expect((await send('a'.repeat(4001))).status).toBe(400);
    expect((await send('oi', { context: { type: 'note', id: 'nope' } })).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers with a clear message when the key is missing', async () => {
    const { spy } = mockOpenAI([]);
    const original = (env as any).OPENAI_API_KEY;
    (env as any).OPENAI_API_KEY = '';
    try {
      const res = await send('Oi');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('service_unavailable');
      expect(res.body.error.message).toMatch(/OPENAI_API_KEY/);
      const status = await http.get('/ai/status');
      expect(status.body.data.configured).toBe(false);
    } finally {
      (env as any).OPENAI_API_KEY = original;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('never exposes the key: status reports only whether it is configured', async () => {
    const status = await http.get('/ai/status');
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ enabled: true, configured: true, model: 'gpt-6-luna', dailyBudgetUsd: 0.5 });
    expect(JSON.stringify(status.body)).not.toContain(FAKE_KEY);
    mockOpenAI([answer('Olá!')]);
    const res = await send('Oi');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });

  it('maps OpenAI failures to safe errors and lets the same message be retried', async () => {
    const messageId = uuidv7();
    const leaky = () => Response.json({ error: { message: `Incorrect API key provided: ${FAKE_KEY}`, code: 'invalid_api_key' } }, { status: 401 });
    mockOpenAI([leaky]);
    const failed = await http.post('/ai/chat', { messageId, message: 'Oi' });
    expect(failed.status).toBe(503);
    expect(failed.body.error.message).toMatch(/recusou a chave/);
    expect(JSON.stringify(failed.body)).not.toContain(FAKE_KEY);
    restoreFetch();

    // 5xx is retried once; quota errors are not.
    const { bodies } = mockOpenAI([
      () => new Response('{}', { status: 500 }),
      () => Response.json({ error: { code: 'insufficient_quota', message: 'quota' } }, { status: 429 }),
    ]);
    const quota = await http.post('/ai/chat', { messageId, message: 'Oi' });
    expect(quota.status).toBe(503);
    expect(quota.body.error.message).toMatch(/sem crédito/);
    expect(bodies).toHaveLength(2);
    restoreFetch();

    // Nothing was kept from the failed attempts: the same id works now.
    mockOpenAI([answer('Tudo certo.')]);
    const ok = await http.post('/ai/chat', { messageId, message: 'Oi' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.assistantMessage.content).toBe('Tudo certo.');
  });

  it('replays an already answered message instead of calling the model again', async () => {
    const messageId = uuidv7();
    const { spy } = mockOpenAI([answer('Primeira resposta.')]);
    const first = await http.post('/ai/chat', { messageId, message: 'Oi' });
    expect(first.status).toBe(200);
    const again = await http.post('/ai/chat', { messageId, message: 'Oi' });
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect(again.body.data.assistantMessage.id).toBe(first.body.data.assistantMessage.id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('limits messages per minute', async () => {
    mockOpenAI(Array.from({ length: 6 }, () => answer('ok')));
    for (let i = 0; i < 6; i++) expect((await send(`mensagem ${i}`)).status).toBe(200);
    const limited = await send('mais uma');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });

  it('stops at the daily budget and records the real usage of each turn', async () => {
    mockOpenAI([answer('ok')]);
    const res = await send('Oi');
    const day = new Date().toISOString().slice(0, 10);
    const row = await env.DB.prepare('SELECT * FROM ai_usage_daily WHERE user_id = ? AND day = ?').bind(userId, day).first<any>();
    expect(row).toMatchObject({ requests: 1, input_tokens: 1200, cached_tokens: 200, output_tokens: 80, reasoning_tokens: 20 });
    expect(row.cost_usd).toBeCloseTo(0.000142, 9);
    expect(res.body.data.assistantMessage.usage.costUsd).toBeCloseTo(0.000142, 9);

    await env.DB.prepare('UPDATE ai_usage_daily SET cost_usd = 0.75 WHERE user_id = ? AND day = ?').bind(userId, day).run();
    const blocked = await send('De novo');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/orçamento diário/);
  });
});

/* -------------------------------------------------------- reading tools -- */

describe('assistant: grounded answers', () => {
  it('searches real notes and cites them; invented links are removed', async () => {
    const t = await topic('Economia Política');
    const ricardo = await note('David Ricardo', 'A teoria do valor-trabalho de Ricardo explica preços relativos.', t.id);
    await note('Receita de bolo', 'Farinha e ovos.');
    const fake = uuidv7();
    const { bodies } = mockOpenAI([
      callTools(['search_knowledge', { query: 'teoria valor Ricardo', types: null, limit: null }]),
      answer(`Você anotou isso em [David Ricardo](mynotes:note/${ricardo.id}). Veja também [Inventada](mynotes:note/${fake}).`),
    ]);
    const res = await send('Onde anotei a teoria do valor de Ricardo?');
    expect(res.status).toBe(200);
    const [search] = toolOutputs(bodies[1]);
    expect(search.results[0]).toMatchObject({ id: ricardo.id, title: 'David Ricardo', topic: { id: t.id, title: 'Economia Política' }, link: `mynotes:note/${ricardo.id}` });
    expect(search.results.map((r: any) => r.title)).not.toContain('Receita de bolo');
    // Reasoning and function-call items went back unchanged before the results.
    expect(bodies[1].input.some((i: any) => i.type === 'reasoning' && i.encrypted_content === 'opaque')).toBe(true);
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-luna', store: false, tool_choice: 'auto', max_output_tokens: 2000 });

    const msg = res.body.data.assistantMessage;
    expect(msg.content).toContain(`(mynotes:note/${ricardo.id})`);
    expect(msg.content).not.toContain(fake);
    expect(msg.content).toContain('Inventada');
    expect(msg.sources).toEqual([expect.objectContaining({ type: 'note', id: ricardo.id, title: 'David Ricardo' })]);
    expect(msg.tools.map((t: any) => t.label)).toEqual(['Pesquisou automaticamente', 'Pesquisou “teoria valor Ricardo”']);
    // The automatic search already sent the note to the model, before any tool call.
    const auto = bodies[0].input.find((i: any) => i.role === 'user' && String(i.content).startsWith('[Dados recuperados automaticamente'));
    expect(auto.content).toContain(`mynotes:note/${ricardo.id}`);
  });

  it('reads only the owner\'s records', async () => {
    const mine = await note('Minha nota', 'Conteúdo meu sobre List.');
    const other = await setupOwner();
    const theirs = (await client(other.token).post('/notes', { title: 'Nota alheia', content: doc('segredo') })).body.data;
    const { bodies } = mockOpenAI([
      callTools(['get_note', { note_id: mine.id }], ['get_note', { note_id: theirs.id }]),
      answer(`Li [a sua](mynotes:note/${mine.id}) e [a outra](mynotes:note/${theirs.id}).`),
    ]);
    const res = await send('Leia essas notas');
    const [ownNote, otherNote] = toolOutputs(bodies[1]);
    expect(ownNote).toMatchObject({ id: mine.id, title: 'Minha nota', version: 1 });
    expect(ownNote.text).toContain('List');
    expect(otherNote).toMatchObject({ error: 'not_found' });
    expect(JSON.stringify(bodies[1])).not.toContain('segredo');
    expect(res.body.data.assistantMessage.content).not.toContain(theirs.id);
  });

  it('uses the item in focus, after checking it belongs to the user', async () => {
    const n = await note('Friedrich List', 'Sistema nacional de economia política.');
    const { bodies } = mockOpenAI([answer('Esta nota trata de List.')]);
    const res = await send('Resuma esta nota', { context: { type: 'note', id: n.id, view: null } });
    expect(res.status).toBe(200);
    const dev = bodies[0].input.find((i: any) => i.role === 'developer');
    expect(dev.content).toContain('Friedrich List');
    expect(dev.content).toContain(`mynotes:note/${n.id}`);
    // The open note's text goes with the message: "resuma esta nota" needs no tool call.
    const data = bodies[0].input.find((i: any) => i.role === 'user' && String(i.content).includes('nota_aberta'));
    expect(data.content).toContain('Sistema nacional de economia política.');

    const other = await setupOwner();
    const theirs = (await client(other.token).post('/notes', { title: 'Alheia' })).body.data;
    const denied = await send('Resuma', { context: { type: 'note', id: theirs.id, view: null } });
    expect(denied.status).toBe(400);
  });

  it('sends a bounded history and keeps conversations', async () => {
    const { bodies } = mockOpenAI([answer('Primeira.'), answer('Segunda.')]);
    const first = await send('Primeira pergunta');
    const conversationId = first.body.data.conversation.id;
    const second = await send('Segunda pergunta', { conversationId });
    expect(second.status).toBe(200);
    expect(bodies[1].input.map((i: any) => i.content)).toEqual(['Primeira pergunta', 'Primeira.', 'Segunda pergunta']);

    const list = await http.get('/ai/conversations');
    expect(list.body.data).toEqual([expect.objectContaining({ id: conversationId, title: 'Primeira pergunta', messageCount: 4 })]);
    const conv = await http.get(`/ai/conversations/${conversationId}`);
    expect(conv.body.data.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((await http.del(`/ai/conversations/${conversationId}`)).status).toBe(204);
    expect((await http.get(`/ai/conversations/${conversationId}`)).status).toBe(404);
  });

  it('rejects invalid tool arguments and unknown tools, and the turn goes on', async () => {
    const { bodies } = mockOpenAI([
      callTools(['get_note', '{not json'], ['get_note', { note_id: 'abc' }], ['drop_database', {}]),
      answer('Não consegui ler.'),
    ]);
    const res = await send('Leia a nota');
    expect(res.status).toBe(200);
    expect(toolOutputs(bodies[1]).map((o) => o.error)).toEqual(['invalid_arguments', 'invalid_arguments', 'unknown_tool']);
    expect(res.body.data.assistantMessage.tools.slice(1).every((t: any) => !t.ok)).toBe(true);
  });

  it('caps tool calls per turn and then forces a text answer', async () => {
    const search = callTools(['search_knowledge', { query: 'x', types: null, limit: 1 }], ['search_knowledge', { query: 'y', types: null, limit: 1 }]);
    const { bodies } = mockOpenAI([search, search, search, search, search, answer('Chega de buscas.')]);
    const res = await send('Pesquise tudo');
    expect(res.status).toBe(200);
    // 8 calls in 4 rounds, then one call that cannot use tools.
    expect(bodies).toHaveLength(5);
    expect(bodies[4].tool_choice).toBe('none');
    // 8 tool calls plus the automatic search.
    expect(res.body.data.assistantMessage.tools).toHaveLength(9);
  });

  it('reads topics, tags, the library with page annotations and topic mind maps', async () => {
    const root = await topic('Economia Política');
    const sub = await topic('Karl Marx', root.id);
    await http.post('/notes', { title: 'Mais-valia', topicId: sub.id, content: doc('Trabalho não pago. #marxismo') });
    const book = (await http.post('/readings', { title: 'O Capital', author: 'Karl Marx', topicId: sub.id, totalPages: 900 })).body.data;
    await http.post('/notes', { role: 'annotation', readingId: book.id, page: 125, quote: 'A mercadoria é, antes de tudo…', content: doc('Fetichismo.') });
    const { bodies } = mockOpenAI([
      callTools(
        ['get_topic', { topic_id: root.id }],
        ['get_topic_tree', { root_topic_id: null, max_depth: null }],
        ['list_tags', { query: null }],
        ['search_library', { query: 'capital', topic_id: null, kind: null }],
        ['get_reading', { reading_id: book.id, page: 125 }],
        ['get_mind_map', { topic_id: root.id, map_id: null }],
      ),
      answer('Pronto.'),
    ]);
    const res = await send('O que tenho sobre Marx?');
    expect(res.status).toBe(200);
    const [t, tree, tags, library, reading, map] = toolOutputs(bodies[1]);
    expect(t).toMatchObject({ title: 'Economia Política', path: 'Economia Política', subtopics: [expect.objectContaining({ id: sub.id, notes: 1 })] });
    expect(tree.outline).toContain(`Karl Marx [id ${sub.id}] (1 nota(s))`);
    expect(tags.tags).toEqual([{ tag: '#marxismo', notes: 1 }]);
    expect(library.books[0]).toMatchObject({ id: book.id, author: 'Karl Marx', page_annotations: 1, topic: { id: sub.id, title: 'Karl Marx' } });
    expect(library.pdf_text_indexed).toBe(false);
    expect(reading.annotations).toEqual([expect.objectContaining({ page: 125, quoted_passage: 'A mercadoria é, antes de tudo…' })]);
    expect(map.outline).toContain('- [topic] Economia Política');
    expect(map.outline).toContain('    - [note] Mais-valia');
    expect(res.body.data.assistantMessage.tools.map((x: any) => x.ok)).toEqual([true, true, true, true, true, true, true]);
  });

  it('stops tools that would exceed the per-request database budget', async () => {
    const topics = Array.from({ length: 4 }, () => ['get_topic', { topic_id: uuidv7() }] as [string, unknown]);
    const { bodies } = mockOpenAI([callTools(...topics), answer('Parei.')]);
    await send('Abra quatro assuntos');
    const outputs = toolOutputs(bodies[1]);
    // get_topic runs 8 statements: three fit in the budget of 30, the fourth is refused.
    expect(outputs.map((o) => o.error)).toEqual(['not_found', 'not_found', 'not_found', 'request_limit']);
  });

  it('finds the path between two notes in the graph and their connections', async () => {
    const t = await topic('Desenvolvimento econômico');
    const a = await note('Industrialização brasileira', 'Substituição de importações.', t.id);
    const b = await note('Friedrich List', 'Protecionismo educador.', t.id);
    const { bodies } = mockOpenAI([
      callTools(
        ['find_connection_path', { from_type: 'note', from_id: a.id, to_type: 'note', to_id: b.id, max_depth: null }],
        ['get_connections', { type: 'topic', id: t.id }],
      ),
      answer('Estão no mesmo assunto.'),
    ]);
    await send('Por que essas notas estão conectadas?');
    const [path, connections] = toolOutputs(bodies[1]);
    expect(path).toMatchObject({ found: true, length: 2 });
    expect(path.steps[0].to).toMatchObject({ type: 'topic', id: t.id });
    expect(connections.connections.map((c: any) => c.item.id).sort()).toEqual([a.id, b.id].sort());
  });
});

/* --------------------------------------------------------- writing tools -- */

describe('assistant: changes to MyNotes', () => {
  it('creates a note when asked and returns the real id', async () => {
    const t = await topic('Economia Política');
    const { bodies } = mockOpenAI([
      callTools([
        'create_note',
        {
          title: 'Resumo de Ricardo',
          content_markdown: '## Valor\n\nO valor vem do **trabalho**.',
          topic_id: t.id,
          tags: ['economia'],
          references: [{ type: 'topic', id: t.id }],
          book: null,
          mode: 'execute',
        },
      ]),
      answer('Criei a nota.'),
    ]);
    const res = await send('Crie uma nota com um resumo de Ricardo no assunto Economia Política');
    expect(res.status).toBe(200);
    const [out] = toolOutputs(bodies[1]);
    expect(out.status).toBe('executed');
    const saved = await http.get(`/notes/${out.note.id}`);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ title: 'Resumo de Ricardo', topicId: t.id });
    const json = JSON.stringify(saved.body.data.content);
    expect(json).toContain('"type":"heading"');
    expect(json).toContain(`mynotes:topic/${t.id}`);
    expect(json).toContain('#economia');
    expect(res.body.data.actions).toEqual([expect.objectContaining({ tool: 'create_note', status: 'executed' })]);
    // The tag is indexed like any note written in the editor.
    const tagged = await http.get('/notes?tag=economia');
    expect(tagged.body.data.map((n: any) => n.id)).toEqual([out.note.id]);
  });

  it('refuses ids that do not exist instead of creating', async () => {
    const before = await http.get('/notes');
    const { bodies } = mockOpenAI([
      callTools([
        'create_note',
        { title: 'X', content_markdown: 'texto', topic_id: uuidv7(), tags: [], references: [], book: null, mode: 'execute' },
      ]),
      answer('O assunto não existe.'),
    ]);
    await send('Crie uma nota X no assunto Y');
    const [out] = toolOutputs(bodies[1]);
    expect(out.error).toBe('invalid_reference');
    expect((await http.get('/notes')).body.data).toHaveLength(before.body.data.length);
  });

  it('edits a note preserving what was not sent, refusing stale versions', async () => {
    const n = await note('Marx', 'Primeiro parágrafo.');
    const { bodies } = mockOpenAI([
      callTools([
        'update_note',
        { note_id: n.id, base_version: 1, title: null, append_markdown: 'Segundo parágrafo.', replace_markdown: null, move_to_topic_id: null, remove_from_topic: false, mode: 'execute' },
      ]),
      callTools([
        'update_note',
        { note_id: n.id, base_version: 1, title: 'Outro', append_markdown: null, replace_markdown: null, move_to_topic_id: null, remove_from_topic: false, mode: 'execute' },
      ]),
      answer('Feito.'),
    ]);
    await send('Adicione um segundo parágrafo à nota Marx');
    const [appended] = toolOutputs(bodies[1]);
    expect(appended).toMatchObject({ status: 'executed', note: { version: 2 } });
    const [, stale] = toolOutputs(bodies[2]);
    expect(stale.error).toBe('version_conflict');
    const saved = (await http.get(`/notes/${n.id}`)).body.data;
    expect(saved.title).toBe('Marx');
    expect(saved.version).toBe(2);
    expect(JSON.stringify(saved.content)).toContain('Primeiro parágrafo.');
    expect(JSON.stringify(saved.content)).toContain('Segundo parágrafo.');
    // The previous text was saved to the history first.
    const revisions = await http.get(`/notes/${n.id}/revisions`);
    expect(revisions.body.data).toHaveLength(1);
  });

  it('never rewrites a whole note without confirmation', async () => {
    const n = await note('Smith', 'Mão invisível.');
    const { bodies } = mockOpenAI([
      callTools([
        'update_note',
        { note_id: n.id, base_version: 1, title: null, append_markdown: null, replace_markdown: 'Tudo novo.', move_to_topic_id: null, remove_from_topic: false, mode: 'execute' },
      ]),
      answer('Confirme no cartão.'),
    ]);
    const res = await send('Reescreva a nota Smith');
    const [out] = toolOutputs(bodies[1]);
    expect(out.status).toBe('awaiting_confirmation');
    expect(JSON.stringify((await http.get(`/notes/${n.id}`)).body.data.content)).toContain('Mão invisível.');
    expect(res.body.data.actions[0]).toMatchObject({ kind: 'sensitive', status: 'proposed' });
  });

  it('does not write when the user only asked for advice', async () => {
    const { bodies } = mockOpenAI([
      callTools(['create_topics', { parent_id: null, topics: [{ key: 't1', title: 'Clássicos', description: null, parent_key: null }], mode: 'execute' }]),
      answer('Sugiro um assunto Clássicos.'),
    ]);
    const res = await send('Como eu organizaria essas notas?');
    const [out] = toolOutputs(bodies[1]);
    expect(out).toMatchObject({ status: 'awaiting_confirmation', reason: expect.stringMatching(/não pede uma alteração/) });
    expect((await http.get('/topics')).body.data).toHaveLength(0);
    expect(res.body.data.actions[0].status).toBe('proposed');
  });

  it('proposes a topic tree, creates it once on confirmation and reuses existing topics', async () => {
    const args = {
      parent_id: null,
      topics: [
        { key: 'ep', title: 'Economia Política', description: 'Clássicos e críticos', parent_key: null },
        { key: 'smith', title: 'Adam Smith', description: null, parent_key: 'ep' },
        { key: 'ricardo', title: 'David Ricardo', description: null, parent_key: 'ep' },
        { key: 'marx', title: 'Karl Marx', description: null, parent_key: 'ep' },
        { key: 'list', title: 'Friedrich List', description: null, parent_key: 'ep' },
      ],
      mode: 'execute',
    };
    const { bodies } = mockOpenAI([callTools(['create_topics', args]), answer('Confirme a estrutura no cartão.')]);
    const res = await send('Crie um assunto chamado Economia Política e subassuntos para Adam Smith, David Ricardo, Karl Marx e Friedrich List.');
    const [out] = toolOutputs(bodies[1]);
    expect(out.status).toBe('awaiting_confirmation');
    const action = res.body.data.actions[0];
    expect(action.preview.map((l: any) => [l.depth, l.label, l.state])).toEqual([
      [0, 'Economia Política', 'new'],
      [1, 'Adam Smith', 'new'],
      [1, 'David Ricardo', 'new'],
      [1, 'Karl Marx', 'new'],
      [1, 'Friedrich List', 'new'],
    ]);
    expect((await http.get('/topics')).body.data).toHaveLength(0);

    const confirmed = await http.post(`/ai/actions/${action.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.action.status).toBe('executed');
    expect(confirmed.body.data.event.content).toMatch(/Criou 5 assunto/);
    const topics = (await http.get('/topics')).body.data;
    const root = topics.find((t: any) => t.title === 'Economia Política');
    expect(root.parentId).toBeNull();
    expect(topics.filter((t: any) => t.parentId === root.id).map((t: any) => t.title)).toEqual([
      'Adam Smith',
      'David Ricardo',
      'Karl Marx',
      'Friedrich List',
    ]);
    // Confirming twice never runs it again.
    expect((await http.post(`/ai/actions/${action.id}/confirm`)).body.data.action.status).toBe('executed');
    expect((await http.get('/topics')).body.data).toHaveLength(5);

    // Asking again reuses everything; a new subtopic is added under the existing root.
    restoreFetch();
    const again = mockOpenAI([
      callTools(['create_topics', { ...args, topics: [...args.topics.slice(0, 2), { key: 'keynes', title: 'Keynes', description: null, parent_key: 'ep' }] }]),
      answer('Só faltava Keynes.'),
    ]);
    const second = await send('Crie Economia Política com Adam Smith e Keynes');
    const [reused] = toolOutputs(again.bodies[1]);
    expect(reused.status).toBe('executed');
    expect(reused.created).toEqual([expect.objectContaining({ title: 'Keynes', parent_id: root.id })]);
    expect(reused.reused_existing.map((r: any) => r.title)).toEqual(['Economia Política', 'Adam Smith']);
    expect(second.body.data.actions[0].status).toBe('executed');
    expect((await http.get('/topics')).body.data).toHaveLength(6);
  });

  it('moves topics only after confirmation and refuses cycles', async () => {
    const a = await topic('A');
    const b = await topic('B', a.id);
    const { bodies } = mockOpenAI([
      callTools(['move_topic', { topic_id: a.id, base_version: a.version, new_parent_id: b.id }], ['move_topic', { topic_id: b.id, base_version: b.version, new_parent_id: null }]),
      answer('ok'),
    ]);
    const res = await send('Mova os assuntos');
    const [cycle, move] = toolOutputs(bodies[1]);
    expect(cycle.error).toBe('invalid_arguments');
    expect(move.status).toBe('awaiting_confirmation');
    expect((await http.get(`/topics/${b.id}`)).body.data.topic.parentId).toBe(a.id);
    const rejected = await http.post(`/ai/actions/${res.body.data.actions[0].id}/reject`);
    expect(rejected.body.data.action.status).toBe('rejected');
    expect((await http.post(`/ai/actions/${res.body.data.actions[0].id}/confirm`)).status).toBe(409);
  });

  it('creates authorized relations and refuses duplicates, self-links and cycles', async () => {
    const a = await note('Smith', 'x');
    const b = await note('Ricardo', 'y');
    const rel = (s: any, t: any, kind = 'supports') => ({ source_type: 'note', source_id: s.id, target_type: 'note', target_id: t.id, kind, label: null });
    const { bodies } = mockOpenAI([
      callTools(['create_relations', { relations: [rel(a, b, 'depends_on')], mode: 'execute' }]),
      callTools(
        ['create_relations', { relations: [rel(a, b, 'depends_on')], mode: 'execute' }],
        ['create_relations', { relations: [rel(a, a)], mode: 'execute' }],
        ['create_relations', { relations: [rel(b, a, 'depends_on')], mode: 'execute' }],
      ),
      answer('ok'),
    ]);
    await send('Ligue a nota Smith à nota Ricardo');
    expect(toolOutputs(bodies[1])[0].status).toBe('executed');
    const [, dup, self, cycle] = toolOutputs(bodies[2]);
    expect(dup.status).toBe('nothing_to_do');
    expect(self.error).toBe('invalid_arguments');
    expect(cycle.message).toMatch(/circular/);
    const relations = await http.get(`/relations?entityType=note&entityId=${a.id}`);
    expect(relations.body.data).toEqual([expect.objectContaining({ kind: 'depends_on', sourceId: a.id, targetId: b.id })]);
  });

  it('proposes a mind map linked to real items and creates a valid map on confirmation', async () => {
    const n = await note('Ricardo', 'vantagens comparativas');
    const { bodies } = mockOpenAI([
      callTools([
        'propose_mind_map',
        {
          title: 'Comércio internacional',
          topic_id: null,
          map_id: null,
          base_version: null,
          nodes: [
            { key: 'root', label: 'Comércio internacional', parent_key: null, ref_type: null, ref_id: null },
            { key: 'r', label: 'Vantagens comparativas', parent_key: 'root', ref_type: 'note', ref_id: n.id },
            { key: 'p', label: 'Protecionismo', parent_key: 'root', ref_type: null, ref_id: null },
          ],
          links: [{ from_key: 'p', to_key: 'r', label: 'critica' }],
        },
      ]),
      answer('Confirme o mapa.'),
    ]);
    const res = await send('Monte um mapa conceitual sobre comércio internacional');
    expect(toolOutputs(bodies[1])[0].status).toBe('awaiting_confirmation');
    const done = await http.post(`/ai/actions/${res.body.data.actions[0].id}/confirm`);
    expect(done.body.data.action.status).toBe('executed');
    const mapId = done.body.data.action.results[0].id;
    const map = (await http.get(`/mind-maps/${mapId}`)).body.data;
    expect(zMindMapData.safeParse(map.data).success).toBe(true);
    expect(map.data.nodes).toHaveLength(3);
    expect(map.data.nodes.find((x: any) => x.label === 'Vantagens comparativas').ref).toMatchObject({ type: 'note', id: n.id });
    expect(map.data.edges).toHaveLength(3);
  });

  it('marks a confirmed action as failed, writing nothing, when the database fails', async () => {
    const { bodies } = mockOpenAI([
      callTools(['create_topics', { parent_id: null, topics: [{ key: 'a', title: 'Um', description: null, parent_key: null }, { key: 'b', title: 'Dois', description: null, parent_key: 'a' }], mode: 'execute' }]),
      answer('Confirme.'),
    ]);
    const res = await send('Crie os assuntos Um e Dois');
    expect(toolOutputs(bodies[1])[0].status).toBe('awaiting_confirmation');
    const batch = env.DB.batch.bind(env.DB);
    let failed = false;
    const batchSpy = vi.spyOn(env.DB, 'batch').mockImplementation(async (statements: D1PreparedStatement[]) => {
      if (!failed && statements.length === 2) {
        failed = true;
        throw new Error('D1_ERROR: simulated outage');
      }
      return batch(statements);
    });
    const confirmed = await http.post(`/ai/actions/${res.body.data.actions[0].id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.action).toMatchObject({ status: 'failed', error: expect.stringMatching(/Falha ao gravar/) });
    expect(JSON.stringify(confirmed.body)).not.toContain('simulated outage');
    batchSpy.mockRestore();
    expect((await http.get('/topics')).body.data).toHaveLength(0);
  });
});
