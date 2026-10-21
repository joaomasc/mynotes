import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Columns2,
  Command as CommandIcon,
  Copy,
  Eye,
  FolderTree,
  Hash,
  House,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  LibraryBig,
  Link2Off,
  ListTodo,
  Mic,
  Network,
  PanelLeft,
  PanelRight,
  Pin,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  Settings,
  Sparkles,
  SquareSplitHorizontal,
  StickyNote,
  SunMoon,
  Trash,
  Upload,
  Waypoints,
  X,
} from 'lucide-react';
import { errorMessage } from '@/lib/api/client';
import { activeEditor } from '@/lib/active-editor';
import { effectiveHotkey, eventToHotkey, useHotkeyOverrides } from '@/lib/hotkeys';
import { isTypingTarget } from '@/lib/hooks';
import { getPref, setPref } from '@/lib/prefs';
import { readThemePreference } from '@/theme-boot';
import { stripBase } from '@/app/routes';
import { aiContextFromPath } from '../assistant/context';
import { useCreateNote } from '../notes/use-create-note';
import { dailyNote } from '../notes/templates';
import { openTemplatePicker } from '../notes/template-picker';
import { setLocalTheme, useSetting, useUpdateSetting } from '../settings/use-settings';
import { useCurrentTopic } from '../topics/use-current-topic';
import { useTopics } from '../topics/use-topics';
import { activeTabElement, workspace } from '../workspace/store';
import { useWorkspace } from '../workspace/workspace';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  /** Default shortcut (the user can change it in Settings › Atalhos). */
  hotkey?: string;
  run: () => void;
  /** Hidden from the palette and the shortcuts when false. */
  available?: boolean;
  /** Not triggered while typing (e.g. Alt+← moves by word in text fields on macOS). */
  notWhileTyping?: boolean;
  /** Not triggered inside the note editor (which has its own meaning for the keys). */
  notInEditor?: boolean;
}

/** Interface actions owned by the app shell. */
export interface UiActions {
  toggleSidebar: () => void;
  toggleRightPanel: (tab?: string) => void;
  openHelp: () => void;
  openPalette: (mode: 'search' | 'commands' | 'switcher') => void;
  newTopic: () => void;
}

const CommandsContext = createContext<Command[]>([]);
export const useCommands = () => useContext(CommandsContext);

const RECENT_KEY = 'mynotes:recent-commands';
export const recentCommandIds = () => getPref<string[]>(RECENT_KEY, []);

/** Runs a command and remembers it at the top of the palette. */
export function runCommand(cmd: Command): void {
  setPref(RECENT_KEY, [cmd.id, ...recentCommandIds().filter((id) => id !== cmd.id)].slice(0, 8));
  cmd.run();
}

