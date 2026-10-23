import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  BookOpen,
  Brain,
  CalendarDays,
  ChevronRight,
  Ellipsis,
  FolderPlus,
  FolderTree,
  House,
  LayoutDashboard,
  LibraryBig,
  ListTodo,
  LogOut,
  Menu as MenuIcon,
  Mic,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Trash,
  Upload,
  Waypoints,
  X,
} from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/feedback';
import { Menu, type MenuEntry } from '@/components/ui/menu';
import { logout, useAuth } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import { entityPath, EntityIcon } from '@/lib/entities';
import { effectiveHotkey, formatHotkey, useHotkeyOverrides } from '@/lib/hotkeys';
import { isTypingTarget, useMediaQuery } from '@/lib/hooks';
import { getPref, setPref, usePref } from '@/lib/prefs';
import { notesSync } from '@/lib/sync/notes-sync';
import { useConfirm } from '@/components/ui/dialog';
import { CommandsProvider, useCommands, type UiActions } from '@/features/commands/commands';
import { TemplatePicker } from '@/features/notes/template-picker';
import { HoverPreviewLayer } from '@/features/preview/hover-preview';
import { useFavorites } from '@/features/shared/favorite-button';
import { TopicTree } from '@/features/topics/topic-tree';
import { TopicFormDialog } from '@/features/topics/topic-dialogs';
import { useCurrentTopic } from '@/features/topics/use-current-topic';
import { useCreateNote } from '@/features/notes/use-create-note';
import { useReviewSummary } from '@/features/review/use-review';
import { Workspace } from '@/features/workspace/workspace';
import { CommandPaletteDialog, CommandPaletteProvider, useCommandPalette } from './command-palette';
import { SyncIndicator } from './sync-indicator';

/**
 * Main destinations. Topics live in the tree below; books and readings are
 * part of the library. Study sessions are reached from each topic (and from
 * Settings) instead of being a module of their own.
 */
const NAV = [
  { to: '/', label: 'Início', icon: House, end: true, also: [] as string[] },
  { to: '/notes', label: 'Notas', icon: StickyNote, also: [] },
  { to: '/daily', label: 'Notas diárias', icon: CalendarDays, also: [] },
  { to: '/library', label: 'Biblioteca', icon: LibraryBig, also: ['/readings'] },
  { to: '/graph', label: 'Grafo', icon: Waypoints, also: [] },
  { to: '/canvas', label: 'Canvas', icon: LayoutDashboard, also: [] },
  { to: '/review', label: 'Revisar', icon: Brain, also: [] },
  { to: '/assistant', label: 'Assistente', icon: Sparkles, also: [] },
  { to: '/speaking', label: 'Oratória', icon: Mic, also: [] },
];

const MORE: { to: string; label: string; icon: typeof House }[] = [
  { to: '/plans', label: 'Planos de leitura', icon: ListTodo },
  { to: '/maps', label: 'Mapas livres', icon: Network },
  { to: '/trash', label: 'Lixeira', icon: Trash },
];

const RightPanel = lazy(() => import('@/features/workspace/right-panel').then((m) => ({ default: m.RightPanel })));

/** Wide screens get the workspace (tabs, split panes, right panel). */
const WIDE = '(min-width: 1024px)';

/**
 * Items of the "+" menu. Inside a topic (or a note/book that belongs to one)
 * new items are created there; at the root nothing is attached by default.
 */
function useQuickCreate(): { items: MenuEntry[]; dialog: ReactNode } {
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const topic = useCurrentTopic();
  const [topicDialog, setTopicDialog] = useState<{ parentId: string | null } | null>(null);
  const withTopic = topic ? `&topicId=${topic.id}` : '';
  const items: MenuEntry[] = topic
    ? [
        { label: `Nota em “${topic.title}”`, icon: <StickyNote />, onSelect: () => createNote.mutate(topic.id), shortcut: 'Alt+N' },
        { label: `Subassunto em “${topic.title}”`, icon: <FolderPlus />, onSelect: () => setTopicDialog({ parentId: topic.id }) },
        'separator',
        { label: 'Nota sem assunto', icon: <StickyNote />, onSelect: () => createNote.mutate(null) },
        { label: 'Novo assunto (caderno)', icon: <FolderTree />, onSelect: () => setTopicDialog({ parentId: null }) },
      ]
    : [
        { label: 'Nova nota', icon: <StickyNote />, onSelect: () => createNote.mutate(null), shortcut: 'Alt+N' },
        { label: 'Novo assunto (caderno)', icon: <FolderTree />, onSelect: () => setTopicDialog({ parentId: null }) },
      ];
  items.push(
    'separator',
    { label: 'Novo livro ou leitura', icon: <BookOpen />, onSelect: () => void navigate(`/library?new=book${withTopic}`) },
    { label: 'Enviar documento', icon: <Upload />, onSelect: () => void navigate(`/library?upload=1${withTopic}`) },
    { label: topic ? `Canvas em “${topic.title}”` : 'Novo canvas', icon: <LayoutDashboard />, onSelect: () => void navigate(`/canvas?new=1${withTopic}`) },
  );
  const dialog = (
    <TopicFormDialog open={!!topicDialog} onOpenChange={(o) => !o && setTopicDialog(null)} parentId={topicDialog?.parentId ?? null} />
  );
  return { items, dialog };
}

