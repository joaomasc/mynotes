import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLE_ORDER, uuidv7 } from '@mynotes/shared';
import { api, client, setupOwner } from './helpers';

type Http = ReturnType<typeof client>;

async function exportAll(http: Http) {
  const manifest = (await http.get('/backup/manifest')).body.data;
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLE_ORDER) {
    tables[table] = [];
    let cursor: string | null = null;
    do {
      const res: { status: number; body: { data: any } } = await http.get(
        `/backup/export/${table}${cursor ? `?cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      tables[table].push(...res.body.data.rows);
      cursor = res.body.data.nextCursor;
    } while (cursor);
  }
  return { manifest, tables };
}

async function importAll(
  http: Http,
  backup: Awaited<ReturnType<typeof exportAll>>,
  mode: 'merge' | 'replace',
  confirm?: string,
) {
  const job = await http.post('/backup/imports', { mode, manifest: backup.manifest });
  expect(job.status).toBe(201);
  const jobId = job.body.data.jobId;
  let seq = 0;
  for (const table of BACKUP_TABLE_ORDER) {
    const rows = backup.tables[table]!;
    for (let i = 0; i < rows.length; i += 50) {
      const res = await http.post(`/backup/imports/${jobId}/chunks`, { seq: seq++, table, rows: rows.slice(i, i + 50) });
      expect(res.status).toBe(200);
    }
  }
  return http.post(`/backup/imports/${jobId}/commit`, { chunkCount: seq, ...(confirm ? { confirm } : {}) });
}

async function seed(http: Http) {
  const t1 = (await http.post('/topics', { title: 'Economia' })).body.data;
  const t2 = (await http.post('/topics', { title: 'Macro', parentId: t1.id })).body.data;
  const n1 = (await http.post('/notes', { title: 'Inflação', topicId: t2.id })).body.data;
  await http.patch(`/notes/${n1.id}`, {
    baseVersion: 1,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preços sobem' }] }] },
  });
  const doc = (await http.post('/documents', { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9, topicId: t1.id })).body.data;
  const r = (await http.post('/readings', { title: 'Livro', documentId: doc.id })).body.data;
  const plan = (await http.post('/plans', { title: 'Plano' })).body.data;
  await http.post(`/plans/${plan.id}/items`, { title: 'Etapa', readingId: r.id });
  await http.post('/study-sessions', {
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    durationSeconds: 600,
    noteIds: [n1.id],
  });
  await http.post('/relations', { sourceType: 'note', sourceId: n1.id, targetType: 'topic', targetId: t1.id });
  await http.post('/favorites', { entityType: 'note', entityId: n1.id });
  await http.post('/mind-maps', { title: 'Mapa' });
  await http.post('/mind-maps', { title: 'Quadro', kind: 'canvas', noteId: n1.id });
  await http.put('/settings/ui', { value: { theme: 'dark' } });
  return { t1, t2, n1, doc };
}

