import { Navigate, type RouteObject } from 'react-router';

const page = (loader: () => Promise<{ Component: React.ComponentType }>) => ({ lazy: loader });

/**
 * The app's pages. Used by the browser router (phone layout, and the URL bar)
 * and by every workspace tab on wide screens, which runs its own router.
 */
export const pageRoutes: RouteObject[] = [
  { index: true, ...page(() => import('@/features/dashboard/dashboard-page')) },
  { path: 'topics/:id', ...page(() => import('@/features/topics/topic-page')) },
  { path: 'topics/:id/map', ...page(() => import('@/features/topics/topic-map-page')) },
  { path: 'notes', ...page(() => import('@/features/notes/notes-page')) },
  { path: 'notes/:id', ...page(() => import('@/features/notes/note-page')) },
  { path: 'library', ...page(() => import('@/features/documents/library-page')) },
  { path: 'library/:id', ...page(() => import('@/features/documents/document-page')) },
  { path: 'readings', ...page(() => import('@/features/readings/readings-page')) },
  { path: 'readings/:id', ...page(() => import('@/features/readings/reading-page')) },
  { path: 'readings/:id/panel', ...page(() => import('@/features/readings/reading-panel-page')) },
  { path: 'plans', ...page(() => import('@/features/plans/plans-page')) },
  { path: 'plans/:id', ...page(() => import('@/features/plans/plan-page')) },
  { path: 'study', ...page(() => import('@/features/study/study-page')) },
  { path: 'maps', ...page(() => import('@/features/mindmaps/maps-page')) },
  { path: 'maps/:id', ...page(() => import('@/features/mindmaps/map-page')) },
  { path: 'graph', ...page(() => import('@/features/graph/graph-page')) },
  { path: 'concepts/:id', ...page(() => import('@/features/concepts/concept-page')) },
  { path: 'search', ...page(() => import('@/features/search/search-page')) },
  { path: 'assistant', ...page(() => import('@/features/assistant/assistant-page')) },
  { path: 'speaking', ...page(() => import('@/features/speaking/speaking-page')) },
  { path: 'speaking/attempts/:id', ...page(() => import('@/features/speaking/attempt-page')) },
  { path: 'speaking/free', ...page(() => import('@/features/speaking/free-page')) },
  { path: 'speaking/lesson/:id', ...page(() => import('@/features/speaking/lesson-page')) },
  { path: 'speaking/progress', ...page(() => import('@/features/speaking/progress-page')) },
  { path: 'settings', ...page(() => import('@/features/settings/settings-page')) },
  { path: 'trash', ...page(() => import('@/features/settings/trash-page')) },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

/** "/mynotes/notes/1?x" → "/notes/1?x" (paths inside the app never carry the base). */
export function stripBase(path: string): string {
  if (basename === '/' || !path.startsWith(basename)) return path || '/';
  return path.slice(basename.length) || '/';
}

export function withBase(path: string): string {
  return basename === '/' ? path : `${basename}${path === '/' ? '' : path}`;
}
