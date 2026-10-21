import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  Check,
  CloudOff,
  BookOpen,
  Copy,
  Ellipsis,
  FileClock,
  FolderInput,
  Info,
  LayoutDashboard,
  PanelRightClose,
  RefreshCw,
  Trash,
  TriangleAlert,
} from 'lucide-react';
import { ANNOTATION_TYPE_LABELS, analyzeDoc, uuidv7, type Note, type NoteRevisionSummary, type RichTextDoc } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/ui/feedback';
import { Field } from '@/components/ui/form';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { dateTime, plural, relativeTime } from '@/lib/format';
import { useLocalPreference } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { notesSync, type NoteDraft, type SaveState } from '@/lib/sync/notes-sync';
import { CanvasList, useCreateCanvas } from '../canvas/use-canvases';
import { DailyNav } from '../daily/daily-nav';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { TopicSelect } from '../topics/topic-dialogs';
import { useWideView } from '../workspace/tab-info';
import { headingSlug } from './editor/reference-node';
import { BacklinkList, TagChips } from './backlink-list';
import { ReadOnlyDoc } from './read-only-doc';
import { NoteEditor, useSaveState, type NoteEditorHandle } from './editor/note-editor';
import { justCreatedNotes } from './use-create-note';

const STATUS: Record<SaveState, { label: string; icon: React.ReactNode; tone: string }> = {
  saved: { label: 'Salvo', icon: <Check className="size-3.5" />, tone: 'text-muted' },
  saving: { label: 'Salvando…', icon: <RefreshCw className="size-3.5 animate-spin" />, tone: 'text-muted' },
  pending: { label: 'Alterações locais', icon: <RefreshCw className="size-3.5" />, tone: 'text-muted' },
  offline: { label: 'Offline — salvo neste aparelho', icon: <CloudOff className="size-3.5" />, tone: 'text-warning' },
  conflict: { label: 'Conflito de versão', icon: <TriangleAlert className="size-3.5" />, tone: 'text-danger' },
  error: { label: 'Erro ao salvar', icon: <TriangleAlert className="size-3.5" />, tone: 'text-danger' },
};

function SaveStatus({ noteId }: { noteId: string }) {
  const state = useSaveState(noteId);
  const s = STATUS[state];
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', s.tone)} title={notesSync.error(noteId)}>
      {s.icon}
      <span className="hidden sm:inline">{s.label}</span>
    </span>
  );
}

