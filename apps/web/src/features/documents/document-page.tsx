import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BookOpen, Download, Ellipsis, ExternalLink, Pencil, Trash, Upload } from 'lucide-react';
import { ALLOWED_FILE_TYPES, mimeFromFileName, type AllowedMimeType, type DocumentMeta } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, PageLoader, Progress } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { fetchWithProgress, openInNewTab, triggerDownload } from '@/lib/download';
import { dateTime, fileSize } from '@/lib/format';
import { qk } from '@/lib/query';
import { uploadContent } from '@/lib/uploads';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { TopicSelect } from '../topics/topic-dialogs';
import { docTypeLabel } from './doc-icon';
import { DocumentPdf, DownloadProgress } from './pdf-viewer';

function Preview({ doc }: { doc: DocumentMeta }) {
  const preview = ALLOWED_FILE_TYPES[doc.mimeType as AllowedMimeType]?.preview ?? null;
  const [fraction, setFraction] = useState<number | null>(null);
  const file = useQuery({
    queryKey: ['document-file', doc.id, doc.version],
    queryFn: ({ signal }) => fetchWithProgress(endpoints.documents.contentPath(doc.id), setFraction, signal),
    // PDFs are loaded by DocumentPdf (in ranges when large).
    enabled: doc.status === 'ready' && !!preview && preview !== 'pdf',
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const objectUrl = useMemo(
    () => (file.data && preview === 'image' ? URL.createObjectURL(new Blob([file.data], { type: doc.mimeType })) : null),
    [file.data, preview, doc.mimeType],
  );
  useEffect(() => () => void (objectUrl && URL.revokeObjectURL(objectUrl)), [objectUrl]);

  if (!preview) {
    return (
      <EmptyState
        className="rounded-xl border border-border bg-surface"
        title="Pré-visualização indisponível"
        description={`Arquivos ${docTypeLabel(doc.mimeType)} ainda não podem ser visualizados no MyNotes. Use “Baixar” ou “Abrir em nova aba”.`}
      />
    );
  }
  if (preview === 'pdf') return <DocumentPdf doc={doc} className="h-[calc(var(--view-h)-14rem)] min-h-[420px] overflow-hidden rounded-xl border border-border" />;
  if (file.isLoading) return <DownloadProgress fraction={fraction} />;
  if (file.isError || !file.data) return <ErrorState error={file.error} onRetry={() => void file.refetch()} />;
  if (preview === 'image') {
    return (
      <div className="flex justify-center rounded-xl border border-border bg-surface-2 p-4">
        <img src={objectUrl ?? ''} alt={doc.title} className="max-h-[75vh] max-w-full object-contain" />
      </div>
    );
  }
  return (
    <pre className="max-h-[75vh] overflow-auto rounded-xl border border-border bg-surface p-5 font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {new TextDecoder().decode(file.data)}
    </pre>
  );
}

function PendingUpload({ doc }: { doc: DocumentMeta }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const send = async (file: File) => {
    const mime = mimeFromFileName(file.name);
    if (!mime || mime !== doc.mimeType) {
      toast.error(`Escolha um arquivo do mesmo tipo (${docTypeLabel(doc.mimeType)}).`);
      return;
    }
    setProgress(0);
    try {
      await uploadContent(doc.id, file, mime, setProgress);
      toast.success('Arquivo enviado');
      void qc.invalidateQueries({ queryKey: qk.document(doc.id) });
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Badge tone="warning">{doc.status === 'failed' ? 'Falha no envio anterior' : 'Arquivo pendente'}</Badge>
      <p className="max-w-md text-sm text-muted">
        Os dados deste documento existem, mas o arquivo ({doc.originalName}, {fileSize(doc.sizeBytes)}) ainda não foi enviado — por
        exemplo, após restaurar um backup sem arquivos ou se o envio foi interrompido.
      </p>
      {progress !== null ? (
        <Progress value={progress * 100} className="max-w-60" label="Enviando" />
      ) : (
        <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>
          Enviar arquivo
        </Button>
      )}
      <input ref={input} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
    </Card>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', topicId: null as string | null });
  const query = useQuery({ queryKey: qk.document(id), queryFn: () => endpoints.documents.get(id) });
  const doc = query.data;
  useRecordView('document', id, query.isSuccess);

  const save = useMutation({
    mutationFn: () => endpoints.documents.update(id, { baseVersion: doc!.version, ...form }),
    onSuccess: (updated) => {
      qc.setQueryData(qk.document(id), updated);
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
      setEditing(false);
    },
    onError: (err) => {
      void query.refetch();
      toast.error(errorMessage(err));
    },
  });

  const link = async (download: boolean) => {
    try {
      if (download) triggerDownload((await endpoints.documents.link(id, true)).url);
      else await openInNewTab(async () => (await endpoints.documents.link(id, false)).url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este documento?', description: 'Ele vai para a lixeira; o arquivo só é apagado ao esvaziar a lixeira.', confirmLabel: 'Enviar para a lixeira', danger: true }))) return;
    try {
      await endpoints.documents.remove(id);
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
      toast.success('Documento enviado para a lixeira');
      void navigate('/library');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (query.isLoading) return <PageLoader />;
  if (!doc) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState className="mt-16" title="Documento não encontrado" action={<Link to="/library" className="text-accent">Ir para a biblioteca</Link>} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <Page width="wide">
      <PageHeader
        above={<TopicBreadcrumb topicId={doc.topicId} />}
        title={doc.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{docTypeLabel(doc.mimeType)}</span>·<span>{fileSize(doc.sizeBytes)}</span>
            {doc.uploadedAt && (
              <>
                ·<span>enviado em {dateTime(doc.uploadedAt)}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <FavoriteButton type="document" id={doc.id} />
            {doc.status === 'ready' && (
              <>
                <Button variant="outline" icon={<ExternalLink className="size-4" />} onClick={() => void link(false)} className="hidden sm:inline-flex">
                  Abrir em nova aba
                </Button>
                <Button variant="outline" icon={<Download className="size-4" />} onClick={() => void link(true)}>
                  Baixar
                </Button>
              </>
            )}
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                {
                  label: 'Editar informações',
                  icon: <Pencil />,
                  onSelect: () => {
                    setForm({ title: doc.title, description: doc.description, topicId: doc.topicId });
                    setEditing(true);
                  },
                },
                { label: 'Criar leitura deste documento', icon: <BookOpen />, onSelect: () => void navigate(`/readings?new=1&documentId=${doc.id}`) },
                ...(doc.status === 'ready' ? [{ label: 'Abrir em nova aba', icon: <ExternalLink />, onSelect: () => void link(false) }] : []),
                'separator',
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">{doc.status === 'ready' ? <Preview doc={doc} /> : <PendingUpload doc={doc} />}</div>
        <aside className="space-y-4">
          {doc.description && (
            <Card className="p-4">
              <h3 className="mb-1 text-[13px] font-semibold text-muted">Descrição</h3>
              <p className="text-sm whitespace-pre-wrap">{doc.description}</p>
            </Card>
          )}
          <Card className="p-4">
            <RelationsPanel type="document" id={doc.id} title={doc.title} />
          </Card>
        </aside>
      </div>

      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Editar documento"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!form.title.trim()} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Título">{(p) => <Input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} />}</Field>
          <Field label="Assunto">{(p) => <TopicSelect {...p} value={form.topicId} onChange={(topicId) => setForm({ ...form, topicId })} emptyLabel="Sem assunto" />}</Field>
          <Field label="Descrição" optional>
            {(p) => <Textarea {...p} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          </Field>
          <p className="text-xs text-subtle">Arquivo original: {doc.originalName}</p>
        </div>
      </Dialog>
    </Page>
  );
}
