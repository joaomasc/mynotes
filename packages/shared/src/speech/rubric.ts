import type { CriterionResult, SpeechMetrics } from '../schemas/speech';
import type { CriterionState, MeasuredCriterionId, SpeechCriterionId, SpeechDimension, SpeechType } from './criteria';
import { DEFAULT_SPEECH_LIMITS, type SpeechLimits } from './limits';

/**
 * The rubric of docs/oratoria.md as data. The same functions run in the
 * browser (immediate result) and in the API (which stores what counts).
 * Bump RUBRIC_VERSION whenever a threshold or a formula changes, so old
 * scores keep saying which rubric produced them.
 */
export const RUBRIC_VERSION = 1;

export interface CriterionInfo {
  dimension: SpeechDimension;
  source: CriterionResult['source'];
  label: string;
  /** What “good” means, in one sentence (shown in the result details). */
  good: string;
}

export const CRITERIA_INFO: Record<SpeechCriterionId, CriterionInfo> = {
  opening: { dimension: 'content', source: 'textAi', label: 'Abertura', good: 'Chama a atenção, apresenta o tema e diz o caminho da fala.' },
  centralIdea: { dimension: 'content', source: 'textAi', label: 'Ideia central', good: 'Cabe em uma frase e é dita explicitamente.' },
  development: { dimension: 'content', source: 'textAi', label: 'Desenvolvimento', good: 'De 2 a 4 pontos, cada um com afirmação, explicação e exemplo.' },
  transitions: { dimension: 'content', source: 'textAi', label: 'Transições', good: 'Avisa quando passa de um ponto ao outro.' },
  conclusion: { dimension: 'content', source: 'textAi', label: 'Conclusão', good: 'Retoma a ideia central e fecha com uma frase clara.' },
  correctness: { dimension: 'content', source: 'textAi', label: 'Correção', good: 'Nada contradiz as suas notas; os conceitos-chave aparecem.' },
  time: { dimension: 'content', source: 'measured', label: 'Tempo', good: 'Dentro de ±10% do tempo definido.' },
  sentences: { dimension: 'language', source: 'measured', label: 'Frases', good: 'Curtas ou médias, uma ideia por frase.' },
  fillers: { dimension: 'language', source: 'measured', label: 'Vícios de linguagem', good: '“Né”, “tipo”, “então”… raros a ponto de não serem percebidos.' },
  weakWords: { dimension: 'language', source: 'measured', label: 'Palavras fracas', good: 'Afirma o que sabe; atenua só quando a incerteza é real.' },
  repetition: { dimension: 'language', source: 'measured', label: 'Repetição', good: 'Repete de propósito, não por falta de palavra.' },
  precision: { dimension: 'language', source: 'textAi', label: 'Precisão', good: 'Termos técnicos definidos; nada de “coisa” no lugar do conceito.' },
  pace: { dimension: 'voice', source: 'measured', label: 'Ritmo', good: 'Ritmo de conversa calma, desacelerando no que importa.' },
  pauses: { dimension: 'voice', source: 'measured', label: 'Pausas', good: 'Pausas entre ideias, nunca no meio da frase.' },
  volume: { dimension: 'voice', source: 'measured', label: 'Volume no fim das frases', good: 'A voz não cai no fim das frases.' },
  pitchVariation: { dimension: 'voice', source: 'measured', label: 'Entonação', good: 'O tom varia para marcar ênfase e contraste.' },
  finalContour: { dimension: 'voice', source: 'measured', label: 'Final das afirmações', good: 'O tom desce no fim de uma afirmação.' },
  articulation: { dimension: 'voice', source: 'measured', label: 'Articulação', good: 'Palavras completas, sílabas finais pronunciadas.' },
  stability: { dimension: 'voice', source: 'audioAi', label: 'Estabilidade da voz', good: 'Voz firme do começo ao fim.' },
  confidence: { dimension: 'presence', source: 'audioAi', label: 'Segurança', good: 'Soa convicto do que diz.' },
  naturalness: { dimension: 'presence', source: 'audioAi', label: 'Naturalidade', good: 'Soa como conversa, mesmo com roteiro.' },
  emphasis: { dimension: 'presence', source: 'audioAi', label: 'Ênfase', good: 'Destaca as palavras que carregam a ideia.' },
  energy: { dimension: 'presence', source: 'audioAi', label: 'Energia', good: 'Coerente com o tema e o público.' },
};

export const DIMENSION_LABELS: Record<SpeechDimension, string> = {
  content: 'Conteúdo e estrutura',
  language: 'Linguagem',
  voice: 'Voz',
  presence: 'Presença',
};

export const SPEECH_TYPE_LABELS: Record<SpeechType, string> = {
  explain: 'Apresentação',
  persuasive: 'Discurso persuasivo',
  impromptu: 'Improviso',
  qa: 'Banca / perguntas',
};

