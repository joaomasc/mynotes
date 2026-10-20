import { Link, useNavigate } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart3, BookOpen, Check, ChevronRight, Flame, Lock, Mic, Sparkles, Sun, Trophy, Wind } from 'lucide-react';
import {
  SKILL_LABELS,
  SPEECH_PATH,
  dueSkills,
  lessonDone,
  levelDone,
  nextStep,
  pathProgress,
  unitDone,
  type Level,
  type SpeechPathState,
} from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton, PageLoader, Progress } from '@/components/ui/feedback';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { PendingBanner } from './free-page';
import { ProjectsSection } from './projects-section';
import { attemptTitle, clock, scoreTone } from './speaking-ui';
import { useSpeechPath } from './use-speech-path';

/** Streak, today's goal and total XP. */
function Stats({ s }: { s: SpeechPathState }) {
  const goal = s.settings.dailyGoalMinutes * 60;
  const pct = Math.min(100, (s.todaySeconds / goal) * 100);
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Flame className={cn('size-3.5', s.streak.todayDone ? 'text-warning' : 'text-subtle')} aria-hidden /> Sequência
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{s.streak.current}</p>
        <p className="text-xs text-subtle">{s.streak.current === 1 ? 'dia' : 'dias'} · recorde {s.streak.best}</p>
      </Card>
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Sun className="size-3.5" aria-hidden /> Hoje
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {Math.round(s.todaySeconds / 60)}
          <span className="text-sm font-normal text-subtle">/{s.settings.dailyGoalMinutes} min</span>
        </p>
        <Progress value={pct} label="Meta diária" className="mt-2" />
      </Card>
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Trophy className="size-3.5" aria-hidden /> XP
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{s.totalXp}</p>
        <p className="text-xs text-subtle">+{s.todayXp} hoje</p>
      </Card>
    </div>
  );
}

function SessionStep({ done, icon, title, detail, to, cta }: { done: boolean; icon: React.ReactNode; title: string; detail: string; to: string; cta: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', done ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent')}>
        {done ? <Check className="size-4" aria-label="Feito" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <Link to={to} className={cn('shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium', done ? 'text-muted hover:bg-surface-2' : 'bg-accent text-accent-fg hover:bg-accent-hover')}>
        {done ? 'Refazer' : cta}
      </Link>
    </li>
  );
}

/** Warm-up, the next lesson (or a review when a skill is due) and the daily talk. */
function TodaySession({ s }: { s: SpeechPathState }) {
  const done = new Set(s.completed);
  const step = nextStep(done);
  const due = dueSkills(s.skills, s.today).filter((x) => x.lastPracticedOn !== s.today);
  const review = due[0];
  return (
    <Section title="Sessão de hoje">
      <Card>
        <ol className="divide-y divide-border">
          <SessionStep done={s.warmupDone} icon={<Wind className="size-4" />} title="Aquecimento vocal" detail="Respiração, um trava-línguas e entonação · 2 min" to="/speaking/lesson/warmup" cta="Aquecer" />
          {review ? (
            <SessionStep done={false} icon={<Sparkles className="size-4" />} title={`Revisão: ${SKILL_LABELS[review.skill]}`} detail="Uma habilidade pede prática hoje" to={`/speaking/lesson/review-${review.skill}`} cta="Revisar" />
          ) : step ? (
            <SessionStep
              done={false}
              icon={<Mic className="size-4" />}
              title={step.kind === 'lesson' ? step.lesson.title : step.kind === 'challenge' ? `Desafio: ${step.unit.title}` : `Desafio do nível ${step.level.number}`}
              detail={step.kind === 'levelChallenge' ? step.level.title : `Unidade ${step.unit.number} · ${step.unit.title}`}
              to={`/speaking/lesson/${step.kind === 'lesson' ? step.lesson.id : step.challenge.id}`}
              cta="Começar"
            />
          ) : (
            <SessionStep done icon={null} title="Trilha concluída" detail="Continue com o Discurso do Dia e as revisões" to="/speaking/free" cta="" />
          )}
          <SessionStep done={s.dailyDone} icon={<Mic className="size-4" />} title="Discurso do Dia" detail={s.daily.text} to="/speaking/free?daily=1" cta="Falar" />
        </ol>
      </Card>
    </Section>
  );
}

