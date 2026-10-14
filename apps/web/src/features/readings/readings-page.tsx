import { useEffect, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { BookOpen, Plus, Search } from 'lucide-react';
import { MATERIAL_TYPE_LABELS, PRIORITY_LABELS, READING_STATUS_LABELS, type Reading } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, ListSkeleton, Progress } from '@/components/ui/feedback';
import { Segmented, Select } from '@/components/ui/form';
import { Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { shortDate, todayIso } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { ProgressDialog, ReadingFormDialog, readingPercent } from './reading-dialogs';

type Tab = 'in_progress' | 'not_started' | 'completed' | 'overdue' | 'all';

function ReadingCard({ r, onProgress }: { r: Reading; onProgress: () => void }) {
  const late = r.status !== 'completed' && !!r.dueOn && r.dueOn < todayIso();
  const pct = readingPercent(r);
  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-5 shrink-0 text-reading" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link to={`/readings/${r.id}`} className="line-clamp-2 font-medium hover:text-accent">
            {r.title}
          </Link>
          <p className="mt-0.5 truncate text-sm text-muted">
            {[r.author, MATERIAL_TYPE_LABELS[r.materialType]].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={r.status === 'completed' ? 'success' : r.status === 'in_progress' ? 'accent' : 'neutral'}>{READING_STATUS_LABELS[r.status]}</Badge>
        {r.priority > 0 && <Badge tone={r.priority === 3 ? 'danger' : 'neutral'}>{PRIORITY_LABELS[r.priority]}</Badge>}
        {r.dueOn && r.status !== 'completed' && <Badge tone={late ? 'danger' : 'neutral'}>{late ? 'atrasada · ' : 'prazo '}{shortDate(r.dueOn)}</Badge>}
        {r.topicId && <TopicChip topicId={r.topicId} />}
      </div>
      {r.status !== 'not_started' && (
        <div className="mt-auto pt-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{r.totalPages && r.currentPage != null ? `pág. ${r.currentPage} de ${r.totalPages}` : `${Math.round(pct)}%`}</span>
            {r.status === 'in_progress' && (
              <button type="button" onClick={onProgress} className="font-medium text-accent hover:underline">
                Atualizar
              </button>
            )}
          </div>
          <Progress value={pct} label={`Progresso de ${r.title}`} />
        </div>
      )}
      {r.status === 'not_started' && (
        <button type="button" onClick={onProgress} className="mt-auto pt-4 text-left text-xs font-medium text-accent hover:underline">
          Registrar progresso
        </button>
      )}
    </article>
  );
}

/** `/readings` is now part of the library (old links keep working). */
export function Component() {
  const { search } = useLocation();
  return <Navigate to={`/library${search}`} replace />;
}

/** Books and readings of the library; each opens its study space. */
export function ReadingsView({ switcher }: { switcher: ReactNode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const sort = params.get('sort') ?? 'updated';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const [form, setForm] = useState<{ open: boolean; defaults?: Parameters<typeof ReadingFormDialog>[0]['defaults'] }>({ open: false });
  const [progressFor, setProgressFor] = useState<Reading | null>(null);

  useEffect(() => {
    if (params.get('new') === '1' || params.get('new') === 'book') {
      setForm({
        open: true,
        defaults: { topicId: params.get('topicId'), documentId: params.get('documentId'), ...(params.get('new') === 'book' ? { materialType: 'book' as const } : {}) },
      });
      const next = new URLSearchParams(params);
      ['new', 'topicId', 'documentId'].forEach((k) => next.delete(k));
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const filters = {
    ...(tab === 'overdue' ? { overdue: 'true' } : tab !== 'all' ? { status: tab } : {}),
    ...(query ? { q: query } : {}),
    sort: tab === 'overdue' ? 'due' : sort,
  };
  const list = useInfiniteQuery({
    queryKey: qk.readings({ ...filters, infinite: true }),
    queryFn: ({ pageParam }) => endpoints.readings.list({ ...filters, limit: 60, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <Page width="wide">
      <PageHeader
        title="Biblioteca"
        subtitle="Cada livro tem seu espaço de estudo: PDF, página atual, anotações por página e sua resenha."
        actions={
          <>
            <Link to="/plans" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
              Planos de leitura
            </Link>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ open: true, defaults: { materialType: 'book' } })}>
              Novo livro
            </Button>
          </>
        }
      />
      <div className="mb-4">{switcher}</div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Segmented
            label="Filtrar por situação"
            value={tab}
            onChange={(v) => setParam('tab', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'in_progress', label: 'Em andamento' },
              { value: 'not_started', label: 'Não iniciadas' },
              { value: 'overdue', label: 'Atrasadas' },
              { value: 'completed', label: 'Concluídas' },
            ]}
          />
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título, autor ou observação"
            aria-label="Buscar leituras"
            className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 sm:h-9 sm:text-sm"
          />
        </div>
        {tab !== 'overdue' && (
          <div className="w-40">
            <Select aria-label="Ordenar" value={sort} onChange={(e) => setParam('sort', e.target.value === 'updated' ? '' : e.target.value)}>
              <option value="updated">Recentes</option>
              <option value="due">Prazo</option>
              <option value="priority">Prioridade</option>
              <option value="title">Título</option>
            </Select>
          </div>
        )}
      </div>

      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError && items.length === 0 ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={tab === 'overdue' ? 'Nenhuma leitura atrasada' : 'Nenhuma leitura aqui'}
          description={tab === 'overdue' ? 'Tudo em dia.' : 'Adicione um livro, artigo ou curso que quer acompanhar.'}
          action={tab !== 'overdue' ? <Button variant="outline" onClick={() => setForm({ open: true })}>Adicionar leitura</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <ReadingCard key={r.id} r={r} onProgress={() => setProgressFor(r)} />
            ))}
          </div>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}

      <ReadingFormDialog
        open={form.open}
        onOpenChange={(o) => setForm({ open: o })}
        defaults={form.defaults}
        onSaved={(r) => void navigate(`/readings/${r.id}`)}
      />
      <ProgressDialog reading={progressFor} open={!!progressFor} onOpenChange={(o) => !o && setProgressFor(null)} />
    </Page>
  );
}
