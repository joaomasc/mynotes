import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { uuidv7, type Plan, type PlanCreate } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { TopicSelect } from '../topics/topic-dialogs';

type Form = Required<Omit<PlanCreate, 'id'>>;

export function invalidatePlans(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.plans });
  void qc.invalidateQueries({ queryKey: ['plan'] });
  void qc.invalidateQueries({ queryKey: qk.upcoming });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
}

export function PlanFormDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: Plan }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>({ topicId: null, title: '', description: '', goal: '', status: 'active', startOn: null, targetOn: null });
  useEffect(() => {
    if (!open) return;
    setForm(
      plan
        ? { topicId: plan.topicId, title: plan.title, description: plan.description, goal: plan.goal, status: plan.status, startOn: plan.startOn, targetOn: plan.targetOn }
        : { topicId: null, title: '', description: '', goal: '', status: 'active', startOn: null, targetOn: null },
    );
  }, [open, plan]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const mutation = useMutation({
    mutationFn: () => (plan ? endpoints.plans.update(plan.id, { ...form, baseVersion: plan.version }) : endpoints.plans.create({ ...form, id: uuidv7() })),
    onSuccess: (saved) => {
      invalidatePlans(qc);
      onOpenChange(false);
      if (!plan) void navigate(`/plans/${saved.id}`);
    },
    onError: (err) => {
      invalidatePlans(qc);
      toast.error(errorMessage(err));
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? 'Editar plano' : 'Novo plano de estudo'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="plan-form" loading={mutation.isPending} disabled={!form.title.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="plan-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim()) mutation.mutate();
        }}
      >
        <Field label="Título">{(p) => <Input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus maxLength={300} placeholder="Ex.: Fundamentos de macroeconomia" />}</Field>
        <Field label="Meta" optional hint="O que você quer alcançar ao final do plano.">
          {(p) => <Input {...p} value={form.goal} onChange={(e) => set('goal', e.target.value)} maxLength={2000} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início" optional>{(p) => <Input {...p} type="date" value={form.startOn ?? ''} onChange={(e) => set('startOn', e.target.value || null)} />}</Field>
          <Field label="Data-alvo" optional>{(p) => <Input {...p} type="date" value={form.targetOn ?? ''} onChange={(e) => set('targetOn', e.target.value || null)} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={form.topicId} onChange={(v) => set('topicId', v)} emptyLabel="Sem assunto" />}</Field>
          {plan && (
            <Field label="Situação">
              {(p) => (
                <Select {...p} value={form.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
                  <option value="active">Ativo</option>
                  <option value="completed">Concluído</option>
                  <option value="archived">Arquivado</option>
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Descrição" optional>{(p) => <Textarea {...p} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}
