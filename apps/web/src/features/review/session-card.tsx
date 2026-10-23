import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, CircleHelp, Ellipsis, Minus, Sparkles, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONFIDENCES,
  CONFIDENCE_LABELS,
  RATINGS,
  RATING_LABELS,
  compareTyped,
  formatInterval,
  isAiGraded,
  previewDue,
  ratingForScore,
  typedScore,
  type Confidence,
  type ReviewCard,
  type ReviewEvaluation,
  type ReviewRating,
  type TypedVerdict,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { Card } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { isTypingTarget } from '@/lib/hooks';
import { AnswerBox } from './answer-box';
import { CardPrompt, CardSource, KindBadge } from './card-view';

export interface CardResult {
  rating: ReviewRating;
  confidence: Confidence | null;
  answer: string;
  prompt: string;
  score: number | null;
  evaluation: ReviewEvaluation | null;
  disputed: boolean;
  durationMs: number;
}

const RATING_STYLE: Record<ReviewRating, string> = {
  1: 'border-danger/40 text-danger hover:bg-danger-soft',
  2: 'border-warning/40 text-warning hover:bg-warning-soft',
  3: 'border-success/40 text-success hover:bg-success-soft',
  4: 'border-accent/40 text-accent hover:bg-accent-soft',
};

const VERDICT: Record<TypedVerdict, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  exact: { label: 'Certo', tone: 'success' },
  close: { label: 'Quase (pequena diferença)', tone: 'warning' },
  wrong: { label: 'Diferente da resposta', tone: 'danger' },
};

/**
 * One item of a session: the question, then (after "how sure are you?") the
 * answer, the correction when there is one, and the four buttons that say
 * when it comes back.
 */