describe('backup', () => {
  it('exports everything and restores it after data loss (round trip)', async () => {
    const owner = await setupOwner();
    const a = client(owner.token);
    const { n1 } = await seed(a);
    const backup = await exportAll(a);
    expect(backup.tables.notes).toHaveLength(1);
    expect(backup.tables.users).toBeUndefined();
    expect(JSON.stringify(backup)).not.toMatch(/verifier|storage_key|token_hash/);

    // Another user importing the same backup cannot take over existing rows (ids are global).
    const b = client((await setupOwner()).token);
    expect((await importAll(b, backup, 'merge')).status).toBe(200);
    expect((await b.get('/notes')).body.data).toHaveLength(0);
    expect((await a.get('/notes')).body.data).toHaveLength(1);

    // Simulate data loss for the owner, then restore.
    const uid = owner.user.id;
    await env.DB.batch(
      ['topics', 'notes', 'documents', 'readings', 'reading_plans', 'study_sessions', 'relations', 'favorites', 'mind_maps', 'settings', 'concepts'].map(
        (t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid),
      ),
    );
    expect((await a.get('/notes')).body.data).toHaveLength(0);

    const result = await importAll(a, backup, 'merge');
    expect(result.status).toBe(200);
    const restored = (await a.get(`/notes/${n1.id}`)).body.data;
    expect(restored.content.content[0].content[0].text).toBe('Preços sobem');
    expect((await a.get('/topics')).body.data).toHaveLength(2);
    expect((await a.get('/favorites')).body.data).toHaveLength(1);
    expect((await a.get('/mind-maps?kind=canvas')).body.data).toMatchObject([{ title: 'Quadro', noteId: n1.id }]);
    expect((await a.get('/plans')).body.data[0].itemCount).toBe(1);
    const sessions = (await a.get('/study-sessions')).body.data;
    expect(sessions[0].noteIds).toEqual([n1.id]);
    expect(result.body.data.documentsAwaitingFile).toHaveLength(1);
  });

  it('keeps the review: cards with their schedule, answers, sessions and free recall', async () => {
    const owner = await setupOwner();
    const a = client(owner.token);
    const today = new Date().toISOString().slice(0, 10);
    const t = (await a.post('/topics', { title: 'Química' })).body.data;
    const n = (await a.post('/notes', { title: 'Água', topicId: t.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A água é formada por hidrogênio e oxigênio.' }] }] } })).body.data;
    const [card] = (await a.post('/review/cards', { kind: 'basic', front: 'Do que é formada a água?', back: 'Hidrogênio e oxigênio', noteId: n.id, sourceQuote: 'formada por hidrogênio e oxigênio' })).body.data;
    const session = (await a.post('/review/sessions', { id: uuidv7(), mode: 'due', topicIds: [t.id], localDay: today })).body.data;
    const answered = (await a.post(`/review/cards/${card.id}/answer`, { id: uuidv7(), sessionId: session.id, rating: 3, confidence: 3, localDay: today })).body.data;
    await a.post(`/review/sessions/${session.id}/finish`, { seconds: 120 });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO review_recalls (id, user_id, topic_id, session_id, text, evaluation_json, coverage, local_day, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'tudo que lembro', NULL, 40, ?, 1, ?, ?)",
    )
      .bind(uuidv7(), owner.user.id, t.id, session.id, today, now, now)
      .run();
    const backup = await exportAll(a);
    expect(backup.manifest.counts).toMatchObject({ review_cards: 1, review_logs: 1, review_sessions: 1, review_recalls: 1 });

    const uid = owner.user.id;
    await env.DB.batch(
      ['review_recalls', 'review_logs', 'review_sessions', 'review_cards', 'study_sessions', 'notes', 'topics'].map((x) => env.DB.prepare(`DELETE FROM ${x} WHERE user_id = ?`).bind(uid)),
    );
    expect((await importAll(a, backup, 'merge')).status).toBe(200);
    const restored = (await a.get(`/review/cards/${card.id}`)).body.data;
    expect(restored.schedule).toEqual(answered.card.schedule);
    expect(restored).toMatchObject({ noteId: n.id, topicId: t.id, sourceChanged: false });
    const summary = (await a.get(`/review/sessions/${session.id}`)).body.data;
    expect(summary).toMatchObject({ items: 1, firstTry: 1, recalls: [{ coverage: 40 }] });
    expect((await a.get('/study-sessions')).body.data[0]).toMatchObject({ source: 'review', durationSeconds: 120 });
  });

  it('merge does not duplicate and keeps newer local changes', async () => {
    const a = client((await setupOwner()).token);
    const { n1 } = await seed(a);
    const backup = await exportAll(a);
    await a.patch(`/notes/${n1.id}`, { baseVersion: 2, title: 'Mais recente' });
    const res = await importAll(a, backup, 'merge');
    expect(res.status).toBe(200);
    expect((await a.get('/notes')).body.data).toHaveLength(1);
    expect((await a.get(`/notes/${n1.id}`)).body.data.title).toBe('Mais recente');
    expect((await a.get('/topics')).body.data).toHaveLength(2);
  });

  it('replace restores the exact backup state, requires confirmation and flags missing files', async () => {
    const a = client((await setupOwner()).token);
    const { n1, doc } = await seed(a);
    const backup = await exportAll(a);
    await a.post('/notes', { title: 'Criada depois' });
    await a.patch(`/notes/${n1.id}`, { baseVersion: 2, title: 'Alterada' });

    const unconfirmed = await importAll(a, backup, 'replace');
    expect(unconfirmed.status).toBe(400);

    const res = await importAll(a, backup, 'replace', 'SUBSTITUIR');
    expect(res.status).toBe(200);
    const notes = (await a.get('/notes')).body.data;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Inflação');
    expect(res.body.data.documentsAwaitingFile).toContain(doc.id);
  });

  it('rejects inconsistent backups atomically (missing parent, cycles)', async () => {
    const a = client((await setupOwner()).token);
    const { t1, t2 } = await seed(a);
    const backup = await exportAll(a);
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first<{ n: number }>();

    // Cycle: Economia -> Macro -> Economia
    const cyclic = structuredClone(backup);
    cyclic.tables.topics = cyclic.tables.topics!.map((t) => (t.id === t1.id ? { ...t, parent_id: t2.id } : t));
    const res = await importAll(a, cyclic, 'replace', 'SUBSTITUIR');
    expect(res.status).toBe(400);

    // Dangling reference
    const dangling = structuredClone(backup);
    dangling.tables.notes = dangling.tables.notes!.map((n) => ({ ...n, topic_id: '0190f0c0-0000-7000-8000-00000000dead' }));
    const res2 = await importAll(a, dangling, 'replace', 'SUBSTITUIR');
    expect(res2.status).toBe(400);

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect((await a.get('/topics')).body.data).toHaveLength(2);
  });

  it('validates chunk rows against the schema', async () => {
    const a = client((await setupOwner()).token);
    const backup = await exportAll(a);
    const job = (await a.post('/backup/imports', { mode: 'merge', manifest: backup.manifest })).body.data;
    const bad = await a.post(`/backup/imports/${job.jobId}/chunks`, {
      seq: 0,
      table: 'topics',
      rows: [{ id: 'not-a-uuid', title: 'x' }],
    });
    expect(bad.status).toBe(400);
    const wrongCount = await a.post(`/backup/imports/${job.jobId}/commit`, { chunkCount: 3 });
    expect(wrongCount.status).toBe(400);
    expect((await api('DELETE', `/backup/imports/${job.jobId}`)).status).toBe(401);
  });
});
