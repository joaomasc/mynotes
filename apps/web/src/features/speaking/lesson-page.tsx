import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PartyPopper, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  SKILL_LABELS,
  dueSkills,
  findChallenge,
  findLesson,
  nextStep,
  reviewLesson,
  warmupFor,
  type Challenge,
  type Exercise,
  type Lesson,
  type SkillId,
  type SpeechPathState,
  type SpeechPracticeResult,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageLoader, Progress } from '@/components/ui/feedback';
import { Page } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { ExerciseCard, TalkCard, type ExerciseOutcome } from './exercises';
import { usePractice, useSpeechPath } from './use-speech-path';

/** What a /speaking/lesson/:id address plays. */
type Playable =
  | { kind: 'lesson' | 'review' | 'warmup'; lesson: Lesson; refId: string | null; title: string; subtitle: string }
  | { kind: 'challenge' | 'levelChallenge'; challenge: Challenge; title: string; subtitle: string };

function resolve(id: string, state: SpeechPathState, extra: Exercise[]): Playable | null {
  if (id === 'warmup') {
    const weakest = dueSkills(state.skills, state.today).map((s) => s.skill);
    return { kind: 'warmup', lesson: { id: 'warmup', title: 'Aquecimento', skills: [], exercises: warmupFor(state.today, weakest) }, refId: null, title: 'Aquecimento vocal', subtitle: '2 minutos para acordar a voz' };
  }
  if (id.startsWith('review-')) {
    const skill = id.slice('review-'.length) as SkillId;
    const base = SKILL_LABELS[skill] ? reviewLesson(skill, state.today, new Set(state.completed)) : null;
    if (!base) return null;
    // Fresh exercises written by the model go before the closing talk.
    const talk = base.exercises.at(-1)?.type === 'shortTalk' ? base.exercises.slice(-1) : [];
    const lesson = { ...base, exercises: [...base.exercises.slice(0, base.exercises.length - talk.length), ...extra, ...talk] };
    return { kind: 'review', lesson, refId: skill, title: `Revisão: ${SKILL_LABELS[skill]}`, subtitle: 'Exercícios do que você já aprendeu' };
  }
  const lesson = findLesson(id);
  if (lesson) return { kind: 'lesson', lesson: lesson.lesson, refId: lesson.lesson.id, title: lesson.lesson.title, subtitle: `Unidade ${lesson.unit.number} · ${lesson.unit.title}` };
  const challenge = findChallenge(id);
  if (challenge) {
    return challenge.unit
      ? { kind: 'challenge', challenge: challenge.challenge, title: `Desafio: ${challenge.unit.title}`, subtitle: `Unidade ${challenge.unit.number}` }
      : { kind: 'levelChallenge', challenge: challenge.challenge, title: `Desafio do nível ${challenge.level.number}`, subtitle: challenge.level.title };
  }
  return null;
}

/** Where to go after finishing: the next step of the path. */
function nextHref(state: SpeechPathState): string {
  const step = nextStep(new Set(state.completed));
  if (!step) return '/speaking';
  return `/speaking/lesson/${step.kind === 'lesson' ? step.lesson.id : step.challenge.id}`;
}

