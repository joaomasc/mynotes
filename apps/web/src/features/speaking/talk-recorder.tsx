import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mic, Square, TriangleAlert, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SpeechAttempt } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Card } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { dictationSupported } from '@/lib/dictation/recorder';
import { useBeforeUnloadGuard } from '@/lib/hooks';
import { clock } from './speaking-ui';
import { SpeechSession, type SpeechRecording, type SpeechSetup } from './speech-session';

export function useSessionState(session: SpeechSession) {
  return useSyncExternalStore(session.subscribe, session.getState);
}

/** Microphone level as a bar (0–1). */
export function LevelMeter({ level }: { level: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

/** Live panel while recording: timer, meter, counters, connection problems, stop and discard. */
export function RecordingPanel({ session, target, onStop, compact }: { session: SpeechSession; target: number | null; onStop: () => void; compact?: boolean }) {
  const s = useSessionState(session);
  const confirm = useConfirm();
  useBeforeUnloadGuard(s.status !== 'idle');
  const minutes = Math.max(s.elapsed, 1) / 60;
  const over = target !== null && s.elapsed > target;
  const cancel = async () => {
    if (await confirm({ title: 'Descartar esta gravação?', description: 'Nada do que foi gravado será usado.', confirmLabel: 'Descartar', danger: true })) await session.cancel();
  };
  return (
    <Card className={cn('space-y-5', compact ? 'p-4' : 'p-5')}>
      <div className="text-center">
        <p className="text-sm text-muted">{s.status === 'recording' ? 'Gravando' : s.status === 'saving' ? 'Salvando a fala…' : 'Terminando de transcrever…'}</p>
        <p className={cn('mt-1 font-semibold tabular-nums', compact ? 'text-3xl' : 'text-5xl', over && 'text-warning')}>{clock(s.elapsed)}</p>
        {target !== null && <p className="mt-1 text-xs text-subtle tabular-nums">meta: {clock(target)}</p>}
      </div>
      {s.status === 'recording' && <LevelMeter level={s.level} />}
      {!compact && (
        <>
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
        </>
      )}
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
            <Button variant="primary" size="lg" icon={<Square className="size-4" />} onClick={onStop}>
              Terminar
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => void cancel()}>
            Descartar a gravação
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * A start button that becomes the recording panel. Saved talks (persist)
 * resolve with the stored attempt; exercises resolve with the measurements.
 */
export function TalkRecorder(
  props: {
    setup: SpeechSetup;
    startLabel?: string;
    compact?: boolean;
    disabled?: boolean;
  } & ({ persist: true; onAttempt: (a: SpeechAttempt) => void } | { persist: false; onRecording: (r: SpeechRecording) => void }),
) {
  const [session] = useState(() => new SpeechSession());
  const s = useSessionState(session);
  const [starting, setStarting] = useState(false);
  useEffect(() => () => session.dispose(), [session]);

  if (!dictationSupported()) {
    return <p className="text-sm text-muted">Este navegador não permite gravar pelo microfone aqui. Use um navegador atualizado, numa página segura (https).</p>;
  }
  if (s.status !== 'idle') {
    const stop = async () => {
      try {
        if (props.persist) {
          const attempt = await session.stop();
          if (attempt) props.onAttempt(attempt);
        } else {
          const rec = await session.measure();
          if (rec) props.onRecording(rec);
        }
      } catch (err) {
        toast.error(errorMessage(err));
      }
    };
    return <RecordingPanel session={session} target={props.setup.targetSeconds} onStop={() => void stop()} compact={props.compact} />;
  }
  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      icon={<Mic className="size-4" />}
      loading={starting}
      disabled={props.disabled}
      onClick={async () => {
        setStarting(true);
        try {
          await session.start(props.setup, { persist: props.persist });
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setStarting(false);
        }
      }}
    >
      {props.startLabel ?? 'Começar a gravar'}
    </Button>
  );
}
