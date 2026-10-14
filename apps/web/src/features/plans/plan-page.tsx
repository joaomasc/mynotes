import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, BookOpen, Ellipsis, Pencil, Plus, Trash, X } from 'lucide-react';
import type { PlanDetail, PlanItem } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, PageLoader, Progress } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { longDate, shortDate, todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { FavoriteButton } from '../shared/favorite-button';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { PlanFormDialog, invalidatePlans } from './plan-dialogs';

function ItemDialog({ plan, item, open, onOpenChange }: { plan: PlanDetail; item: PlanItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const readings = useQuery({ queryKey: qk.readings({ picker: true }), queryFn: () => endpoints.readings.list({ limit: 200, sort: 'title' }), enabled: open });
  const [form, setForm] = useState({ title: '', notes: '', dueOn: '', readingId: '' });
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm({ title: item?.title ?? '', notes: item?.notes ?? '', dueOn: item?.dueOn ?? '', readingId: item?.readingId ?? '' });
  }
  const mutation = useMutation({
    mutationFn: () => {
      const body = { title: form.title, notes: form.notes, dueOn: form.dueOn || null, readingId: form.readingId || null };
      return item ? endpoints.plans.updateItem(plan.id, item.id, { ...body, baseVersion: item.version }) : endpoints.plans.addItem(plan.id, body);
    },
    onSuccess: () => {
      invalidatePlans(qc);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Editar etapa' : 'Nova etapa'}
      footer={
        <Button variant="primary" loading={mutation.isPending} disabled={!form.title.trim()} onClick={() => mutation.mutate()}>
          Salvar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Etapa">{(p) => <Input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Ex.: Ler capítulos 1 a 3" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prazo" optional>{(p) => <Input {...p} type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />}</Field>
          <Field label="Leitura" optional>
            {(p) => (
              <Select {...p} value={form.readingId} onChange={(e) => setForm({ ...form, readingId: e.target.value })}>
                <option value="">Nenhuma</option>
                {readings.data?.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Observações" optional>{(p) => <Textarea {...p} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [itemDialog, setItemDialog] = useState<{ item: PlanItem | null } | null>(null);
  const [quick, setQuick] = useState('');
  const query = useQuery({ queryKey: qk.plan(id), queryFn: () => endpoints.plans.get(id) });
  const plan = query.data;
  useRecordView('plan', id, query.isSuccess);

  const update = useMutation({
    mutationFn: (v: { item: PlanItem; body: Record<string, unknown> }) =>
      endpoints.plans.updateItem(id, v.item.id, { baseVersion: v.item.version, ...v.body }),
    onSuccess: () => invalidatePlans(qc),
    onError: (err) => {
      invalidatePlans(qc);
      toast.error(errorMessage(err));
    },
  });
  const add = useMutation({
    mutationFn: () => endpoints.plans.addItem(id, { title: quick }),
    onSuccess: () => {
      setQuick('');
      invalidatePlans(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) return <PageLoader />;
  if (!plan) {
    if (query.error instanceof ApiError && query.error.status === 404) return <EmptyState className="mt-16" title="Plano não encontrado" />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const pct = plan.itemCount ? (plan.completedCount / plan.itemCount) * 100 : 0;
  const today = todayIso();

  const moveItem = (index: number, dir: -1 | 1) => {
    const item = plan.items[index]!;
    const target = plan.items[index + dir];
    if (!target) return;
    update.mutate({ item, body: dir === -1 ? { beforeId: target.id } : { afterId: target.id } });
  };
  const removeItem = async (item: PlanItem) => {
    try {
      await endpoints.plans.removeItem(id, item.id);
      invalidatePlans(qc);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const removePlan = async () => {
    if (!(await confirm({ title: 'Excluir este plano?', description: 'As etapas também serão excluídas. As leituras vinculadas continuam existindo.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.plans.remove(id);
      invalidatePlans(qc);
      void navigate('/plans');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        above={<TopicBreadcrumb topicId={plan.topicId} />}
        title={plan.title}
        subtitle={plan.goal || undefined}
        actions={
          <>
            <FavoriteButton type="plan" id={plan.id} />
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                { label: 'Editar plano', icon: <Pencil />, onSelect: () => setEditing(true) },
                'separator',
                { label: 'Excluir plano', icon: <Trash />, danger: true, onSelect: () => void removePlan() },
              ]}
            />
          </>
        }
      />
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {plan.completedCount} de {plan.itemCount} etapas concluídas
          </span>
          <span className="text-muted">
            {plan.startOn && `Início ${longDate(plan.startOn)}`}
            {plan.startOn && plan.targetOn && ' · '}
            {plan.targetOn && `Meta ${longDate(plan.targetOn)}`}
          </span>
        </div>
        <Progress value={pct} className="mt-3 h-2" label="Progresso do plano" />
        {plan.description && <p className="mt-4 text-sm whitespace-pre-wrap text-muted">{plan.description}</p>}
      </Card>

      <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-muted uppercase">Etapas</h2>
      <Card className="divide-y divide-border overflow-hidden">
        {plan.items.map((item, i) => {
          const late = !item.completedAt && !!item.dueOn && item.dueOn < today;
          return (
            <div key={item.id} className="group flex items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={!!item.completedAt}
                onChange={(e) => update.mutate({ item, body: { completed: e.target.checked } })}
                aria-label={`Concluir “${item.title}”`}
                className="mt-1 size-[18px] shrink-0 accent-[var(--accent)]"
              />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => setItemDialog({ item })} className={cn('text-left text-sm', item.completedAt && 'text-muted line-through')}>
                  {item.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {item.dueOn && <Badge tone={late ? 'danger' : 'neutral'}>{shortDate(item.dueOn)}</Badge>}
                  {item.readingId && (
                    <Link to={`/readings/${item.readingId}`} className="inline-flex items-center gap-1 text-xs text-reading hover:underline">
                      <BookOpen className="size-3" aria-hidden /> leitura
                    </Link>
                  )}
                  {item.notes && <span className="truncate text-xs text-muted">{item.notes}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                <IconButton label="Mover para cima" size="sm" disabled={i === 0} onClick={() => moveItem(i, -1)}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="Mover para baixo" size="sm" disabled={i === plan.items.length - 1} onClick={() => moveItem(i, 1)}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label="Remover etapa" size="sm" onClick={() => void removeItem(item)}>
                  <X className="size-4" />
                </IconButton>
              </div>
            </div>
          );
        })}
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (quick.trim()) add.mutate();
          }}
        >
          <Plus className="size-4 text-subtle" aria-hidden />
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Adicionar etapa e pressionar Enter"
            aria-label="Nova etapa"
            className="h-9 flex-1 bg-transparent text-base outline-none placeholder:text-subtle sm:text-sm"
          />
          <Button size="sm" variant="ghost" onClick={() => setItemDialog({ item: null })}>
            Com detalhes
          </Button>
        </form>
      </Card>

      <PlanFormDialog open={editing} onOpenChange={setEditing} plan={plan} />
      <ItemDialog plan={plan} item={itemDialog?.item ?? null} open={!!itemDialog} onOpenChange={(o) => !o && setItemDialog(null)} />
    </Page>
  );
}