function Finished({ result, onRetry, title }: { result: SpeechPracticeResult; onRetry: () => void; title: string }) {
  const navigate = useNavigate();
  const next = nextHref(result.state);
  return (
    <div className="space-y-6 py-6 text-center">
      <PartyPopper className="mx-auto size-12 text-accent" aria-hidden />
      <div>
        <h1 className="text-2xl font-semibold">{result.passed ? (result.completedNow ? `${title}: concluída!` : 'Feito!') : 'Quase lá'}</h1>
        <p className="mt-1 text-muted">
          {result.passed ? 'Continue no seu ritmo: um pouco todo dia vale mais que muito de vez em quando.' : 'Faltou cumprir as metas da fala. Tente de novo quando quiser: o XP já conta.'}
        </p>
      </div>
      <div className="flex justify-center gap-6">
        <div>
          <p className="text-3xl font-semibold text-accent tabular-nums">+{result.xp}</p>
          <p className="text-xs text-muted">XP</p>
        </div>
        <div>
          <p className="text-3xl font-semibold tabular-nums">{result.state.streak.current}</p>
          <p className="text-xs text-muted">dia(s) seguidos</p>
        </div>
      </div>
      <div className="mx-auto flex max-w-sm flex-col gap-2">
        {!result.passed && (
          <Button variant="outline" size="lg" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
            Tentar de novo
          </Button>
        )}
        {next !== '/speaking' && result.passed && (
          <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />} onClick={() => void navigate(next)}>
            Próxima etapa da trilha
          </Button>
        )}
        <Button variant={result.passed && next !== '/speaking' ? 'ghost' : 'primary'} size="lg" onClick={() => void navigate('/speaking')}>
          Voltar à trilha
        </Button>
      </div>
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const path = useSpeechPath();
  const ai = useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
  const practice = usePractice();
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<ExerciseOutcome[]>([]);
  const [result, setResult] = useState<SpeechPracticeResult | null>(null);
  const [round, setRound] = useState(0);
  const startedAt = useRef(Date.now());
  const aiReady = !!ai.data?.enabled && !!ai.data.configured;
  const reviewSkill = id.startsWith('review-') ? (id.slice('review-'.length) as SkillId) : null;
  const variants = useQuery({
    queryKey: ['speech-variants', reviewSkill, round],
    queryFn: () => endpoints.speech.variants(reviewSkill!),
    enabled: !!reviewSkill && aiReady,
    staleTime: Infinity,
    retry: false,
  });
  // A review waits for its extra exercises (or their failure), so it never changes mid-lesson.
  const waiting = !!reviewSkill && (ai.isPending || (aiReady && !variants.isFetched));
  const extra = variants.data ?? [];
  // Frozen on first load: the warm-up and reviews must not change under the user mid-lesson.
  const playable = useMemo(() => (path.data && !waiting ? resolve(id, path.data, extra) : null), [id, path.data?.today, round, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (path.isPending || waiting) return <PageLoader />;
  if (path.isError) return <ErrorState error={path.error} onRetry={() => void path.refetch()} />;
  if (!playable) {
    return (
      <Page width="narrow">
        <EmptyState title="Lição não encontrada" description="Ela pode ter mudado de lugar na trilha." action={<Link to="/speaking">Voltar à trilha</Link>} />
      </Page>
    );
  }
  const seconds = () => Math.min(3600, Math.round((Date.now() - startedAt.current) / 1000));

  const save = async (body: Parameters<typeof practice.mutateAsync>[0]) => {
    try {
      setResult(await practice.mutateAsync(body));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const retry = () => {
    setIndex(0);
    setOutcomes([]);
    setResult(null);
    setRound((r) => r + 1);
    startedAt.current = Date.now();
  };

  const leave = async () => {
    if (result || (index === 0 && outcomes.length === 0) || (await confirm({ title: 'Sair da lição?', description: 'O progresso desta lição não será salvo.', confirmLabel: 'Sair' }))) {
      void navigate('/speaking');
    }
  };

  const total = 'challenge' in playable ? 1 : playable.lesson.exercises.length;
  const done = result ? total : index;

  return (
    <Page width="narrow">
      <div className="mb-6 flex items-center gap-3">
        <IconButton label="Sair" onClick={() => void leave()}>
          <X className="size-5" />
        </IconButton>
        <Progress value={(done / total) * 100} label="Progresso da lição" className="h-2.5" />
        <span className="text-xs text-muted tabular-nums">
          {Math.min(done + 1, total)}/{total}
        </span>
      </div>
      {result ? (
        <Finished result={result} onRetry={retry} title={playable.kind === 'lesson' ? 'Lição' : playable.kind === 'warmup' ? 'Aquecimento' : playable.kind === 'review' ? 'Revisão' : 'Desafio'} />
      ) : (
        <>
          <header className="mb-6">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{playable.subtitle}</p>
            <h1 className="mt-0.5 text-2xl font-semibold">{playable.title}</h1>
          </header>
          {'challenge' in playable ? (
            <TalkCard
              key={round}
              spec={playable.challenge}
              lessonId={playable.challenge.id}
              state={path.data}
              doneLabel="Concluir o desafio"
              onDone={(o) => void save({ kind: playable.kind, refId: playable.challenge.id, attemptId: o.attemptId ?? null, seconds: seconds(), results: [o.passed] })}
            />
          ) : (
            <ExerciseCard
              key={`${round}-${index}`}
              exercise={playable.lesson.exercises[index]!}
              lessonId={playable.lesson.id}
              state={path.data}
              aiReady={aiReady}
              onDone={(o) => {
                const next = [...outcomes, o];
                setOutcomes(next);
                if (index + 1 < playable.lesson.exercises.length) {
                  setIndex(index + 1);
                  window.scrollTo({ top: 0 });
                } else {
                  void save({ kind: playable.kind, refId: playable.refId, seconds: seconds(), results: next.map((x) => x.passed) });
                }
              }}
            />
          )}
        </>
      )}
    </Page>
  );
}
