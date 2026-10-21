import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { LayoutDashboard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { TopicSelect } from '../topics/topic-dialogs';
import { canvasPath, useCreateCanvas } from './use-canvases';

export function Component() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  const list = useQuery({ queryKey: qk.mindMapList({ kind: 'canvas' }), queryFn: () => endpoints.mindMaps.list({ kind: 'canvas' }) });
  const create = useCreateCanvas();

  const startNew = (topic: string | null = null) => {
    setTitle('');
    setTopicId(topic);
    setOpen(true);
  };

  // "+ Novo canvas" from elsewhere (command palette, the + menu inside a topic).
  useEffect(() => {
    if (params.get('new') === '1') {
      setTitle('');
      setTopicId(params.get('topicId'));
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <Page width="wide">
      <PageHeader
        title="Canvas"
        subtitle="Quadros livres, como o Canvas do Obsidian: cartões de texto com referências, notas que você edita ali mesmo, assuntos com seus subassuntos, links e grupos, ligados por setas."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => startNew()}>
            Novo canvas
          </Button>
        }
      />
      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError && !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<LayoutDashboard />}
          title="Nenhum canvas ainda"
          description="Crie um aqui, ou na página de um assunto ou de uma nota, para que ele fique guardado ali."
          action={<Button variant="outline" onClick={() => startNew()}>Criar canvas</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => (
            <Link key={c.id} to={canvasPath(c.id)} className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 text-accent" aria-hidden />
                <span className="truncate font-medium">{c.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {plural(c.nodeCount, 'cartão', 'cartões')} · editado {relativeTime(c.updatedAt)}
                {c.noteId ? ' · numa nota' : ''}
              </p>
              {c.topicId && (
                <div className="mt-2">
                  <TopicChip topicId={c.topicId} link={false} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Novo canvas"
        size="sm"
        footer={
          <Button variant="primary" loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate({ title, topicId }, { onSuccess: () => setOpen(false) })}>
            Criar
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Título">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="Ex.: Revisão da prova de História" />}</Field>
          <Field label="Assunto" optional hint="O canvas aparece na página do assunto.">
            {(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}
          </Field>
        </div>
      </Dialog>
    </Page>
  );
}
