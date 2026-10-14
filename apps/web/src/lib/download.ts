import { request } from './api/client';

/** Authenticated download that reports progress (when the size is known). */
export async function fetchWithProgress(
  path: string,
  onProgress: (fraction: number | null) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await request('GET', path, { signal, track: false });
  const total = Number(res.headers.get('Content-Length') ?? 0);
  if (!res.body || !total) {
    onProgress(null);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/**
 * Authenticated download of bytes [begin, end) of a file. Goes through the
 * API client, so the session is renewed during long reading sessions.
 */
export async function fetchRange(path: string, begin: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await request('GET', path, { signal, track: false, headers: { Range: `bytes=${begin}-${end - 1}` } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A server that ignores Range answers 200 with the whole file.
  return res.status === 206 ? bytes : bytes.subarray(begin, end);
}

/** Opens a URL obtained asynchronously in a new tab without being blocked as a popup. */
export async function openInNewTab(getUrl: () => Promise<string>): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const url = await getUrl();
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (err) {
    win?.close();
    throw err;
  }
}

export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}
