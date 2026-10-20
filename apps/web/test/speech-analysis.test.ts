import { describe, expect, it } from 'vitest';
import { computeSpeechMetrics } from '@mynotes/shared';
import { FrameAnalyzer, smoothPitch, toTimeline, yin } from '@/lib/speech/analysis';

const RATE = 16_000;

/** A voice-like tone: fundamental plus two harmonics, with a pitch that may change over time. */
function tone(seconds: number, hz: (t: number) => number, amplitude = 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * hz(i / RATE)) / RATE;
    out[i] = amplitude * (0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase));
  }
  return out;
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('pitch detection (YIN)', () => {
  it.each([90, 150, 220, 330])('finds %i Hz in a 40 ms window', (hz) => {
    const f0 = yin(tone(0.04, () => hz));
    expect(f0).not.toBeNull();
    expect(Math.abs(f0! - hz)).toBeLessThan(hz * 0.02);
  });

  it('finds no pitch in noise', () => {
    let seed = 7;
    const noise = Float32Array.from({ length: 640 }, () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.4;
    });
    expect(yin(noise)).toBeNull();
  });

  it('smooths an isolated octave jump', () => {
    const frames = [150, 150, 300, 150, 150].map((f0) => ({ db: -20, voiced: true, f0 }));
    expect(smoothPitch(frames).map((f) => f.f0)).toEqual([150, 150, 150, 150, 150]);
  });
});

describe('frame analyzer', () => {
  it('splits speech from silence, measures loudness and pitch every 20 ms', () => {
    const analyzer = new FrameAnalyzer();
    const audio = concat(silence(0.5), tone(1, () => 150), silence(1), tone(1, () => 200));
    // Pushed in uneven chunks, like the recorder does.
    for (let i = 0; i < audio.length; i += 1500) analyzer.push(audio.subarray(i, i + 1500));
    const frames = analyzer.finish();
    expect(frames).toHaveLength(175);

    const voiced = frames.filter((f) => f.voiced).length;
    expect(voiced).toBeGreaterThanOrEqual(95);
    expect(voiced).toBeLessThanOrEqual(105);
    const first = frames.slice(30, 70).map((f) => f.f0!);
    expect(Math.max(...first.map((f) => Math.abs(f - 150)))).toBeLessThan(3);
    expect(frames[40]!.db).toBeGreaterThan(-25);
    expect(frames[100]!.voiced).toBe(false);

    const timeline = toTimeline(frames);
    expect(timeline.db).toHaveLength(35);
    expect(timeline.db[0]).toBeNull();
    expect(timeline.f0[7]).toBe(150);
    expect(timeline.f0[30]).toBe(200);
  });

  it('feeds the metrics: a pause measured from the audio and a steady pitch', () => {
    const analyzer = new FrameAnalyzer();
    analyzer.push(concat(tone(3, () => 150), silence(0.8), tone(3, () => 150)));
    const frames = analyzer.finish();
    const words = [
      { text: 'Primeira', start: 0, end: 1.5 },
      { text: 'parte.', start: 1.5, end: 3 },
      { text: 'Segunda', start: 3.8, end: 5.3 },
      { text: 'parte.', start: 5.3, end: 6.8 },
    ];
    const m = computeSpeechMetrics({ frames, words, segments: [], targetSeconds: null });
    expect(m.pauses.betweenIdeas).toBe(1);
    expect(m.pitch.pvq!).toBeLessThan(0.02);
    expect(m.durationSeconds).toBeCloseTo(6.8, 1);
  });
});
