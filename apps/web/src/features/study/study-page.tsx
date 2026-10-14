import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { addDays, addMonths, endOfMonth, format, getDay, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Ellipsis, Pencil, Plus, Star, Trash, X } from 'lucide-react';
import type { StudySession } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { duration } from '@/lib/format';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { SessionDialog, invalidateStudy, type SessionPrefill } from './session-dialog';
import { DailyColumns, TopicBars, intensityClass } from './study-charts';
import { StudyTimerCard } from './study-timer';

const tzOffset = () => -new Date().getTimezoneOffset();

function Calendar({ month, onMonth, selected, onSelect }: { month: Date; onMonth: (d: Date) => void; selected: string | null; onSelect: (d: string | null) => void }) {
  const from = startOfMonth(month);
  const to = addDays(endOfMonth(month), 1);
  const { data } = useQuery({
    queryKey: qk.studyStats({ month: format(month, 'yyyy-MM') }),
    queryFn: () => endpoints.study.stats({ from: from.toISOString(), to: to.toISOString(), tzOffset: tzOffset() }),
  });
  const byDate = new Map((data?.byDay ?? []).map((d) => [d.date, d.seconds]));
  const lead = (getDay(from) + 6) % 7; // weeks start on Monday
  const days = Array.from({ length: endOfMonth(month).getDate() }, (_, i) => addDays(from, i));
  const today = format(new Date(), 'yyyy-MM-dd');
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="Mês anterior" size="sm" onClick={() => onMonth(subMonths(month, 1))}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <span className="text-sm font-medium capitalize">{format(month, 'MMMM yyyy', { locale: ptBR })}</span>
        <IconButton label="Próximo mês" size="sm" onClick={() => onMonth(addMonths(month, 1))} disabled={addMonths(month, 1) > new Date()}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-subtle" aria-hidden>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Calendário de estudos">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const secs = byDate.get(key) ?? 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(selected === key ? null : key)}
              aria-pressed={selected === key}
              aria-label={`${format(d, "d 'de' MMMM", { locale: ptBR })}: ${secs ? duration(secs) : 'sem estudo'}`}
              title={secs ? duration(secs) : undefined}
              className={cn(
                'aspect-square rounded-md text-xs tabular-nums transition-shadow',
                intensityClass(secs),
                key === today && 'font-semibold underline underline-offset-2',
                selected === key && 'ring-2 ring-text ring-offset-1 ring-offset-surface',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 text-[11px] text-subtle" aria-hidden>
        menos
        {[0, 1200, 2400, 4800, 9000].map((s) => (
          <span key={s} className={cn('size-3 rounded-sm', intensityClass(s))} />
        ))}
        mais
      </div>
    </div>
  );
}

function SessionRow({ s, onEdit, onDelete }: { s: StudySession; onEdit: () => void; onDelete: () => void }) {
  const d = new Date(s.startedAt);
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-14 shrink-0 text-center">
        <div className="text-lg leading-none font-semibold">{format(d, 'd')}</div>
        <div className="text-[11px] text-muted uppercase">{format(d, 'MMM', { locale: ptBR })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.objective || 'Sessão de estudo'}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>
            {format(d, 'HH:mm')} · {duration(s.durationSeconds)}
          </span>
          {s.source === 'timer' && <span>· cronômetro</span>}
          {s.progressRating && (
            <span className="inline-flex items-center gap-0.5" aria-label={`Progresso ${s.progressRating} de 5`}>
              <Star className="size-3 fill-warning text-warning" aria-hidden /> {s.progressRating}/5
            </span>
          )}
          {s.noteIds.length + s.documentIds.length > 0 && <span>· {s.noteIds.length + s.documentIds.length} referência(s)</span>}
          {s.topicId && <TopicChip topicId={s.topicId} />}
        </div>
        {s.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{s.notes}</p>}
      </div>
      <Menu
        label="Ações da sessão"
        trigger={
          <IconButton label="Ações" size="sm">
            <Ellipsis className="size-4" />
          </IconButton>
        }
        items={[
          { label: 'Editar', icon: <Pencil />, onSelect: onEdit },
          { label: 'Excluir', icon: <Trash />, danger: true, onSelect: onDelete },
        ]}
      />
    </div>
  );
}

