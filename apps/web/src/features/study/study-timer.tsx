import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pause, Play, Square, Timer, Trash } from 'lucide-react';
import { zStudyTimer, type Setting, type StudyTimer } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card } from '@/components/ui/layout';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { clock } from '@/lib/format';
import { qk } from '@/lib/query';
import { useSettings } from '../settings/use-settings';
import { TopicSelect } from '../topics/topic-dialogs';
import type { SessionPrefill } from './session-dialog';

const IDLE: StudyTimer = { status: 'idle', topicId: null, objective: '', startedAt: null, resumedAt: null, accumulatedSeconds: 0 };

export function elapsedSeconds(t: StudyTimer, now = Date.now()): number {
  const running = t.status === 'running' && t.resumedAt ? Math.max(0, (now - Date.parse(t.resumedAt)) / 1000) : 0;
  return Math.floor(t.accumulatedSeconds + running);
}

/**
 * The timer state lives in the server settings, so a session started on the
 * laptop can be paused or finished on the phone.
 */
export function StudyTimerCard({ onFinish }: { onFinish: (prefill: SessionPrefill) => void }) {
  const qc = useQueryClient();
  const { data } = useSettings();
  const setting = data?.find((s) => s.key === 'study_timer');
  const parsed = zStudyTimer.safeParse(setting?.value);
  const timer = parsed.success ? parsed.data : IDLE;
  const [now, setNow] = useState(Date.now());
  const [topicId, setTopicId] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (timer.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer.status]);

  const save = async (next: StudyTimer) => {
    setBusy(true);
    try {
      const saved = await endpoints.settings.put('study_timer', next, setting?.version);
      qc.setQueryData<Setting[]>(qk.settings, (prev = []) => [...prev.filter((s) => s.key !== 'study_timer'), saved]);
      setNow(Date.now());
    } catch (err) {
      void qc.invalidateQueries({ queryKey: qk.settings });
      toast.error(isVersionConflict(err) ? 'O cronômetro foi alterado em outro dispositivo. Estado atualizado.' : errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const iso = () => new Date().toISOString();
  const start = () => save({ status: 'running', topicId, objective, startedAt: iso(), resumedAt: iso(), accumulatedSeconds: 0 }).catch(() => undefined);
  const pause = () => save({ ...timer, status: 'paused', accumulatedSeconds: elapsedSeconds(timer), resumedAt: null }).catch(() => undefined);
  const resume = () => save({ ...timer, status: 'running', resumedAt: iso() }).catch(() => undefined);
  const finish = async () => {
    const seconds = elapsedSeconds(timer);
    try {
      await save(IDLE);
    } catch {
      return;
    }
    if (seconds < 60) {
      toast.info('Sessões com menos de 1 minuto não são registradas.');
      return;
    }
    onFinish({ startedAt: timer.startedAt ?? iso(), durationSeconds: seconds, topicId: timer.topicId, objective: timer.objective, source: 'timer' });
  };
  const discard = () => save(IDLE).catch(() => undefined);

  const elapsed = elapsedSeconds(timer, now);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <Timer className="size-4" aria-hidden /> Cronômetro
      </div>
      {timer.status === 'idle' ? (
        <div className="mt-4 space-y-3">
          <Field label="Assunto" optional>{(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}</Field>
          <Field label="Objetivo" optional>{(p) => <Input {...p} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="O que vai estudar agora?" />}</Field>
          <Button variant="primary" className="w-full" icon={<Play className="size-4" />} loading={busy} onClick={() => void start()}>
            Iniciar
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-[2.75rem] leading-none font-semibold tracking-tight" aria-live="off" role="timer">
            {clock(elapsed)}
          </p>
          <p className="mt-2 text-sm text-muted">
            {timer.status === 'paused' ? 'Pausado' : 'Em andamento'}
            {timer.objective ? ` · ${timer.objective}` : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {timer.status === 'running' ? (
              <Button variant="outline" icon={<Pause className="size-4" />} disabled={busy} onClick={() => void pause()}>
                Pausar
              </Button>
            ) : (
              <Button variant="outline" icon={<Play className="size-4" />} disabled={busy} onClick={() => void resume()}>
                Retomar
              </Button>
            )}
            <Button variant="primary" icon={<Square className="size-4" />} disabled={busy} onClick={() => void finish()}>
              Finalizar
            </Button>
            <Button variant="ghost" icon={<Trash className="size-4" />} disabled={busy} onClick={() => void discard()}>
              Descartar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
