import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { createStore, del, get, set } from 'idb-keyval';
import { ApiError, NetworkError } from './api/client';
import { APP_VERSION } from './config';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * 24 * 3600_000,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
      retry: (count, err) => {
        if (err instanceof ApiError && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: {
      networkMode: 'always',
      retry: false,
    },
  },
});

/**
 * Read cache persisted in IndexedDB so previously loaded data is available
 * offline and on cold starts. The server remains the source of truth; this
 * cache is wiped on logout.
 */
const cacheStore = createStore('mynotes-cache', 'queries');
export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key, cacheStore).then((v) => v ?? null),
    setItem: (key, value) => set(key, value, cacheStore),
    removeItem: (key) => del(key, cacheStore),
  },
  key: 'mynotes-query-cache',
  throttleTime: 2000,
});
/**
 * Changing it discards every cache saved on devices. The suffix is bumped when
 * what may be persisted changes ("2": binary file contents were saved by
 * mistake and came back as plain objects, crashing the PDF viewer).
 */
export const PERSIST_BUSTER = `v${APP_VERSION}-2`;

/**
 * What is saved to disk for instant (and offline) startup: successful JSON
 * data only. File contents (ArrayBuffer/Blob) do not survive serialization,
 * and reference titles must always be current (renames).
 */
export function shouldPersistQuery(q: { queryKey: readonly unknown[]; state: { status: string; data: unknown } }): boolean {
  const data = q.state.data;
  if (q.state.status !== 'success') return false;
  if (String(q.queryKey[0]).startsWith('reference') || q.queryKey[0] === 'document-file') return false;
  return !(data instanceof ArrayBuffer || ArrayBuffer.isView(data) || (typeof Blob !== 'undefined' && data instanceof Blob));
}

export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await del('mynotes-query-cache', cacheStore);
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof NetworkError;
}

/** Query keys in one place so invalidations stay consistent. */
export const qk = {
  me: ['me'] as const,
  sessions: ['sessions'] as const,
  topics: ['topics'] as const,
  topic: (id: string) => ['topic', id] as const,
  notes: (filters: object) => ['notes', filters] as const,
  notesAll: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  revisions: (id: string) => ['note-revisions', id] as const,
  backlinks: (type: string, id: string) => ['backlinks', type, id] as const,
  documents: (filters: object) => ['documents', filters] as const,
  documentsAll: ['documents'] as const,
  document: (id: string) => ['document', id] as const,
  readings: (filters: object) => ['readings', filters] as const,
  readingsAll: ['readings'] as const,
  reading: (id: string) => ['reading', id] as const,
  plans: ['plans'] as const,
  plan: (id: string) => ['plan', id] as const,
  upcoming: ['plans-upcoming'] as const,
  sessionsList: (filters: object) => ['study-sessions', filters] as const,
  studyAll: ['study-sessions'] as const,
  studyStats: (range: object) => ['study-stats', range] as const,
  concepts: ['concepts'] as const,
  relations: (type: string, id: string) => ['relations', type, id] as const,
  relationsAll: ['relations'] as const,
  mindMaps: ['mind-maps'] as const,
  mindMap: (id: string) => ['mind-map', id] as const,
  graph: (filters: object) => ['graph', filters] as const,
  dashboard: ['dashboard'] as const,
  favorites: ['favorites'] as const,
  activity: ['activity'] as const,
  settings: ['settings'] as const,
  trash: ['trash'] as const,
  search: (q: string, types: string) => ['search', q, types] as const,
  topicContext: (id: string) => ['topic-context', id] as const,
  tags: (q: string) => ['tags', q] as const,
  tagsAll: ['tags'] as const,
  reference: (type: string, id: string) => ['reference', type, id] as const,
  referencesAll: ['reference'] as const,
  layout: (key: string) => ['layout', key] as const,
  aiStatus: ['ai-status'] as const,
  aiIndex: ['ai-index'] as const,
  aiConversations: ['ai-conversations'] as const,
  aiConversation: (id: string) => ['ai-conversation', id] as const,
  speechAttempts: ['speech-attempts'] as const,
  speechAttempt: (id: string) => ['speech-attempt', id] as const,
  speechPath: (today: string) => ['speech-path', today] as const,
};
