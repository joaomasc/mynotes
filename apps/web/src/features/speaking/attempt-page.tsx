import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDown, Columns2, Dumbbell, Ellipsis, Gavel, Headphones, Mic, RefreshCw, Sparkles, Trash } from 'lucide-react';
import { toast } from 'sonner';
import {
  CRITERIA_INFO,
  DIMENSION_LABELS,
  SPEECH_TYPE_LABELS,
  TEXT_AI_CRITERIA,
  type CriterionResult,
  type SpeechAttempt,
  type SpeechDimension,
  type SpeechImprovement,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { ErrorState, PageLoader, Spinner } from '@/components/ui/feedback';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { MarkedTranscript } from './marked-transcript';
import { StateBadge, attemptTitle, clock, scoreTone } from './speaking-ui';
import { VoiceChart } from './voice-chart';

const SOURCE_LABELS: Record<CriterionResult['source'], string> = {
  measured: 'medido pelo app',
  textAi: 'IA lendo a transcrição',
  audioAi: 'IA ouvindo o áudio',
};

const SEVERITY = { improve: 0, attention: 1, good: 2, na: 3 } as const;

/** The original sentence and a better version, one above the other. */
function Rewrite({ original, rewrite }: { original: string | null; rewrite: string | null }) {
  if (!rewrite) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
      {original && <p className="text-muted">“{original}”</p>}
      {original && <ArrowDown className="size-3.5 text-subtle" aria-label="melhor assim" />}
      <p className="font-medium">“{rewrite}”</p>
    </div>
  );
}

/** Up to 3 things to work on: the model's, or the worst measured criteria while there is no evaluation. */
function improvementsOf(a: SpeechAttempt): SpeechImprovement[] {
  if (a.evaluation) return a.evaluation.improvements;
  return a.measured
    .filter((m) => m.state === 'improve' || m.state === 'attention')
    .sort((x, y) => SEVERITY[x.state] - SEVERITY[y.state])
    .slice(0, 3)
    .map((m) => ({ title: CRITERIA_INFO[m.id].label, detail: `${m.value}. Referência: ${m.reference}.`, original: null, rewrite: null }));
}

/** Every criterion of a dimension, the model's ones shown as pending until evaluated. */
function criteriaOf(a: SpeechAttempt, dim: SpeechDimension): CriterionResult[] {
  const text: CriterionResult[] =
    a.evaluation?.criteria ??
    TEXT_AI_CRITERIA.map((id) => ({
      id,
      state: 'na' as const,
      value: 'Aguardando a avaliação da IA.',
      reference: CRITERIA_INFO[id].good,
      source: 'textAi' as const,
      original: null,
      rewrite: null,
    }));
  return [...a.measured, ...text, ...(a.fullEvaluation?.criteria ?? [])].filter((c) => CRITERIA_INFO[c.id].dimension === dim);
}

/** The kept recording, fetched with the session (an <audio> cannot send the token). */
function AudioPlayer({ id, audioRef }: { id: string; audioRef: RefObject<HTMLAudioElement | null> }) {
  const blob = useQuery({ queryKey: ['speech-audio', id], queryFn: () => endpoints.speech.audio(id), staleTime: Infinity, gcTime: 60_000 });
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (blob.isError) return <p className="text-sm text-muted">Não foi possível carregar a gravação.</p>;
  if (!url) return <Spinner className="size-4" label="Carregando a gravação" />;
  return <audio ref={audioRef} src={url} controls className="w-full" preload="metadata" />;
}

