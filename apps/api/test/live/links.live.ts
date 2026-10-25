import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { orderPair } from '../../src/modules/links/service';
import { client, setupOwner } from '../helpers';

/*
 * Suggested links against the REAL OpenAI API (one call, a fraction of a
 * cent): the explanation schema is accepted and the answer reads the texts.
 *   npx vitest run --config vitest.live.config.ts test/live/links.live.ts
 */

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('suggested links against the real OpenAI API', () => {
  it('explains a pair: kind, direction and one sentence', async () => {
    const owner = await setupOwner();
    const http = client(owner.token);
    const a = (await http.post('/notes', { title: 'Inflação', content: doc('A inflação é o aumento generalizado dos preços. Uma causa clássica é a emissão de moeda além do crescimento da economia.') })).body.data;
    const b = (await http.post('/notes', { title: 'República de Weimar', content: doc('Em 1923 a Alemanha imprimiu dinheiro para pagar dívidas e os preços chegaram a dobrar em poucos dias: a hiperinflação.') })).body.data;
    const [x, y] = orderPair({ type: 'note', id: a.id }, { type: 'note', id: b.id });
    const id = uuidv7();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO link_suggestions (id, user_id, a_type, a_id, b_type, b_id, score, status, direction, reason, hidden, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0.8, 'open', 'ab', '', 0, 1, ?, ?)`,
    )
      .bind(id, owner.user.id, x.type, x.id, y.type, y.id, now, now)
      .run();
    const res = await http.post('/links/suggestions/explain', { ids: [id] });
    if (res.status !== 200) console.error(JSON.stringify(res.body));
    expect(res.status).toBe(200);
    const s = res.body.data[0];
    console.info(`\n[ligação] ${s.a.title} / ${s.b.title}: ${s.kind} (${s.direction}) — ${s.reason}`);
    expect(s).toMatchObject({ explained: true });
    expect(s.kind).not.toBeNull();
    expect(s.reason.length).toBeGreaterThan(10);
  });
});
