import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lightbulb, Scissors, SquarePen } from 'lucide-react';
import { toast } from 'sonner';
import { uuidv7, type ReviewCard } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { useInvalidateReview } from './use-review';

/**
 * Help with a card that keeps being forgotten (a "leech"): the AI suggests a
 * clearer version, smaller cards or a mnemonic; nothing changes until the
 * user applies one.
 */
export function HelpDialog({ open, onOpenChange, card, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; card: ReviewCard; onChanged?: () => void }) {
  const invalidate = useInvalidateReview();
  const help = useMutation({ mutationFn: () => endpoints.review.help(card.id) });
  const { mutate, reset } = help;
  useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, mutate, reset]);

  const apply = useMutation({
    mutationFn: async (action: { type: 'rewrite'; front: string; back: string } | { type: 'split'; cards: { front: string; back: string }[] } | { type: 'mnemonic'; text: string }) => {
      if (action.type === 'rewrite') {
        await endpoints.review.updateCard(card.id, { baseVersion: card.version, front: action.front, back: action.back, reset: false });
        return 'Cartão reescrito';
      }
      if (action.type === 'mnemonic') {
        await endpoints.review.updateCard(card.id, { baseVersion: card.version, back: `${card.back}${card.back ? '\n\n' : ''}Macete: ${action.text}` });
        return 'Macete guardado na resposta';
      }
      for (const c of action.cards) {
        await endpoints.review.createCards({ id: uuidv7(), kind: 'basic', front: c.front, back: c.back, noteId: card.noteId, topicId: card.noteId ? null : card.topicId, sourceQuote: card.sourceQuote });
      }
      await endpoints.review.updateCard(card.id, { baseVersion: card.version, status: 'suspended' });
      return `${action.cards.length} cartões criados; o original foi suspenso`;
    },
    onSuccess: (message) => {
      invalidate();
      toast.success(message);
      onOpenChange(false);
      onChanged?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const data = help.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ajuda da IA com este cartão" description="Sugestões para lembrar melhor. Nada muda até você aplicar uma." size="lg">
      {help.isPending ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Spinner /> Pensando em como deixar este cartão mais fácil…
        </div>
      ) : help.isError ? (
        <ErrorState error={help.error} onRetry={() => help.mutate()} />
      ) : data ? (
        <div className="space-y-5 text-sm">
          <p className="rounded-lg bg-surface-2 px-3 py-2">{data.diagnosis}</p>
          {data.rewrite && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-medium">
                <SquarePen className="size-4" aria-hidden /> Versão mais clara
              </h3>
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">{data.rewrite.front}</p>
                <p className="mt-1 text-muted">{data.rewrite.back}</p>
              </div>
              <Button size="sm" variant="outline" loading={apply.isPending} onClick={() => apply.mutate({ type: 'rewrite', ...data.rewrite! })}>
                Usar esta versão
              </Button>
            </section>
          )}
          {data.split.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-medium">
                <Scissors className="size-4" aria-hidden /> Dividir em cartões menores
              </h3>
              <ul className="space-y-1.5">
                {data.split.map((c, i) => (
                  <li key={i} className="rounded-lg border border-border p-2.5">
                    <p className="font-medium">{c.front}</p>
                    <p className="text-muted">{c.back}</p>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" loading={apply.isPending} onClick={() => apply.mutate({ type: 'split', cards: data.split })}>
                Criar estes {data.split.length} cartões e suspender o original
              </Button>
            </section>
          )}
          {data.mnemonic && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-medium">
                <Lightbulb className="size-4" aria-hidden /> Macete
              </h3>
              <p className="rounded-lg border border-border p-3">{data.mnemonic}</p>
              <Button size="sm" variant="outline" loading={apply.isPending} onClick={() => apply.mutate({ type: 'mnemonic', text: data.mnemonic! })}>
                Guardar o macete na resposta
              </Button>
            </section>
          )}
          {!data.rewrite && data.split.length === 0 && !data.mnemonic && <p className="text-muted">A IA achou o cartão bom como está. Insista um pouco mais nele.</p>}
        </div>
      ) : null}
    </Dialog>
  );
}
