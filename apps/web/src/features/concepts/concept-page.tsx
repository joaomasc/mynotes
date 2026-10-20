import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Lightbulb, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { TopicSelect } from '../topics/topic-dialogs';

export function Component() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: ['concept', id], queryFn: () => endpoints.concepts.get(id) });
  const back = useQuery({ queryKey: qk.backlinks('concept', id), queryFn: () => endpoints.notes.backlinks('concept', id) });
  const c = query.data;
  const [form, setForm] = useState({ name: '', description: '', topicId: null as string | null });
  useEffect(() => {
    if (c) setForm({ name: c.name, description: c.description, topicId: c.topicId });
  }, [c]);
  const dirty = !!c && (form.name !== c.name || form.description !== c.description || form.topicId !== c.topicId);

  const save = useMutation({
    mutationFn: () => endpoints.concepts.update(id, { baseVersion: c!.version, ...form }),
    onSuccess: (saved) => {
      qc.setQueryData(['concept', id], saved);
      void qc.invalidateQueries({ queryKey: qk.concepts });
      void qc.invalidateQueries({ queryKey: ['graph'] });
      toast.success('Conceito salvo');
    },
    onError: (err) => {
      void query.refetch();
      toast.error(errorMessage(err));
    },
  });

  if (query.isLoading) return <PageLoader />;
  if (!c) {
    if (query.error instanceof ApiError && query.error.status === 404) return <EmptyState className="mt-16" icon={<Lightbulb />} title="Conceito não encontrado" />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este conceito?', description: 'As relações com ele também serão removidas.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.concepts.remove(id);
      void qc.invalidateQueries({ queryKey: qk.concepts });
      void navigate(c.topicId ? `/topics/${c.topicId}` : '/graph');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        above={<TopicBreadcrumb topicId={c.topicId} />}
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="size-6 text-concept" aria-hidden /> {c.name}
          </span>
        }
        actions={
          <Button variant="ghost" icon={<Trash className="size-4" />} onClick={() => void remove()}>
            Excluir
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="space-y-4 p-5">
          <Field label="Nome">{(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />}</Field>
          <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={form.topicId} onChange={(topicId) => setForm({ ...form, topicId })} emptyLabel="Sem assunto" />}</Field>
          <Field label="Definição / descrição" optional>{(p) => <Textarea {...p} rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
          <Button variant="primary" disabled={!dirty || !form.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </Card>
        <aside className="space-y-4">
          <Card className="p-4">
            <RelationsPanel type="concept" id={c.id} title={c.name} />
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-muted">Mencionado em</h3>
            {back.data?.length ? (
              <ul className="space-y-1">
                {back.data.map((b) => (
                  <li key={b.noteId}>
                    <Link to={`/notes/${b.noteId}`} className="block truncate rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                      {b.title || 'Sem título'}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nenhuma nota com link para este conceito.</p>
            )}
          </Card>
        </aside>
      </div>
    </Page>
  );
}