function LevelMap({ level, s }: { level: Level; s: SpeechPathState }) {
  const done = new Set(s.completed);
  const step = nextStep(done);
  const current = step && step.kind !== 'levelChallenge' ? step.unit.id : null;
  const finished = levelDone(level, done);
  return (
    <Section
      title={`Nível ${level.number} · ${level.title}`}
      action={
        <Link to={`/speaking/lesson/${level.challenge.id}`} className="text-xs font-medium text-accent hover:underline">
          {finished ? 'Refazer o desafio do nível' : 'Desafio do nível (também serve para pular)'}
        </Link>
      }
    >
      <ol className="space-y-3">
        {level.units.map((unit) => {
          const ok = unitDone(level, unit, done);
          const isCurrent = unit.id === current;
          return (
            <li key={unit.id}>
              <Card className={cn('p-4', isCurrent && 'border-accent ring-1 ring-accent')}>
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                      ok ? 'bg-success-soft text-success' : isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {ok ? <Check className="size-5" aria-label="Concluída" /> : unit.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {unit.title} <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-muted">{unit.track === 'C' ? 'construção' : unit.track === 'E' ? 'entrega' : 'entrega + construção'}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-muted">{unit.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {unit.lessons.map((l) => (
                        <Link
                          key={l.id}
                          to={`/speaking/lesson/${l.id}`}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                            lessonDone(level, l.id, done) ? 'border-success-soft bg-success-soft text-success' : 'border-border hover:bg-surface-2',
                          )}
                        >
                          {lessonDone(level, l.id, done) && <Check className="size-3" aria-label="Concluída" />}
                          {l.title}
                        </Link>
                      ))}
                      <Link
                        to={`/speaking/lesson/${unit.challenge.id}`}
                        className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium', ok ? 'border-success-soft bg-success-soft text-success' : 'border-accent text-accent hover:bg-accent-soft')}
                      >
                        {ok ? <Check className="size-3" aria-hidden /> : unit.lessons.every((l) => done.has(l.id)) ? <Trophy className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
                        Desafio
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function RecentTalks() {
  const { tree } = useTopics();
  const q = useInfiniteQuery({
    queryKey: qk.speechAttempts,
    queryFn: ({ pageParam }) => endpoints.speech.list(pageParam ? { cursor: pageParam } : {}),
    initialPageParam: '',
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isPending) return <ListSkeleton rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (items.length === 0) return <EmptyState icon={<Mic />} title="Nenhuma fala ainda" description="As falas das lições, dos desafios e do treino livre aparecem aqui." />;
  return (
    <Card className="divide-y divide-border">
      {items.map((a) => (
        <Link key={a.id} to={`/speaking/attempts/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
          <div className={cn('w-12 shrink-0 text-center text-xl font-semibold tabular-nums', scoreTone(a.score))} aria-label={a.score === null ? 'Sem nota' : `Nota ${a.score}`}>
            {a.score ?? '—'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attemptTitle(a, a.topicId ? tree.byId.get(a.topicId)?.title : null)}</p>
            <p className="mt-0.5 text-xs text-muted tabular-nums">
              {format(new Date(a.startedAt), "d 'de' MMM, HH:mm", { locale: ptBR })} · {clock(a.durationSeconds)} · {Math.round(a.wpm)} palavras/min ·{' '}
              {a.fillersPerMinute.toFixed(1).replace('.', ',')} vícios/min{!a.evaluated && ' · sem avaliação da IA'}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
        </Link>
      ))}
      {q.hasNextPage && (
        <div className="p-3 text-center">
          <Button variant="ghost" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            Ver mais
          </Button>
        </div>
      )}
    </Card>
  );
}

export function Component() {
  const navigate = useNavigate();
  const path = useSpeechPath();
  if (path.isPending) return <PageLoader />;
  if (path.isError) return <ErrorState error={path.error} onRetry={() => void path.refetch()} />;
  const s = path.data;
  const progress = pathProgress(new Set(s.completed));
  return (
    <Page width="narrow">
      <PageHeader
        title="Oratória"
        subtitle="Aprenda a falar bem e a construir o seu discurso, um pouco por dia."
        actions={
          <>
            <Button variant="outline" icon={<Mic className="size-4" />} onClick={() => void navigate('/speaking/free')}>
              Treino livre
            </Button>
            <Button variant="outline" icon={<BarChart3 className="size-4" />} onClick={() => void navigate('/speaking/progress')}>
              Progresso
            </Button>
            <Button variant="outline" icon={<BookOpen className="size-4" />} onClick={() => void navigate('/speaking/methods')}>
              Métodos
            </Button>
          </>
        }
      />
      <div className="space-y-8">
        <PendingBanner onRecovered={(a) => void navigate(`/speaking/attempts/${a.id}?evaluate=1`)} />
        <Stats s={s} />
        <TodaySession s={s} />
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>Trilha</span>
            <span className="tabular-nums">{Math.round(progress * 100)}% concluída</span>
          </div>
          <Progress value={progress * 100} label="Progresso da trilha" />
        </div>
        {SPEECH_PATH.map((level) => (
          <LevelMap key={level.id} level={level} s={s} />
        ))}
        <ProjectsSection />
        <Section title="Suas falas">
          <RecentTalks />
        </Section>
      </div>
    </Page>
  );
}
