import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_KDF,
  REFRESH_CHALLENGE_TTL_SECONDS,
  SERVER_VERIFIER_ITERATIONS,
  uuidv7,
  zKdfParams,
  type AuthResponse,
  type KdfParams,
  type PublicJwk,
  type Session,
  type User,
} from '@mynotes/shared';
import { authSecret, runtimeConfig } from '../../env';
import { ApiError, rateLimited, unauthorized } from '../../lib/errors';
import {
  fromBase64,
  hmacBase64Url,
  hmacVerify,
  importDevicePublicKey,
  pbkdf2,
  randomBytes,
  randomToken,
  sha256,
  timingSafeEqual,
  toBase64Url,
  verifyDeviceSignature,
} from '../../lib/crypto';
import { all, first, parseJson, run, stmt, type Row } from '../../lib/db';
import { isoAfter, isoBefore, nowIso } from '../../lib/time';

/**
 * Iterations of the server-side PBKDF2 over the client-derived key. The slow,
 * memory-hard step (Argon2id) runs on the client; see docs/security.md.
 * Stored per user so it can be raised later without breaking logins.
 */
export { SERVER_VERIFIER_ITERATIONS };

export const LOGIN_LIMITS = {
  ip: { max: 10, windowSeconds: 15 * 60 },
  user: { max: 20, windowSeconds: 60 * 60 },
} as const;

const GENERIC_LOGIN_ERROR = 'Usuário ou senha inválidos';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  kdf_params: string;
  verifier_hash: string;
  verifier_salt: string;
  verifier_iterations: number;
  password_changed_at: string;
  created_at: string;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    passwordChangedAt: row.password_changed_at,
  };
}

/** Computes the stored verifier for a client key (also used by tests and the admin script logic). */
export async function hashVerifier(verifierB64: string, saltB64: string, iterations: number): Promise<string> {
  return toBase64Url(await pbkdf2(fromBase64(verifierB64), fromBase64(saltB64), iterations));
}

async function verifierMatches(user: UserRow, verifierB64: string): Promise<boolean> {
  const computed = await pbkdf2(fromBase64(verifierB64), fromBase64(user.verifier_salt), user.verifier_iterations);
  return timingSafeEqual(computed, fromBase64(user.verifier_hash));
}

/** Pseudonymous rate-limit bucket for the client IP (raw IPs are never stored). */
async function ipBucket(env: Env, ip: string): Promise<string> {
  return `ip:${(await hmacBase64Url(authSecret(env), `ip:${ip}`)).slice(0, 32)}`;
}

async function assertNotRateLimited(db: D1Database, bucket: string, max: number, windowSeconds: number) {
  const since = isoBefore(windowSeconds);
  const row = await first<{ n: number; oldest: string | null }>(
    db,
    'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM login_attempts WHERE bucket = ? AND success = 0 AND created_at > ?',
    bucket,
    since,
  );
  if (row && row.n >= max) {
    const oldest = row.oldest ? Date.parse(row.oldest) : Date.now();
    throw rateLimited((oldest + windowSeconds * 1000 - Date.now()) / 1000);
  }
}

async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return first<UserRow>(db, 'SELECT * FROM users WHERE username = ?', username);
}

/**
 * Returns the KDF parameters for a username. For unknown usernames, returns
 * deterministic fake parameters so the response does not reveal whether the
 * account exists.
 */
export async function prelogin(env: Env, username: string): Promise<KdfParams> {
  const user = await findUserByUsername(env.DB, username);
  if (user) return zKdfParams.parse(parseJson(user.kdf_params, null));
  const fakeSalt = (await hmacBase64Url(authSecret(env), `prelogin:${username}`)).slice(0, 22);
  return { ...DEFAULT_KDF, salt: fakeSalt };
}

async function createAccessToken(db: D1Database, sessionId: string) {
  const token = randomToken(32);
  const expiresAt = isoAfter(ACCESS_TOKEN_TTL_SECONDS);
  return {
    token,
    expiresAt,
    statement: stmt(
      db,
      'INSERT INTO access_tokens (token_hash, session_id, expires_at) VALUES (?, ?, ?)',
      await sha256(token),
      sessionId,
      expiresAt,
    ),
  };
}

export interface LoginInput {
  username: string;
  verifier: string;
  publicKey: PublicJwk;
  deviceLabel?: string | undefined;
}

