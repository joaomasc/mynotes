import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { CARD_KIND_LABELS, GENERATED_KINDS, type GeneratedKind } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Segmented } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { useInvalidateReview } from './use-review';

const KIND_HINTS: Record<GeneratedKind, string> = {
  basic: 'pergunta curta e resposta',
  cloze: 'frase da nota com um termo escondido',
  open: 'resposta em poucas frases, corrigida pela IA',
  essay: 'explicação mais longa, corrigida pela IA',
};

/**
 * Asks the AI for questions written from the notes of the selected topics
 * (or of one note). They go to the approval screen; nothing enters the
 * reviews before that.
 */
export function GenerateDialog({
  open,
  onOpenChange,
  topicIds = [],
  noteId = null,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topicIds?: string[];
  noteId?: string | null;
  /** What the questions are about, for the title. */
  label: string;
}) {
  const navigate = useNavigate();
  const invalidate = useInvalidateReview();
  const [kinds, setKinds] = useState<GeneratedKind[]>(['basic', 'cloze', 'open']);
  const [count, setCount] = useState('8');
  const [focus, setFocus] = useState<'notes' | 'connections'>('notes');
  useEffect(() => {
    if (open) setFocus('notes');
  }, [open]);

  const generate = useMutation({
    mutationFn: () => endpoints.review.generate({ topicIds, noteId, kinds, count: Number(count), focus: noteId ? 'notes' : focus }),
    onSuccess: (res) => {
      invalidate();
      onOpenChange(false);
      if (res.proposals.length === 0) {
        toast.warning('A IA não conseguiu perguntas que batessem com as notas desta vez. Tente de novo ou escolha outros assuntos.');
        return;
      }
      if (res.discarded > 0) {
        toast.info(`${res.discarded} ${res.discarded === 1 ? 'pergunta foi descartada' : 'perguntas foram descartadas'}: não batiam com o texto das notas ou repetiam outras.`);
      }
      void navigate(`/review/proposals?batch=${res.batchId}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = (k: GeneratedKind, on: boolean) => setKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gerar perguntas com a IA"
      description={`Sobre ${label}. Cada pergunta aponta o trecho da nota de onde saiu, e você aprova antes de ela entrar nas revisões.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Sparkles className="size-4" />} loading={generate.isPending} disabled={kinds.length === 0} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Lendo as notas…' : 'Gerar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="mb-1 text-[13px] font-medium">Tipos de pergunta</legend>
          {GENERATED_KINDS.map((k) => (
            <Checkbox
              key={k}
              className="flex"
              checked={kinds.includes(k)}
              onChange={(on) => toggle(k, on)}
              label={
                <span>
                  {CARD_KIND_LABELS[k]} <span className="text-muted">— {KIND_HINTS[k]}</span>
                </span>
              }
            />
          ))}
        </fieldset>
        <Field label="Quantas">
          {() => <Segmented label="Quantas perguntas" value={count} onChange={setCount} options={['5', '8', '12', '15'].map((v) => ({ value: v, label: v }))} />}
        </Field>
        {!noteId && (
          <Field label="Sobre o quê">
            {() => (
              <Segmented
                label="Foco das perguntas"
                value={focus}
                onChange={setFocus}
                options={[
                  { value: 'notes', label: 'O conteúdo das notas' },
                  { value: 'connections', label: 'As ligações entre notas', title: 'Perguntas sobre as relações do grafo: diferenças, dependências, exemplos' },
                ]}
              />
            )}
          </Field>
        )}
        <p className="text-xs text-muted">Usa a IA: cerca de US$ 0,002 por lote, dentro do limite diário de gastos.</p>
      </div>
    </Dialog>
  );
}
