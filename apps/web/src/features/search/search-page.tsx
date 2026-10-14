import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@mynotes/shared';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';

export function Component() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const type = (params.get('type') ?? '') as SearchEntityType | '';
  const debounced = useDebounced(q.trim(), 250);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced, params, setParams]);

  const results = useQuery({
    queryKey: qk.search(debounced, type),
    queryFn: ({ signal }) => endpoints.search(debounced, type || undefined, 50, signal),
    enabled: debounced.length >= 2,
  });

  const setType = (t: string) => {
    const next = new URLSearchParams(params);
    if (t) next.set('type', t);
    else next.delete('type');
    setParams(next, { replace: true });
  };

  return (
    <Page>
      <PageHeader title="Busca" />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busque em notas, assuntos, documentos, leituras, conceitos, planos e mapas"
          aria-label="Termos de busca"
          className="h-12 w-full rounded-xl border border-border bg-surface pr-4 pl-11 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
        {['', ...SEARCH_ENTITY_TYPES].map((t) => (
          <button
            key={t || 'all'}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            className={cn('h-8 rounded-full border px-3 text-[13px]', type === t ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text')}
          >
            {t ? entityLabel(t) : 'Tudo'}
          </button>
        ))}
      </div>
      {debounced.length < 2 ? (
        <EmptyState icon={<Search />} title="Digite para buscar" description="A busca ignora acentos e maiúsculas e considera todas as palavras digitadas." />
      ) : results.isLoading ? (
        <ListSkeleton rows={5} />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : !results.data?.length ? (
        <EmptyState title="Nenhum resultado" description="Tente outras palavras ou remova o filtro de tipo." />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {results.data.map((r) => (
            <Link key={`${r.type}:${r.id}`} to={entityPath(r.type, r.id)} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60">
              <EntityIcon type={r.type} className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="shrink-0 text-xs text-subtle">{entityLabel(r.type)}</span>
                </div>
                {r.snippet && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{r.snippet}</p>}
                <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
                  {r.topicId && r.type !== 'topic' && <TopicChip topicId={r.topicId} link={false} />}
                  <span>{relativeTime(r.updatedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  );
}
