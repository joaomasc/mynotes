import { useSyncExternalStore } from 'react';
import { LoaderCircle, RotateCcw, Square, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { Dictation, DictationState } from './dictation';

export function useDictationState(dictation: Dictation): DictationState {
  return useSyncExternalStore(dictation.subscribe, dictation.getState, dictation.getState);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Five bars that follow the microphone level. */
function LevelMeter({ level }: { level: number }) {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden>
      {[0.15, 0.3, 0.45, 0.6, 0.75].map((step) => (
        <span
          key={step}
          className={cn('w-1 rounded-full transition-[height,background-color] duration-75', level >= step ? 'bg-danger' : 'bg-border')}
          style={{ height: `${Math.round(step * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** Status of a dictation in progress: shown under the toolbar until all text has arrived. */
export function DictationBar({ dictation }: { dictation: Dictation }) {
  const s = useDictationState(dictation);
  if (s.status === 'idle') return null;

  const sending = s.pending > 0 && !s.error && !s.offline;
  // Announced on changes only (the clock and meter would be read nonstop).
  const announcement =
    s.error ??
    (s.offline ? 'Sem conexão: o áudio aguarda para ser transcrito.' : { starting: 'Abrindo o microfone', recording: 'Gravando', finishing: 'Transcrevendo o final' }[s.status]);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {s.status === 'starting' && (
        <span className="flex items-center gap-2 text-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Abrindo o microfone…
        </span>
      )}
      {s.status === 'recording' && (
        <>
          <span className="flex items-center gap-2 font-medium text-danger">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
            Gravando <span className="tabular-nums">{clock(s.elapsed)}</span>
          </span>
          <LevelMeter level={s.level} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {sending ? 'Transcrevendo…' : s.wrote ? 'O texto aparece a cada pausa.' : 'Fale normalmente. O texto aparece a cada pausa.'}
          </span>
        </>
      )}
      {s.status === 'finishing' && !s.error && !s.offline && (
        <span className="flex flex-1 items-center gap-2 text-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Transcrevendo o final…
        </span>
      )}
      {s.offline && (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Sem conexão. {s.pending === 1 ? '1 trecho aguarda' : `${s.pending} trechos aguardam`} para virar texto.
        </span>
      )}
      {s.error && (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-danger">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {s.error}
        </span>
      )}

      <span className="ml-auto flex items-center gap-1.5">
        {(s.error || s.offline) && (
          <>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => dictation.retry()}>
              Tentar de novo
            </Button>
            {s.status === 'finishing' && (
              <Button size="sm" variant="ghost" onClick={() => dictation.discard()}>
                Descartar áudio
              </Button>
            )}
          </>
        )}
        {s.status === 'recording' && (
          <Button size="sm" variant="outline" icon={<Square className="size-3.5 fill-current" />} onClick={() => dictation.stop()}>
            Parar
          </Button>
        )}
      </span>
    </div>
  );
}