export function Component() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [day, setDay] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ session?: StudySession; prefill?: SessionPrefill } | null>(null);

  useEffect(() => {
    if (params.get('log') === '1') {
      // Opened from a topic page: the session belongs to that topic.
      const topicId = params.get('topicId');
      setDialog(topicId ? { prefill: { topicId } } : {});
      const next = new URLSearchParams(params);
      next.delete('log');
      next.delete('topicId');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const days = Number(period);
  const from = useMemo(() => startOfDay(addDays(new Date(), -(days - 1))), [days]);
  const stats = useQuery({
    queryKey: qk.studyStats({ period }),
    queryFn: () => endpoints.study.stats({ from: from.toISOString(), to: addDays(startOfDay(new Date()), 1).toISOString(), tzOffset: tzOffset() }),
  });

  const range = day ? { from: new Date(`${day}T00:00`).toISOString(), to: addDays(new Date(`${day}T00:00`), 1).toISOString() } : {};
  const history = useInfiniteQuery({
    queryKey: qk.sessionsList({ day, infinite: true }),
    queryFn: ({ pageParam }) => endpoints.study.list({ ...range, limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const sessions = history.data?.pages.flatMap((p) => p.data) ?? [];

  const remove = async (s: StudySession) => {
    if (!(await confirm({ title: 'Excluir sessão?', description: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.study.remove(s.id);
      invalidateStudy(qc);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const s = stats.data;
  return (
    <Page width="wide">
      <PageHeader
        title="Diário de estudos"
        subtitle="Registre sessões, acompanhe o tempo e veja como ele se distribui entre os assuntos."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
            Registrar sessão
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Tempo estudado</h2>
              <Segmented
                label="Período"
                size="sm"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: '7', label: '7 dias' },
                  { value: '30', label: '30 dias' },
                  { value: '90', label: '90 dias' },
                ]}
              />
            </div>
            {stats.isLoading ? (
              <Skeleton className="h-48" />
            ) : stats.isError || !s ? (
              <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
            ) : (
              <>
                <dl className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ['Total', duration(s.totalSeconds)],
                    ['Sessões', String(s.sessionCount)],
                    ['Dias com estudo', `${s.activeDays} de ${days}`],
                    ['Média por dia ativo', s.activeDays ? duration(Math.round(s.totalSeconds / s.activeDays)) : '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="mt-0.5 text-xl font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <DailyColumns stats={s} from={from} days={days} />
              </>
            )}
          </Card>

          <Section
            title={day ? `Sessões em ${format(new Date(`${day}T12:00`), "d 'de' MMMM", { locale: ptBR })}` : 'Histórico'}
            action={
              day ? (
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setDay(null)}>
                  Limpar filtro
                </Button>
              ) : undefined
            }
          >
            {history.isLoading ? (
              <ListSkeleton rows={4} />
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={<CalendarDays />}
                title={day ? 'Nenhuma sessão neste dia' : 'Nenhuma sessão registrada'}
                description="Use o cronômetro ou registre uma sessão manualmente."
                className="rounded-xl border border-dashed border-border"
              />
            ) : (
              <>
                <Card className="divide-y divide-border overflow-hidden">
                  {sessions.map((x) => (
                    <SessionRow key={x.id} s={x} onEdit={() => setDialog({ session: x })} onDelete={() => void remove(x)} />
                  ))}
                </Card>
                {history.hasNextPage && (
                  <div className="flex justify-center">
                    <Button variant="outline" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                      Carregar mais
                    </Button>
                  </div>
                )}
              </>
            )}
          </Section>
        </div>

        <aside className="space-y-6">
          <StudyTimerCard onFinish={(prefill) => setDialog({ prefill })} />
          <Card className="p-5">
            <Calendar month={month} onMonth={setMonth} selected={day} onSelect={setDay} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-[13px] font-semibold tracking-wide text-muted uppercase">Por assunto ({period} dias)</h2>
            {s ? <TopicBars stats={s} /> : <Skeleton className="h-32" />}
          </Card>
        </aside>
      </div>
      <SessionDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} session={dialog?.session ?? null} prefill={dialog?.prefill ?? null} />
    </Page>
  );
}
