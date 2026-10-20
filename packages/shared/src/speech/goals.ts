import type { CriterionResult, SpeechMetrics } from '../schemas/speech';
import type { CriterionState, TextAiCriterionId } from './criteria';
import { CRITERIA_INFO } from './rubric';

/**
 * Goals of a lesson or challenge, written over the metrics of the rubric
 * (“até 3 vícios por minuto”). Goals that need the model's reading of the
 * talk (criterion) are only checked when there is an evaluation.
 */
export type SpeechGoal =
  | { metric: 'wpm'; min: number; max: number }
  | { metric: 'fillersPerMinute'; max: number }
  | { metric: 'weakPerMinute'; max: number }
  | { metric: 'hesitationsPerMinute'; max: number }
  | { metric: 'blanks'; max: number }
  | { metric: 'betweenIdeas'; min: number }
  | { metric: 'pvq'; min: number }
  | { metric: 'risingShare'; max: number }
  | { metric: 'dropShare'; max: number }
  | { metric: 'unclearShare'; max: number }
  | { metric: 'avgSentenceWords'; max: number }
  | { metric: 'duration'; min?: number; max?: number }
  | { metric: 'criterion'; id: TextAiCriterionId; atLeast: 'attention' | 'good' };

export interface GoalResult {
  goal: SpeechGoal;
  /** What the goal asks, in Portuguese. */
  label: string;
  /** What was measured. */
  value: string;
  /** null: could not be checked (no audio data, no evaluation yet). */
  passed: boolean | null;
}

const dec = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const RANK: Record<CriterionState, number> = { good: 2, attention: 1, improve: 0, na: -1 };

export function goalLabel(g: SpeechGoal): string {
  switch (g.metric) {
    case 'wpm':
      return `Ritmo entre ${g.min} e ${g.max} palavras por minuto`;
    case 'fillersPerMinute':
      return `Até ${dec(g.max)} vício(s) de linguagem por minuto`;
    case 'weakPerMinute':
      return `Até ${dec(g.max)} palavra(s) fraca(s) por minuto`;
    case 'hesitationsPerMinute':
      return `Até ${dec(g.max)} pausa(s) de hesitação por minuto`;
    case 'blanks':
      return g.max === 0 ? 'Nenhum branco (silêncio acima de 3 s)' : `Até ${g.max} branco(s)`;
    case 'betweenIdeas':
      return `Pelo menos ${g.min} pausa(s) entre ideias`;
    case 'pvq':
      return `Variação do tom de ${dec(g.min, 2)} ou mais`;
    case 'risingShare':
      return `Até ${pct(g.max)} das afirmações terminando com o tom subindo`;
    case 'dropShare':
      return `Até ${pct(g.max)} das frases perdendo volume no fim`;
    case 'unclearShare':
      return `Até ${pct(g.max)} da fala pouco clara`;
    case 'avgSentenceWords':
      return `Frases com média de até ${g.max} palavras`;
    case 'duration':
      return g.min !== undefined && g.max !== undefined
        ? `Duração entre ${clock(g.min)} e ${clock(g.max)}`
        : g.min !== undefined
          ? `Falar pelo menos ${clock(g.min)}`
          : `Falar no máximo ${clock(g.max ?? 0)}`;
    case 'criterion':
      return `${CRITERIA_INFO[g.id].label}: ${g.atLeast === 'good' ? 'bom' : 'pelo menos “atenção”'}`;
  }
}

export function checkGoal(g: SpeechGoal, m: SpeechMetrics, evaluation: CriterionResult[] | null): GoalResult {
  const minutes = Math.max(m.durationSeconds, 1) / 60;
  const out = (passed: boolean | null, value: string): GoalResult => ({ goal: g, label: goalLabel(g), value, passed });
  switch (g.metric) {
    case 'wpm':
      return out(m.durationSeconds >= 10 ? m.pace.wpm >= g.min && m.pace.wpm <= g.max : null, `${Math.round(m.pace.wpm)} palavras/min`);
    case 'fillersPerMinute':
      return out(m.fillers.perMinute <= g.max, `${dec(m.fillers.perMinute)} por minuto`);
    case 'weakPerMinute':
      return out(m.weakWords.perMinute <= g.max, `${dec(m.weakWords.perMinute)} por minuto`);
    case 'hesitationsPerMinute': {
      const rate = m.pauses.hesitations / minutes;
      return out(rate <= g.max, `${dec(rate)} por minuto`);
    }
    case 'blanks':
      return out(m.pauses.blanks <= g.max, `${m.pauses.blanks} branco(s)`);
    case 'betweenIdeas':
      return out(m.pauses.betweenIdeas >= g.min, `${m.pauses.betweenIdeas} pausa(s)`);
    case 'pvq':
      return out(m.pitch.pvq === null ? null : m.pitch.pvq >= g.min, m.pitch.pvq === null ? 'tom não detectado' : dec(m.pitch.pvq, 2));
    case 'risingShare': {
      const c = m.finalContour;
      return out(c.measured < 2 ? null : c.rising / c.measured <= g.max, c.measured ? `${c.rising} de ${c.measured}` : 'poucas afirmações');
    }
    case 'dropShare': {
      const v = m.volume;
      return out(v.measured < 2 ? null : v.dropped / v.measured <= g.max, v.measured ? `${v.dropped} de ${v.measured}` : 'poucas frases');
    }
    case 'unclearShare': {
      const s = m.articulation.unclearShare;
      return out(s === null ? null : s <= g.max, s === null ? 'sem dados' : pct(s));
    }
    case 'avgSentenceWords':
      return out(m.sentences.count ? m.sentences.avgWords <= g.max : null, `${dec(m.sentences.avgWords)} palavras`);
    case 'duration': {
      const d = m.durationSeconds;
      return out((g.min === undefined || d >= g.min) && (g.max === undefined || d <= g.max), clock(d));
    }
    case 'criterion': {
      const c = evaluation?.find((r) => r.id === g.id);
      if (!c || c.state === 'na') return out(null, c ? 'não avaliado' : 'aguardando a avaliação da IA');
      return out(RANK[c.state] >= RANK[g.atLeast], { good: 'bom', attention: 'atenção', improve: 'a melhorar', na: '' }[c.state]);
    }
  }
}

/**
 * All goals of a talk. It passes when every goal that could be checked
 * passed and at least one was checked; goals that need the model count only
 * once the evaluation exists.
 */
export function checkGoals(goals: SpeechGoal[], m: SpeechMetrics, evaluation: CriterionResult[] | null) {
  const results = goals.map((g) => checkGoal(g, m, evaluation));
  const checked = results.filter((r) => r.passed !== null);
  return { results, passed: goals.length === 0 || (checked.length > 0 && checked.every((r) => r.passed)) };
}

export const needsEvaluation = (goals: SpeechGoal[]) => goals.some((g) => g.metric === 'criterion');
