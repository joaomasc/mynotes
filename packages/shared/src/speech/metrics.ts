import { SPEECH_FRAME_SECONDS } from '../constants';
import type { SpeechMark, SpeechMetrics, SpeechSegment, SpeechWord } from '../schemas/speech';
import { DEFAULT_SPEECH_LIMITS, type SpeechLimits } from './limits';
import {
  FILLER_OPENERS,
  FILLER_PHRASES,
  FILLER_TAGS,
  STOPWORDS,
  WEAK_PHRASES,
  isTipoFiller,
  isVocalHesitation,
  normalizeToken,
  phraseTokens,
} from './lexicon';

/**
 * Speaking metrics (docs/oratoria-tecnico.md › Métricas). Pure functions:
 * the browser runs them on the full-resolution analysis, tests run them on
 * synthetic input. The rubric turns the result into states.
 */

/** One analysis frame (SPEECH_FRAME_SECONDS long) of the recording. */
export interface AcousticFrame {
  /** Loudness in dBFS (relative to the microphone). */
  db: number;
  /** Speech (above the noise floor) or silence. */
  voiced: boolean;
  /** Pitch in Hz, null when unvoiced or not periodic. */
  f0: number | null;
}

export interface MetricsInput {
  /** Every SPEECH_FRAME_SECONDS from the start of the recording; may be empty (text-only analysis). */
  frames: AcousticFrame[];
  /** Times in seconds from the start of the recording. */
  words: SpeechWord[];
  segments: SpeechSegment[];
  targetSeconds: number | null;
  /** Terms of the theme, which may repeat freely (“mercantilismo” in a talk about it). */
  themeWords?: string[];
}

interface Token {
  raw: string;
  norm: string;
  start: number;
  end: number;
  hesitation: boolean;
  sentenceStart: boolean;
  sentenceEnd: boolean;
  clauseEnd: boolean;
  question: boolean;
  pauseAfter: boolean;
}

interface Run {
  start: number;
  end: number;
}

const F = SPEECH_FRAME_SECONDS;
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[], m = mean(xs)) => Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
const SENTENCE_END = /[.!?…]["'”)\]]*$/u;
const CLAUSE_END = /[,;:—–-]["'”)\]]*$/u;

function framesIn(frames: AcousticFrame[], from: number, to: number): AcousticFrame[] {
  return frames.slice(Math.max(0, Math.floor(from / F)), Math.max(0, Math.ceil(to / F)));
}

/** Silences of at least `min` seconds between the first and the last voiced frame. */
function silentRuns(frames: AcousticFrame[], min: number): Run[] {
  const first = frames.findIndex((f) => f.voiced);
  if (first < 0) return [];
  let last = frames.length - 1;
  while (last > first && !frames[last]!.voiced) last--;
  const runs: Run[] = [];
  let runStart = -1;
  for (let i = first; i <= last; i++) {
    if (!frames[i]!.voiced) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if ((i - runStart) * F >= min - 1e-9) runs.push({ start: runStart * F, end: i * F });
      runStart = -1;
    }
  }
  return runs;
}

function tokenize(words: SpeechWord[], runs: Run[], hasFrames: boolean, pauseMin: number): Token[] {
  const tokens: Token[] = [];
  for (const w of words) {
    const raw = w.text.trim();
    const hesitation = isVocalHesitation(raw);
    const norm = normalizeToken(raw);
    if (!norm && !hesitation) continue;
    tokens.push({
      raw,
      norm,
      start: w.start,
      end: Math.max(w.start, w.end),
      hesitation,
      sentenceStart: false,
      sentenceEnd: SENTENCE_END.test(raw) && !/^(é|e)(\.\.\.|…)$/iu.test(raw),
      clauseEnd: CLAUSE_END.test(raw),
      question: /\?["'”)\]]*$/u.test(raw),
      pauseAfter: false,
    });
  }
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    t.sentenceStart = !prev || prev.sentenceEnd;
    const next = tokens[i + 1];
    if (!next) return;
    t.pauseAfter = hasFrames
      ? runs.some((r) => r.end > t.end - 0.15 && r.start < next.start + 0.15)
      : next.start - t.end >= pauseMin;
  });
  return tokens;
}

