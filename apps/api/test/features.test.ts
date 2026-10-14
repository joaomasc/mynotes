import { beforeEach, describe, expect, it } from 'vitest';
import { client, setupOwner } from './helpers';

let http: ReturnType<typeof client>;

beforeEach(async () => {
  http = client((await setupOwner()).token);
});

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('readings and plans', () => {
  it('tracks progress and keeps status coherent', async () => {
    const r = (await http.post('/readings', { title: 'O Capital', author: 'Marx', totalPages: 400 })).body.data;
    expect(r.status).toBe('not_started');
    const started = await http.patch(`/readings/${r.id}`, { baseVersion: 1, status: 'in_progress', currentPage: 100 });
    expect(started.body.data.startedOn).toBeTruthy();
    expect(started.body.data.progressPercent).toBe(25);
    const done = await http.patch(`/readings/${r.id}`, { baseVersion: 2, status: 'completed' });
    expect(done.body.data.currentPage).toBe(400);
    expect(done.body.data.completedOn).toBeTruthy();
    const invalid = await http.patch(`/readings/${r.id}`, { baseVersion: 3, currentPage: 500 });
    expect(invalid.status).toBe(400);
  });

  it('filters overdue readings', async () => {
    await http.post('/readings', { title: 'Atrasada', dueOn: '2000-01-01' });
    await http.post('/readings', { title: 'Futura', dueOn: '2999-01-01' });
    const overdue = await http.get('/readings?overdue=true');
    expect(overdue.body.data.map((r: { title: string }) => r.title)).toEqual(['Atrasada']);
  });

  it('manages plans with ordered steps and progress', async () => {
    const plan = (await http.post('/plans', { title: 'Macroeconomia', goal: 'Base sólida' })).body.data;
    const s1 = (await http.post(`/plans/${plan.id}/items`, { title: 'Cap. 1', dueOn: '2030-01-01' })).body.data;
    const s2 = (await http.post(`/plans/${plan.id}/items`, { title: 'Cap. 2' })).body.data;
    await http.patch(`/plans/${plan.id}/items/${s2.id}`, { baseVersion: 1, afterId: null });
    await http.patch(`/plans/${plan.id}/items/${s1.id}`, { baseVersion: 1, completed: true });
    const detail = (await http.get(`/plans/${plan.id}`)).body.data;
    expect(detail.items.map((i: { title: string }) => i.title)).toEqual(['Cap. 2', 'Cap. 1']);
    expect(detail.completedCount).toBe(1);
    expect(detail.itemCount).toBe(2);
  });
});

describe('study sessions', () => {
  it('records sessions with references and computes stats', async () => {
    const topic = (await http.post('/topics', { title: 'Inflação' })).body.data;
    const note = (await http.post('/notes', { title: 'Resumo' })).body.data;
    const started = new Date(Date.now() - 3600_000).toISOString();
    const s = await http.post('/study-sessions', {
      topicId: topic.id,
      startedAt: started,
      durationSeconds: 1800,
      objective: 'Ler capítulo',
      noteIds: [note.id],
    });
    expect(s.status).toBe(201);
    expect(s.body.data.noteIds).toEqual([note.id]);

    const upd = await http.patch(`/study-sessions/${s.body.data.id}`, { baseVersion: 1, noteIds: [] });
    expect(upd.body.data.noteIds).toEqual([]);
    const stale = await http.patch(`/study-sessions/${s.body.data.id}`, { baseVersion: 1, noteIds: [note.id] });
    expect(stale.status).toBe(409);
    expect((await http.get(`/study-sessions/${s.body.data.id}`)).body.data.noteIds).toEqual([]);

    const from = new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const stats = (await http.get(`/study-sessions/stats?from=${from}&to=${to}&tzOffset=-180`)).body.data;
    expect(stats.totalSeconds).toBe(1800);
    expect(stats.byTopic[0].topicId).toBe(topic.id);
  });

  it('rejects sessions in the future and invalid durations', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect((await http.post('/study-sessions', { startedAt: future, durationSeconds: 600 })).status).toBe(400);
    expect((await http.post('/study-sessions', { startedAt: new Date().toISOString(), durationSeconds: 5 })).status).toBe(400);
  });
});

