import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { TOPIC_TITLE_MAX, uuidv7, type Topic } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { TOPIC_COLORS } from '@/lib/entities';
import { qk } from '@/lib/query';
import { descendantIds, useTopics, type TopicNode } from './use-topics';

/** Hierarchical <select> of topics. */
export function TopicSelect({
  value,
  onChange,
  exclude,
  emptyLabel = 'Nenhum (raiz)',
  id,
  ...aria
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  exclude?: Set<string>;
  emptyLabel?: string;
  id?: string;
  'aria-describedby'?: string;
}) {
  const { tree } = useTopics();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...aria}>
      <option value="">{emptyLabel}</option>
      {tree.flat
        .filter((t) => !exclude?.has(t.id))
        .map((t) => (
          <option key={t.id} value={t.id}>
            {'  '.repeat(t.depth)}
            {t.depth > 0 ? '└ ' : ''}
            {t.title}
          </option>
        ))}
    </Select>
  );
}

export function invalidateTopicData(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.topics });
  void qc.invalidateQueries({ queryKey: ['topic'] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: ['graph'] });
  // References show the current title of topics.
  void qc.invalidateQueries({ queryKey: ['reference'] });
  void qc.invalidateQueries({ queryKey: ['topic-context'] });
}

export function TopicFormDialog({
  open,
  onOpenChange,
  topic,
  parentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode when provided. */
  topic?: Topic | undefined;
  parentId?: string | null | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  // Creating only needs a title; description and color stay one click away.
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(topic?.title ?? '');
    setDescription(topic?.description ?? '');
    setColor(topic?.color ?? null);
    setParent(topic ? topic.parentId : (parentId ?? null));
    setMore(!!topic);
  }, [open, topic, parentId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (topic) {
        return endpoints.topics.update(topic.id, { baseVersion: topic.version, title, description, color });
      }
      return endpoints.topics.create({ id: uuidv7(), parentId: parent, title, description, color });
    },
    onSuccess: (saved) => {
      invalidateTopicData(qc);
      onOpenChange(false);
      if (!topic) {
        toast.success('Assunto criado');
        void navigate(`/topics/${saved.id}`);
      }
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        invalidateTopicData(qc);
        toast.error('Este assunto foi alterado em outro dispositivo. Os dados foram atualizados; revise e salve de novo.');
      } else toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? 'Editar assunto' : 'Novo assunto'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="topic-form" loading={mutation.isPending} disabled={!title.trim()}>
            {topic ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <form
        id="topic-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) mutation.mutate();
        }}
      >
        <Field label="Título">
          {(p) => (
            <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TOPIC_TITLE_MAX} autoFocus required />
          )}
        </Field>
        {!topic && (
          <Field label="Dentro de" hint={parent ? undefined : 'Na raiz, o assunto funciona como um caderno.'}>
            {(p) => <TopicSelect {...p} value={parent} onChange={setParent} />}
          </Field>
        )}
        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="text-[13px] font-medium text-accent hover:underline">
            Mais opções (descrição e cor)
          </button>
        ) : (
          <>
            <Field label="Descrição" optional>
              {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Cor</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setColor(null)}
                  aria-pressed={color === null}
                  className={cn(
                    'h-8 rounded-full border border-border px-3 text-xs text-muted',
                    color === null && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  )}
                >
                  Padrão
                </button>
                {TOPIC_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Cor ${c}`}
                    aria-pressed={color === c}
                    className={cn('size-8 rounded-full', color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </fieldset>
          </>
        )}
      </form>
    </Dialog>
  );
}

export function MoveTopicDialog({
  open,
  onOpenChange,
  topic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: TopicNode | null;
}) {
  const qc = useQueryClient();
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => {
    if (open && topic) setParent(topic.parentId);
  }, [open, topic]);

  const mutation = useMutation({
    mutationFn: () => endpoints.topics.move(topic!.id, { baseVersion: topic!.version, parentId: parent }),
    onSuccess: () => {
      invalidateTopicData(qc);
      onOpenChange(false);
      toast.success('Assunto movido');
    },
    onError: (err) => {
      invalidateTopicData(qc);
      toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mover assunto"
      description={topic ? `Escolha onde “${topic.title}” deve ficar.` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Mover
          </Button>
        </>
      }
    >
      <Field label="Novo local">
        {(p) => <TopicSelect {...p} value={parent} onChange={setParent} exclude={topic ? descendantIds(topic) : undefined} />}
      </Field>
    </Dialog>
  );
}

export function DeleteTopicDialog({
  open,
  onOpenChange,
  topic,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: TopicNode | null;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'trash_all' | 'move_to_parent'>('move_to_parent');
  const mutation = useMutation({
    mutationFn: () => endpoints.topics.remove(topic!.id, mode),
    onSuccess: () => {
      invalidateTopicData(qc);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
      void qc.invalidateQueries({ queryKey: qk.trash });
      onOpenChange(false);
      onDeleted?.();
      toast.success('Assunto enviado para a lixeira', { description: 'Você pode restaurá-lo em Configurações › Lixeira.' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!topic) return null;
  const hasContent = topic.children.length > 0 || topic.noteCount + topic.documentCount + topic.readingCount > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Excluir “${topic.title}”?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Enviar para a lixeira
          </Button>
        </>
      }
    >
      {hasContent ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted">
            Este assunto contém {topic.children.length} subassunto(s), {topic.noteCount} nota(s) e {topic.documentCount}{' '}
            documento(s). O que fazer com o conteúdo?
          </p>
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="radio" name="mode" checked={mode === 'move_to_parent'} onChange={() => setMode('move_to_parent')} className="mt-1 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">Manter o conteúdo</span>
              <span className="block text-muted">Subassuntos, notas e documentos passam para o assunto acima.</span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
            <input type="radio" name="mode" checked={mode === 'trash_all'} onChange={() => setMode('trash_all')} className="mt-1 accent-[var(--danger)]" />
            <span>
              <span className="font-medium">Excluir tudo junto</span>
              <span className="block text-muted">Tudo vai para a lixeira e pode ser restaurado de uma vez.</span>
            </span>
          </label>
        </div>
      ) : (
        <p className="text-sm text-muted">O assunto vai para a lixeira e pode ser restaurado depois.</p>
      )}
    </Dialog>
  );
}
