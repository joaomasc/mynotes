import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { CRITERIA_INFO, DIMENSION_LABELS, SPEECH_DIMENSIONS, type CriterionResult, type CriterionState, type SpeechAttempt } from '@mynotes/shared';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { StateBadge, clock, scoreTone } from './speaking-ui';

/**
 * Two talks side by side (docs/oratoria-trilha.md › Nível 4, “comparação lado
 * a lado”): score, key measures and every criterion, with the direction of
 * the change.
 */

const RANK: Record<CriterionState, number> = { improve: 0, attention: 1, good: 2, na: -1 };

function all(a: SpeechAttempt): CriterionResult[] {
  return [...a.measured, ...(a.evaluation?.criteria ?? []), ...(a.fullEvaluation?.criteria ?? [])];
}

function Trend({ before, after, higherIsBetter = true }: { before: number | null; after: number | null; higherIsBetter?: boolean }) {
  if (before === null || after === null || Math.abs(after - before) < 1e-9) return <Minus className="size-4 text-subtle" aria-label="igual" />;
  const better = higherIsBetter ? after > before : after < before;
  const Icon = after > before ? ArrowUp : ArrowDown;
  return <Icon className={cn('size-4', better ? 'text-success' : 'text-danger')} aria-label={better ? 'melhorou' : 'piorou'} />;
}

function Header({ a, label }: { a: SpeechAttempt; label: string }) {
  return (
    <Link to={`/speaking/attempts/${a.id}`} className="block rounded-xl border border-border p-3 hover:bg-surface-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('text-3xl font-semibold tabular-nums', scoreTone(a.score))}>{a.score ?? '—'}</p>
      <p className="mt-1 truncate text-xs text-muted">
        {format(new Date(a.startedAt), "d 'de' MMM, HH:mm", { locale: ptBR })} · {clock(a.durationSeconds)}
      </p>
    </Link>
  );
}

/** Picks the second talk when only the first is set. */
function Picker({ a }: { a: string }) {
  const list = useQuery({ queryKey: [...qk.speechAttempts, 'compare'], queryFn: () => endpoints.speech.list({ limit: 30 }) });
  const items = (list.data?.data ?? []).filter((x) => x.id !== a);
  if (list.isPending) return <PageLoader />;
  if (items.length === 0) return <EmptyState title="Nenhuma outra fala para comparar" description="Grave mais uma fala e volte aqui." />;
  return (
    <Card className="divide-y divide-border">
      {items.map((x) => (
        <Link key={x.id} to={`/speaking/compare?a=${a}&b=${x.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
          <span className={cn('w-10 text-center text-lg font-semibold tabular-nums', scoreTone(x.score))}>{x.score ?? '—'}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{x.theme || 'Fala'}</span>
          <span className="text-xs text-muted">{format(new Date(x.startedAt), "d 'de' MMM", { locale: ptBR })}</span>
        </Link>
      ))}
    </Card>
  );
}

export function Component() {
  const [params] = useSearchParams();
  const aId = params.get('a') ?? '';
  const bId = params.get('b') ?? '';
  const a = useQuery({ queryKey: qk.speechAttempt(aId), queryFn: () => endpoints.speech.get(aId), enabled: !!aId });
  const b = useQuery({ queryKey: qk.speechAttempt(bId), queryFn: () => endpoints.speech.get(bId), enabled: !!bId });

  if (!aId) return <Page width="narrow"><EmptyState title="Escolha uma fala para comparar" /></Page>;
  if (!bId) {
    return (
      <Page width="narrow">
        <PageHeader title="Comparar falas" subtitle="Escolha com qual fala comparar." />
        <Picker a={aId} />
      </Page>
    );
  }
  if (a.isPending || b.isPending) return <PageLoader />;
  if (a.isError || b.isError) return <ErrorState error={a.error ?? b.error} />;
  // Older first, so the arrows read as “from before to after”.
  const [before, after] = a.data.startedAt <= b.data.startedAt ? [a.data, b.data] : [b.data, a.data];
  const afterById = new Map(all(after).map((c) => [c.id, c]));
  const beforeById = new Map(all(before).map((c) => [c.id, c]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];
  // `higherIsBetter: null`: the change is shown without judging it (pace is good inside a range, not just higher).
  const measures: { label: string; get: (x: SpeechAttempt) => number | null; fmt: (n: number) => string; higherIsBetter: boolean | null }[] = [
    { label: 'Ritmo (palavras/min)', get: (x) => x.metrics.pace.wpm, fmt: (n) => String(Math.round(n)), higherIsBetter: null },
    { label: 'Vícios por minuto', get: (x) => x.metrics.fillers.perMinute, fmt: (n) => n.toFixed(1).replace('.', ','), higherIsBetter: false },
    { label: 'Palavras fracas por minuto', get: (x) => x.metrics.weakWords.perMinute, fmt: (n) => n.toFixed(1).replace('.', ','), higherIsBetter: false },
    { label: 'Variação do tom', get: (x) => x.metrics.pitch.pvq, fmt: (n) => n.toFixed(2).replace('.', ','), higherIsBetter: true },
    { label: 'Hesitações', get: (x) => x.metrics.pauses.hesitations, fmt: (n) => String(n), higherIsBetter: false },
  ];

  return (
    <Page width="narrow">
      <PageHeader title="Comparar falas" subtitle="A mais antiga à esquerda; as setas mostram se melhorou (verde) ou piorou (vermelho)." />
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-3">
          <Header a={before} label="Antes" />
          <Header a={after} label="Depois" />
        </div>
        <Section title="Medidas">
          <Card className="divide-y divide-border text-sm">
            {measures.map((m) => {
              const x = m.get(before);
              const y = m.get(after);
              return (
                <div key={m.label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5">
                  <span>{m.label}</span>
                  <span className="w-14 text-right text-muted tabular-nums">{x === null ? '—' : m.fmt(x)}</span>
                  <span className="w-14 text-right font-medium tabular-nums">{y === null ? '—' : m.fmt(y)}</span>
                  {m.higherIsBetter === null ? <Minus className="size-4 text-subtle" aria-hidden /> : <Trend before={x} after={y} higherIsBetter={m.higherIsBetter} />}
                </div>
              );
            })}
          </Card>
        </Section>
        {SPEECH_DIMENSIONS.map((dim) => {
          const rows = ids.filter((id) => CRITERIA_INFO[id].dimension === dim);
          if (rows.length === 0) return null;
          return (
            <Section key={dim} title={DIMENSION_LABELS[dim]}>
              <Card className="divide-y divide-border">
                {rows.map((id) => {
                  const x = beforeById.get(id)?.state ?? 'na';
                  const y = afterById.get(id)?.state ?? 'na';
                  return (
                    <div key={id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate">{CRITERIA_INFO[id].label}</span>
                      <StateBadge state={x} />
                      <StateBadge state={y} />
                      {x === 'na' || y === 'na' ? <Minus className="size-4 text-subtle" aria-hidden /> : <Trend before={RANK[x]} after={RANK[y]} />}
                    </div>
                  );
                })}
              </Card>
            </Section>
          );
        })}
      </div>
    </Page>
  );
}