describe('knowledge: relations, concepts, mind maps, graph', () => {
  it('relates entities, lists both directions and cleans up on purge', async () => {
    const a = (await http.post('/notes', { title: 'Liberalismo' })).body.data;
    const c = (await http.post('/concepts', { name: 'Mão invisível' })).body.data;
    const rel = await http.post('/relations', {
      sourceType: 'note',
      sourceId: a.id,
      targetType: 'concept',
      targetId: c.id,
      kind: 'references',
    });
    expect(rel.status).toBe(201);
    const dup = await http.post('/relations', {
      sourceType: 'note',
      sourceId: a.id,
      targetType: 'concept',
      targetId: c.id,
      kind: 'references',
    });
    expect(dup.status).toBe(200);
    expect((await http.get(`/relations?entityType=concept&entityId=${c.id}`)).body.data).toHaveLength(1);

    await http.del(`/notes/${a.id}`);
    expect((await http.get(`/relations?entityType=concept&entityId=${c.id}`)).body.data).toHaveLength(0);
    await http.post('/trash/restore', { type: 'note', id: a.id });
    expect((await http.get(`/relations?entityType=concept&entityId=${c.id}`)).body.data).toHaveLength(1);
    await http.del(`/notes/${a.id}`);
    await http.del(`/trash/note/${a.id}`);
    await http.post('/trash/restore', { type: 'note', id: a.id });
    expect((await http.get(`/relations?entityType=concept&entityId=${c.id}`)).body.data).toHaveLength(0);
  });

  it('saves and restores mind maps, validating structure and links', async () => {
    const note = (await http.post('/notes', { title: 'Alvo' })).body.data;
    const map = (await http.post('/mind-maps', { title: 'Economia' })).body.data;
    expect(map.data.nodes).toHaveLength(1);
    const data = {
      nodes: [
        { id: 'root', position: { x: 0, y: 0 }, label: 'Economia' },
        { id: 'n1', position: { x: 200, y: 0 }, label: 'Inflação', ref: { type: 'note', id: note.id }, parentId: 'root' },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const saved = await http.patch(`/mind-maps/${map.id}`, { baseVersion: 1, data });
    expect(saved.status).toBe(200);
    expect(saved.body.data.nodeCount).toBe(2);
    const loaded = (await http.get(`/mind-maps/${map.id}`)).body.data;
    expect(loaded.data.nodes[1].ref.id).toBe(note.id);

    const broken = await http.patch(`/mind-maps/${map.id}`, {
      baseVersion: 2,
      data: { nodes: data.nodes, edges: [{ id: 'e2', source: 'root', target: 'missing' }] },
    });
    expect(broken.status).toBe(400);
  });

  it('builds a graph with typed nodes and edges', async () => {
    const t = (await http.post('/topics', { title: 'Economia' })).body.data;
    const n = (await http.post('/notes', { title: 'Inflação', topicId: t.id })).body.data;
    const n2 = (await http.post('/notes', { title: 'Juros', topicId: t.id })).body.data;
    await http.patch(`/notes/${n2.id}`, {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ver', marks: [{ type: 'link', attrs: { href: `mynotes:note/${n.id}` } }] }] }],
      },
    });
    const graph = (await http.get('/graph')).body.data;
    expect(graph.nodes).toHaveLength(3);
    const kinds = graph.edges.map((e: { kind: string }) => e.kind).sort();
    expect(kinds).toEqual(['contains', 'contains', 'links_to']);
    const notesOnly = (await http.get('/graph?types=note&structure=false')).body.data;
    expect(notesOnly.nodes).toHaveLength(2);
  });
});

describe('dashboard, search, favorites, settings', () => {
  it('searches real data across types without accents', async () => {
    await http.post('/notes', { title: 'Política monetária', content: doc('A taxa Selic e a inflação no Brasil') });
    await http.post('/topics', { title: 'Economia brasileira' });
    await http.post('/readings', { title: 'Formação Econômica do Brasil', author: 'Celso Furtado' });
    const res = await http.get('/search?q=brasil');
    expect(res.status).toBe(200);
    const types = res.body.data.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual(['note', 'reading', 'topic']);
    const note = res.body.data.find((r: { type: string }) => r.type === 'note');
    expect(note.snippet).toContain('inflação no Brasil');
    expect((await http.get('/search?q=MONETARIA')).body.data).toHaveLength(1);
    expect((await http.get('/search?q=selic%20inflacao&types=note')).body.data).toHaveLength(1);
  });

  it('manages favorites and shows the dashboard', async () => {
    const n = (await http.post('/notes', { title: 'Favorita' })).body.data;
    expect((await http.post('/favorites', { entityType: 'note', entityId: n.id })).status).toBe(200);
    expect((await http.post('/favorites', { entityType: 'note', entityId: n.id })).status).toBe(200);
    await http.post('/activity/view', { entityType: 'note', entityId: n.id });
    const dash = (await http.get('/dashboard')).body.data;
    expect(dash.favorites).toHaveLength(1);
    expect(dash.recentNotes[0].id).toBe(n.id);
    expect(dash.continueItems[0].entityId).toBe(n.id);
    expect((await http.del(`/favorites/note/${n.id}`)).status).toBe(204);
    expect((await http.get('/favorites')).body.data).toHaveLength(0);
  });

  it('stores settings with validation and version checks', async () => {
    const first = await http.put('/settings/ui', { value: { theme: 'dark' } });
    expect(first.status).toBe(200);
    expect(first.body.data.value).toEqual({ theme: 'dark' });
    const stale = await http.put('/settings/ui', { value: { theme: 'light' } });
    expect(stale.status).toBe(409);
    const ok = await http.put('/settings/ui', { value: { theme: 'light' }, baseVersion: 1 });
    expect(ok.body.data.version).toBe(2);
    const invalid = await http.put('/settings/ui', { value: { theme: 'purple' }, baseVersion: 2 });
    expect(invalid.status).toBe(400);
  });
});
