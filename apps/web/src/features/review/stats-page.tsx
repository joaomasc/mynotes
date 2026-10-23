import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { CONFIDENCE_LABELS, type Confidence, type ReviewStats } from '@mynotes/shared';
import { ErrorState, PageLoader } from '@/components/ui/feedback';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { reviewLink, tzOffset } from './use-review';

interface Column {
  day: string;
  value: number;
  detail: string;
}

/** One series as columns (one hue, no legend), with a hover tooltip and a table view. */
function Columns({ data, unit, first, last }: { data: Column[]; unit: [string, string]; first: string; last: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const tick = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const height = 120;
  const active = hover !== null ? data[hover] : null;
  const label = (n: number) => `${n} ${n === 1 ? unit[0] : unit[1]}`;
  return (
    <figure className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <button
            key={d.day}
            type="button"
            className="relative flex h-full min-w-0 flex-1 items-end justify-center focus-visible:outline-none"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${format(parseISO(d.day), "d 'de' MMM", { locale: ptBR })}: ${label(d.value)}`}
          >
            <span
              className={cn('block w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity', hover !== null && hover !== i && 'opacity-50')}
              style={{ height: d.value ? Math.max(3, (d.value / tick) * height) : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-[11px] text-subtle tabular-nums">
        <span>{first}</span>
        <span>escala até {tick}</span>
        <span>{last}</span>
      </div>
      {active && (
        <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-pop">
          <span className="font-medium">{format(parseISO(active.day), "EEEE, d 'de' MMM", { locale: ptBR })}</span>
          <span className="ml-2 text-muted">{active.detail}</span>
        </div>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left">
          <tbody className="tabular-nums">
            {data
              .filter((d) => d.value > 0)
              .map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{format(parseISO(d.day), 'dd/MM/yyyy')}</td>
                  <td className="py-1">{d.detail}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Bar({ label, value, detail }: { label: React.ReactNode; value: number; detail: React.ReactNode }) {
  return (
    <li>
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-muted tabular-nums">{detail}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-3">
        <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </li>
  );
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Calibration({ s }: { s: ReviewStats }) {
  if (s.calibration.length === 0) return <p className="text-sm text-muted">Responda “quão certo você está?” nas sessões para ver se a sua certeza acompanha os acertos.</p>;
  // A verdict needs at least two levels with a few answers each.
  const enough = s.calibration.filter((c) => c.answers >= 3);
  const rates = enough.map((c) => pct(c.correct, c.answers));
  const calibrated = rates.every((r, i) => i === 0 || r >= rates[i - 1]!);
  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {s.calibration.map((c) => (
          <Bar key={c.confidence} label={CONFIDENCE_LABELS[c.confidence as Confidence] ?? c.confidence} value={pct(c.correct, c.answers)} detail={`${pct(c.correct, c.answers)}% certas (${c.correct} de ${c.answers})`} />
        ))}
      </ul>
      <p className="text-xs text-muted">
        {enough.length < 2
          ? 'Com mais respostas em níveis diferentes de certeza, aqui aparece se ela acompanha os acertos.'
          : calibrated
            ? 'Quanto mais certo você diz estar, mais acerta: a sua certeza é um bom guia.'
            : 'A sua certeza nem sempre acompanha os acertos: desconfie um pouco do “tenho certeza”.'}
      </p>
    </div>
  );
}

/** How memory is going: real vs desired retention, the coming load, the history, calibration and weak topics. */
export function Component() {
  const today = todayIso();
  const q = useQuery({ queryKey: qk.reviewStats(today), queryFn: () => endpoints.review.stats(today, tzOffset()) });
  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const retention = s.trueRetention === null ? null : Math.round(s.trueRetention * 100);
  const target = Math.round(s.desiredRetention * 100);
  const week = s.forecast.slice(0, 7).reduce((n, d) => n + d.count, 0);

  return (
    <Page>
      <PageHeader
        above={
          <Link to="/review" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" aria-hidden /> Revisar
          </Link>
        }
        title="Estatísticas da revisão"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Memória real (30 dias)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{retention === null ? '–' : `${retention}%`}</p>
          <p className="text-xs text-subtle">{retention === null ? 'ainda sem revisões de itens aprendidos' : `meta ${target}% · ${s.matureReviews30} revisões`}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Itens</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{s.counts.total}</p>
          <p className="text-xs text-subtle">
            {s.counts.review} aprendidos · {s.counts.learning} aprendendo · {s.counts.new} novos
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Próximos 7 dias</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{week}</p>
          <p className="text-xs text-subtle">revisões marcadas</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Sequência</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{s.streak.current}</p>
          <p className="text-xs text-subtle">recorde {s.streak.best} {s.streak.best === 1 ? 'dia' : 'dias'}</p>
        </Card>
      </div>
      {retention !== null && retention < target - 5 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden /> Você está lembrando menos do que a meta. Revisar todo dia (mesmo poucos itens) e criar cartões menores costuma resolver.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Section title="Revisões marcadas (30 dias)">
          <Card className="p-4">
            <Columns data={s.forecast.map((d) => ({ day: d.day, value: d.count, detail: `${d.count} ${d.count === 1 ? 'item' : 'itens'}` }))} unit={['item', 'itens']} first="hoje" last="em 30 dias" />
          </Card>
        </Section>
        <Section title="Respostas por dia (90 dias)">
          <Card className="p-4">
            <Columns
              data={s.history.map((d) => ({ day: d.day, value: d.reviews, detail: `${d.reviews} ${d.reviews === 1 ? 'resposta' : 'respostas'}, ${d.correct} certas` }))}
              unit={['resposta', 'respostas']}
              first="90 dias atrás"
              last="hoje"
            />
          </Card>
        </Section>
        <Section title="A sua certeza acerta?">
          <Card className="p-4">
            <Calibration s={s} />
          </Card>
        </Section>
        <Section title="Assuntos para reforçar (30 dias)">
          <Card className="p-4">
            {s.weakTopics.length === 0 ? (
              <p className="text-sm text-muted">Aparecem aqui os assuntos com 3 ou mais respostas no mês, os de menos acertos primeiro.</p>
            ) : (
              <ul className="space-y-2.5">
                {s.weakTopics.map((t) => (
                  <Bar
                    key={t.topicId ?? '-'}
                    label={t.topicId ? <Link to={reviewLink([t.topicId])} className="hover:text-accent hover:underline">{t.title}</Link> : t.title}
                    value={pct(t.correct, t.reviews)}
                    detail={`${pct(t.correct, t.reviews)}% certas · ${t.reviews} respostas`}
                  />
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </div>

      {s.confidentErrors.length > 0 && (
        <Section title="Erros cometidos com certeza (14 dias)" className="mt-8">
          <Card>
            <ul className="divide-y divide-border">
              {s.confidentErrors.map((e) => (
                <li key={e.cardId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{e.front}</span>
                  <span className="shrink-0 text-xs text-muted">{format(parseISO(e.reviewedAt), "d 'de' MMM", { locale: ptBR })}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </Page>
  );
}
