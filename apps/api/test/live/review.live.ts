import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { client, setupOwner } from '../helpers';

/*
 * Revisar against the REAL OpenAI API (see vitest.live.config.ts): five
 * calls, under one cent. Proves the schemas are accepted and the answers
 * stay grounded in the notes:
 *   npx vitest run --config vitest.live.config.ts test/live/review.live.ts
 */

const doc = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });
const today = new Date().toISOString().slice(0, 10);

describe('Revisar against the real OpenAI API', () => {
  it('writes grounded questions, corrects an essay by key points, compares free recall, helps and rephrases', async () => {
    const owner = await setupOwner();
    const http = client(owner.token);
    const t = (await http.post('/topics', { title: 'Biologia' })).body.data;
    const n = (
      await http.post('/notes', {
        title: 'Fotossíntese',
        topicId: t.id,
        content: doc(
          'A fotossíntese é o processo em que as plantas produzem o próprio alimento. Ela acontece nos cloroplastos, organelas que contêm clorofila.',
          'A clorofila é o pigmento verde que absorve a energia da luz.',
          'Na fotossíntese, a planta usa luz, água e gás carbônico para produzir glicose e liberar oxigênio.',
          'A respiração celular faz o caminho inverso: usa glicose e oxigênio para liberar energia, gás carbônico e água.',
        ),
      })
    ).body.data;

    // 1. Questions from the note: every one quotes the note.
    const gen = await http.post('/review/generate', { topicIds: [t.id], kinds: ['basic', 'cloze', 'open', 'essay'], count: 6 });
    if (gen.status !== 200) console.error(JSON.stringify(gen.body));
    expect(gen.status).toBe(200);
    console.info(`\n[perguntas] ${gen.body.data.proposals.length} aceitas, ${gen.body.data.discarded} descartadas`);
    for (const p of gen.body.data.proposals) console.info(`- (${p.kind}) ${p.front}\n    ↳ «${p.sourceQuote}»`);
    expect(gen.body.data.proposals.length).toBeGreaterThanOrEqual(3);
    const decided = await http.post('/review/proposals/decide', { accept: gen.body.data.proposals.map((p: any) => ({ id: p.id })) });
    expect(decided.body.data.created.length).toBeGreaterThanOrEqual(3);

    // 2. An essay with a missing point and a contradiction of the note.
    const [essay] = (
      await http.post('/review/cards', {
        kind: 'essay',
        front: 'Explique o que a fotossíntese usa e o que produz.',
        back: 'Usa luz, água e gás carbônico para produzir glicose e liberar oxigênio.',
        keyPoints: ['usa luz', 'usa água e gás carbônico', 'produz glicose', 'libera oxigênio'],
        noteId: n.id,
        sourceQuote: 'a planta usa luz, água e gás carbônico para produzir glicose e liberar oxigênio',
      })
    ).body.data;
    const ev = await http.post(`/review/cards/${essay.id}/evaluate`, { answer: 'A planta usa a luz do sol e a água para fazer glicose. Ela libera gás carbônico no fim.' });
    if (ev.status !== 200) console.error(JSON.stringify(ev.body));
    expect(ev.status).toBe(200);
    console.info(`\n[correção] nota ${ev.body.data.score}, sugestão ${ev.body.data.suggestedRating}\n${JSON.stringify(ev.body.data.points, null, 1)}\nerros: ${JSON.stringify(ev.body.data.errors)}\n${ev.body.data.feedback}`);
    expect(ev.body.data.points.find((p: any) => /oxig/i.test(p.point))?.status).not.toBe('covered');
    expect(ev.body.data.score).toBeLessThan(85);

    // 3. Free recall of the topic.
    const recall = await http.post('/review/recalls', { id: uuidv7(), topicId: t.id, text: 'A fotossíntese acontece nos cloroplastos e a planta faz glicose com luz. A clorofila é verde.', localDay: today });
    if (recall.status !== 200) console.error(JSON.stringify(recall.body));
    expect(recall.status).toBe(200);
    console.info(`\n[recordação] ${recall.body.data.coverage}%\n${recall.body.data.evaluation.ideas.map((i: any) => `- ${i.status}: ${i.idea}`).join('\n')}`);
    expect(recall.body.data.evaluation.ideas.length).toBeGreaterThanOrEqual(3);

    // 4. Help with a card, and 5. the essay asked another way (after one answer).
    const help = await http.post(`/review/cards/${essay.id}/help`, {});
    if (help.status !== 200) console.error(JSON.stringify(help.body));
    expect(help.status).toBe(200);
    console.info(`\n[ajuda] ${JSON.stringify(help.body.data)}`);
    await http.post(`/review/cards/${essay.id}/answer`, { id: uuidv7(), rating: 2, localDay: today });
    const variants = await http.post('/review/variants', { cardIds: [essay.id] });
    expect(variants.status).toBe(200);
    console.info(`\n[outro jeito] ${variants.body.data.variants[0]?.prompt}`);
    expect(variants.body.data.variants).toHaveLength(1);

    const usage = (await http.get('/ai/status')).body.data;
    console.info(`\n[gasto de hoje] US$ ${usage.spentTodayUsd}`);
  });
});
