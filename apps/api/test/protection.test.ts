import { describe, expect, it } from 'vitest';
import { api, json } from './helpers';

const SAMPLE_ID = '0190f0c0-0000-7000-8000-000000000000';
const PUBLIC = new Set([
  'GET /health',
  'POST /auth/prelogin',
  'POST /auth/login',
  'POST /auth/challenge',
  'POST /auth/refresh',
  'GET /files/{id}',
  'GET /openapi.json',
]);

describe('route protection', () => {
  it('requires authentication on every private route listed in the OpenAPI document', async () => {
    const doc = await json(await api('GET', '/openapi.json'));
    const routes: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths as Record<string, Record<string, unknown>>)) {
      for (const method of Object.keys(ops)) routes.push(`${method.toUpperCase()} ${path}`);
    }
    expect(routes.length).toBeGreaterThan(60);

    const failures: string[] = [];
    for (const route of routes) {
      if (PUBLIC.has(route)) continue;
      const [method, path] = route.split(' ') as [string, string];
      const concrete = path
        .replace(/\{(id|itemId|revisionId|entityId)\}/g, SAMPLE_ID)
        .replace('{type}', 'note')
        .replace('{entityType}', 'note')
        .replace('{table}', 'topics')
        .replace('{key}', 'ui');
      const res = await api(method, concrete, method === 'GET' || method === 'DELETE' ? {} : { body: {} });
      if (res.status !== 401) failures.push(`${route} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('marks private operations with bearer security in the OpenAPI document', async () => {
    const doc = await json(await api('GET', '/openapi.json'));
    const missing: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths as Record<string, Record<string, { security?: unknown[] }>>)) {
      for (const [method, op] of Object.entries(ops)) {
        const route = `${method.toUpperCase()} ${path}`;
        if (!PUBLIC.has(route) && !(op.security && op.security.length > 0)) missing.push(route);
      }
    }
    expect(missing).toEqual([]);
  });

  it('rejects signed file links that are forged or expired', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const forged = await api('GET', `/files/${SAMPLE_ID}?exp=${exp}&dl=0&sig=AAAA`);
    expect(forged.status).toBe(403);
    const expired = await api('GET', `/files/${SAMPLE_ID}?exp=1000&dl=0&sig=AAAA`);
    expect(expired.status).toBe(403);
  });
});
