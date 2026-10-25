import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromMemoryTuple, memoryByNode, uuidv7 } from '@mynotes/shared';
import { scanAllUsers } from '../src/modules/links/service';
import { client, setupOwner } from './helpers';
import { answer, mockOpenAI } from './openai-mock';
import { installSemanticFakes, type FakeVectorize } from './semantic-fakes';

/*
 * The memory graph (the FSRS state of every card, by note, topic and book)
 * and suggested links (Vectorize neighbours not linked yet, explained by the
 * AI, linked or dismissed). Vectorize and embeddings are in-memory fakes.
 */

let http: ReturnType<typeof client>;
let userId: string;
let index: FakeVectorize;

beforeEach(async () => {
  const owner = await setupOwner();
  userId = owner.user.id;
  http = client(owner.token);
  index = installSemanticFakes().index;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TODAY = new Date().toISOString().slice(0, 10);
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function topic(title: string, parentId: string | null = null) {
  return (await http.post('/topics', { title, parentId })).body.data;
}
async function note(title: string, text: string, topicId: string | null) {
  const res = await http.post('/notes', { title, topicId, content: doc(text) });
  expect(res.status).toBe(201);
  return res.body.data;
}
/** Indexes what changed and makes it old enough to be queryable (Vectorize takes a moment in production). */
async function indexNow() {
  expect((await http.post('/ai/index/sync', {})).status).toBe(200);
  await env.DB.prepare("UPDATE knowledge_index SET indexed_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").bind(userId).run();
}
const suggestionsOf = async (id: string) => (await http.get(`/links/suggestions?type=note&id=${id}`)).body.data;

const TEXT = {
  inflation: 'A inflação sobe quando o banco central imprime moeda demais e os preços sobem para todos.',
  money: 'Quando o banco central imprime moeda demais, a inflação sobe e os preços sobem para todos.',
  prices: 'A inflação sobe e os preços sobem quando o banco central imprime moeda demais para todos.',
  plants: 'A planta usa luz, água e gás carbônico para produzir glicose e liberar oxigênio.',
};

describe('memory graph', () => {
  it('gives the FSRS state of every active card with its note, topic and book', async () => {
    const t = await topic('Biologia');
    const sub = await topic('Célula', t.id);
    const n = await note('Mitocôndria', 'A mitocôndria produz ATP.', sub.id);
    const book = (await http.post('/readings', { title: 'Livro de Biologia', topicId: t.id })).body.data;
    const ann = (await http.post('/notes', { role: 'annotation', readingId: book.id, page: 3, content: doc('O núcleo guarda o DNA.') })).body.data;
    const [c1] = (await http.post('/review/cards', { kind: 'basic', front: 'O que produz ATP?', back: 'A mitocôndria', noteId: n.id })).body.data;
    await http.post('/review/cards', { kind: 'cloze', front: 'O {{c1::núcleo}} guarda o DNA.', noteId: ann.id });
    const [own] = (await http.post('/review/cards', { kind: 'basic', front: 'Célula?', back: 'Unidade da vida', topicId: sub.id })).body.data;
    await http.patch(`/review/cards/${own.id}`, { baseVersion: 1, status: 'suspended' });
    await http.post(`/review/cards/${c1.id}/answer`, { id: uuidv7(), rating: 3, localDay: TODAY });

    const res = await http.get('/review/memory');
    expect(res.status).toBe(200);
    const cards = res.body.data.cards.map(fromMemoryTuple);
    // The suspended card is left out.
    expect(cards).toHaveLength(2);
    expect(cards.find((c: any) => c.noteId === n.id)).toMatchObject({ topicId: sub.id, readingId: null, phase: 1 });
    expect(cards.find((c: any) => c.noteId === ann.id)).toMatchObject({ topicId: t.id, readingId: book.id, phase: 0 });

    const parents: Record<string, string | null> = { [t.id]: null, [sub.id]: t.id };
    const memory = memoryByNode(cards, (id) => parents[id], new Date());
    expect(memory.get(`note:${n.id}`)).toMatchObject({ cards: 1, reviewed: 1 });
    expect(memory.get(`note:${n.id}`)!.r).toBeGreaterThan(0.9);
    expect(memory.get(`topic:${t.id}`)).toMatchObject({ cards: 2, reviewed: 1 });
    expect(memory.get(`reading:${book.id}`)).toMatchObject({ cards: 1, reviewed: 0, r: null });
  });

  it('a session can review the cards of chosen notes only', async () => {
    const t = await topic('Química');
    const a = await note('Água', 'H2O.', t.id);
    const b = await note('Sal', 'NaCl.', t.id);
    await http.post('/review/cards', { kind: 'basic', front: 'Fórmula da água?', back: 'H2O', noteId: a.id });
    await http.post('/review/cards', { kind: 'basic', front: 'Fórmula do sal?', back: 'NaCl', noteId: b.id });
    const q = (await http.get(`/review/queue?today=${TODAY}&mode=practice&noteIds=${a.id}`)).body.data;
    expect(q.cards.map((c: any) => c.front)).toEqual(['Fórmula da água?']);
  });
});

describe('suggested links', () => {
  it('suggests notes close in meaning that are not linked yet, explains, and links them', async () => {
    const econ = await topic('Economia');
    const bio = await topic('Biologia');
    const a = await note('Inflação', TEXT.inflation, econ.id);
    const b = await note('Emissão de moeda', TEXT.money, bio.id);
    await note('Fotossíntese', TEXT.plants, bio.id);
    const d = await note('Inflação e preços', TEXT.prices, econ.id);
    await http.post('/relations', { sourceType: 'note', sourceId: a.id, targetType: 'note', targetId: d.id, kind: 'related' });

    // Not indexed yet.
    expect(await suggestionsOf(a.id)).toMatchObject({ suggestions: [], pending: true });
    await indexNow();

    // Searched on the spot: B (close), not D (already linked) nor the photosynthesis note (far).
    const first = await suggestionsOf(a.id);
    expect(first.pending).toBe(false);
    expect(first.suggestions).toHaveLength(1);
    const s = first.suggestions[0];
    const ends = [s.a, s.b];
    expect(ends.map((e: any) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(ends.find((e: any) => e.id === b.id)).toMatchObject({ type: 'note', title: 'Emissão de moeda', topicId: bio.id });
    expect(s.score).toBeGreaterThan(0.8);
    expect(s).toMatchObject({ explained: false, kind: null, status: 'open' });
    // B's own list finds the same pair (stored once).
    expect((await suggestionsOf(b.id)).suggestions.map((x: any) => x.id)).toContain(s.id);

    // The AI explains it once.
    const bAsA = s.a.id === b.id;
    const { bodies } = mockOpenAI([answer(JSON.stringify({ items: [{ id: 'P1', kind: 'depends_on', direction: bAsA ? 'b_to_a' : 'a_to_b', reason: 'A inflação depende da emissão de moeda pelo banco central.' }] }))]);
    const explained = (await http.post('/links/suggestions/explain', { ids: [s.id] })).body.data;
    expect(explained[0]).toMatchObject({ explained: true, kind: 'depends_on', reason: 'A inflação depende da emissão de moeda pelo banco central.' });
    expect(bodies[0].text.format.name).toBe('link_explanations');
    expect(bodies[0].input[0].content).toContain('Emissão de moeda');
    await http.post('/links/suggestions/explain', { ids: [s.id] });
    expect(bodies).toHaveLength(1);

    // Linking creates the relation in the suggested direction: the inflation note depends on the money note.
    const linked = await http.post(`/links/suggestions/${s.id}/accept`, {});
    expect(linked.status).toBe(200);
    expect(linked.body.data.relation).toMatchObject({ sourceId: a.id, targetId: b.id, kind: 'depends_on' });
    expect((await suggestionsOf(a.id)).suggestions).toHaveLength(0);
    // Nor in the graph-wide list (which still has another real pair: B and the prices note, found when B was opened).
    const everything = (await http.get('/links/suggestions')).body.data.suggestions;
    expect(everything.map((x: any) => x.id)).not.toContain(s.id);
    expect(everything.map((x: any) => [x.a.id, x.b.id].sort().join())).toEqual([[b.id, d.id].sort().join()]);
  });

  it('dismissed pairs never come back; trashed notes and pairs the AI finds unrelated are hidden', async () => {
    const t = await topic('Economia');
    const a = await note('Inflação', TEXT.inflation, t.id);
    const b = await note('Emissão de moeda', TEXT.money, t.id);
    await indexNow();
    const [s] = (await suggestionsOf(a.id)).suggestions;
    expect((await http.post(`/links/suggestions/${s.id}/dismiss`, {})).status).toBe(204);
    expect((await suggestionsOf(a.id)).suggestions).toHaveLength(0);

    // A's text changes: searched again, B still not suggested; a new close note is.
    await http.patch(`/notes/${a.id}`, { baseVersion: a.version, content: doc(`${TEXT.inflation} Isso corrói o poder de compra.`) });
    const c = await note('Preços', TEXT.prices, t.id);
    await indexNow();
    const again = (await suggestionsOf(a.id)).suggestions;
    expect(again.flatMap((x: any) => [x.a.id, x.b.id])).not.toContain(b.id);
    expect(again).toHaveLength(1);
    expect([again[0].a.id, again[0].b.id]).toContain(c.id);

    // Unrelated for the AI: hidden.
    mockOpenAI([answer(JSON.stringify({ items: [{ id: 'P1', kind: 'none', direction: 'a_to_b', reason: '' }] }))]);
    await http.post('/links/suggestions/explain', { ids: [again[0].id] });
    expect((await suggestionsOf(a.id)).suggestions).toHaveLength(0);

    // A trashed note hides its pairs; purging it deletes them.
    const d = await note('Hiperinflação', TEXT.money, t.id);
    await indexNow();
    expect((await http.post('/links/scan', {})).status).toBe(200);
    const withD = (await http.get('/links/suggestions')).body.data.suggestions.filter((x: any) => x.a.id === d.id || x.b.id === d.id);
    expect(withD.length).toBeGreaterThan(0);
    await http.del(`/notes/${d.id}`);
    expect((await http.get('/links/suggestions')).body.data.suggestions.some((x: any) => x.a.id === d.id || x.b.id === d.id)).toBe(false);
    await http.del(`/trash/note/${d.id}`);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM link_suggestions WHERE (a_type = 'note' AND a_id = ?) OR (b_type = 'note' AND b_id = ?)").bind(d.id, d.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('the cron scans what was indexed; without the index it says so', async () => {
    const t = await topic('Economia');
    const a = await note('Inflação', TEXT.inflation, t.id);
    await note('Emissão de moeda', TEXT.money, t.id);
    await indexNow();
    await scanAllUsers(env);
    const all = (await http.get('/links/suggestions')).body.data.suggestions;
    expect(all).toHaveLength(1);
    const scanned = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_index WHERE user_id = ? AND links_hash = content_hash').bind(userId).first<{ n: number }>();
    expect(scanned?.n).toBe(2);

    await env.DB.prepare('UPDATE knowledge_index SET links_hash = NULL WHERE user_id = ?').bind(userId).run();
    index.available = false;
    expect(await suggestionsOf(a.id)).toMatchObject({ unavailable: true });
  });

  it('the note panel shows weaker pairs (explained and filtered by the AI) than the graph', async () => {
    const t = await topic('Política');
    const a = await note('Caso Queiroz', 'A prisão de Queiroz e a reação da família.', t.id);
    const b = await note('Relato do caso', 'O relato sobre o caso Queiroz e as investigações.', t.id);
    const [x, y] = [a.id, b.id].sort();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO link_suggestions (id, user_id, a_type, a_id, b_type, b_id, score, status, direction, reason, hidden, version, created_at, updated_at)
       VALUES (?, ?, 'note', ?, 'note', ?, 0.6, 'open', 'ab', '', 0, 1, ?, ?)`,
    )
      .bind(uuidv7(), userId, x, y, now, now)
      .run();
    expect((await suggestionsOf(a.id)).suggestions).toHaveLength(1);
    expect((await http.get('/links/suggestions')).body.data.suggestions).toHaveLength(0);
  });

  it('accepting can choose another kind and direction', async () => {
    const t = await topic('Economia');
    const a = await note('Inflação', TEXT.inflation, t.id);
    const b = await note('Emissão de moeda', TEXT.money, t.id);
    await indexNow();
    const [s] = (await suggestionsOf(a.id)).suggestions;
    const res = await http.post(`/links/suggestions/${s.id}/accept`, { kind: 'contrasts', direction: 'ba', label: 'ver os dois' });
    expect(res.body.data.relation).toMatchObject({ sourceId: s.b.id, targetId: s.a.id, kind: 'contrasts', label: 'ver os dois' });
    expect([s.a.id, s.b.id].sort()).toEqual([a.id, b.id].sort());
    // Deciding twice: the suggestion is no longer open.
    expect((await http.post(`/links/suggestions/${s.id}/dismiss`, {})).status).toBe(404);
  });
});
