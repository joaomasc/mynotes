import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_TABLE_ORDER, uuidv7 } from '@mynotes/shared';
import { client, setupOwner } from './helpers';

let http: ReturnType<typeof client>;
let userId: string;

beforeEach(async () => {
  const owner = await setupOwner();
  http = client(owner.token);
  userId = owner.user.id;
});

const text = (t: string) => ({ type: 'text', text: t });
const ref = (type: string, id: string, label: string, page?: number) => ({
  type: 'reference',
  attrs: { href: `mynotes:${type}/${id}${page ? `/p/${page}` : ''}`, label },
});
const doc = (...inline: object[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: inline }] });

async function topic(title: string, parentId: string | null = null) {
  return (await http.post('/topics', { title, parentId })).body.data;
}
async function note(title: string, content?: object, extra: object = {}) {
  const res = await http.post('/notes', { title, ...(content ? { content } : {}), ...extra });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('tags', () => {
  it('extracts #tags from content, ignoring code, numbers and words like C#', async () => {
    const n = await note(
      'Tags',
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [text('Uma #Crítica forte, #revisar depois. C# não, #1 não, url.com/#ancora não.')] },
          { type: 'paragraph', content: [{ type: 'text', text: '#codigo', marks: [{ type: 'code' }] }] },
          { type: 'codeBlock', content: [text('#bloco')] },
        ],
      },
    );
    const tags = (await http.get('/tags')).body.data.map((t: { tag: string }) => t.tag).sort();
    expect(tags).toEqual(['critica', 'revisar']);
    expect((await http.get('/notes?tag=Crítica')).body.data.map((x: { id: string }) => x.id)).toEqual([n.id]);

    // Editing the content updates the tags.
    await http.patch(`/notes/${n.id}`, { baseVersion: 1, content: doc(text('Agora só #revisar')) });
    expect((await http.get('/tags')).body.data).toEqual([{ tag: 'revisar', count: 1 }]);
    expect((await http.get('/tags?q=rev')).body.data[0].tag).toBe('revisar');
  });

  it('indexes notes saved before tags existed', async () => {
    const id = uuidv7();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO notes (id, user_id, topic_id, title, content, sort_key, version, created_at, updated_at, index_version)
       VALUES (?, ?, NULL, 'Antiga', ?, 'a0', 1, ?, ?, 0)`,
    )
      .bind(id, userId, JSON.stringify(doc(text('texto #legado'))), now, now)
      .run();
    expect((await http.get('/tags')).body.data).toEqual([{ tag: 'legado', count: 1 }]);
  });
});

describe('references', () => {
  it('keep pointing to the same item after a rename and detect broken targets', async () => {
    const merc = await topic('Mercantilismo');
    const source = await note('Fonte', doc(text('Ver '), ref('topic', merc.id, 'Mercantilismo')));
    expect((await http.get(`/backlinks/topic/${merc.id}`)).body.data.map((b: { noteId: string }) => b.noteId)).toEqual([source.id]);

    await http.patch(`/topics/${merc.id}`, { baseVersion: 1, title: 'Mercantilismo europeu' });
    let resolved = (await http.get(`/references/resolve?refs=topic:${merc.id}`)).body.data;
    expect(resolved).toEqual([expect.objectContaining({ id: merc.id, title: 'Mercantilismo europeu', exists: true })]);

    await http.del(`/topics/${merc.id}`);
    resolved = (await http.get(`/references/resolve?refs=topic:${merc.id},note:${uuidv7()}`)).body.data;
    expect(resolved.map((r: { exists: boolean }) => r.exists)).toEqual([false, false]);

    await http.post('/trash/restore', { type: 'topic', id: merc.id });
    resolved = (await http.get(`/references/resolve?refs=topic:${merc.id}`)).body.data;
    expect(resolved[0].exists).toBe(true);
  });

  it('accept page anchors for books and reject non-internal targets', async () => {
    const book = (await http.post('/readings', { title: 'O Capital', author: 'Marx' })).body.data;
    const n = await note('Leitura', doc(ref('reading', book.id, 'O Capital', 125), ref('topic', 'javascript:alert(1)' as never, 'x')));
    const back = (await http.get(`/backlinks/reading/${book.id}`)).body.data;
    expect(back.map((b: { noteId: string }) => b.noteId)).toEqual([n.id]);
    const stored = (await http.get(`/notes/${n.id}`)).body.data.content;
    expect(stored.content[0].content[0].attrs.href).toBe(`mynotes:reading/${book.id}/p/125`);
    expect(stored.content[0].content[1].attrs.href).toBeNull();
  });

  it('suggests items for "/" with title matches first', async () => {
    const eco = await topic('Economia');
    await topic('Mercantilismo', eco.id);
    await note('Sobre o mercantilismo');
    const book = (await http.post('/readings', { title: 'O Capital', author: 'Marx' })).body.data;
    await note('', undefined, { role: 'annotation', readingId: book.id, page: 24, content: doc(text('Acumulação primitiva')) });

    const merc = (await http.get('/references/suggest?q=merc')).body.data;
    expect(merc[0]).toMatchObject({ type: 'topic', title: 'Mercantilismo' });
    expect(merc.map((r: { title: string }) => r.title)).toContain('Sobre o mercantilismo');

    const pages = (await http.get('/references/suggest?q=capital&types=annotation')).body.data;
    expect(pages).toEqual([expect.objectContaining({ type: 'note', role: 'annotation', readingTitle: 'O Capital', page: 24 })]);
    const recent = (await http.get('/references/suggest?types=topic')).body.data;
    expect(recent).toHaveLength(2);

    // Exact title first, then prefixes, then other matches (newer items do not jump ahead).
    await topic('Macroeconomia', eco.id);
    await topic('Microeconomia', eco.id);
    await topic('Economia política', eco.id);
    const ranked = (await http.get('/references/suggest?q=economia&types=topic')).body.data.map((r: { title: string }) => r.title);
    expect(ranked.slice(0, 2)).toEqual(['Economia', 'Economia política']);
    expect(ranked.slice(2).sort()).toEqual(['Macroeconomia', 'Microeconomia']);
  });
});

describe('books: reviews and page annotations', () => {
  it('stores annotations per page and one review per book, as notes', async () => {
    const book = (await http.post('/readings', { title: 'O Capital', totalPages: 800 })).body.data;
    const a1 = await note('', doc(text('Argumento central')), { role: 'annotation', readingId: book.id, page: 125, annotationType: 'summary', quote: 'A mercadoria…' });
    const a2 = await note('', doc(text('Discordo')), { role: 'annotation', readingId: book.id, page: 300, annotationType: 'critique' });
    expect(a1).toMatchObject({ role: 'annotation', readingId: book.id, page: 125, annotationType: 'summary', quote: 'A mercadoria…' });

    const review = await http.post('/notes', { role: 'review', readingId: book.id, title: 'Minha resenha' });
    expect(review.status).toBe(201);
    const again = await http.post('/notes', { role: 'review', readingId: book.id, title: 'Outra' });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(review.body.data.id);

    const pages = (await http.get(`/notes?readingId=${book.id}&role=annotation&sort=created`)).body.data;
    expect(pages.map((n: { page: number }) => n.page).sort()).toEqual([125, 300]);

    // Page and type can be corrected later; ordinary notes ignore these fields.
    const moved = await http.patch(`/notes/${a2.id}`, { baseVersion: 1, page: 301, annotationType: null });
    expect(moved.body.data).toMatchObject({ page: 301, annotationType: null });

    expect((await http.post('/notes', { role: 'annotation', page: 3 })).status).toBe(400);
    expect((await http.post('/notes', { role: 'annotation', readingId: uuidv7() })).status).toBe(400);

    // Deleting the book keeps the annotations (as notes without book).
    await http.del(`/readings/${book.id}`);
    const kept = (await http.get(`/notes/${a1.id}`)).body.data;
    expect(kept).toMatchObject({ role: 'annotation', readingId: null, page: 125 });
  });

  it('feeds the topic context: related books, annotations, mentions, tags and study time', async () => {
    const eco = await topic('Economia');
    const own = (await http.post('/readings', { title: 'Livro do assunto', topicId: eco.id })).body.data;
    const related = (await http.post('/readings', { title: 'O Capital' })).body.data;
    await http.post('/relations', { sourceType: 'reading', sourceId: related.id, targetType: 'topic', targetId: eco.id });
    const ann = await note('', doc(text('Liga com '), ref('topic', eco.id, 'Economia')), { role: 'annotation', readingId: related.id, page: 10 });
    const mention = await note('Menciona', doc(ref('topic', eco.id, 'Economia')));
    await note('No assunto', doc(text('#revisar')), { topicId: eco.id });
    await http.post('/study-sessions', { topicId: eco.id, startedAt: new Date(Date.now() - 7200_000).toISOString(), durationSeconds: 1800 });

    const ctx = (await http.get(`/topics/${eco.id}/context`)).body.data;
    expect(ctx.readings.map((r: { id: string; via: string }) => [r.id, r.via])).toEqual([
      [own.id, 'topic'],
      [related.id, 'relation'],
    ]);
    expect(ctx.readings[1].annotationCount).toBe(1);
    expect(ctx.annotations).toEqual([expect.objectContaining({ id: ann.id, page: 10, readingTitle: 'O Capital' })]);
    expect(ctx.mentions.map((m: { noteId: string }) => m.noteId)).toEqual([mention.id]);
    expect(ctx.tags).toEqual([{ tag: 'revisar', count: 1 }]);
    expect(ctx.study).toMatchObject({ totalSeconds: 1800, sessionCount: 1 });
  });
});

describe('graph', () => {
  it('is derived from hierarchy, references and annotations', async () => {
    const eco = await topic('Economia');
    const macro = await topic('Macro', eco.id);
    const book = (await http.post('/readings', { title: 'O Capital', topicId: eco.id })).body.data;
    const ann = await note('', doc(ref('topic', macro.id, 'Macro')), { role: 'annotation', readingId: book.id, page: 7 });
    const g = (await http.get('/graph')).body.data;
    const kinds = g.edges.map((e: { kind: string; source: string; target: string }) => `${e.kind} ${e.source} ${e.target}`);
    expect(kinds).toContain(`parent topic:${eco.id} topic:${macro.id}`);
    expect(kinds).toContain(`annotates note:${ann.id} reading:${book.id}`);
    expect(kinds).toContain(`links_to note:${ann.id} topic:${macro.id}`);
    expect(g.nodes.find((n: { key: string }) => n.key === `note:${ann.id}`)).toMatchObject({ role: 'annotation', label: 'O Capital, p. 7' });
    // Scoped to a topic, annotations of the topic's books are included.
    const scoped = (await http.get(`/graph?topicId=${eco.id}`)).body.data;
    expect(scoped.nodes.map((n: { key: string }) => n.key)).toContain(`note:${ann.id}`);
  });

  it("brings a filed annotation's book into another topic's map, linked to it", async () => {
    const history = await topic('História');
    const marx = await topic('Marx');
    const capital = await topic('Capital', marx.id);
    const book = (await http.post('/readings', { title: 'O 18 de Brumário', topicId: history.id })).body.data;
    const ann = await note('', doc(text('Bonapartismo')), { role: 'annotation', readingId: book.id, page: 12 });
    const review = await note('', doc(text('Síntese')), { role: 'review', readingId: book.id });
    const loose = await note('', doc(text('Não arquivada')), { role: 'annotation', readingId: book.id, page: 40 });
    // Opened as a note and filed under a subtopic of another topic.
    expect((await http.patch(`/notes/${ann.id}`, { baseVersion: ann.version, topicId: capital.id })).status).toBe(200);
    expect((await http.patch(`/notes/${review.id}`, { baseVersion: review.version, topicId: marx.id })).status).toBe(200);

    const g = (await http.get(`/graph?topicId=${marx.id}`)).body.data;
    const node = (key: string) => g.nodes.find((n: { key: string }) => n.key === key);
    expect(node(`note:${ann.id}`)).toMatchObject({ topicId: capital.id, role: 'annotation', label: 'O 18 de Brumário, p. 12' });
    expect(node(`note:${review.id}`)).toMatchObject({ topicId: marx.id, role: 'review', label: 'Resenha: O 18 de Brumário' });
    // The book is filed elsewhere but comes along, so the link is not lost.
    expect(node(`reading:${book.id}`)).toMatchObject({ topicId: history.id, label: 'O 18 de Brumário' });
    const kinds = g.edges.map((e: { kind: string; source: string; target: string }) => `${e.kind} ${e.source} ${e.target}`);
    expect(kinds).toContain(`annotates note:${ann.id} reading:${book.id}`);
    expect(kinds).toContain(`contains topic:${capital.id} note:${ann.id}`);
    // Annotations still only on the book stay out of this topic's map.
    expect(node(`note:${loose.id}`)).toBeUndefined();
  });
});

describe('view layouts', () => {
  it('stores presentation separately, with optimistic concurrency', async () => {
    const t = await topic('Economia');
    const key = `mindmap:topic:${t.id}`;
    expect((await http.get(`/layouts/${key}`)).body.data).toBeNull();
    const first = await http.put(`/layouts/${key}`, { data: { positions: { [`topic:${t.id}`]: { x: 10, y: 20 } }, collapsed: [] } });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(1);
    expect((await http.put(`/layouts/${key}`, { data: { positions: {} }, baseVersion: 1 })).body.data.version).toBe(2);
    const stale = await http.put(`/layouts/${key}`, { data: { positions: {} }, baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect((await http.put('/layouts/whatever', { data: {} })).status).toBe(400);
    // Moving nodes never touches the hierarchy.
    expect((await http.get(`/topics/${t.id}`)).body.data.topic.version).toBe(1);
  });
});

describe('backup of the new data', () => {
  it('round-trips annotations and layouts, and imports backups made before them', async () => {
    const book = (await http.post('/readings', { title: 'Livro' })).body.data;
    const ann = await note('', doc(text('#tag')), { role: 'annotation', readingId: book.id, page: 5, quote: 'trecho' });
    const t = await topic('T');
    await http.put(`/layouts/mindmap:topic:${t.id}`, { data: { positions: {} } });

    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of BACKUP_TABLE_ORDER) tables[table] = (await http.get(`/backup/export/${table}`)).body.data.rows;
    expect(tables.notes![0]).toMatchObject({ role: 'annotation', reading_id: book.id, page: 5, quote: 'trecho' });
    expect(tables.view_layouts).toHaveLength(1);
    expect(BACKUP_TABLE_ORDER.indexOf('readings')).toBeLessThan(BACKUP_TABLE_ORDER.indexOf('notes'));

    // Import into another account, as a backup from before 0002 (no new columns).
    const other = client((await setupOwner()).token);
    const legacyNotes = tables.notes!.map(({ role: _r, reading_id: _b, page: _p, annotation_type: _a, quote: _q, ...rest }) => ({
      ...rest,
      id: uuidv7(),
    }));
    const manifest = (await other.get('/backup/manifest')).body.data;
    const job = (await other.post('/backup/imports', { mode: 'merge', manifest })).body.data.jobId;
    expect((await other.post(`/backup/imports/${job}/chunks`, { seq: 0, table: 'notes', rows: legacyNotes })).status).toBe(200);
    const done = await other.post(`/backup/imports/${job}/commit`, { chunkCount: 1 });
    expect(done.status).toBe(200);
    const imported = (await other.get('/notes')).body.data;
    expect(imported[0]).toMatchObject({ role: 'note', readingId: null, page: null });
    // Tags are rebuilt from the imported content.
    expect((await other.get('/tags')).body.data).toEqual([{ tag: 'tag', count: 1 }]);
    expect(ann.id).toBeTruthy();
  });
});
