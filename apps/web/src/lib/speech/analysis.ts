import {
  DICTATION_SAMPLE_RATE,
  SPEECH_FRAME_SECONDS,
  SPEECH_TIMELINE_STEP,
  type AcousticFrame,
  type SpeechTimeline,
} from '@mynotes/shared';
import { NoiseGate, rms } from '../dictation/audio';

/**
 * Acoustic analysis of a talk (docs/oratoria-tecnico.md › Analisador): every
 * 20 ms, loudness, speech or silence, and pitch. Pure code, free of browser
 * APIs: it runs in a worker and in unit tests.
 */

const FRAME = Math.round(DICTATION_SAMPLE_RATE * SPEECH_FRAME_SECONDS); // 320 samples
/** Pitch window: 40 ms, enough for two periods of a 70 Hz voice. */
const WINDOW = FRAME * 2;
const MIN_HZ = 70;
const MAX_HZ = 400;
/** YIN aperiodicity threshold: below it the frame is periodic (voiced). */
const YIN_THRESHOLD = 0.15;

/**
 * Fundamental frequency by the YIN algorithm (de Cheveigné & Kawahara, 2002):
 * cumulative mean normalized difference, first dip under the threshold,
 * parabolic interpolation. Null when the window is not periodic.
 */
export function yin(buf: Float32Array, sampleRate = DICTATION_SAMPLE_RATE, minHz = MIN_HZ, maxHz = MAX_HZ): number | null {
  const tauMin = Math.floor(sampleRate / maxHz);
  const tauMax = Math.min(Math.ceil(sampleRate / minHz), Math.floor(buf.length / 2));
  const width = buf.length - tauMax;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const diff = buf[i]! - buf[i + tau]!;
      sum += diff * diff;
    }
    running += sum;
    cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t]! < YIN_THRESHOLD) {
      while (t + 1 <= tauMax && cmnd[t + 1]! < cmnd[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const x0 = cmnd[tau - 1] ?? cmnd[tau]!;
  const x1 = cmnd[tau]!;
  const x2 = cmnd[tau + 1] ?? cmnd[tau]!;
  const denom = x0 + x2 - 2 * x1;
  const refined = denom !== 0 ? tau + (x0 - x2) / (2 * denom) : tau;
  const hz = sampleRate / refined;
  return hz >= minHz && hz <= maxHz ? hz : null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Removes isolated pitch errors (octave jumps): median of 5 frames within each voiced run. */
export function smoothPitch(frames: AcousticFrame[]): AcousticFrame[] {
  return frames.map((f, i) => {
    if (f.f0 === null) return f;
    const around: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(frames.length - 1, i + 2); k++) {
      const v = frames[k]!.f0;
      if (v !== null) around.push(v);
    }
    return around.length >= 3 ? { ...f, f0: median(around) } : { ...f, f0: null };
  });
}

/** Streams 16 kHz samples into 20 ms frames. */
export class FrameAnalyzer {
  private readonly history = new Float32Array(WINDOW);
  private partial = new Float32Array(FRAME);
  private partialLength = 0;
  private readonly gate = new NoiseGate();
  readonly frames: AcousticFrame[] = [];

  push(samples: Float32Array): void {
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(FRAME - this.partialLength, samples.length - i);
      this.partial.set(samples.subarray(i, i + take), this.partialLength);
      this.partialLength += take;
      i += take;
      if (this.partialLength === FRAME) {
        this.addFrame(this.partial);
        this.partialLength = 0;
      }
    }
  }

  private addFrame(frame: Float32Array) {
    this.history.copyWithin(0, FRAME);
    this.history.set(frame, WINDOW - FRAME);
    const level = rms(frame);
    const voiced = this.gate.update(level);
    this.frames.push({
      db: Math.round(20 * Math.log10(Math.max(level, 1e-6)) * 10) / 10,
      voiced,
      f0: voiced ? yin(this.history) : null,
    });
  }

  /** The frames, with pitch errors smoothed out. */
  finish(): AcousticFrame[] {
    return smoothPitch(this.frames);
  }
}

/** The frames reduced to SPEECH_TIMELINE_STEP, rounded, for storage and charts. */
export function toTimeline(frames: AcousticFrame[]): SpeechTimeline {
  const per = Math.round(SPEECH_TIMELINE_STEP / SPEECH_FRAME_SECONDS);
  const db: (number | null)[] = [];
  const f0: (number | null)[] = [];
  for (let i = 0; i < frames.length; i += per) {
    const chunk = frames.slice(i, i + per);
    const voiced = chunk.filter((f) => f.voiced);
    db.push(voiced.length ? Math.max(-120, Math.min(0, Math.round(voiced.reduce((a, f) => a + f.db, 0) / voiced.length))) : null);
    const pitches = chunk.map((f) => f.f0).filter((v): v is number => v !== null);
    f0.push(pitches.length ? Math.max(40, Math.min(600, Math.round(median(pitches)))) : null);
  }
  return { step: SPEECH_TIMELINE_STEP, db, f0 };
}
