import { createContext, useContext } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { matchPath } from 'react-router';
import type { EntityType } from '@mynotes/shared';
import { useMediaQuery } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';

/** What a path shows, for tab titles, the window title and linked panels. */
export interface PathTarget {
  /** Entity shown by the page (a note, a topic…), when there is one. */
  entity: { type: EntityType; id: string } | null;
  /** Fixed title of list pages ("Notas", "Grafo"…). */
  fixed: string | null;
  icon: string;
}

const FIXED: [string, string, string][] = [
  ['/', 'Início', 'home'],
  ['/notes', 'Notas', 'note'],
  ['/library', 'Biblioteca', 'library'],
  ['/readings', 'Leituras', 'reading'],
  ['/plans', 'Planos de leitura', 'plan'],
  ['/study', 'Estudos', 'session'],
  ['/maps', 'Mapas livres', 'mindmap'],
  ['/graph', 'Grafo', 'graph'],
  ['/search', 'Busca', 'search'],
  ['/assistant', 'Assistente', 'assistant'],
  ['/settings', 'Configurações', 'settings'],
  ['/trash', 'Lixeira', 'trash'],
];

const ENTITY_ROUTES: [string, EntityType][] = [
  ['/notes/:id', 'note'],
  ['/topics/:id/map', 'topic'],
  ['/topics/:id', 'topic'],
  ['/library/:id', 'document'],
  ['/readings/:id/panel', 'reading'],
  ['/readings/:id', 'reading'],
  ['/plans/:id', 'plan'],
  ['/maps/:id', 'mindmap'],
  ['/concepts/:id', 'concept'],
];

export function pathTarget(path: string): PathTarget {
  const [pathname = '/', search = ''] = path.split(/[?#]/, 2);
  for (const [pattern, type] of ENTITY_ROUTES) {
    const m = matchPath(pattern, pathname);
    if (!m?.params.id) continue;
    // A book's page annotation opened inside the book: the annotation is what is shown.
    const annotation = type === 'reading' ? new URLSearchParams(search).get('annotation') : null;
    if (annotation) return { entity: { type: 'note', id: annotation }, fixed: null, icon: 'reading' };
    return { entity: { type, id: m.params.id }, fixed: pattern.endsWith('/map') ? 'map' : pattern.endsWith('/panel') ? 'panel' : null, icon: type };
  }
  const fixed = FIXED.find(([p]) => p === pathname);
  return { entity: null, fixed: fixed?.[1] ?? 'MyNotes', icon: fixed?.[2] ?? 'home' };
}

function queryKeyOf(entity: PathTarget['entity']): readonly unknown[] | null {
  if (!entity) return null;
  switch (entity.type) {
    case 'note':
      return qk.note(entity.id);
    case 'document':
      return qk.document(entity.id);
    case 'reading':
      return qk.reading(entity.id);
    case 'plan':
      return qk.plan(entity.id);
    case 'mindmap':
      return qk.mindMap(entity.id);
    case 'concept':
      return ['concept', entity.id];
    default:
      return null;
  }
}

/**
 * Title of what a path shows, read from data already loaded by the pages
 * (never fetches). `fallback` is the last title known for the tab.
 */
export function usePathTitle(path: string, fallback?: string): { title: string; icon: string; target: PathTarget } {
  const target = pathTarget(path);
  const { tree } = useTopics();
  const key = queryKeyOf(target.entity);
  const data = useQuery({ queryKey: key ?? ['none'], queryFn: skipToken, enabled: false }).data as
    | { title?: string; name?: string }
    | undefined;
  let title: string;
  if (!target.entity) title = target.fixed ?? 'MyNotes';
  else if (target.entity.type === 'topic') {
    const t = tree.byId.get(target.entity.id)?.title ?? fallback ?? 'Assunto';
    title = target.fixed === 'map' ? `Mapa · ${t}` : t;
  } else {
    const t = data?.title ?? data?.name;
    title = t === undefined ? (fallback ?? '…') : t || 'Sem título';
    if (target.fixed === 'panel' && t !== undefined) title = `Anotações · ${title}`;
  }
  return { title, icon: target.icon, target };
}

/** The workspace pane a component is rendered in (absent in the phone layout). */
export interface PaneInfo {
  paneId: string;
  tabId: string;
  width: number;
  height: number;
  /** The pane has the focus. */
  active: boolean;
  /** The tab is the one shown in its pane (other tabs stay mounted, hidden). */
  visible: boolean;
}
export const PaneContext = createContext<PaneInfo | null>(null);
export const usePane = () => useContext(PaneContext);

/**
 * Whether the page has at least `min` pixels of width: the pane's width in
 * the workspace (a split pane is narrower than the screen), else the screen
 * minus the sidebar.
 */
export function useWideView(min: number): boolean {
  const pane = usePane();
  const screen = useMediaQuery(`(min-width: ${min + 256}px)`);
  return pane ? pane.width >= min : screen;
}