export async function login(env: Env, input: LoginInput, ip: string): Promise<AuthResponse> {
  const db = env.DB;
  const ipKey = await ipBucket(env, ip);
  const userKey = `user:${input.username}`;
  await assertNotRateLimited(db, ipKey, LOGIN_LIMITS.ip.max, LOGIN_LIMITS.ip.windowSeconds);
  await assertNotRateLimited(db, userKey, LOGIN_LIMITS.user.max, LOGIN_LIMITS.user.windowSeconds);

  const user = await findUserByUsername(db, input.username);
  let valid = false;
  if (user) {
    valid = await verifierMatches(user, input.verifier);
  } else {
    // Equalize timing with the existing-user path.
    await pbkdf2(fromBase64(input.verifier), randomBytes(16), SERVER_VERIFIER_ITERATIONS);
  }

  const now = nowIso();
  if (!user || !valid) {
    await db.batch([
      stmt(db, 'INSERT INTO login_attempts (bucket, success, created_at) VALUES (?, 0, ?)', ipKey, now),
      stmt(db, 'INSERT INTO login_attempts (bucket, success, created_at) VALUES (?, 0, ?)', userKey, now),
    ]);
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }

  try {
    await importDevicePublicKey(input.publicKey);
  } catch {
    throw new ApiError('bad_request', 'Chave do dispositivo inválida');
  }

  const config = runtimeConfig(env);
  const sessionId = uuidv7();
  const sessionExpiresAt = isoAfter(config.sessionMaxSeconds);
  const access = await createAccessToken(db, sessionId);
  await db.batch([
    stmt(
      db,
      `INSERT INTO sessions (id, user_id, public_key, device_label, created_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      user.id,
      JSON.stringify(input.publicKey),
      input.deviceLabel?.slice(0, 120) || null,
      now,
      now,
      sessionExpiresAt,
    ),
    access.statement,
    stmt(db, 'DELETE FROM login_attempts WHERE bucket = ? AND success = 0', ipKey),
    stmt(db, 'INSERT INTO login_attempts (bucket, success, created_at) VALUES (?, 1, ?)', userKey, now),
  ]);

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    sessionId,
    sessionExpiresAt,
    user: toUser(user),
  };
}

/** Stateless, HMAC-signed, short-lived challenge. Single use is enforced on refresh. */
export async function issueChallenge(env: Env): Promise<{ challenge: string; expiresAt: string }> {
  const nonce = randomToken(16);
  const exp = Math.floor(Date.now() / 1000) + REFRESH_CHALLENGE_TTL_SECONDS;
  const sig = await hmacBase64Url(authSecret(env), `refresh-challenge:${nonce}.${exp}`);
  return { challenge: `${nonce}.${exp}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function refreshMessage(sessionId: string, challenge: string): string {
  return `mynotes-refresh:${sessionId}:${challenge}`;
}

export interface RefreshInput {
  sessionId: string;
  challenge: string;
  signature: string;
}

const SESSION_EXPIRED = () => new ApiError('session_expired', 'Sessão expirada. Entre novamente.');

export async function refresh(env: Env, input: RefreshInput): Promise<AuthResponse> {
  const db = env.DB;
  const parts = input.challenge.split('.');
  if (parts.length !== 3) throw SESSION_EXPIRED();
  const [nonce, expStr, sig] = parts as [string, string, string];
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) throw SESSION_EXPIRED();
  if (!(await hmacVerify(authSecret(env), `refresh-challenge:${nonce}.${exp}`, sig))) throw SESSION_EXPIRED();

  const session = await first<Row & { user_id: string; public_key: string; last_used_at: string }>(
    db,
    'SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?',
    input.sessionId,
    nowIso(),
  );
  if (!session) throw SESSION_EXPIRED();

  const config = runtimeConfig(env);
  if (Date.parse(session.last_used_at) + config.sessionIdleSeconds * 1000 < Date.now()) {
    await run(db, 'UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso(), input.sessionId);
    throw SESSION_EXPIRED();
  }

  let signatureOk: boolean;
  try {
    const key = await importDevicePublicKey(parseJson<JsonWebKey>(session.public_key, { kty: "EC" }));
    signatureOk = await verifyDeviceSignature(
      key,
      fromBase64(input.signature),
      refreshMessage(input.sessionId, input.challenge),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw SESSION_EXPIRED();

  // Consume the challenge: a replayed (challenge, signature) pair fails here.
  const consumed = await run(
    db,
    'INSERT INTO auth_nonces (nonce_hash, expires_at) VALUES (?, ?) ON CONFLICT (nonce_hash) DO NOTHING',
    await sha256(nonce),
    new Date(exp * 1000).toISOString(),
  );
  if (consumed.meta.changes !== 1) throw SESSION_EXPIRED();

  const user = await first<UserRow>(db, 'SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user) throw SESSION_EXPIRED();

  const access = await createAccessToken(db, input.sessionId);
  await db.batch([
    access.statement,
    stmt(db, 'UPDATE sessions SET last_used_at = ? WHERE id = ?', nowIso(), input.sessionId),
  ]);
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    sessionId: input.sessionId,
    sessionExpiresAt: String(session.expires_at),
    user: toUser(user),
  };
}

export async function revokeSession(db: D1Database, userId: string, sessionId: string): Promise<boolean> {
  const res = await db.batch([
    stmt(
      db,
      'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      nowIso(),
      sessionId,
      userId,
    ),
    stmt(
      db,
      'DELETE FROM access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE id = ? AND user_id = ?)',
      sessionId,
      userId,
    ),
  ]);
  return (res[0]?.meta.changes ?? 0) > 0;
}

export async function revokeOtherSessions(db: D1Database, userId: string, keepSessionId: string): Promise<number> {
  const res = await db.batch([
    stmt(
      db,
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      nowIso(),
      userId,
      keepSessionId,
    ),
    stmt(
      db,
      'DELETE FROM access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ? AND id <> ?)',
      userId,
      keepSessionId,
    ),
  ]);
  return res[0]?.meta.changes ?? 0;
}

export async function listSessions(db: D1Database, userId: string, currentSessionId: string): Promise<Session[]> {
  const rows = await all<Row>(
    db,
    `SELECT id, device_label, created_at, last_used_at, expires_at FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_used_at DESC`,
    userId,
    nowIso(),
  );
  return rows.map((r) => ({
    id: String(r.id),
    deviceLabel: (r.device_label as string | null) ?? null,
    createdAt: String(r.created_at),
    lastUsedAt: String(r.last_used_at),
    expiresAt: String(r.expires_at),
    current: r.id === currentSessionId,
  }));
}

export async function getUser(db: D1Database, userId: string): Promise<User> {
  const user = await first<UserRow>(db, 'SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw unauthorized();
  return toUser(user);
}

export async function changePassword(
  env: Env,
  userId: string,
  sessionId: string,
  input: { currentVerifier: string; newVerifier: string; newKdf: KdfParams },
): Promise<void> {
  const db = env.DB;
  const user = await first<UserRow>(db, 'SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw unauthorized();
  const userKey = `user:${user.username}`;
  await assertNotRateLimited(db, userKey, LOGIN_LIMITS.user.max, LOGIN_LIMITS.user.windowSeconds);

  if (!(await verifierMatches(user, input.currentVerifier))) {
    await run(db, 'INSERT INTO login_attempts (bucket, success, created_at) VALUES (?, 0, ?)', userKey, nowIso());
    throw new ApiError('forbidden', 'Senha atual incorreta');
  }
  const currentKdf = zKdfParams.parse(parseJson(user.kdf_params, null));
  if (input.newKdf.salt === currentKdf.salt) {
    throw new ApiError('bad_request', 'Use um novo salt ao trocar a senha');
  }

  const salt = toBase64Url(randomBytes(16));
  const hash = await hashVerifier(input.newVerifier, salt, SERVER_VERIFIER_ITERATIONS);
  const now = nowIso();
  await db.batch([
    stmt(
      db,
      `UPDATE users SET kdf_params = ?, verifier_hash = ?, verifier_salt = ?, verifier_iterations = ?,
              password_changed_at = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(input.newKdf),
      hash,
      salt,
      SERVER_VERIFIER_ITERATIONS,
      now,
      now,
      userId,
    ),
    stmt(
      db,
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      now,
      userId,
      sessionId,
    ),
    stmt(
      db,
      'DELETE FROM access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ? AND id <> ?)',
      userId,
      sessionId,
    ),
  ]);
}
