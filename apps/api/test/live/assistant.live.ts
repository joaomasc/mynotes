import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { api, client, setupOwner } from '../helpers';
import { parseSse } from '../openai-mock';

/*
 * Real calls to the OpenAI API (see vitest.live.config.ts). Kept to three
 * short turns: the goal is to prove the integration works end to end —
 * schemas accepted, tools called, answers grounded, writes persisted.
 */

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});

describe('assistant against the real OpenAI API', () => {
  it('answers from real notes, proposes a topic tree and creates a note', async () => {
    const owner = await setupOwner();
    const http = client(owner.token);
    const ep = (await http.post('/topics', { title: 'Economia Política' })).body.data;
    const ricardo = (
      await http.post('/notes', {
        title: 'David Ricardo',
        topicId: ep.id,
        content: doc(
          'Ricardo defende a teoria do valor-trabalho: o valor de troca das mercadorias depende da quantidade de trabalho necessária para produzi-las.',
          'Também formulou a teoria das vantagens comparativas no comércio internacional.',
        ),
      })
    ).body.data;
    await http.post('/notes', {
      title: 'Friedrich List',
      topicId: ep.id,
      content: doc('List critica o livre-comércio e defende o protecionismo educador para a industrialização de países atrasados.'),
    });

    const turn = async (message: string, conversationId: string | null = null) => {
      const res = await http.post('/ai/chat', { messageId: uuidv7(), message, conversationId });
      if (res.status !== 200) console.error('chat failed', res.status, JSON.stringify(res.body));
      expect(res.status).toBe(200);
      const m = res.body.data.assistantMessage;
      console.info(`\n> ${message}\n${m.content}\n[tools: ${m.tools.map((t: any) => t.label).join(' | ')}]\n[uso: ${JSON.stringify(m.usage)}]`);
      return res.body.data;
    };

    // 1. Grounded answer with a citation to the real note.
    const first = await turn('Onde anotei a teoria do valor de Ricardo?');
    expect(first.assistantMessage.tools.some((t: any) => t.tool === 'search_knowledge' || t.tool === 'get_note')).toBe(true);
    expect(first.assistantMessage.content).toContain(`mynotes:note/${ricardo.id}`);
    expect(first.assistantMessage.sources.map((s: any) => s.id)).toContain(ricardo.id);

    // 1b. The same kind of question, streamed (what the app uses): text arrives in pieces, then the saved turn.
    const streamed = await api('POST', '/ai/chat/stream', { token: owner.token, body: { messageId: uuidv7(), message: 'O que anotei sobre Friedrich List?' } });
    expect(streamed.status).toBe(200);
    const events = parseSse(await streamed.text());
    const deltas = events.filter((e) => e.event === 'delta').length;
    const done = events.at(-1)!;
    console.info(`\n> (stream) ${deltas} pedaços de texto; ferramentas: ${done.data.assistantMessage?.tools.map((t: any) => t.label).join(' | ')}`);
    expect(done.event).toBe('done');
    expect(deltas).toBeGreaterThan(1);
    expect(done.data.assistantMessage.content).toMatch(/List/);

    // 2. A structure is only proposed; confirming creates it with the right hierarchy.
    const second = await turn('Crie um assunto chamado Economia Clássica e subassuntos para Adam Smith e David Ricardo.');
    const proposal = second.actions.find((a: any) => a.tool === 'create_topics');
    expect(proposal?.status).toBe('proposed');
    expect((await http.get('/topics')).body.data.map((t: any) => t.title)).toEqual(['Economia Política']);
    const confirmed = await http.post(`/ai/actions/${proposal.id}/confirm`);
    expect(confirmed.body.data.action.status).toBe('executed');
    const topics = (await http.get('/topics')).body.data;
    const classic = topics.find((t: any) => t.title === 'Economia Clássica');
    expect(topics.filter((t: any) => t.parentId === classic.id).map((t: any) => t.title).sort()).toEqual(['Adam Smith', 'David Ricardo']);

    // 3. A single note asked for explicitly is created right away, in the right topic.
    const third = await turn(
      'Crie uma nota chamada "Resumo sobre List" no assunto Economia Política, com duas frases resumindo o que anotei sobre Friedrich List.',
      second.conversation.id,
    );
    const created = third.actions.find((a: any) => a.tool === 'create_note');
    expect(created?.status).toBe('executed');
    const noteId = created.results[0].id;
    const saved = (await http.get(`/notes/${noteId}`)).body.data;
    expect(saved.topicId).toBe(ep.id);
    expect(saved.wordCount).toBeGreaterThan(5);

    const day = new Date().toISOString().slice(0, 10);
    const usage = await env.DB.prepare('SELECT * FROM ai_usage_daily WHERE user_id = ? AND day = ?').bind(owner.user.id, day).first<any>();
    console.info(`\nConsumo real desta execução: ${JSON.stringify(usage)}`);
    expect(usage.requests).toBe(4);
  });

  it('writes the daily note, builds and extends a canvas, and writes code', async () => {
    const owner = await setupOwner();
    const http = client(owner.token);
    const today = new Date().toISOString().slice(0, 10);
    const diario = (await http.post('/topics', { title: 'Diário' })).body.data;
    await http.put('/settings/notes', { value: { dailyTopicId: diario.id, dailyFormat: 'YYYY-MM-DD' } });
    const rf = (await http.post('/topics', { title: 'Revolução Francesa' })).body.data;
    const bastilha = (
      await http.post('/notes', { title: 'Bastilha', topicId: rf.id, content: doc('A tomada da Bastilha, em 14 de julho de 1789, marcou o início da revolução.') })
    ).body.data;
    await http.post('/notes', { title: 'Crise fiscal', topicId: rf.id, content: doc('As dívidas da coroa e os impostos sobre o Terceiro Estado levaram à convocação dos Estados Gerais.') });

    const turn = async (message: string, extra: Record<string, unknown> = {}) => {
      const res = await http.post('/ai/chat', { messageId: uuidv7(), message, localDate: today, ...extra });
      if (res.status !== 200) console.error('chat failed', res.status, JSON.stringify(res.body));
      expect(res.status).toBe(200);
      const m = res.body.data.assistantMessage;
      console.info(`\n> ${message}\n${m.content}\n[tools: ${m.tools.map((t: any) => t.label).join(' | ')}]\n[ações: ${res.body.data.actions.map((a: any) => `${a.tool}=${a.status}`).join(', ')}]`);
      return res.body.data;
    };
    const action = (data: any, tool: string) => data.actions.find((a: any) => a.tool === tool);

    // 1. Daily note: created as the app does (title format, topic), with the text.
    const daily = await turn('Anote na minha nota diária de hoje: estudei a Revolução Francesa por uma hora.');
    expect(action(daily, 'write_daily_note')?.status).toBe('executed');
    const dailyNote = (await http.get(`/notes/${action(daily, 'write_daily_note').results[0].id}`)).body.data;
    expect(dailyNote).toMatchObject({ title: today, topicId: diario.id });
    expect(JSON.stringify(dailyNote.content)).toMatch(/Revolu/);

    // 2. Canvas in the topic being viewed, with the real notes as cards.
    const built = await turn('Monte um canvas chamado "Revolução — causas" neste assunto, com as minhas notas como cartões dentro de um grupo "Causas" e setas ligando as ideias.', {
      context: { type: 'topic', id: rf.id, view: null },
    });
    const created = action(built, 'create_canvas');
    expect(created?.status).toBe('executed');
    const canvasId = created.results[0].id;
    const canvas = (await http.get(`/mind-maps/${canvasId}`)).body.data;
    console.info(`\nCanvas: ${JSON.stringify(canvas.data.nodes.map((n: any) => ({ kind: n.kind, label: n.label, ref: n.ref?.title })))}\nSetas: ${canvas.data.edges.length}`);
    expect(canvas).toMatchObject({ kind: 'canvas', topicId: rf.id });
    expect(canvas.data.nodes.some((n: any) => n.kind === 'item' && n.ref?.id === bastilha.id)).toBe(true);
    expect(canvas.data.nodes.some((n: any) => n.kind === 'group')).toBe(true);

    // 3. Extending the canvas that is open: read it, then a new card connected to an existing one.
    const extended = await turn('Acrescente neste canvas um cartão de texto com a pergunta "Por que 1789?" ligado ao cartão da nota Bastilha.', {
      conversationId: built.conversation.id,
      context: { type: 'mindmap', id: canvasId, view: null },
    });
    expect(action(extended, 'update_canvas')?.status).toBe('executed');
    const after = (await http.get(`/mind-maps/${canvasId}`)).body.data;
    expect(after.version).toBeGreaterThan(canvas.version);
    expect(after.data.nodes.length).toBe(canvas.data.nodes.length + 1);
    expect(JSON.stringify(after.data.nodes)).toContain('1789?');
    expect(after.data.edges.length).toBeGreaterThan(canvas.data.edges.length);

    // 4. Code: a fenced block with its language becomes a highlighted code block.
    const code = await turn('Crie uma nota chamada "Soma em Python" com um bloco de código Python de uma função que soma dois números.');
    expect(action(code, 'create_note')?.status).toBe('executed');
    const codeNote = (await http.get(`/notes/${action(code, 'create_note').results[0].id}`)).body.data;
    const block = codeNote.content.content.find((b: any) => b.type === 'codeBlock');
    console.info(`\nBloco de código: ${JSON.stringify(block)}`);
    expect(block?.attrs.language).toMatch(/^py(thon)?$/);
    expect(block.content[0].text).toMatch(/def \w+\(.*\):\n {4}return/);

    const usage = await env.DB.prepare('SELECT * FROM ai_usage_daily WHERE user_id = ? AND day = ?').bind(owner.user.id, today).first<any>();
    console.info(`\nConsumo real desta execução: ${JSON.stringify(usage)}`);
  });
});
