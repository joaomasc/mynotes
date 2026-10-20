import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { client, setupOwner } from '../helpers';

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
    expect(usage.requests).toBe(3);
  });
});
