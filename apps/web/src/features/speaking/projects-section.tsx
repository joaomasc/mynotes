import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_STEPS, PROJECT_TYPES, PROJECT_TYPE_INFO, type ProjectType } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, Section } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { useTopics } from '../topics/use-topics';

export const projectsKey = ['speech-projects'] as const;

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { tree } = useTopics();
  const [type, setType] = useState<ProjectType>('presentation');
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState('');
  const create = useMutation({
    mutationFn: () => endpoints.speech.createProject({ type, title: title.trim(), topicId: topicId || null }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: projectsKey });
      onOpenChange(false);
      void navigate(`/speaking/projects/${p.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo discurso"
      description="O professor conduz a construção em 11 etapas, do público à apresentação final."
      footer={
        <Button variant="primary" loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>
          Começar
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2" role="radiogroup" aria-label="Tipo de discurso">
          {PROJECT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cn('rounded-xl border p-3 text-left', type === t ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
            >
              <p className="text-sm font-medium">{PROJECT_TYPE_INFO[t].label}</p>
              <p className="text-xs text-muted">{PROJECT_TYPE_INFO[t].forWhat}</p>
            </button>
          ))}
        </div>
        <Field label="Título">{(f) => <Input {...f} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ciclovia na Avenida Central" />}</Field>
        <Field label="Assunto" optional hint="O roteiro vira uma nota nesse assunto, e os ensaios são conferidos com as suas notas dele.">
          {(f) => (
            <Select {...f} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">Nenhum</option>
              {tree.flat.map((t) => (
                <option key={t.id} value={t.id}>
                  {'  '.repeat(t.depth)}
                  {t.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Level 4 on the path: the user's own speeches. */
export function ProjectsSection() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: projectsKey, queryFn: endpoints.speech.projects });
  return (
    <Section
      title="Nível 4 · O seu discurso"
      action={
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          Novo discurso
        </Button>
      }
    >
      {data && data.length > 0 ? (
        <Card className="divide-y divide-border">
          {data.map((p) => (
            <Link key={p.id} to={`/speaking/projects/${p.id}`} className="block px-4 py-3 hover:bg-surface-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <span className="shrink-0 text-xs text-muted">{PROJECT_TYPE_INFO[p.type].label}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Progress value={((p.data.finalId ? PROJECT_STEPS.length : p.step - 1) / PROJECT_STEPS.length) * 100} label="Etapas concluídas" />
                <span className="shrink-0 text-xs text-muted tabular-nums">{p.data.finalId ? 'concluído' : `etapa ${p.step} de ${PROJECT_STEPS.length}`}</span>
              </div>
            </Link>
          ))}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-muted">
          Construa um discurso seu (uma apresentação, um discurso político ou a defesa de uma ideia), peça por peça, com dois ensaios comparados, banca e apresentação final.
          Recomendado depois do nível 3, mas você pode começar quando quiser.
        </Card>
      )}
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </Section>
  );
}