/** Sentences as [first, last] token indexes. */
function sentencesOf(tokens: Token[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  tokens.forEach((t, i) => {
    if (t.sentenceEnd || i === tokens.length - 1) {
      out.push([start, i]);
      start = i + 1;
    }
  });
  return out;
}

/** Marks occurrences of the phrases, longest first; tokens already used are skipped. */
function matchPhrases(tokens: Token[], phrases: string[][], used: Set<number>, onMatch: (from: number, to: number, phrase: string) => void) {
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    for (const p of phrases) {
      if (i + p.length > tokens.length) continue;
      let hit = true;
      for (let k = 0; k < p.length; k++) {
        if (used.has(i + k) || tokens[i + k]!.norm !== p[k]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      for (let k = 0; k < p.length; k++) used.add(i + k);
      onMatch(i, i + p.length - 1, p.join(' '));
      break;
    }
  }
}

/** Occurrences grouped by normalized form, shown as first said (“né”, not “ne”). */
function topCounts(found: { key: string; display: string }[]): { text: string; count: number }[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const f of found) {
    const cur = counts.get(f.key);
    counts.set(f.key, { display: cur?.display ?? f.display, count: (cur?.count ?? 0) + 1 });
  }
  return [...counts.values()]
    .map(({ display, count }) => ({ text: display.slice(0, 60), count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 10);
}

/** The words as said, lowercase, without punctuation: the label of a filler or hedge. */
const spoken = (tokens: Token[], from: number, to: number) =>
  tokens
    .slice(from, to + 1)
    .map((t) => t.raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .join(' ');

const spanText = (tokens: Token[], from: number, to: number) =>
  tokens
    .slice(from, to + 1)
    .map((t) => t.raw)
    .join(' ')
    .slice(0, 300);

/** Least-squares slope of y over x. */
function slope(points: [number, number][]): number {
  const mx = mean(points.map((p) => p[0]));
  const my = mean(points.map((p) => p[1]));
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const semitones = (hz: number, ref: number) => 12 * Math.log2(hz / ref);

export function computeSpeechMetrics(input: MetricsInput, limits: SpeechLimits = DEFAULT_SPEECH_LIMITS): SpeechMetrics {
  const { frames, segments } = input;
  const words = [...input.words].sort((a, b) => a.start - b.start);
  const hasFrames = frames.some((f) => f.voiced);
  const marks: SpeechMark[] = [];

  // Pauses come from the audio; without it (tests, text only), from the gaps between words.
  const runs = hasFrames
    ? silentRuns(frames, limits.pauseMinSeconds)
    : words.slice(1).flatMap((w, i) => {
        const gap = w.start - words[i]!.end;
        return gap >= limits.pauseMinSeconds ? [{ start: words[i]!.end, end: w.start }] : [];
      });
  const tokens = tokenize(words, runs, hasFrames, limits.pauseMinSeconds);
  const said = tokens.filter((t) => !t.hesitation);

  /* ---------------------------------------------------- duration, pace -- */
  const firstVoiced = frames.findIndex((f) => f.voiced);
  let lastVoiced = frames.length - 1;
  while (lastVoiced >= 0 && !frames[lastVoiced]!.voiced) lastVoiced--;
  const speechStart = hasFrames ? firstVoiced * F : (tokens[0]?.start ?? 0);
  const speechEnd = hasFrames ? (lastVoiced + 1) * F : (tokens.at(-1)?.end ?? 0);
  const durationSeconds = Math.max(0, speechEnd - speechStart);
  const speakingSeconds = hasFrames ? frames.filter((f) => f.voiced).length * F : durationSeconds;
  const minutes = Math.max(durationSeconds, 1) / 60;
  const perMinute = (n: number) => round(n / minutes, 2);

  const windows: { start: number; wpm: number }[] = [];
  for (let w = speechStart; w < speechEnd; w += 30) {
    const len = Math.min(30, speechEnd - w);
    if (len < 15) break;
    const n = said.filter((t) => t.start >= w && t.start < w + 30).length;
    windows.push({ start: round(w, 1), wpm: round(n / (len / 60), 1) });
  }

  /* ------------------------------------------------------------ pauses -- */
  let betweenIdeas = 0;
  let hesitations = 0;
  let blanks = 0;
  let longest = 0;
  for (const r of runs) {
    const before = tokens.filter((t) => t.start < r.start).at(-1);
    if (!before) continue;
    const dur = r.end - r.start;
    longest = Math.max(longest, dur);
    const label = `${dur.toFixed(1).replace('.', ',')} s`;
    if (dur >= limits.blankSeconds) {
      blanks++;
      marks.push({ kind: 'blank', start: round(r.start, 2), end: round(r.end, 2), text: label });
    } else if (before.sentenceEnd || before.clauseEnd) {
      betweenIdeas++;
    } else {
      hesitations++;
      marks.push({ kind: 'hesitation', start: round(r.start, 2), end: round(r.end, 2), text: label });
    }
  }

  /* --------------------------------------------------- fillers, hedges -- */
  const fillerUsed = new Set<number>();
  const fillerLabels: { key: string; display: string }[] = [];
  const addFiller = (from: number, to: number, key: string) => {
    for (let k = from; k <= to; k++) fillerUsed.add(k);
    fillerLabels.push({ key, display: spoken(tokens, from, to) || key });
    marks.push({ kind: 'filler', start: tokens[from]!.start, end: tokens[to]!.end, text: spanText(tokens, from, to) });
  };
  tokens.forEach((t, i) => {
    if (t.hesitation) addFiller(i, i, 'hesitação');
  });
  matchPhrases(tokens, phraseTokens(FILLER_PHRASES), fillerUsed, addFiller);
  const sentences = sentencesOf(tokens);
  tokens.forEach((t, i) => {
    if (fillerUsed.has(i) || t.hesitation) return;
    const prev = tokens[i - 1]?.norm;
    const next = tokens[i + 1]?.norm;
    const sentence = sentences.find(([a, b]) => i >= a && i <= b)!;
    const isFiller =
      (t.norm === 'tipo' && isTipoFiller(prev, next)) ||
      (FILLER_OPENERS.includes(t.norm) && t.sentenceStart && (t.clauseEnd || t.pauseAfter) && !t.sentenceEnd) ||
      (FILLER_TAGS.includes(t.norm) && t.sentenceEnd && t.question && sentence[1] - sentence[0] >= 2) ||
      (t.norm === 'assim' && !t.sentenceStart && !t.sentenceEnd && (t.clauseEnd || t.pauseAfter));
    if (isFiller) addFiller(i, i, t.norm);
  });

  const weakUsed = new Set<number>(fillerUsed);
  const weakLabels: { key: string; display: string }[] = [];
  matchPhrases(tokens, phraseTokens(WEAK_PHRASES), weakUsed, (from, to, phrase) => {
    weakLabels.push({ key: phrase, display: spoken(tokens, from, to) });
    marks.push({ kind: 'weak', start: tokens[from]!.start, end: tokens[to]!.end, text: spanText(tokens, from, to) });
  });

  /* -------------------------------------------------------- repetition -- */
  const theme = new Set((input.themeWords ?? []).flatMap((w) => w.split(/\s+/)).map(normalizeToken));
  const byWord = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    if (t.norm.length < 4 || STOPWORDS.has(t.norm) || theme.has(t.norm) || fillerUsed.has(i) || weakUsed.has(i)) return;
    byWord.set(t.norm, [...(byWord.get(t.norm) ?? []), i]);
  });
  let repetitions = 0;
  const repeated = new Set<string>();
  for (const [word, idx] of byWord) {
    let from = 0;
    for (let j = 0; j < idx.length; j++) {
      while (tokens[idx[j]!]!.start - tokens[idx[from]!]!.start > 30) from++;
      if (j - from + 1 >= 3) {
        repetitions++;
        repeated.add(word);
        const t = tokens[idx[j]!]!;
        marks.push({ kind: 'repetition', start: t.start, end: t.end, text: t.raw });
      }
    }
  }

  /* --------------------------------------------------------- sentences -- */
  const lengths = sentences.map(([a, b]) => tokens.slice(a, b + 1).filter((t) => !t.hesitation).length).filter((n) => n > 0);
  let longCount = 0;
  sentences.forEach(([a, b], i) => {
    if ((lengths[i] ?? 0) > limits.sentenceLong) {
      longCount++;
      marks.push({ kind: 'long', start: tokens[a]!.start, end: tokens[b]!.end, text: `${spanText(tokens, a, Math.min(b, a + 7))}…` });
    }
  });

  /* ------------------------------------------------------------ volume -- */
  const voicedDb = frames.filter((f) => f.voiced).map((f) => f.db);
  let measured = 0;
  let dropped = 0;
  for (const [a, b] of sentences) {
    const start = tokens[a]!.start;
    const end = tokens[b]!.end;
    if (end - start < 1) continue;
    const body = framesIn(frames, start, end - 0.3).filter((f) => f.voiced);
    const tail = framesIn(frames, end - 0.3, end).filter((f) => f.voiced);
    if (body.length < 10 || tail.length < 4) continue;
    measured++;
    const drop = mean(body.map((f) => f.db)) - mean(tail.map((f) => f.db));
    if (drop > limits.finalDropDb) {
      dropped++;
      marks.push({ kind: 'drop', start: round(end - 0.3, 2), end, text: tokens[b]!.raw });
    }
  }

  /* ------------------------------------------------------------- pitch -- */
  const pitched = frames.map((f, i) => ({ t: i * F, f0: f.voiced ? f.f0 : null })).filter((p): p is { t: number; f0: number } => p.f0 !== null);
  const f0s = pitched.map((p) => p.f0);
  const meanHz = f0s.length >= 100 ? mean(f0s) : null;
  const pvq = meanHz !== null ? sd(f0s, meanHz) / meanHz : null;
  const sdSemitones = meanHz !== null ? sd(f0s.map((f) => semitones(f, meanHz))) : null;
  const pitchWindows: { start: number; pvq: number }[] = [];
  for (let w = speechStart; w < speechEnd; w += 10) {
    const inWindow = pitched.filter((p) => p.t >= w && p.t < w + 10).map((p) => p.f0);
    if (inWindow.length < 50) continue;
    const m = mean(inWindow);
    pitchWindows.push({ start: round(w, 1), pvq: round(sd(inWindow, m) / m, 3) });
  }

  let rising = 0;
  let falling = 0;
  let flat = 0;
  for (const [, b] of sentences) {
    const last = tokens[b]!;
    if (!last.sentenceEnd || last.question) continue;
    const points = pitched.filter((p) => p.t >= last.end - 0.45 && p.t <= last.end + 0.05);
    if (points.length < 6) continue;
    const s = slope(points.map((p) => [p.t, semitones(p.f0, 100)]));
    if (s > limits.contourSlope) {
      rising++;
      marks.push({ kind: 'rising', start: round(last.end - 0.45, 2), end: last.end, text: last.raw });
    } else if (s < -limits.contourSlope) falling++;
    else flat++;
  }

  /* ------------------------------------------------------ articulation -- */
  const scored = segments.filter((s) => s.avgLogprob !== null && s.end > s.start);
  const total = scored.reduce((a, s) => a + (s.end - s.start), 0);
  let unclear = 0;
  for (const s of scored) {
    if (s.avgLogprob! >= limits.unclearLogprob) continue;
    unclear += s.end - s.start;
    marks.push({ kind: 'unclear', start: s.start, end: s.end, text: s.text.trim().slice(0, 300) });
  }

  return {
    durationSeconds: round(durationSeconds, 2),
    speakingSeconds: round(speakingSeconds, 2),
    wordCount: said.length,
    pace: {
      wpm: round(said.length / minutes, 1),
      articulationWpm: round(said.length / (Math.max(speakingSeconds, 1) / 60), 1),
      windows,
    },
    pauses: { betweenIdeas, hesitations, blanks, longest: round(longest, 2) },
    fillers: { count: fillerLabels.length, perMinute: perMinute(fillerLabels.length), top: topCounts(fillerLabels) },
    weakWords: { count: weakLabels.length, perMinute: perMinute(weakLabels.length), top: topCounts(weakLabels) },
    repetition: { count: repetitions, perMinute: perMinute(repetitions), words: [...repeated].slice(0, 20) },
    sentences: {
      count: lengths.length,
      avgWords: lengths.length ? round(mean(lengths), 1) : 0,
      longCount,
    },
    volume: {
      meanDb: voicedDb.length ? round(mean(voicedDb), 1) : null,
      sdDb: voicedDb.length ? round(sd(voicedDb), 1) : null,
      measured,
      dropped,
    },
    pitch: {
      pvq: pvq !== null ? round(pvq, 3) : null,
      sdSemitones: sdSemitones !== null ? round(sdSemitones, 2) : null,
      meanHz: meanHz !== null ? round(meanHz, 1) : null,
      validFrames: f0s.length,
      windows: pitchWindows.slice(0, 200),
    },
    finalContour: { measured: rising + falling + flat, rising, falling, flat },
    articulation: { unclearSeconds: round(unclear, 2), unclearShare: total >= 1 ? round(unclear / total, 3) : null },
    targetSeconds: input.targetSeconds,
    marks: marks.sort((a, b) => a.start - b.start).slice(0, 2000),
  };
}
