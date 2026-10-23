import { Link } from 'react-router';
import { Brain, Flame, Inbox } from 'lucide-react';
import { uuidv7 } from '@mynotes/shared';
import { Card, Section } from '@/components/ui/layout';
import { cn } from '@/lib/cn';
import { sessionLink, useReviewSummary } from './use-review';

/** Revisar on the home page: what is due today, the streak and the AI questions waiting. */
export function ReviewHomeCard() {
  const { data: s } = useReviewSummary();
  if (!s || (s.total === 0 && s.proposals === 0)) return null;
  const today = s.due + s.newAvailable;
  return (
    <Section title="Revisar" action={<Link to="/review" className="text-xs text-accent hover:underline">Abrir</Link>}>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="flex items-center gap-1.5">
            <Flame className={cn('size-4', s.reviewedToday ? 'text-warning' : 'text-subtle')} aria-hidden />
            <span className="font-semibold tabular-nums">{s.streak}</span> {s.streak === 1 ? 'dia seguido' : 'dias seguidos'}
          </p>
          <span className="text-xs text-muted tabular-nums">{s.reviewedToday} respostas hoje</span>
        </div>
        {today > 0 ? (
          <Link to={sessionLink(uuidv7(), { topicIds: [], mode: 'due' })} className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft/70">
            <Brain className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              Revisar agora: {today} {today === 1 ? 'item' : 'itens'}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted">Nada vence hoje. Volte amanhã ou faça um treino livre.</p>
        )}
        {s.proposals > 0 && (
          <Link to="/review/proposals" className="flex items-center gap-2 text-xs text-muted hover:text-accent">
            <Inbox className="size-3.5" aria-hidden /> {s.proposals} {s.proposals === 1 ? 'sugestão da IA espera' : 'sugestões da IA esperam'} aprovação
          </Link>
        )}
      </Card>
    </Section>
  );
}
