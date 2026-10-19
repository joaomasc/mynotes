import { createMemoryRouter, type DataRouter } from 'react-router';
import { uuidv7 } from '@mynotes/shared';
import { basename, stripBase, withBase } from '@/app/routes';
import { paneRoutes } from './pane-routes';

/**
 * Workspace of the wide-screen layout (Obsidian-like): panes split side by
 * side or stacked, each with its own tabs. Every tab runs its own memory
 * router, so it keeps its own page and back/forward history. Only the layout
 * (paths, sizes, pins) is saved, per device, in localStorage.
 */

export interface TabState {
  id: string;
  /** Path inside the app, without the base ("/notes/1?x"). */
  path: string;
  pinned?: boolean;
  /** Last known title (shown before the page data is loaded). */
  title?: string;
}
export interface PaneNode {
  kind: 'pane';
  id: string;
  tabs: TabState[];
  active: string;
}
export interface SplitNode {
  kind: 'split';
  id: string;
  /** row: side by side; col: stacked. */
  dir: 'row' | 'col';
  children: LayoutNode[];
  /** Fractions of the space, one per child (sum 1). */
  sizes: number[];
}
export type LayoutNode = PaneNode | SplitNode;
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

interface State {
  root: LayoutNode;
  activePane: string;
  /** Recently closed tabs (reopen with Alt+Shift+T). */
  closed: TabState[];
}

const STORAGE_KEY = 'mynotes:workspace';
const SAVED_KEY = 'mynotes:workspaces';

const newTab = (path: string): TabState => ({ id: uuidv7(), path });
const newPane = (tabs: TabState[]): PaneNode => ({ kind: 'pane', id: uuidv7(), tabs, active: tabs[0]!.id });

function initialState(): State {
  const pane = newPane([newTab('/')]);
  return { root: pane, activePane: pane.id, closed: [] };
}

function isValid(node: unknown): node is LayoutNode {
  const n = node as LayoutNode | null;
  if (!n || typeof n !== 'object' || typeof n.id !== 'string') return false;
  if (n.kind === 'pane') return Array.isArray(n.tabs) && n.tabs.length > 0 && n.tabs.every((t) => typeof t.id === 'string' && typeof t.path === 'string');
  if (n.kind === 'split') return Array.isArray(n.children) && n.children.length > 1 && n.children.every(isValid) && n.sizes?.length === n.children.length;
  return false;
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<State>;
    if (!isValid(parsed.root)) return initialState();
    const root = parsed.root;
    const panes = allPanes(root);
    for (const p of panes) if (!p.tabs.some((t) => t.id === p.active)) p.active = p.tabs[0]!.id;
    const activePane = panes.some((p) => p.id === parsed.activePane) ? parsed.activePane! : panes[0]!.id;
    return { root, activePane, closed: Array.isArray(parsed.closed) ? parsed.closed.slice(0, 20) : [] };
  } catch {
    return initialState();
  }
}

export function allPanes(node: LayoutNode): PaneNode[] {
  return node.kind === 'pane' ? [node] : node.children.flatMap(allPanes);
}

function findPane(node: LayoutNode, id: string): PaneNode | undefined {
  return allPanes(node).find((p) => p.id === id);
}

function paneOfTab(node: LayoutNode, tabId: string): PaneNode | undefined {
  return allPanes(node).find((p) => p.tabs.some((t) => t.id === tabId));
}

/** Replaces a node of the tree (immutably), collapsing splits left with one child. */
function replaceNode(node: LayoutNode, id: string, next: LayoutNode | null): LayoutNode | null {
  if (node.id === id) return next;
  if (node.kind === 'pane') return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = replaceNode(c, id, next);
    if (r) {
      children.push(r);
      sizes.push(node.sizes[i]!);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}

/** Merges nested splits of the same direction ([a | [b | c]] → [a | b | c]). */
function normalize(node: LayoutNode): LayoutNode {
  if (node.kind === 'pane') return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const n = normalize(c);
    if (n.kind === 'split' && n.dir === node.dir) {
      n.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(node.sizes[i]! * n.sizes[j]!);
      });
    } else {
      children.push(n);
      sizes.push(node.sizes[i]!);
    }
  });
  return { ...node, children, sizes };
}

