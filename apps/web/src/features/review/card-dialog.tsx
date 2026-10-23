import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Brackets, RotateCcw, Trash, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { CARD_KINDS, CARD_KIND_LABELS, KEY_POINTS_MAX, clozeIndices, uuidv7, type CardKind, type ReviewCard } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Checkbox, Field, Segmented, Textarea } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { TopicSelect } from '../topics/topic-dialogs';
import { CardSource, dueLabel } from './card-view';
import { HelpDialog } from './help-dialog';
import { useInvalidateReview } from './use-review';

export interface CardDraft {
  kind?: CardKind;
  front?: string;
  back?: string;
  keyPoints?: string[];
  topicId?: string | null;
  noteId?: string | null;
  noteTitle?: string | null;
  sourceQuote?: string;
}

const BACK_LABEL: Record<CardKind, string> = {
  basic: 'Resposta',
  cloze: 'Comentário',
  typed: 'Resposta esperada',
  open: 'Resposta modelo',
  essay: 'Resposta modelo',
};

const FRONT_HINT: Partial<Record<CardKind, string>> = {
  cloze: 'Selecione palavras e toque em “Marcar lacuna”, ou escreva {{c1::termo}}. Cada número vira um cartão.',
  typed: 'Você vai digitar a resposta; acentos e maiúsculas não contam. Várias respostas aceitas: separe com " | ".',
  open: 'Uma pergunta para responder em poucas frases. A IA corrige pelos pontos-chave e pela nota.',
  essay: 'Peça uma explicação: “Explique…”, “Compare…”, “Por que…”. A IA corrige pelos pontos-chave e pela nota.',
};

