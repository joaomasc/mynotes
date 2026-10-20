import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import { SPEECH_METHODS, SPEECH_TYPE_LABELS, learnedMethods, type MethodId, type SpeechAttempt, type SpeechMode, type SpeechType } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/feedback';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { SpeechSession, discardPendingTalk, pendingTalk, type SpeechSetup } from './speech-session';
import { TalkRecorder } from './talk-recorder';
import { usePractice, useSpeechPath } from './use-speech-path';

const TARGETS = [
  { value: '', label: 'Sem meta' },
  { value: '60', label: '1 minuto' },
  { value: '120', label: '2 minutos' },
  { value: '180', label: '3 minutos' },
  { value: '300', label: '5 minutos' },
  { value: '600', label: '10 minutos' },
];

const FREE_TYPES: SpeechType[] = ['explain', 'persuasive', 'impromptu'];

/** A talk interrupted before being saved: recover its text or throw it away. */
export function PendingBanner({ onRecovered }: { onRecovered: (a: SpeechAttempt) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ['speech-pending'], queryFn: pendingTalk, staleTime: 0 });
  if (!data) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['speech-pending'] });
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
            await refresh();
          }}
        >
          Descartar
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const session = new SpeechSession();
            try {
              const attempt = await session.recover();
              await refresh();
              if (attempt) onRecovered(attempt);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              session.dispose();
              setBusy(false);
            }
          }}
        >
          Recuperar
        </Button>
      </div>
    </div>
  );
}

export function Component() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useSpeechPath();
  const practice = usePractice();
  const { tree } = useTopics();
  const daily = params.get('daily') === '1';

  const [mode, setMode] = useState<SpeechMode>(params.get('topic') ? 'explain' : 'free');
  const [topicId, setTopicId] = useState(params.get('topic') ?? '');
  const [theme, setTheme] = useState(params.get('theme') ?? '');
  const [type, setType] = useState<SpeechType>('explain');
  const [method, setMethod] = useState<MethodId | ''>('');
  const [target, setTarget] = useState(daily ? '90' : '120');

  if (daily && path.isPending) return <PageLoader />;
  const todays = daily ? path.data?.daily : null;
  const learned = path.data ? learnedMethods(new Set(path.data.completed)) : [];
  const topic = topicId ? tree.byId.get(topicId) : undefined;

  const setup: SpeechSetup = todays
    ? todays.note?.topicId
      ? { mode: 'explain', speechType: 'explain', topicId: todays.note.topicId, theme: todays.note.title, targetSeconds: Number(target) || null, themeWords: [todays.note.title] }
      : { mode: 'free', speechType: 'impromptu', topicId: null, theme: todays.text, targetSeconds: Number(target) || null, themeWords: [todays.note?.title ?? ''] }
    : {
        mode,
        speechType: mode === 'explain' ? 'explain' : type,
        topicId: mode === 'explain' ? topicId : null,
        theme: mode === 'free' ? theme.trim() : '',
        targetSeconds: target ? Number(target) : null,
        themeWords: mode === 'explain' ? [topic?.title ?? ''] : [theme],
      };
  const ready = !!todays || mode === 'free' || !!topic;
  const chosenMethod = method ? SPEECH_METHODS[method] : todays && learned.length ? SPEECH_METHODS[learned.at(-1)!] : null;

  const saved = async (attempt: SpeechAttempt) => {
    void qc.invalidateQueries({ queryKey: qk.speechAttempts });
    try {
      await practice.mutateAsync({ kind: daily ? 'daily' : 'free', attemptId: attempt.id, seconds: Math.round(attempt.durationSeconds) });
    } catch {
      // The talk is saved; only the XP did not count.
    }
    void navigate(`/speaking/attempts/${attempt.id}?evaluate=1`);
  };

  return (
    <Page width="narrow">
      <PageHeader
        title={daily ? 'Discurso do Dia' : 'Treino livre'}
        subtitle={daily ? 'Um tema curto para falar de improviso, todo dia diferente.' : 'Grave uma fala sobre qualquer tema ou explique um assunto das suas notas.'}
      />
      <div className="space-y-6">
        {!daily && <PendingBanner onRecovered={(a) => void navigate(`/speaking/attempts/${a.id}?evaluate=1`)} />}
        <Card className="space-y-4 p-5">
          {todays ? (
            <div>
              <p className="text-xs text-muted">Tema de hoje</p>
              <p className="mt-1 text-lg font-semibold text-balance">{todays.text}</p>
            </div>
          ) : (
            <>
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
                    {(field) => <Input {...field} value={theme} maxLength={300} onChange={(e) => setTheme(e.target.value)} placeholder="Ex.: por que todo mundo deveria aprender a cozinhar" />}
                  </Field>
                  <div className="space-y-1.5">
                    <p className="text-[13px] font-medium">Tipo de fala</p>
                    <Segmented label="Tipo de fala" value={type} onChange={setType} options={FREE_TYPES.map((t) => ({ value: t, label: SPEECH_TYPE_LABELS[t] }))} />
                  </div>
                </>
              )}
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meta de tempo">
              {(field) => (
                <Select {...field} value={target} onChange={(e) => setTarget(e.target.value)}>
                  {(daily ? [{ value: '60', label: '1 minuto' }, { value: '90', label: '1 minuto e meio' }, { value: '120', label: '2 minutos' }] : TARGETS).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {learned.length > 0 && (
              <Field label="Método de estrutura" optional>
                {(field) => (
                  <Select {...field} value={method || (chosenMethod?.id ?? '')} onChange={(e) => setMethod(e.target.value as MethodId | '')}>
                    {!todays && <option value="">Nenhum</option>}
                    {learned.map((m) => (
                      <option key={m} value={m}>
                        {SPEECH_METHODS[m].name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          {chosenMethod && (
            <ol className="space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
              {chosenMethod.parts.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">
                    {i + 1}. {p.name}:
                  </span>{' '}
                  <span className="text-muted">{p.hint}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-subtle">
            O áudio fica no aparelho: só os trechos de fala vão para a transcrição, e nada de áudio é guardado. Fale perto do microfone, sempre à mesma distância.
          </p>
          <TalkRecorder persist setup={setup} disabled={!ready} onAttempt={(a) => void saved(a)} />
        </Card>
      </div>
    </Page>
  );
}
