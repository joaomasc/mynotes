import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PAGE_SIZE_MAX, type NoteSummary } from '@mynotes/shared';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { dailyNote, parseDailyTitle } from '../notes/templates';
import { useSetting } from '../settings/use-settings';
import { useTopics } from '../topics/use-topics';

/**
 * Daily notes, as in Obsidian: one note per day, recognized by its title (the
 * format in Settings) inside the daily notes topic. Nothing marks them on the
 * server, so renaming one to another date moves it in the calendar.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-21" (local day). */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export interface DailyEntry {
  day: string;
  note: NoteSummary;
}

/** Enough pages for years of daily notes. */
const MAX_PAGES = 20;

export function useDailyNotes() {
  const settings = useSetting('notes').value;
  const { dailyTopicId, dailyFormat } = settings;
  const query = useQuery({
    // Under "notes": any note change refreshes the calendar.
    queryKey: qk.notes({ daily: dailyTopicId, format: dailyFormat }),
    queryFn: async ({ signal }) => {
      const notes: NoteSummary[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await endpoints.notes.list({ topicId: dailyTopicId ?? 'none', role: 'note', sort: 'updated', limit: PAGE_SIZE_MAX, ...(cursor ? { cursor } : {}) });
        notes.push(...page.data);
        if (!page.meta.nextCursor || signal.aborted) break;
        cursor = page.meta.nextCursor;
      }
      return notes;
    },
    staleTime: 30_000,
  });

  const entries = useMemo(() => {
    const byDay = new Map<string, NoteSummary>();
    for (const note of query.data ?? []) {
      const date = parseDailyTitle(dailyFormat, note.title);
      // Two notes for the same day: the most recently edited one wins (the list is newest first).
      if (date && !byDay.has(dayKey(date))) byDay.set(dayKey(date), note);
    }
    const sorted: DailyEntry[] = [...byDay].map(([day, note]) => ({ day, note })).sort((a, b) => a.day.localeCompare(b.day));
    return { byDay, sorted };
  }, [query.data, dailyFormat]);

  return { ...entries, settings, query };
}

/** The daily note a note is, if any: its day and the nearest daily notes before and after it. */
export function useDailyNeighbours(note: { id: string; title: string; topicId: string | null; role: string } | null) {
  const daily = useDailyNotes();
  const date = note && note.role === 'note' && note.topicId === daily.settings.dailyTopicId ? parseDailyTitle(daily.settings.dailyFormat, note.title) : null;
  if (!date) return null;
  const day = dayKey(date);
  const before = daily.sorted.filter((e) => e.day < day);
  const after = daily.sorted.filter((e) => e.day > day);
  return { day, date, previous: before[before.length - 1] ?? null, next: after[0] ?? null };
}

/** Opens the daily note of a day, creating it (with the daily template) when it doesn't exist. */
export function useOpenDaily() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tree } = useTopics();
  const { byDay, settings } = useDailyNotes();
  return useMutation({
    mutationFn: async (date: Date) => {
      const existing = byDay.get(dayKey(date));
      if (existing) return existing.id;
      // Keep the current time, so {{hora}} in the template still makes sense on another day.
      const now = new Date();
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), now.getHours(), now.getMinutes());
      const topicTitle = (settings.dailyTopicId && tree.byId.get(settings.dailyTopicId)?.title) || '';
      return (await dailyNote(qc, settings, topicTitle, at)).id;
    },
    onSuccess: (id) => void navigate(`/notes/${id}`),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
