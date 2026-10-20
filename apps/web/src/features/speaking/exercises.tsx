import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, CircleCheck, CircleMinus, CircleX, MoveDownRight, MoveUpRight, RotateCcw, Sparkles, Wind } from 'lucide-react';
import {
  BUILD_PART_LABELS,
  SPEECH_METHODS,
  checkGoals,
  checkReading,
  goalLabel,
  needsEvaluation,
  parseReadText,
  type Exercise,
  type GoalResult,
  type SpeechAttempt,
  type SpeechFeedback,
  type SpeechGoal,
  type SpeechPathState,
  type SpeechType,
  type TalkTopic,
} from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { clock } from './speaking-ui';
import type { SpeechSetup } from './speech-session';
import { TalkRecorder } from './talk-recorder';
import { resolveTopic } from './use-speech-path';

/** Outcome of one exercise in a lesson. */
export interface ExerciseOutcome {
  passed: boolean;
  /** The talk recorded in it, when there was one. */
  attemptId?: string;
}

type Done = (outcome: ExerciseOutcome) => void;

/** “**bold**” and paragraphs (“\n\n”) of the lesson texts. */
export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-3 text-[15px] leading-relaxed', className)}>
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i}>
          {p.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={k} className="font-semibold">
                {part.slice(2, -2)}
              </strong>
            ) : (
              <Fragment key={k}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

function Feedback({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const Icon = ok === null ? CircleMinus : ok ? CircleCheck : CircleX;
  return (
    <div role="status" className={cn('flex gap-2 rounded-lg p-3 text-sm', ok === null ? 'bg-surface-2' : ok ? 'bg-success-soft' : 'bg-danger-soft')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', ok === null ? 'text-subtle' : ok ? 'text-success' : 'text-danger')} aria-hidden />
      <div className="min-w-0 flex-1 text-text">{children}</div>
    </div>
  );
}

function Continue({ onClick, label = 'Continuar' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} onClick={onClick}>
      {label}
    </Button>
  );
}

/* ------------------------------------------------------------ concept -- */

function ConceptCard({ e, onDone }: { e: Extract<Exercise, { type: 'concept' }>; onDone: Done }) {
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">{e.title}</h2>
      <RichText text={e.body} />
      {(e.good || e.bad) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {e.good && (
            <Feedback ok>
              <span className="font-medium">Assim: </span>
              {e.good}
            </Feedback>
          )}
          {e.bad && (
            <Feedback ok={false}>
              <span className="font-medium">Não assim: </span>
              {e.bad}
            </Feedback>
          )}
        </div>
      )}
      <Continue label="Entendi" onClick={() => onDone({ passed: true })} />
    </div>
  );
}

/* ---------------------------------------------------------- recognize -- */