/** Weight of each dimension in the score, per kind of talk (percent). */
export const TYPE_WEIGHTS: Record<SpeechType, Record<SpeechDimension, number>> = {
  explain: { content: 40, language: 20, voice: 30, presence: 10 },
  persuasive: { content: 30, language: 25, voice: 25, presence: 20 },
  impromptu: { content: 30, language: 30, voice: 30, presence: 10 },
  qa: { content: 50, language: 25, voice: 20, presence: 5 },
};

const POINTS: Record<Exclude<CriterionState, 'na'>, number> = { good: 100, attention: 60, improve: 20 };

const dec = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Lower is better: up to `good` is good, up to `attention` needs attention. */
function lowerBetter(value: number, good: number, attention: number): CriterionState {
  return value <= good ? 'good' : value <= attention ? 'attention' : 'improve';
}

const worst = (...states: CriterionState[]): CriterionState =>
  states.includes('improve') ? 'improve' : states.includes('attention') ? 'attention' : states.includes('good') ? 'good' : 'na';

function result(id: MeasuredCriterionId, state: CriterionState, value: string, reference: string): CriterionResult {
  return { id, state, value, reference, source: 'measured', original: null, rewrite: null };
}

/** Rates per minute say little about a talk shorter than this. */
const MIN_SECONDS_FOR_RATES = 20;

