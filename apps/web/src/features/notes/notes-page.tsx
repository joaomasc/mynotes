import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Plus, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { NoteListItem } from './note-list-item';
import { useCreateNote } from './use-create-note';

export function Component() {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topic') ?? '';
  const sort = params.get('sort') ?? 'updated';
  // Reviews and page annotations live in their books; listed here on demand.
  const role = params.get('role') ?? 'note';
  const createNote = useCreateNote();
  const { tree } = useTopics();

  const query = useInfiniteQuery({
    queryKey: qk.notes({ topicId, sort, role, infinite: true }),
    queryFn: ({ pageParam }) =>
      endpoints.notes.list({
        ...(topicId ? { topicId } : {}),
        ...(role !== 'all' ? { role } : {}),
        sort,
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const notes = query.data?.pages.flatMap((p) => p.data) ?? [];

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Page>
      <PageHeader
        title="Notas"
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => createNote.mutate(topicId && topicId !== 'none' ? topicId : null)}
            loading={createNote.isPending}
          >
            Nova nota
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="min-w-48 flex-1 sm:flex-none">
          <Select aria-label="Filtrar por assunto" value={topicId} onChange={(e) => update('topic', e.target.value)}>
            <option value="">Todos os assuntos</option>
            <option value="none">Sem assunto</option>
            {tree.flat.map((t) => (
              <option key={t.id} value={t.id}>
                {'  '.repeat(t.depth)}
                {t.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select aria-label="Tipo de nota" value={role} onChange={(e) => update('role', e.target.value === 'note' ? '' : e.target.value)}>
            <option value="note">Notas</option>
            <option value="annotation">Anotações de leitura</option>
            <option value="review">Resenhas</option>
            <option value="all">Tudo</option>
          </Select>
        </div>
        <div className="w-44">
          <Select aria-label="Ordenar" value={sort} onChange={(e) => update('sort', e.target.value === 'updated' ? '' : e.target.value)}>
            <option value="updated">Modificadas recentemente</option>
            <option value="created">Criadas recentemente</option>
            <option value="title">Título (A–Z)</option>
            {topicId && topicId !== 'none' && <option value="manual">Ordem manual</option>}
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <ListSkeleton rows={6} />
      ) : query.isError && notes.length === 0 ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<StickyNote />}
          title={topicId ? 'Nenhuma nota com este filtro' : 'Nenhuma nota ainda'}
          description="Notas guardam seus resumos, ideias e anotações de estudo."
          action={
            <Button variant="outline" onClick={() => createNote.mutate(null)}>
              Escrever uma nota
            </Button>
          }
        />
      ) : (
        <>
          <Card className="divide-y divide-border overflow-hidden">
            {notes.map((n) => (
              <NoteListItem key={n.id} note={n} />
            ))}
          </Card>
          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
