import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_SPEECH_LIMITS, SKILL_LABELS, SPEECH_SKILLS, calibratedLimits, type SpeechSettings } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { ErrorState, PageLoader } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Segmented } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { disablePush, enablePush } from '@/lib/push';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { useUpdateSetting } from '../settings/use-settings';
import { TrendChart } from './trend-chart';
import { useSpeechPath } from './use-speech-path';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : null;
};

function SkillBar({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Nível ${level} de 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn('h-2 w-5 rounded-sm', i < level ? 'bg-accent' : 'bg-surface-3')} />
      ))}
    </span>
  );
}

/** Daily goal and the calibrated limits, with a suggestion from the user's own talks. */
function Calibration({ settings, talks }: { settings: SpeechSettings; talks: { wpm: number; pvq: number | null }[] }) {
  const update = useUpdateSetting('speech');
  const [goal, setGoal] = useState(String(settings.dailyGoalMinutes));
  const [paceMin, setPaceMin] = useState(settings.limits.paceMin?.toString() ?? '');
  const [paceMax, setPaceMax] = useState(settings.limits.paceMax?.toString() ?? '');
  const [pvq, setPvq] = useState(settings.limits.pvqGood?.toString().replace('.', ',') ?? '');
  const [drop, setDrop] = useState(settings.limits.finalDropDb?.toString() ?? '');
  useEffect(() => setGoal(String(settings.dailyGoalMinutes)), [settings.dailyGoalMinutes]);

  const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
  const suggest = () => {
    const wpm = median(talks.map((t) => t.wpm).filter((v) => v > 0));
    const pv = median(talks.map((t) => t.pvq).filter((v): v is number => v !== null));
    if (wpm === null) return toast.info('Grave algumas falas primeiro.');
    // Around your natural pace, never outside a comfortable range for listeners.
    setPaceMin(String(Math.max(110, Math.min(150, Math.round(wpm - 15)))));
    setPaceMax(String(Math.max(140, Math.min(180, Math.round(wpm + 15)))));
    if (pv !== null) setPvq(Math.max(0.08, Math.min(0.2, pv * 0.85)).toFixed(2).replace('.', ','));
  };
  const save = () => {
    const value: SpeechSettings = {
      ...settings,
      dailyGoalMinutes: Number(goal) as SpeechSettings['dailyGoalMinutes'],
      limits: { paceMin: num(paceMin), paceMax: num(paceMax), pvqGood: num(pvq), finalDropDb: num(drop) },
    };
    update.mutate(value, { onSuccess: () => toast.success('Configurações da oratória salvas. Valem para as próximas falas.') });
  };
  const preview = calibratedLimits({ paceMin: num(paceMin), paceMax: num(paceMax), pvqGood: num(pvq), finalDropDb: num(drop) });
  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium">Meta diária</p>
        <Segmented
          label="Meta diária"
          value={goal}
          onChange={setGoal}
          options={['5', '10', '15', '20'].map((m) => ({ value: m, label: `${m} min` }))}
        />
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">Calibração da régua</p>
        <p className="text-xs text-muted">
          As faixas de referência são genéricas. Com algumas falas gravadas, ajuste-as à sua voz: o ritmo em torno do seu ritmo natural e o limite de monotonia
          perto da sua variação de tom. Vazio = valor padrão.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Ritmo mínimo">{(f) => <Input {...f} inputMode="numeric" value={paceMin} onChange={(e) => setPaceMin(e.target.value)} placeholder={String(DEFAULT_SPEECH_LIMITS.paceGood[0])} />}</Field>
          <Field label="Ritmo máximo">{(f) => <Input {...f} inputMode="numeric" value={paceMax} onChange={(e) => setPaceMax(e.target.value)} placeholder={String(DEFAULT_SPEECH_LIMITS.paceGood[1])} />}</Field>
          <Field label="Monotonia abaixo de">{(f) => <Input {...f} inputMode="decimal" value={pvq} onChange={(e) => setPvq(e.target.value)} placeholder="0,16" />}</Field>
          <Field label="Queda no fim (dB)">{(f) => <Input {...f} inputMode="numeric" value={drop} onChange={(e) => setDrop(e.target.value)} placeholder={String(DEFAULT_SPEECH_LIMITS.finalDropDb)} />}</Field>
        </div>
        <p className="text-xs text-subtle tabular-nums">
          Vai valer: ritmo bom de {preview.paceGood[0]} a {preview.paceGood[1]} palavras/min · monótono abaixo de {preview.pvqGood.toFixed(2).replace('.', ',')} · queda no fim acima de {preview.finalDropDb} dB.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" icon={<Wand2 className="size-4" />} onClick={suggest}>
          Sugerir a partir das minhas falas
        </Button>
        <Button variant="primary" loading={update.isPending} onClick={save}>
          Salvar
        </Button>
      </div>
    </Card>
  );
}