export function SessionCard({
  card,
  prompt,
  askConfidence,
  desiredRetention,
  onRate,
  onEdit,
  onSuspend,
  onHelp,
}: {
  card: ReviewCard;
  /** The question asked another way (AI variant), when there is one. */
  prompt: string | null;
  askConfidence: boolean;
  desiredRetention: number;
  onRate: (result: CardResult) => void;
  onEdit: () => void;
  onSuspend: () => void;
  onHelp: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [typed, setTyped] = useState('');
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<TypedVerdict | null>(null);
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const shownAt = useRef(Date.now());
  const aiGraded = isAiGraded(card.kind);
  const asked = prompt && !showOriginal ? prompt : null;

  const evaluate = useMutation({
    mutationFn: () => endpoints.review.evaluate(card.id, { answer: text, ...(asked ? { prompt: asked } : {}) }),
    onSuccess: (ev) => {
      setEvaluation(ev);
      setRevealed(true);
    },
    onError: (err) => toast.error(errorMessage(err), { description: 'Você pode ver a resposta modelo e avaliar sozinho.' }),
  });

  const suggested: ReviewRating | null = evaluation ? evaluation.suggestedRating : verdict ? ratingForScore(typedScore(verdict)) : null;
  const now = new Date();
  const due = revealed ? previewDue(card.schedule, now, desiredRetention) : null;

  const rate = (rating: ReviewRating) =>
    onRate({
      rating,
      confidence,
      answer: card.kind === 'typed' ? typed : aiGraded ? text : '',
      prompt: asked ?? '',
      score: evaluation?.score ?? (verdict ? typedScore(verdict) : null),
      evaluation,
      disputed: suggested !== null && rating !== suggested,
      durationMs: Math.min(Date.now() - shownAt.current, 3_600_000),
    });

  const reveal = (c: Confidence | null) => {
    if (c) setConfidence(c);
    setRevealed(true);
  };
  const check = () => {
    if (!typed.trim()) return;
    setVerdict(compareTyped(card.back, typed).verdict);
    setRevealed(true);
  };

  // Keys: space/enter shows the answer; 1–4 rate it.
  const keys = useRef({ revealed, rate, reveal, kind: card.kind });
  keys.current = { revealed, rate, reveal, kind: card.kind };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys.current;
      if (!k.revealed && (e.key === ' ' || e.key === 'Enter') && (k.kind === 'basic' || k.kind === 'cloze')) {
        e.preventDefault();
        k.reveal(null);
      } else if (k.revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        k.rate(Number(e.key) as ReviewRating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <KindBadge kind={card.kind} />
          {card.schedule.phase === 0 && <Badge tone="accent">novo</Badge>}
          {card.leech && <Badge tone="warning">difícil</Badge>}
          {card.topicTitle && <span className="truncate text-xs text-subtle">{card.topicTitle}</span>}
        </div>
        <Menu
          label="Ações do cartão"
          trigger={
            <IconButton label="Ações do cartão" size="sm">
              <Ellipsis className="size-4" />
            </IconButton>
          }
          items={[
            { label: 'Editar cartão', onSelect: onEdit },
            { label: 'Ajuda da IA (difícil de lembrar)', icon: <Sparkles />, onSelect: onHelp },
            { label: 'Suspender (tirar das revisões)', onSelect: onSuspend },
          ]}
        />
      </div>

      <div className="space-y-2">
        <CardPrompt card={card} revealed={revealed} prompt={asked} />
        {prompt && (
          <button type="button" className="text-xs text-muted hover:text-accent" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? 'Ver a pergunta de outro jeito' : 'Pergunta feita de outro jeito · ver a original'}
          </button>
        )}
      </div>

      {/* Answering */}
      {!revealed && (card.kind === 'basic' || card.kind === 'cloze') && (
        askConfidence ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">Lembre a resposta. Quão certo você está?</p>
            <div className="grid grid-cols-3 gap-2">
              {CONFIDENCES.map((c) => (
                <Button key={c} variant="outline" onClick={() => reveal(c)}>
                  {CONFIDENCE_LABELS[c]}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={() => reveal(null)}>
            Mostrar resposta <span className="text-xs opacity-70">(espaço)</span>
          </Button>
        )
      )}

      {!revealed && card.kind === 'typed' && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Digite a resposta" aria-label="Sua resposta" />
          {askConfidence && <ConfidencePicker value={confidence} onChange={setConfidence} />}
          <Button type="submit" variant="primary" className="w-full" disabled={!typed.trim()}>
            Conferir
          </Button>
        </form>
      )}

      {!revealed && aiGraded && (
        <div className="space-y-3">
          <AnswerBox
            label="Sua resposta"
            value={text}
            onChange={setText}
            rows={card.kind === 'essay' ? 8 : 4}
            placeholder={card.kind === 'essay' ? 'Escreva (ou fale) a sua explicação, sem consultar as notas.' : 'Responda em poucas frases.'}
            disabled={evaluate.isPending}
            onSubmit={() => text.trim() && evaluate.mutate()}
          />
          {askConfidence && <ConfidencePicker value={confidence} onChange={setConfidence} />}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Sparkles className="size-4" />} loading={evaluate.isPending} disabled={!text.trim()} onClick={() => evaluate.mutate()}>
              {evaluate.isPending ? 'Corrigindo pelas suas notas…' : 'Corrigir com a IA'}
            </Button>
            <Button variant="ghost" disabled={evaluate.isPending} onClick={() => reveal(null)}>
              Ver a resposta modelo e avaliar sozinho
            </Button>
          </div>
        </div>
      )}

      {/* The answer */}
      {revealed && (
        <div className="space-y-4 border-t border-border pt-4">
          {card.kind === 'typed' && verdict && (
            <div className="space-y-1 text-sm">
              <Badge tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Badge>
              <p>
                Você: <span className="font-medium">{typed}</span>
              </p>
              <p>
                Resposta: <span className="font-medium">{card.back}</span>
              </p>
            </div>
          )}
          {(card.kind === 'basic' || (card.kind === 'cloze' && card.back)) && <p className="text-base whitespace-pre-wrap">{card.back}</p>}
          {aiGraded && (evaluation ? <EvaluationView evaluation={evaluation} /> : <ModelAnswer card={card} />)}
          <CardSource card={card} />
        </div>
      )}

      {revealed && due && (
        <div className="space-y-2">
          {suggested && (
            <p className="text-xs text-muted">
              Sugestão: <strong>{RATING_LABELS[suggested]}</strong>. Se discordar, escolha outra: fica registrado.
            </p>
          )}
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Como foi">
            {RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => rate(r)}
                className={cn('flex flex-col items-center rounded-lg border bg-surface px-1 py-2 text-sm font-medium transition-colors', RATING_STYLE[r], suggested === r && 'ring-2 ring-current')}
              >
                {RATING_LABELS[r]}
                <span className="text-[11px] font-normal text-muted tabular-nums">{formatInterval(now.toISOString(), due[r])}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-subtle">Teclas 1 a 4. O tempo embaixo é quando o item volta.</p>
        </div>
      )}
    </Card>
  );
}

function ConfidencePicker({ value, onChange }: { value: Confidence | null; onChange: (c: Confidence | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">Quão certo você está?</span>
      {CONFIDENCES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value === c ? null : c)}
          className={cn('rounded-full border px-2.5 py-1', value === c ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:bg-surface-2')}
          aria-pressed={value === c}
        >
          {CONFIDENCE_LABELS[c]}
        </button>
      ))}
    </div>
  );
}

