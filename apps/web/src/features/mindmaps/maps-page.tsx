import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Network, Plus, Upload } from 'lucide-react';
import { uuidv7, type MindMapData } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Page, PageHeader } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { TopicSelect } from '../topics/topic-dialogs';
import { parseImportedMap } from './convert';

export function Component() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [imported, setImported] = useState<MindMapData | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const maps = useQuery({ queryKey: qk.mindMaps, queryFn: endpoints.mindMaps.list });

  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const create = useMutation({
    mutationFn: () => endpoints.mindMaps.create({ id: uuidv7(), title: title.trim(), topicId, ...(imported ? { data: imported } : {}) }),
    onSuccess: (map) => {
      void qc.invalidateQueries({ queryKey: qk.mindMaps });
      setOpen(false);
      void navigate(`/maps/${map.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const startNew = () => {
    setTitle('');
    setTopicId(null);
    setImported(null);
    setOpen(true);
  };

  const onImport = async (f: File) => {
    try {
      const text = await f.text();
      const data = parseImportedMap(text);
      const parsed = JSON.parse(text) as { title?: unknown };
      setImported(data);
      setTitle(typeof parsed.title === 'string' ? parsed.title : f.name.replace(/\.json$/i, ''));
      setTopicId(null);
      setOpen(true);
    } catch {
      toast.error('Arquivo inválido. Use um JSON exportado por um mapa do MyNotes.');
    }
  };

  return (
    <Page width="wide">
      <PageHeader
        title="Mapas mentais"
        subtitle="Organize ideias visualmente e conecte nós a assuntos, notas e documentos."
        actions={
          <>
            <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>
              Importar
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={startNew}>
              Novo mapa
            </Button>
          </>
        }
      />
      <input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
      {maps.isLoading ? (
        <ListSkeleton rows={3} />
      ) : maps.isError && !maps.data ? (
        <ErrorState error={maps.error} onRetry={() => void maps.refetch()} />
      ) : !maps.data?.length ? (
        <EmptyState icon={<Network />} title="Nenhum mapa mental" description="Comece por um tema central e desdobre em ideias." action={<Button variant="outline" onClick={startNew}>Criar mapa</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {maps.data.map((m) => (
            <Link key={m.id} to={`/maps/${m.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
              <div className="flex items-center gap-2">
                <Network className="size-4 text-accent" aria-hidden />
                <span className="truncate font-medium">{m.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {plural(m.nodeCount, 'nó', 'nós')} · editado {relativeTime(m.updatedAt)}
              </p>
              {m.topicId && (
                <div className="mt-2">
                  <TopicChip topicId={m.topicId} link={false} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={imported ? 'Importar mapa' : 'Novo mapa mental'}
        description={imported ? `${plural(imported.nodes.length, 'nó', 'nós')} e ${plural(imported.edges.length, 'conexão', 'conexões')} serão importados.` : undefined}
        size="sm"
        footer={
          <Button variant="primary" loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>
            {imported ? 'Importar' : 'Criar'}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Título">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="Ex.: Escolas do pensamento econômico" />}</Field>
          <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}</Field>
        </div>
      </Dialog>
    </Page>
  );
}
