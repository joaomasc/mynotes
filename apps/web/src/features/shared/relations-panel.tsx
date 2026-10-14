import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Link2, Plus, X } from 'lucide-react';
import {
  RELATION_KINDS,
  RELATION_KIND_LABELS,
  type GraphEntityType,
  type RelationKind,
  type SearchResult,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { EntityIcon, entityPath } from '@/lib/entities';
import { qk } from '@/lib/query';
import { EntityPicker } from './entity-picker';

const GRAPH_TYPES: GraphEntityType[] = ['topic', 'note', 'document', 'reading', 'concept'];

/** Lists and edits typed relations of an entity (persisted on the server). */
export function RelationsPanel({ type, id, title }: { type: GraphEntityType; id: string; title?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<SearchResult | null>(null);
  const [kind, setKind] = useState<RelationKind>('related');
  const [label, setLabel] = useState('');
  const { data, isLoading } = useQuery({ queryKey: qk.relations(type, id), queryFn: () => endpoints.relations.list(type, id) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.relationsAll });
    void qc.invalidateQueries({ queryKey: ['graph'] });
  };
  const create = useMutation({
    mutationFn: () =>
      endpoints.relations.create({
        sourceType: type,
        sourceId: id,
        targetType: target!.type as GraphEntityType,
        targetId: target!.id,
        kind,
        label,
      }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast.success('Relação criada');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (relationId: string) => endpoints.relations.remove(relationId),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const start = () => {
    setTarget(null);
    setKind('related');
    setLabel('');
    setOpen(true);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-muted">Relações</h3>
        <IconButton label="Adicionar relação" size="sm" onClick={start}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      {isLoading ? (
        <div className="h-8 animate-pulse rounded bg-surface-2" />
      ) : !data?.length ? (
        <button type="button" onClick={start} className="w-full rounded-lg border border-dashed border-border px-3 py-3 text-left text-xs text-muted hover:border-accent hover:text-accent">
          <Link2 className="mr-1.5 inline size-3.5" aria-hidden />
          Conecte este item a assuntos, notas, documentos ou conceitos.
        </button>
      ) : (
        <ul className="space-y-1">
          {data.map((r) => {
            const outgoing = r.sourceType === type && r.sourceId === id;
            const otherType = outgoing ? r.targetType : r.sourceType;
            const otherId = outgoing ? r.targetId : r.sourceId;
            const otherTitle = outgoing ? r.targetTitle : r.sourceTitle;
            return (
              <li key={r.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-surface-2">
                <EntityIcon type={otherType} />
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] text-subtle">
                    {outgoing ? '' : <ArrowLeft className="mr-0.5 inline size-3" aria-label="recebida de" />}
                    {RELATION_KIND_LABELS[r.kind]}
                    {r.label ? ` · ${r.label}` : ''}
                  </span>
                  <Link to={entityPath(otherType, otherId)} className="block truncate hover:text-accent">
                    {otherTitle || 'Sem título'}
                  </Link>
                </div>
                <IconButton
                  label="Remover relação"
                  size="sm"
                  className="size-7 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                  onClick={() => remove.mutate(r.id)}
                >
                  <X className="size-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Nova relação"
        description={title ? `A partir de “${title}”` : undefined}
        footer={
          target ? (
            <>
              <Button variant="ghost" onClick={() => setTarget(null)}>
                Voltar
              </Button>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                Relacionar
              </Button>
            </>
          ) : undefined
        }
      >
        {!target ? (
          <EntityPicker
            types={GRAPH_TYPES}
            onPick={setTarget}
            exclude={(i) => i.type === type && i.id === id}
            placeholder="Buscar assunto, nota, documento, leitura ou conceito…"
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <EntityIcon type={target.type} />
              <span className="truncate font-medium">{target.title}</span>
            </div>
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
            <Field label="Rótulo" optional hint="Uma palavra para descrever a conexão (ex.: “critica”, “cap. 3”).">
              {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />}
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
