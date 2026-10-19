import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog as RDialog } from 'radix-ui';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Command as CommandIcon, CornerDownLeft, FileText, Plus, Search } from 'lucide-react';
import { normalizeSearch, uuidv7, type GraphNode, type SearchResult } from '@mynotes/shared';
import { Kbd, Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { fuzzyFilter } from '@/lib/fuzzy';
import { effectiveHotkey, formatHotkey, useHotkeyOverrides } from '@/lib/hotkeys';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { recentCommandIds, runCommand, useCommands, type Command } from '@/features/commands/commands';
import { justCreatedNotes } from '@/features/notes/use-create-note';
import { useCurrentTopic } from '@/features/topics/use-current-topic';
import { useTopics, topicPath } from '@/features/topics/use-topics';
import { openPath, workspace, type OpenMode } from '@/features/workspace/store';

export type PaletteMode = 'search' | 'commands' | 'switcher';

interface PaletteState {
  open: (mode?: PaletteMode) => void;
  mode: PaletteMode | null;
  setMode: (mode: PaletteMode | null) => void;
}
const PaletteContext = createContext<PaletteState>({ open: () => undefined, mode: null, setMode: () => undefined });
export const useCommandPalette = () => useContext(PaletteContext);

/** Holds which palette is open; the shortcuts that open it are commands (see commands.tsx). */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const value = useMemo(
    () => ({ mode, setMode, open: (m: PaletteMode = 'search') => setMode((cur) => (cur === m ? null : m)) }),
    [mode],
  );
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** The palette dialog; rendered inside CommandsProvider (it lists the commands). */
export function CommandPaletteDialog() {
  const { mode, setMode } = useCommandPalette();
  return <CommandPalette mode={mode} onClose={() => setMode(null)} onMode={setMode} />;
}

type Item =
  | { kind: 'command'; command: Command }
  | { kind: 'result'; result: SearchResult }
  | { kind: 'title'; node: GraphNode }
  | { kind: 'all'; query: string }
  | { kind: 'create'; title: string };

const itemKey = (item: Item, i: number) =>
  item.kind === 'command' ? `c:${item.command.id}` : item.kind === 'result' ? `r:${item.result.type}:${item.result.id}` : item.kind === 'title' ? `t:${item.node.key}` : `${item.kind}:${i}`;

const pathOfResult = (r: SearchResult) =>
  r.type === 'note' ? referencePath({ type: 'note', id: r.id, role: r.role ?? 'note', readingId: r.readingId ?? null, page: r.page ?? null }) : entityPath(r.type, r.id);
const pathOfNode = (n: GraphNode) => referencePath({ type: n.type, id: n.entityId, role: n.role, readingId: null, page: null });

function CommandPalette({ mode, onClose, onMode }: { mode: PaletteMode | null; onClose: () => void; onMode: (m: PaletteMode) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const commands = useCommands();
  const topic = useCurrentTopic();
  const { tree } = useTopics();
  const [overrides] = useHotkeyOverrides();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const open = mode !== null;

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open, mode]);

  // "> " switches the search to commands, like in code editors.
  const commandMode = mode === 'commands' || (mode === 'search' && query.startsWith('>'));
  const text = mode === 'search' && query.startsWith('>') ? query.slice(1).trim() : query.trim();
  const debounced = useDebounced(text, 200);

  const results = useQuery({
    queryKey: qk.search(debounced, ''),
    queryFn: ({ signal }) => endpoints.search(debounced, undefined, 12, signal),
    enabled: mode === 'search' && !commandMode && debounced.length >= 2,
    staleTime: 10_000,
  });
  // Titles of everything (the graph's nodes), for instant fuzzy matching.
  const titles = useQuery({
    queryKey: ['title-index'],
    queryFn: () => endpoints.graph({ structure: 'false' }),
    enabled: mode === 'switcher',
    staleTime: 60_000,
  });
  // When the index is truncated (very large collections), the server search fills the gaps.
  const extra = useQuery({
    queryKey: qk.search(debounced, 'switcher'),
    queryFn: ({ signal }) => endpoints.search(debounced, 'topic,note,reading,document,concept', 10, signal),
    enabled: mode === 'switcher' && !!titles.data?.truncated && debounced.length >= 2,
    staleTime: 10_000,
  });

  const items: Item[] = useMemo(() => {
    if (!mode) return [];
    if (commandMode) {
      const recent = recentCommandIds();
      const ordered = text
        ? fuzzyFilter(commands, text, (c) => `${c.label} ${c.group}`, 80)
        : [...commands].sort((a, b) => {
            const ra = recent.indexOf(a.id);
            const rb = recent.indexOf(b.id);
            return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
          });
      return ordered.map((command) => ({ kind: 'command', command }));
    }
    if (mode === 'switcher') {
      const nodes = titles.data?.nodes ?? [];
      const list: Item[] = text
        ? fuzzyFilter(nodes, text, (n) => n.label, 40).map((node) => ({ kind: 'title', node }))
        : [...nodes]
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 12)
            .map((node) => ({ kind: 'title', node }));
      const seen = new Set(list.map((i) => (i.kind === 'title' ? `${i.node.type}:${i.node.entityId}` : '')));
      for (const r of extra.data ?? []) if (!seen.has(`${r.type}:${r.id}`)) list.push({ kind: 'result', result: r });
      if (text.length >= 1 && !nodes.some((n) => n.type === 'note' && normalizeSearch(n.label) === normalizeSearch(text))) list.push({ kind: 'create', title: text });
      return list;
    }
    // Search: results for the text, plus matching commands; recent commands when empty.
    if (debounced.length >= 2) {
      const cmds = fuzzyFilter(commands, debounced, (c) => c.label, 4).map((command): Item => ({ kind: 'command', command }));
      return [...(results.data ?? []).map((result): Item => ({ kind: 'result', result })), ...cmds, { kind: 'all', query: debounced }];
    }
    const recent = recentCommandIds()
      .map((id) => commands.find((c) => c.id === id))
      .filter((c): c is Command => !!c);
    const base = ['create.note', 'create.daily', 'palette.switcher', 'go.notes', 'go.library', 'go.graph', 'go.tags', 'go.settings']
      .map((id) => commands.find((c) => c.id === id))
      .filter((c): c is Command => !!c && !recent.includes(c));
    return [...recent.slice(0, 4), ...base].map((command) => ({ kind: 'command', command }));
  }, [mode, commandMode, text, debounced, commands, results.data, titles.data, extra.data]);

  useEffect(() => setActive(0), [debounced, results.data, mode, commandMode, titles.data]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openTarget = (path: string, how: OpenMode) => {
    onClose();
    if (workspace.enabled) openPath(path, how);
    else void navigate(path);
  };

  const createNote = async (title: string, how: OpenMode) => {
    try {
      const note = await endpoints.notes.create({ id: uuidv7(), title, topicId: topic?.id ?? null });
      qc.setQueryData(qk.note(note.id), note);
      justCreatedNotes.add(note.id);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      void qc.invalidateQueries({ queryKey: ['title-index'] });
      openTarget(`/notes/${note.id}`, how);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const runItem = (item: Item, how: OpenMode = 'same') => {
    switch (item.kind) {
      case 'command':
        onClose();
        runCommand(item.command);
        return;
      case 'result':
        return openTarget(pathOfResult(item.result), how);
      case 'title':
        return openTarget(pathOfNode(item.node), how);
      case 'all':
        return openTarget(`/search?q=${encodeURIComponent(item.query)}`, how);
      case 'create':
        return void createNote(item.title, how);
    }
  };

  const placeholder =
    mode === 'switcher'
      ? 'Abrir por título… (Ctrl+Enter: nova aba · Shift+Enter: criar nota)'
      : commandMode
        ? 'Digite um comando…'
        : 'Buscar notas, assuntos, documentos, leituras… (> para comandos)';

  const pathLabel = (topicId: string | null | undefined) => topicPath(tree, topicId).map((t) => t.title).join(' › ');

  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
        <RDialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 mx-auto flex max-h-[100dvh] w-full animate-pop-in flex-col overflow-hidden border-border bg-surface shadow-pop sm:top-[12vh] sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl sm:border"
        >
          <RDialog.Title className="sr-only">{mode === 'switcher' ? 'Troca rápida' : commandMode ? 'Paleta de comandos' : 'Buscar'}</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <button type="button" className="p-1 text-muted sm:hidden" onClick={onClose} aria-label="Fechar">
              <ArrowLeft className="size-5" />
            </button>
            {commandMode ? <CommandIcon className="hidden size-4 text-muted sm:block" aria-hidden /> : <Search className="hidden size-4 text-muted sm:block" aria-hidden />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (mode === 'switcher' && e.shiftKey && !(e.ctrlKey || e.metaKey) && text) return void createNote(text, 'same');
                  const item = items[active];
                  if (!item) return;
                  const how: OpenMode = e.ctrlKey || e.metaKey ? (e.shiftKey || e.altKey ? 'split' : 'tab') : 'same';
                  runItem(item, how);
                } else if (e.key === 'Backspace' && !query && mode !== 'search') {
                  onMode('search');
                }
              }}
              placeholder={placeholder}
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `palette-${active}` : undefined}
              aria-autocomplete="list"
            />
            {(results.isFetching || titles.isFetching) && <Spinner className="size-4" />}
          </div>
          <ul id="palette-list" ref={listRef} role="listbox" className="scrollbar-thin flex-1 overflow-y-auto p-2">
            {mode === 'search' && !commandMode && debounced.length >= 2 && results.isSuccess && results.data.length === 0 && (
              <li className="px-3 py-3 text-center text-sm text-muted">Nenhum conteúdo encontrado.</li>
            )}
            {mode === 'search' && !commandMode && debounced.length >= 2 && results.isError && (
              <li className="px-3 py-3 text-center text-sm text-muted">A busca precisa de conexão com o servidor.</li>
            )}
            {mode === 'switcher' && titles.isError && <li className="px-3 py-3 text-center text-sm text-muted">Não foi possível carregar os títulos.</li>}
            {commandMode && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nenhum comando.</li>}
            {items.map((item, i) => (
              <li
                key={itemKey(item, i)}
                id={`palette-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={(e) => runItem(item, e.ctrlKey || e.metaKey ? (e.shiftKey || e.altKey ? 'split' : 'tab') : 'same')}
                className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', i === active ? 'bg-surface-2' : '')}
              >
                {item.kind === 'command' ? (
                  <>
                    <span className="text-muted [&>svg]:size-4">{item.command.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.command.label}</span>
                    <span className="hidden text-[11px] text-subtle sm:inline">{item.command.group}</span>
                    {effectiveHotkey(item.command.id, item.command.hotkey, overrides) && (
                      <Kbd>{formatHotkey(effectiveHotkey(item.command.id, item.command.hotkey, overrides)!)}</Kbd>
                    )}
                  </>
                ) : item.kind === 'result' ? (
                  <>
                    <EntityIcon type={item.result.type} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.result.title || 'Sem título'}</div>
                      {item.result.snippet && <div className="truncate text-xs text-muted">{item.result.snippet}</div>}
                    </div>
                    <span className="text-xs text-subtle">{entityLabel(item.result.type)}</span>
                  </>
                ) : item.kind === 'title' ? (
                  <>
                    <EntityIcon type={item.node.type === 'note' && item.node.role !== 'note' ? 'reading' : item.node.type} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.node.label}</div>
                      {pathLabel(item.node.type === 'topic' ? tree.byId.get(item.node.entityId)?.parentId : item.node.topicId) && (
                        <div className="truncate text-xs text-muted">{pathLabel(item.node.type === 'topic' ? tree.byId.get(item.node.entityId)?.parentId : item.node.topicId)}</div>
                      )}
                    </div>
                    <span className="text-xs text-subtle">{entityLabel(item.node.type)}</span>
                  </>
                ) : item.kind === 'create' ? (
                  <>
                    <Plus className="size-4 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      Criar nota “{item.title}”{topic ? ` em ${topic.title}` : ''}
                    </span>
                    <Kbd>Shift Enter</Kbd>
                  </>
                ) : (
                  <>
                    <Search className="size-4 text-muted" aria-hidden />
                    <span className="flex-1">Ver todos os resultados para “{item.query}”</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden items-center gap-3 border-t border-border px-4 py-2 text-xs text-subtle sm:flex">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> navegar
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="inline size-3" />
              </Kbd>{' '}
              abrir
            </span>
            {workspace.enabled && !commandMode && (
              <span>
                <Kbd>Ctrl Enter</Kbd> nova aba
              </span>
            )}
            <FileText className="ml-auto size-3.5" aria-hidden />
            <span>{mode === 'switcher' ? 'Busca por aproximação' : commandMode ? `${commands.length} comandos` : 'Busca sem acentos'}</span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
