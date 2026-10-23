import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Layers, Plus, Search } from 'lucide-react';
import { CARD_KINDS, CARD_KIND_LABELS, type ReviewCard } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { TopicSelect } from '../topics/topic-dialogs';
import { CardDialog } from './card-dialog';
import { KindBadge, cardLine, dueLabel } from './card-view';

/** Every card and question, with filters; tapping one edits it. */
export function Component() {
  const [params, setParams] = useSearchParams();
  const noteId = params.get('noteId') ?? undefined;
  const [topicId, setTopicId] = useState<string | null>(params.get('topic'));
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [editing, setEditing] = useState<ReviewCard | null>(null);
  const [creating, setCreating] = useState(false);
  const note = useQuery({ queryKey: qk.note(noteId ?? ''), queryFn: () => endpoints.notes.get(noteId!), enabled: !!noteId });

  const filters = { topicIds: topicId ? [topicId] : undefined, noteId, kind: kind || undefined, status: status || undefined, q: term || undefined };
  const list = useInfiniteQuery({
    queryKey: qk.reviewCards(filters),
    queryFn: ({ pageParam }) => endpoints.review.cards({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const cards = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Page>
      <PageHeader
        above={
          <Link to="/review" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" aria-hidden /> Revisar
          </Link>
        }
        title="Cartões e perguntas"
        subtitle={noteId ? <>Da nota “{note.data?.title || '…'}” · <button className="text-accent hover:underline" onClick={() => setParams({})}>ver todos</button></> : 'Tudo o que entra nas suas revisões.'}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Novo cartão
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_10rem_10rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nos cartões" className="pl-9" aria-label="Buscar nos cartões" />
        </div>
        <TopicSelect value={topicId} onChange={setTopicId} emptyLabel="Todos os assuntos" aria-describedby={undefined} />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {CARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {CARD_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="">Ativos e suspensos</option>
          <option value="active">Ativos</option>
          <option value="suspended">Suspensos</option>
          <option value="leech">Difíceis</option>
        </Select>
      </div>
      {topicId && <p className="mb-3 text-xs text-muted">Inclui os subassuntos.</p>}

      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : cards.length === 0 ? (
        <EmptyState icon={<Layers />} title="Nenhum cartão aqui" description="Crie um cartão, transforme um trecho de nota em cartão (menu ⋯ da nota) ou peça perguntas à IA na página Revisar." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {cards.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setEditing(c)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">{cardLine(c)}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <KindBadge kind={c.kind} />
                      <span>{dueLabel(c)}</span>
                      {c.schedule.lapses > 0 && <span>· {c.schedule.lapses} {c.schedule.lapses === 1 ? 'erro' : 'erros'}</span>}
                      {c.leech && <span className="text-warning">· difícil</span>}
                      {c.sourceChanged && <span className="text-warning">· trecho mudou na nota</span>}
                      {(c.noteTitle || c.topicTitle) && <span className="truncate">· {c.noteTitle || c.topicTitle}</span>}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Carregar mais
              </Button>
            </div>
          )}
        </Card>
      )}
      <CardDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} card={editing} />
      <CardDialog
        open={creating}
        onOpenChange={setCreating}
        draft={noteId ? { noteId, noteTitle: note.data?.title ?? null } : { topicId }}
      />
    </Page>
  );
}
