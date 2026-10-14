import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Ellipsis, FileText, Pencil, Trash } from 'lucide-react';
import { MATERIAL_TYPE_LABELS, PRIORITY_LABELS, READING_STATUS_LABELS } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, PageLoader, Progress } from '@/components/ui/feedback';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { longDate } from '@/lib/format';
import { qk } from '@/lib/query';
import { FavoriteButton } from '../shared/favorite-button';
import { RelationsPanel } from '../shared/relations-panel';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { useRecordView } from '../shared/use-view';
import { ProgressDialog, ReadingFormDialog, invalidateReadings, readingPercent } from './reading-dialogs';

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<'edit' | 'progress' | null>(null);
  const query = useQuery({ queryKey: qk.reading(id), queryFn: () => endpoints.readings.get(id) });
  const r = query.data;
  const doc = useQuery({
    queryKey: qk.document(r?.documentId ?? ''),
    queryFn: () => endpoints.documents.get(r!.documentId!),
    enabled: !!r?.documentId,
  });
  useRecordView('reading', id, query.isSuccess);

  if (query.isLoading) return <PageLoader />;
  if (!r) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState className="mt-16" title="Leitura não encontrada" action={<Link to="/readings" className="text-accent">Ver leituras</Link>} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir esta leitura?', description: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.readings.remove(id);
      invalidateReadings(qc);
      toast.success('Leitura excluída');
      void navigate('/readings');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const pct = readingPercent(r);
  const facts: [string, string | null][] = [
    ['Tipo', MATERIAL_TYPE_LABELS[r.materialType]],
    ['Início', r.startedOn ? longDate(r.startedOn) : null],
    ['Conclusão', r.completedOn ? longDate(r.completedOn) : null],
    ['Prazo', r.dueOn ? longDate(r.dueOn) : null],
    ['Prioridade', r.priority ? PRIORITY_LABELS[r.priority]! : null],
  ];

  return (
    <Page>
      <PageHeader
        above={<TopicBreadcrumb topicId={r.topicId} />}
        title={r.title}
        subtitle={r.author || undefined}
        actions={
          <>
            <FavoriteButton type="reading" id={r.id} />
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                { label: 'Editar', icon: <Pencil />, onSelect: () => setDialog('edit') },
                'separator',
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
            {r.status !== 'completed' && (
              <Button variant="primary" onClick={() => setDialog('progress')}>
                Atualizar progresso
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <Badge tone={r.status === 'completed' ? 'success' : r.status === 'in_progress' ? 'accent' : 'neutral'}>{READING_STATUS_LABELS[r.status]}</Badge>
              <span className="text-sm text-muted tabular-nums">
                {r.totalPages && r.currentPage != null ? `página ${r.currentPage} de ${r.totalPages} · ` : ''}
                {Math.round(pct)}%
              </span>
            </div>
            <Progress value={pct} className="mt-3 h-2" label="Progresso" />
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-subtle">{k}</dt>
                    <dd className="mt-0.5 text-sm">{v}</dd>
                  </div>
                ))}
            </dl>
          </Card>
          {r.documentId && (
            <Card className="flex items-center gap-3 p-4">
              <FileText className="size-5 text-document" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-subtle">Documento vinculado</p>
                <p className="truncate text-sm font-medium">{doc.data?.title ?? '…'}</p>
              </div>
              <Link to={`/library/${r.documentId}`} className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg">
                Abrir
              </Link>
            </Card>
          )}
          {r.notes && (
            <Card className="p-5">
              <h2 className="mb-2 text-[13px] font-semibold text-muted">Observações</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.notes}</p>
            </Card>
          )}
        </div>
        <aside>
          <Card className="p-4">
            <RelationsPanel type="reading" id={r.id} title={r.title} />
          </Card>
        </aside>
      </div>
      <ReadingFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} reading={r} />
      <ProgressDialog reading={r} open={dialog === 'progress'} onOpenChange={(o) => !o && setDialog(null)} />
    </Page>
  );
}
