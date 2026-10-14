import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  READING_STATUSES,
  READING_STATUS_LABELS,
  uuidv7,
  type Reading,
  type ReadingCreate,
} from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { TopicSelect } from '../topics/topic-dialogs';

type Form = Required<Omit<ReadingCreate, 'id'>>;

const empty = (): Form => ({
  topicId: null,
  documentId: null,
  title: '',
  author: '',
  materialType: 'book',
  status: 'not_started',
  totalPages: null,
  currentPage: null,
  progressPercent: null,
  startedOn: null,
  completedOn: null,
  dueOn: null,
  priority: 0,
  notes: '',
});

export function invalidateReadings(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.readingsAll });
  void qc.invalidateQueries({ queryKey: ['reading'] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: qk.topics });
}

const num = (v: string): number | null => (v.trim() === '' ? null : Number.parseInt(v, 10));

export function ReadingFormDialog({
  open,
  onOpenChange,
  reading,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reading?: Reading | undefined;
  defaults?: Partial<Form> | undefined;
  onSaved?: (r: Reading) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [more, setMore] = useState(false);
  const docs = useQuery({
    queryKey: qk.documents({ picker: true }),
    queryFn: () => endpoints.documents.list({ limit: 200 }),
    enabled: open && more,
  });

  useEffect(() => {
    if (!open) return;
    if (reading) {
      const { id: _id, version: _v, createdAt: _c, updatedAt: _u, ...rest } = reading;
      setForm(rest);
      setMore(true);
    } else {
      setForm({ ...empty(), ...defaults });
      setMore(!!defaults?.documentId);
    }
  }, [open, reading, defaults]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: () =>
      reading
        ? endpoints.readings.update(reading.id, { ...form, baseVersion: reading.version })
        : endpoints.readings.create({ ...form, id: uuidv7() }),
    onSuccess: (saved) => {
      invalidateReadings(qc);
      onOpenChange(false);
      toast.success(reading ? 'Leitura atualizada' : 'Leitura adicionada');
      onSaved?.(saved);
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        invalidateReadings(qc);
        toast.error('Esta leitura foi alterada em outro dispositivo. Reabra para ver a versão atual.');
      } else toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={reading ? 'Editar leitura' : 'Nova leitura'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="reading-form" loading={mutation.isPending} disabled={!form.title.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="reading-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim()) mutation.mutate();
        }}
      >
        <Field label="Título">{(p) => <Input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus required maxLength={300} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Autor" optional>{(p) => <Input {...p} value={form.author} onChange={(e) => set('author', e.target.value)} />}</Field>
          <Field label="Tipo">
            {(p) => (
              <Select {...p} value={form.materialType} onChange={(e) => set('materialType', e.target.value as Form['materialType'])}>
                {MATERIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MATERIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Status</span>
          <Segmented
            label="Status"
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v, ...(v === 'in_progress' && !f.startedOn ? { startedOn: todayIso() } : {}) }))}
            options={READING_STATUSES.map((s) => ({ value: s, label: READING_STATUS_LABELS[s] }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Total de páginas" optional>
            {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={form.totalPages ?? ''} onChange={(e) => set('totalPages', num(e.target.value))} />}
          </Field>
          {form.totalPages ? (
            <Field label="Página atual" optional>
              {(p) => (
                <Input {...p} type="number" min={0} max={form.totalPages ?? undefined} inputMode="numeric" value={form.currentPage ?? ''} onChange={(e) => set('currentPage', num(e.target.value))} />
              )}
            </Field>
          ) : (
            <Field label="Progresso (%)" optional>
              {(p) => (
                <Input {...p} type="number" min={0} max={100} inputMode="numeric" value={form.progressPercent ?? ''} onChange={(e) => set('progressPercent', num(e.target.value))} />
              )}
            </Field>
          )}
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1.5 text-sm font-medium text-accent" aria-expanded={more}>
          <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} aria-hidden />
          Mais detalhes
        </button>
        {more && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Início" optional>{(p) => <Input {...p} type="date" value={form.startedOn ?? ''} onChange={(e) => set('startedOn', e.target.value || null)} />}</Field>
              <Field label="Conclusão" optional>{(p) => <Input {...p} type="date" value={form.completedOn ?? ''} onChange={(e) => set('completedOn', e.target.value || null)} />}</Field>
              <Field label="Prazo" optional>{(p) => <Input {...p} type="date" value={form.dueOn ?? ''} onChange={(e) => set('dueOn', e.target.value || null)} />}</Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={form.topicId} onChange={(v) => set('topicId', v)} emptyLabel="Sem assunto" />}</Field>
              <Field label="Prioridade">
                {(p) => (
                  <Select {...p} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))}>
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {PRIORITY_LABELS[n]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Documento da biblioteca" optional hint="Vincule o PDF para abri-lo direto da leitura.">
              {(p) => (
                <Select {...p} value={form.documentId ?? ''} onChange={(e) => set('documentId', e.target.value || null)}>
                  <option value="">Nenhum</option>
                  {form.documentId && !docs.data?.data.some((d) => d.id === form.documentId) && <option value={form.documentId}>Documento vinculado</option>}
                  {docs.data?.data.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Observações" optional>{(p) => <Textarea {...p} rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** Quick progress update without opening the full form. */
export function ProgressDialog({ reading, open, onOpenChange }: { reading: Reading | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open && reading) setValue(String(reading.totalPages ? (reading.currentPage ?? 0) : (reading.progressPercent ?? 0)));
  }, [open, reading]);
  const byPages = !!reading?.totalPages;
  const mutation = useMutation({
    mutationFn: () => {
      const n = Number.parseInt(value, 10) || 0;
      const done = byPages ? n >= (reading!.totalPages ?? Infinity) : n >= 100;
      return endpoints.readings.update(reading!.id, {
        baseVersion: reading!.version,
        ...(byPages ? { currentPage: n } : { progressPercent: n }),
        status: done ? 'completed' : n > 0 ? 'in_progress' : reading!.status,
      });
    },
    onSuccess: (saved) => {
      invalidateReadings(qc);
      onOpenChange(false);
      if (saved.status === 'completed') toast.success('Leitura concluída 🎉');
    },
    onError: (err) => {
      invalidateReadings(qc);
      toast.error(errorMessage(err));
    },
  });
  if (!reading) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Atualizar progresso"
      description={reading.title}
      size="sm"
      footer={
        <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Salvar
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label={byPages ? `Página atual (de ${reading.totalPages})` : 'Progresso (%)'}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={byPages ? (reading.totalPages ?? undefined) : 100} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
        </Field>
      </form>
    </Dialog>
  );
}

export function readingPercent(r: Reading): number {
  if (r.status === 'completed') return 100;
  if (r.progressPercent != null) return r.progressPercent;
  if (r.totalPages && r.currentPage != null) return (r.currentPage / r.totalPages) * 100;
  return 0;
}
