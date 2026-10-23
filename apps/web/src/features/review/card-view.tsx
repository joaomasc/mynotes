import { Link } from 'react-router';
import { StickyNote, TriangleAlert } from 'lucide-react';
import { CARD_KIND_LABELS, clozeSegments, formatInterval, renderCloze, type CardKind, type ReviewCard } from '@mynotes/shared';
import { Badge } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';

export const KIND_TONE: Record<CardKind, 'neutral' | 'accent' | 'success' | 'warning'> = {
  basic: 'neutral',
  cloze: 'neutral',
  typed: 'neutral',
  open: 'accent',
  essay: 'accent',
};

export function KindBadge({ kind }: { kind: CardKind }) {
  return <Badge tone={KIND_TONE[kind]}>{CARD_KIND_LABELS[kind]}</Badge>;
}

/** The question of a card: the front, or the cloze text with this card's blanks hidden (or shown, once revealed). */
export function CardPrompt({ card, revealed, prompt, className }: { card: Pick<ReviewCard, 'kind' | 'front' | 'clozeIndex'>; revealed: boolean; prompt?: string | null; className?: string }) {
  if (card.kind === 'cloze') {
    return (
      <p data-review-prompt className={cn('text-lg leading-relaxed whitespace-pre-wrap', className)}>
        {clozeSegments(card.front, card.clozeIndex ?? 1).map((s, i) =>
          s.blank === 'active' ? (
            <span
              key={i}
              className={cn('rounded px-1 font-semibold', revealed ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent')}
              data-blank={revealed ? 'revealed' : 'hidden'}
            >
              {revealed ? s.text : `[${s.hint ?? '…'}]`}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
    );
  }
  return (
    <p data-review-prompt className={cn('text-lg leading-relaxed whitespace-pre-wrap', className)}>
      {prompt || card.front}
    </p>
  );
}

/** One-line text of a card for lists (cloze: the blanks between brackets). */
export function cardLine(card: Pick<ReviewCard, 'kind' | 'front' | 'clozeIndex'>): string {
  return card.kind === 'cloze' ? renderCloze(card.front, card.clozeIndex ?? 1).prompt : card.front;
}

/** Where the card came from: its note, the quoted passage, and a warning when the passage changed. */
export function CardSource({ card }: { card: Pick<ReviewCard, 'noteId' | 'noteTitle' | 'sourceQuote' | 'sourceChanged' | 'topicTitle'> }) {
  if (!card.noteId && !card.sourceQuote) return card.topicTitle ? <p className="text-xs text-subtle">Assunto: {card.topicTitle}</p> : null;
  return (
    <div className="space-y-1.5 text-xs text-muted">
      {card.noteId && (
        <Link to={`/notes/${card.noteId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          <StickyNote className="size-3.5" aria-hidden /> {card.noteTitle || 'Nota sem título'}
        </Link>
      )}
      {card.sourceQuote && <blockquote className="border-l-2 border-border pl-2 italic">{card.sourceQuote}</blockquote>}
      {card.sourceChanged && (
        <p className="flex items-center gap-1 text-warning">
          <TriangleAlert className="size-3.5" aria-hidden /> O trecho mudou na nota. Confira se o cartão continua certo.
        </p>
      )}
    </div>
  );
}

/** "novo", "hoje", "em 3 d"… */
export function dueLabel(card: Pick<ReviewCard, 'schedule' | 'status'>, now = new Date()): string {
  if (card.status === 'suspended') return 'suspenso';
  if (card.schedule.phase === 0) return 'novo';
  if (Date.parse(card.schedule.due) <= now.getTime()) return 'para hoje';
  return `volta em ${formatInterval(now.toISOString(), card.schedule.due)}`;
}
