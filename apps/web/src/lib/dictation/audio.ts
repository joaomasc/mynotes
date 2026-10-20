import { DICTATION_SAMPLE_RATE, DICTATION_SEGMENT_MAX_SECONDS, DICTATION_SEGMENT_TARGET_SECONDS } from '@mynotes/shared';

/**
 * Pure audio helpers for dictation: resampling to 16 kHz, cutting speech
 * into segments at natural pauses, and WAV encoding. Kept free of browser
 * APIs so they can be unit-tested.
 */

export const FRAME = DICTATION_SAMPLE_RATE / 50; // 20 ms
const framesFor = (seconds: number) => Math.round((seconds * 1000) / 20);

/** Root mean square of a block of samples (0 = silence, ~0.1+ = speech). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/**
 * Streaming resampler to 16 kHz. Downsampling averages each output
 * interval (a simple low-pass, enough for speech recognition).
 */
export class Resampler {
  private readonly ratio: number;
  private acc = 0;
  private sum = 0;
  private count = 0;
  private last = 0;

  constructor(inputRate: number, outputRate = DICTATION_SAMPLE_RATE) {
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 2);
    let n = 0;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.acc += 1;
      while (this.acc >= this.ratio) {
        if (this.count > 0) {
          this.last = this.sum / this.count;
          this.sum = 0;
          this.count = 0;
        }
        out[n++] = this.last;
        this.acc -= this.ratio;
      }
    }
    return out.subarray(0, n);
  }
}

const MIN_SPEECH_RMS = 0.012;
/** Normal speech is always above this, however loud the background got. */
const MAX_SPEECH_THRESHOLD = 0.04;
/** Speech shorter than this in a whole segment is treated as noise and not sent. */
const MIN_VOICED_FRAMES = framesFor(0.3);
/** Silence kept before the first word of a segment. */
const LEAD_FRAMES = framesFor(0.4);
const TARGET_FRAMES = framesFor(DICTATION_SEGMENT_TARGET_SECONDS);
const MAX_FRAMES = framesFor(DICTATION_SEGMENT_MAX_SECONDS);
/** A short pause is enough to cut once the segment reached its target length… */
const SHORT_PAUSE = framesFor(0.3);
/** …and a long one (the speaker stopped) cuts sooner, so the text shows up quickly. */
const LONG_PAUSE = framesFor(1.2);
const MIN_FRAMES_FOR_LONG_PAUSE = framesFor(3);

/**
 * Speech/silence decision against an adaptive noise floor. The floor drops at
 * once in quiet moments and rises over tens of seconds (steady noise such as
 * a fan), never fast enough to swallow speech.
 */
export class NoiseGate {
  private floor = 0.004;

  /** Feeds one frame's level; true when it is speech. */
  update(level: number): boolean {
    this.floor = level < this.floor ? level : this.floor + (level - this.floor) * 0.0005;
    return level > this.threshold();
  }

  threshold(): number {
    return Math.min(MAX_SPEECH_THRESHOLD, Math.max(MIN_SPEECH_RMS, this.floor * 3));
  }
}

/**
 * Cuts a 16 kHz stream into segments at pauses. Silence before speech is
 * trimmed, so long pauses never produce (or pay for) empty requests.
 */
export class Segmenter {
  private frames: Float32Array[] = [];
  /** Index (in frames since the stream started) of frames[0]. */
  private base = 0;
  private readonly starts = new WeakMap<Float32Array, number>();
  private levels: number[] = [];
  private voiced = 0;
  private silentRun = 0;
  private partial = new Float32Array(FRAME);
  private partialLength = 0;
  private readonly gate = new NoiseGate();

  /** Feeds 16 kHz samples; returns the segments completed by them. */
  push(samples: Float32Array): Float32Array[] {
    const done: Float32Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(FRAME - this.partialLength, samples.length - i);
      this.partial.set(samples.subarray(i, i + take), this.partialLength);
      this.partialLength += take;
      i += take;
      if (this.partialLength === FRAME) {
        const segment = this.addFrame(this.partial);
        this.partial = new Float32Array(FRAME);
        this.partialLength = 0;
        if (segment) done.push(segment);
      }
    }
    return done;
  }

  /** Ends the stream: returns the last segment if it contains speech. */
  flush(): Float32Array | null {
    if (this.partialLength > 0) {
      this.frames.push(this.partial.slice(0, this.partialLength));
      this.levels.push(0);
      this.partialLength = 0;
    }
    return this.take(this.frames.length);
  }

  private addFrame(frame: Float32Array): Float32Array | null {
    const level = rms(frame);
    const isSpeech = this.gate.update(level);

    this.frames.push(frame);
    this.levels.push(level);
    if (isSpeech) {
      this.voiced++;
      this.silentRun = 0;
    } else {
      this.silentRun++;
    }

    if (this.voiced === 0) {
      // Still waiting for speech: keep only a short lead-in.
      if (this.frames.length > LEAD_FRAMES) {
        this.frames.shift();
        this.levels.shift();
        this.base++;
      }
      return null;
    }

    const length = this.frames.length;
    if (
      (length >= TARGET_FRAMES && this.silentRun >= SHORT_PAUSE) ||
      (length >= MIN_FRAMES_FOR_LONG_PAUSE && this.silentRun >= LONG_PAUSE)
    ) {
      return this.take(length);
    }
    if (length >= MAX_FRAMES) {
      // No pause: cut at the quietest moment of the last 5 seconds.
      let cut = length;
      let quietest = Infinity;
      for (let f = length - 1; f >= length - framesFor(5); f--) {
        if (this.levels[f]! < quietest) {
          quietest = this.levels[f]!;
          cut = f + 1;
        }
      }
      return this.take(cut);
    }
    return null;
  }

  /** Seconds from the start of the stream to the first sample of a segment this segmenter returned. */
  startOf(segment: Float32Array): number {
    return ((this.starts.get(segment) ?? 0) * FRAME) / DICTATION_SAMPLE_RATE;
  }

  /** Removes the first `count` frames and returns them as one segment (null when silent). */
  private take(count: number): Float32Array | null {
    const frames = this.frames.splice(0, count);
    const levels = this.levels.splice(0, count);
    const start = this.base;
    this.base += count;
    const voiced = this.voiced;
    // Recount speech in what stays (after a forced cut).
    this.voiced = this.levels.filter((l) => l > this.gate.threshold()).length;
    this.silentRun = 0;
    const speech = voiced - this.voiced;
    if (speech < MIN_VOICED_FRAMES || levels.length === 0) return null;
    const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let offset = 0;
    for (const f of frames) {
      out.set(f, offset);
      offset += f.length;
    }
    this.starts.set(out, start);
    return out;
  }
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate = DICTATION_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}
