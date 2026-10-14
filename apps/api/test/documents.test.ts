import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, client, setupOwner, type LoggedIn } from './helpers';

let owner: LoggedIn;
let http: ReturnType<typeof client>;

beforeEach(async () => {
  owner = await setupOwner();
  http = client(owner.token);
});

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function register(name = 'livro.pdf', mimeType = 'application/pdf', size = PDF.byteLength) {
  const res = await http.post('/documents', { originalName: name, mimeType, sizeBytes: size });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function upload(id: string, bytes: Uint8Array, contentType = 'application/pdf', token = owner.token) {
  return api('PUT', `/documents/${id}/content`, {
    token,
    rawBody: bytes,
    headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength) },
  });
}

describe('documents', () => {
  it('uploads to R2 with a random key and downloads with authentication', async () => {
    const doc = await register();
    expect(doc.status).toBe('pending');
    const up = await upload(doc.id, PDF);
    expect(up.status).toBe(200);
    const meta = (await up.json()) as { data: { status: string } };
    expect(meta.data.status).toBe('ready');

    const row = await env.DB.prepare('SELECT storage_key FROM documents WHERE id = ?').bind(doc.id).first<{ storage_key: string }>();
    expect(row!.storage_key).not.toContain('livro');
    expect(await env.FILES.head(row!.storage_key)).not.toBeNull();

    const unauth = await api('GET', `/documents/${doc.id}/content`);
    expect(unauth.status).toBe(401);
    const down = await api('GET', `/documents/${doc.id}/content`, { token: owner.token });
    expect(down.status).toBe(200);
    expect(down.headers.get('Content-Type')).toBe('application/pdf');
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(PDF);
  });

  it('supports Range requests for the PDF viewer', async () => {
    const doc = await register();
    await upload(doc.id, PDF);
    const res = await api('GET', `/documents/${doc.id}/content`, { token: owner.token, headers: { Range: 'bytes=0-4' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-4/${PDF.byteLength}`);
    expect(await res.text()).toBe('%PDF-');
  });

  it('rejects disallowed types and mismatched signatures', async () => {
    const bad = await http.post('/documents', { originalName: 'x.html', mimeType: 'text/html', sizeBytes: 10 });
    expect(bad.status).toBe(415);
    const mismatch = await http.post('/documents', { originalName: 'x.pdf', mimeType: 'image/png', sizeBytes: 10 });
    expect(mismatch.status).toBe(415);

    const doc = await register('falso.pdf', 'application/pdf', 20);
    const fake = new TextEncoder().encode('<html>not a pdf</html>');
    const res = await upload(doc.id, fake);
    expect(res.status).toBe(415);
    const listed = await env.FILES.list({ prefix: `files/${owner.user.id}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it('accepts large files (sent in parts) and rejects single requests above the Worker limit', async () => {
    const big = await http.post('/documents', { originalName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 500 * 1024 * 1024 });
    expect(big.status).toBe(201);
    const huge = await http.post('/documents', { originalName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 600 * 1024 ** 3 });
    expect(huge.status).toBe(413);
    const tooBigForOneRequest = await api('PUT', `/documents/${big.body.data.id}/content`, {
      token: owner.token,
      rawBody: PDF,
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(200 * 1024 * 1024) },
    });
    expect(tooBigForOneRequest.status).toBe(413);
  });

  it('uploads a file in parts and serves it whole', async () => {
    const first = new Uint8Array(5 * 1024 * 1024).fill(0x20); // R2: every part but the last has at least 5 MiB
    first.set(PDF.subarray(0, 8));
    const last = new TextEncoder().encode('\n%%EOF\n');
    const doc = await register('grande.pdf', 'application/pdf', first.byteLength + last.byteLength);
    const start = await http.post(`/documents/${doc.id}/uploads`);
    expect(start.status).toBe(200);
    const { token } = start.body.data;

    const sendPart = (n: number, bytes: Uint8Array, t = token, docId = doc.id) =>
      api('PUT', `/documents/${docId}/uploads/parts/${n}?token=${encodeURIComponent(t)}`, {
        token: owner.token,
        rawBody: bytes,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) },
      });
    const p1 = await sendPart(1, first);
    expect(p1.status).toBe(200);
    const p2 = await sendPart(2, last);
    const parts = [(await p1.json() as { data: object }).data, (await p2.json() as { data: object }).data];

    // The token is bound to this document and cannot be forged.
    const other = await register('outro.pdf');
    expect((await sendPart(1, last, token, other.id)).status).toBe(400);
    expect((await sendPart(1, last, `${token.split('.')[0]}.forjada`)).status).toBe(400);

    const done = await http.post(`/documents/${doc.id}/uploads/complete`, { token, parts });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'ready', sizeBytes: first.byteLength + last.byteLength });
    const down = await api('GET', `/documents/${doc.id}/content`, { token: owner.token });
    expect((await down.arrayBuffer()).byteLength).toBe(first.byteLength + last.byteLength);
  });

  it('rejects a file in parts whose content is not of the declared type, and can abort', async () => {
    const doc = await register('falso.pdf', 'application/pdf', 20);
    const { token } = (await http.post(`/documents/${doc.id}/uploads`)).body.data;
    const html = new TextEncoder().encode('<html>not a pdf</html>');
    const part = await api('PUT', `/documents/${doc.id}/uploads/parts/1?token=${encodeURIComponent(token)}`, {
      token: owner.token,
      rawBody: html,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(html.byteLength) },
    });
    const done = await http.post(`/documents/${doc.id}/uploads/complete`, { token, parts: [(await part.json() as { data: object }).data] });
    expect(done.status).toBe(415);
    expect((await env.FILES.list({ prefix: `files/${owner.user.id}/` })).objects).toHaveLength(0);

    const second = (await http.post(`/documents/${doc.id}/uploads`)).body.data;
    expect((await http.post(`/documents/${doc.id}/uploads/abort`, { token: second.token })).status).toBe(204);
  });

  it('issues short-lived signed links', async () => {
    const doc = await register();
    await upload(doc.id, PDF);
    const link = await http.post(`/documents/${doc.id}/link`, { download: true });
    expect(link.status).toBe(200);
    const url = new URL(link.body.data.url);
    const res = await api('GET', `${url.pathname.replace('/api/v1', '')}${url.search}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);

    url.searchParams.set('dl', '0');
    const tampered = await api('GET', `${url.pathname.replace('/api/v1', '')}${url.search}`);
    expect(tampered.status).toBe(403);
  });

  it('replaces the file and removes the old object; purge deletes from R2', async () => {
    const doc = await register();
    await upload(doc.id, PDF);
    const first = await env.DB.prepare('SELECT storage_key FROM documents WHERE id = ?').bind(doc.id).first<{ storage_key: string }>();
    await upload(doc.id, PDF);
    const second = await env.DB.prepare('SELECT storage_key FROM documents WHERE id = ?').bind(doc.id).first<{ storage_key: string }>();
    expect(second!.storage_key).not.toBe(first!.storage_key);
    expect(await env.FILES.head(first!.storage_key)).toBeNull();

    expect((await http.del(`/documents/${doc.id}`)).status).toBe(204);
    expect((await api('GET', `/documents/${doc.id}/content`, { token: owner.token })).status).toBe(404);
    expect((await http.del(`/trash/document/${doc.id}`)).status).toBe(200);
    expect(await env.FILES.head(second!.storage_key)).toBeNull();
  });

  it('lists with filters and search (accent-insensitive)', async () => {
    await register('Economia Política.pdf');
    await register('foto.png', 'image/png', 10);
    expect((await http.get('/documents?type=pdf')).body.data).toHaveLength(1);
    expect((await http.get('/documents?q=politica')).body.data).toHaveLength(1);
    expect((await http.get('/documents?type=image')).body.data).toHaveLength(1);
  });

  it('does not expose documents of another user', async () => {
    const doc = await register();
    await upload(doc.id, PDF);
    const intruder = await setupOwner();
    expect((await api('GET', `/documents/${doc.id}`, { token: intruder.token })).status).toBe(404);
    expect((await api('GET', `/documents/${doc.id}/content`, { token: intruder.token })).status).toBe(404);
    expect((await upload(doc.id, PDF, 'application/pdf', intruder.token)).status).toBe(404);
  });
});
