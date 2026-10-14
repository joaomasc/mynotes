import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog as RDialog } from 'radix-ui';
import { useNavigate } from 'react-router';
import { ArrowLeft, BookOpen, CalendarDays, FileText, LibraryBig, Network, Plus, Search, Settings, StickyNote, Waypoints } from 'lucide-react';
import type { SearchResult } from '@mynotes/shared';
import { Kbd, Spinner } from '@/components/ui/feedback';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { qk } from '@/lib/query';
import { useCreateNote } from '@/features/notes/use-create-note';
import { useDebounced } from '@/lib/hooks';

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  hint?: string;
}

const PaletteContext = createContext<{ open: () => void }>({ open: () => undefined });
export const useCommandPalette = () => useContext(PaletteContext);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // Inside the note editor Ctrl+K inserts a link instead.
        if ((e.target as HTMLElement | null)?.closest?.('.ProseMirror')) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim(), 200);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = useQuery({
    queryKey: qk.search(debounced, ''),
    queryFn: ({ signal }) => endpoints.search(debounced, undefined, 12, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const go = (path: string) => {
    onOpenChange(false);
    void navigate(path);
  };

  const actions: Action[] = [
    { id: 'new-note', label: 'Nova nota', icon: <Plus />, run: () => (onOpenChange(false), createNote.mutate(null)), hint: 'Alt+N' },
    { id: 'notes', label: 'Ir para Notas', icon: <StickyNote />, run: () => go('/notes') },
    { id: 'library', label: 'Ir para Biblioteca', icon: <LibraryBig />, run: () => go('/library') },
    { id: 'readings', label: 'Ir para Leituras', icon: <BookOpen />, run: () => go('/readings') },
    { id: 'study', label: 'Ir para Estudos', icon: <CalendarDays />, run: () => go('/study') },
    { id: 'maps', label: 'Ir para Mapas mentais', icon: <Network />, run: () => go('/maps') },
    { id: 'graph', label: 'Ir para Grafo', icon: <Waypoints />, run: () => go('/graph') },
    { id: 'settings', label: 'Configurações', icon: <Settings />, run: () => go('/settings') },
  ];

  const searching = debounced.length >= 2;
  const items: (Action | SearchResult)[] = searching
    ? [
        ...(results.data ?? []),
        { id: 'all', label: `Ver todos os resultados para “${debounced}”`, icon: <Search />, run: () => go(`/search?q=${encodeURIComponent(debounced)}`) },
      ]
    : actions.filter((a) => !query || a.label.toLowerCase().includes(query.toLowerCase()));

  const runItem = (item: Action | SearchResult) => ('run' in item ? item.run() : go(entityPath(item.type, item.id)));

  useEffect(() => setActive(0), [debounced, results.data]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
        <RDialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 mx-auto flex max-h-[100dvh] w-full animate-pop-in flex-col overflow-hidden border-border bg-surface shadow-pop sm:top-[12vh] sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl sm:border"
        >
          <RDialog.Title className="sr-only">Buscar e executar comandos</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <button type="button" className="p-1 text-muted sm:hidden" onClick={() => onOpenChange(false)} aria-label="Fechar">
              <ArrowLeft className="size-5" />
            </button>
            <Search className="hidden size-4 text-muted sm:block" aria-hidden />
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
                } else if (e.key === 'Enter' && items[active]) {
                  e.preventDefault();
                  runItem(items[active]);
                }
              }}
              placeholder="Buscar notas, assuntos, documentos, leituras…"
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `palette-${active}` : undefined}
              aria-autocomplete="list"
            />
            {results.isFetching && <Spinner className="size-4" />}
          </div>
          <ul id="palette-list" ref={listRef} role="listbox" className="scrollbar-thin flex-1 overflow-y-auto p-2">
            {searching && results.isSuccess && results.data.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">Nenhum resultado.</li>
            )}
            {searching && results.isError && (
              <li className="px-3 py-6 text-center text-sm text-muted">A busca precisa de conexão com o servidor.</li>
            )}
            {items.map((item, i) => {
              const isResult = !('run' in item);
              return (
                <li
                  key={isResult ? `${item.type}:${item.id}` : item.id}
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                    i === active ? 'bg-surface-2' : '',
                  )}
                >
                  {isResult ? (
                    <>
                      <EntityIcon type={item.type} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.title}</div>
                        {item.snippet && <div className="truncate text-xs text-muted">{item.snippet}</div>}
                      </div>
                      <span className="text-xs text-subtle">{entityLabel(item.type)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted [&>svg]:size-4">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.hint && <Kbd>{item.hint}</Kbd>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden items-center gap-3 border-t border-border px-4 py-2 text-xs text-subtle sm:flex">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> navegar
            </span>
            <span>
              <Kbd>Enter</Kbd> abrir
            </span>
            <span>
              <Kbd>Esc</Kbd> fechar
            </span>
            <FileText className="ml-auto size-3.5" aria-hidden />
            <span>Busca sem acentos</span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
