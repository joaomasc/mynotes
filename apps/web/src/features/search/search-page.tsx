import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Hash, Link2Off, Search } from 'lucide-react';
import { SEARCH_ENTITY_TYPES, normalizeTag, type SearchResult } from '@mynotes/shared';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { backlinkLabel } from '../notes/backlink-list';
import { TopicChip } from '../shared/topic-breadcrumb';

/** Search filter: an entity type, or reading annotations (notes attached to a book page). */
const FILTERS = ['', 'topic', 'note', 'annotation', 'reading', 'document', 'concept', 'plan', 'mindmap'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Partial<Record<Filter, string>> = { '': 'Tudo', annotation: 'Anotações de leitura', reading: 'Livros e leituras' };

function resultLabel(r: SearchResult): string {
  return r.type === 'note' && r.role && r.role !== 'note'
    ? backlinkLabel({ role: r.role, title: r.title === 'Anotação' || r.title === 'Resenha' ? '' : r.title, readingTitle: r.readingTitle ?? null, page: r.page ?? null })
    : r.title;
}

function TagResults({ tag }: { tag: string }) {
  const notes = useQuery({ queryKey: qk.notes({ tag }), queryFn: () => endpoints.notes.list({ tag, limit: 100 }) });
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Conteúdos marcados com <span className="font-medium text-accent">#{tag}</span> ·{' '}
        <Link to="/search?tags=1" className="text-accent hover:underline">
          ver todas as tags
        </Link>
      </p>
      {notes.isLoading ? (
        <ListSkeleton rows={4} />
      ) : notes.isError ? (
        <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />
      ) : !notes.data?.data.length ? (
        <EmptyState icon={<Hash />} title="Nenhuma nota com esta tag" description="Escreva #nome em uma nota para marcá-la." />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {notes.data.data.map((n) => (
            <Link
              key={n.id}
              to={referencePath({ type: 'note', id: n.id, role: n.role, readingId: n.readingId, page: n.page })}
              className="block px-4 py-3 hover:bg-surface-2/60"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{n.role === 'note' ? n.title || 'Sem título' : backlinkLabel({ ...n, readingTitle: null })}</span>
                <span className="shrink-0 text-xs text-subtle">{relativeTime(n.updatedAt)}</span>
              </div>
              {n.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{n.excerpt}</p>}
              {n.topicId && (
                <div className="mt-1.5">
                  <TopicChip topicId={n.topicId} link={false} />
                </div>
              )}
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

function AllTags() {
  const tags = useQuery({ queryKey: qk.tags(''), queryFn: () => endpoints.tags(undefined, 200) });
  if (tags.isLoading) return <ListSkeleton rows={2} />;
  if (!tags.data?.length) {
    return <EmptyState icon={<Hash />} title="Nenhuma tag ainda" description="Em qualquer nota, escreva # seguido de uma palavra (ex.: #revisar, #critica)." />;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {tags.data.map((t) => (
        <Link key={t.tag} to={`/search?tag=${encodeURIComponent(t.tag)}`} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-sm hover:border-accent">
          <span className="text-accent">#{t.tag}</span> <span className="text-xs text-subtle tabular-nums">{t.count}</span>
        </Link>
      ))}
    </div>
  );
}

/** Notes whose "/" references point to deleted items, to repair them in the editor. */
function BrokenReferences() {
  const broken = useQuery({ queryKey: ['references-broken'], queryFn: endpoints.references.broken });
  if (broken.isLoading) return <ListSkeleton rows={3} />;
  if (broken.isError) return <ErrorState error={broken.error} onRetry={() => void broken.refetch()} />;
  if (!broken.data?.length) {
    return <EmptyState icon={<Link2Off />} title="Nenhuma referência quebrada" description="Todas as referências escritas com “/” apontam para itens que existem." />;
  }
  const byNote = new Map<string, typeof broken.data>();
  for (const b of broken.data) byNote.set(b.noteId, [...(byNote.get(b.noteId) ?? []), b]);
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        {broken.data.length} referência(s) em {byNote.size} nota(s) apontam para itens excluídos. Abra a nota e clique na referência riscada para escolher outro item ou mantê-la como texto.
      </p>
      <Card className="divide-y divide-border overflow-hidden">
        {[...byNote.values()].map((list) => {
          const b = list[0]!;
          return (
            <Link
              key={b.noteId}
              to={referencePath({ type: 'note', id: b.noteId, role: b.role, readingId: b.readingId, page: b.page })}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60"
            >
              <Link2Off className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium">{b.noteTitle || 'Sem título'}</span>
                <span className="text-xs text-muted">
                  {list.length} referência(s) quebrada(s): {[...new Set(list.map((x) => entityLabel(x.targetType).toLowerCase()))].join(', ')}
                </span>
              </div>
              {b.topicId && <TopicChip topicId={b.topicId} link={false} />}
            </Link>
          );
        })}
      </Card>
    </>
  );
}

export function Component() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const filter = (params.get('type') ?? '') as Filter;
  const tag = params.get('tag');
  const debounced = useDebounced(q.trim(), 250);

  useEffect(() => {
    const next = new URLSearchParams(params);
    // "#tag" searches by tag.
    if (debounced.startsWith('#') && normalizeTag(debounced)) {
      next.delete('q');
      next.set('tag', normalizeTag(debounced));
    } else if (debounced) {
      next.set('q', debounced);
      next.delete('tag');
      next.delete('tags');
    } else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced, params, setParams]);

  const apiTypes = filter === 'annotation' ? 'note' : filter;
  const results = useQuery({
    queryKey: qk.search(debounced, apiTypes),
    queryFn: ({ signal }) => endpoints.search(debounced, apiTypes || undefined, 50, signal),
    enabled: debounced.length >= 2 && !debounced.startsWith('#'),
  });
  const tagHits = useQuery({
    queryKey: qk.tags(debounced),
    queryFn: ({ signal }) => endpoints.tags(debounced, 8, signal),
    enabled: debounced.length >= 2 && !debounced.startsWith('#'),
  });
  const shown = (results.data ?? []).filter((r) =>
    filter === 'annotation' ? r.role === 'annotation' || r.role === 'review' : filter === 'note' ? !r.role || r.role === 'note' : true,
  );

  const setFilter = (t: string) => {
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
          placeholder="Assuntos, notas, livros, anotações, documentos… ou #tag"
          aria-label="Termos de busca"
          className="h-12 w-full rounded-xl border border-border bg-surface pr-4 pl-11 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {params.get('broken') === '1' && !debounced ? (
        <BrokenReferences />
      ) : tag ? (
        <TagResults tag={tag} />
      ) : params.get('tags') === '1' && !debounced ? (
        <AllTags />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
            {FILTERS.filter((t) => t === '' || t === 'annotation' || (SEARCH_ENTITY_TYPES as readonly string[]).includes(t)).map((t) => (
              <button
                key={t || 'all'}
                type="button"
                aria-pressed={filter === t}
                onClick={() => setFilter(t)}
                className={cn('h-8 rounded-full border px-3 text-[13px]', filter === t ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text')}
              >
                {FILTER_LABELS[t] ?? entityLabel(t)}
              </button>
            ))}
          </div>
          {!!tagHits.data?.length && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Tags:</span>
              {tagHits.data.map((t) => (
                <Link key={t.tag} to={`/search?tag=${encodeURIComponent(t.tag)}`} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent hover:underline">
                  #{t.tag} <span className="text-subtle">{t.count}</span>
                </Link>
              ))}
            </div>
          )}
          {debounced.length < 2 ? (
            <EmptyState
              icon={<Search />}
              title="Digite para buscar"
              description={
                <>
                  A busca ignora acentos e maiúsculas e considera todas as palavras. Use #tag para filtrar por tag ou{' '}
                  <Link to="/search?tags=1" className="text-accent hover:underline">
                    veja todas as tags
                  </Link>
                  . Também dá para{' '}
                  <Link to="/search?broken=1" className="text-accent hover:underline">
                    listar referências quebradas
                  </Link>
                  .
                </>
              }
            />
          ) : results.isLoading ? (
            <ListSkeleton rows={5} />
          ) : results.isError ? (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          ) : !shown.length ? (
            <EmptyState title="Nenhum resultado" description="Tente outras palavras ou remova o filtro de tipo." />
          ) : (
            <Card className="divide-y divide-border overflow-hidden">
              {shown.map((r) => (
                <Link
                  key={`${r.type}:${r.id}`}
                  to={r.type === 'note' ? referencePath({ type: 'note', id: r.id, role: r.role ?? 'note', readingId: r.readingId ?? null, page: r.page ?? null }) : entityPath(r.type, r.id)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60"
                >
                  <EntityIcon type={r.role && r.role !== 'note' ? 'reading' : r.type} className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{resultLabel(r)}</span>
                      <span className="shrink-0 text-xs text-subtle">
                        {r.role === 'annotation' ? 'Anotação' : r.role === 'review' ? 'Resenha' : entityLabel(r.type)}
                      </span>
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
        </>
      )}
    </Page>
  );
}
