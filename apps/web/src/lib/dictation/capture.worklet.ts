/**
 * AudioWorklet that forwards microphone samples (mixed to mono) to the main
 * thread in ~40 ms batches. Runs on the audio thread, so typing in the editor
 * never makes the recording skip.
 */

// Globals of AudioWorkletGlobalScope (not in TypeScript's DOM lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const BATCH = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(BATCH);
  private length = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) return true;
    for (let i = 0; i < first.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      this.buffer[this.length++] = sum / channels.length;
      if (this.length === BATCH) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(BATCH);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('mynotes-capture', CaptureProcessor);

export {};