function RevisionsDialog({
  noteId,
  open,
  onOpenChange,
  onRestore,
}: {
  noteId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRestore: (title: string, content: RichTextDoc) => void;
}) {
  const [selected, setSelected] = useState<NoteRevisionSummary | null>(null);
  const list = useQuery({ queryKey: qk.revisions(noteId), queryFn: () => endpoints.notes.revisions(noteId), enabled: open });
  const rev = useQuery({
    queryKey: ['revision', noteId, selected?.id],
    queryFn: () => endpoints.notes.revision(noteId, selected!.id),
    enabled: open && !!selected,
  });
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Histórico de versões"
      description="O MyNotes guarda uma versão anterior a cada 10 minutos de edição (até 50)."
      size="xl"
      footer={
        selected && rev.data ? (
          <Button
            variant="primary"
            onClick={() => {
              onRestore(rev.data.title, rev.data.content);
              onOpenChange(false);
            }}
          >
            Restaurar esta versão
          </Button>
        ) : undefined
      }
    >
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <EmptyState icon={<FileClock />} title="Ainda não há versões anteriores" description="Elas aparecem conforme a nota é editada ao longo do tempo." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="space-y-1 md:max-h-[60vh] md:overflow-y-auto">
            {list.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className={cn(
                    'w-full rounded-lg px-3 py-2 text-left text-sm',
                    selected?.id === r.id ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="block font-medium">{dateTime(r.createdAt)}</span>
                  <span className="block text-xs text-muted">{plural(r.wordCount, 'palavra', 'palavras')}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-48 rounded-xl border border-border p-4 md:max-h-[60vh] md:overflow-y-auto">
            {!selected ? (
              <p className="text-sm text-muted">Escolha uma versão para visualizar.</p>
            ) : rev.isLoading ? (
              <Spinner />
            ) : rev.data ? (
              <>
                <h3 className="mb-3 text-xl font-semibold">{rev.data.title || 'Sem título'}</h3>
                <ReadOnlyDoc key={rev.data.id} content={rev.data.content} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ConflictBanner({
  server,
  onKeepMine,
  onUseServer,
  onCopy,
  busy,
}: {
  server: Note;
  onKeepMine: () => void;
  onUseServer: () => void;
  onCopy: () => void;
  busy: boolean;
}) {
  return (
    <div role="alert" className="mx-auto mt-4 max-w-[46rem] rounded-xl border border-danger/40 bg-danger-soft p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <TriangleAlert className="size-4" aria-hidden /> Esta nota foi alterada em outro dispositivo
      </p>
      <p className="mt-1 text-text">
        A versão do servidor foi salva {relativeTime(server.updatedAt)}. Suas alterações estão guardadas neste aparelho. Escolha o que manter:
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onKeepMine} disabled={busy}>
          Manter a minha versão
        </Button>
        <Button size="sm" variant="outline" onClick={onUseServer} disabled={busy}>
          Usar a do servidor
        </Button>
        <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={onCopy} disabled={busy}>
          Salvar a minha como nova nota
        </Button>
      </div>
    </div>
  );
}

export { BacklinkList, TagChips, backlinkLabel } from './backlink-list';

function NoteInfo({ note }: { note: Note }) {
  const back = useQuery({ queryKey: qk.backlinks('note', note.id), queryFn: () => endpoints.notes.backlinks('note', note.id) });
  const tags = useMemo(() => analyzeDoc(structuredClone(note.content)).tags, [note.content]);
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-subtle">Criada</dt>
          <dd className="mt-0.5">{dateTime(note.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Atualizada</dt>
          <dd className="mt-0.5">{dateTime(note.updatedAt)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Palavras</dt>
          <dd className="mt-0.5 tabular-nums">{note.wordCount}</dd>
        </div>
        <div>
          <dt className="text-subtle">Versão</dt>
          <dd className="mt-0.5 tabular-nums">{note.version}</dd>
        </div>
      </dl>
      {tags.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">Tags</h3>
          <TagChips tags={tags} />
        </div>
      )}
      <RelationsPanel type="note" id={note.id} title={note.title} />
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">Canvas desta nota</h3>
        <CanvasList noteId={note.id} title={note.title} compact />
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">Mencionada em</h3>
        <BacklinkList items={back.data} empty="Nenhuma outra nota cita esta. Em outra nota, digite / e o título desta." />
      </div>
    </div>
  );
}

/** Header of a book review or page annotation: the book it belongs to. */
function BookContext({ note }: { note: Note }) {
  const book = useQuery({ queryKey: qk.reading(note.readingId!), queryFn: () => endpoints.readings.get(note.readingId!) });
  const title = book.data?.title ?? '…';
  return (
    <Link
      to={referencePath({ type: 'note', id: note.id, role: note.role, readingId: note.readingId, page: note.page })}
      className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted hover:text-accent"
    >
      <BookOpen className="size-3.5 shrink-0 text-reading" aria-hidden />
      <span className="truncate">
        {note.role === 'review' ? `Resenha de ${title}` : `Anotação de ${title}${note.page ? `, p. ${note.page}` : ''}`}
        {note.annotationType ? ` · ${ANNOTATION_TYPE_LABELS[note.annotationType]}` : ''}
      </span>
    </Link>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editorRef = useRef<NoteEditorHandle>(null);
  const wideScreen = useWideView(1024);
  const [panelPref, setPanelPref] = useLocalPreference('mynotes:note-panel', true);
  const [panelSheet, setPanelSheet] = useState(false);
  const [dialog, setDialog] = useState<'move' | 'history' | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [initialState, setInitial] = useState<{ id: string; title: string; content: RichTextDoc; restored: boolean } | null>(null);
  // Only the content decided for this note: right after moving to another note, the previous one's must never reach its editor.
  const initial = initialState?.id === id ? initialState : null;
  const [conflict, setConflict] = useState<Note | null>(null);
  const saveState = useSaveState(id);
  const createCanvas = useCreateCanvas();

  const noteQuery = useQuery({ queryKey: qk.note(id), queryFn: ({ signal }) => endpoints.notes.get(id, signal), staleTime: 0 });
  const note = noteQuery.data;
  useRecordView('note', id, noteQuery.isSuccess);

  // Decide the initial editor content once: server copy, or an unsent local draft.
  useEffect(() => {
    setInitial(null);
    setConflict(null);
  }, [id]);
  // Only start from a copy fetched now (the persisted cache may be outdated),
  // except when offline, where the cached copy is the best available, or
  // right after creating the note, when the cache holds the server response.
  const justCreated = justCreatedNotes.has(id) && note?.version === 1;
  const fresh = noteQuery.isFetchedAfterMount || justCreated || (!!note && (noteQuery.isError || !navigator.onLine));
  useEffect(() => {
    if (!note || initial || !fresh) return;
    let cancelled = false;
    void notesSync.getDraft(id).then(async (draft: NoteDraft | undefined) => {
      if (cancelled) return;
      justCreatedNotes.delete(id);
      if (!draft) {
        setInitial({ id, title: note.title, content: note.content, restored: false });
        return;
      }
      setInitial({ id, title: draft.title, content: draft.content, restored: true });
      if (draft.status === 'conflict' && draft.server) {
        setConflict(draft.server);
      } else if (draft.baseVersion < note.version) {
        await notesSync.markConflict(id, note);
        setConflict(note);
      } else {
        toast.info('Alterações locais restauradas', { description: 'Elas estão sendo enviadas ao servidor.' });
        void notesSync.save(id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [note, id, initial, fresh]);

  // A conflict detected while editing: fetch the server copy saved with the draft.
  useEffect(() => {
    if (saveState !== 'conflict') return;
    void notesSync.getDraft(id).then((d) => d?.server && setConflict(d.server));
  }, [saveState, id]);

  // "/notes/<id>#secao" (a reference to a heading) scrolls to that heading once the text is shown.
  useEffect(() => {
    const slug = decodeURIComponent(location.hash.slice(1));
    if (!slug || !initial) return;
    const t = setTimeout(() => {
      const dom = editorRef.current?.editor?.view.dom;
      const heading = [...(dom?.querySelectorAll('h1, h2, h3') ?? [])].find((h) => headingSlug(h.textContent ?? '') === slug);
      heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [location.hash, initial]);

  const getBaseVersion = useCallback(() => qc.getQueryData<Note>(qk.note(id))?.version ?? note?.version ?? 1, [qc, id, note?.version]);

  const resolve = useMutation({
    mutationFn: async (choice: 'mine' | 'server' | 'copy') => {
      await editorRef.current?.flush();
      if (!conflict) return;
      if (choice === 'copy') {
        const mine = editorRef.current?.getSnapshot();
        const copy = await endpoints.notes.create({
          id: uuidv7(),
          topicId: conflict.topicId,
          title: `${mine?.title || 'Sem título'} (cópia)`,
          content: mine?.content,
        });
        toast.success('Sua versão foi salva como nova nota', {
          action: { label: 'Abrir', onClick: () => void navigate(`/notes/${copy.id}`) },
        });
      }
      if (choice === 'mine') {
        await notesSync.resolve(id, 'mine');
      } else {
        await notesSync.resolve(id, 'server');
        editorRef.current?.reset(conflict.title, conflict.content);
        qc.setQueryData(qk.note(id), conflict);
      }
    },
    onSuccess: () => {
      setConflict(null);
      void qc.invalidateQueries({ queryKey: qk.note(id) });
      void qc.invalidateQueries({ queryKey: qk.notesAll });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const move = useMutation({
    mutationFn: async () => {
      await editorRef.current?.flush();
      const version = getBaseVersion();
      return endpoints.notes.move(id, { baseVersion: version, topicId: moveTo });
    },
    onSuccess: (summary) => {
      qc.setQueryData<Note>(qk.note(id), (prev) => (prev ? { ...prev, ...summary } : prev));
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
      setDialog(null);
      toast.success('Nota movida');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = async () => {
    if (
      !(await confirm({
        title: 'Excluir esta nota?',
        description: 'Ela vai para a lixeira e pode ser restaurada depois.',
        confirmLabel: 'Enviar para a lixeira',
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await endpoints.notes.remove(id);
      await notesSync.discard(id);
      qc.removeQueries({ queryKey: qk.note(id) });
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success('Nota enviada para a lixeira');
      void navigate(note?.topicId ? `/topics/${note.topicId}` : '/notes');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (noteQuery.isLoading) return <PageLoader />;
  if (!note) {
    if (noteQuery.error instanceof ApiError && noteQuery.error.status === 404) {
      return (
        <EmptyState
          className="mt-16"
          title="Nota não encontrada"
          description="Ela pode ter sido excluída em outro dispositivo."
          action={<Link to="/notes" className="text-accent">Ver notas</Link>}
        />
      );
    }
    return <ErrorState error={noteQuery.error} onRetry={() => void noteQuery.refetch()} />;
  }

  const panelOpen = wideScreen && panelPref;
  const info = <NoteInfo note={note} />;

  return (
    <div className="flex min-h-full">
      <div className="min-w-0 flex-1 px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            {note.role !== 'note' && note.readingId ? (
              <BookContext note={note} />
            ) : note.topicId ? (
              <TopicBreadcrumb topicId={note.topicId} />
            ) : (
              <span className="text-[13px] text-subtle">Sem assunto</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <SaveStatus noteId={id} />
            <FavoriteButton type="note" id={id} />
            <IconButton
              label={panelOpen ? 'Ocultar detalhes' : 'Detalhes, relações e menções'}
              active={panelOpen}
              onClick={() => (wideScreen ? setPanelPref(!panelPref) : setPanelSheet(true))}
            >
              {panelOpen ? <PanelRightClose className="size-4" /> : <Info className="size-4" />}
            </IconButton>
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                {
                  label: 'Mover para assunto…',
                  icon: <FolderInput />,
                  onSelect: () => {
                    setMoveTo(note.topicId);
                    setDialog('move');
                  },
                },
                { label: 'Histórico de versões', icon: <FileClock />, onSelect: () => setDialog('history') },
                {
                  label: 'Novo canvas desta nota',
                  icon: <LayoutDashboard />,
                  onSelect: () =>
                    createCanvas.mutate({ title: `Canvas — ${note.title || 'Sem título'}`, noteId: id, topicId: note.topicId, first: { type: 'note', id, title: note.title } }),
                },
                'separator',
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
          </div>
        </div>

        <DailyNav note={note} />

        {conflict && (
          <ConflictBanner
            server={conflict}
            busy={resolve.isPending}
            onKeepMine={() => resolve.mutate('mine')}
            onUseServer={() => resolve.mutate('server')}
            onCopy={() => resolve.mutate('copy')}
          />
        )}
        {saveState === 'error' && notesSync.error(id) && (
          <p role="alert" className="mx-auto mt-4 max-w-[46rem] rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {notesSync.error(id)}
          </p>
        )}

        {initial ? (
          <NoteEditor
            key={id}
            ref={editorRef}
            noteId={id}
            initialTitle={initial.title}
            initialContent={initial.content}
            getBaseVersion={getBaseVersion}
            autoFocusTitle={!!(location.state as { focusTitle?: boolean } | null)?.focusTitle}
            topicId={note.topicId}
          />
        ) : (
          <PageLoader />
        )}
      </div>

      {panelOpen && (
        <aside className="scrollbar-thin sticky top-0 h-(--view-h) w-80 shrink-0 overflow-y-auto border-l border-border p-5" aria-label="Detalhes da nota">
          {info}
        </aside>
      )}
      <Dialog open={panelSheet} onOpenChange={setPanelSheet} title="Detalhes da nota">
        {info}
      </Dialog>

      <Dialog
        open={dialog === 'move'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Mover nota"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={move.isPending} onClick={() => move.mutate()}>
              Mover
            </Button>
          </>
        }
      >
        <Field label="Assunto">
          {(p) => <TopicSelect {...p} value={moveTo} onChange={setMoveTo} emptyLabel="Sem assunto" />}
        </Field>
      </Dialog>
      <RevisionsDialog
        noteId={id}
        open={dialog === 'history'}
        onOpenChange={(o) => !o && setDialog(null)}
        onRestore={(title, content) => {
          void editorRef.current?.apply(title, content);
          toast.success('Versão restaurada', { description: 'A versão atual continua disponível no histórico.' });
        }}
      />
    </div>
  );
}
