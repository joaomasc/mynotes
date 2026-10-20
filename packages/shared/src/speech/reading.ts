import { SPEECH_FRAME_SECONDS } from '../constants';
import type { SpeechWord } from '../schemas/speech';
import { normalizeToken } from './lexicon';
import type { AcousticFrame } from './metrics';

/**
 * Reading aloud (docs/oratoria-trilha.md › Tipos de exercício). Texts carry a
 * small markup:
 *   |        a pause after the previous word
 *   *word*   emphasis on that word
 *   ↘ / ↗    the sentence ends falling (statement) / rising (question)
 * The reading is aligned word by word with the transcript, which also says
 * what was skipped or misread (articulation).
 */

export interface ReadText {
  /** Words as displayed (without markup). */
  words: string[];
  /** Pause after word i. */
  pauses: number[];
  emphasis: number[];
  ending: 'falling' | 'rising' | null;
}

export function parseReadText(text: string): ReadText {
  const words: string[] = [];
  const pauses: number[] = [];
  const emphasis: number[] = [];
  let ending: ReadText['ending'] = null;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (raw === '|') {
      if (words.length) pauses.push(words.length - 1);
      continue;
    }
    if (raw === '↘' || raw === '↗') {
      ending = raw === '↘' ? 'falling' : 'rising';
      continue;
    }
    let word = raw;
    if (word.endsWith('↘') || word.endsWith('↗')) {
      ending = word.endsWith('↘') ? 'falling' : 'rising';
      word = word.slice(0, -1);
    }
    const emphatic = /^\*.+\*[^\p{L}\p{N}]*$/u.test(word);
    if (emphatic) {
      emphasis.push(words.length);
      word = word.replace(/^\*/, '').replace(/\*(?=[^\p{L}\p{N}]*$)/u, '');
    }
    if (word) words.push(word);
  }
  return { words, pauses, emphasis, ending };
}

/** The text without markup, as the reader sees it in full. */
export const plainReadText = (text: string) => parseReadText(text).words.join(' ');

/**
 * Aligns the expected words with the transcribed ones (edit distance over
 * normalized words). `match[i]` is the index of the transcribed word read for
 * expected word i, or null when it was skipped or misread.
 */
export function alignWords(expected: string[], said: SpeechWord[]): { match: (number | null)[]; missed: number[]; accuracy: number } {
  const a = expected.map(normalizeToken);
  const b = said.map((w) => normalizeToken(w.text));
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const match: (number | null)[] = Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && d[i]![j] === d[i - 1]![j - 1]) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j - 1]! + 1) {
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j]! + 1) {
      i--;
    } else {
      j--;
    }
  }
  const missed = match.flatMap((x, k) => (x === null && a[k] ? [k] : []));
  return { match, missed, accuracy: n ? 1 - missed.length / n : 1 };
}

export interface ReadCheck {
  label: string;
  passed: boolean | null;
  detail: string;
}

const F = SPEECH_FRAME_SECONDS;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function framesIn(frames: AcousticFrame[], from: number, to: number): AcousticFrame[] {
  return frames.slice(Math.max(0, Math.floor(from / F)), Math.max(0, Math.ceil(to / F)));
}

/** Longest silence (seconds) between two moments, from the audio when there is any. */
function silenceBetween(frames: AcousticFrame[], from: number, to: number): number {
  if (to <= from) return 0;
  // Without audio (text-only), the gap between the words.
  if (frames.length === 0) return to - from;
  let best = 0;
  let cur = 0;
  for (const f of framesIn(frames, from, to)) {
    cur = f.voiced ? 0 : cur + 1;
    best = Math.max(best, cur);
  }
  return best * F;
}

function slopeSemitones(points: { t: number; f0: number }[]): number {
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => 12 * Math.log2(p.f0 / 100));
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let k = 0; k < xs.length; k++) {
    num += (xs[k]! - mx) * (ys[k]! - my);
    den += (xs[k]! - mx) ** 2;
  }
  return den ? num / den : 0;
}

/** Checks a reading against the marks of the text. */
export function checkReading(text: string, said: SpeechWord[], frames: AcousticFrame[]): { checks: ReadCheck[]; accuracy: number; missed: string[] } {
  const read = parseReadText(text);
  const words = [...said].sort((x, y) => x.start - y.start);
  const { match, missed, accuracy } = alignWords(read.words, words);
  const checks: ReadCheck[] = [];
  const at = (i: number) => (match[i] !== null && match[i] !== undefined ? words[match[i]!]! : null);

  for (const p of read.pauses) {
    const before = at(p);
    const after = at(p + 1);
    const label = `Pausa depois de “${read.words[p]}”`;
    if (!before || !after) {
      checks.push({ label, passed: null, detail: 'palavras não reconhecidas' });
      continue;
    }
    const s = silenceBetween(frames, before.end - 0.1, after.start + 0.1);
    checks.push({ label, passed: s >= 0.3, detail: `${s.toFixed(1).replace('.', ',')} s de silêncio` });
  }

  const voicedDb = (w: SpeechWord) => framesIn(frames, w.start, w.end).filter((f) => f.voiced);
  for (const e of read.emphasis) {
    const w = at(e);
    const label = `Ênfase em “${read.words[e]}”`;
    const own = w ? voicedDb(w) : [];
    const others = words.filter((x) => x !== w).flatMap(voicedDb);
    if (!w || own.length < 3 || others.length < 10) {
      checks.push({ label, passed: null, detail: w ? 'pouco áudio para medir' : 'palavra não reconhecida' });
      continue;
    }
    const louder = mean(own.map((f) => f.db)) - mean(others.map((f) => f.db));
    const ownPitch = own.map((f) => f.f0).filter((v): v is number => v !== null);
    const otherPitch = others.map((f) => f.f0).filter((v): v is number => v !== null);
    const higher = ownPitch.length && otherPitch.length ? 12 * Math.log2(Math.max(...ownPitch) / mean(otherPitch)) : 0;
    checks.push({
      label,
      passed: louder >= 1.5 || higher >= 1.5,
      detail: `${louder >= 0 ? '+' : ''}${louder.toFixed(1).replace('.', ',')} dB e ${higher >= 0 ? '+' : ''}${higher.toFixed(1).replace('.', ',')} semitons em relação ao resto`,
    });
  }

  if (read.ending) {
    const last = at(read.words.length - 1) ?? words.at(-1);
    const label = read.ending === 'falling' ? 'Final da frase descendo' : 'Final da frase subindo (pergunta)';
    const points = last
      ? framesIn(frames, last.end - 0.45, last.end + 0.05)
          .map((f, k) => ({ t: k * F, f0: f.voiced ? f.f0 : null }))
          .filter((p): p is { t: number; f0: number } => p.f0 !== null)
      : [];
    if (points.length < 6) {
      checks.push({ label, passed: null, detail: 'tom não detectado no fim' });
    } else {
      const s = slopeSemitones(points);
      checks.push({
        label,
        passed: read.ending === 'falling' ? s < -1 : s > 1,
        detail: s < -1 ? 'o tom desceu' : s > 1 ? 'o tom subiu' : 'o tom ficou parado',
      });
    }
  }
  return { checks, accuracy, missed: missed.map((k) => read.words[k]!) };
}
