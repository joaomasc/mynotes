import { env, exports } from 'cloudflare:workers';
import { API_PREFIX, DEFAULT_KDF, uuidv7, type AuthResponse } from '@mynotes/shared';
import { randomBytes, toBase64Url } from '../src/lib/crypto';
import { SERVER_VERIFIER_ITERATIONS, hashVerifier, refreshMessage } from '../src/modules/auth/service';

export const ORIGIN = 'http://localhost:5173';

export interface TestUser {
  id: string;
  username: string;
  /** Stand-in for the Argon2id output the browser would compute. */
  verifier: string;
}

/** Inserts a user the same way the admin script does (hashes only). */
export async function createUser(username = 'owner'): Promise<TestUser> {
  const id = uuidv7();
  const verifier = toBase64Url(randomBytes(32));
  const salt = toBase64Url(randomBytes(16));
  const kdf = { ...DEFAULT_KDF, salt: toBase64Url(randomBytes(16)) };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, username, display_name, kdf_params, verifier_hash, verifier_salt,
       verifier_iterations, password_changed_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      username,
      JSON.stringify(kdf),
      await hashVerifier(verifier, salt, SERVER_VERIFIER_ITERATIONS),
      salt,
      SERVER_VERIFIER_ITERATIONS,
      now,
      now,
      now,
    )
    .run();
  return { id, username, verifier };
}

export interface Device {
  keyPair: CryptoKeyPair;
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
}

export async function createDevice(): Promise<Device> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  return { keyPair, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } };
}

export async function signChallenge(device: Device, sessionId: string, challenge: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    device.keyPair.privateKey,
    new TextEncoder().encode(refreshMessage(sessionId, challenge)),
  );
  return toBase64Url(sig);
}

export interface RequestOptions {
  token?: string | undefined;
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
}

export async function api(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
  headers.set('CF-Connecting-IP', headers.get('CF-Connecting-IP') ?? '203.0.113.7');
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  return exports.default.fetch(
    new Request(`https://api.test${API_PREFIX}${path}`, { method, headers, ...(body === undefined ? {} : { body }) }),
  );
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export interface LoggedIn {
  user: TestUser;
  device: Device;
  auth: AuthResponse;
  token: string;
}

export async function login(user: TestUser, device?: Device): Promise<LoggedIn> {
  const dev = device ?? (await createDevice());
  const res = await api('POST', '/auth/login', {
    body: { username: user.username, verifier: user.verifier, publicKey: dev.publicJwk, deviceLabel: 'Teste' },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { data } = await json<{ data: AuthResponse }>(res);
  return { user, device: dev, auth: data, token: data.accessToken };
}

/** Creates the owner account and logs in. */
export async function setupOwner(): Promise<LoggedIn> {
  return login(await createUser(`owner-${crypto.randomUUID().slice(0, 8)}`));
}

/** Shorthand for authenticated JSON calls returning `data`. */
export function client(token: string) {
  const call = async <T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await api(method, path, { token, body, ...(headers ? { headers } : {}) });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    return { status: res.status, body: parsed as { data: T; meta?: any; error?: any }, headers: res.headers };
  };
  return {
    get: <T = any>(path: string) => call<T>('GET', path),
    post: <T = any>(path: string, body?: unknown, headers?: Record<string, string>) =>
      call<T>('POST', path, body ?? {}, headers),
    patch: <T = any>(path: string, body: unknown) => call<T>('PATCH', path, body),
    put: <T = any>(path: string, body: unknown) => call<T>('PUT', path, body),
    del: <T = any>(path: string) => call<T>('DELETE', path),
  };
}
