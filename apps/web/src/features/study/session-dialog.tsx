import { useEffect, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Star, X } from 'lucide-react';
import { uuidv7, type SearchResult, type StudySession } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon } from '@/lib/entities';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { EntityPicker } from '../shared/entity-picker';
import { TopicSelect } from '../topics/topic-dialogs';

export interface SessionPrefill {
  startedAt?: string;
  durationSeconds?: number;
  topicId?: string | null;
  objective?: string;
  source?: 'manual' | 'timer';
}

export function invalidateStudy(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.studyAll });
  void qc.invalidateQueries({ queryKey: ['study-stats'] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
}

const pad = (n: number) => String(n).padStart(2, '0');
function localParts(iso?: string) {
  const d = iso ? new Date(iso) : new Date(Date.now() - 3600_000);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

interface Ref {
  type: 'note' | 'document';
  id: string;
  title: string;
}

export function SessionDialog({
  open,
  onOpenChange,
  session,
  prefill,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session?: StudySession | null;
  prefill?: SessionPrefill | null;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('09:00');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!open) return;
    const src = session ?? prefill ?? {};
    const parts = localParts(src.startedAt);
    setDate(parts.date);
    setTime(parts.time);
    const secs = src.durationSeconds ?? 1800;
    setHours(String(Math.floor(secs / 3600)));
    setMinutes(String(Math.max(session || prefill?.durationSeconds ? 0 : 1, Math.round((secs % 3600) / 60))));
    setTopicId(src.topicId ?? null);
    setObjective(src.objective ?? '');
    setNotes(session?.notes ?? '');
    setRating(session?.progressRating ?? null);
    setRefs([
      ...(session?.noteIds ?? []).map((id) => ({ type: 'note' as const, id, title: 'Nota' })),
      ...(session?.documentIds ?? []).map((id) => ({ type: 'document' as const, id, title: 'Documento' })),
    ]);
  }, [open, session, prefill]);

  // Resolve titles of references loaded from an existing session.
  const titles = useQueries({
    queries: refs
      .filter((r) => r.title === 'Nota' || r.title === 'Documento')
      .map((r) => ({
        queryKey: r.type === 'note' ? qk.note(r.id) : qk.document(r.id),
        queryFn: () => (r.type === 'note' ? endpoints.notes.get(r.id) : endpoints.documents.get(r.id)),
        enabled: open,
        staleTime: 60_000,
      })),
  });
  const titleOf = (r: Ref) => {
    const found = titles.find((q) => q.data?.id === r.id)?.data;
    return found ? found.title || 'Sem título' : r.title;
  };

  const durationSeconds = (Number.parseInt(hours, 10) || 0) * 3600 + (Number.parseInt(minutes, 10) || 0) * 60;
  const startedAt = (() => {
    const d = new Date(`${date}T${time || '00:00'}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  })();
  const valid = !!startedAt && durationSeconds >= 60 && durationSeconds <= 24 * 3600;

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        topicId,
        startedAt: startedAt!,
        durationSeconds,
        objective,
        notes,
        progressRating: rating,
        noteIds: refs.filter((r) => r.type === 'note').map((r) => r.id),
        documentIds: refs.filter((r) => r.type === 'document').map((r) => r.id),
      };
      return session
        ? endpoints.study.update(session.id, { ...body, baseVersion: session.version })
        : endpoints.study.create({ ...body, id: uuidv7(), source: prefill?.source ?? 'manual' });
    },
    onSuccess: () => {
      invalidateStudy(qc);
      onOpenChange(false);
      toast.success(session ? 'Sessão atualizada' : 'Sessão registrada');
      onSaved?.();
    },
    onError: (err) => {
      invalidateStudy(qc);
      toast.error(errorMessage(err));
    },
  });

  const addRef = (item: SearchResult) => {
    if (item.type !== 'note' && item.type !== 'document') return;
    setRefs((list) => (list.some((r) => r.id === item.id) ? list : [...list, { type: item.type as Ref['type'], id: item.id, title: item.title }]));
    setPicking(false);
  };

  return (
    <>
      <Dialog
        open={open && !picking}
        onOpenChange={onOpenChange}
        title={session ? 'Editar sessão' : 'Registrar sessão de estudo'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={mutation.isPending} disabled={!valid} onClick={() => mutation.mutate()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Data" className="col-span-1">{(p) => <Input {...p} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Início">{(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
            <Field label="Horas">{(p) => <Input {...p} type="number" min={0} max={24} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />}</Field>
            <Field label="Minutos">{(p) => <Input {...p} type="number" min={0} max={59} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
          </div>
          {!valid && <p className="text-xs text-danger">Informe uma duração entre 1 minuto e 24 horas.</p>}
          <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}</Field>
          <Field label="Objetivo" optional>{(p) => <Input {...p} value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={1000} placeholder="Ex.: Revisar política monetária" />}</Field>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">
              Progresso percebido <span className="text-xs font-normal text-subtle">opcional</span>
            </legend>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} de 5`}
                  aria-pressed={rating === n}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="rounded p-1"
                >
                  <Star className={cn('size-6', rating && n <= rating ? 'fill-warning text-warning' : 'text-border-strong')} />
                </button>
              ))}
              <span className="ml-2 text-xs text-muted">{rating ? ['Pouco', 'Algum', 'Bom', 'Muito bom', 'Excelente'][rating - 1] : 'Sem avaliação'}</span>
            </div>
          </fieldset>
          <Field label="Observações" optional>{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium">
              Referências <span className="text-xs font-normal text-subtle">notas e documentos usados</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {refs.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 py-1 pr-1 pl-2 text-xs">
                  <EntityIcon type={r.type} className="size-3.5" />
                  {titleOf(r)}
                  <button type="button" aria-label={`Remover ${r.title}`} onClick={() => setRefs((l) => l.filter((x) => x.id !== r.id))} className="rounded p-0.5 hover:bg-surface-3">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setPicking(true)}>
                Adicionar
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
      <Dialog open={open && picking} onOpenChange={(o) => !o && setPicking(false)} title="Adicionar referência">
        <EntityPicker types={['note', 'document']} onPick={addRef} />
      </Dialog>
    </>
  );
}
