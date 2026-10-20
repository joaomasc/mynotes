import { CircleAlert, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { SPEECH_TYPE_LABELS, type CriterionState, type SpeechAttemptSummary } from '@mynotes/shared';
import { cn } from '@/lib/cn';

export const STATE_LABELS: Record<CriterionState, string> = {
  good: 'Bom',
  attention: 'Atenção',
  improve: 'A melhorar',
  na: 'Sem avaliação',
};

const STATE_STYLE: Record<CriterionState, { icon: typeof CircleCheck; className: string }> = {
  good: { icon: CircleCheck, className: 'bg-success-soft text-success' },
  attention: { icon: CircleAlert, className: 'bg-warning-soft text-warning' },
  improve: { icon: CircleX, className: 'bg-danger-soft text-danger' },
  na: { icon: CircleMinus, className: 'bg-surface-2 text-subtle' },
};

/** State of a criterion: icon + word, never color alone. */
export function StateBadge({ state, className }: { state: CriterionState; className?: string }) {
  const { icon: Icon, className: tone } = STATE_STYLE[state];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium', tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {STATE_LABELS[state]}
    </span>
  );
}

/** Score out of 100 as a ring-less, plain figure with its qualifier. */
export function scoreTone(score: number | null): string {
  if (score === null) return 'text-subtle';
  return score >= 80 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-danger';
}

/** What a talk was about: the topic, the theme or the kind of talk. */
export function attemptTitle(a: Pick<SpeechAttemptSummary, 'theme' | 'speechType' | 'topicId'>, topicTitle?: string | null): string {
  return topicTitle || a.theme || SPEECH_TYPE_LABELS[a.speechType];
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