function useAppCommands(ui: UiActions): Command[] {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createNote = useCreateNote();
  const topic = useCurrentTopic();
  const { tree } = useTopics();
  const notes = useSetting('notes').value;
  const ui_ = useSetting('ui').value;
  const updateUi = useUpdateSetting('ui');
  const ws = useWorkspace();
  const wide = workspace.enabled;
  const go = (path: string) => () => void navigate(path);

  return useMemo<Command[]>(() => {
    const nav = 'Navegação';
    const create = 'Criar';
    const tabs = 'Abas e painéis';
    const editor = 'Editor';
    const view = 'Interface';
    const list: Command[] = [
      { id: 'palette.search', label: 'Buscar em tudo', group: view, icon: <Search />, hotkey: 'Ctrl+K', notInEditor: true, run: () => ui.openPalette('search') },
      { id: 'palette.commands', label: 'Paleta de comandos', group: view, icon: <CommandIcon />, hotkey: 'Ctrl+P', run: () => ui.openPalette('commands') },
      { id: 'palette.switcher', label: 'Troca rápida: abrir por título', group: view, icon: <SquareSplitHorizontal />, hotkey: 'Ctrl+O', run: () => ui.openPalette('switcher') },
      { id: 'ui.sidebar', label: 'Mostrar/ocultar barra lateral', group: view, icon: <PanelLeft />, hotkey: 'Ctrl+\\', run: ui.toggleSidebar },
      { id: 'ui.right', label: 'Mostrar/ocultar painel direito', group: view, icon: <PanelRight />, hotkey: 'Ctrl+Shift+\\', available: wide, run: () => ui.toggleRightPanel() },
      { id: 'ui.right.backlinks', label: 'Painel direito: menções', group: view, icon: <PanelRight />, available: wide, run: () => ui.toggleRightPanel('backlinks') },
      { id: 'ui.right.outline', label: 'Painel direito: sumário da nota', group: view, icon: <PanelRight />, available: wide, run: () => ui.toggleRightPanel('outline') },
      { id: 'ui.right.graph', label: 'Painel direito: grafo local', group: view, icon: <PanelRight />, available: wide, run: () => ui.toggleRightPanel('graph') },
      { id: 'ui.right.tags', label: 'Painel direito: tags', group: view, icon: <PanelRight />, available: wide, run: () => ui.toggleRightPanel('tags') },
      { id: 'ui.right.assistant', label: 'Painel direito: assistente de IA', group: view, icon: <PanelRight />, available: wide, run: () => ui.toggleRightPanel('assistant') },
      {
        id: 'ui.theme',
        label: 'Alternar tema claro/escuro',
        group: view,
        icon: <SunMoon />,
        run: () => {
          const current = readThemePreference();
          const dark = current === 'dark' || (current === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
          const theme = dark ? 'light' : 'dark';
          setLocalTheme(theme);
          updateUi.mutate({ ...ui_, theme });
        },
      },
      { id: 'ui.help', label: 'Mostrar atalhos de teclado', group: view, icon: <Keyboard />, run: ui.openHelp },
      { id: 'ui.hotkeys', label: 'Personalizar atalhos', group: view, icon: <Keyboard />, run: go('/settings#atalhos') },

      { id: 'go.home', label: 'Ir para Início', group: nav, icon: <House />, run: go('/') },
      { id: 'go.notes', label: 'Ir para Notas', group: nav, icon: <StickyNote />, run: go('/notes') },
      { id: 'go.library', label: 'Ir para Biblioteca (livros e documentos)', group: nav, icon: <LibraryBig />, run: go('/library') },
      { id: 'go.graph', label: 'Ir para Grafo', group: nav, icon: <Waypoints />, run: go('/graph') },
      {
        id: 'ai.ask',
        label: 'Perguntar ao assistente de IA (sobre a página aberta)',
        group: nav,
        icon: <Sparkles />,
        hotkey: 'Alt+I',
        // Wide screens: the right panel follows the active tab. Phone: the page, with the item as context.
        run: () => {
          if (wide) return ui.toggleRightPanel('assistant');
          const context = aiContextFromPath(stripBase(window.location.pathname) + window.location.search);
          void navigate(context ? `/assistant?about=${context.type}:${context.id}` : '/assistant');
        },
      },
      { id: 'go.maps', label: 'Ir para Mapas livres', group: nav, icon: <Network />, run: go('/maps') },
      { id: 'go.canvas', label: 'Ir para Canvas', group: nav, icon: <LayoutDashboard />, run: go('/canvas') },
      { id: 'go.daily', label: 'Ir para Notas diárias (calendário)', group: nav, icon: <CalendarDays />, run: go('/daily') },
      { id: 'go.plans', label: 'Ir para Planos de leitura', group: nav, icon: <ListTodo />, run: go('/plans') },
      { id: 'go.study', label: 'Ir para Diário de estudos', group: nav, icon: <CalendarDays />, run: go('/study') },
      { id: 'go.speaking', label: 'Ir para Oratória (treinar uma fala)', group: nav, icon: <Mic />, run: go('/speaking') },
      { id: 'go.tags', label: 'Ver tags', group: nav, icon: <Hash />, run: go('/search?tags=1') },
      { id: 'go.broken', label: 'Ver referências quebradas', group: nav, icon: <Link2Off />, run: go('/search?broken=1') },
      { id: 'go.settings', label: 'Configurações', group: nav, icon: <Settings />, run: go('/settings') },
      { id: 'go.trash', label: 'Lixeira', group: nav, icon: <Trash />, run: go('/trash') },
      ...(topic
        ? [
            { id: 'go.topic-map', label: `Mapa mental de “${topic.title}”`, group: nav, icon: <Network />, run: go(`/topics/${topic.id}/map`) },
            { id: 'go.topic-graph', label: `Grafo de “${topic.title}”`, group: nav, icon: <Waypoints />, run: go(`/graph?focus=topic:${topic.id}`) },
          ]
        : []),

      {
        id: 'create.note',
        label: topic ? `Nova nota em “${topic.title}”` : 'Nova nota',
        group: create,
        icon: <Plus />,
        hotkey: 'Alt+N',
        run: () => createNote.mutate(topic?.id ?? null),
      },
      {
        id: 'create.daily',
        label: 'Abrir a nota diária de hoje',
        group: create,
        icon: <CalendarPlus />,
        hotkey: 'Alt+Shift+D',
        run: () =>
          void dailyNote(qc, notes, (notes.dailyTopicId && tree.byId.get(notes.dailyTopicId)?.title) || '').then(
            (note) => navigate(`/notes/${note.id}`),
            (err: unknown) => toast.error(errorMessage(err)),
          ),
      },
      { id: 'create.topic', label: 'Novo assunto', group: create, icon: <FolderTree />, run: ui.newTopic },
      { id: 'create.canvas', label: topic ? `Novo canvas em “${topic.title}”` : 'Novo canvas', group: create, icon: <LayoutDashboard />, run: go(`/canvas?new=1${topic ? `&topicId=${topic.id}` : ''}`) },
      { id: 'create.book', label: 'Novo livro ou leitura', group: create, icon: <BookOpen />, run: go(`/library?new=book${topic ? `&topicId=${topic.id}` : ''}`) },
      { id: 'create.upload', label: 'Enviar documento', group: create, icon: <Upload />, run: go(`/library?upload=1${topic ? `&topicId=${topic.id}` : ''}`) },

      { id: 'editor.template', label: 'Inserir modelo na nota', group: editor, icon: <LayoutTemplate />, hotkey: 'Alt+Shift+M', run: openTemplatePicker },
      {
        id: 'editor.reading',
        label: 'Alternar modo de leitura / edição',
        group: editor,
        icon: <Eye />,
        hotkey: 'Ctrl+E',
        run: () => {
          const target = activeEditor.get(activeTabElement());
          if (target?.toggleReading) target.toggleReading();
          else toast.info('Abra uma nota para alternar o modo de leitura.');
        },
      },

      { id: 'tab.new', label: 'Nova aba', group: tabs, icon: <Plus />, hotkey: 'Alt+T', available: wide, run: () => (workspace.openTab('/'), ui.openPalette('switcher')) },
      { id: 'tab.close', label: 'Fechar aba', group: tabs, icon: <X />, hotkey: 'Alt+W', available: wide, run: () => workspace.closeTab(workspace.activeTab().id) },
      { id: 'tab.reopen', label: 'Reabrir aba fechada', group: tabs, icon: <RotateCcw />, hotkey: 'Alt+Shift+T', available: wide && ws.closed.length > 0, run: () => workspace.reopenClosed() },
      { id: 'tab.next', label: 'Próxima aba', group: tabs, icon: <ArrowRight />, hotkey: 'Alt+PageDown', available: wide, run: () => workspace.cycleTab(1) },
      { id: 'tab.prev', label: 'Aba anterior', group: tabs, icon: <ArrowLeft />, hotkey: 'Alt+PageUp', available: wide, run: () => workspace.cycleTab(-1) },
      { id: 'tab.back', label: 'Voltar (na aba)', group: tabs, icon: <ArrowLeft />, hotkey: 'Alt+ArrowLeft', notWhileTyping: true, available: wide, run: () => workspace.back() },
      { id: 'tab.forward', label: 'Avançar (na aba)', group: tabs, icon: <ArrowRight />, hotkey: 'Alt+ArrowRight', notWhileTyping: true, available: wide, run: () => workspace.forward() },
      { id: 'tab.pin', label: 'Fixar/desafixar aba', group: tabs, icon: <Pin />, available: wide, run: () => workspace.togglePin(workspace.activeTab().id) },
      { id: 'tab.duplicate', label: 'Duplicar aba', group: tabs, icon: <Copy />, available: wide, run: () => workspace.duplicate(workspace.activeTab().id) },
      { id: 'tab.close-others', label: 'Fechar as outras abas', group: tabs, icon: <X />, available: wide, run: () => workspace.closeOthers(workspace.activeTab().id) },
      { id: 'pane.split-right', label: 'Dividir à direita', group: tabs, icon: <Columns2 />, hotkey: 'Alt+\\', available: wide, run: () => workspace.openSplit(workspace.activeTab().path, 'row') },
      { id: 'pane.split-down', label: 'Dividir abaixo', group: tabs, icon: <Rows2 />, hotkey: 'Alt+-', available: wide, run: () => workspace.openSplit(workspace.activeTab().path, 'col') },
      { id: 'pane.next', label: 'Ir para o próximo painel', group: tabs, icon: <ArrowRight />, hotkey: 'Alt+.', available: wide, run: () => workspace.cyclePane(1) },
      { id: 'pane.prev', label: 'Ir para o painel anterior', group: tabs, icon: <ArrowLeft />, hotkey: 'Alt+,', available: wide, run: () => workspace.cyclePane(-1) },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `tab.go${i + 1}`,
        label: i === 8 ? 'Ir para a última aba' : `Ir para a aba ${i + 1}`,
        group: tabs,
        icon: <SquareSplitHorizontal />,
        hotkey: `Alt+${i + 1}`,
        available: wide,
        run: () => workspace.goToTab(i + 1),
      })),
      {
        id: 'layout.save',
        label: 'Salvar disposição atual como…',
        group: 'Disposições',
        icon: <LayoutTemplate />,
        available: wide,
        run: () => {
          const name = window.prompt('Nome da disposição (ex.: Estudo de História)')?.trim();
          if (!name) return;
          workspace.saveAs(name.slice(0, 60));
          toast.success(`Disposição “${name}” salva`);
        },
      },
      ...workspace.savedNames().flatMap((name) => [
        { id: `layout.open:${name}`, label: `Abrir disposição “${name}”`, group: 'Disposições', icon: <LayoutTemplate />, available: wide, run: () => workspace.loadSaved(name) },
        { id: `layout.delete:${name}`, label: `Excluir disposição “${name}”`, group: 'Disposições', icon: <Trash />, available: wide, run: () => workspace.deleteSaved(name) },
      ]),
    ];
    return list.filter((c) => c.available !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when what the labels/availability depend on changes
  }, [topic, notes, ui_, ws, wide, tree, ui]);
}

function useCommandHotkeys(commands: Command[]) {
  const [overrides] = useHotkeyOverrides();
  const latest = useRef({ commands, overrides });
  latest.current = { commands, overrides };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const hotkey = eventToHotkey(e);
      if (!hotkey) return;
      const { commands: list, overrides: ov } = latest.current;
      const cmd = list.find((c) => effectiveHotkey(c.id, c.hotkey, ov) === hotkey);
      if (!cmd) return;
      const typing = isTypingTarget(e.target);
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.ProseMirror');
      if (cmd.notInEditor && inEditor) return;
      if (cmd.notWhileTyping && typing) return;
      // Plain keys and Shift+key only act outside text fields.
      if (typing && !e.ctrlKey && !e.metaKey && !e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Provides the app's commands (palette, shortcuts, help) and listens to their shortcuts. */
export function CommandsProvider({ ui, children }: { ui: UiActions; children: ReactNode }) {
  const commands = useAppCommands(ui);
  useCommandHotkeys(commands);
  return <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>;
}
