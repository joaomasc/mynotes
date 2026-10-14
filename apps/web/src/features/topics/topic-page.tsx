import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BookOpen, Ellipsis, FileText, FolderInput, Lightbulb, Pencil, Plus, StickyNote, Trash, Upload } from 'lucide-react';
import { uuidv7 } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, ListSkeleton, PageLoader, Progress } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { fileSize, plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { NoteListItem } from '../notes/note-list-item';
import { useCreateNote } from '../notes/use-create-note';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { DeleteTopicDialog, MoveTopicDialog, TopicFormDialog } from './topic-dialogs';
import { useTopics } from './use-topics';

function Concepts({ topicId }: { topicId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const { data } = useQuery({ queryKey: [...qk.concepts, topicId], queryFn: () => endpoints.concepts.list(topicId) });
  const add = useMutation({
    mutationFn: () => endpoints.concepts.create({ id: uuidv7(), name, topicId }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: qk.concepts });
      void qc.invalidateQueries({ queryKey: ['graph'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-muted">Conceitos</h3>
      {data && data.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {data.map((c) => (
            <Link
              key={c.id}
              to={`/concepts/${c.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:border-concept"
            >
              <Lightbulb className="size-3 text-concept" aria-hidden />
              {c.name}
            </Link>
          ))}
        </div>
      )}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo conceito…" aria-label="Novo conceito" maxLength={200} />
        <IconButton label="Adicionar conceito" type="submit" variant="outline" disabled={!name.trim() || add.isPending}>
          <Plus className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const { tree } = useTopics();
  const [dialog, setDialog] = useState<'edit' | 'move' | 'delete' | 'sub' | null>(null);

  const detail = useQuery({ queryKey: qk.topic(id), queryFn: () => endpoints.topics.get(id) });
  const notes = useQuery({
    queryKey: qk.notes({ topicId: id, sort: 'manual' }),
    queryFn: () => endpoints.notes.list({ topicId: id, sort: 'manual', limit: 100 }),
  });
  const docs = useQuery({
    queryKey: qk.documents({ topicId: id }),
    queryFn: () => endpoints.documents.list({ topicId: id, limit: 50 }),
  });
  const readings = useQuery({
    queryKey: qk.readings({ topicId: id }),
    queryFn: () => endpoints.readings.list({ topicId: id, limit: 50 }),
  });
  useRecordView('topic', id, detail.isSuccess);

  if (detail.isLoading) return <PageLoader />;
  if (detail.isError || !detail.data) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <Page>
          <EmptyState title="Assunto não encontrado" description="Ele pode ter sido excluído ou movido para a lixeira." action={<Link to="/" className="text-accent">Voltar ao início</Link>} />
        </Page>
      );
    }
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const { topic, children } = detail.data;
  const node = tree.byId.get(topic.id) ?? null;

  return (
    <Page width="wide">
      <PageHeader
        above={<TopicBreadcrumb topicId={topic.parentId} />}
        title={
          <span className="flex items-center gap-3">
            <span className="size-3 shrink-0 rounded-full" style={{ background: topic.color ?? 'var(--border-strong)' }} aria-hidden />
            {topic.title}
          </span>
        }
        subtitle={topic.description || undefined}
        actions={
          <>
            <FavoriteButton type="topic" id={topic.id} />
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                { label: 'Editar', icon: <Pencil />, onSelect: () => setDialog('edit') },
                { label: 'Novo subassunto', icon: <Plus />, onSelect: () => setDialog('sub') },
                { label: 'Mover para…', icon: <FolderInput />, onSelect: () => setDialog('move'), disabled: !node },
                'separator',
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => setDialog('delete'), disabled: !node },
              ]}
            />
            <Button variant="primary" icon={<StickyNote className="size-4" />} onClick={() => createNote.mutate(topic.id)} loading={createNote.isPending}>
              Nova nota
            </Button>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          {children.length > 0 && (
            <Section title={`Subassuntos (${children.length})`} action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDialog('sub')}>Novo</Button>}>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {children.map((c) => (
                  <Link key={c.id} to={`/topics/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-border-strong">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--border-strong)' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.title}</span>
                      <span className="block text-xs text-muted">
                        {plural(c.noteCount, 'nota', 'notas')} · {plural(c.documentCount, 'documento', 'documentos')}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          <Section title={`Notas${notes.data ? ` (${notes.data.data.length})` : ''}`}>
            {notes.isLoading ? (
              <ListSkeleton rows={3} />
            ) : notes.data?.data.length ? (
              <Card className="divide-y divide-border overflow-hidden">
                {notes.data.data.map((n) => (
                  <NoteListItem key={n.id} note={n} showTopic={false} />
                ))}
              </Card>
            ) : (
              <EmptyState
                className="rounded-xl border border-dashed border-border py-8"
                icon={<StickyNote />}
                title="Nenhuma nota neste assunto"
                action={<Button size="sm" variant="outline" onClick={() => createNote.mutate(topic.id)}>Escrever a primeira</Button>}
              />
            )}
          </Section>

          <Section
            title={`Documentos${docs.data ? ` (${docs.data.data.length})` : ''}`}
            action={
              <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} onClick={() => void navigate(`/library?upload=1&topicId=${topic.id}`)}>
                Enviar
              </Button>
            }
          >
            {docs.data?.data.length ? (
              <Card className="divide-y divide-border overflow-hidden">
                {docs.data.data.map((d) => (
                  <Link key={d.id} to={`/library/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                    <FileText className="size-4 shrink-0 text-document" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    {d.status !== 'ready' && <Badge tone="warning">arquivo pendente</Badge>}
                    <span className="shrink-0 text-xs text-subtle">{fileSize(d.sizeBytes)}</span>
                  </Link>
                ))}
              </Card>
            ) : (
              <p className="text-sm text-muted">Nenhum documento.</p>
            )}
          </Section>

          <Section
            title={`Leituras${readings.data ? ` (${readings.data.data.length})` : ''}`}
            action={<Link to={`/readings?new=1&topicId=${topic.id}`} className="text-xs text-accent hover:underline">Nova leitura</Link>}
          >
            {readings.data?.data.length ? (
              <Card className="divide-y divide-border overflow-hidden">
                {readings.data.data.map((r) => (
                  <Link key={r.id} to={`/readings/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                    <BookOpen className="size-4 shrink-0 text-reading" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.title}</span>
                      {r.status === 'in_progress' && <Progress value={r.progressPercent ?? 0} className="mt-1.5 max-w-48" />}
                    </span>
                    <span className="shrink-0 text-xs text-subtle">{relativeTime(r.updatedAt)}</span>
                  </Link>
                ))}
              </Card>
            ) : (
              <p className="text-sm text-muted">Nenhuma leitura.</p>
            )}
          </Section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card className="space-y-6 p-4">
            <RelationsPanel type="topic" id={topic.id} title={topic.title} />
            <Concepts topicId={topic.id} />
          </Card>
        </aside>
      </div>

      <TopicFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} topic={topic} />
      <TopicFormDialog open={dialog === 'sub'} onOpenChange={(o) => !o && setDialog(null)} parentId={topic.id} />
      <MoveTopicDialog open={dialog === 'move'} onOpenChange={(o) => !o && setDialog(null)} topic={node} />
      <DeleteTopicDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        topic={node}
        onDeleted={() => void navigate(topic.parentId ? `/topics/${topic.parentId}` : '/')}
      />
    </Page>
  );
}
