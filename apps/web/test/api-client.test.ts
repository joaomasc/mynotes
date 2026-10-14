import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, setTokenSource } from '@/lib/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenSource(null);
});

describe('api client', () => {
  it('retries a mutation after a network failure with the same Idempotency-Key', async () => {
    vi.useFakeTimers();
    const keys: (string | null)[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'));
        if (++calls === 1) throw new TypeError('Failed to fetch');
        return json(201, { data: { ok: true } });
      }),
    );
    const promise = api.post('/topics', { title: 'x' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
    vi.useRealTimers();
  });

  it('refreshes the access token once on 401 and replays the request', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const auth = new Headers(init.headers).get('Authorization');
        seen.push(auth);
        return auth === 'Bearer novo-token-valido-aaaaaaaaaa' ? json(200, { data: 1 }) : json(401, { error: { code: 'unauthorized', message: 'x' } });
      }),
    );
    const onUnauthenticated = vi.fn();
    setTokenSource({ token: () => 'antigo-token-aaaaaaaaaaaaa', refresh: async () => 'novo-token-valido-aaaaaaaaaa', onUnauthenticated });
    await expect(api.get('/auth/me')).resolves.toBe(1);
    expect(seen).toEqual(['Bearer antigo-token-aaaaaaaaaaaaa', 'Bearer novo-token-valido-aaaaaaaaaa']);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('ends the local session when the refresh is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: { code: 'unauthorized', message: 'Sessão expirada' } })));
    const onUnauthenticated = vi.fn();
    setTokenSource({ token: () => 't', refresh: async () => null, onUnauthenticated });
    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('surfaces server error messages without internals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'version_conflict', message: 'Alterado em outro dispositivo', details: { current: { version: 2 } } } })));
    const err = await api.patch('/notes/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('version_conflict');
  });

  it('reports network failures as NetworkError after retries', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    const promise = api.get('/topics').catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBeInstanceOf(NetworkError);
    vi.useRealTimers();
  });
});
