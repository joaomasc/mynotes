import { API_PREFIX } from '@mynotes/shared';

/**
 * Runtime configuration. Everything here comes from public VITE_* variables
 * embedded in the bundle — it must never contain secrets.
 */
function resolveApiBase(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || 'http://localhost:8787';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_API_URL inválida');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (import.meta.env.PROD && url.protocol !== 'https:' && !local) {
    throw new Error('VITE_API_URL deve usar HTTPS em produção');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${API_PREFIX}`;
}

export const API_BASE = resolveApiBase();
export const BASE_PATH = import.meta.env.BASE_URL;
export const APP_VERSION: string = __APP_VERSION__;
