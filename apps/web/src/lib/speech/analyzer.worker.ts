/// <reference lib="webworker" />
import { FrameAnalyzer } from './analysis';

/**
 * Runs the acoustic analysis of a talk off the main thread: pitch detection
 * costs a few million operations per second of audio, which would make the
 * recording screen stutter on slower phones.
 */
export type AnalyzerMessage = { type: 'audio'; samples: Float32Array } | { type: 'finish' };

/** Frames sent back as flat arrays (transferable): f0 0 = none. */
export interface AnalyzerResult {
  db: Float32Array;
  voiced: Uint8Array;
  f0: Float32Array;
}

const analyzer = new FrameAnalyzer();

self.onmessage = (event: MessageEvent<AnalyzerMessage>) => {
  if (event.data.type === 'audio') {
    analyzer.push(event.data.samples);
    return;
  }
  const frames = analyzer.finish();
  const result: AnalyzerResult = {
    db: Float32Array.from(frames, (f) => f.db),
    voiced: Uint8Array.from(frames, (f) => (f.voiced ? 1 : 0)),
    f0: Float32Array.from(frames, (f) => f.f0 ?? 0),
  };
  (self as unknown as Worker).postMessage(result, [result.db.buffer, result.voiced.buffer, result.f0.buffer]);
};
