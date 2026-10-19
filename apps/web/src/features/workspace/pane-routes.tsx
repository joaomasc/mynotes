import { useEffect, useRef } from 'react';
import { Outlet, useLocation, type RouteObject } from 'react-router';
import { PageLoader } from '@/components/ui/feedback';
import { RouteError } from '@/app/route-error';
import { pageRoutes } from '@/app/routes';

/** Each new page of a tab starts at the top of its pane (like a new page load). */
function PaneRoot() {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.closest('[data-pane-scroll]')?.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div ref={ref} className="min-h-full">
      <Outlet />
    </div>
  );
}

/** Routes of a workspace tab: the same pages as the browser router. */
export const paneRoutes: RouteObject[] = [
  { element: <PaneRoot />, errorElement: <RouteError />, hydrateFallbackElement: <PageLoader />, children: pageRoutes },
];