/** Keep recordings and the daily reminder (Web Push). */
function AudioAndReminder({ settings }: { settings: SpeechSettings }) {
  const update = useUpdateSetting('speech');
  const push = useQuery({ queryKey: ['speech-push'], queryFn: endpoints.speech.pushStatus });
  const [time, setTime] = useState(settings.reminder.time);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTime(settings.reminder.time), [settings.reminder.time]);
  const save = (patch: Partial<SpeechSettings>, done?: string) =>
    update.mutate({ ...settings, ...patch }, { onSuccess: () => done && toast.success(done) });

  const toggleReminder = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        if (!push.data?.publicKey) throw new Error('Os lembretes não estão configurados neste servidor.');
        await enablePush(push.data.publicKey);
      } else {
        await disablePush();
      }
      save({ reminder: { enabled: on, time, tzOffsetMinutes: -new Date().getTimezoneOffset() } }, on ? 'Lembrete ativado.' : 'Lembrete desativado.');
      void push.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1">
        <Checkbox
          checked={settings.keepAudio}
          onChange={(v) => save({ keepAudio: v }, v ? 'As próximas falas terão a gravação guardada.' : 'As próximas falas não guardam a gravação.')}
          label="Guardar a gravação das falas"
        />
        <p className="pl-7 text-xs text-muted">
          Para ouvir de novo e pedir a avaliação completa (a IA ouvindo a sua voz). Ocupa cerca de 1 MB por minuto no armazenamento e não entra no backup. Os ensaios dos
          seus discursos sempre guardam a gravação.
        </p>
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        <Checkbox checked={settings.reminder.enabled} onChange={(v) => void toggleReminder(v)} label="Lembrete diário de treino" />
        <p className="pl-7 text-xs text-muted">Uma notificação no horário escolhido, só nos dias em que você ainda não treinou. Funciona no app publicado (no iPhone, instalado na tela inicial).</p>
        <div className="flex flex-wrap items-end gap-3 pl-7">
          <Field label="Horário">
            {(f) => <Input {...f} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />}
          </Field>
          <Button
            variant="outline"
            loading={update.isPending || busy}
            disabled={!/^\d{2}:\d{2}$/.test(time)}
            onClick={() => save({ reminder: { ...settings.reminder, time, tzOffsetMinutes: -new Date().getTimezoneOffset() } }, 'Horário salvo.')}
          >
            Salvar horário
          </Button>
          {settings.reminder.enabled && (push.data?.subscriptions ?? 0) > 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                endpoints.speech
                  .testPush()
                  .then((r) => toast.success(r.sent ? 'Notificação de teste enviada.' : 'Nenhum navegador recebeu: ative de novo neste aparelho.'))
                  .catch((err) => toast.error(errorMessage(err)))
              }
            >
              Enviar um teste
            </Button>
          )}
        </div>
        {push.data && !push.data.publicKey && <p className="pl-7 text-xs text-subtle">Este servidor ainda não tem as chaves de notificação (VAPID).</p>}
      </div>
    </Card>
  );
}

export function Component() {
  const path = useSpeechPath();
  const talks = useQuery({ queryKey: [...qk.speechAttempts, 'trend'], queryFn: () => endpoints.speech.list({ limit: 60 }) });
  const series = useMemo(() => [...(talks.data?.data ?? [])].reverse(), [talks.data]);
  if (path.isPending) return <PageLoader />;
  if (path.isError) return <ErrorState error={path.error} onRetry={() => void path.refetch()} />;
  const s = path.data;
  const limits = calibratedLimits(s.settings.limits);
  const bySkill = new Map(s.skills.map((x) => [x.skill, x]));
  const maxXp = Math.max(...s.week.map((d) => d.xp), 1);

  return (
    <Page width="narrow">
      <PageHeader title="Progresso na oratória" subtitle={<Link to="/speaking" className="text-accent hover:underline">← Voltar à trilha</Link>} />
      <div className="space-y-8">
        <Section title="XP nos últimos 7 dias">
          <Card className="p-4">
            <div className="flex h-28 items-end gap-2">
              {s.week.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.xp} XP`}>
                  <span className="text-[11px] text-muted tabular-nums">{d.xp || ''}</span>
                  <span className="block w-full max-w-6 rounded-t-[4px] bg-accent" style={{ height: `${(d.xp / maxXp) * 80}px` }} />
                  <span className="text-[11px] text-subtle">{format(parseISO(d.day), 'EEEEE', { locale: ptBR })}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section title="Habilidades">
          <Card className="divide-y divide-border">
            {SPEECH_SKILLS.map((id) => {
              const sk = bySkill.get(id);
              return (
                <div key={id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">{SKILL_LABELS[id]}</span>
                  {sk ? (
                    <>
                      <span className="hidden text-xs text-subtle sm:inline">
                        {sk.nextReviewOn && sk.nextReviewOn <= s.today ? 'revisar hoje' : sk.nextReviewOn ? `revisar em ${format(parseISO(sk.nextReviewOn), 'd/MM')}` : ''}
                      </span>
                      <SkillBar level={sk.level} />
                    </>
                  ) : (
                    <span className="text-xs text-subtle">ainda não praticada</span>
                  )}
                </div>
              );
            })}
          </Card>
        </Section>

        <Section title="Evolução das falas">
          <Card className="space-y-6 p-4">
            <TrendChart title="Ritmo" unit="palavras/min" points={series.map((a) => ({ date: a.startedAt, value: a.wpm }))} band={limits.paceGood} />
            <TrendChart title="Vícios de linguagem" unit="por minuto" digits={1} points={series.map((a) => ({ date: a.startedAt, value: a.fillersPerMinute }))} band={[0, limits.fillersGood]} />
            <TrendChart
              title="Variação do tom"
              unit=""
              digits={2}
              points={series.filter((a) => a.pvq !== null).map((a) => ({ date: a.startedAt, value: a.pvq! }))}
              band={[limits.pvqGood, Math.max(limits.pvqGood + 0.1, 0.3)]}
            />
          </Card>
        </Section>

        <Section title="Configurações">
          <Calibration settings={s.settings} talks={series.map((a) => ({ wpm: a.wpm, pvq: a.pvq }))} />
        </Section>

        <Section title="Gravações e lembrete">
          <AudioAndReminder settings={s.settings} />
        </Section>
      </div>
    </Page>
  );
}
