import type { AcousticFrame } from '@mynotes/shared';
import type { AnalyzerMessage, AnalyzerResult } from './analyzer.worker';

/** The acoustic analyzer of one recording, running in its own worker. */
export class SpeechAnalyzer {
  private readonly worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });

  push(samples: Float32Array): void {
    // A copy: the recorder keeps using its buffer.
    const copy = samples.slice();
    this.worker.postMessage({ type: 'audio', samples: copy } satisfies AnalyzerMessage, [copy.buffer]);
  }

  /** Analysis of everything pushed so far; the worker ends afterwards. */
  finish(): Promise<AcousticFrame[]> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<AnalyzerResult>) => {
        const { db, voiced, f0 } = event.data;
        this.worker.terminate();
        resolve(Array.from(db, (d, i) => ({ db: d, voiced: voiced[i] === 1, f0: f0[i]! > 0 ? f0[i]! : null })));
      };
      this.worker.onerror = (event) => {
        this.worker.terminate();
        reject(new Error(event.message || 'Falha na análise do áudio'));
      };
      this.worker.postMessage({ type: 'finish' } satisfies AnalyzerMessage);
    });
  }

  cancel(): void {
    this.worker.terminate();
  }
}
