import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { ContextMenu } from 'radix-ui';
import { UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation, useNavigate, useNavigationType } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Columns2,
  Copy,
  Ellipsis,
  FileText,
  FolderTree,
  House,
  LayoutTemplate,
  LibraryBig,
  Lightbulb,
  Link as LinkIcon,
  ListTodo,
  Network,
  Pin,
  PinOff,
  Plus,
  Rows2,
  Search,
  Settings,
  StickyNote,
  Trash,
  Waypoints,
  X,
  type LucideProps,
} from 'lucide-react';
import { toast } from 'sonner';
import { IconButton } from '@/components/ui/button';
import { Menu, type MenuEntry } from '@/components/ui/menu';
import { basename, stripBase, withBase } from '@/app/routes';
import { cn } from '@/lib/cn';
import { PaneContext, usePathTitle } from './tab-info';
import { allPanes, openModeOf, openPath, tabRouter, workspace, type DropZone, type LayoutNode, type PaneNode, type SplitNode, type TabState } from './store';

const TAB_MIME = 'application/x-mynotes-tab';

const ICONS: Record<string, ComponentType<LucideProps>> = {
  home: House,
  note: StickyNote,
  library: LibraryBig,
  reading: BookOpen,
  plan: ListTodo,
  session: CalendarDays,
  mindmap: Network,
  graph: Waypoints,
  search: Search,
  settings: Settings,
  trash: Trash,
  topic: FolderTree,
  document: FileText,
  concept: Lightbulb,
};

export function useWorkspace() {
  return useSyncExternalStore(workspace.subscribe, workspace.getState, workspace.getState);
}

