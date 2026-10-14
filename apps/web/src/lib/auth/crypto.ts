import { KDF_BOUNDS, type KdfParams, type PublicJwk } from '@mynotes/shared';
import { fromBase64Url, toBase64Url } from '../encoding';
import type { KdfRequest } from './kdf.worker';

/**
 * Derives the login verifier from the password with Argon2id (in a worker).
 * Must stay identical to apps/api/scripts/create-user.mjs: NFKC-normalized
 * password, raw salt bytes, 32-byte output, base64url.
 */
export async function deriveVerifier(password: string, kdf: KdfParams): Promise<string> {
  if (
    kdf.memoryKiB < KDF_BOUNDS.minMemoryKiB ||
    kdf.iterations < KDF_BOUNDS.minIterations ||
    kdf.memoryKiB > KDF_BOUNDS.maxMemoryKiB
  ) {
    throw new Error('Parâmetros de derivação inseguros');
  }
  const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });
  try {
    const key = await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; key?: Uint8Array; error?: string }>) =>
        e.data.ok && e.data.key ? resolve(e.data.key) : reject(new Error(e.data.error ?? 'kdf failed'));
      worker.onerror = () => reject(new Error('Falha ao derivar a chave'));
      const message: KdfRequest = {
        password: password.normalize('NFKC'),
        salt: fromBase64Url(kdf.salt),
        memoryKiB: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
      };
      worker.postMessage(message);
    });
    return toBase64Url(key);
  } finally {
    worker.terminate();
  }
}

export function newKdfSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toBase64Url(salt);
}

/**
 * Device key pair for refresh authorization. The private key is created
 * non-extractable: it can sign while stored in IndexedDB but its bytes can
 * never be read, so it cannot be exfiltrated.
 */
export async function createDeviceKey(): Promise<{ privateKey: CryptoKey; publicJwk: PublicJwk }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } };
}

export async function signRefresh(privateKey: CryptoKey, sessionId: string, challenge: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`mynotes-refresh:${sessionId}:${challenge}`),
  );
  return toBase64Url(sig);
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Dispositivo';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  return `${browser} · ${os}`;
}
