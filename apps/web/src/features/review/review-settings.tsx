import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReviewSettings } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Segmented } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { enablePush } from '@/lib/push';
import { useReviewSettings } from './use-review';

const RETENTIONS = [
  { value: '0.85', label: '85%', title: 'Menos revisões; você esquece um pouco mais' },
  { value: '0.9', label: '90%', title: 'O equilíbrio recomendado' },
  { value: '0.95', label: '95%', title: 'Bem mais revisões; para provas próximas' },
];

/** How much to remember, how many new items a day, the session size and the daily reminder. */
export function ReviewSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, save, saving } = useReviewSettings();
  const push = useQuery({ queryKey: ['speech-push'], queryFn: endpoints.speech.pushStatus, enabled: open });
  const [draft, setDraft] = useState<ReviewSettings>(settings);
  const [busy, setBusy] = useState(false);
  // Copied when the dialog opens: the settings object is new on every render.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(settings);
    wasOpen.current = open;
  }, [open, settings]);
  const set = (patch: Partial<ReviewSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    setBusy(true);
    try {
      const reminder = { ...draft.reminder, tzOffsetMinutes: -new Date().getTimezoneOffset() };
      if (reminder.enabled && !settings.reminder.enabled) {
        if (!push.data?.publicKey) throw new Error('Os lembretes não estão configurados neste servidor.');
        await enablePush(push.data.publicKey);
      }
      // Turning the reminder off keeps this browser subscribed: the speaking reminder may use it.
      await save({ desiredRetention: draft.desiredRetention, newPerDay: draft.newPerDay, sessionSize: draft.sessionSize, askConfidence: draft.askConfidence, reminder });
      toast.success('Configurações da revisão salvas');
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Configurações da revisão"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving || busy} onClick={() => void submit()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Quanto lembrar" hint="A chance de você lembrar quando um item volta. Mais alto traz os itens de volta mais cedo (mais revisões por dia).">
          {() => (
            <Segmented
              label="Memória desejada"
              value={String(draft.desiredRetention)}
              onChange={(v) => set({ desiredRetention: Number(v) })}
              options={RETENTIONS.some((r) => r.value === String(draft.desiredRetention)) ? RETENTIONS : [...RETENTIONS, { value: String(draft.desiredRetention), label: `${Math.round(draft.desiredRetention * 100)}%`, title: '' }]}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Novos por dia" hint="Itens nunca vistos que entram a cada dia.">
            {(p) => <Input {...p} type="number" min={0} max={200} value={draft.newPerDay} onChange={(e) => set({ newPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />}
          </Field>
          <Field label="Itens por sessão" hint="O padrão ao começar.">
            {(p) => <Input {...p} type="number" min={5} max={200} value={draft.sessionSize} onChange={(e) => set({ sessionSize: Math.max(5, Math.min(200, Number(e.target.value) || 5)) })} />}
          </Field>
        </div>
        <div className="space-y-1">
          <Checkbox checked={draft.askConfidence} onChange={(v) => set({ askConfidence: v })} label="Perguntar “quão certo você está?” antes da resposta" />
          <p className="pl-7 text-xs text-muted">Erros cometidos com certeza ficam marcados e voltam mais cedo: são os que mais valem uma segunda olhada.</p>
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <Checkbox checked={draft.reminder.enabled} onChange={(v) => set({ reminder: { ...draft.reminder, enabled: v } })} label="Lembrete diário de revisão" />
          <p className="pl-7 text-xs text-muted">Uma notificação no horário escolhido, nos dias com itens para revisar e nenhuma revisão feita. Funciona no app publicado (no iPhone, instalado na tela inicial).</p>
          <div className="pl-7">
            <Field label="Horário">
              {(f) => <Input {...f} type="time" value={draft.reminder.time} onChange={(e) => set({ reminder: { ...draft.reminder, time: e.target.value } })} className="w-32" />}
            </Field>
          </div>
          {push.data && !push.data.publicKey && <p className="pl-7 text-xs text-subtle">Este servidor ainda não tem as chaves de notificação (VAPID).</p>}
        </div>
      </div>
    </Dialog>
  );
}
