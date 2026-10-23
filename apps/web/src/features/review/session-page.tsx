import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CloudOff, Sparkles, Target } from 'lucide-react';
import { toast } from 'sonner';
import {
  LEECH_LAPSES,
  REVIEW_MODES,
  REVIEW_MODE_LABELS,
  afterAnswer,
  isAiGraded,
  isConfidentError,
  uuidv7,
  type QueueItem,
  type ReviewCard,
  type ReviewMode,
  type ReviewSessionSummary,
} from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageLoader, Progress } from '@/components/ui/feedback';
import { Page } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { CardDialog } from './card-dialog';
import { GenerateDialog } from './generate-dialog';
import { HelpDialog } from './help-dialog';
import { sendAnswer, useOutbox } from './outbox';
import { RecallSession } from './recall-session';
import { SessionCard, type CardResult } from './session-card';
import { SessionSummaryView } from './session-summary';
import { reviewLink, sessionLink, useInvalidateReview, useReviewSettings } from './use-review';

/** Time counted per answer at most (a card left open while away does not inflate the session). */
const MAX_SECONDS_PER_ITEM = 300;

export function Component() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const mode = params.get('mode') as ReviewMode | null;
  const topicIds = (params.get('topics') ?? '').split(',').filter(Boolean);
  if (!mode || !REVIEW_MODES.includes(mode)) return <PastSession id={id} />;
  return <LiveSession key={id} id={id} mode={mode} topicIds={topicIds} limit={Number(params.get('limit')) || undefined} recallTopic={params.get('topic')} />;
}

/** A session opened from the history: its summary. */
function PastSession({ id }: { id: string }) {
  const q = useQuery({ queryKey: qk.reviewSession(id), queryFn: () => endpoints.review.session(id) });
  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Page width="narrow">
      <SessionSummaryView summary={q.data} />
    </Page>
  );
}

