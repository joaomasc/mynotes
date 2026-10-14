import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { SearchEntityType, SearchResult } from '@mynotes/shared';
import { Spinner } from '@/components/ui/feedback';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel } from '@/lib/entities';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';

/** Searches real data and lets the user pick an item (used for relations and internal links). */
export function EntityPicker({
  types,
  onPick,
  exclude,
  placeholder = 'Buscar item…',
  autoFocus = true,
}: {
  types: SearchEntityType[];
  onPick: (item: SearchResult) => void;
  exclude?: (item: SearchResult) => boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const typesParam = types.join(',');
  const { data, isFetching, isError } = useQuery({
    queryKey: qk.search(debounced, typesParam),
    queryFn: ({ signal }) => endpoints.search(debounced, typesParam, 15, signal),
    enabled: debounced.length >= 2,
  });
  const items = (data ?? []).filter((i) => !exclude?.(i));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              onPick(items[active]);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-lg border border-border bg-surface pr-9 pl-9 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
        />
        {isFetching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Spinner className="size-4" />
          </span>
        )}
      </div>
      <ul role="listbox" aria-label="Resultados" className="max-h-72 overflow-y-auto">
        {debounced.length < 2 && <li className="px-2 py-4 text-center text-sm text-subtle">Digite pelo menos 2 letras.</li>}
        {debounced.length >= 2 && !isFetching && items.length === 0 && (
          <li className="px-2 py-4 text-center text-sm text-muted">{isError ? 'Busca indisponível offline.' : 'Nada encontrado.'}</li>
        )}
        {items.map((item, i) => (
          <li
            key={`${item.type}:${item.id}`}
            role="option"
            aria-selected={i === active}
            onClick={() => onPick(item)}
            onMouseMove={() => setActive(i)}
            className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', i === active && 'bg-surface-2')}
          >
            <EntityIcon type={item.type} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="text-xs text-subtle">{entityLabel(item.type)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