/** In-app path of a same-origin URL, or null for anything else. */
function appPathOf(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    if (basename !== '/' && !url.pathname.startsWith(basename)) return null;
    return `${stripBase(url.pathname)}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ syncing -- */

/**
 * Keeps the browser router and the active tab in step: the URL bar shows the
 * active tab, and navigating the browser router (sidebar, search, "+") opens
 * the page in the active tab. Pages opened inside a tab are also pushed to
 * the browser history (numbered in its state), so the browser's back and
 * forward buttons — and the mouse's — move through the active tab's history.
 */
function BrowserSync() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const current = useRef('');
  const full = `${location.pathname}${location.search}${location.hash}`;
  current.current = full;
  const first = useRef(true);
  /** Position of the current browser history entry (state.ws). */
  const index = useRef(0);
  const entryIndex = (state: unknown) => (state && typeof (state as { ws?: unknown }).ws === 'number' ? (state as { ws: number }).ws : null);

  useEffect(() => {
    workspace.fallbackNavigate = (path) => void navigate(path);
  }, [navigate]);

  // Browser router → active tab.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      index.current = entryIndex(location.state) ?? 0;
      // Opening the app at "/" keeps the saved tabs; a link to a page opens (or focuses) it.
      if (full !== '/') {
        const existing = allPanes(workspace.getState().root)
          .flatMap((p) => p.tabs)
          .find((t) => t.path === full);
        const start = workspace.activeTab();
        if (existing) workspace.activate(existing.id);
        // A lone start page is reused; otherwise the link gets a tab of its own.
        else if (start.path === '/' && !start.pinned) workspace.navigateActive(full, { replace: true });
        else workspace.openTab(full);
      }
      void navigate(full, { replace: true, state: { ws: index.current } });
      return;
    }
    if (navigationType === 'POP') {
      // Browser back/forward: the active tab goes back/forward too.
      const target = entryIndex(location.state);
      if (target !== null && target !== index.current) {
        const tab = workspace.activeTab();
        const history = workspace.history(tab.id);
        const back = target < index.current;
        index.current = target;
        if (back ? history.back : history.forward) {
          if (back) workspace.back(tab.id);
          else workspace.forward(tab.id);
          return;
        }
      }
    }
    const active = workspace.activeTab();
    if (full !== active.path && full !== workspace.targetPath(active.id)) workspace.navigateActive(full, { state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per browser navigation
  }, [location.key]);

  // Active tab → browser router.
  useEffect(() => {
    let lastTab = workspace.activeTab().id;
    let lastPath = workspace.activeTab().path;
    return workspace.subscribe(() => {
      const tab = workspace.activeTab();
      if (tab.path === lastPath && tab.id === lastTab) return;
      const switched = tab.id !== lastTab;
      lastTab = tab.id;
      lastPath = tab.path;
      if (tab.path === current.current) {
        // The browser router is already there (it asked for the page): number its entry if it isn't yet.
        if (entryIndex(window.history.state?.usr) === null) {
          index.current += 1;
          void navigate(tab.path, { replace: true, state: { ws: index.current } });
        }
        return;
      }
      if (!switched && workspace.lastAction.get(tab.id) === 'PUSH') {
        index.current += 1;
        void navigate(tab.path, { state: { ws: index.current } });
      } else {
        void navigate(tab.path, { replace: true, state: { ws: index.current } });
      }
    });
  }, [navigate]);
  return null;
}

/** Ctrl/⌘+click and middle click on app links open them in a new tab; with Alt or Shift, beside. */
function useLinkInterception() {
  useEffect(() => {
    const target = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
      return appPathOf(a.getAttribute('href') ?? '');
    };
    const onClick = (e: MouseEvent) => {
      const mode = openModeOf(e);
      const path = target(e);
      if (!path) return;
      // A plain click on a link to a book already open in another tab: that tab goes there.
      if (mode === 'same' && (e.button !== 0 || !workspace.showInOpenBook(path))) return;
      e.preventDefault();
      e.stopPropagation();
      if (mode !== 'same') openPath(path, mode);
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const path = target(e);
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      openPath(path, 'tab');
    };
    // No autoscroll cursor when middle-clicking a link.
    const onDown = (e: MouseEvent) => e.button === 1 && target(e) && e.preventDefault();
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onAux, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onAux, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, []);
}

/* ---------------------------------------------------------- workspace -- */

export function Workspace() {
  const state = useWorkspace();
  useLayoutEffect(() => {
    workspace.enabled = true;
    return () => {
      workspace.enabled = false;
    };
  }, []);
  useLinkInterception();
  return (
    <div className="flex min-h-0 min-w-0 flex-1" aria-label="Área de trabalho">
      <BrowserSync />
      <WindowTitle />
      <LayoutView node={state.root} activePane={state.activePane} />
    </div>
  );
}

function WindowTitle() {
  const tab = workspace.activeTab();
  const { title } = usePathTitle(tab.path, tab.title);
  useEffect(() => {
    document.title = title && title !== 'MyNotes' ? `${title} — MyNotes` : 'MyNotes';
  }, [title]);
  return null;
}

function LayoutView({ node, activePane }: { node: LayoutNode; activePane: string }) {
  if (node.kind === 'pane') return <PaneView pane={node} active={node.id === activePane} />;
  return <SplitView split={node} activePane={activePane} />;
}

function SplitView({ split, activePane }: { split: SplitNode; activePane: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const row = split.dir === 'row';
  const startResize = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const total = row ? box.width : box.height;
    const start = row ? e.clientX : e.clientY;
    const sizes = [...split.sizes];
    const pair = sizes[i]! + sizes[i + 1]!;
    const min = Math.min(pair / 2, 180 / total);
    const move = (ev: PointerEvent) => {
      const delta = ((row ? ev.clientX : ev.clientY) - start) / total;
      const a = Math.max(min, Math.min(pair - min, split.sizes[i]! + delta));
      const next = [...sizes];
      next[i] = a;
      next[i + 1] = pair - a;
      workspace.setSizes(split.id, next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = row ? 'col-resize' : 'row-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} className={cn('flex min-h-0 min-w-0 flex-1', row ? 'flex-row' : 'flex-col')}>
      {split.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={row ? 'vertical' : 'horizontal'}
              aria-label="Redimensionar painéis"
              onPointerDown={(e) => startResize(i - 1, e)}
              onDoubleClick={() => workspace.setSizes(split.id, split.sizes.map(() => 1 / split.sizes.length))}
              className={cn(
                'group relative z-10 shrink-0 bg-border',
                row ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
              )}
            >
              <span className={cn('absolute bg-accent/0 transition-colors group-hover:bg-accent/40', row ? 'inset-y-0 -left-1 w-2' : 'inset-x-0 -top-1 h-2')} />
            </div>
          )}
          <div className="flex min-h-0 min-w-0" style={{ flex: `${split.sizes[i]} 1 0` }}>
            <LayoutView node={child} activePane={activePane} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- pane -- */

function zoneAt(e: React.DragEvent, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const edge = Math.min(x, 1 - x, y, 1 - y);
  if (edge > 0.22) return 'center';
  if (edge === x) return 'left';
  if (edge === 1 - x) return 'right';
  return edge === y ? 'top' : 'bottom';
}

const ZONE_STYLE: Record<DropZone, string> = {
  center: 'inset-2',
  left: 'inset-y-2 left-2 w-[calc(50%-0.5rem)]',
  right: 'inset-y-2 right-2 w-[calc(50%-0.5rem)]',
  top: 'inset-x-2 top-2 h-[calc(50%-0.5rem)]',
  bottom: 'inset-x-2 bottom-2 h-[calc(50%-0.5rem)]',
};

function PaneView({ pane, active }: { pane: PaneNode; active: boolean }) {
  const [zone, setZone] = useState<DropZone | null>(null);
  const tab = pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0]!;
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg"
      aria-label="Painel"
      onPointerDownCapture={() => workspace.activatePane(pane.id)}
      onFocusCapture={() => workspace.activatePane(pane.id)}
    >
      <TabBar pane={pane} active={active} />
      <div
        className="relative min-h-0 flex-1"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return;
          e.preventDefault();
          setZone(zoneAt(e, e.currentTarget));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null);
        }}
        onDrop={(e) => {
          const tabId = e.dataTransfer.getData(TAB_MIME);
          setZone(null);
          if (!tabId) return;
          e.preventDefault();
          workspace.moveTab(tabId, pane.id, zoneAt(e, e.currentTarget));
        }}
      >
        <PaneContent key={tab.id} tab={tab} paneId={pane.id} active={active} />
        {zone && <div className={cn('pointer-events-none absolute z-30 rounded-lg border-2 border-accent bg-accent/10', ZONE_STYLE[zone])} aria-hidden />}
      </div>
    </section>
  );
}

const ROUTE_CONTEXT_RESET = { outlet: null, matches: [], isDataRoute: false } as unknown as React.ContextType<typeof UNSAFE_RouteContext>;

/**
 * One tab's page, with its own router. The browser router's contexts are
 * cleared here so the tab's router is a root of its own.
 */
function PaneContent({ tab, paneId, active }: { tab: TabState; paneId: string; active: boolean }) {
  const router = useMemo(() => tabRouter(tab), [tab]);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const info = useMemo(() => ({ paneId, tabId: tab.id, width: size.width, height: size.height, active }), [paneId, tab.id, size, active]);
  return (
    <div
      ref={ref}
      data-pane-scroll
      data-tab-id={tab.id}
      className="scrollbar-thin absolute inset-0 overflow-x-hidden overflow-y-auto"
      style={{ '--view-h': `${size.height || 600}px` } as React.CSSProperties}
    >
      <PaneContext.Provider value={info}>
        <UNSAFE_LocationContext.Provider value={null as unknown as React.ContextType<typeof UNSAFE_LocationContext>}>
          <UNSAFE_RouteContext.Provider value={ROUTE_CONTEXT_RESET}>{size.width > 0 && <RouterProvider router={router} />}</UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </PaneContext.Provider>
    </div>
  );
}

/* ------------------------------------------------------------ tab bar -- */

function TabBar({ pane, active }: { pane: PaneNode; active: boolean }) {
  const current = pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0]!;
  const history = workspace.history(current.id);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const indexAt = (clientX: number) => {
    const items = [...(listRef.current?.querySelectorAll('[data-tab]') ?? [])];
    const i = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientX < r.left + r.width / 2;
    });
    return i < 0 ? items.length : i;
  };

  const layoutItems: MenuEntry[] = [
    { label: 'Dividir à direita', icon: <Columns2 />, onSelect: () => workspace.openSplit(current.path, 'row', { paneId: pane.id }), shortcut: 'Alt+\\' },
    { label: 'Dividir abaixo', icon: <Rows2 />, onSelect: () => workspace.openSplit(current.path, 'col', { paneId: pane.id }), shortcut: 'Alt+-' },
    'separator',
    {
      label: 'Salvar disposição como…',
      icon: <LayoutTemplate />,
      onSelect: () => {
        const name = window.prompt('Nome da disposição (ex.: Estudo de História)')?.trim();
        if (!name) return;
        workspace.saveAs(name.slice(0, 60));
        toast.success(`Disposição “${name}” salva`, { description: 'Abra-a de novo pela paleta de comandos (Ctrl+P).' });
      },
    },
    ...workspace.savedNames().map((name) => ({ label: `Abrir “${name}”`, icon: <LayoutTemplate />, onSelect: () => workspace.loadSaved(name) })),
  ];

  return (
    <div
      className={cn('flex h-9 shrink-0 items-stretch border-b border-border bg-surface-2/50', active && 'bg-surface-2')}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (!types.includes(TAB_MIME) && !types.includes('text/uri-list')) return;
        e.preventDefault();
        setDropIndex(indexAt(e.clientX));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={(e) => {
        const index = indexAt(e.clientX);
        setDropIndex(null);
        const tabId = e.dataTransfer.getData(TAB_MIME);
        e.preventDefault();
        if (tabId) {
          const from = pane.tabs.findIndex((t) => t.id === tabId);
          workspace.moveTab(tabId, pane.id, 'center', from >= 0 && from < index ? index - 1 : index);
          return;
        }
        // A link dragged from a page: opens it here, in a new tab.
        const path = appPathOf(e.dataTransfer.getData('text/uri-list').split('\n')[0] ?? '');
        if (path) workspace.openTab(path, { paneId: pane.id });
      }}
    >
      <div className="flex shrink-0 items-center px-1">
        <IconButton label="Voltar (Alt+←)" size="sm" className="size-7" disabled={!history.back} onClick={() => workspace.back(current.id)}>
          <ArrowLeft className="size-3.5" />
        </IconButton>
        <IconButton label="Avançar (Alt+→)" size="sm" className="size-7" disabled={!history.forward} onClick={() => workspace.forward(current.id)}>
          <ArrowRight className="size-3.5" />
        </IconButton>
      </div>
      <div ref={listRef} role="tablist" aria-label="Abas" className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {pane.tabs.map((t, i) => (
          <TabItem key={t.id} tab={t} selected={t.id === pane.active} paneActive={active} dropBefore={dropIndex === i} paneId={pane.id} />
        ))}
        {dropIndex === pane.tabs.length && <span className="my-1.5 w-0.5 shrink-0 rounded bg-accent" aria-hidden />}
        <button
          type="button"
          title="Nova aba (Alt+T)"
          aria-label="Nova aba"
          onClick={() => workspace.openTab('/', { paneId: pane.id })}
          className="flex w-8 shrink-0 items-center justify-center text-muted hover:text-text"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1">
        <IconButton label="Dividir à direita" size="sm" className="size-7" onClick={() => workspace.openSplit(current.path, 'row', { paneId: pane.id })}>
          <Columns2 className="size-3.5" />
        </IconButton>
        <Menu
          label="Disposição"
          trigger={
            <IconButton label="Disposição dos painéis" size="sm" className="size-7">
              <Ellipsis className="size-3.5" />
            </IconButton>
          }
          items={layoutItems}
        />
      </div>
    </div>
  );
}

function TabItem({ tab, selected, paneActive, dropBefore, paneId }: { tab: TabState; selected: boolean; paneActive: boolean; dropBefore: boolean; paneId: string }) {
  const { title, icon } = usePathTitle(tab.path, tab.title);
  const Icon = ICONS[icon] ?? FileText;
  useEffect(() => {
    if (title !== '…') workspace.setTitle(tab.id, title);
  }, [title, tab.id]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  const item = (label: string, onSelect: () => void, ItemIcon: ComponentType<LucideProps>, shortcut?: string) => (
    <ContextMenu.Item
      onSelect={onSelect}
      className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2"
    >
      <ItemIcon className="size-4 text-muted" aria-hidden />
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-xs text-subtle">{shortcut}</span>}
    </ContextMenu.Item>
  );

  return (
    <>
      {dropBefore && <span className="my-1.5 w-0.5 shrink-0 rounded bg-accent" aria-hidden />}
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger asChild>
          <div
            ref={ref}
            data-tab
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            draggable
            title={title}
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_MIME, tab.id);
              e.dataTransfer.setData('text/uri-list', new URL(withBase(tab.path), window.location.origin).href);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => workspace.activate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && !tab.pinned) {
                e.preventDefault();
                workspace.closeTab(tab.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Delete' && !tab.pinned) workspace.closeTab(tab.id);
            }}
            className={cn(
              'group relative flex min-w-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-2.5 text-[13px] select-none',
              // Tabs shrink to fit (like a browser's) and the list scrolls only when they get too narrow.
              tab.pinned ? 'max-w-40 shrink-0' : 'max-w-48 min-w-20 flex-[0_1_11rem]',
              selected ? 'bg-bg text-text' : 'text-muted hover:bg-surface-3/60 hover:text-text',
            )}
          >
            {selected && <span className={cn('absolute inset-x-0 top-0 h-0.5', paneActive ? 'bg-accent' : 'bg-border-strong')} aria-hidden />}
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {tab.pinned ? (
              <button type="button" aria-label="Desafixar aba" title="Desafixar" onClick={(e) => (e.stopPropagation(), workspace.togglePin(tab.id))} className="rounded p-0.5 text-subtle hover:text-text">
                <Pin className="size-3" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Fechar ${title}`}
                title="Fechar (Alt+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  workspace.closeTab(tab.id);
                }}
                className={cn('rounded p-0.5 text-subtle hover:bg-surface-3 hover:text-text', !selected && 'opacity-0 group-hover:opacity-100')}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-[220px] rounded-xl border border-border bg-surface p-1 shadow-pop">
            {item('Fechar', () => workspace.closeTab(tab.id), X, 'Alt+W')}
            {item('Fechar as outras', () => workspace.closeOthers(tab.id), X)}
            {item(tab.pinned ? 'Desafixar' : 'Fixar aba', () => workspace.togglePin(tab.id), tab.pinned ? PinOff : Pin)}
            {item('Duplicar', () => workspace.duplicate(tab.id), Copy)}
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            {item('Dividir à direita', () => workspace.openSplit(tab.path, 'row', { paneId }), Columns2)}
            {item('Dividir abaixo', () => workspace.openSplit(tab.path, 'col', { paneId }), Rows2)}
            {item(
              'Copiar link',
              () => {
                void navigator.clipboard?.writeText(new URL(withBase(tab.path), window.location.origin).href);
                toast.success('Link copiado');
              },
              LinkIcon,
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
  );
}
