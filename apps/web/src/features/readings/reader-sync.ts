import { useSyncExternalStore } from 'react';
import type { PdfSelection } from '../documents/pdf-viewer';

/**
 * Links a book's PDF and its annotations when they are in separate panes
 * (the PDF maximized on the left, the annotations beside it): the page being
 * read, the text selected in the PDF, and "go to page" asked from the
 * annotations. Lives in memory only, per book.
 */
export interface ReaderSync {
  page: number | null;
  selection: PdfSelection | null;
  /** Page the PDF should show (seq changes on every request, even for the same page). */
  goto: { page: number; seq: number } | null;
  /** Annotation panels open beside the PDF. */
  panels: number;
}

const EMPTY: ReaderSync = { page: null, selection: null, goto: null, panels: 0 };
const states = new Map<string, ReaderSync>();
const listeners = new Set<() => void>();

export const readerSync = {
  get: (id: string): ReaderSync => states.get(id) ?? EMPTY,
  set(id: string, patch: Partial<ReaderSync>) {
    const prev = readerSync.get(id);
    if (Object.entries(patch).every(([k, v]) => prev[k as keyof ReaderSync] === v)) return;
    states.set(id, { ...prev, ...patch });
    for (const l of listeners) l();
  },
  jump(id: string, page: number) {
    readerSync.set(id, { goto: { page, seq: Date.now() } });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function useReaderSync(id: string): ReaderSync {
  return useSyncExternalStore(readerSync.subscribe, () => readerSync.get(id));
}
