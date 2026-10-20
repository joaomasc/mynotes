import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { SpeechGoal } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { ErrorState, PageLoader } from '@/components/ui/feedback';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { QaCard } from './exercises';
import { usePractice, useSpeechPath } from './use-speech-path';

/** What a good answer to the board looks like: direct, short, with few fillers. */
const BOARD_GOALS: SpeechGoal[] = [
  { metric: 'duration', max: 90 },
  { metric: 'fillersPerMinute', max: 3 },
  { metric: 'criterion', id: 'centralIdea', atLeast: 'attention' },
];

/**
 * The examining board for a recorded talk: the model asks three questions
 * about it, and each answer is recorded, linked to the talk and evaluated as
 * an answer.
 */
export function Component() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const path = useSpeechPath();
  const practice = usePractice();
  const [finished, setFinished] = useState<boolean | null>(null);
  const [round, setRound] = useState(0);
  const talk = useQuery({ queryKey: qk.speechAttempt(id), queryFn: () => endpoints.speech.get(id) });
  const ai = useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
  const ask = useMutation({
    mutationFn: (force: boolean) => endpoints.speech.questions(id, force),
    onSuccess: (a) => {
      qc.setQueryData(qk.speechAttempt(id), a);
      setFinished(null);
      setRound((r) => r + 1);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (talk.isPending) return <PageLoader />;
  if (talk.isError) return <ErrorState error={talk.error} onRetry={() => void talk.refetch()} />;
  const a = talk.data;
  const aiReady = !!ai.data?.enabled && !!ai.data.configured;

  return (
    <Page width="narrow">
      <PageHeader
        title="Banca"
        subtitle={
          <>
            Perguntas sobre a sua fala{a.theme ? ` “${a.theme}”` : ''}.{' '}
            <Link to={`/speaking/attempts/${a.id}`} className="text-accent hover:underline">
              Ver a fala
            </Link>
          </>
        }
        actions={
          a.questions && (
            <Button variant="outline" icon={<RefreshCw className="size-4" />} loading={ask.isPending} onClick={() => ask.mutate(true)} disabled={!aiReady}>
              Outras perguntas
            </Button>
          )
        }
      />
      {!a.questions ? (
        <Card className="space-y-4 p-5 text-center">
          <Gavel className="mx-auto size-10 text-accent" aria-hidden />
          <p className="text-sm text-muted">
            A banca lê a sua fala e faz três perguntas: uma de esclarecimento, uma que desafia um argumento e uma que pede um exemplo. Você responde falando, uma de cada vez,
            como numa defesa, entrevista ou debate.
          </p>
          {aiReady ? (
            <Button variant="primary" size="lg" loading={ask.isPending} onClick={() => ask.mutate(false)}>
              Chamar a banca
            </Button>
          ) : (
            ai.data && <p className="text-sm text-subtle">A banca usa a IA, que não está configurada nesta instalação.</p>
          )}
        </Card>
      ) : finished !== null ? (
        <Card className="space-y-4 p-5 text-center">
          <p className="text-lg font-semibold">{finished ? 'A banca ficou satisfeita.' : 'A banca terminou.'}</p>
          <p className="text-sm text-muted">Cada resposta foi salva nas suas falas, com a avaliação da IA.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" icon={<RefreshCw className="size-4" />} loading={ask.isPending} onClick={() => ask.mutate(true)} disabled={!aiReady}>
              Outra rodada
            </Button>
            <Link to="/speaking" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              Voltar à trilha
            </Link>
          </div>
        </Card>
      ) : (
        <QaCard
          key={round}
          instruction="Responda direto, com a resposta na primeira frase, em até 1 minuto. Se não souber, diga com firmeza."
          questions={a.questions}
          seconds={60}
          goals={BOARD_GOALS}
          lessonId={null}
          state={path.data}
          setupOverride={{ mode: a.mode, topicId: a.topicId, parentId: a.id, themeWords: [a.theme] }}
          onDone={async (o) => {
            setFinished(o.passed);
            if (o.attemptId) {
              try {
                await practice.mutateAsync({ kind: 'free', attemptId: o.attemptId, seconds: 180 });
              } catch {
                // The answers are saved; only the XP did not count.
              }
            }
          }}
        />
      )}
    </Page>
  );
}