/* ------------------------------------------------------------- routers -- */

interface TabRuntime {
  router: DataRouter;
  index: number;
  length: number;
  /** Direction of a back/forward started here (POP carries no direction). */
  pendingPop: -1 | 1 | 0;
  unsubscribe: () => void;
}
const runtimes = new Map<string, TabRuntime>();

const fullPath = (loc: { pathname: string; search: string; hash: string }) => `${stripBase(loc.pathname)}${loc.search}${loc.hash}`;

export function tabRouter(tab: TabState): DataRouter {
  const existing = runtimes.get(tab.id);
  if (existing) return existing.router;
  const router = createMemoryRouter(paneRoutes, { initialEntries: [withBase(tab.path)], basename });
  const rt: TabRuntime = { router, index: 0, length: 1, pendingPop: 0, unsubscribe: () => undefined };
  let lastKey = router.state.location.key;
  rt.unsubscribe = router.subscribe((state) => {
    if (state.location.key === lastKey) return;
    lastKey = state.location.key;
    if (state.historyAction === 'PUSH') {
      rt.index += 1;
      rt.length = rt.index + 1;
    } else if (state.historyAction === 'POP') {
      rt.index = Math.max(0, Math.min(rt.length - 1, rt.index + (rt.pendingPop || -1)));
      rt.pendingPop = 0;
    }
    workspace.tabNavigated(tab.id, fullPath(state.location), state.historyAction);
  });
  runtimes.set(tab.id, rt);
  return router;
}

function disposeRouter(tabId: string) {
  const rt = runtimes.get(tabId);
  if (!rt) return;
  rt.unsubscribe();
  rt.router.dispose();
  runtimes.delete(tabId);
}

/* --------------------------------------------------------------- store -- */

type Listener = () => void;

class Workspace {
  private state: State = load();
  private listeners = new Set<Listener>();
  /** Whether the wide layout (and so this store) is in use. */
  enabled = false;
  /** Fallback when the workspace is off (phone layout): the browser router's navigate. */
  fallbackNavigate: ((path: string) => void) | null = null;

