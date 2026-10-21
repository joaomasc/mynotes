import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, addMonths, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Flame, Settings } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { formatDate } from '../notes/templates';
import { NoteListItem } from '../notes/note-list-item';
import { useTopics } from '../topics/use-topics';
import { dayKey, useDailyNotes, useOpenDaily } from './use-daily';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Days in a row with a note, ending today (or yesterday, while today's isn't written yet). */
function currentStreak(has: (day: string) => boolean): number {
  let day = new Date();
  if (!has(dayKey(day))) day = addDays(day, -1);
  let n = 0;
  while (has(dayKey(day))) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function Component() {
  const [params, setParams] = useSearchParams();
  const { byDay, sorted, settings, query } = useDailyNotes();
  const open = useOpenDaily();
  const { tree } = useTopics();
  const today = dayKey(new Date());

  const month = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : startOfMonth(new Date());
  }, [params]);
  const setMonth = (date: Date) => setParams({ month: format(date, 'yyyy-MM') }, { replace: true });

  const days = useMemo(() => {
    const first = startOfWeek(month, { weekStartsOn: 0 });
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);

  const monthKey = format(month, 'yyyy-MM');
  const inMonth = sorted.filter((e) => e.day.startsWith(monthKey)).reverse();
  const streak = currentStreak((d) => byDay.has(d));
  const topicTitle = settings.dailyTopicId ? tree.byId.get(settings.dailyTopicId)?.title : null;
  const busyDay = open.isPending && open.variables ? dayKey(open.variables) : null;

  return (
    <Page width="wide">
      <PageHeader
        title="Notas diárias"
        subtitle={
          <>
            Uma nota por dia, com o título “{formatDate(settings.dailyFormat)}”{topicTitle ? ` em “${topicTitle}”` : ', sem assunto'}. Clique num dia para abrir ou criar a nota dele.
          </>
        }
        actions={
          <>
            <Link
              to="/settings#notas"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
              title="Assunto, formato do título e modelo das notas diárias"
            >
              <Settings className="size-4" aria-hidden /> <span className="hidden sm:inline">Configurar</span>
            </Link>
            <Button variant="primary" icon={<CalendarPlus className="size-4" />} loading={busyDay === today} onClick={() => open.mutate(new Date())} title="Alt+Shift+D">
              Nota de hoje
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-1">
              <h2 className="flex-1 text-[15px] font-semibold first-letter:uppercase">{format(month, "MMMM 'de' yyyy", { locale: ptBR })}</h2>
              {!isSameMonth(month, new Date()) && (
                <Button size="sm" variant="ghost" onClick={() => setMonth(startOfMonth(new Date()))}>
                  Hoje
                </Button>
              )}
              <IconButton label="Mês anterior" size="sm" onClick={() => setMonth(addMonths(month, -1))}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton label="Próximo mês" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" role="group" aria-label="Calendário de notas diárias">
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="pb-1 text-[11px] font-semibold text-subtle" aria-hidden>
                  {d}
                </span>
              ))}
              {days.map((date) => {
                const key = dayKey(date);
                const note = byDay.get(key);
                const outside = !isSameMonth(date, month);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => open.mutate(date)}
                    disabled={open.isPending}
                    title={note ? note.title : `Criar a nota de ${format(date, "d 'de' MMMM", { locale: ptBR })}`}
                    aria-label={`${format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}${note ? ', com nota' : ''}`}
                    aria-current={key === today ? 'date' : undefined}
                    className={cn(
                      'relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm tabular-nums transition-colors hover:bg-surface-2 disabled:cursor-wait',
                      outside ? 'text-subtle/60' : 'text-text',
                      note && 'font-semibold',
                      key === today && 'bg-accent-soft text-accent ring-1 ring-accent/40',
                      busyDay === key && 'animate-pulse',
                    )}
                  >
                    {date.getDate()}
                    <span className={cn('mt-0.5 size-1.5 rounded-full', note ? (outside ? 'bg-accent/40' : 'bg-accent') : 'bg-transparent')} aria-hidden />
                  </button>
                );
              })}
            </div>
          </Card>
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-[13px] text-muted">
            <span>{plural(inMonth.length, 'nota neste mês', 'notas neste mês')}</span>
            <span className="inline-flex items-center gap-1">
              <Flame className={cn('size-3.5', streak > 0 ? 'text-warning' : 'text-subtle')} aria-hidden />
              {streak > 0 ? `${plural(streak, 'dia seguido', 'dias seguidos')}` : 'Nenhuma sequência ativa'}
            </span>
            <span>{plural(sorted.length, 'nota diária', 'notas diárias')} no total</span>
          </div>
        </div>

        <Section title={`Notas de ${format(month, 'MMMM', { locale: ptBR })}`}>
          {query.isLoading ? (
            <ListSkeleton rows={4} />
          ) : query.isError && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : inMonth.length ? (
            <Card className="divide-y divide-border overflow-hidden">
              {inMonth.map((e) => (
                <NoteListItem key={e.note.id} note={e.note} showTopic={false} />
              ))}
            </Card>
          ) : (
            <EmptyState
              className="rounded-xl border border-dashed border-border py-10"
              icon={<CalendarDays />}
              title="Nenhuma nota diária neste mês"
              description="Escolha um dia no calendário, ou abra a de hoje com Alt+Shift+D de qualquer lugar."
            />
          )}
        </Section>
      </div>
    </Page>
  );
}
