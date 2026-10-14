import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, createDevice, createUser, json, login, signChallenge } from './helpers';

async function refreshWith(
  device: Awaited<ReturnType<typeof createDevice>>,
  sessionId: string,
  tamper?: (c: string) => string,
) {
  const ch = await json(await api('POST', '/auth/challenge'));
  const challenge = tamper ? tamper(ch.data.challenge) : ch.data.challenge;
  const signature = await signChallenge(device, sessionId, challenge);
  return { res: await api('POST', '/auth/refresh', { body: { sessionId, challenge, signature } }), challenge, signature };
}

describe('initial account', () => {
  it('has no public sign-up endpoint', async () => {
    for (const path of ['/auth/register', '/auth/signup', '/users']) {
      const res = await api('POST', path, { body: { username: 'x', password: 'y' } });
      expect([401, 404]).toContain(res.status);
    }
  });

  it('stores only hashes, never the verifier', async () => {
    const user = await createUser('alice');
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Record<string, string>>();
    expect(row).not.toBeNull();
    expect(Object.values(row!).join('|')).not.toContain(user.verifier);
    expect(row!.verifier_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('prelogin', () => {
  it('returns the stored KDF params for a known user', async () => {
    await createUser('bob');
    const res = await api('POST', '/auth/prelogin', { body: { username: 'bob' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.kdf.alg).toBe('argon2id');
  });

  it('returns stable fake params for unknown users (no enumeration)', async () => {
    const a = await json(await api('POST', '/auth/prelogin', { body: { username: 'ghost' } }));
    const b = await json(await api('POST', '/auth/prelogin', { body: { username: 'ghost' } }));
    expect(a.data.kdf.salt).toBe(b.data.kdf.salt);
    expect(a.data.kdf.salt).toHaveLength(22);
  });
});

describe('login', () => {
  it('logs in with the right verifier and accesses private routes', async () => {
    const session = await login(await createUser('carol'));
    expect(session.token.length).toBeGreaterThan(30);
    const me = await api('GET', '/auth/me', { token: session.token });
    expect(me.status).toBe(200);
    expect((await json(me)).data.username).toBe('carol');
  });

  it('stores only a hash of the access token', async () => {
    const session = await login(await createUser('dave'));
    const rows = await env.DB.prepare('SELECT token_hash FROM access_tokens').all<{ token_hash: string }>();
    expect(rows.results.map((r) => r.token_hash)).not.toContain(session.token);
  });

  it('rejects a wrong verifier with a generic message', async () => {
    const user = await createUser('erin');
    const device = await createDevice();
    const wrong = await api('POST', '/auth/login', {
      body: { username: 'erin', verifier: 'A'.repeat(43), publicKey: device.publicJwk },
    });
    const unknown = await api('POST', '/auth/login', {
      body: { username: 'nobody', verifier: user.verifier, publicKey: device.publicJwk },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await json(wrong)).error.message).toBe((await json(unknown)).error.message);
  });

  it('rate-limits repeated failures per IP', async () => {
    await createUser('frank');
    const device = await createDevice();
    const attempt = () =>
      api('POST', '/auth/login', {
        body: { username: 'frank', verifier: 'B'.repeat(43), publicKey: device.publicJwk },
        headers: { 'CF-Connecting-IP': '198.51.100.20' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('validates input', async () => {
    const res = await api('POST', '/auth/login', { body: { username: 'x' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('validation_error');
  });
});

describe('session lifecycle', () => {
  it('refreshes with a valid device signature', async () => {
    const s = await login(await createUser('gina'));
    const { res } = await refreshWith(s.device, s.auth.sessionId);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.accessToken).not.toBe(s.token);
    expect((await api('GET', '/auth/me', { token: body.data.accessToken })).status).toBe(200);
  });

  it('rejects refresh signed by another device', async () => {
    const s = await login(await createUser('hank'));
    const other = await createDevice();
    const { res } = await refreshWith(other, s.auth.sessionId);
    expect(res.status).toBe(401);
  });

  it('rejects a replayed challenge', async () => {
    const s = await login(await createUser('ivy'));
    const first = await refreshWith(s.device, s.auth.sessionId);
    expect(first.res.status).toBe(200);
    const replay = await api('POST', '/auth/refresh', {
      body: { sessionId: s.auth.sessionId, challenge: first.challenge, signature: first.signature },
    });
    expect(replay.status).toBe(401);
  });

  it('rejects a forged challenge', async () => {
    const s = await login(await createUser('jack'));
    const { res } = await refreshWith(s.device, s.auth.sessionId, (c) => {
      const [nonce, exp] = c.split('.');
      return `${nonce}.${Number(exp) + 3600}.AAAA`;
    });
    expect(res.status).toBe(401);
  });

  it('expires access tokens', async () => {
    const s = await login(await createUser('kim'));
    await env.DB.prepare("UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await api('GET', '/auth/me', { token: s.token })).status).toBe(401);
  });

  it('expires idle sessions on refresh', async () => {
    const s = await login(await createUser('lee'));
    await env.DB.prepare("UPDATE sessions SET last_used_at = '2000-01-01T00:00:00.000Z'").run();
    const { res } = await refreshWith(s.device, s.auth.sessionId);
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe('session_expired');
  });

  it('logout revokes the session and its tokens', async () => {
    const s = await login(await createUser('mia'));
    expect((await api('POST', '/auth/logout', { token: s.token })).status).toBe(204);
    expect((await api('GET', '/auth/me', { token: s.token })).status).toBe(401);
    const { res } = await refreshWith(s.device, s.auth.sessionId);
    expect(res.status).toBe(401);
  });

  it('lists and revokes other sessions', async () => {
    const user = await createUser('ned');
    const a = await login(user);
    const b = await login(user);
    const list = await json(await api('GET', '/auth/sessions', { token: a.token }));
    expect(list.data).toHaveLength(2);
    expect(list.data.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    const del = await api('DELETE', `/auth/sessions/${b.auth.sessionId}`, { token: a.token });
    expect(del.status).toBe(204);
    expect((await api('GET', '/auth/me', { token: b.token })).status).toBe(401);
    expect((await api('GET', '/auth/me', { token: a.token })).status).toBe(200);
  });

  it('changes the password and revokes other sessions', async () => {
    const user = await createUser('olga');
    const a = await login(user);
    const b = await login(user);
    const newVerifier = 'C'.repeat(43);
    const res = await api('POST', '/auth/password', {
      token: a.token,
      body: {
        currentVerifier: user.verifier,
        newVerifier,
        newKdf: { alg: 'argon2id', salt: 'bmV3c2FsdG5ld3NhbHQxMg', memoryKiB: 65536, iterations: 2, parallelism: 1, hashLength: 32 },
      },
    });
    expect(res.status).toBe(204);
    expect((await api('GET', '/auth/me', { token: b.token })).status).toBe(401);
    expect((await api('GET', '/auth/me', { token: a.token })).status).toBe(200);
    await expect(login({ ...user, verifier: newVerifier })).resolves.toBeTruthy();
    await expect(login(user)).rejects.toThrow();
  });

  it('rejects password change with wrong current password', async () => {
    const user = await createUser('pia');
    const a = await login(user);
    const res = await api('POST', '/auth/password', {
      token: a.token,
      body: {
        currentVerifier: 'D'.repeat(43),
        newVerifier: 'E'.repeat(43),
        newKdf: { alg: 'argon2id', salt: 'bmV3c2FsdG5ld3NhbHQxMg', memoryKiB: 65536, iterations: 2, parallelism: 1, hashLength: 32 },
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('transport security', () => {
  it('requires a bearer token on private routes', async () => {
    expect((await api('GET', '/auth/me')).status).toBe(401);
    expect((await api('GET', '/auth/me', { headers: { Authorization: 'Bearer invalid-token-value-xxxxxxxx' } })).status).toBe(401);
  });

  it('allows only configured CORS origins', async () => {
    const allowed = await api('OPTIONS', '/auth/me', {
      headers: { Origin: 'https://owner.github.io', 'Access-Control-Request-Method': 'GET' },
    });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://owner.github.io');
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBeNull();

    const denied = await api('OPTIONS', '/auth/me', {
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sets security headers and hides internals in errors', async () => {
    // Unknown routes are not revealed to unauthenticated callers (default deny).
    expect((await api('GET', '/does-not-exist')).status).toBe(401);
    const s = await login(await createUser('quinn'));
    const res = await api('GET', '/does-not-exist', { token: s.token });
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await json(res);
    expect(body.error.code).toBe('not_found');
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\.ts/);
  });

  it('serves health publicly', async () => {
    const res = await api('GET', '/health');
    expect(res.status).toBe(200);
  });
});
