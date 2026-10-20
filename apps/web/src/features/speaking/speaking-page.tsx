import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History, Mic, Square, TriangleAlert, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { SPEECH_TYPE_LABELS, type SpeechMode, type SpeechType } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { dictationSupported } from '@/lib/dictation/recorder';
import { useBeforeUnloadGuard } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { attemptTitle, clock, scoreTone } from './speaking-ui';
import { SpeechSession, discardPendingTalk, pendingTalk, type SpeechSetup } from './speech-session';

const TARGETS = [
  { value: '', label: 'Sem meta' },
  { value: '60', label: '1 minuto' },
  { value: '120', label: '2 minutos' },
  { value: '180', label: '3 minutos' },
  { value: '300', label: '5 minutos' },
  { value: '600', label: '10 minutos' },
];

const FREE_TYPES: SpeechType[] = ['explain', 'persuasive', 'impromptu'];

function useSession(session: SpeechSession) {
  return useSyncExternalStore(session.subscribe, session.getState);
}

/** Microphone level as a bar (0–1). */
function LevelMeter({ level }: { level: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function Recording({ session, target, onSaved }: { session: SpeechSession; target: number | null; onSaved: (id: string) => void }) {
  const s = useSession(session);
  const confirm = useConfirm();
  useBeforeUnloadGuard(s.status !== 'idle');
  const minutes = Math.max(s.elapsed, 1) / 60;
  const over = target !== null && s.elapsed > target;

  const stop = async () => {
    const attempt = await session.stop().catch((err) => {
      toast.error(errorMessage(err));
      return null;
    });
    if (attempt) onSaved(attempt.id);
  };
  const cancel = async () => {
    if (await confirm({ title: 'Descartar esta fala?', description: 'Nada do que foi gravado será salvo.', confirmLabel: 'Descartar', danger: true })) {
      await session.cancel();
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="text-center">
        <p className="text-sm text-muted">{s.status === 'recording' ? 'Gravando' : s.status === 'saving' ? 'Salvando a fala…' : 'Terminando de transcrever…'}</p>
        <p className={cn('mt-1 text-5xl font-semibold tabular-nums', over && 'text-warning')}>{clock(s.elapsed)}</p>
        {target !== null && <p className="mt-1 text-xs text-subtle tabular-nums">meta: {clock(target)}</p>}
      </div>
      {s.status === 'recording' && <LevelMeter level={s.level} />}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-muted">Palavras</dt>
          <dd className="text-lg font-semibold tabular-nums">{s.words}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Ritmo</dt>
          <dd className="text-lg font-semibold tabular-nums">{s.words ? Math.round(s.words / minutes) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Vícios</dt>
          <dd className="text-lg font-semibold tabular-nums">{s.fillers}</dd>
        </div>
      </dl>
      <p className="text-center text-xs text-subtle">
        Os números acompanham o texto já transcrito, com alguns segundos de atraso.
        {s.pending > 0 && ` ${s.pending} trecho(s) aguardando transcrição.`}
      </p>
      {(s.error || s.offline) && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
          {s.offline ? <WifiOff className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
          <div className="flex-1">
            <p>{s.offline ? 'Sem conexão: os trechos ficam guardados e são enviados quando ela voltar.' : s.error}</p>
            {s.error && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => session.retry()}>
                Tentar de novo
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-center gap-2">
        {s.status === 'recording' ? (
          <>
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => void cancel()}>
              Descartar
            </Button>
            <Button variant="primary" size="lg" icon={<Square className="size-4" />} onClick={() => void stop()}>
              Terminar
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => void cancel()}>
            Descartar a fala
          </Button>
        )}
      </div>
    </Card>
  );
}

function Setup({ onStart, busy }: { onStart: (setup: SpeechSetup, target: number | null) => void; busy: boolean }) {
  const [params] = useSearchParams();
  const { tree } = useTopics();
  const [mode, setMode] = useState<SpeechMode>(params.get('topic') ? 'explain' : 'free');
  const [topicId, setTopicId] = useState(params.get('topic') ?? '');
  const [theme, setTheme] = useState('');
  const [type, setType] = useState<SpeechType>('explain');
  const [target, setTarget] = useState('120');
  const topic = topicId ? tree.byId.get(topicId) : undefined;
  const ready = mode === 'free' || !!topic;

  const start = () => {
    const seconds = target ? Number(target) : null;
    onStart(
      {
        mode,
        speechType: mode === 'explain' ? 'explain' : type,
        topicId: mode === 'explain' ? topicId : null,
        theme: mode === 'free' ? theme.trim() : '',
        targetSeconds: seconds,
        themeWords: mode === 'explain' ? [topic?.title ?? ''] : [theme],
      },
      seconds,
    );
  };

  return (
    <Card className="space-y-4 p-5">
      <Segmented
        label="Tipo de treino"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'explain', label: 'Explicar um assunto' },
          { value: 'free', label: 'Fala livre' },
        ]}
      />
      {mode === 'explain' ? (
        <Field label="Assunto" hint="O professor compara o que você disser com as suas notas desse assunto.">
          {(field) => (
            <Select {...field} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">Escolha um assunto…</option>
              {tree.flat.map((t) => (
                <option key={t.id} value={t.id}>
                  {'  '.repeat(t.depth)}
                  {t.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <>
          <Field label="Tema" optional>
            {(field) => (
              <Input {...field} value={theme} maxLength={300} onChange={(e) => setTheme(e.target.value)} placeholder="Ex.: por que todo mundo deveria aprender a cozinhar" />
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Tipo de fala</p>
            <Segmented label="Tipo de fala" value={type} onChange={setType} options={FREE_TYPES.map((t) => ({ value: t, label: SPEECH_TYPE_LABELS[t] }))} />
          </div>
        </>
      )}
      <Field label="Meta de tempo">
        {(field) => (
          <Select {...field} value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className="text-xs text-subtle">
        O áudio fica no aparelho: só os trechos de fala vão para a transcrição, e nada de áudio é guardado. Fale perto do microfone, sempre à mesma distância.
      </p>
      <Button variant="primary" size="lg" className="w-full" icon={<Mic className="size-4" />} disabled={!ready} loading={busy} onClick={start}>
        Começar a gravar
      </Button>
    </Card>
  );
}

function PendingBanner({ onRecover }: { onRecover: () => void }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ['speech-pending'], queryFn: pendingTalk, staleTime: 0 });
  if (!data) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-warning-soft p-4 text-sm">
      <History className="size-5 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        Uma fala de {format(new Date(data.startedAt), "d 'de' MMM, HH:mm", { locale: ptBR })} foi interrompida antes de ser salva. Dá para recuperar o texto (a análise da voz se perdeu).
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await discardPendingTalk();
            await refetch();
            await qc.invalidateQueries({ queryKey: ['speech-pending'] });
          }}
        >
          Descartar
        </Button>
        <Button size="sm" variant="primary" onClick={onRecover}>
          Recuperar
        </Button>
      </div>
    </div>
  );
}

function History_() {
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
  if (items.length === 0) {
    return <EmptyState icon={<Mic />} title="Nenhuma fala ainda" description="Grave a primeira: ela vira o seu ponto de partida para medir a evolução." />;
  }
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
  const qc = useQueryClient();
  const [session] = useState(() => new SpeechSession());
  const s = useSession(session);
  const [target, setTarget] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => () => session.dispose(), [session]);

  const saved = (id: string) => {
    void qc.invalidateQueries({ queryKey: qk.speechAttempts });
    void qc.invalidateQueries({ queryKey: ['speech-pending'] });
    void navigate(`/speaking/attempts/${id}?evaluate=1`);
  };

  const start = async (setup: SpeechSetup, seconds: number | null) => {
    setStarting(true);
    setTarget(seconds);
    try {
      await session.start(setup);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const recover = async () => {
    const attempt = await session.recover().catch((err) => {
      toast.error(errorMessage(err));
      return null;
    });
    if (attempt) saved(attempt.id);
  };

  return (
    <Page width="narrow">
      <PageHeader title="Oratória" subtitle="Fale em voz alta: o app mede a sua voz e o professor avalia o que você disse." />
      <div className="space-y-8">
        {!dictationSupported() ? (
          <Card className="p-5 text-sm text-muted">Este navegador não permite gravar pelo microfone aqui. Use um navegador atualizado, numa página segura (https).</Card>
        ) : s.status === 'idle' ? (
          <>
            <PendingBanner onRecover={() => void recover()} />
            <Setup onStart={(setup, seconds) => void start(setup, seconds)} busy={starting} />
          </>
        ) : (
          <Recording session={session} target={target} onSaved={saved} />
        )}
        <Section title="Suas falas">
          <History_ />
        </Section>
      </div>
    </Page>
  );
}
