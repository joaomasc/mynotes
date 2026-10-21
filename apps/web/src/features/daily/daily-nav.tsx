import { Link } from 'react-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Note } from '@mynotes/shared';
import { cn } from '@/lib/cn';
import { parseDailyTitle } from '../notes/templates';
import { useSetting } from '../settings/use-settings';
import { dayFromKey, dayKey, useDailyNeighbours, useOpenDaily } from './use-daily';

const linkClass = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-text';

/** Above a daily note: its day, the previous and next daily notes, the calendar and today's note. */
export function DailyNav({ note }: { note: Note }) {
  const settings = useSetting('notes').value;
  // Checked without the network: only daily notes load the list of the others.
  const isDaily = note.role === 'note' && note.topicId === settings.dailyTopicId && !!parseDailyTitle(settings.dailyFormat, note.title);
  return isDaily ? <DailyNavBar note={note} /> : null;
}

function DailyNavBar({ note }: { note: Note }) {
  const daily = useDailyNeighbours(note);
  const open = useOpenDaily();
  if (!daily) return null;
  const today = dayKey(new Date());
  const short = (day: string) => format(dayFromKey(day), "d 'de' MMM", { locale: ptBR });
  return (
    <nav aria-label="Notas diárias" className="mx-auto mt-2 flex max-w-[46rem] flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2/50 px-1.5 py-1">
      {daily.previous ? (
        <Link to={`/notes/${daily.previous.note.id}`} className={linkClass} title="Nota diária anterior">
          <ChevronLeft className="size-3.5" aria-hidden /> {short(daily.previous.day)}
        </Link>
      ) : (
        <span className={cn(linkClass, 'pointer-events-none opacity-40')}>
          <ChevronLeft className="size-3.5" aria-hidden /> Anterior
        </span>
      )}
      <Link to={`/daily?month=${daily.day.slice(0, 7)}`} className={cn(linkClass, 'flex-1 justify-center font-medium text-text')} title="Abrir o calendário">
        <CalendarDays className="size-3.5 text-accent" aria-hidden />
        <span className="inline-block first-letter:uppercase">{format(daily.date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
      </Link>
      {daily.day !== today && (
        <button type="button" className={linkClass} onClick={() => open.mutate(new Date())} disabled={open.isPending}>
          Hoje
        </button>
      )}
      {daily.next ? (
        <Link to={`/notes/${daily.next.note.id}`} className={linkClass} title="Próxima nota diária">
          {short(daily.next.day)} <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      ) : (
        <span className={cn(linkClass, 'pointer-events-none opacity-40')}>
          Próxima <ChevronRight className="size-3.5" aria-hidden />
        </span>
      )}
    </nav>
  );
}
