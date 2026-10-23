import { uuidv7, zSpeechSettings, type PushStatus, type PushSubscriptionInput } from '@mynotes/shared';
import { fromBase64, toBase64Url } from '../../lib/crypto';
import { ApiError } from '../../lib/errors';
import { all, first, num, parseJson, run, str } from '../../lib/db';
import { nowIso } from '../../lib/time';

/**
 * Daily speaking reminder by Web Push, with no third-party service: the
 * payload is encrypted for the browser (RFC 8291, aes128gcm) and the request
 * is signed with the server's VAPID key (RFC 8292), all with WebCrypto.
 *
 * Keys: VAPID_PUBLIC_KEY (var, base64url of the 65-byte public point),
 * VAPID_PRIVATE_KEY (secret, base64url of the 32-byte private scalar) and
 * VAPID_SUBJECT (var, “mailto:…”). Generate them with `npm run vapid -w @mynotes/api`.
 */

type PushEnv = Partial<Record<'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT', string>>;

export interface Vapid {
  publicKey: string;
  privateKey: CryptoKey;
  subject: string;
}

const enc = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** The server's VAPID keys, or null when reminders are not configured. */
export async function vapid(env: Env): Promise<Vapid | null> {
  const e = env as unknown as PushEnv;
  const pub = e.VAPID_PUBLIC_KEY?.trim();
  const priv = e.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return null;
  const point = fromBase64(pub);
  if (point.length !== 65 || point[0] !== 4) return null;
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: priv, x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33, 65)), ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { publicKey: pub, privateKey, subject: e.VAPID_SUBJECT?.trim() || 'mailto:mynotes@example.com' };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts a payload for one browser subscription (RFC 8291, single aes128gcm record). */
export async function encryptPayload(sub: { p256dh: string; auth: string }, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = fromBase64(sub.p256dh);
  const authSecret = fromBase64(sub.auth);
  const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // The runtime takes the standard `public` member (its type file spells it `$public`).
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, ephemeral.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The last (only) record ends with the 0x02 delimiter.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** VAPID Authorization header for a push service (signed JWT, valid 12 h). */
export async function vapidAuthorization(keys: Vapid, endpoint: string, now = Date.now()): Promise<string> {
  const b64 = (o: object) => toBase64Url(enc.encode(JSON.stringify(o)));
  const unsigned = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/** Sends one notification; returns the push service's status (404/410: the subscription is gone). */
export async function send(keys: Vapid, sub: { endpoint: string; p256dh: string; auth: string }, message: object): Promise<number> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(keys, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(12 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

/* ---------------------------------------------------------------- API -- */

export async function pushStatus(env: Env, userId: string): Promise<PushStatus> {
  const keys = await vapid(env);
  const row = await first(env.DB, 'SELECT COUNT(*) AS n FROM speech_push_subscriptions WHERE user_id = ?', userId);
  return { publicKey: keys?.publicKey ?? null, subscriptions: num(row?.n) };
}

export async function subscribe(env: Env, userId: string, input: PushSubscriptionInput): Promise<PushStatus> {
  if (!(await vapid(env))) throw new ApiError('service_unavailable', 'Os lembretes não estão configurados neste servidor (chaves VAPID).');
  // One row per browser; a re-subscription replaces the keys (and moves it to this account).
  await run(
    env.DB,
    `INSERT INTO speech_push_subscriptions (id, user_id, endpoint, p256dh, auth, last_sent_on, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    uuidv7(),
    userId,
    input.endpoint,
    input.keys.p256dh,
    input.keys.auth,
    nowIso(),
  );
  return pushStatus(env, userId);
}

export async function unsubscribe(env: Env, userId: string, endpoint: string): Promise<PushStatus> {
  await run(env.DB, 'DELETE FROM speech_push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint);
  return pushStatus(env, userId);
}

const REMINDER = { title: 'MyNotes · Oratória', body: 'Que tal alguns minutos de treino hoje? A sua sessão do dia está esperando.', url: '/speaking', tag: 'mynotes-speaking' };

/** Sends a test notification to every browser of the user; returns how many accepted it. */
export async function sendTest(env: Env, userId: string): Promise<{ sent: number }> {
  const keys = await vapid(env);
  if (!keys) throw new ApiError('service_unavailable', 'Os lembretes não estão configurados neste servidor (chaves VAPID).');
  const subs = await all<{ endpoint: string; p256dh: string; auth: string }>(env.DB, 'SELECT endpoint, p256dh, auth FROM speech_push_subscriptions WHERE user_id = ?', userId);
  let sent = 0;
  for (const s of subs) {
    const status = await send(keys, s, { ...REMINDER, body: 'Lembretes ativados: é assim que eles vão aparecer.' });
    if (status === 404 || status === 410) await run(env.DB, 'DELETE FROM speech_push_subscriptions WHERE endpoint = ?', s.endpoint);
    else if (status < 300) sent++;
  }
  return { sent };
}

/* -------------------------------------------------------------- cron -- */

/** Local day and HH:MM for a user's offset. */
export function localClock(nowMs: number, offsetMinutes: number): { day: string; time: string } {
  const iso = new Date(nowMs + offsetMinutes * 60_000).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * Every 10 minutes: users whose reminder time has passed today (their local
 * time), who have not practiced today, get one notification per browser per day.
 */
export async function runReminders(env: Env, nowMs = Date.now()): Promise<number> {
  const keys = await vapid(env);
  if (!keys) return 0;
  const rows = await all(env.DB, "SELECT user_id, value FROM settings WHERE key = 'speech'");
  let sent = 0;
  for (const row of rows) {
    const settings = zSpeechSettings.safeParse(parseJson(row.value, {}));
    if (!settings.success || !settings.data.reminder.enabled) continue;
    const userId = str(row.user_id);
    const { day, time } = localClock(nowMs, settings.data.reminder.tzOffsetMinutes);
    if (time < settings.data.reminder.time) continue;
    if (await first(env.DB, 'SELECT 1 AS ok FROM speech_practice WHERE user_id = ? AND local_day = ? LIMIT 1', userId, day)) continue;
    const subs = await all<{ endpoint: string; p256dh: string; auth: string }>(
      env.DB,
      'SELECT endpoint, p256dh, auth FROM speech_push_subscriptions WHERE user_id = ? AND (last_sent_on IS NULL OR last_sent_on <> ?)',
      userId,
      day,
    );
    for (const s of subs) {
      try {
        const status = await send(keys, s, REMINDER);
        if (status === 404 || status === 410) await run(env.DB, 'DELETE FROM speech_push_subscriptions WHERE endpoint = ?', s.endpoint);
        else {
          await run(env.DB, 'UPDATE speech_push_subscriptions SET last_sent_on = ? WHERE endpoint = ?', day, s.endpoint);
          if (status < 300) sent++;
        }
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', msg: 'push failed', error: String(err).slice(0, 200) }));
      }
    }
  }
  return sent;
}
