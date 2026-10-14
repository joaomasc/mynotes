import { createStore, del, entries, get, set } from 'idb-keyval';
import { asRichTextDoc, type Note, type NoteSummary, type RichTextDoc } from '@mynotes/shared';
import { ApiError, NetworkError, isVersionConflict } from '../api/client';
import { endpoints } from '../api/endpoints';
import { syncStatus } from './status';

/**
 * Local-first saving for notes.
 *
 * Every edit is written immediately to an IndexedDB draft, then sent to the
 * server with the version it was based on. The draft is deleted only after
 * the server confirms the save, so closing the tab, reloading or losing the
 * connection never loses text. Pending drafts are flushed on startup, when
 * the connection returns and periodically.
 *
 * Conflicts (the note changed on another device): the draft is kept and
 * marked `conflict` together with the server copy; the user decides to keep
 * theirs (overwrite), take the server version, or save theirs as a new note.
 */
export interface NoteDraft {
  noteId: string;
  baseVersion: number;
  title: string;
  content: RichTextDoc;
  /** Monotonic local edit counter, to know if edits happened during a save. */
  revision: number;
  editedAt: number;
  status: 'pending' | 'conflict';
  server?: Note | undefined;
}

export type SaveState = 'saved' | 'saving' | 'pending' | 'offline' | 'conflict' | 'error';

const store = createStore('mynotes-drafts', 'notes');
/** Serializes network saves per note. */
const locks = new Map<string, Promise<void>>();
/** Serializes short IndexedDB read-modify-write sections per note (never held during network calls). */
const idbLocks = new Map<string, Promise<unknown>>();

function idbLock<T>(noteId: string, fn: () => Promise<T>): Promise<T> {
  const previous = idbLocks.get(noteId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  idbLocks.set(
    noteId,
    next.catch(() => undefined),
  );
  return next;
}
const listeners = new Map<string, Set<() => void>>();
const states = new Map<string, SaveState>();
const errors = new Map<string, string>();

function notify(noteId: string) {
  for (const l of listeners.get(noteId) ?? []) l();
}

function setState(noteId: string, s: SaveState, error?: string) {
  states.set(noteId, s);
  if (error) errors.set(noteId, error);
  else errors.delete(noteId);
  notify(noteId);
}

/**
 * Emergency copy written synchronously (localStorage) when the page is being
 * unloaded with edits that have not reached IndexedDB yet. Migrated to the
 * IndexedDB draft store on the next load, then removed.
 */
const EMERGENCY_PREFIX = 'mynotes:unsaved-note:';

interface EmergencyDraft {
  baseVersion: number;
  title: string;
  content: RichTextDoc;
  at: number;
}

export function writeEmergencyDraft(noteId: string, baseVersion: number, title: string, content: RichTextDoc): void {
  try {
    localStorage.setItem(EMERGENCY_PREFIX + noteId, JSON.stringify({ baseVersion, title, content, at: Date.now() } satisfies EmergencyDraft));
  } catch {
    // Quota or storage disabled: the async IndexedDB write is still attempted.
  }
}

async function recoverEmergencyDrafts(onlyId?: string): Promise<void> {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(EMERGENCY_PREFIX));
  } catch {
    return;
  }
  for (const key of keys) {
    const noteId = key.slice(EMERGENCY_PREFIX.length);
    if (onlyId && noteId !== onlyId) continue;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as EmergencyDraft | null;
      if (saved) {
        const existing = await get<NoteDraft>(noteId, store);
        if (!existing || existing.editedAt < saved.at) {
          await notesSync.edit(noteId, saved.baseVersion, saved.title, saved.content);
        }
      }
    } catch {
      // Corrupt entry: drop it.
    }
    localStorage.removeItem(key);
  }
}

async function refreshQueueCounters() {
  const all = await entries<string, NoteDraft>(store);
  syncStatus.setQueue(
    all.filter(([, d]) => d.status === 'pending').length,
    all.filter(([, d]) => d.status === 'conflict').length,
  );
}