function RecognizeCard({ e, onDone }: { e: Extract<Exercise, { type: 'recognize' }>; onDone: Done }) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === e.answer;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-balance">{e.prompt}</h2>
      <div className="space-y-2" role="radiogroup" aria-label="Opções">
        {e.options.map((o, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked === i}
            disabled={picked !== null}
            onClick={() => setPicked(i)}
            className={cn(
              'w-full rounded-xl border p-3 text-left text-sm transition-colors',
              picked === null && 'border-border hover:bg-surface-2',
              picked !== null && i === e.answer && 'border-success bg-success-soft',
              picked === i && i !== e.answer && 'border-danger bg-danger-soft',
              picked !== null && i !== e.answer && picked !== i && 'border-border opacity-60',
            )}
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <>
          <Feedback ok={right}>
            <span className="font-medium">{right ? 'Isso! ' : 'Não exatamente. '}</span>
            {e.explanation}
          </Feedback>
          <Continue onClick={() => onDone({ passed: right })} />
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- fix, build -- */

function WrittenCard({ e, aiReady, onDone }: { e: Extract<Exercise, { type: 'fix' | 'build' }>; aiReady: boolean; onDone: Done }) {
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<SpeechFeedback | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFix = e.type === 'fix';
  const sample = isFix ? e.sample : e.example;
  const method = e.type === 'build' && e.method ? SPEECH_METHODS[e.method] : null;

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await endpoints.speech.feedback({
          kind: e.type,
          instruction: e.instruction,
          context: isFix ? e.sentence : BUILD_PART_LABELS[e.part],
          answer,
          method: method?.id ?? null,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setShowSample(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{isFix ? 'Reescreva' : `Escreva: ${BUILD_PART_LABELS[e.part].toLowerCase()}`}</p>
      <h2 className="text-lg font-semibold text-balance">{e.instruction}</h2>
      {isFix && <blockquote className="rounded-lg border-l-4 border-border-strong bg-surface-2 p-3 text-sm">“{e.sentence}”</blockquote>}
      {method && (
        <ol className="space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
          {method.parts.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.name}:</span> <span className="text-muted">{p.hint}</span>
            </li>
          ))}
        </ol>
      )}
      <Textarea value={answer} onChange={(ev) => setAnswer(ev.target.value)} rows={4} maxLength={2000} placeholder="Sua resposta…" aria-label="Sua resposta" disabled={!!result} />
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <Feedback ok={result.verdict === 'good' ? true : result.verdict === 'redo' ? false : null}>
          <p className="font-medium">{{ good: 'Muito bom!', almost: 'Quase lá.', redo: 'Vale refazer.' }[result.verdict]}</p>
          <p className="mt-1">{result.feedback}</p>
          <p className="mt-2 text-muted">
            Uma versão melhor: <span className="text-text">“{result.suggestion}”</span>
          </p>
        </Feedback>
      )}
      {showSample && !result && (
        <Feedback ok={null}>
          <span className="font-medium">Uma resposta possível: </span>“{sample}”
        </Feedback>
      )}
      {result ? (
        <Continue onClick={() => onDone({ passed: result.verdict !== 'redo' })} />
      ) : showSample ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={() => onDone({ passed: false })}>
            A minha ficou longe
          </Button>
          <Button variant="primary" size="lg" icon={<Check className="size-4" />} onClick={() => onDone({ passed: true })}>
            Ficou parecida
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {aiReady && (
            <Button variant="primary" size="lg" className="flex-1" icon={<Sparkles className="size-4" />} loading={busy} disabled={!answer.trim()} onClick={() => void check()}>
              Corrigir com a IA
            </Button>
          )}
          <Button variant={aiReady ? 'outline' : 'primary'} size="lg" className="flex-1" disabled={!answer.trim()} onClick={() => setShowSample(true)}>
            Comparar com uma resposta-modelo
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- breathing -- */

function BreathingCard({ e, onDone }: { e: Extract<Exercise, { type: 'breathing' }>; onDone: Done }) {
  const phases = useMemo(
    () => [
      { label: 'Inspire', seconds: e.inhale, scale: 1 },
      ...(e.hold ? [{ label: 'Segure', seconds: e.hold, scale: 1 }] : []),
      { label: 'Solte com “sss”', seconds: e.exhale, scale: 0.55 },
    ],
    [e],
  );
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(0);
  const total = phases.length * e.rounds;
  const finished = step >= total;
  useEffect(() => {
    if (!running || finished) return;
    const phase = phases[step % phases.length]!;
    setLeft(phase.seconds);
    const tick = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    const next = setTimeout(() => setStep((s) => s + 1), phase.seconds * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(next);
    };
  }, [running, step, finished, phases]);
  const phase = phases[step % phases.length]!;
  return (
    <div className="space-y-5 text-center">
      <h2 className="text-lg font-semibold text-balance">{e.instruction}</h2>
      <div className="flex h-48 items-center justify-center">
        <div
          className="flex size-40 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform ease-in-out"
          style={{ transform: `scale(${running && !finished ? phase.scale : 0.7})`, transitionDuration: `${running && !finished ? phase.seconds : 0.3}s` }}
          aria-live="polite"
        >
          {finished ? <Check className="size-10" aria-label="Concluído" /> : running ? <span className="text-sm font-medium">{phase.label}<br />{left}</span> : <Wind className="size-10" aria-hidden />}
        </div>
      </div>
      <p className="text-xs text-muted tabular-nums">
        {e.inhale} s inspirando{e.hold ? ` · ${e.hold} s segurando` : ''} · {e.exhale} s soltando · {e.rounds} vez(es)
        {running && !finished && ` · rodada ${Math.floor(step / phases.length) + 1} de ${e.rounds}`}
      </p>
      {finished ? (
        <Continue onClick={() => onDone({ passed: true })} />
      ) : !running ? (
        <Button variant="primary" size="lg" className="w-full" onClick={() => setRunning(true)}>
          Começar
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => onDone({ passed: true })}>
          Pular
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------- reading aloud -- */

/** A reading text with its marks: emphasis underlined, pauses as bars, the ending as an arrow. */
export function MarkedReading({ text }: { text: string }) {
  const r = parseReadText(text);
  return (
    <p className="rounded-xl bg-surface-2 p-4 text-xl leading-relaxed">
      {r.words.map((w, i) => (
        <Fragment key={i}>
          <span className={cn(r.emphasis.includes(i) && 'font-semibold text-accent underline decoration-2 underline-offset-4')}>{w}</span>
          {r.pauses.includes(i) && (
            <span className="mx-1 text-subtle" aria-label="pausa">
              {' '}
              |
            </span>
          )}{' '}
        </Fragment>
      ))}
      {r.ending === 'falling' && <MoveDownRight className="inline size-5 text-accent" aria-label="final descendo" />}
      {r.ending === 'rising' && <MoveUpRight className="inline size-5 text-accent" aria-label="final subindo" />}
    </p>
  );
}

const READ_SETUP = { mode: 'free' as const, speechType: 'explain' as const, topicId: null, theme: 'Leitura', targetSeconds: null, themeWords: [] };

function ReadCard({ e, onDone }: { e: Extract<Exercise, { type: 'readAloud' | 'articulation' }>; onDone: Done }) {
  const [result, setResult] = useState<ReturnType<typeof checkReading> | null>(null);
  const [round, setRound] = useState(0);
  const articulation = e.type === 'articulation';
  const checkable = result?.checks.filter((c) => c.passed !== null) ?? [];
  const passed =
    !!result &&
    result.accuracy >= (articulation ? 0.9 : 0.75) &&
    (checkable.length === 0 || checkable.filter((c) => c.passed).length / checkable.length >= 0.6);
  return (
    <div className="space-y-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{articulation ? 'Articulação' : 'Leia em voz alta'}</p>
      <h2 className="text-lg font-semibold text-balance">
        {articulation ? 'Leia devagar, pronunciando cada sílaba até o fim. Depois, tente mais rápido.' : e.instruction}
      </h2>
      <MarkedReading text={e.text} />
      {!articulation && (
        <p className="text-xs text-subtle">
          <span className="font-medium">|</span> pausa · <span className="font-semibold text-accent underline">palavra</span> ênfase · ↘ final descendo · ↗ final subindo
        </p>
      )}
      {!result ? (
        <TalkRecorder key={round} persist={false} compact setup={READ_SETUP} startLabel="Gravar a leitura" onRecording={(rec) => setResult(checkReading(e.text, rec.words, rec.frames))} />
      ) : (
        <>
          <Feedback ok={passed}>
            <p className="font-medium">
              {Math.round(result.accuracy * 100)}% das palavras reconhecidas
              {result.missed.length > 0 && <span className="font-normal text-muted"> · faltaram ou saíram trocadas: {result.missed.map((w) => `“${w}”`).join(', ')}</span>}
            </p>
            {result.checks.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    {c.passed === null ? <CircleMinus className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-label="não medido" /> : c.passed ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="ok" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="não" />}
                    <span>
                      {c.label} <span className="text-muted">({c.detail})</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Feedback>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                setResult(null);
                setRound((r) => r + 1);
              }}
            >
              De novo
            </Button>
            <Continue onClick={() => onDone({ passed })} />
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- talk -- */

export function GoalList({ results }: { results: GoalResult[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {results.map((r, i) => (
        <li key={i} className="flex items-start gap-2">
          {r.passed === null ? <CircleMinus className="mt-0.5 size-4 shrink-0 text-subtle" aria-label="não verificado" /> : r.passed ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="cumprida" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-label="não cumprida" />}
          <span>
            {r.label} <span className="text-muted">· {r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface TalkSpec {
  instruction: string;
  topic: TalkTopic;
  seconds: number;
  goals: SpeechGoal[];
  method?: string;
  speechType?: SpeechType;
}

/** Record a talk with goals: saved as a talk, evaluated by the model when a goal needs it. */
export function TalkCard({
  spec,
  lessonId,
  state,
  onDone,
  doneLabel,
  setupOverride,
}: {
  spec: TalkSpec;
  lessonId: string | null;
  state: SpeechPathState | undefined;
  onDone: Done;
  doneLabel?: string;
  /** Board answers keep the subject of the talk they answer (and point to it). */
  setupOverride?: Partial<SpeechSetup>;
}) {
  const ai = useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
  const aiReady = !!ai.data?.enabled && !!ai.data.configured;
  const [attempt, setAttempt] = useState<SpeechAttempt | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [round, setRound] = useState(0);
  const asked = useRef<string | null>(null);
  const resolved = resolveTopic(spec.topic, state);
  const text = resolved.text;
  const setup = { ...resolved.setup, keepAudio: state?.settings.keepAudio ?? false, ...setupOverride };
  const method = spec.method && spec.method in SPEECH_METHODS ? SPEECH_METHODS[spec.method as keyof typeof SPEECH_METHODS] : null;

  useEffect(() => {
    if (!attempt || attempt.evaluated || asked.current === attempt.id || !needsEvaluation(spec.goals) || !aiReady || !attempt.transcript.trim()) return;
    asked.current = attempt.id;
    setEvaluating(true);
    endpoints.speech
      .evaluate(attempt.id)
      .then(setAttempt)
      .catch(() => undefined)
      .finally(() => setEvaluating(false));
  }, [attempt, spec.goals, aiReady]);

  const check = attempt ? checkGoals(spec.goals, attempt.metrics, [...attempt.measured, ...(attempt.evaluation?.criteria ?? [])]) : null;
  return (
    <div className="space-y-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Fale · {clock(spec.seconds)}</p>
      <h2 className="text-lg font-semibold text-balance">{spec.instruction}</h2>
      <Card className="p-4">
        <p className="text-xs text-muted">{spec.speechType === 'qa' ? 'Pergunta' : 'Tema'}</p>
        <p className="mt-0.5 font-medium">{text}</p>
        {method && (
          <ol className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <li className="text-xs text-muted">Método {method.name}</li>
            {method.parts.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{i + 1}. {p.name}:</span> <span className="text-muted">{p.hint}</span>
              </li>
            ))}
          </ol>
        )}
        {spec.goals.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1.5 text-xs text-muted">Metas</p>
            <ul className="space-y-1 text-sm">
              {spec.goals.map((g, i) => (
                <li key={i}>· {goalLabel(g)}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      {!attempt ? (
        <TalkRecorder
          key={round}
          persist
          setup={{ ...setup, speechType: spec.speechType ?? (setup.mode === 'explain' ? 'explain' : 'impromptu'), targetSeconds: spec.seconds, lessonId }}
          onAttempt={setAttempt}
        />
      ) : evaluating ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" label="Avaliando" /> O professor está lendo a sua fala…
        </p>
      ) : (
        <>
          <Feedback ok={check!.passed}>
            <p className="mb-2 font-medium">{check!.passed ? 'Metas cumpridas!' : 'Ainda não: veja o que faltou.'}</p>
            <GoalList results={check!.results} />
            <Link to={`/speaking/attempts/${attempt.id}`} className="mt-2 inline-block text-sm font-medium text-accent hover:underline" target="_blank">
              Ver o resultado completo
            </Link>
          </Feedback>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                setAttempt(null);
                setRound((r) => r + 1);
              }}
            >
              Falar de novo
            </Button>
            <Continue label={doneLabel} onClick={() => onDone({ passed: check!.passed, attemptId: attempt.id })} />
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- board -- */

/** The examining board: one question at a time, each answered out loud and checked against the goals. */
export function QaCard({
  instruction,
  questions,
  seconds,
  goals,
  lessonId,
  state,
  setupOverride,
  onDone,
}: {
  instruction: string;
  questions: string[];
  seconds: number;
  goals: SpeechGoal[];
  lessonId: string | null;
  state: SpeechPathState | undefined;
  setupOverride?: Partial<SpeechSetup>;
  onDone: Done;
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<ExerciseOutcome[]>([]);
  if (index >= questions.length) {
    const ok = results.filter((r) => r.passed).length;
    const passed = ok >= Math.ceil(questions.length / 2);
    return (
      <div className="space-y-4">
        <Feedback ok={passed}>
          <p className="font-medium">
            {ok} de {questions.length} respostas cumpriram as metas.
          </p>
          <p className="mt-1 text-muted">{passed ? 'A banca ficou satisfeita.' : 'Vale treinar de novo: responda na primeira frase e depois explique.'}</p>
        </Feedback>
        <Continue onClick={() => onDone({ passed, attemptId: results.at(-1)?.attemptId })} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        Banca · pergunta {index + 1} de {questions.length}
      </p>
      <TalkCard
        key={index}
        spec={{ instruction, topic: { text: questions[index]! }, seconds, goals, speechType: 'qa' }}
        lessonId={lessonId}
        state={state}
        setupOverride={setupOverride}
        doneLabel={index + 1 < questions.length ? 'Próxima pergunta' : 'Concluir a banca'}
        onDone={(o) => {
          setResults((r) => [...r, o]);
          setIndex((i) => i + 1);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ dispatch -- */

export function ExerciseCard({ exercise, lessonId, state, aiReady, onDone }: { exercise: Exercise; lessonId: string; state: SpeechPathState | undefined; aiReady: boolean; onDone: Done }) {
  switch (exercise.type) {
    case 'concept':
      return <ConceptCard e={exercise} onDone={onDone} />;
    case 'recognize':
      return <RecognizeCard e={exercise} onDone={onDone} />;
    case 'fix':
    case 'build':
      return <WrittenCard e={exercise} aiReady={aiReady} onDone={onDone} />;
    case 'breathing':
      return <BreathingCard e={exercise} onDone={onDone} />;
    case 'readAloud':
    case 'articulation':
      return <ReadCard e={exercise} onDone={onDone} />;
    case 'shortTalk':
      return <TalkCard spec={exercise} lessonId={lessonId} state={state} onDone={onDone} />;
    case 'qa':
      return <QaCard instruction={exercise.instruction} questions={exercise.questions} seconds={exercise.seconds} goals={exercise.goals} lessonId={lessonId} state={state} onDone={onDone} />;
  }
}
