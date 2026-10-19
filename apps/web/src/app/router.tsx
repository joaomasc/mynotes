import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { basename, pageRoutes } from './routes';
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

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
    {
      element: <RequireAuth />,
      errorElement: <RouteError />,
      hydrateFallbackElement: <PageLoader />,
      children: [{ element: <AppShell />, errorElement: <RouteError />, children: pageRoutes }],
    },
  ],
  { basename },
);
