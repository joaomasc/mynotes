import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  BookOpen,
  Brain,
  Ellipsis,
  FileText,
  FolderInput,
  Lightbulb,
  Network,
  Pencil,
  Plus,
  StickyNote,
  Timer,
  Trash,
  Upload,
  Waypoints,
} from 'lucide-react';
import { ANNOTATION_TYPE_LABELS, uuidv7, type TopicContext } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, ListSkeleton, PageLoader, Progress } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { duration, fileSize, plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { CanvasList } from '../canvas/use-canvases';
import { NoteListItem } from '../notes/note-list-item';
import { BacklinkList, TagChips } from '../notes/note-page';
import { useCreateNote } from '../notes/use-create-note';
import { ReadingFormDialog, readingPercent } from '../readings/reading-dialogs';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { InlineTopicCreate } from './inline-topic-create';
import { DeleteTopicDialog, MoveTopicDialog, TopicFormDialog } from './topic-dialogs';
import { useTopics } from './use-topics';

/** How a level of the hierarchy is presented. They are all topics underneath. */
export function levelLabel(depth: number): string {
  return depth === 0 ? 'Caderno' : depth === 1 ? 'Matéria' : 'Subassunto';
}

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

function Books({ context, onNew }: { context: TopicContext | undefined; onNew: () => void }) {
  const readings = context?.readings ?? [];
  return (
    <Section
      title={`Livros e leituras${context ? ` (${readings.length})` : ''}`}
      action={
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onNew}>
          Livro
        </Button>
      }
    >
      {readings.length === 0 ? (
        <p className="text-sm text-muted">Nenhum livro ligado a este assunto. Adicione um ou relacione um livro existente.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {readings.map((r) => (
            <Link key={r.id} to={`/readings/${r.id}`} className="flex gap-3 rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
              <BookOpen className="mt-0.5 size-4 shrink-0 text-reading" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {[r.author, plural(r.annotationCount, 'anotação', 'anotações'), r.via === 'relation' ? 'relacionado' : null].filter(Boolean).join(' · ')}
                </span>
                {r.status === 'in_progress' && <Progress value={readingPercent(r)} className="mt-2 max-w-48" label={`Progresso de ${r.title}`} />}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

function Annotations({ context }: { context: TopicContext | undefined }) {
  if (!context?.annotations.length) return null;
  return (
    <Section title={`Anotações de leitura sobre o tema (${context.annotations.length})`}>
      <Card className="divide-y divide-border overflow-hidden">
        {context.annotations.map((a) => (
          <Link
            key={a.id}
            to={referencePath({ type: 'note', id: a.id, role: a.role, readingId: a.readingId, page: a.page })}
            className="block px-4 py-3 hover:bg-surface-2/60"
          >
            <div className="flex items-center gap-2 text-xs text-muted">
              <BookOpen className="size-3.5 text-reading" aria-hidden />
              <span className="truncate">
                {a.role === 'review' ? 'Resenha' : `${a.readingTitle ?? 'Livro'}${a.page ? `, p. ${a.page}` : ''}`}
              </span>
              {a.annotationType && <Badge>{ANNOTATION_TYPE_LABELS[a.annotationType]}</Badge>}
            </div>
            {a.quote && <p className="mt-1 line-clamp-1 text-sm text-muted italic">“{a.quote}”</p>}
            <p className="mt-0.5 line-clamp-2 text-sm">{a.title || a.excerpt || 'Sem texto'}</p>
          </Link>
        ))}
      </Card>
    </Section>
  );
}

function StudyPanel({ topicId, context }: { topicId: string; context: TopicContext | undefined }) {
  const study = context?.study;
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <Timer className="size-3.5" aria-hidden /> Tempo de estudo
      </h3>
      {study && study.sessionCount > 0 ? (
        <p className="text-sm">
          {duration(study.totalSeconds)} em {plural(study.sessionCount, 'sessão', 'sessões')}
          {study.lastAt && <span className="text-muted"> · última {relativeTime(study.lastAt)}</span>}
        </p>
      ) : (
        <p className="text-xs text-muted">Nenhuma sessão registrada neste assunto.</p>
      )}
      <div className="mt-2 flex gap-3 text-[13px]">
        <Link to={`/study?log=1&topicId=${topicId}`} className="font-medium text-accent hover:underline">
          Registrar sessão
        </Link>
        <Link to="/study" className="text-muted hover:text-accent">
          Histórico
        </Link>
      </div>
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const { tree } = useTopics();
  const [dialog, setDialog] = useState<'edit' | 'sub' | 'move' | 'delete' | 'book' | null>(null);

  const detail = useQuery({ queryKey: qk.topic(id), queryFn: () => endpoints.topics.get(id) });
  const notes = useQuery({
    queryKey: qk.notes({ topicId: id, sort: 'manual' }),
    queryFn: () => endpoints.notes.list({ topicId: id, sort: 'manual', limit: 100 }),
  });
  const docs = useQuery({
    queryKey: qk.documents({ topicId: id }),
    queryFn: () => endpoints.documents.list({ topicId: id, limit: 50 }),
  });
  const context = useQuery({ queryKey: qk.topicContext(id), queryFn: () => endpoints.topics.context(id) });
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

  const { topic, children, ancestors } = detail.data;
  const node = tree.byId.get(topic.id) ?? null;
  const depth = ancestors.length;

  return (
    <Page width="wide">
      <PageHeader
        above={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{levelLabel(depth)}</Badge>
            <TopicBreadcrumb topicId={topic.parentId} />
          </div>
        }
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
            <Link
              to={`/topics/${topic.id}/map`}
              title="Mapa mental gerado a partir deste assunto"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Network className="size-4" aria-hidden /> <span className="hidden sm:inline">Mapa</span>
            </Link>
            <Link
              to={`/review?topics=${topic.id}`}
              title="Revisar este assunto e os subassuntos (cartões e perguntas)"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Brain className="size-4" aria-hidden /> <span className="hidden sm:inline">Revisar</span>
            </Link>
            <Link
              to={`/graph?focus=topic:${topic.id}`}
              title="Conexões deste assunto no grafo"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Waypoints className="size-4" aria-hidden /> <span className="hidden sm:inline">Grafo</span>
            </Link>
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <Section title={`${depth === 0 ? 'Matérias' : 'Subassuntos'}${children.length ? ` (${children.length})` : ''}`}>
            {children.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {children.map((c) => (
                  <Link key={c.id} to={`/topics/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-border-strong">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--border-strong)' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.title}</span>
                      <span className="block text-xs text-muted">
                        {plural(c.noteCount, 'nota', 'notas')} · {plural(c.readingCount, 'livro', 'livros')}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <InlineTopicCreate parentId={topic.id} label={depth === 0 ? 'Nova matéria' : 'Novo subassunto'} />
          </Section>

          <Section
            title={`Notas${notes.data ? ` (${notes.data.data.length})` : ''}`}
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => createNote.mutate(topic.id)}>
                Nota
              </Button>
            }
          >
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
                description="Nas notas, digite / para citar outros assuntos, livros e páginas, e # para marcar com tags."
                action={<Button size="sm" variant="outline" onClick={() => createNote.mutate(topic.id)}>Escrever a primeira</Button>}
              />
            )}
          </Section>

          <Section title="Canvas">
            <CanvasList topicId={topic.id} title={topic.title} />
          </Section>

          <Books context={context.data} onNew={() => setDialog('book')} />
          <Annotations context={context.data} />

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
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start" aria-label="Conexões do assunto">
          <Card className="space-y-6 p-4">
            <div>
              <h3 className="mb-2 text-[13px] font-semibold text-muted">Mencionado em</h3>
              <BacklinkList items={context.data?.mentions} empty="Nenhuma nota cita este assunto ainda. Em uma nota, digite / e o nome dele." />
            </div>
            {!!context.data?.tags.length && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-muted">Tags usadas aqui</h3>
                <TagChips tags={context.data.tags.map((t) => t.tag)} />
              </div>
            )}
            <RelationsPanel type="topic" id={topic.id} title={topic.title} />
            <Concepts topicId={topic.id} />
            <StudyPanel topicId={topic.id} context={context.data} />
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
      <ReadingFormDialog
        open={dialog === 'book'}
        onOpenChange={(o) => !o && setDialog(null)}
        defaults={{ topicId: topic.id, materialType: 'book' }}
        onSaved={(r) => void navigate(`/readings/${r.id}`)}
      />
    </Page>
  );
}