/** Creates a card (from scratch or from a passage of a note) or edits one. */
export function CardDialog({
  open,
  onOpenChange,
  card,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: ReviewCard | null;
  draft?: CardDraft;
  onSaved?: (cards: ReviewCard[]) => void;
}) {
  const invalidate = useInvalidateReview();
  const confirm = useConfirm();
  const editing = !!card;
  const [kind, setKind] = useState<CardKind>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [points, setPoints] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [reverse, setReverse] = useState(false);
  const [help, setHelp] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const [id, setId] = useState(uuidv7);

  // Filled when the dialog opens (not on later renders of the page behind it, which would erase what is being typed).
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    const src = card ?? draft ?? {};
    setKind(src.kind ?? 'basic');
    setFront(src.front ?? '');
    setBack(src.back ?? '');
    setPoints((src.keyPoints ?? []).join('\n'));
    setTopicId(src.topicId ?? null);
    setReverse(false);
    setId(uuidv7());
  }, [open, card, draft]);

  const noteId = card?.noteId ?? draft?.noteId ?? null;
  const keyPoints = points
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, KEY_POINTS_MAX);
  const blanks = kind === 'cloze' ? clozeIndices(front).length : 0;
  const ready = front.trim().length > 0 && (kind === 'cloze' ? blanks > 0 : kind === 'open' || kind === 'essay' ? keyPoints.length > 0 || back.trim().length > 0 : back.trim().length > 0);

  const save = useMutation({
    mutationFn: async () => {
      if (card) {
        return [await endpoints.review.updateCard(card.id, { baseVersion: card.version, front, back, ...(card.kind === 'open' || card.kind === 'essay' ? { keyPoints } : {}), ...(card.noteId ? {} : { topicId }) })];
      }
      return endpoints.review.createCards({
        id,
        kind,
        front,
        back,
        keyPoints: kind === 'open' || kind === 'essay' ? keyPoints : [],
        topicId: noteId ? null : topicId,
        noteId,
        sourceQuote: draft?.sourceQuote ?? '',
        reverse: (kind === 'basic' || kind === 'typed') && reverse,
      });
    },
    onSuccess: (cards) => {
      invalidate();
      toast.success(editing ? 'Cartão salvo' : cards.length > 1 ? `${cards.length} cartões criados` : 'Cartão criado');
      onSaved?.(cards);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const change = useMutation({
    mutationFn: (patch: { status?: 'active' | 'suspended'; reset?: boolean }) => endpoints.review.updateCard(card!.id, { baseVersion: card!.version, ...patch }),
    onSuccess: (saved) => {
      invalidate();
      onSaved?.([saved]);
      toast.success(saved.status === 'suspended' ? 'Cartão suspenso: ele não aparece nas revisões' : 'Cartão atualizado');
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = async () => {
    if (!card || !(await confirm({ title: 'Excluir este cartão?', description: 'O histórico de respostas dele também é apagado.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.review.removeCard(card.id);
      invalidate();
      onSaved?.([]);
      toast.success('Cartão excluído');
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  /** Wraps the selected words of the text in the next cloze number. */
  const markBlank = () => {
    const el = frontRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const n = Math.max(0, ...clozeIndices(front)) + 1;
    const picked = front.slice(a, b).trim();
    if (!picked) {
      toast.info('Selecione no texto as palavras que vão virar lacuna.');
      return;
    }
    const next = `${front.slice(0, a)}{{c${n}::${front.slice(a, b)}}}${front.slice(b)}`;
    setFront(next);
    requestAnimationFrame(() => el.focus());
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? 'Editar cartão' : 'Novo cartão'}
        description={!editing && draft?.noteTitle ? `Da nota “${draft.noteTitle}”` : undefined}
        size="lg"
        footer={
          <>
            {card && (
              <div className="mr-auto flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" icon={<Trash className="size-4" />} onClick={() => void remove()}>
                  Excluir
                </Button>
                <Button variant="ghost" size="sm" loading={change.isPending} onClick={() => change.mutate({ status: card.status === 'active' ? 'suspended' : 'active' })}>
                  {card.status === 'active' ? 'Suspender' : 'Reativar'}
                </Button>
                {card.schedule.reps > 0 && (
                  <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => change.mutate({ reset: true })}>
                    Recomeçar
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon={<WandSparkles className="size-4" />} onClick={() => setHelp(true)}>
                  Ajuda da IA
                </Button>
              </div>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
              {editing ? 'Salvar' : kind === 'cloze' && blanks > 1 ? `Criar ${blanks} cartões` : reverse ? 'Criar 2 cartões' : 'Criar cartão'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {card ? (
            <p className="text-xs text-muted">
              {CARD_KIND_LABELS[card.kind]} · {dueLabel(card)} · {card.schedule.reps} {card.schedule.reps === 1 ? 'revisão' : 'revisões'}, {card.schedule.lapses} {card.schedule.lapses === 1 ? 'erro' : 'erros'}
            </p>
          ) : (
            <Segmented label="Tipo de cartão" value={kind} onChange={setKind} options={CARD_KINDS.map((k) => ({ value: k, label: CARD_KIND_LABELS[k] }))} size="sm" />
          )}
          {draft?.sourceQuote && !editing && <CardSource card={{ noteId: null, noteTitle: null, sourceQuote: draft.sourceQuote, sourceChanged: false, topicTitle: null }} />}

          <Field label={kind === 'cloze' ? 'Texto com lacunas' : 'Pergunta'} hint={FRONT_HINT[kind]}>
            {(p) => (
              <div className="space-y-2">
                <Textarea {...p} ref={frontRef} rows={kind === 'cloze' ? 4 : 3} value={front} onChange={(e) => setFront(e.target.value)} autoFocus />
                {kind === 'cloze' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" icon={<Brackets className="size-4" />} onMouseDown={(e) => e.preventDefault()} onClick={markBlank}>
                      Marcar lacuna
                    </Button>
                    <span className="text-xs text-muted">{blanks === 0 ? 'Nenhuma lacuna ainda.' : `${blanks} ${blanks === 1 ? 'lacuna (1 cartão)' : `lacunas (${blanks} cartões)`}`}</span>
                  </div>
                )}
              </div>
            )}
          </Field>

          <Field label={BACK_LABEL[kind]} optional={kind === 'cloze' || kind === 'open' || kind === 'essay'}>
            {(p) => <Textarea {...p} rows={kind === 'essay' ? 5 : 3} value={back} onChange={(e) => setBack(e.target.value)} />}
          </Field>

          {(kind === 'open' || kind === 'essay') && (
            <Field label="Pontos-chave" hint="Um por linha: o que uma boa resposta precisa ter. A correção marca cada um como coberto, em parte ou faltando.">
              {(p) => <Textarea {...p} rows={4} value={points} onChange={(e) => setPoints(e.target.value)} placeholder={'Ex.:\nusa luz, água e gás carbônico\nproduz glicose e oxigênio'} />}
            </Field>
          )}

          {!noteId && (
            <Field label="Assunto" hint="Os cartões de uma nota seguem o assunto dela.">
              {(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}
            </Field>
          )}
          {!editing && (kind === 'basic' || kind === 'typed') && <Checkbox checked={reverse} onChange={setReverse} label="Criar também o inverso (resposta → pergunta)" />}
        </div>
      </Dialog>
      {card && <HelpDialog open={help} onOpenChange={setHelp} card={card} onChanged={() => onOpenChange(false)} />}
    </>
  );
}
