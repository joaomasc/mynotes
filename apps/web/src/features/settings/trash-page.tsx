import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArchiveRestore, Trash } from 'lucide-react';
import type { TrashItem } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { EntityIcon, entityLabel } from '@/lib/entities';
import { relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';

export function Component() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const trash = useQuery({ queryKey: qk.trash, queryFn: endpoints.trash.list });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.trash });
    void qc.invalidateQueries({ queryKey: qk.topics });
    void qc.invalidateQueries({ queryKey: qk.notesAll });
    void qc.invalidateQueries({ queryKey: qk.documentsAll });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
  };
  const restore = useMutation({
    mutationFn: (item: TrashItem) => endpoints.trash.restore(item.type, item.id),
    onSuccess: (r) => {
      refresh();
      toast.success(r.count > 1 ? `${r.count} itens restaurados` : 'Item restaurado');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const purge = async (item: TrashItem) => {
    if (!(await confirm({ title: 'Excluir definitivamente?', description: item.batchSize > 1 ? `${item.batchSize} itens excluídos juntos serão apagados, incluindo arquivos.` : 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir para sempre', danger: true }))) return;
    try {
      await endpoints.trash.purge(item.type, item.id);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const empty = async () => {
    if (!(await confirm({ title: 'Esvaziar a lixeira?', description: 'Todos os itens e arquivos na lixeira serão apagados definitivamente.', confirmLabel: 'Esvaziar', danger: true, typeToConfirm: 'ESVAZIAR' }))) return;
    try {
      const r = await endpoints.trash.empty();
      refresh();
      toast.success(`${r.count} itens apagados`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const items = trash.data ?? [];
  return (
    <Page width="narrow">
      <PageHeader
        title="Lixeira"
        subtitle="Itens excluídos ficam aqui até você restaurá-los ou apagá-los definitivamente. A lixeira não é esvaziada automaticamente."
        actions={items.length > 0 ? <Button variant="danger" icon={<Trash className="size-4" />} onClick={() => void empty()}>Esvaziar</Button> : undefined}
      />
      {trash.isLoading ? (
        <ListSkeleton rows={3} />
      ) : trash.isError && !trash.data ? (
        <ErrorState error={trash.error} onRetry={() => void trash.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash />} title="A lixeira está vazia" />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((item) => (
            <div key={`${item.type}:${item.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <EntityIcon type={item.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted">
                  {entityLabel(item.type)}
                  {item.batchSize > 1 && ` · com ${item.batchSize - 1} item(ns) excluído(s) junto`} · {relativeTime(item.deletedAt)}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" icon={<ArchiveRestore className="size-3.5" />} loading={restore.isPending && restore.variables?.id === item.id} onClick={() => restore.mutate(item)}>
                  Restaurar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void purge(item)}>
                  Excluir
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}
