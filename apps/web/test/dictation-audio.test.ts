import { describe, expect, it } from 'vitest';
import { Resampler, Segmenter, encodeWav } from '@/lib/dictation/audio';

const RATE = 16_000;
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const tone = (seconds: number, amplitude = 0.2) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Feeds the stream in odd-sized chunks, like the audio thread does. */
function run(stream: Float32Array, chunk = 2048 / 3) {
  const segmenter = new Segmenter();
  const segments: Float32Array[] = [];
  const size = Math.floor(chunk);
  for (let i = 0; i < stream.length; i += size) segments.push(...segmenter.push(stream.subarray(i, i + size)));
  const last = segmenter.flush();
  if (last) segments.push(last);
  return segments.map((s) => s.length / RATE);
}

describe('Resampler', () => {
  it('converts 48 kHz to 16 kHz across chunk boundaries', () => {
    const r = new Resampler(48_000);
    const input = Float32Array.from({ length: 4800 }, () => 0.5);
    const out = [...r.process(input.subarray(0, 1000)), ...r.process(input.subarray(1000))];
    expect(out).toHaveLength(1600);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it('handles 44.1 kHz (non-integer ratio)', () => {
    const out = new Resampler(44_100).process(new Float32Array(44_100));
    expect(Math.abs(out.length - RATE)).toBeLessThanOrEqual(1);
  });
});

describe('Segmenter', () => {
  it('sends nothing for silence or a short click', () => {
    expect(run(silence(10))).toEqual([]);
    expect(run(concat(silence(2), tone(0.1), silence(3)))).toEqual([]);
  });

  it('cuts after a long pause and trims the silence before speech', () => {
    const [first, second, ...rest] = run(concat(silence(5), tone(4), silence(2), tone(3), silence(0.5)));
    expect(rest).toEqual([]);
    // 0.4 s lead-in + 4 s of speech + the 1.2 s pause that ended it.
    expect(first).toBeGreaterThan(5.4);
    expect(first).toBeLessThan(5.8);
    expect(second).toBeGreaterThan(3);
    expect(second).toBeLessThan(4.5);
  });

  it('waits for a pause once past the target length, and never exceeds the maximum', () => {
    const speech = concat(tone(25), silence(0.5), tone(60));
    const lengths = run(speech);
    expect(lengths[0]).toBeGreaterThan(25);
    expect(lengths[0]).toBeLessThan(26);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(40);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeGreaterThan(85);
  });
});

describe('encodeWav', () => {
  it('writes a 16 kHz mono PCM header and clamps samples', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2]));
    const text = (a: number, b: number) => String.fromCharCode(...wav.subarray(a, b));
    const view = new DataView(wav.buffer);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect([1, 2, 3, 4].map((i) => view.getInt16(42 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