function NavItems({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const review = useReviewSummary().data;
  const reviewCount = review ? review.due + review.newAvailable : 0;
  const item = cn(
    'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors lg:h-8',
    collapsed && 'justify-center px-0',
  );
  return (
    <nav aria-label="Principal" className="space-y-px">
      {NAV.map(({ to, label, icon: Icon, end, also }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              item,
              isActive || also.some((p) => pathname.startsWith(p))
                ? 'bg-surface-3 font-medium text-text'
                : 'text-muted hover:bg-surface-2 hover:text-text',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>{label}</span>
          {to === '/review' && reviewCount > 0 && !collapsed && (
            <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-accent tabular-nums" aria-label={`${reviewCount} para revisar hoje`}>
              {reviewCount}
            </span>
          )}
        </NavLink>
      ))}
      <Menu
        label="Mais destinos"
        align="start"
        trigger={
          <button
            type="button"
            title={collapsed ? 'Mais' : undefined}
            className={cn(
              item,
              MORE.some((m) => pathname.startsWith(m.to)) ? 'font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <Ellipsis className="size-4 shrink-0" aria-hidden />
            <span className={cn(collapsed && 'sr-only')}>Mais</span>
          </button>
        }
        items={MORE.map(({ to, label, icon: Icon }) => ({
          label,
          icon: <Icon />,
          onSelect: () => {
            onNavigate?.();
            void navigate(to);
          },
        }))}
      />
    </nav>
  );
}

/** Favorites as a sidebar section (Obsidian's bookmarks): links can be dragged to a tab bar. */
function Bookmarks({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useFavorites();
  const [open, setOpen] = usePref('mynotes:bookmarks-open', true);
  if (!data?.length) return null;
  return (
    <section aria-label="Favoritos" className="mb-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wide text-subtle uppercase hover:text-muted">
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} aria-hidden />
        Favoritos
      </button>
      {open && (
        <ul className="space-y-px">
          {data.map((f) => (
            <li key={f.id}>
              <NavLink
                to={entityPath(f.entityType, f.entityId)}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn('flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm', isActive ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2 hover:text-text')
                }
              >
                <EntityIcon type={f.entityType} className="size-3.5 shrink-0" />
                <span className="truncate">{f.title}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UserFooter({ collapsed }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const doLogout = async () => {
    const pending = await notesSync.pendingCount();
    if (
      pending > 0 &&
      !(await confirm({
        title: 'Há alterações não sincronizadas',
        description: `${pending} nota(s) ainda não foram enviadas ao servidor e serão perdidas se você sair agora.`,
        confirmLabel: 'Sair mesmo assim',
        danger: true,
      }))
    ) {
      return;
    }
    await logout();
    void navigate('/login');
  };
  return (
    <div className={cn('flex items-center gap-1 border-t border-border pt-2', collapsed && 'flex-col')}>
      {!collapsed && (
        <div className="min-w-0 flex-1 px-2">
          <div className="truncate text-[13px] font-medium">{user?.displayName ?? user?.username}</div>
          <SyncIndicator />
        </div>
      )}
      {collapsed && <SyncIndicator compact />}
      <NavLink to="/settings" aria-label="Configurações" title="Configurações" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text">
        <Settings className="size-4" />
      </NavLink>
      <IconButton label="Sair" size="sm" onClick={() => void doLogout()}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 px-2', collapsed && 'justify-center px-0')}>
      <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="size-6 rounded-md" />
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight">MyNotes</span>}
    </div>
  );
}

function Sidebar({ collapsed, onToggle, rightOpen, onToggleRight }: { collapsed: boolean; onToggle: () => void; rightOpen: boolean; onToggleRight: () => void }) {
  const palette = useCommandPalette();
  const quick = useQuickCreate();
  return (
    <aside
      className={cn('flex h-dvh shrink-0 flex-col gap-3 border-r border-border bg-surface-2/40 py-3', collapsed ? 'w-14 px-2' : 'w-64 px-3')}
      aria-label="Barra lateral"
    >
      <div className={cn('flex items-center justify-between', collapsed && 'flex-col gap-2')}>
        <Brand collapsed={collapsed} />
        <div className={cn('flex', collapsed && 'flex-col')}>
          <IconButton label={rightOpen ? 'Ocultar painel direito (Ctrl+Shift+\\)' : 'Painel direito: menções, sumário, grafo local (Ctrl+Shift+\\)'} size="sm" active={rightOpen} onClick={onToggleRight}>
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton label={collapsed ? 'Expandir barra lateral (Ctrl+\\)' : 'Recolher barra lateral (Ctrl+\\)'} size="sm" onClick={onToggle}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </IconButton>
        </div>
      </div>
      <div className={cn('flex gap-1.5', collapsed && 'flex-col')}>
        <button
          type="button"
          onClick={() => palette.open('search')}
          title="Buscar (Ctrl+K) · Troca rápida (Ctrl+O) · Comandos (Ctrl+P)"
          className={cn(
            'flex h-8 items-center gap-2 rounded-lg border border-border bg-surface text-sm text-subtle hover:border-border-strong',
            collapsed ? 'w-10 justify-center' : 'flex-1 px-2.5',
          )}
        >
          <Search className="size-4" aria-hidden />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Buscar</span>
              <Kbd>Ctrl K</Kbd>
            </>
          )}
          {collapsed && <span className="sr-only">Buscar</span>}
        </button>
        <Menu
          label="Criar"
          align="start"
          trigger={
            <IconButton label="Criar" size="sm" variant="secondary" className={cn(collapsed ? 'size-10' : 'size-8')}>
              <Plus className="size-4" />
            </IconButton>
          }
          items={quick.items}
        />
        {quick.dialog}
      </div>
      <NavItems collapsed={collapsed} />
      <div className={cn('scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1', collapsed && 'hidden')}>
        <Bookmarks />
        <TopicTree />
      </div>
      {collapsed && <div className="flex-1" />}
      <UserFooter collapsed={collapsed} />
    </aside>
  );
}

function MobileDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const close = () => onOpenChange(false);
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40 lg:hidden" />
        <RDialog.Content
          aria-describedby={undefined}
          className="safe-top fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-80 flex-col gap-3 bg-surface px-3 py-3 shadow-pop lg:hidden"
        >
          <RDialog.Title className="sr-only">Menu</RDialog.Title>
          <div className="flex items-center justify-between">
            <Brand />
            <RDialog.Close className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Fechar menu">
              <X className="size-5" />
            </RDialog.Close>
          </div>
          <NavItems onNavigate={close} />
          <div className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <Bookmarks onNavigate={close} />
            <TopicTree onNavigate={close} />
          </div>
          <div className="safe-bottom">
            <UserFooter />
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const palette = useCommandPalette();
  return (
    <header className="safe-top sticky top-0 z-30 flex h-[calc(3.25rem+env(safe-area-inset-top))] items-center gap-1 border-b border-border bg-bg/90 px-2 backdrop-blur lg:hidden">
      <IconButton label="Abrir menu" onClick={onMenu}>
        <MenuIcon className="size-5" />
      </IconButton>
      <div className="flex-1">
        <Brand />
      </div>
      <SyncIndicator compact />
      <IconButton label="Buscar" onClick={() => palette.open('search')}>
        <Search className="size-5" />
      </IconButton>
    </header>
  );
}

function MobileBottomNav({ onMenu }: { onMenu: () => void }) {
  const quick = useQuickCreate();
  const item = (to: string, label: string, Icon: typeof House, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'text-accent' : 'text-muted')
      }
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </NavLink>
  );
  return (
    <nav
      aria-label="Navegação rápida"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
    >
      <div className="flex h-16 items-stretch">
        {item('/', 'Início', House, true)}
        {item('/notes', 'Notas', StickyNote)}
        <div className="flex flex-1 items-center justify-center">
          <Menu
            label="Criar"
            align="center"
            trigger={
              <button type="button" aria-label="Criar" className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-card">
                <Plus className="size-6" />
              </button>
            }
            items={quick.items}
          />
          {quick.dialog}
        </div>
        {item('/library', 'Biblioteca', LibraryBig)}
        <button type="button" onClick={onMenu} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted">
          <MenuIcon className="size-5" aria-hidden />
          Mais
        </button>
      </div>
    </nav>
  );
}

/** Every shortcut: the commands' (customizable in Settings) and the fixed ones. */
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const commands = useCommands();
  const [overrides] = useHotkeyOverrides();
  const groups = new Map<string, [string, ReactNode][]>();
  for (const c of commands) {
    const key = effectiveHotkey(c.id, c.hotkey, overrides);
    if (!key || c.id.startsWith('tab.go') && c.id !== 'tab.go1') continue;
    const label = c.id === 'tab.go1' ? 'Ir para a aba 1…9' : c.label;
    const shown = c.id === 'tab.go1' ? `${formatHotkey(key).replace(/1$/, '')}1…9` : formatHotkey(key);
    groups.set(c.group, [...(groups.get(c.group) ?? []), [label, <Kbd key={c.id}>{shown}</Kbd>]]);
  }
  groups.set('Fixos', [
    ['Ir para Início / Notas / Biblioteca / Grafo', <span key="g"><Kbd>G</Kbd> + <Kbd>H</Kbd> / <Kbd>N</Kbd> / <Kbd>B</Kbd> / <Kbd>G</Kbd></span>],
    ['Salvar nota agora', <Kbd key="s">Ctrl S</Kbd>],
    ['Inserir link (no editor)', <Kbd key="l">Ctrl K</Kbd>],
    ['Referenciar um item (no editor)', <Kbd key="r">/</Kbd>],
    ['Referenciar um título de outra nota', <Kbd key="h">/nota.Título#Seção</Kbd>],
    ['Marcar com tag (no editor)', <Kbd key="t">#</Kbd>],
    ['Pré-visualizar um link (no editor)', <Kbd key="p">Ctrl + passar o mouse</Kbd>],
    ['Abrir link em nova aba / ao lado', <span key="c"><Kbd>Ctrl clique</Kbd> / <Kbd>Ctrl Alt clique</Kbd></span>],
    ['Mostrar atalhos', <Kbd key="q">?</Kbd>],
  ]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Atalhos de teclado" size="lg">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        {[...groups].map(([group, rows]) => (
          <section key={group}>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-subtle uppercase">{group}</h3>
            <dl className="divide-y divide-border text-sm">
              {rows.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="shrink-0">{keys}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">
        No macOS, use ⌘ no lugar de Ctrl. Personalize em Configurações › Atalhos.
      </p>
    </Dialog>
  );
}

/** Fixed shortcuts that aren't commands: "G then H/N/B/G" and "?". */
function SequenceShortcuts({ onHelp }: { onHelp: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        onHelp();
      } else if (Date.now() - lastG < 1000) {
        const to = { h: '/', n: '/notes', b: '/library', g: '/graph' }[e.key.toLowerCase()];
        if (to) void navigate(to);
        lastG = 0;
      } else if (e.key.toLowerCase() === 'g') {
        lastG = Date.now();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, onHelp]);
  return null;
}

interface RightState {
  open: boolean;
  tab: string;
}
const RIGHT_KEY = 'mynotes:right-panel';
const SIDEBAR_KEY = 'mynotes:sidebar-collapsed';

function Shell() {
  const wide = useMediaQuery(WIDE);
  const palette = useCommandPalette();
  const [collapsed, setCollapsed] = usePref(SIDEBAR_KEY, false);
  const [right, setRight] = usePref<RightState>(RIGHT_KEY, { open: false, tab: 'backlinks' });
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [newTopic, setNewTopic] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);

  const ui = useMemo<UiActions>(
    () => ({
      toggleSidebar: () => setPref(SIDEBAR_KEY, !getPref(SIDEBAR_KEY, false)),
      toggleRightPanel: (tab?: string) => {
        const cur = getPref<RightState>(RIGHT_KEY, { open: false, tab: 'backlinks' });
        // Asking for another tab opens it; asking for the open one (or none) toggles the panel.
        setPref(RIGHT_KEY, tab && (tab !== cur.tab || !cur.open) ? { open: true, tab } : { ...cur, open: !cur.open });
      },
      openHelp: () => setHelp(true),
      openPalette: palette.open,
      newTopic: () => setNewTopic(true),
    }),
    [palette.open],
  );

  return (
    <CommandsProvider ui={ui}>
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      {wide ? (
        <div className="flex h-dvh overflow-hidden">
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} rightOpen={right.open} onToggleRight={() => ui.toggleRightPanel()} />
          <main id="main" className="flex min-w-0 flex-1">
            <Workspace />
          </main>
          {right.open && (
            <Suspense fallback={<aside className="w-80 shrink-0 border-l border-border" />}>
              <RightPanel tab={right.tab} onTab={(tab) => setRight({ open: true, tab })} onClose={() => setRight({ ...right, open: false })} />
            </Suspense>
          )}
        </div>
      ) : (
        <>
          <div className="flex min-h-dvh">
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileTopBar onMenu={() => setDrawer(true)} />
              <main id="main" className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">
                <Outlet />
              </main>
            </div>
          </div>
          <MobileDrawer open={drawer} onOpenChange={setDrawer} />
          <MobileBottomNav onMenu={() => setDrawer(true)} />
        </>
      )}
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      <SequenceShortcuts onHelp={() => setHelp(true)} />
      <CommandPaletteDialog />
      <HoverPreviewLayer />
      <TemplatePicker />
      <TopicFormDialog open={newTopic} onOpenChange={setNewTopic} parentId={null} />
    </CommandsProvider>
  );
}

export function AppShell() {
  return (
    <CommandPaletteProvider>
      <Shell />
    </CommandPaletteProvider>
  );
}
