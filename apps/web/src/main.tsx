import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/ui/dialog';
import { onLogout, restoreSession } from '@/lib/auth/session';
import { PERSIST_BUSTER, clearQueryCache, queryClient, queryPersister, shouldPersistQuery } from '@/lib/query';
import { notesSync } from '@/lib/sync/notes-sync';
import { router } from '@/app/router';
import { registerServiceWorker } from '@/app/pwa';
import './index.css';

// Local data belongs to the session: wipe caches and drafts on logout.
onLogout(async () => {
  await clearQueryCache();
  await notesSync.clearAll();
});

// After a confirmed save, the cached note must match what the server stored
// (version AND content), or a later reload could start from stale content.
notesSync.onSaved = (summary, saved) => {
  void queryClient.invalidateQueries({ queryKey: ['notes'] });
  // References, tags and backlinks are derived from the saved content.
  for (const key of [['backlinks'], ['tags'], ['topic-context'], ['reference', 'note', summary.id]]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
  queryClient.setQueryData(['note', summary.id], (prev: object | undefined) =>
    prev ? { ...prev, ...summary, title: saved.title, content: saved.content } : prev,
  );
};

void restoreSession();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      // The restored cache is shown at once (and offline) but may predate the
      // last changes (writes are throttled): refetch whatever is on screen.
      onSuccess={() => void queryClient.invalidateQueries()}
      persistOptions={{
        persister: queryPersister,
        buster: PERSIST_BUSTER,
        maxAge: 7 * 24 * 3600_000,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          className: '!bg-surface !text-text !border-border !shadow-pop',
        }}
        mobileOffset={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      />
    </PersistQueryClientProvider>
  </StrictMode>,
);
