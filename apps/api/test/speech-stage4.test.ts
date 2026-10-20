import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSpeechMetrics, uuidv7, type SpeechWord } from '@mynotes/shared';
import { fromBase64, toBase64Url } from '../src/lib/crypto';
import { localClock, runReminders } from '../src/modules/speech/push';
import { api, client, setupOwner } from './helpers';
import { FAKE_KEY } from './openai-mock';

/*
 * Stage 4: kept recordings and the full evaluation (a model listening to the
 * audio), the user's own speeches (projects) and the daily reminder by Web
 * Push, checked by decrypting what the browser would receive.
 */

let http: ReturnType<typeof client>;
let token: string;
let userId: string;

beforeEach(async () => {
  const owner = await setupOwner();
  token = owner.token;
  userId = owner.user.id;
  http = client(token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const words = (text: string): SpeechWord[] => text.split(' ').map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35 }));

async function saveTalk(extra: Record<string, unknown> = {}) {
  const ws = words('A cidade deveria investir em ônibus. Eles levam mais gente. Por isso, transporte público é a escolha.');
  const res = await http.post('/speech/attempts', {
    id: uuidv7(),
    mode: 'free',
    speechType: 'persuasive',
    theme: 'Transporte',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    localDay: '2026-10-20',
    transcript: ws.map((w) => w.text).join(' '),
    words: ws,
    segments: [],
    timeline: { step: 0.1, db: [], f0: [] },
    metrics: computeSpeechMetrics({ frames: [], words: ws, segments: [], targetSeconds: null }),
    ...extra,
  });
  return res;
}

/** 8 kHz mono 16-bit WAV of `seconds`, each second filled with its own value (to find the excerpt). */
function wav(seconds: number, rate = 8000): Uint8Array {
  const data = seconds * rate * 2;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => (buf[o + i] = ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, data, true);
  for (let s = 0; s < seconds; s++) for (let i = 0; i < rate; i++) v.setInt16(44 + (s * rate + i) * 2, s, true);
  return buf;
}

const putAudio = (id: string, body: Uint8Array) =>
  api('PUT', `/speech/attempts/${id}/audio`, { token, rawBody: body, headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(body.length) } });

