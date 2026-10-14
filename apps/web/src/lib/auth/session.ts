import { useSyncExternalStore } from 'react';
import { createStore, del, get, set } from 'idb-keyval';
import type { AuthResponse, KdfParams, User } from '@mynotes/shared';
import { ApiError, NetworkError, request, setTokenSource } from '../api/client';
import { createDeviceKey, deriveVerifier, deviceLabel, signRefresh } from './crypto';

/**
 * Session model (see docs/security.md):
 *  - The access token (15 min) lives only in memory.
 *  - The device keeps a non-extractable ECDSA private key in IndexedDB plus
 *    the session id. To renew, it signs a single-use server challenge.
 *  - No password, token or long-lived bearer secret is stored in the browser.
 */
interface DeviceRecord {
  sessionId: string;
  privateKey: CryptoKey;
  user: User;
  sessionExpiresAt: string;
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';
export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Authenticated from the device record but the server is unreachable. */
  offline: boolean;
}

const deviceStore = createStore('mynotes-auth', 'device');
const DEVICE_KEY = 'current';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mynotes-auth') : null;

let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflightRefresh: Promise<string | null> | null = null;
let state: AuthState = { status: 'loading', user: null, offline: false };
const listeners = new Set<() => void>();
const logoutHooks = new Set<() => Promise<void> | void>();

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function applyAuth(auth: AuthResponse) {
  accessToken = auth.accessToken;
  accessExpiresAt = Date.parse(auth.accessTokenExpiresAt);
  clearTimeout(refreshTimer);
  // Renew one minute before expiry; failures are handled lazily on the next 401.
  const delay = Math.max(10_000, accessExpiresAt - Date.now() - 60_000);
  refreshTimer = setTimeout(() => void refreshAccess().catch(() => undefined), delay);
  setState({ status: 'authenticated', user: auth.user, offline: false });
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await request('POST', path, { body: body ?? {}, anonymous: true, track: false, retries: 1 });
  return ((await res.json()) as { data: T }).data;
}

async function clearLocal(): Promise<void> {
  accessToken = null;
  accessExpiresAt = 0;
  clearTimeout(refreshTimer);
  await del(DEVICE_KEY, deviceStore);
  for (const hook of logoutHooks) await hook();
  setState({ status: 'anonymous', user: null, offline: false });
}

/** Single-flight refresh. Returns null when the session is no longer valid. */
async function refreshAccess(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    const device = await get<DeviceRecord>(DEVICE_KEY, deviceStore);
    if (!device) return null;
    try {
      const { challenge } = await postJson<{ challenge: string }>('/auth/challenge');
      const signature = await signRefresh(device.privateKey, device.sessionId, challenge);
      const auth = await postJson<AuthResponse>('/auth/refresh', { sessionId: device.sessionId, challenge, signature });
      await set(DEVICE_KEY, { ...device, user: auth.user, sessionExpiresAt: auth.sessionExpiresAt }, deviceStore);
      applyAuth(auth);
      return auth.accessToken;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearLocal();
        return null;
      }
      throw err;
    }
  })().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

setTokenSource({
  token: () => (accessToken && Date.now() < accessExpiresAt - 5_000 ? accessToken : null),
  refresh: refreshAccess,
  onUnauthenticated: () => void clearLocal(),
});

channel?.addEventListener('message', (e: MessageEvent<string>) => {
  if (e.data === 'logout') void clearLocal();
  if (e.data === 'login' && state.status !== 'authenticated') void restoreSession();
});

/** On startup: resume the device session if there is one. */
export async function restoreSession(): Promise<void> {
  const device = await get<DeviceRecord>(DEVICE_KEY, deviceStore).catch(() => undefined);
  if (!device) {
    setState({ status: 'anonymous', user: null, offline: false });
    return;
  }
  try {
    await refreshAccess();
  } catch (err) {
    if (err instanceof NetworkError) {
      // Offline start: allow reading cached data; requests retry when back online.
      setState({ status: 'authenticated', user: device.user, offline: true });
      return;
    }
    await clearLocal();
  }
}

export async function login(username: string, password: string, onProgress?: (step: string) => void): Promise<void> {
  const name = username.trim().toLowerCase();
  onProgress?.('Preparando…');
  const { kdf } = await postJson<{ kdf: KdfParams }>('/auth/prelogin', { username: name });
  onProgress?.('Protegendo sua senha…');
  const verifier = await deriveVerifier(password, kdf);
  const device = await createDeviceKey();
  onProgress?.('Entrando…');
  const auth = await postJson<AuthResponse>('/auth/login', {
    username: name,
    verifier,
    publicKey: device.publicJwk,
    deviceLabel: deviceLabel(),
  });
  await set(
    DEVICE_KEY,
    { sessionId: auth.sessionId, privateKey: device.privateKey, user: auth.user, sessionExpiresAt: auth.sessionExpiresAt },
    deviceStore,
  );
  applyAuth(auth);
  channel?.postMessage('login');
}

export async function logout(): Promise<void> {
  try {
    await request('POST', '/auth/logout', { track: false, retries: 0 });
  } catch {
    // Ending the local session must work offline too; the server session expires on its own.
  }
  await clearLocal();
  channel?.postMessage('logout');
}

/** Lets other modules wipe their local caches when the session ends. */
export function onLogout(hook: () => Promise<void> | void): () => void {
  logoutHooks.add(hook);
  return () => logoutHooks.delete(hook);
}

/** A valid access token for requests made outside the API client (uploads, PDF loading). */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && accessToken && Date.now() < accessExpiresAt - 30_000) return accessToken;
  return refreshAccess();
}

export async function prelogin(username: string): Promise<KdfParams> {
  return (await postJson<{ kdf: KdfParams }>('/auth/prelogin', { username })).kdf;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function currentUser(): User | null {
  return state.user;
}