/** States of the measured criteria. */
export function evaluateMeasured(m: SpeechMetrics, limits: SpeechLimits = DEFAULT_SPEECH_LIMITS): CriterionResult[] {
  const out: CriterionResult[] = [];
  const short = m.durationSeconds < MIN_SECONDS_FOR_RATES;

  if (m.targetSeconds) {
    const dev = Math.abs(m.durationSeconds - m.targetSeconds) / m.targetSeconds;
    out.push(
      result(
        'time',
        lowerBetter(dev, limits.timeGood, limits.timeAttention),
        `${clock(m.durationSeconds)} de ${clock(m.targetSeconds)} (${m.durationSeconds > m.targetSeconds ? '+' : '−'}${pct(dev)})`,
        `até ±${pct(limits.timeGood)} do tempo definido`,
      ),
    );
  } else {
    out.push(result('time', 'na', clock(m.durationSeconds), 'sem tempo definido'));
  }

  out.push(
    m.sentences.count < 2
      ? result('sentences', 'na', 'poucas frases para avaliar', `média até ${limits.sentenceGood} palavras`)
      : result(
          'sentences',
          lowerBetter(m.sentences.avgWords, limits.sentenceGood, limits.sentenceAttention),
          `média de ${dec(m.sentences.avgWords)} palavras por frase` + (m.sentences.longCount ? ` · ${m.sentences.longCount} muito longa(s)` : ''),
          `média até ${limits.sentenceGood} palavras; acima de ${limits.sentenceAttention}, difícil de acompanhar`,
        ),
  );

  const top = (list: { text: string; count: number }[]) =>
    list.length ? ` (${list.slice(0, 3).map((t) => `“${t.text}” ${t.count}×`).join(', ')})` : '';
  out.push(
    short
      ? result('fillers', 'na', 'fala curta demais para medir', `até ${limits.fillersGood} por minuto`)
      : result(
          'fillers',
          lowerBetter(m.fillers.perMinute, limits.fillersGood, limits.fillersAttention),
          `${dec(m.fillers.perMinute)} por minuto${top(m.fillers.top)}`,
          `bom: até ${limits.fillersGood}/min · atenção: até ${limits.fillersAttention}/min`,
        ),
  );
  out.push(
    short
      ? result('weakWords', 'na', 'fala curta demais para medir', `até ${limits.weakWordsGood} por minuto`)
      : result(
          'weakWords',
          lowerBetter(m.weakWords.perMinute, limits.weakWordsGood, limits.weakWordsAttention),
          `${dec(m.weakWords.perMinute)} por minuto${top(m.weakWords.top)}`,
          `bom: até ${limits.weakWordsGood}/min · atenção: até ${limits.weakWordsAttention}/min`,
        ),
  );
  out.push(
    short
      ? result('repetition', 'na', 'fala curta demais para medir', `até ${limits.repetitionGood} por minuto`)
      : result(
          'repetition',
          lowerBetter(m.repetition.perMinute, limits.repetitionGood, limits.repetitionAttention),
          m.repetition.count
            ? `${dec(m.repetition.perMinute)} por minuto (${m.repetition.words.slice(0, 3).map((w) => `“${w}”`).join(', ')})`
            : 'nenhuma repetição em sequência',
          'a mesma palavra 3 vezes ou mais em 30 s',
        ),
  );

  const [pg0, pg1] = limits.paceGood;
  const [pa0, pa1] = limits.paceAttention;
  const wpm = m.pace.wpm;
  out.push(
    m.durationSeconds < 15
      ? result('pace', 'na', 'fala curta demais para medir', `${pg0} a ${pg1} palavras/min`)
      : result(
          'pace',
          wpm >= pg0 && wpm <= pg1 ? 'good' : wpm >= pa0 && wpm <= pa1 ? 'attention' : 'improve',
          `${Math.round(wpm)} palavras/min` + (wpm > pg1 ? ' (rápido)' : wpm < pg0 ? ' (lento)' : ''),
          `${pg0} a ${pg1} palavras/min`,
        ),
  );

  const hesitationRate = m.pauses.hesitations / (Math.max(m.durationSeconds, 1) / 60);
  const pauseStates: CriterionState[] = short ? [] : [lowerBetter(hesitationRate, limits.hesitationsGood, limits.hesitationsAttention)];
  if (m.pauses.blanks > 0) pauseStates.push(m.pauses.blanks > 1 ? 'improve' : 'attention');
  if (!short && m.durationSeconds >= 30 && m.pauses.betweenIdeas === 0) pauseStates.push('attention');
  out.push(
    result(
      'pauses',
      worst(...pauseStates),
      `${m.pauses.hesitations} hesitação(ões) no meio da frase · ${m.pauses.blanks} branco(s) · ${m.pauses.betweenIdeas} pausa(s) entre ideias`,
      `até ${limits.hesitationsGood} hesitação por minuto; silêncio acima de ${limits.blankSeconds} s é branco`,
    ),
  );

  const dropShare = m.volume.measured ? m.volume.dropped / m.volume.measured : 0;
  out.push(
    m.volume.measured < 3
      ? result('volume', 'na', 'poucas frases medidas', `queda de até ${limits.finalDropDb} dB no fim`)
      : result(
          'volume',
          lowerBetter(dropShare, limits.dropShareGood, limits.dropShareAttention),
          `${m.volume.dropped} de ${m.volume.measured} frases perdem volume no fim`,
          `queda acima de ${limits.finalDropDb} dB em até ${pct(limits.dropShareGood)} das frases`,
        ),
  );

  const pvq = m.pitch.pvq;
  const flat = m.pitch.windows.filter((w) => w.pvq < limits.pvqGood).length;
  out.push(
    pvq === null
      ? result('pitchVariation', 'na', 'tom não detectado com segurança', `variação de ${dec(limits.pvqGood, 2)} ou mais`)
      : result(
          'pitchVariation',
          pvq >= limits.pvqGood ? 'good' : pvq >= limits.pvqAttention ? 'attention' : 'improve',
          `variação do tom de ${dec(pvq, 2)}` + (flat ? ` · ${flat} trecho(s) de 10 s monótono(s)` : ''),
          `${dec(limits.pvqGood, 2)} ou mais; abaixo disso, monótono`,
        ),
  );

  const c = m.finalContour;
  out.push(
    c.measured < 3
      ? result('finalContour', 'na', 'poucas afirmações medidas', `até ${pct(limits.risingShareGood)} subindo`)
      : result(
          'finalContour',
          lowerBetter(c.rising / c.measured, limits.risingShareGood, limits.risingShareAttention),
          `${c.rising} de ${c.measured} afirmações terminam com o tom subindo`,
          `até ${pct(limits.risingShareGood)} das afirmações subindo`,
        ),
  );

  const share = m.articulation.unclearShare;
  out.push(
    share === null
      ? result('articulation', 'na', 'sem dados de confiança da transcrição', `até ${pct(limits.unclearShareGood)} da fala pouco clara`)
      : result(
          'articulation',
          lowerBetter(share, limits.unclearShareGood, limits.unclearShareAttention),
          `${pct(share)} da fala pouco clara para o reconhecimento`,
          `até ${pct(limits.unclearShareGood)}; ruído e nomes próprios também contam`,
        ),
  );
  return out;
}

/**
 * Score from 0 to 100: average points per dimension, weighted by the kind of
 * talk. Dimensions with nothing evaluated (presence without the full
 * evaluation) give their weight to the others. Null when nothing was judged.
 */
export function speechScore(results: CriterionResult[], type: SpeechType): number | null {
  const weights = TYPE_WEIGHTS[type];
  let total = 0;
  let weightSum = 0;
  for (const dim of Object.keys(weights) as SpeechDimension[]) {
    const judged = results.filter((r) => r.state !== 'na' && CRITERIA_INFO[r.id].dimension === dim);
    if (judged.length === 0) continue;
    const avg = judged.reduce((a, r) => a + POINTS[r.state as Exclude<CriterionState, 'na'>], 0) / judged.length;
    total += avg * weights[dim];
    weightSum += weights[dim];
  }
  return weightSum ? Math.round(total / weightSum) : null;
}
