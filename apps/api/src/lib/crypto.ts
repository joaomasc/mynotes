/** Small Web Crypto helpers. All encodings are base64url without padding unless noted. */

const encoder = new TextEncoder();

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts standard or URL-safe base64, with or without padding. */
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function sha256(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  return toBase64Url(await crypto.subtle.digest('SHA-256', data));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmac(secret: string, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export async function hmacBase64Url(secret: string, message: string): Promise<string> {
  return toBase64Url(await hmac(secret, message));
}

/** Constant-time HMAC verification (delegated to Web Crypto). */
export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64(signature);
  } catch {
    return false;
  }
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, sig, encoder.encode(message));
}

/** Constant-time comparison of two byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Server-side verifier hash. The input is the 256-bit key the client derived
 * with Argon2id, so it already has full entropy; PBKDF2 here only makes the
 * stored value useless as a login credential if the database leaks.
 */
export async function pbkdf2(input: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function importDevicePublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

export async function verifyDeviceSignature(
  publicKey: CryptoKey,
  signature: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<boolean> {
  if (signature.length !== 64) return false;
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, encoder.encode(message));
}
