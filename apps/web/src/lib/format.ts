import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function relativeTime(iso: string): string {
  const date = parseISO(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'agora';
  if (isToday(date)) return formatDistanceToNowStrict(date, { locale: ptBR, addSuffix: true });
  if (isYesterday(date)) return `ontem, ${format(date, 'HH:mm')}`;
  if (diff < 6 * 86400_000) return format(date, "EEEE', 'HH:mm", { locale: ptBR });
  return format(date, "d 'de' MMM 'de' yyyy", { locale: ptBR });
}

export function dateTime(iso: string): string {
  return format(parseISO(iso), "d 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR });
}

export function shortDate(isoOrDate: string): string {
  const d = isoOrDate.length === 10 ? parseISO(`${isoOrDate}T12:00:00`) : parseISO(isoOrDate);
  return format(d, "d 'de' MMM", { locale: ptBR });
}

export function longDate(isoOrDate: string): string {
  const d = isoOrDate.length === 10 ? parseISO(`${isoOrDate}T12:00:00`) : parseISO(isoOrDate);
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
