import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@mynotes/shared';
import { client, setupOwner } from './helpers';

let http: ReturnType<typeof client>;
let userId: string;

beforeEach(async () => {
  const owner = await setupOwner();
  http = client(owner.token);
  userId = owner.user.id;
});

const doc = (text: string, extra: object[] = []) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }, ...extra] }],
});

async function topic(title: string, parentId: string | null = null) {
  const res = await http.post('/topics', { title, parentId });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('topics', () => {
  it('creates, edits and lists a tree', async () => {
    const eco = await topic('Economia');
    const hist = await topic('História econômica', eco.id);
    await topic('Mercantilismo', hist.id);
    const list = await http.get('/topics');
    expect(list.body.data).toHaveLength(3);

    const upd = await http.patch(`/topics/${eco.id}`, { baseVersion: 1, title: 'Economia política' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.version).toBe(2);
  });

  it('supports arbitrarily deep hierarchies', async () => {
    let parent: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const t = await topic(`Nível ${i}`, parent);
      ids.push(t.id);
      parent = t.id;
    }
    const detail = await http.get(`/topics/${ids[59]}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.ancestors).toHaveLength(59);
    expect(detail.body.data.ancestors[0].id).toBe(ids[0]);
  });

  it('keeps manual order and reorders siblings', async () => {
    const a = await topic('A');
    const b = await topic('B');
    const c = await topic('C');
    const moved = await http.post(`/topics/${c.id}/move`, { baseVersion: 1, parentId: null, afterId: a.id });
    expect(moved.status).toBe(200);
    const list = (await http.get('/topics')).body.data.map((t: { title: string }) => t.title);
    expect(list).toEqual(['A', 'C', 'B']);
    expect(b).toBeTruthy();
  });

  it('prevents cycles when moving', async () => {
    const a = await topic('A');
    const b = await topic('B', a.id);
    const c = await topic('C', b.id);
    const res = await http.post(`/topics/${a.id}/move`, { baseVersion: 1, parentId: c.id });
    expect(res.status).toBe(400);
    const self = await http.post(`/topics/${a.id}/move`, { baseVersion: 1, parentId: a.id });
    expect(self.status).toBe(400);
  });

  it('detects concurrent edits', async () => {
    const t = await topic('Original');
    expect((await http.patch(`/topics/${t.id}`, { baseVersion: 1, title: 'Laptop' })).status).toBe(200);
    const stale = await http.patch(`/topics/${t.id}`, { baseVersion: 1, title: 'Phone' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect(stale.body.error.details.current.title).toBe('Laptop');
  });

  it('is idempotent on create with the same id', async () => {
    const id = uuidv7();
    const first = await http.post('/topics', { id, title: 'Uma vez' });
    const again = await http.post('/topics', { id, title: 'Uma vez' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await http.get('/topics')).body.data).toHaveLength(1);
  });

  it('trashes a subtree with its notes and restores it together', async () => {
    const a = await topic('A');
    const b = await topic('B', a.id);
    const note = (await http.post('/notes', { topicId: b.id, title: 'Nota em B' })).body.data;
    const del = await http.del(`/topics/${a.id}?mode=trash_all`);
    expect(del.status).toBe(200);
    expect((await http.get('/topics')).body.data).toHaveLength(0);
    expect((await http.get(`/notes/${note.id}`)).status).toBe(404);

    const trash = (await http.get('/trash')).body.data;
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ type: 'topic', id: a.id, batchSize: 3 });

    expect((await http.post('/trash/restore', { type: 'topic', id: a.id })).status).toBe(200);
    expect((await http.get('/topics')).body.data).toHaveLength(2);
    expect((await http.get(`/notes/${note.id}`)).body.data.topicId).toBe(b.id);
  });

  it('moves content to the parent when deleting with move_to_parent', async () => {
    const a = await topic('A');
    const b = await topic('B', a.id);
    const c = await topic('C', b.id);
    const note = (await http.post('/notes', { topicId: b.id, title: 'n' })).body.data;
    await http.del(`/topics/${b.id}?mode=move_to_parent`);
    const topics = (await http.get('/topics')).body.data;
    expect(topics.find((t: { id: string }) => t.id === c.id).parentId).toBe(a.id);
    expect((await http.get(`/notes/${note.id}`)).body.data.topicId).toBe(a.id);
  });

  it('purges permanently and keeps references consistent', async () => {
    const a = await topic('A');
    const keep = (await http.post('/notes', { title: 'fora' })).body.data;
    expect(
      (await http.post('/relations', { sourceType: 'note', sourceId: keep.id, targetType: 'topic', targetId: a.id })).status,
    ).toBe(201);
    expect((await http.post('/favorites', { entityType: 'topic', entityId: a.id })).status).toBe(200);
    await http.del(`/topics/${a.id}`);
    expect((await http.del(`/trash/topic/${a.id}`)).status).toBe(200);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM topics WHERE user_id = ?').bind(userId).first<{ n: number }>();
    expect(left?.n).toBe(0);
    const fav = await env.DB.prepare("SELECT COUNT(*) AS n FROM favorites WHERE entity_type = 'topic' AND user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    expect(fav?.n).toBe(0);
    const rel = await env.DB.prepare('SELECT COUNT(*) AS n FROM relations WHERE user_id = ?').bind(userId).first<{ n: number }>();
    expect(rel?.n).toBe(0);
    expect((await http.get(`/notes/${keep.id}`)).status).toBe(200);
  });
});

describe('notes', () => {
  it('creates, saves with versions and lists with pagination', async () => {
    for (let i = 0; i < 5; i++) await http.post('/notes', { title: `Nota ${i}` });
    const page1 = await http.get('/notes?limit=2');
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.nextCursor).toBeTruthy();
    const page2 = await http.get(`/notes?limit=2&cursor=${page1.body.meta.nextCursor}`);
    expect(page2.body.data).toHaveLength(2);
    const ids = new Set([...page1.body.data, ...page2.body.data].map((n: { id: string }) => n.id));
    expect(ids.size).toBe(4);
  });

  it('autosaves content, derives text and detects conflicts', async () => {
    const note = (await http.post('/notes', { title: 'Inflação' })).body.data;
    const saved = await http.patch(`/notes/${note.id}`, { baseVersion: 1, content: doc('Política monetária e preços') });
    expect(saved.status).toBe(200);
    expect(saved.body.data.version).toBe(2);
    expect(saved.body.data.excerpt).toContain('Política monetária');
    expect(saved.body.data.wordCount).toBe(4);

    const conflict = await http.patch(`/notes/${note.id}`, { baseVersion: 1, content: doc('outra versão') });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.current.content.content[0].content[0].text).toBe('Política monetária e preços');
  });

  it('replays retried writes with the same Idempotency-Key', async () => {
    const note = (await http.post('/notes', { title: 'x' })).body.data;
    const key = 'retry-key-123456';
    const body = { baseVersion: 1, title: 'y' };
    const first = await http.post(`/notes/${note.id}/move`, { baseVersion: 1, topicId: null }, { 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    const replay = await http.post(`/notes/${note.id}/move`, { baseVersion: 1, topicId: null }, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    const reuse = await http.post(`/notes/${note.id}/move`, body, { 'Idempotency-Key': key });
    expect(reuse.status).toBe(422);
  });

  it('strips unsafe links and records internal links as backlinks', async () => {
    const target = (await http.post('/notes', { title: 'Alvo' })).body.data;
    const source = (await http.post('/notes', { title: 'Fonte' })).body.data;
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ruim', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            { type: 'text', text: ' alvo', marks: [{ type: 'link', attrs: { href: `mynotes:note/${target.id}` } }] },
          ],
        },
      ],
    };
    expect((await http.patch(`/notes/${source.id}`, { baseVersion: 1, content })).status).toBe(200);
    const stored = (await http.get(`/notes/${source.id}`)).body.data.content;
    expect(JSON.stringify(stored)).not.toContain('javascript:');
    const back = await http.get(`/backlinks/note/${target.id}`);
    expect(back.body.data.map((b: { noteId: string }) => b.noteId)).toEqual([source.id]);
  });

  it('keeps revisions of previous states', async () => {
    const note = (await http.post('/notes', { title: 'Hist', content: doc('v1') })).body.data;
    await http.patch(`/notes/${note.id}`, { baseVersion: 1, content: doc('v2') });
    const revisions = (await http.get(`/notes/${note.id}/revisions`)).body.data;
    expect(revisions).toHaveLength(1);
    const rev = (await http.get(`/notes/${note.id}/revisions/${revisions[0].id}`)).body.data;
    expect(rev.content.content[0].content[0].text).toBe('v1');
  });

  it('rejects oversized content and invalid documents', async () => {
    const note = (await http.post('/notes', { title: 'big' })).body.data;
    const huge = doc('x'.repeat(700_000));
    expect((await http.patch(`/notes/${note.id}`, { baseVersion: 1, content: huge })).status).toBe(413);
    expect((await http.patch(`/notes/${note.id}`, { baseVersion: 1, content: { type: 'nope' } })).status).toBe(400);
  });

  it('rejects references to topics that do not exist', async () => {
    const res = await http.post('/notes', { title: 'x', topicId: uuidv7() });
    expect(res.status).toBe(400);
  });

  it('trashes and restores a single note to the root when its topic is gone', async () => {
    const t = await topic('T');
    const n = (await http.post('/notes', { topicId: t.id, title: 'n' })).body.data;
    await http.del(`/notes/${n.id}`);
    await http.del(`/topics/${t.id}`);
    expect((await http.post('/trash/restore', { type: 'note', id: n.id })).status).toBe(200);
    expect((await http.get(`/notes/${n.id}`)).body.data.topicId).toBeNull();
  });
});
