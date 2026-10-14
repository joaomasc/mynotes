import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RELATION_KINDS, RELATION_KIND_LABELS, type GraphNode, type RelationKind } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';

/** Creates an explicit relation between two items (never changes the hierarchy). */
export function RelationDialog({ pair, onClose }: { pair: { source: GraphNode; target: GraphNode } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<RelationKind>('related');
  const [label, setLabel] = useState('');
  useEffect(() => {
    setKind('related');
    setLabel('');
  }, [pair]);
  const create = useMutation({
    mutationFn: () =>
      endpoints.relations.create({ sourceType: pair!.source.type, sourceId: pair!.source.entityId, targetType: pair!.target.type, targetId: pair!.target.entityId, kind, label }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['graph'] });
      void qc.invalidateQueries({ queryKey: qk.relationsAll });
      toast.success('Relação criada');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={!!pair}
      onOpenChange={(o) => !o && onClose()}
      title="Nova relação"
      description={pair ? `“${pair.source.label}” → “${pair.target.label}”` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Relacionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo de relação">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RELATION_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Rótulo" optional>
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />}
        </Field>
        <p className="text-xs text-muted">A relação é conceitual: a hierarquia dos assuntos não muda.</p>
      </div>
    </Dialog>
  );
}