export const notesSync = {
  subscribe(noteId: string, listener: () => void) {
    const set = listeners.get(noteId) ?? new Set();
    set.add(listener);
    listeners.set(noteId, set);
    return () => set.delete(listener);
  },
  state: (noteId: string): SaveState => states.get(noteId) ?? 'saved',
  error: (noteId: string): string | undefined => errors.get(noteId),
  async getDraft(noteId: string): Promise<NoteDraft | undefined> {
    await recoverEmergencyDrafts(noteId);
    return get<NoteDraft>(noteId, store);
  },
  /** Callback invoked after a successful save with the exact title/content that were saved. */
  onSaved: null as ((summary: NoteSummary, saved: { title: string; content: RichTextDoc }) => void) | null,

  /** Records a local edit (instant, offline-safe). */
  async edit(noteId: string, baseVersion: number, title: string, content: RichTextDoc): Promise<void> {
    const draft = await idbLock(noteId, async () => {
      const current = await get<NoteDraft>(noteId, store);
      const next: NoteDraft = {
        noteId,
        baseVersion: current?.baseVersion ?? baseVersion,
        title,
        content,
        revision: (current?.revision ?? 0) + 1,
        editedAt: Date.now(),
        status: current?.status ?? 'pending',
        server: current?.server,
      };
      await set(noteId, next, store);
      return next;
    });
    if (draft.status !== 'conflict') setState(noteId, 'pending');
    void refreshQueueCounters();
  },

  /** Sends the draft to the server. Serialized per note. */
  save(noteId: string): Promise<void> {
    const previous = locks.get(noteId) ?? Promise.resolve();
    const next = previous.then(() => saveNow(noteId)).catch(() => undefined);
    locks.set(noteId, next);
    return next;
  },

  /** Conflict resolution. */
  async resolve(noteId: string, choice: 'mine' | 'server'): Promise<void> {
    const outcome = await idbLock(noteId, async () => {
      const draft = await get<NoteDraft>(noteId, store);
      if (!draft) return 'none' as const;
      if (choice === 'server') {
        await del(noteId, store);
        return 'saved' as const;
      }
      // Keep my text, rebased on the server version: the next save overwrites it.
      const serverVersion = draft.server?.version ?? draft.baseVersion;
      await set(noteId, { ...draft, baseVersion: serverVersion, status: 'pending', server: undefined }, store);
      return 'pending' as const;
    });
    if (outcome === 'saved') setState(noteId, 'saved');
    if (outcome === 'pending') {
      setState(noteId, 'pending');
      await notesSync.save(noteId);
    }
    void refreshQueueCounters();
  },

  /** Marks a local draft as conflicting with the given server copy. */
  async markConflict(noteId: string, server: Note): Promise<void> {
    await idbLock(noteId, async () => {
      const draft = await get<NoteDraft>(noteId, store);
      if (draft) await set(noteId, { ...draft, status: 'conflict', server }, store);
    });
    setState(noteId, 'conflict');
    void refreshQueueCounters();
  },

  async discard(noteId: string): Promise<void> {
    await del(noteId, store);
    setState(noteId, 'saved');
    void refreshQueueCounters();
  },

  /** Sends every pending draft (startup, back online, periodic). */
  async flushAll(): Promise<void> {
    await recoverEmergencyDrafts();
    const all = await entries<string, NoteDraft>(store);
    for (const [id, draft] of all) {
      if (draft.status === 'pending') await notesSync.save(id);
    }
    await refreshQueueCounters();
  },

  async pendingCount(): Promise<number> {
    return (await entries<string, NoteDraft>(store)).length;
  },

  async clearAll(): Promise<void> {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(EMERGENCY_PREFIX)) localStorage.removeItem(k);
    } catch {
      // storage unavailable
    }
    const all = await entries<string, NoteDraft>(store);
    for (const [id] of all) await del(id, store);
    await refreshQueueCounters();
  },
};

async function saveNow(noteId: string): Promise<void> {
  const draft = await get<NoteDraft>(noteId, store);
  if (!draft || draft.status === 'conflict') return;
  setState(noteId, 'saving');
  try {
    const summary = await endpoints.notes.update(noteId, {
      baseVersion: draft.baseVersion,
      title: draft.title,
      // Drafts written by older versions may hold `{ type: 'doc' }` (no content).
      content: asRichTextDoc(draft.content),
    });
    const outcome = await idbLock(noteId, async () => {
      const latest = await get<NoteDraft>(noteId, store);
      if (latest && latest.revision === draft.revision) {
        await del(noteId, store);
        return 'saved' as const;
      }
      if (latest) {
        // More edits arrived while saving: rebase them on the new version and send again.
        await set(noteId, { ...latest, baseVersion: summary.version }, store);
        return 'again' as const;
      }
      return 'saved' as const;
    });
    if (outcome === 'saved') setState(noteId, 'saved');
    else {
      setState(noteId, 'pending');
      queueMicrotask(() => void notesSync.save(noteId));
    }
    notesSync.onSaved?.(summary, { title: draft.title, content: draft.content });
  } catch (err) {
    if (isVersionConflict(err)) {
      await idbLock(noteId, async () => {
        const latest = (await get<NoteDraft>(noteId, store)) ?? draft;
        await set(noteId, { ...latest, status: 'conflict', server: err.details.current as Note }, store);
      });
      setState(noteId, 'conflict');
    } else if (err instanceof NetworkError) {
      setState(noteId, 'offline');
    } else if (err instanceof ApiError && err.status === 404) {
      // The note was deleted elsewhere: keep the text so the user can copy it.
      setState(noteId, 'error', 'Esta nota foi excluída em outro dispositivo. Copie o texto se quiser mantê-lo.');
    } else {
      setState(noteId, 'error', err instanceof Error ? err.message : 'Falha ao salvar');
    }
  } finally {
    void refreshQueueCounters();
  }
}

let started = false;
/** Starts background flushing; call once after authentication. */
export function startNotesSync(): () => void {
  if (started) return () => undefined;
  started = true;
  const flush = () => void notesSync.flushAll();
  window.addEventListener('online', flush);
  const onVisible = () => document.visibilityState === 'visible' && flush();
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => {
    if (syncStatus.get().pending > 0 && navigator.onLine) flush();
  }, 20_000);
  flush();
  return () => {
    started = false;
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
