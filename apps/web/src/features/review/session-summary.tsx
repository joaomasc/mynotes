import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, Target, TriangleAlert } from 'lucide-react';
import { REVIEW_MODE_LABELS, formatInterval, uuidv7, type ReviewSessionSummary } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/feedback';
import { Card, Section } from '@/components/ui/layout';
import { duration } from '@/lib/format';
import { reviewLink, sessionLink } from './use-review';

/** The end of a session: what went well, the mistakes made with certainty, each topic, and when the next review is. */
export function SessionSummaryView({ summary }: { summary: ReviewSessionSummary }) {
  const s = summary.session;
  const pct = summary.items ? Math.round((summary.firstTry / summary.items) * 100) : 0;
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-muted">
          {REVIEW_MODE_LABELS[s.mode]} · {format(parseISO(s.startedAt), "d 'de' MMMM, HH:mm", { locale: ptBR })}
        </p>
        <h2 className="mt-1 text-2xl font-semibold">{s.finishedAt ? 'Sessão concluída' : 'Sessão em andamento'}</h2>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums">{summary.items + summary.recalls.length}</p>
          <p className="text-xs text-muted">{summary.recalls.length ? 'itens e recordações' : 'itens'}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums">{summary.items ? `${pct}%` : '–'}</p>
          <p className="text-xs text-muted">certos de primeira</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums">{s.seconds ? duration(s.seconds) : '–'}</p>
          <p className="text-xs text-muted">{s.studySessionId ? 'registrado em Estudo' : 'de estudo'}</p>
        </Card>
      </div>

      {summary.confidentErrors.length > 0 && (
        <Section title="Errou tendo certeza">
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-sm text-warning">
              <TriangleAlert className="size-4" aria-hidden /> Vale uma segunda olhada: esses erros se corrigem bem, mas voltam se você não revisar.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {summary.confidentErrors.map((e) => (
                <li key={e.cardId}>{e.front}</li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {summary.byTopic.length > 0 && (
        <Section title="Por assunto">
          <Card>
            <ul className="divide-y divide-border">
              {summary.byTopic.map((t) => (
                <li key={t.topicId ?? '-'} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{t.title}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {t.correct}/{t.reviewed} certas
                    </span>
                  </div>
                  <Progress value={(t.correct / Math.max(1, t.reviewed)) * 100} label={`Acertos em ${t.title}`} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {summary.recalls.length > 0 && (
        <Section title="O que você lembrou">
          <Card>
            <ul className="divide-y divide-border">
              {summary.recalls.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="truncate">{r.topicTitle}</span>
                  <span className="shrink-0 text-xs text-muted">{r.coverage === null ? 'sem comparação' : `${r.coverage}% das ideias`}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <p className="flex items-center justify-center gap-1.5 text-sm text-muted">
        <Clock className="size-4" aria-hidden />
        {summary.nextDue ? `O próximo item desta seleção volta em ${formatInterval(new Date().toISOString(), summary.nextDue)}.` : 'Nenhum item desta seleção tem revisão marcada.'}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        <Link to={reviewLink(s.topicIds)} className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
          Voltar para Revisar
        </Link>
        <Link to={sessionLink(uuidv7(), { topicIds: s.topicIds, mode: 'practice' })}>
          <Button variant="outline" icon={<Target className="size-4" />}>
            Treinar mais
          </Button>
        </Link>
      </div>
    </div>
  );
}
