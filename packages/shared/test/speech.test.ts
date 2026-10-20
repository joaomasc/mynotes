import { describe, expect, it } from 'vitest';
import {
  SPEECH_FRAME_SECONDS,
  computeSpeechMetrics,
  evaluateMeasured,
  isVocalHesitation,
  speechScore,
  type AcousticFrame,
  type CriterionResult,
  type SpeechWord,
} from '../src';

const F = SPEECH_FRAME_SECONDS;

/** Words one after the other, `step` seconds each, starting at `start`. */
function wordsOf(text: string, start = 0, step = 0.4): SpeechWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ text: w, start: start + i * step, end: start + i * step + step * 0.9 }));
}

/** Frames for `seconds`, voiced inside the given intervals, with pitch and loudness as functions of time. */
function framesOf(
  seconds: number,
  voiced: [number, number][],
  f0: (t: number) => number | null = () => 150,
  db: (t: number) => number = () => -20,
): AcousticFrame[] {
  return Array.from({ length: Math.round(seconds / F) }, (_, i) => {
    const t = i * F;
    const on = voiced.some(([a, b]) => t >= a && t < b);
    return { voiced: on, db: on ? db(t) : -70, f0: on ? f0(t) : null };
  });
}

const metricsOf = (words: SpeechWord[], frames: AcousticFrame[] = [], extra: { targetSeconds?: number; themeWords?: string[] } = {}) =>
  computeSpeechMetrics({ frames, words, segments: [], targetSeconds: extra.targetSeconds ?? null, themeWords: extra.themeWords ?? [] });

const byId = (results: CriterionResult[], id: string) => results.find((r) => r.id === id)!;

describe('speech metrics: language', () => {
  it('counts fillers by context, not every “tipo” or “então”', () => {
    const m = metricsOf(
      wordsOf(
        'Então, o mercantilismo, né, era tipo assim uma política. Esse tipo de política protegia o comércio, sabe? ' +
          'É... Ele, tipo, acumulava ouro. Então a riqueza era o metal.',
      ),
    );
    const found = m.marks.filter((k) => k.kind === 'filler').map((k) => k.text);
    expect(found).toEqual(['Então,', 'né,', 'tipo assim', 'sabe?', 'É...', 'tipo,']);
    expect(m.fillers.count).toBe(6);
    // “Então a riqueza” has no comma or pause: a connective, not a filler.
    expect(m.fillers.top).toContainEqual({ text: 'então', count: 1 });
    expect(m.fillers.top).toContainEqual({ text: 'né', count: 1 });
  });

  it('recognizes vocal hesitations without taking the verb “é” for one', () => {
    expect(isVocalHesitation('é...')).toBe(true);
    expect(isVocalHesitation('éé,')).toBe(true);
    expect(isVocalHesitation('hum')).toBe(true);
    expect(isVocalHesitation('é')).toBe(false);
    expect(isVocalHesitation('e')).toBe(false);
  });

  it('finds hedges, longest phrase first', () => {
    const m = metricsOf(wordsOf('Eu acho que talvez seja um pouco caro demais para o reino.'));
    expect(m.weakWords.top.map((t) => t.text)).toEqual(['eu acho que', 'talvez', 'um pouco']);
    expect(m.weakWords.count).toBe(3);
  });

  it('flags a content word repeated 3 times within 30 s, except the theme', () => {
    const m = metricsOf(
      wordsOf('O comércio crescia. O comércio exigia navios. O comércio enriquecia a coroa. Mercantilismo, mercantilismo, mercantilismo.'),
      [],
      { themeWords: ['Mercantilismo'] },
    );
    expect(m.repetition.words).toEqual(['comercio']);
    expect(m.repetition.count).toBe(1);
  });

  it('measures sentence length', () => {
    const long = Array.from({ length: 40 }, () => 'palavra').join(' ') + '.';
    const m = metricsOf(wordsOf(`Frase curta aqui. ${long}`));
    expect(m.sentences.count).toBe(2);
    expect(m.sentences.longCount).toBe(1);
    expect(m.marks.some((k) => k.kind === 'long')).toBe(true);
  });
});

