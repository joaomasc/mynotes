import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BookOpen, Ellipsis, ExternalLink, FileText, ListChecks, Paperclip, Pencil, Plus, Quote, Trash, Upload } from 'lucide-react';
import {
  ANNOTATION_TYPES,
  ANNOTATION_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  READING_STATUS_LABELS,
  uuidv7,
  type AnnotationType,
  type DocumentMeta,
  type Note,
  type NoteSummary,
  type Reading,
  type RichTextDoc,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, PageLoader, Progress, Spinner } from '@/components/ui/feedback';
import { Segmented, Select, Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { fetchWithProgress } from '@/lib/download';
import { longDate, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { uploadNewDocument, validateFile } from '@/lib/uploads';
import { DownloadProgress, PdfViewer, type PdfSelection } from '../documents/pdf-viewer';
import type { NoteEditorHandle } from '../notes/editor/note-editor';
import { EmbeddedNote } from '../notes/embedded-note';
import { BacklinkList } from '../notes/note-page';
import { justCreatedNotes } from '../notes/use-create-note';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb, TopicChip } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { ProgressDialog, ReadingFormDialog, invalidateReadings, readingPercent } from './reading-dialogs';

type Tab = 'annotations' | 'review' | 'about';

/** Optional outline for a page annotation (only offered while it is empty). */
const ANNOTATION_OUTLINE: RichTextDoc = {
  type: 'doc',
  content: ['Argumento', 'O que entendi', 'Interpretação', 'Crítica ou dúvida'].flatMap((h) => [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: h }] },
    { type: 'paragraph' },
  ]),
};

/* ------------------------------------------------------------ reader -- */