  getState = (): State => this.state;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private set(next: State) {
    const root = normalize(next.root);
    this.state = { ...next, root };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore: the layout simply isn't remembered
    }
    for (const l of this.listeners) l();
  }

  /** Replaces one pane (immutably) and saves. */
  private updatePane(paneId: string, fn: (p: PaneNode) => PaneNode | null, extra: Partial<State> = {}) {
    const pane = findPane(this.state.root, paneId);
    if (!pane) return;
    const next = fn(pane);
    const root = replaceNode(this.state.root, paneId, next) ?? newPane([newTab('/')]);
    const panes = allPanes(root);
    const activePane = extra.activePane && panes.some((p) => p.id === extra.activePane) ? extra.activePane : panes.some((p) => p.id === this.state.activePane) ? this.state.activePane : panes[0]!.id;
    this.set({ ...this.state, ...extra, root, activePane });
  }

  activePane(): PaneNode {
    return findPane(this.state.root, this.state.activePane) ?? allPanes(this.state.root)[0]!;
  }
  activeTab(): TabState {
    const pane = this.activePane();
    return pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0]!;
  }
  findTab(tabId: string): TabState | undefined {
    return paneOfTab(this.state.root, tabId)?.tabs.find((t) => t.id === tabId);
  }

  /** Where a tab is, or is going when a page is still loading. */
  targetPath(tabId: string): string | undefined {
    const rt = runtimes.get(tabId);
    const next = rt?.router.state.navigation.location;
    return next ? fullPath(next) : this.findTab(tabId)?.path;
  }

  history(tabId: string): { back: boolean; forward: boolean } {
    const rt = runtimes.get(tabId);
    return { back: !!rt && rt.index > 0, forward: !!rt && rt.index < rt.length - 1 };
  }

  /** How the last page change of each tab happened (the browser history mirrors pushes). */
  lastAction = new Map<string, 'PUSH' | 'REPLACE' | 'POP'>();

  /** Called by a tab's router after it moved to another page. */
  tabNavigated(tabId: string, path: string, action: 'PUSH' | 'REPLACE' | 'POP' = 'REPLACE') {
    this.lastAction.set(tabId, action);
    const pane = paneOfTab(this.state.root, tabId);
    if (!pane) return;
    this.updatePane(pane.id, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, path } : t)) }));
  }

  setTitle(tabId: string, title: string) {
    const tab = this.findTab(tabId);
    if (!tab || tab.title === title) return;
    const pane = paneOfTab(this.state.root, tabId)!;
    this.updatePane(pane.id, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) }));
  }

  /** Opens a path in the active tab (a pinned tab keeps its page: a new tab opens instead). */
  navigateActive(path: string, opts: { replace?: boolean; state?: unknown } = {}) {
    if (!this.enabled) return this.fallbackNavigate?.(path);
    const tab = this.activeTab();
    if (tab.pinned && !opts.replace && path !== tab.path) return this.openTab(path);
    void tabRouter(tab).navigate(path, { replace: opts.replace, state: opts.state });
  }

  /** Opens a path in a new tab of a pane (the active one by default). */
  openTab(path: string, opts: { paneId?: string; background?: boolean; afterTabId?: string } = {}) {
    if (!this.enabled) return this.fallbackNavigate?.(path);
    const paneId = opts.paneId ?? this.state.activePane;
    const tab = newTab(path);
    this.updatePane(
      paneId,
      (p) => {
        const after = opts.afterTabId ?? p.active;
        const at = p.tabs.findIndex((t) => t.id === after);
        const tabs = [...p.tabs];
        tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
        return { ...p, tabs, active: opts.background ? p.active : tab.id };
      },
      { activePane: paneId },
    );
    return tab;
  }

  /** Opens a path in a new pane beside (row) or below (col) a pane. */
  openSplit(path: string, dir: 'row' | 'col', opts: { paneId?: string; before?: boolean; tab?: TabState } = {}) {
    if (!this.enabled) return this.fallbackNavigate?.(path);
    const target = findPane(this.state.root, opts.paneId ?? this.state.activePane) ?? this.activePane();
    const pane = newPane([opts.tab ?? newTab(path)]);
    const split: SplitNode = {
      kind: 'split',
      id: uuidv7(),
      dir,
      children: opts.before ? [pane, target] : [target, pane],
      sizes: [0.5, 0.5],
    };
    const root = replaceNode(this.state.root, target.id, split)!;
    this.set({ ...this.state, root, activePane: pane.id });
  }

  activate(tabId: string) {
    const pane = paneOfTab(this.state.root, tabId);
    if (!pane) return;
    if (pane.active === tabId && this.state.activePane === pane.id) return;
    this.updatePane(pane.id, (p) => ({ ...p, active: tabId }), { activePane: pane.id });
  }

  activatePane(paneId: string) {
    if (this.state.activePane === paneId || !findPane(this.state.root, paneId)) return;
    this.set({ ...this.state, activePane: paneId });
  }

  closeTab(tabId: string) {
    const pane = paneOfTab(this.state.root, tabId);
    const tab = pane?.tabs.find((t) => t.id === tabId);
    if (!pane || !tab) return;
    const closed = [{ ...tab, id: uuidv7() }, ...this.state.closed].slice(0, 20);
    disposeRouter(tabId);
    const onlyPane = allPanes(this.state.root).length === 1;
    this.updatePane(
      pane.id,
      (p) => {
        const i = p.tabs.findIndex((t) => t.id === tabId);
        const tabs = p.tabs.filter((t) => t.id !== tabId);
        // The last tab of the last pane is replaced by a new tab (the workspace is never empty).
        if (tabs.length === 0) return onlyPane ? newPane([newTab('/')]) : null;
        const active = p.active === tabId ? tabs[Math.min(i, tabs.length - 1)]!.id : p.active;
        return { ...p, tabs, active };
      },
      { closed },
    );
  }

  closeOthers(tabId: string) {
    const pane = paneOfTab(this.state.root, tabId);
    if (!pane) return;
    const others = pane.tabs.filter((t) => t.id !== tabId && !t.pinned);
    others.forEach((t) => disposeRouter(t.id));
    this.updatePane(pane.id, (p) => ({ ...p, tabs: p.tabs.filter((t) => t.id === tabId || t.pinned), active: tabId }));
  }

  reopenClosed() {
    const [last, ...rest] = this.state.closed;
    if (!last) return;
    this.state = { ...this.state, closed: rest };
    this.openTab(last.path);
  }

  togglePin(tabId: string) {
    const pane = paneOfTab(this.state.root, tabId);
    if (!pane) return;
    this.updatePane(pane.id, (p) => {
      const tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t));
      // Pinned tabs come first.
      return { ...p, tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
    });
  }

  duplicate(tabId: string) {
    const pane = paneOfTab(this.state.root, tabId);
    const tab = pane?.tabs.find((t) => t.id === tabId);
    if (pane && tab) this.openTab(tab.path, { paneId: pane.id, afterTabId: tabId });
  }

  /** Moves a tab to another pane (or another position), or into a new split next to a pane. */
  moveTab(tabId: string, toPaneId: string, zone: DropZone, index?: number) {
    const from = paneOfTab(this.state.root, tabId);
    const tab = from?.tabs.find((t) => t.id === tabId);
    const to = findPane(this.state.root, toPaneId);
    if (!from || !tab || !to) return;
    if (zone !== 'center') {
      if (from.id === to.id && from.tabs.length === 1) return; // splitting a pane with its only tab: nothing to do
      // Take the tab out, then split the target (which may be gone if it was the source's only tab).
      const rootWithout =
        replaceNode(this.state.root, from.id, from.tabs.length === 1 ? null : { ...from, tabs: from.tabs.filter((t) => t.id !== tabId), active: from.active === tabId ? from.tabs.find((t) => t.id !== tabId)!.id : from.active }) ??
        newPane([newTab('/')]);
      const target = findPane(rootWithout, toPaneId);
      if (!target) return;
      const pane = newPane([tab]);
      const before = zone === 'left' || zone === 'top';
      const split: SplitNode = {
        kind: 'split',
        id: uuidv7(),
        dir: zone === 'left' || zone === 'right' ? 'row' : 'col',
        children: before ? [pane, target] : [target, pane],
        sizes: [0.5, 0.5],
      };
      this.set({ ...this.state, root: replaceNode(rootWithout, target.id, split)!, activePane: pane.id });
      return;
    }
    if (from.id === to.id) {
      this.updatePane(from.id, (p) => {
        const tabs = p.tabs.filter((t) => t.id !== tabId);
        const at = index === undefined ? tabs.length : Math.max(0, Math.min(index, tabs.length));
        tabs.splice(at, 0, tab);
        return { ...p, tabs, active: tabId };
      });
      return;
    }
    let root = replaceNode(
      this.state.root,
      from.id,
      from.tabs.length === 1 ? null : { ...from, tabs: from.tabs.filter((t) => t.id !== tabId), active: from.active === tabId ? from.tabs.find((t) => t.id !== tabId)!.id : from.active },
    )!;
    const target = findPane(root, toPaneId)!;
    const tabs = [...target.tabs];
    tabs.splice(index === undefined ? tabs.length : Math.max(0, Math.min(index, tabs.length)), 0, tab);
    root = replaceNode(root, target.id, { ...target, tabs, active: tabId })!;
    this.set({ ...this.state, root, activePane: target.id });
  }

  setSizes(splitId: string, sizes: number[]) {
    const walk = (n: LayoutNode): LayoutNode => (n.kind === 'pane' ? n : n.id === splitId ? { ...n, sizes } : { ...n, children: n.children.map(walk) });
    this.set({ ...this.state, root: walk(this.state.root) });
  }

  /** Next/previous tab of the active pane. */
  cycleTab(delta: number) {
    const pane = this.activePane();
    const i = pane.tabs.findIndex((t) => t.id === pane.active);
    const next = pane.tabs[(i + delta + pane.tabs.length) % pane.tabs.length];
    if (next) this.activate(next.id);
  }

  goToTab(n: number) {
    const pane = this.activePane();
    const tab = n >= 9 ? pane.tabs[pane.tabs.length - 1] : pane.tabs[n - 1];
    if (tab) this.activate(tab.id);
  }

  /** Moves focus to the next pane (in reading order). */
  cyclePane(delta: number) {
    const panes = allPanes(this.state.root);
    const i = panes.findIndex((p) => p.id === this.state.activePane);
    const next = panes[(i + delta + panes.length) % panes.length];
    if (next) this.activatePane(next.id);
  }

  back(tabId = this.activeTab().id) {
    const rt = runtimes.get(tabId);
    if (!rt || rt.index === 0) return;
    rt.pendingPop = -1;
    void rt.router.navigate(-1);
  }
  forward(tabId = this.activeTab().id) {
    const rt = runtimes.get(tabId);
    if (!rt || rt.index >= rt.length - 1) return;
    rt.pendingPop = 1;
    void rt.router.navigate(1);
  }

  /* Named layouts ("Estudo de História": the book on the left, notes on the right). */
  savedNames(): string[] {
    return Object.keys(readSaved()).sort((a, b) => a.localeCompare(b));
  }
  saveAs(name: string) {
    const saved = readSaved();
    saved[name] = { root: this.state.root, activePane: this.state.activePane };
    writeSaved(saved);
    for (const l of this.listeners) l();
  }
  loadSaved(name: string) {
    const entry = readSaved()[name];
    if (!entry || !isValid(entry.root)) return;
    for (const p of allPanes(this.state.root)) for (const t of p.tabs) disposeRouter(t.id);
    // New ids: the saved layout may be opened several times.
    const fresh = (n: LayoutNode): LayoutNode =>
      n.kind === 'pane'
        ? (() => {
            const tabs = n.tabs.map((t) => ({ ...t, id: uuidv7() }));
            const activeIndex = Math.max(0, n.tabs.findIndex((t) => t.id === n.active));
            return { ...n, id: n.id === entry.activePane ? n.id : uuidv7(), tabs, active: tabs[activeIndex]!.id };
          })()
        : { ...n, id: uuidv7(), children: n.children.map(fresh) };
    const root = fresh(entry.root);
    const panes = allPanes(root);
    this.set({ ...this.state, root, activePane: panes.find((p) => p.id === entry.activePane)?.id ?? panes[0]!.id });
  }
  deleteSaved(name: string) {
    const saved = readSaved();
    delete saved[name];
    writeSaved(saved);
    for (const l of this.listeners) l();
  }
}