describe('speech metrics: voice', () => {
  // “Primeira ideia aqui.” | pause 0.6 s | “a segunda” | pause 0.5 s mid-sentence | “ideia.” | blank 3.5 s | “Fim agora.”
  const words: SpeechWord[] = [
    { text: 'Primeira', start: 0, end: 0.6 },
    { text: 'ideia', start: 0.7, end: 1.3 },
    { text: 'aqui.', start: 1.4, end: 2 },
    { text: 'a', start: 2.6, end: 2.8 },
    { text: 'segunda', start: 2.9, end: 4 },
    { text: 'ideia.', start: 4.5, end: 5 },
    { text: 'Fim', start: 8.5, end: 9 },
    { text: 'agora.', start: 9.1, end: 10 },
  ];
  const voiced: [number, number][] = [
    [0, 2],
    [2.6, 4],
    [4.5, 5],
    [8.5, 10],
  ];

  it('classifies pauses between ideas, hesitations and blanks from the audio', () => {
    const m = metricsOf(words, framesOf(10.5, voiced));
    expect(m.pauses).toEqual({ betweenIdeas: 1, hesitations: 1, blanks: 1, longest: 3.5 });
    expect(m.durationSeconds).toBe(10);
  });

  it('a steady pitch has (almost) no variation; a varied one passes the monotony limit', () => {
    const talk: [number, number][] = [[0, 12]];
    const words12 = wordsOf(Array.from({ length: 30 }, () => 'fala').join(' '));
    const steady = metricsOf(words12, framesOf(12, talk, () => 150));
    expect(steady.pitch.pvq).toBe(0);
    expect(byId(evaluateMeasured(steady), 'pitchVariation').state).toBe('improve');

    const lively = metricsOf(words12, framesOf(12, talk, (t) => 160 + 45 * Math.sin(t * 2)));
    expect(lively.pitch.pvq!).toBeGreaterThan(0.16);
    expect(byId(evaluateMeasured(lively), 'pitchVariation').state).toBe('good');
  });

  it('detects statements that end with the pitch rising', () => {
    const sentence = (start: number) => wordsOf('isto é uma afirmação clara.', start, 0.4);
    const ws = [...sentence(0), ...sentence(3), ...sentence(6)];
    // Rises 6 semitones over the last 0.45 s of each sentence.
    const f0 = (t: number) => {
      const end = [1.96, 4.96, 7.96].find((e) => t <= e && t >= e - 0.45);
      return end === undefined ? 150 : 150 * 2 ** ((6 * (t - (end - 0.45))) / 0.45 / 12);
    };
    const m = metricsOf(ws, framesOf(9, [[0, 2], [3, 5], [6, 8]], f0));
    expect(m.finalContour).toMatchObject({ measured: 3, rising: 3 });
    expect(byId(evaluateMeasured(m), 'finalContour').state).toBe('improve');
  });

  it('detects loudness lost at the end of sentences', () => {
    const ws = wordsOf('uma frase com o final engolido.', 0, 0.4);
    const m = metricsOf(ws, framesOf(3, [[0, 2.4]], () => 150, (t) => (t > 1.85 ? -32 : -20)));
    expect(m.volume).toMatchObject({ measured: 1, dropped: 1 });
  });

  it('marks unclear Whisper segments by their confidence', () => {
    const m = computeSpeechMetrics({
      frames: [],
      words: wordsOf('um dois três quatro'),
      segments: [
        { start: 0, end: 3, text: 'clara', avgLogprob: -0.2 },
        { start: 3, end: 4, text: 'embolada', avgLogprob: -1.2 },
      ],
      targetSeconds: null,
    });
    expect(m.articulation).toEqual({ unclearSeconds: 1, unclearShare: 0.25 });
  });
});

describe('speech rubric', () => {
  const words = wordsOf(Array.from({ length: 145 }, (_, i) => (i % 12 === 11 ? 'fim.' : 'palavra')).join(' '), 0, 60 / 145);

  it('turns metrics into states with the number and the reference behind them', () => {
    const m = metricsOf(words, [], { targetSeconds: 60 });
    const results = evaluateMeasured(m);
    expect(byId(results, 'pace')).toMatchObject({ state: 'good', reference: '130 a 160 palavras/min' });
    expect(byId(results, 'time').state).toBe('good');
    expect(byId(results, 'fillers')).toMatchObject({ state: 'good', value: '0,0 por minuto' });
    // No audio: what depends on it is not judged.
    expect(byId(results, 'pitchVariation').state).toBe('na');
    expect(byId(results, 'volume').state).toBe('na');
  });

  it('does not judge rates in a very short talk', () => {
    const m = metricsOf(wordsOf('né né né né.'));
    expect(byId(evaluateMeasured(m), 'fillers').state).toBe('na');
  });

  it('scores per dimension and gives the weight of empty dimensions to the others', () => {
    const r = (id: CriterionResult['id'], state: CriterionResult['state']): CriterionResult => ({
      id,
      state,
      value: '',
      reference: '',
      source: 'measured',
      original: null,
      rewrite: null,
    });
    // Voice only: the score is the voice average.
    expect(speechScore([r('pace', 'good'), r('pauses', 'improve')], 'explain')).toBe(60);
    // Content (40) all good, voice (30) all attention: (100·40 + 60·30) / 70.
    expect(speechScore([r('opening', 'good'), r('pace', 'attention'), r('volume', 'na')], 'explain')).toBe(83);
    expect(speechScore([r('pace', 'na')], 'explain')).toBeNull();
  });
});
