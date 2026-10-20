import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ListTodo, Plus } from 'lucide-react';
import type { PlanStatus } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, ListSkeleton, Progress } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { shortDate, todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { PlanFormDialog } from './plan-dialogs';

export function Component() {
  const [status, setStatus] = useState<PlanStatus>('active');
  const [creating, setCreating] = useState(false);
  const plans = useQuery({ queryKey: qk.plans, queryFn: () => endpoints.plans.list() });
  const items = (plans.data ?? []).filter((p) => p.status === status);

  return (
    <Page width="wide">
      <PageHeader
        title="Planos de estudo"
        subtitle="Organize leituras e etapas por assunto, com metas e prazos."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Novo plano
          </Button>
        }
      />
      <div className="mb-5">
        <Segmented
          label="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Ativos' },
            { value: 'completed', label: 'Concluídos' },
            { value: 'archived', label: 'Arquivados' },
          ]}
        />
      </div>
      {plans.isLoading ? (
        <ListSkeleton rows={3} />
      ) : plans.isError && !plans.data ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListTodo />}
          title={status === 'active' ? 'Nenhum plano ativo' : 'Nada por aqui'}
          description="Um plano reúne etapas (capítulos, leituras, exercícios) com prazos para você acompanhar."
          action={status === 'active' ? <Button variant="outline" onClick={() => setCreating(true)}>Criar plano</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => {
            const pct = p.itemCount ? (p.completedCount / p.itemCount) * 100 : 0;
            const late = p.status === 'active' && !!p.targetOn && p.targetOn < todayIso();
            return (
              <Link key={p.id} to={`/plans/${p.id}`} className="flex flex-col rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
                <p className="font-medium">{p.title}</p>
                {p.goal && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.goal}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {p.targetOn && <Badge tone={late ? 'danger' : 'neutral'}>{late ? 'atrasado · ' : 'até '}{shortDate(p.targetOn)}</Badge>}
                  {p.topicId && <TopicChip topicId={p.topicId} link={false} />}
                </div>
                <div className="mt-auto pt-4">
                  <div className="mb-1 text-xs text-muted">
                    {p.completedCount} de {p.itemCount} etapas
                  </div>
                  <Progress value={pct} label={`Progresso de ${p.title}`} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <PlanFormDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}
