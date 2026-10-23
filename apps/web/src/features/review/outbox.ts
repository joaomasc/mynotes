import { useEffect, useSyncExternalStore } from 'react';
import { createStore, del, entries, set } from 'idb-keyval';
import type { ReviewAnswer, ReviewAnswerResult } from '@mynotes/shared';
import { ApiError, NetworkError } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * Answers given without internet: kept in IndexedDB with the time they were
 * given and sent when the connection returns (the API schedules them from
 * that time). A session keeps going meanwhile.
 */

interface Pending {
  cardId: string;
  body: ReviewAnswer;
}

const store = createStore('mynotes-review', 'outbox');
let count = 0;
const listeners = new Set<() => void>();
const notify = (n: number) => {
  count = n;
  for (const l of listeners) l();
};

async function refreshCount() {
  try {
    notify((await entries(store)).length);
  } catch {
    // IndexedDB unavailable (private mode): nothing is kept.
  }
}

/** Sends an answer; offline, keeps it and returns null. */
export async function sendAnswer(cardId: string, body: ReviewAnswer): Promise<ReviewAnswerResult | null> {
  const stamped = { ...body, reviewedAt: body.reviewedAt ?? new Date().toISOString() };
  try {
    return await endpoints.review.answer(cardId, stamped);
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    await set(stamped.id, { cardId, body: stamped } satisfies Pending, store);
    await refreshCount();
    return null;
  }
}

let flushing: Promise<number> | null = null;

/** Sends what was kept, oldest first; stops at the first network failure. Returns how many were sent. */
export function flushOutbox(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const pending = (await entries<string, Pending>(store)).sort((a, b) => String(a[1].body.reviewedAt).localeCompare(String(b[1].body.reviewedAt)));
      for (const [key, item] of pending) {
        try {
          await endpoints.review.answer(item.cardId, item.body);
          sent++;
        } catch (err) {
          if (err instanceof NetworkError) break;
          // Refused for good (card deleted, answer too old): dropping it is the only way forward.
          if (!(err instanceof ApiError)) break;
        }
        await del(key, store);
      }
    } catch {
      // IndexedDB unavailable.
    } finally {
      await refreshCount();
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}

/** How many answers wait for the connection; sends them when it returns. */
export function useOutbox(onSent?: (n: number) => void): number {
  const pending = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
  );
  useEffect(() => {
    const flush = () => void flushOutbox().then((n) => n > 0 && onSent?.(n));
    void refreshCount().then(() => count > 0 && navigator.onLine && flush());
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [onSent]);
  return pending;
}