function readSaved(): Record<string, { root: LayoutNode; activePane: string }> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, { root: LayoutNode; activePane: string }>;
  } catch {
    return {};
  }
}
function writeSaved(v: Record<string, unknown>) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

export const workspace = new Workspace();

/** The active tab's page in the DOM (where palette and keyboard commands act); null without the workspace. */
export function activeTabElement(): Element | null {
  return workspace.enabled ? document.querySelector(`[data-tab-id="${workspace.activeTab().id}"]`) : null;
}

/** Where to open a link: same tab, a new tab, or a new pane beside the current one. */
export type OpenMode = 'same' | 'tab' | 'split';

/** Opening mode from a click: Ctrl/⌘ = new tab, Ctrl/⌘+Alt or Shift+Ctrl = beside, middle button = new tab. */
export function openModeOf(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; button?: number }): OpenMode {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.altKey || e.shiftKey)) return 'split';
  if (mod || e.button === 1) return 'tab';
  return 'same';
}

/** Opens an app path; without the workspace (phone layout) everything opens in place. */
export function openPath(path: string, mode: OpenMode = 'same'): void {
  if (!workspace.enabled || mode === 'same') {
    if (workspace.enabled) workspace.navigateActive(path);
    else workspace.fallbackNavigate?.(path);
    return;
  }
  if (mode === 'tab') workspace.openTab(path);
  else workspace.openSplit(path, 'row');
}
