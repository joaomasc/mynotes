import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Minus, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { uuidv7, type ReviewRecall } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/feedback';
import { Card } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { shortDate, todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { AnswerBox } from './answer-box';
import { CardDialog, type CardDraft } from './card-dialog';

const STATUS = {
  covered: { label: 'Lembrou', icon: <Check className="size-4 text-success" aria-hidden /> },
  partial: { label: 'Em parte', icon: <Minus className="size-4 text-warning" aria-hidden /> },
  missing: { label: 'Faltou', icon: <X className="size-4 text-danger" aria-hidden /> },
} as const;

/**
 * "Write everything you remember" about a topic, without looking at the
 * notes (free recall). The AI marks which main ideas of the notes came back
 * and links each one missed to its note, ready to become a card.
 */
export function RecallSession({ sessionId, topicId, topicTitle, onFinish, finishing }: { sessionId: string; topicId: string; topicTitle: string; onFinish: () => void; finishing: boolean }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReviewRecall | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const history = useQuery({ queryKey: qk.reviewRecalls(topicId), queryFn: () => endpoints.review.recalls(topicId) });
  const compare = useMutation({
    mutationFn: () => endpoints.review.recall({ id: uuidv7(), topicId, sessionId, text, localDay: todayIso() }),
    onSuccess: (r) => {
      setResult(r);
      void history.refetch();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const earlier = (history.data ?? []).filter((r) => r.id !== result?.id && r.coverage !== null).slice(0, 4);

  if (!result) {
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Tudo que você lembra sobre “{topicTitle}”</h2>
          <p className="mt-1 text-sm text-muted">Sem olhar as notas: escreva ou fale o que vier, em qualquer ordem. Depois a IA mostra quais ideias das suas notas você lembrou e quais faltaram.</p>
        </div>
        <AnswerBox label="O que você lembra" value={text} onChange={setText} rows={12} placeholder="Comece pelo que é mais importante…" disabled={compare.isPending} onSubmit={() => text.trim().length >= 20 && compare.mutate()} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">{earlier.length > 0 && `Antes: ${earlier.map((r) => `${r.coverage}% em ${shortDate(r.localDay)}`).join(' · ')}`}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onFinish} loading={finishing}>
              Terminar
            </Button>
            <Button variant="primary" icon={<Sparkles className="size-4" />} loading={compare.isPending} disabled={text.trim().length < 20} onClick={() => compare.mutate()}>
              {compare.isPending ? 'Comparando com as notas…' : 'Comparar com as notas'}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const ev = result.evaluation;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Você lembrou {result.coverage ?? 0}% das ideias principais</h2>
          {earlier[0] && <span className="text-xs text-muted">antes: {earlier[0].coverage}%</span>}
        </div>
        <Progress value={result.coverage ?? 0} label="Ideias lembradas" />
        {ev?.summary && <p className="text-sm text-muted">{ev.summary}</p>}
      </Card>

      {ev && (
        <Card>
          <ul className="divide-y divide-border">
            {ev.ideas.map((idea, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0" title={STATUS[idea.status].label}>
                  {STATUS[idea.status].icon}
                </span>
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="font-medium">{idea.idea}</p>
                  {idea.status !== 'covered' && <blockquote className="border-l-2 border-border pl-2 text-xs text-muted italic">{idea.quote}</blockquote>}
                  {idea.evidence && idea.status !== 'missing' && <p className="text-xs text-muted">Você: “{idea.evidence}”</p>}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {idea.noteId && (
                      <Link to={`/notes/${idea.noteId}`} className="text-accent hover:underline">
                        {idea.noteTitle}
                      </Link>
                    )}
                    {idea.status !== 'covered' && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                        onClick={() => setDraft({ kind: 'basic', front: '', back: idea.quote, noteId: idea.noteId, noteTitle: idea.noteTitle, sourceQuote: idea.quote })}
                      >
                        <Plus className="size-3.5" aria-hidden /> Criar cartão
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ev && ev.errors.length > 0 && (
        <Card className="space-y-1 bg-danger-soft p-4 text-sm">
          <p className="text-xs font-medium text-danger">Contradiz as suas notas</p>
          {ev.errors.map((e, i) => (
            <p key={i}>
              <span className="line-through decoration-danger/60">{e.claim}</span> → {e.correction}
            </p>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setResult(null);
            setText('');
          }}
        >
          Escrever de novo
        </Button>
        <Button variant="primary" onClick={onFinish} loading={finishing}>
          Terminar
        </Button>
      </div>
      <CardDialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} draft={draft ?? undefined} />
    </div>
  );
}
