/// <reference lib="webworker" />
import { argon2id } from 'hash-wasm';

/**
 * Argon2id runs in a worker so the UI stays responsive (it takes ~0.5–3 s
 * and 64 MiB of memory by design). The password never leaves the device.
 */
export interface KdfRequest {
  password: string;
  salt: Uint8Array;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

self.onmessage = async (event: MessageEvent<KdfRequest>) => {
  const { password, salt, memoryKiB, iterations, parallelism } = event.data;
  try {
    const key = await argon2id({
      password,
      salt,
      iterations,
      parallelism,
      memorySize: memoryKiB,
      hashLength: 32,
      outputType: 'binary',
    });
    (self as unknown as Worker).postMessage({ ok: true, key }, [key.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : 'kdf failed' });
  }
};
