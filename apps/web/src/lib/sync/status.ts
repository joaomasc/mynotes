import { useSyncExternalStore } from 'react';

/**
 * Global synchronization state shown in the sync indicator. A change is only
 * reported as synced after the server confirmed it.
 */
export interface SyncState {
  online: boolean;
  /** Mutations sent to the server and not yet answered. */
  inFlight: number;
  /** Local changes waiting to be sent (note drafts). */
  pending: number;
  /** Items with a concurrent-edit conflict that need a decision. */
  conflicts: number;
  /** Last failure, cleared on the next success. */
  lastError: string | null;
  lastSyncedAt: number | null;
}

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  inFlight: 0,
  pending: 0,
  conflicts: 0,
  lastError: null,
  lastSyncedAt: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const syncStatus = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  begin() {
    set({ inFlight: state.inFlight + 1 });
  },
  succeed() {
    set({ inFlight: Math.max(0, state.inFlight - 1), lastError: null, lastSyncedAt: Date.now(), online: true });
  },
  fail(message: string, network = false) {
    set({ inFlight: Math.max(0, state.inFlight - 1), lastError: message, ...(network ? { online: false } : {}) });
  },
  setOnline(online: boolean) {
    set({ online });
  },
  setQueue(pending: number, conflicts: number) {
    set({ pending, conflicts });
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncStatus.setOnline(true));
  window.addEventListener('offline', () => syncStatus.setOnline(false));
}

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(syncStatus.subscribe, syncStatus.get, syncStatus.get);
}