describe('kept recordings and the full evaluation', () => {
  it('keeps a recording, serves it back and deletes it with the talk', async () => {
    const talk = (await saveTalk()).body.data;
    expect(talk.hasAudio).toBe(false);
    const audio = wav(3);
    const res = await putAudio(talk.id, audio);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.hasAudio).toBe(true);

    const back = await api('GET', `/speech/attempts/${talk.id}/audio`, { token });
    expect(back.headers.get('Content-Type')).toBe('audio/wav');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(audio);
    expect((await http.get('/speech/attempts')).body.data[0].hasAudio).toBe(true);

    const row = await env.DB.prepare('SELECT audio_key FROM speech_attempts WHERE id = ?').bind(talk.id).first<{ audio_key: string }>();
    expect(await env.FILES.head(row!.audio_key)).not.toBeNull();
    await http.del(`/speech/attempts/${talk.id}`);
    expect(await env.FILES.head(row!.audio_key)).toBeNull();
  });

  it('accepts only the app format (8 kHz mono 16-bit WAV)', async () => {
    const talk = (await saveTalk()).body.data;
    expect((await putAudio(talk.id, wav(2, 16000))).status).toBe(415);
    expect((await http.get(`/speech/attempts/${talk.id}`)).body.data.hasAudio).toBe(false);
  });

  it('lets the model hear the opening and the closing, and prices the audio', async () => {
    const talk = (await saveTalk()).body.data;
    await putAudio(talk.id, wav(120));
    const bodies: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
      bodies.push(JSON.parse(String(init?.body)));
      const answer = {
        criteria: [
          { id: 'confidence', state: 'good', evidence: 'Firme no início.' },
          { id: 'energy', state: 'attention', evidence: 'Cai na conclusão.' },
          { id: 'inventado', state: 'good', evidence: 'x' },
        ],
        remarks: ['Respire antes da última frase.'],
        summary: 'Voz segura; termine com mais energia.',
      };
      return Response.json({
        choices: [{ message: { content: '```json\n' + JSON.stringify(answer) + '\n```' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { audio_tokens: 900 } },
      });
    });
    const res = await http.post(`/speech/attempts/${talk.id}/full-evaluation`, {});
    expect(res.status).toBe(200);

    const req = bodies[0];
    expect(req).toMatchObject({ model: 'gpt-audio', modalities: ['text'], store: false });
    const part = req.messages[1].content[1];
    expect(part.type).toBe('input_audio');
    expect(part.input_audio.format).toBe('wav');
    const heard = fromBase64(part.input_audio.data);
    expect(heard.length).toBe(44 + 90 * 16000);
    const v = new DataView(heard.buffer);
    // Seconds 0–44 and then 75–119: the opening and the closing.
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(44 + 44 * 16000, true)).toBe(44);
    expect(v.getInt16(44 + 45 * 16000, true)).toBe(75);
    expect(v.getInt16(heard.length - 2, true)).toBe(119);

    const full = res.body.data.fullEvaluation;
    expect(full).toMatchObject({ heardSeconds: 90, model: 'gpt-audio', remarks: ['Respire antes da última frase.'] });
    expect(full.criteria.map((c: any) => [c.id, c.state])).toEqual([
      ['stability', 'na'],
      ['confidence', 'good'],
      ['naturalness', 'na'],
      ['emphasis', 'na'],
      ['energy', 'attention'],
    ]);
    const usage = await env.DB.prepare('SELECT input_tokens, output_tokens, cost_usd FROM ai_usage_daily WHERE user_id = ?').bind(userId).first();
    expect(usage).toMatchObject({ input_tokens: 1000, output_tokens: 200 });
    expect(usage!.cost_usd).toBeCloseTo((900 * 32 + 100 * 2.5 + 200 * 10) / 1e6, 8);
  });

  it('needs a kept recording', async () => {
    const talk = (await saveTalk()).body.data;
    const res = await http.post(`/speech/attempts/${talk.id}/full-evaluation`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/guardar o áudio/);
  });
});

describe('your own speeches', () => {
  it('creates, edits with the version seen, links rehearsals and deletes', async () => {
    const created = await http.post('/speech/projects', { type: 'political', title: 'Ciclovia na avenida' });
    expect(created.status).toBe(201);
    const p = created.body.data;
    expect(p).toMatchObject({ type: 'political', step: 1, noteId: null, data: { centralIdea: '', points: [], method: null } });

    const edited = await http.patch(`/speech/projects/${p.id}`, { baseVersion: p.version, step: 3, data: { ...p.data, centralIdea: 'A ciclovia salva vidas.', method: 'monroe' } });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ step: 3, data: { centralIdea: 'A ciclovia salva vidas.', method: 'monroe' } });
    // Another device with the old version is told about the conflict.
    expect((await http.patch(`/speech/projects/${p.id}`, { baseVersion: p.version, step: 4 })).status).toBe(409);

    const rehearsal = (await saveTalk({ projectId: p.id, lessonId: 'ensaio-1' })).body.data;
    expect(rehearsal.projectId).toBe(p.id);
    await saveTalk();
    const list = await http.get(`/speech/attempts?projectId=${p.id}`);
    expect(list.body.data.map((a: any) => a.id)).toEqual([rehearsal.id]);

    const other = client((await setupOwner()).token);
    expect((await other.get(`/speech/projects/${p.id}`)).status).toBe(404);

    expect((await http.del(`/speech/projects/${p.id}`)).status).toBe(204);
    expect((await http.get(`/speech/attempts/${rehearsal.id}`)).body.data.projectId).toBeNull();
  });

  it('rejects talks for a project that is not the user’s', async () => {
    expect((await saveTalk({ projectId: uuidv7() })).status).toBe(400);
  });
});

/* ------------------------------------------------------------- push -- */

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: toBase64Url(raw), privateKey: jwk.d!, verifyKey: pair.publicKey };
}

