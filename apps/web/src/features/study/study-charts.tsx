import { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { StudyStats } from '@mynotes/shared';
import { cn } from '@/lib/cn';
import { duration } from '@/lib/format';
import { useTopics } from '../topics/use-topics';

/** Minutes per day as columns (single series: one hue, no legend, hover tooltip). */
export function DailyColumns({ stats, from, days }: { stats: StudyStats; from: Date; days: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const byDate = new Map(stats.byDay.map((d) => [d.date, d]));
    return Array.from({ length: days }, (_, i) => {
      const date = format(addDays(from, i), 'yyyy-MM-dd');
      const d = byDate.get(date);
      return { date, seconds: d?.seconds ?? 0, sessions: d?.sessions ?? 0 };
    });
  }, [stats, from, days]);
  const max = Math.max(...series.map((d) => d.seconds), 1);
  // Clean tick: round the max up to a whole number of hours (or 30 min).
  const tickSeconds = max <= 1800 ? 1800 : Math.ceil(max / 3600) * 3600;
  const height = 140;
  const barWidth = Math.min(24, Math.max(4, Math.floor(560 / days) - 2));
  const active = hover !== null ? series[hover] : null;

  return (
    <figure className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => {
          const h = d.seconds ? Math.max(3, (d.seconds / tickSeconds) * height) : 0;
          return (
            <button
              key={d.date}
              type="button"
              className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${format(parseISO(d.date), "d 'de' MMM", { locale: ptBR })}: ${d.seconds ? duration(d.seconds) : 'sem estudo'}`}
            >
              <span
                className={cn('block rounded-t-[4px] bg-accent transition-opacity', hover !== null && hover !== i && 'opacity-50')}
                style={{ height: h, width: barWidth }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-[11px] text-subtle tabular-nums">
        <span>{format(from, "d 'de' MMM", { locale: ptBR })}</span>
        <span>escala até {duration(tickSeconds)}</span>
        <span>hoje</span>
      </div>
      {active && (
        <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-pop">
          <span className="font-medium">{format(parseISO(active.date), "EEEE, d 'de' MMM", { locale: ptBR })}</span>
          <span className="ml-2 text-muted">
            {active.seconds ? `${duration(active.seconds)} · ${active.sessions} sessão(ões)` : 'sem estudo'}
          </span>
        </div>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-subtle">
            <tr>
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 font-medium">Tempo</th>
              <th className="py-1 font-medium">Sessões</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {series
              .filter((d) => d.seconds > 0)
              .map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1">{format(parseISO(d.date), 'dd/MM/yyyy')}</td>
                  <td className="py-1">{duration(d.seconds)}</td>
                  <td className="py-1">{d.sessions}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Time per topic as horizontal bars; names are text labels, bars share one hue. */
export function TopicBars({ stats }: { stats: StudyStats }) {
  const { tree } = useTopics();
  const rows = stats.byTopic.slice(0, 8);
  const rest = stats.byTopic.slice(8).reduce((s, r) => s + r.seconds, 0);
  const max = Math.max(...rows.map((r) => r.seconds), rest, 1);
  if (rows.length === 0) return <p className="text-sm text-muted">Sem sessões no período.</p>;
  const items = [
    ...rows.map((r) => ({ key: r.topicId ?? 'none', label: r.topicId ? (tree.byId.get(r.topicId)?.title ?? 'Assunto excluído') : 'Sem assunto', seconds: r.seconds })),
    ...(rest > 0 ? [{ key: 'other', label: 'Outros', seconds: rest }] : []),
  ];
  return (
    <ul className="space-y-2.5">
      {items.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-muted tabular-nums">{duration(r.seconds)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-3">
            <div className="h-2 rounded-full bg-accent" style={{ width: `${(r.seconds / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sequential single-hue intensity for the calendar (0 = no study). */
export function intensityClass(seconds: number): string {
  if (seconds <= 0) return 'bg-surface-2 text-muted';
  if (seconds < 30 * 60) return 'bg-accent/20 text-text';
  if (seconds < 60 * 60) return 'bg-accent/40 text-text';
  if (seconds < 2 * 3600) return 'bg-accent/65 text-text';
  return 'bg-accent text-accent-fg';
}
