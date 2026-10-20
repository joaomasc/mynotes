import { Link } from 'react-router';
import { Flame, Mic } from 'lucide-react';
import { nextStep } from '@mynotes/shared';
import { Progress } from '@/components/ui/feedback';
import { Card, Section } from '@/components/ui/layout';
import { cn } from '@/lib/cn';
import { useSpeechPath } from './use-speech-path';

/** Speaking practice on the home page: streak, today's goal and the next step. */
export function SpeakingCard() {
  const { data: s } = useSpeechPath();
  if (!s) return null;
  const step = nextStep(new Set(s.completed));
  const goal = s.settings.dailyGoalMinutes * 60;
  const next = step ? (step.kind === 'lesson' ? step.lesson.title : step.kind === 'challenge' ? `Desafio: ${step.unit.title}` : `Desafio do nível ${step.level.number}`) : 'Discurso do Dia';
  return (
    <Section title="Oratória" action={<Link to="/speaking" className="text-xs text-accent hover:underline">Trilha</Link>}>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm">
            <Flame className={cn('size-4', s.streak.todayDone ? 'text-warning' : 'text-subtle')} aria-hidden />
            <span className="font-semibold tabular-nums">{s.streak.current}</span> {s.streak.current === 1 ? 'dia seguido' : 'dias seguidos'}
          </p>
          <span className="text-xs text-muted tabular-nums">
            {Math.round(s.todaySeconds / 60)}/{s.settings.dailyGoalMinutes} min hoje
          </span>
        </div>
        <Progress value={(s.todaySeconds / goal) * 100} label="Meta diária de oratória" />
        <Link
          to={step ? `/speaking/lesson/${step.kind === 'lesson' ? step.lesson.id : step.challenge.id}` : '/speaking/free?daily=1'}
          className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft/70"
        >
          <Mic className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{next}</span>
        </Link>
      </Card>
    </Section>
  );
}
