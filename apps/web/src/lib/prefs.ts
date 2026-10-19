import { useSyncExternalStore } from 'react';

/**
 * Per-device UI preferences in localStorage, shared live between the
 * components that use them (changing the reading width in Settings resizes
 * the open notes at once). Never used for user data.
 */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    // unreadable: use the default
  }
  cache.set(key, value);
  return value;
}

export function getPref<T>(key: string, fallback: T): T {
  return read(key, fallback);
}

export function setPref<T>(key: string, value: T): void {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: the preference simply isn't remembered
  }
  for (const l of listeners.get(key) ?? []) l();
}

export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (l) => {
      const set = listeners.get(key) ?? new Set();
      set.add(l);
      listeners.set(key, set);
      return () => set.delete(l);
    },
    () => read(key, fallback),
    () => fallback,
  );
  return [value, (v: T) => setPref(key, v)];
}

/** Width of the text column of notes. */
export const READING_WIDTHS = {
  narrow: { label: 'Estreita', className: 'max-w-[38rem]' },
  medium: { label: 'Média', className: 'max-w-[46rem]' },
  wide: { label: 'Larga', className: 'max-w-[60rem]' },
  full: { label: 'Toda a largura', className: 'max-w-none' },
} as const;
export type ReadingWidth = keyof typeof READING_WIDTHS;
export const useReadingWidth = () => usePref<ReadingWidth>('mynotes:reading-width', 'medium');