/** A model listening to the recording: presence and the voice itself. */
function FullEvaluationCard({ attempt, aiReady }: { attempt: SpeechAttempt; aiReady: boolean }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (force: boolean) => endpoints.speech.fullEvaluation(attempt.id, force),
    onSuccess: (a) => {
      qc.setQueryData(qk.speechAttempt(a.id), a);
      void qc.invalidateQueries({ queryKey: qk.speechAttempts });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const f = attempt.fullEvaluation;
  return (
    <Section title="Avaliação completa (IA ouvindo)">
      <Card className="space-y-3 p-4 text-sm">
        {run.isPending ? (
          <p className="flex items-center gap-2 text-muted">
            <Spinner className="size-4" label="Ouvindo" /> O professor está ouvindo a sua fala…
          </p>
        ) : f ? (
          <>
            <p>{f.summary}</p>
            {f.remarks.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {f.remarks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-subtle">
                Ouviu {Math.round(f.heardSeconds)} s{f.heardSeconds < attempt.durationSeconds - 2 ? ' (abertura e conclusão)' : ''}. Os critérios de presença estão abaixo.
              </p>
              {aiReady && (
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => run.mutate(true)}>
                  Ouvir de novo
                </Button>
              )}
            </div>
          </>
        ) : attempt.hasAudio ? (
          <>
            <p className="text-muted">
              A IA ouve a abertura e a conclusão (até 90 s) e julga segurança, naturalidade, ênfase, energia e estabilidade da voz. Custa alguns centavos de dólar e conta no orçamento diário.
            </p>
            {aiReady ? (
              <Button size="sm" variant="primary" icon={<Headphones className="size-4" />} onClick={() => run.mutate(false)}>
                Pedir a avaliação completa
              </Button>
            ) : (
              <p className="text-xs text-subtle">O assistente de IA não está configurado nesta instalação.</p>
            )}
          </>
        ) : (
          <p className="text-muted">
            A presença (segurança, naturalidade, ênfase, energia) só se avalia ouvindo. Ative “Guardar a gravação das falas” em{' '}
            <Link to="/speaking/progress" className="text-accent hover:underline">
              Progresso
            </Link>{' '}
            e grave de novo.
          </p>
        )}
      </Card>
    </Section>
  );
}

function CriterionRow({ c }: { c: CriterionResult }) {
  return (
    <details className="group px-4 py-3">
      <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{CRITERIA_INFO[c.id].label}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted group-open:line-clamp-none">{c.value}</p>
        </div>
        <StateBadge state={c.state} />
      </summary>
      <div className="mt-2 space-y-1 text-xs text-muted">
        <p>
          <span className="font-medium text-text">Referência:</span> {c.reference}
        </p>
        <p>
          <span className="font-medium text-text">Origem:</span> {SOURCE_LABELS[c.source]}
        </p>
        <Rewrite original={c.original} rewrite={c.rewrite} />
      </div>
    </details>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { tree } = useTopics();
  const audioRef = useRef<HTMLAudioElement>(null);
  const query = useQuery({ queryKey: qk.speechAttempt(id), queryFn: () => endpoints.speech.get(id) });
  const ai = useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
  const evaluate = useMutation({
    mutationFn: (force: boolean) => endpoints.speech.evaluate(id, force),
    onSuccess: (attempt) => {
      qc.setQueryData(qk.speechAttempt(id), attempt);
      void qc.invalidateQueries({ queryKey: qk.speechAttempts });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Right after recording: ask for the evaluation once, without a click.
  const asked = useRef(false);
  const a = query.data;
  const aiReady = !!ai.data?.enabled && !!ai.data.configured;
  useEffect(() => {
    if (params.get('evaluate') !== '1' || !a || asked.current || !ai.data) return;
    asked.current = true;
    setParams({}, { replace: true });
    if (!a.evaluated && aiReady && a.transcript.trim()) evaluate.mutate(false);
  }, [params, a, ai.data, aiReady, evaluate, setParams]);

  if (query.isPending) return <PageLoader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const attempt = query.data;
  const topicTitle = attempt.topicId ? tree.byId.get(attempt.topicId)?.title : null;
  const improvements = improvementsOf(attempt);

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir esta fala?', description: 'A transcrição e o resultado serão apagados.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await endpoints.speech.remove(id);
      qc.removeQueries({ queryKey: qk.speechAttempt(id) });
      void qc.invalidateQueries({ queryKey: qk.speechAttempts });
      void navigate('/speaking');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        title={attemptTitle(attempt, topicTitle)}
        subtitle={`${format(new Date(attempt.startedAt), "d 'de' MMMM, HH:mm", { locale: ptBR })} · ${clock(attempt.durationSeconds)}${
          attempt.metrics.targetSeconds ? ` (meta ${clock(attempt.metrics.targetSeconds)})` : ''
        } · ${SPEECH_TYPE_LABELS[attempt.speechType]}`}
        actions={
          <>
            {aiReady && attempt.speechType !== 'qa' && attempt.transcript.trim() && (
              <Button variant="outline" icon={<Gavel className="size-4" />} onClick={() => void navigate(`/speaking/attempts/${attempt.id}/banca`)}>
                Treinar a banca
              </Button>
            )}
            <Button variant="outline" icon={<Mic className="size-4" />} onClick={() => void navigate(attempt.lessonId ? `/speaking/lesson/${attempt.lessonId}` : attempt.topicId ? `/speaking/free?topic=${attempt.topicId}` : '/speaking/free')}>
              Falar de novo
            </Button>
            <Menu
              label="Ações da fala"
              trigger={
                <IconButton label="Ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                ...(attempt.evaluated && aiReady
                  ? [{ label: 'Avaliar de novo com a IA', icon: <RefreshCw />, onSelect: () => evaluate.mutate(true) }]
                  : []),
                { label: 'Comparar com outra fala', icon: <Columns2 />, onSelect: () => void navigate(`/speaking/compare?a=${attempt.id}`) },
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
          </>
        }
      />

      <div className="space-y-8">
        {attempt.parentId && (
          <p className="rounded-lg bg-surface-2 p-3 text-sm">
            Resposta à pergunta da banca: <span className="font-medium">“{attempt.theme}”</span>.{' '}
            <Link to={`/speaking/attempts/${attempt.parentId}`} className="text-accent hover:underline">
              Ver a fala original
            </Link>
          </p>
        )}
        <Card className="flex items-center gap-5 p-5">
          <div className="text-center">
            <p className={cn('text-5xl font-semibold tabular-nums', scoreTone(attempt.score))}>{attempt.score ?? '—'}</p>
            <p className="mt-1 text-xs text-subtle">de 100</p>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {evaluate.isPending ? (
              <p className="flex items-center gap-2 text-muted">
                <Spinner className="size-4" label="Avaliando" /> O professor está lendo a sua fala…
              </p>
            ) : attempt.evaluation ? (
              <p>{attempt.evaluation.summary}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-muted">
                  Nota parcial: só a voz e a linguagem medidas. A estrutura, a clareza e as frases reescritas vêm da avaliação da IA.
                </p>
                {aiReady ? (
                  <Button size="sm" variant="primary" icon={<Sparkles className="size-4" />} onClick={() => evaluate.mutate(false)} disabled={!attempt.transcript.trim()}>
                    Avaliar com a IA
                  </Button>
                ) : (
                  ai.data && <p className="text-xs text-subtle">O assistente de IA não está configurado nesta instalação.</p>
                )}
              </div>
            )}
          </div>
        </Card>

        {improvements.length > 0 && (
          <Section title={improvements.length === 1 ? 'Para a próxima vez' : `${improvements.length} coisas para a próxima vez`}>
            <ol className="space-y-3">
              {improvements.map((imp, i) => (
                <li key={i}>
                  <Card className="p-4">
                    <p className="text-sm font-semibold">
                      {i + 1}. {imp.title}
                    </p>
                    <p className="mt-1 text-sm text-muted">{imp.detail}</p>
                    <Rewrite original={imp.original} rewrite={imp.rewrite} />
                  </Card>
                </li>
              ))}
            </ol>
            {attempt.evaluation?.exercise && (
              <Card className="flex gap-3 border-accent-soft bg-accent-soft/40 p-4">
                <Dumbbell className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold">Exercício</p>
                  <p className="mt-0.5 text-muted">{attempt.evaluation.exercise}</p>
                </div>
              </Card>
            )}
          </Section>
        )}

        {(attempt.fullEvaluation ? (['content', 'language', 'voice', 'presence'] as const) : (['content', 'language', 'voice'] as const)).map((dim) => (
          <Section key={dim} title={DIMENSION_LABELS[dim]}>
            <Card className="divide-y divide-border">
              {criteriaOf(attempt, dim).map((c) => (
                <CriterionRow key={c.id} c={c} />
              ))}
            </Card>
          </Section>
        ))}
        <FullEvaluationCard attempt={attempt} aiReady={aiReady} />

        <Section title="Tom e volume ao longo da fala">
          <Card className="p-4">
            <VoiceChart timeline={attempt.timeline} />
          </Card>
        </Section>

        <Section title="Transcrição">
          <Card className="space-y-3 p-4">
            {attempt.hasAudio && <AudioPlayer id={attempt.id} audioRef={audioRef} />}
            <MarkedTranscript
              words={attempt.words}
              marks={attempt.metrics.marks}
              transcript={attempt.transcript}
              onSeek={
                attempt.hasAudio
                  ? (t) => {
                      const audio = audioRef.current;
                      if (!audio) return;
                      audio.currentTime = Math.max(0, t - 0.3);
                      void audio.play();
                    }
                  : undefined
              }
            />
          </Card>
        </Section>
      </div>
    </Page>
  );
}