/** A browser: its ECDH key pair and auth secret. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, keys: { p256dh: toBase64Url(pub), auth: toBase64Url(auth) } };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** What the browser does with an aes128gcm push message (RFC 8291). */
async function decrypt(b: Awaited<ReturnType<typeof browser>>, body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, b.pair.privateKey, 256));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b.pub, ...asPublic]);
  const ikm = await hkdf(b.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('daily reminder by Web Push', () => {
  let vapid: Awaited<ReturnType<typeof vapidKeys>>;
  beforeEach(async () => {
    vapid = await vapidKeys();
    (env as any).VAPID_PUBLIC_KEY = vapid.publicKey;
    (env as any).VAPID_PRIVATE_KEY = vapid.privateKey;
    (env as any).VAPID_SUBJECT = 'mailto:teste@example.com';
  });
  afterEach(() => {
    delete (env as any).VAPID_PUBLIC_KEY;
    delete (env as any).VAPID_PRIVATE_KEY;
    delete (env as any).VAPID_SUBJECT;
  });

  function capturePush(status = 201) {
    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer) });
      return new Response(null, { status });
    });
    return sent;
  }

  it('is unavailable without the server keys', async () => {
    delete (env as any).VAPID_PUBLIC_KEY;
    expect((await http.get('/speech/push')).body.data).toEqual({ publicKey: null, subscriptions: 0 });
    const b = await browser();
    expect((await http.post('/speech/push/subscriptions', { endpoint: 'https://push.example.com/abc', keys: b.keys })).status).toBe(503);
  });

  it('sends an encrypted, signed notification the browser can read', async () => {
    const b = await browser();
    const sub = await http.post('/speech/push/subscriptions', { endpoint: 'https://push.example.com/abc', keys: b.keys });
    expect(sub.body.data).toEqual({ publicKey: vapid.publicKey, subscriptions: 1 });

    const sent = capturePush();
    expect((await http.post('/speech/push/test')).body.data).toEqual({ sent: 1 });
    const msg = sent[0]!;
    expect(msg.url).toBe('https://push.example.com/abc');
    expect(msg.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(JSON.parse(await decrypt(b, msg.body))).toMatchObject({ title: 'MyNotes · Oratória', url: '/speaking' });

    // VAPID: a JWT for the push service's origin, signed with the server key.
    const auth = msg.headers.get('Authorization')!;
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(vapid.publicKey);
    const [h, p, sig] = jwt!.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64(p!)))).toMatchObject({ aud: 'https://push.example.com', sub: 'mailto:teste@example.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.verifyKey, fromBase64(sig!), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it('forgets subscriptions the push service says are gone', async () => {
    const b = await browser();
    await http.post('/speech/push/subscriptions', { endpoint: 'https://push.example.com/gone', keys: b.keys });
    capturePush(410);
    expect((await http.post('/speech/push/test')).body.data).toEqual({ sent: 0 });
    expect((await http.get('/speech/push')).body.data.subscriptions).toBe(0);
  });

  it('reminds once a day, after the chosen local time, only when the day has no practice', async () => {
    const b = await browser();
    await http.post('/speech/push/subscriptions', { endpoint: 'https://push.example.com/daily', keys: b.keys });
    await http.put('/settings/speech', { value: { reminder: { enabled: true, time: '19:00', tzOffsetMinutes: -180 } } });
    const at = (iso: string) => Date.parse(iso);
    expect(localClock(at('2026-10-20T22:30:00Z'), -180)).toEqual({ day: '2026-10-20', time: '19:30' });

    const sent = capturePush();
    // 18:50 in Brasília: not yet.
    await runReminders(env, at('2026-10-20T21:50:00Z'));
    // 19:30: once; again at 19:40: nothing new.
    await runReminders(env, at('2026-10-20T22:30:00Z'));
    await runReminders(env, at('2026-10-20T22:40:00Z'));
    expect(sent).toHaveLength(1);

    // Next day, already practiced: no reminder.
    await env.DB.prepare(
      "INSERT INTO speech_practice (id, user_id, kind, ref_id, local_day, seconds, xp, passed, attempt_id, created_at) VALUES (?, ?, 'warmup', NULL, '2026-10-21', 60, 10, 1, NULL, ?)",
    )
      .bind(uuidv7(), userId, new Date().toISOString())
      .run();
    await runReminders(env, at('2026-10-21T22:30:00Z'));
    expect(sent).toHaveLength(1);
  });
});