function LiveSession({ id, mode, topicIds, limit, recallTopic }: { id: string; mode: ReviewMode; topicIds: string[]; limit: number | undefined; recallTopic: string | null }) {
  const { settings, isLoading: settingsLoading } = useReviewSettings();
  const { tree } = useTopics();
  const invalidate = useInvalidateReview();
  const pending = useOutbox();
  const [cards, setCards] = useState<Map<string, ReviewCard>>(new Map());
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [variants, setVariants] = useState<Map<string, string>>(new Map());
  const [summary, setSummary] = useState<ReviewSessionSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [finishing, setFinishing] = useState(false);
  const [editing, setEditing] = useState<ReviewCard | null>(null);
  const [helping, setHelping] = useState<ReviewCard | null>(null);
  const [generate, setGenerate] = useState(false);
  const seconds = useRef(0);
  const shownAt = useRef(Date.now());
  const sends = useRef<Promise<unknown>>(Promise.resolve());
  const started = useRef(false);

  // Start (or resume) the session and load its items once.
  useEffect(() => {
    if (started.current || settingsLoading) return;
    started.current = true;
    void (async () => {
      try {
        const session = await endpoints.review.startSession({ id, mode, topicIds, localDay: todayIso() });
        if (session.finishedAt) {
          setSummary(await endpoints.review.session(id));
          return;
        }
        if (mode === 'recall') {
          setQueue([]);
          return;
        }
        const q = await endpoints.review.queue({ topicIds, mode, today: todayIso(), limit: limit ?? settings.sessionSize });
        setCards(new Map(q.cards.map((c) => [c.id, c])));
        setQueue(q.cards.map((c) => ({ cardId: c.id, round: 0 })));
        setTotal(q.cards.length);
        shownAt.current = Date.now();
        // Questions answered before come back asked another way (best effort: without the AI they stay as written).
        const again = q.cards.filter((c) => isAiGraded(c.kind) && c.schedule.reps > 0).map((c) => c.id);
        if (again.length) {
          endpoints.review
            .variants(again.slice(0, 20))
            .then((v) => setVariants(new Map(v.variants.map((x) => [x.cardId, x.prompt]))))
            .catch(() => undefined);
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [id, mode, topicIds, limit, settings.sessionSize, settingsLoading]);

  const finish = async () => {
    setFinishing(true);
    try {
      await sends.current;
      const s = await endpoints.review.finishSession(id, Math.round(seconds.current));
      setSummary(s);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFinishing(false);
    }
  };

  const onRate = (card: ReviewCard, result: CardResult) => {
    seconds.current += Math.min(MAX_SECONDS_PER_ITEM, (Date.now() - shownAt.current) / 1000);
    shownAt.current = Date.now();
    const body = { id: uuidv7(), sessionId: id, localDay: todayIso(), ...result };
    // Answers go one after the other (a card may come back in the same session).
    sends.current = sends.current
      .then(() => sendAnswer(card.id, body))
      .then((res) => {
        if (res) setCards((prev) => new Map(prev).set(res.card.id, res.card));
      })
      .catch((err) => toast.error(errorMessage(err)));
    if (result.rating === 1 && card.schedule.lapses + 1 >= LEECH_LAPSES && card.schedule.phase === 2) {
      toast.warning('Este cartão é difícil: você já errou várias vezes.', { action: { label: 'Pedir ajuda à IA', onClick: () => setHelping(card) } });
    }
    if (isConfidentError(result.rating, result.confidence)) {
      toast.info('Errou tendo certeza: ele volta logo depois do próximo item, para fixar.');
    }
    // A mistake comes back three items later; one made with certainty, right after the next item.
    const next = afterAnswer(queue ?? [], result.rating, isConfidentError(result.rating, result.confidence) ? 1 : 3);
    if (next.length > (queue?.length ?? 0) - 1) setTotal((t) => t + 1);
    setDone((d) => d + 1);
    setQueue(next);
    if (next.length === 0) void finish();
  };

  const dropCurrent = (cardId: string) => {
    setQueue((q) => (q ?? []).filter((i) => i.cardId !== cardId));
    setTotal((t) => Math.max(0, t - 1));
  };

  if (error) return <ErrorState error={error} />;
  if (summary) {
    return (
      <Page width="narrow">
        <SessionSummaryView summary={summary} />
      </Page>
    );
  }
  if (queue === null) return <PageLoader />;

  const header = (
    <div className="mb-5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Link to={reviewLink(topicIds)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> Revisar
        </Link>
        <span className="text-sm font-medium">{REVIEW_MODE_LABELS[mode]}</span>
        {mode === 'recall' ? (
          <span />
        ) : (
          <Button variant="ghost" size="sm" loading={finishing} onClick={() => void finish()} disabled={done === 0}>
            Encerrar
          </Button>
        )}
      </div>
      {mode !== 'recall' && total > 0 && (
        <>
          <Progress value={(done / Math.max(1, done + queue.length)) * 100} label="Andamento da sessão" />
          <p className="text-right text-xs text-muted tabular-nums">
            {done} {done === 1 ? 'resposta' : 'respostas'} · faltam {queue.length}
          </p>
        </>
      )}
      {pending > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <CloudOff className="size-3.5" aria-hidden /> Sem internet: {pending} {pending === 1 ? 'resposta guardada' : 'respostas guardadas'} para enviar depois.
        </p>
      )}
    </div>
  );

  if (mode === 'recall') {
    const topic = recallTopic ? tree.byId.get(recallTopic) : undefined;
    return (
      <Page width="narrow">
        {header}
        {recallTopic ? (
          <RecallSession sessionId={id} topicId={recallTopic} topicTitle={topic?.title ?? '…'} onFinish={() => void finish()} finishing={finishing} />
        ) : (
          <EmptyState title="Escolha um assunto" description="Volte e marque o assunto de que você quer lembrar." />
        )}
      </Page>
    );
  }

  if (total === 0) {
    return (
      <Page width="narrow">
        {header}
        <EmptyState
          icon={<Target />}
          title="Nada para revisar agora"
          description={mode === 'practice' ? 'Esta seleção ainda não tem cartões.' : 'Nada vence nesta seleção hoje. Você pode treinar mesmo assim, criar cartões ou pedir perguntas à IA.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {mode !== 'practice' && (
                <Link to={sessionLink(uuidv7(), { topicIds, mode: 'practice' })}>
                  <Button variant="outline" icon={<Target className="size-4" />}>
                    Treino livre
                  </Button>
                </Link>
              )}
              {topicIds.length > 0 && (
                <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setGenerate(true)}>
                  Gerar perguntas
                </Button>
              )}
            </div>
          }
        />
        <GenerateDialog open={generate} onOpenChange={setGenerate} topicIds={topicIds} label="os assuntos desta sessão" />
      </Page>
    );
  }

  const current = queue[0];
  const card = current ? cards.get(current.cardId) : undefined;
  return (
    <Page width="narrow">
      {header}
      {card && current ? (
        <SessionCard
          key={`${card.id}:${current.round}:${done}`}
          card={card}
          prompt={current.round === 0 ? (variants.get(card.id) ?? null) : null}
          askConfidence={settings.askConfidence}
          desiredRetention={settings.desiredRetention}
          onRate={(r) => onRate(card, r)}
          onEdit={() => setEditing(card)}
          onHelp={() => setHelping(card)}
          onSuspend={() => {
            void endpoints.review
              .updateCard(card.id, { baseVersion: card.version, status: 'suspended' })
              .then(() => {
                toast.success('Cartão suspenso');
                invalidate();
              })
              .catch((err) => toast.error(errorMessage(err)));
            dropCurrent(card.id);
          }}
        />
      ) : (
        <PageLoader />
      )}
      <CardDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        card={editing}
        onSaved={(saved) => {
          const c = saved[0];
          if (c && c.status === 'active') setCards((prev) => new Map(prev).set(c.id, c));
          else if (editing) dropCurrent(editing.id);
        }}
      />
      {helping && <HelpDialog open={!!helping} onOpenChange={(o) => !o && setHelping(null)} card={helping} onChanged={() => helping && dropCurrent(helping.id)} />}
    </Page>
  );
}