function ModelAnswer({ card }: { card: ReviewCard }) {
  return (
    <div className="space-y-2 text-sm">
      {card.back && (
        <div>
          <p className="text-xs font-medium text-muted">Resposta modelo</p>
          <p className="whitespace-pre-wrap">{card.back}</p>
        </div>
      )}
      {card.keyPoints.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Uma boa resposta tem</p>
          <ul className="list-disc pl-5">
            {card.keyPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const POINT_ICON = {
  covered: <Check className="size-4 text-success" aria-label="Coberto" />,
  partial: <Minus className="size-4 text-warning" aria-label="Em parte" />,
  missing: <X className="size-4 text-danger" aria-label="Faltou" />,
};

/** The AI correction: each key point, contradictions of the notes, a model answer. */
export function EvaluationView({ evaluation }: { evaluation: ReviewEvaluation }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <span className={cn('text-2xl font-semibold tabular-nums', evaluation.score >= 85 ? 'text-success' : evaluation.score >= 60 ? 'text-warning' : 'text-danger')}>{evaluation.score}</span>
        <p className="text-muted">{evaluation.feedback}</p>
      </div>
      <ul className="space-y-1.5" aria-label="Pontos-chave">
        {evaluation.points.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 shrink-0">{POINT_ICON[p.status]}</span>
            <span>
              <span className="font-medium">{p.point}</span>
              {p.evidence && <span className="block text-xs text-muted">{p.evidence}</span>}
            </span>
          </li>
        ))}
      </ul>
      {evaluation.errors.length > 0 && (
        <div className="rounded-lg bg-danger-soft px-3 py-2">
          <p className="text-xs font-medium text-danger">Contradiz as suas notas</p>
          <ul className="mt-1 space-y-1">
            {evaluation.errors.map((e, i) => (
              <li key={i}>
                <span className="line-through decoration-danger/60">{e.claim}</span> → {e.correction}
              </li>
            ))}
          </ul>
        </div>
      )}
      {evaluation.noteIssue && (
        <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Sobre a nota:</strong> {evaluation.noteIssue} (isso não contou contra você)
          </span>
        </p>
      )}
      <details className="rounded-lg border border-border px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted">
          <CircleHelp className="size-3.5" aria-hidden /> Resposta modelo (só com o que está nas notas)
        </summary>
        <p className="mt-2 whitespace-pre-wrap">{evaluation.modelAnswer}</p>
      </details>
    </div>
  );
}