function Reader({
  doc,
  reading,
  goto,
  markers,
  onPage,
  onSelection,
}: {
  doc: DocumentMeta;
  reading: Reading;
  goto: { page: number; seq: number } | null;
  markers: Map<number, number>;
  onPage: (page: number, total: number) => void;
  onSelection: (s: PdfSelection | null) => void;
}) {
  const [fraction, setFraction] = useState<number | null>(null);
  const file = useQuery({
    queryKey: ['document-file', doc.id, doc.version],
    queryFn: ({ signal }) => fetchWithProgress(endpoints.documents.contentPath(doc.id), setFraction, signal),
    enabled: doc.status === 'ready',
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  // The page where the reading stopped is read once, when the file opens.
  const [initialPage] = useState(reading.currentPage);
  if (doc.status !== 'ready') {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        O arquivo deste livro ainda não foi enviado. <Link to={`/library/${doc.id}`} className="text-accent">Enviar o arquivo</Link>
      </p>
    );
  }
  if (file.isLoading) return <DownloadProgress fraction={fraction} />;
  if (file.isError || !file.data) return <ErrorState error={file.error} onRetry={() => void file.refetch()} />;
  return (
    <PdfViewer
      data={file.data}
      className="h-[62dvh] overflow-hidden rounded-xl border border-border lg:h-[calc(100dvh-9rem)]"
      initialPage={initialPage}
      goto={goto}
      onPageChange={onPage}
      markers={markers}
      onSelection={onSelection}
    />
  );
}

/** Links a PDF to a book that has none: an existing library PDF or a new upload. */
function AttachPdf({ reading }: { reading: Reading }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pdfs = useQuery({ queryKey: qk.documents({ type: 'pdf', picker: true }), queryFn: () => endpoints.documents.list({ type: 'pdf', limit: 200 }) });
  const link = useMutation({
    mutationFn: (documentId: string) => endpoints.readings.update(reading.id, { baseVersion: reading.version, documentId }),
    onSuccess: (r) => {
      qc.setQueryData(qk.reading(r.id), r);
      invalidateReadings(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const upload = async (file: File) => {
    const check = validateFile(file);
    if ('error' in check || check.mime !== 'application/pdf') {
      toast.error('error' in check ? check.error : 'Escolha um arquivo PDF.');
      return;
    }
    setProgress(0);
    try {
      const doc = await uploadNewDocument(file, reading.topicId, setProgress);
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
      link.mutate(doc.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted" aria-hidden /> Leia o PDF aqui mesmo
      </p>
      <p className="text-sm text-muted">Anexe o arquivo para ler, marcar a página atual e anotar trechos sem sair do livro.</p>
      {progress !== null ? (
        <Progress value={progress * 100} label="Enviando" />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()} loading={link.isPending}>
            Enviar PDF
          </Button>
          {!!pdfs.data?.data.length && (
            <div className="min-w-48 flex-1">
              <Select aria-label="Usar um PDF da biblioteca" value="" onChange={(e) => e.target.value && link.mutate(e.target.value)}>
                <option value="">Ou escolha da biblioteca…</option>
                {pdfs.data.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
    </Card>
  );
}

/* ------------------------------------------------------- annotations -- */

function AnnotationEditor({
  note,
  onJump,
  onDeleted,
}: {
  note: NoteSummary;
  onJump: (page: number) => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editor = useRef<NoteEditorHandle>(null);
  const [quote, setQuote] = useState(note.quote);
  const [page, setPage] = useState(note.page ? String(note.page) : '');
  const full = qc.getQueryData<Note>(qk.note(note.id));
  const empty = !full || (full.content.content.length === 0 && !full.title);

  /** Page, type and passage are saved with the note's version, after pending text. */
  const meta = useMutation({
    mutationFn: async (patch: { page?: number | null; annotationType?: AnnotationType | null; quote?: string }) => {
      await editor.current?.flush();
      const baseVersion = qc.getQueryData<Note>(qk.note(note.id))?.version ?? note.version;
      return endpoints.notes.update(note.id, { baseVersion, ...patch });
    },
    onSuccess: (summary) => {
      qc.setQueryData<Note>(qk.note(note.id), (prev) => (prev ? { ...prev, ...summary } : prev));
      void qc.invalidateQueries({ queryKey: qk.notesAll });
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: qk.note(note.id) });
      toast.error(isVersionConflict(err) ? 'A anotação mudou em outro dispositivo. Tente de novo.' : errorMessage(err));
    },
  });
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir esta anotação?', description: 'Ela vai para a lixeira.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.notes.remove(note.id);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1 text-xs text-muted">
          p.
          <input
            value={page}
            inputMode="numeric"
            aria-label="Página da anotação"
            onChange={(e) => setPage(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onBlur={() => {
              const n = page ? Number(page) : null;
              if (n !== note.page) meta.mutate({ page: n });
            }}
            className="h-7 w-14 rounded-md border border-border bg-bg px-1.5 text-center text-sm text-text outline-none focus:border-accent"
          />
        </label>
        <div role="group" aria-label="Tipo (opcional)" className="flex flex-wrap gap-1">
          {ANNOTATION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={note.annotationType === t}
              onClick={() => meta.mutate({ annotationType: note.annotationType === t ? null : t })}
              className={cn(
                'h-7 rounded-full border px-2 text-xs',
                note.annotationType === t ? 'border-reading bg-reading/10 font-medium text-reading' : 'border-border text-muted hover:text-text',
              )}
            >
              {ANNOTATION_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <Textarea
        rows={quote ? 2 : 1}
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        onBlur={() => quote.trim() !== note.quote && meta.mutate({ quote: quote.trim() })}
        placeholder="Trecho citado (opcional)"
        aria-label="Trecho citado"
        className="text-sm italic"
      />
      <EmbeddedNote ref={editor} noteId={note.id} autoFocus={justCreatedNotes.has(note.id)} placeholder="O que esta página diz? O que você entendeu, interpreta ou questiona? Use / e #." />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {empty && (
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => void editor.current?.apply('', ANNOTATION_OUTLINE)}>
            <ListChecks className="mr-1 inline size-3.5" aria-hidden />
            Usar roteiro (argumento, entendimento, interpretação, crítica)
          </button>
        )}
        {note.page && (
          <button type="button" className="text-muted hover:text-accent" onClick={() => onJump(note.page!)}>
            Ir para a página
          </button>
        )}
        <Link to={`/notes/${note.id}`} className="text-muted hover:text-accent">
          Abrir como nota
        </Link>
        <button type="button" className="ml-auto text-danger hover:underline" onClick={() => void remove()}>
          Excluir
        </button>
      </div>
    </div>
  );
}

function AnnotationsPanel({
  reading,
  annotations,
  loading,
  page,
  selection,
  activeId,
  setActiveId,
  onJump,
  hasPdf,
}: {
  reading: Reading;
  annotations: NoteSummary[];
  loading: boolean;
  page: number | null;
  selection: PdfSelection | null;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  onJump: (page: number) => void;
  hasPdf: boolean;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'page'>('all');
  const [manualPage, setManualPage] = useState(page ? String(page) : '');
  useEffect(() => {
    if (page) setManualPage(String(page));
  }, [page]);
  const targetPage = hasPdf ? page : manualPage ? Number(manualPage) : null;

  const create = useMutation({
    mutationFn: (input: { page: number | null; quote: string }) =>
      endpoints.notes.create({ id: uuidv7(), role: 'annotation', readingId: reading.id, page: input.page, quote: input.quote, title: '' }),
    onSuccess: (note) => {
      qc.setQueryData(qk.note(note.id), note);
      justCreatedNotes.add(note.id);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      setFilter('all');
      setActiveId(note.id);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const visible = filter === 'page' && targetPage ? annotations.filter((a) => a.page === targetPage) : annotations;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!hasPdf && (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            Página
            <input
              value={manualPage}
              inputMode="numeric"
              aria-label="Página para anotar"
              onChange={(e) => setManualPage(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-center text-text outline-none focus:border-accent"
            />
          </label>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={selection ? <Quote className="size-3.5" /> : <Plus className="size-3.5" />}
          loading={create.isPending}
          onClick={(e) => {
            // Keys typed before the new editor takes focus must not press this button again.
            e.currentTarget.blur();
            create.mutate({ page: selection?.page ?? targetPage ?? null, quote: selection?.text ?? '' });
          }}
        >
          {selection ? `Anotar trecho da p. ${selection.page}` : targetPage ? `Anotar a p. ${targetPage}` : 'Nova anotação'}
        </Button>
        {annotations.length > 0 && targetPage && (
          <Segmented
            label="Mostrar"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Todas (${annotations.length})` },
              { value: 'page', label: `p. ${targetPage}` },
            ]}
          />
        )}
      </div>
      {selection && <p className="line-clamp-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted italic">“{selection.text}”</p>}

      {loading ? (
        <Spinner className="mx-auto my-6 size-5" />
      ) : visible.length === 0 ? (
        <EmptyState
          className="rounded-xl border border-dashed border-border py-8"
          icon={<BookOpen />}
          title={filter === 'page' ? 'Nada anotado nesta página' : 'Nenhuma anotação ainda'}
          description="Registre o argumento, o que você entendeu, sua interpretação e suas críticas, página a página. Selecione um trecho do PDF para citá-lo."
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((a) => {
            const open = a.id === activeId;
            return (
              <li key={a.id} className={cn('rounded-xl border bg-surface', open ? 'border-reading/60 p-3' : 'border-border')}>
                {open ? (
                  <AnnotationEditor note={a} onJump={onJump} onDeleted={() => setActiveId(null)} />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(a.id);
                      if (a.page) onJump(a.page);
                    }}
                    className="block w-full px-3 py-2.5 text-left hover:bg-surface-2/60"
                  >
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-reading">{a.page ? `p. ${a.page}` : 'sem página'}</span>
                      {a.annotationType && <Badge>{ANNOTATION_TYPE_LABELS[a.annotationType]}</Badge>}
                      <span className="ml-auto">{relativeTime(a.updatedAt)}</span>
                    </span>
                    {a.quote && <span className="mt-1 line-clamp-1 block text-sm text-muted italic">“{a.quote}”</span>}
                    <span className={cn('mt-0.5 line-clamp-2 block text-sm', !(a.title || a.excerpt) && 'text-subtle italic')}>
                      {a.title || a.excerpt || 'Sem texto'}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ review -- */

function ReviewPanel({ reading }: { reading: Reading }) {
  const qc = useQueryClient();
  const review = useQuery({
    queryKey: qk.notes({ readingId: reading.id, role: 'review' }),
    queryFn: () => endpoints.notes.list({ readingId: reading.id, role: 'review', limit: 1 }),
  });
  const create = useMutation({
    mutationFn: () => endpoints.notes.create({ id: uuidv7(), role: 'review', readingId: reading.id, title: '' }),
    onSuccess: (note) => {
      qc.setQueryData(qk.note(note.id), note);
      justCreatedNotes.add(note.id);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const id = review.data?.data[0]?.id ?? create.data?.id;
  if (review.isLoading) return <Spinner className="mx-auto my-6 size-5" />;
  if (!id) {
    return (
      <EmptyState
        className="rounded-xl border border-dashed border-border py-8"
        icon={<Pencil />}
        title="Minha resenha"
        description="Sua síntese do livro: principais argumentos, contribuições, limitações e avaliação final. Independente das anotações por página."
        action={
          <Button variant="primary" size="sm" loading={create.isPending} onClick={() => create.mutate()}>
            Escrever minha resenha
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <h2 className="mb-1 text-[13px] font-semibold text-muted">Minha resenha</h2>
      <EmbeddedNote
        noteId={id}
        hideTitle
        autoFocus={justCreatedNotes.has(id)}
        placeholder="Principais argumentos, contribuições, limitações e sua avaliação final. Use / para citar assuntos e páginas."
      />
      <Link to={`/notes/${id}`} className="mt-2 inline-flex text-xs text-muted hover:text-accent">
        Abrir em tela cheia
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------- about -- */

function AboutPanel({ reading, doc }: { reading: Reading; doc: DocumentMeta | undefined }) {
  const back = useQuery({ queryKey: qk.backlinks('reading', reading.id), queryFn: () => endpoints.notes.backlinks('reading', reading.id) });
  const facts: [string, string | null][] = [
    ['Tipo', MATERIAL_TYPE_LABELS[reading.materialType]],
    ['Status', READING_STATUS_LABELS[reading.status]],
    ['Páginas', reading.totalPages ? String(reading.totalPages) : null],
    ['Início', reading.startedOn ? longDate(reading.startedOn) : null],
    ['Conclusão', reading.completedOn ? longDate(reading.completedOn) : null],
    ['Prazo', reading.dueOn ? longDate(reading.dueOn) : null],
    ['Prioridade', reading.priority ? PRIORITY_LABELS[reading.priority]! : null],
  ];
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-subtle">{k}</dt>
              <dd className="mt-0.5 text-sm">{v}</dd>
            </div>
          ))}
      </dl>
      {reading.topicId && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-muted">Assunto principal</h3>
          <TopicChip topicId={reading.topicId} />
        </div>
      )}
      <RelationsPanel type="reading" id={reading.id} title={reading.title} />
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">Citado em</h3>
        <BacklinkList items={back.data} empty="Nenhuma nota cita este livro ainda. Em uma nota, digite /livro." />
      </div>
      {reading.notes && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-muted">Observações</h3>
          <p className="text-sm whitespace-pre-wrap">{reading.notes}</p>
        </div>
      )}
      {doc && (
        <Link to={`/library/${doc.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent">
          <FileText className="size-4 text-document" aria-hidden /> {doc.title} <ExternalLink className="size-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- page -- */

export function Component() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<'edit' | 'progress' | null>(null);
  const [tab, setTab] = useState<Tab>(params.get('section') === 'review' ? 'review' : params.get('section') === 'about' ? 'about' : 'annotations');
  const [activeId, setActiveId] = useState<string | null>(params.get('annotation'));
  const [goto, setGoto] = useState<{ page: number; seq: number } | null>(() =>
    params.get('page') ? { page: Number(params.get('page')), seq: 0 } : null,
  );
  const [viewerPage, setViewerPage] = useState<number | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);

  const query = useQuery({ queryKey: qk.reading(id), queryFn: () => endpoints.readings.get(id) });
  const r = query.data;
  const doc = useQuery({
    queryKey: qk.document(r?.documentId ?? ''),
    queryFn: () => endpoints.documents.get(r!.documentId!),
    enabled: !!r?.documentId,
  });
  const annotations = useQuery({
    queryKey: qk.notes({ readingId: id, role: 'annotation' }),
    queryFn: () => endpoints.notes.list({ readingId: id, role: 'annotation', sort: 'created', limit: 200 }),
    enabled: !!r,
  });
  useRecordView('reading', id, query.isSuccess);

  // Links like ?page=125&annotation=… (from references) open the right place.
  useEffect(() => {
    const page = params.get('page');
    const annotation = params.get('annotation');
    if (!page && !annotation && !params.get('section')) return;
    if (page) setGoto({ page: Number(page), seq: Date.now() });
    if (annotation) {
      setActiveId(annotation);
      setTab('annotations');
    }
    if (params.get('section') === 'review') setTab('review');
    setParams({}, { replace: true });
  }, [params, setParams]);

  const sorted = useMemo(
    () => [...(annotations.data?.data ?? [])].sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || a.createdAt.localeCompare(b.createdAt)),
    [annotations.data],
  );
  const markers = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of sorted) if (a.page) m.set(a.page, (m.get(a.page) ?? 0) + 1);
    return m;
  }, [sorted]);

  // Remember the page being read (the last page shown for a few seconds).
  const saving = useRef(false);
  const savePage = useCallback(
    async (page: number, total: number) => {
      const current = qc.getQueryData<Reading>(qk.reading(id));
      if (!current || saving.current || current.status === 'completed' || current.currentPage === page) return;
      saving.current = true;
      try {
        const totalPages = current.totalPages ?? total;
        const updated = await endpoints.readings.update(id, {
          baseVersion: current.version,
          currentPage: Math.min(page, totalPages),
          ...(current.totalPages ? {} : { totalPages }),
          ...(current.status === 'not_started' && page > 1 ? { status: 'in_progress' as const } : {}),
        });
        qc.setQueryData(qk.reading(id), updated);
        void qc.invalidateQueries({ queryKey: qk.readingsAll });
      } catch (err) {
        if (isVersionConflict(err)) void query.refetch();
      } finally {
        saving.current = false;
      }
    },
    [qc, id, query],
  );
  const pageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onPage = useCallback(
    (page: number, total: number) => {
      setViewerPage(page);
      clearTimeout(pageTimer.current);
      pageTimer.current = setTimeout(() => void savePage(page, total), 2500);
    },
    [savePage],
  );
  useEffect(() => () => clearTimeout(pageTimer.current), []);

  if (query.isLoading) return <PageLoader />;
  if (!r) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState className="mt-16" title="Livro não encontrado" action={<Link to="/library" className="text-accent">Ir para a biblioteca</Link>} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const remove = async () => {
    if (
      !(await confirm({
        title: 'Excluir este livro?',
        description: 'A resenha e as anotações continuam disponíveis como notas. O PDF continua na biblioteca.',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await endpoints.readings.remove(id);
      invalidateReadings(qc);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      toast.success('Livro excluído');
      void navigate('/library');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const hasPdf = !!doc.data && doc.data.mimeType === 'application/pdf';
  const pct = readingPercent(r);
  const jump = (page: number) => setGoto({ page, seq: Date.now() });

  const panel = (
    <div className="space-y-4">
      <Segmented
        label="Seção"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'annotations', label: `Anotações${sorted.length ? ` (${sorted.length})` : ''}` },
          { value: 'review', label: 'Minha resenha' },
          { value: 'about', label: 'Sobre' },
        ]}
      />
      {tab === 'annotations' && (
        <AnnotationsPanel
          reading={r}
          annotations={sorted}
          loading={annotations.isLoading}
          page={hasPdf ? viewerPage : r.currentPage}
          selection={selection}
          activeId={activeId}
          setActiveId={setActiveId}
          onJump={jump}
          hasPdf={hasPdf}
        />
      )}
      {tab === 'review' && <ReviewPanel reading={r} />}
      {tab === 'about' && <AboutPanel reading={r} doc={doc.data} />}
    </div>
  );

  return (
    <div className={cn('mx-auto w-full px-4 py-5 sm:px-6 lg:px-8', hasPdf ? 'max-w-none' : 'max-w-4xl')}>
      <header className="mb-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge>{MATERIAL_TYPE_LABELS[r.materialType]}</Badge>
          <TopicBreadcrumb topicId={r.topicId} />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-balance">{r.title}</h1>
            {r.author && <p className="mt-0.5 text-sm text-muted">{r.author}</p>}
          </div>
          <div className="flex items-center gap-2">
            <FavoriteButton type="reading" id={r.id} />
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                { label: 'Editar dados do livro', icon: <Pencil />, onSelect: () => setDialog('edit') },
                'separator',
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
            <Button variant="outline" onClick={() => setDialog('progress')}>
              Progresso
            </Button>
          </div>
        </div>
        <div className="mt-3 flex max-w-xl items-center gap-3">
          <Progress value={pct} className="h-2 flex-1" label="Progresso de leitura" />
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {r.currentPage ? `p. ${hasPdf && viewerPage ? viewerPage : r.currentPage}${r.totalPages ? ` de ${r.totalPages}` : ''} · ` : ''}
            {Math.round(pct)}%
          </span>
        </div>
      </header>

      {hasPdf && doc.data ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <Reader doc={doc.data} reading={r} goto={goto} markers={markers} onPage={onPage} onSelection={setSelection} />
          </div>
          <div className="min-w-0">{panel}</div>
        </div>
      ) : (
        <div className="space-y-5">
          {!r.documentId ? <AttachPdf reading={r} /> : doc.isLoading ? <Spinner /> : null}
          {panel}
        </div>
      )}

      <ReadingFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} reading={r} />
      <ProgressDialog reading={r} open={dialog === 'progress'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}
