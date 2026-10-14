import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/ui/feedback';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { useAuth } from '@/lib/auth/session';
import { startNotesSync } from '@/lib/sync/notes-sync';
import { useSettingsSync } from '@/features/settings/use-settings';
import { RouteError } from './route-error';

function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (auth.status === 'authenticated') return startNotesSync();
  }, [auth.status]);
  useSettingsSync(auth.status === 'authenticated');
  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PageLoader />
      </div>
    );
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

const page = (loader: () => Promise<{ Component: React.ComponentType }>) => ({ lazy: loader });

const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
    {
      element: <RequireAuth />,
      errorElement: <RouteError />,
      hydrateFallbackElement: <PageLoader />,
      children: [
        {
          element: <AppShell />,
          errorElement: <RouteError />,
          children: [
            { index: true, ...page(() => import('@/features/dashboard/dashboard-page')) },
            { path: 'topics/:id', ...page(() => import('@/features/topics/topic-page')) },
            { path: 'notes', ...page(() => import('@/features/notes/notes-page')) },
            { path: 'notes/:id', ...page(() => import('@/features/notes/note-page')) },
            { path: 'library', ...page(() => import('@/features/documents/library-page')) },
            { path: 'library/:id', ...page(() => import('@/features/documents/document-page')) },
            { path: 'readings', ...page(() => import('@/features/readings/readings-page')) },
            { path: 'readings/:id', ...page(() => import('@/features/readings/reading-page')) },
            { path: 'plans', ...page(() => import('@/features/plans/plans-page')) },
            { path: 'plans/:id', ...page(() => import('@/features/plans/plan-page')) },
            { path: 'study', ...page(() => import('@/features/study/study-page')) },
            { path: 'maps', ...page(() => import('@/features/mindmaps/maps-page')) },
            { path: 'maps/:id', ...page(() => import('@/features/mindmaps/map-page')) },
            { path: 'graph', ...page(() => import('@/features/graph/graph-page')) },
            { path: 'concepts/:id', ...page(() => import('@/features/concepts/concept-page')) },
            { path: 'search', ...page(() => import('@/features/search/search-page')) },
            { path: 'settings', ...page(() => import('@/features/settings/settings-page')) },
            { path: 'trash', ...page(() => import('@/features/settings/trash-page')) },
            { path: '*', element: <Navigate to="/" replace /> },
          ],
        },
      ],
    },
  ],
  { basename },
);
