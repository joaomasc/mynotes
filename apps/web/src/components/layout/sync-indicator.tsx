import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSyncStatus } from '@/lib/sync/status';

/**
 * Shows the real synchronization state. "Sincronizado" only appears when
 * nothing is waiting for server confirmation.
 */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const s = useSyncStatus();
  let icon = <Cloud className="size-4" aria-hidden />;
  let label = 'Sincronizado';
  let tone = 'text-muted';
  let detail: string | undefined = s.lastSyncedAt ? `Última confirmação: ${new Date(s.lastSyncedAt).toLocaleTimeString('pt-BR')}` : undefined;

  if (!s.online) {
    icon = <CloudOff className="size-4" aria-hidden />;
    label = s.pending > 0 ? `Offline · ${s.pending} pendente${s.pending > 1 ? 's' : ''}` : 'Offline';
    tone = 'text-warning';
    detail = 'As alterações em notas ficam salvas neste aparelho e serão enviadas quando a conexão voltar.';
  } else if (s.conflicts > 0) {
    icon = <TriangleAlert className="size-4" aria-hidden />;
    label = `${s.conflicts} conflito${s.conflicts > 1 ? 's' : ''}`;
    tone = 'text-danger';
    detail = 'Uma nota foi alterada em outro dispositivo. Abra-a para escolher qual versão manter.';
  } else if (s.inFlight > 0 || s.pending > 0) {
    icon = <RefreshCw className="size-4 animate-spin" aria-hidden />;
    label = s.pending > 0 ? `Salvando ${s.pending}…` : 'Salvando…';
    tone = 'text-muted';
  } else if (s.lastError) {
    icon = <TriangleAlert className="size-4" aria-hidden />;
    label = 'Falha ao salvar';
    tone = 'text-danger';
    detail = s.lastError;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      title={detail ? `${label} — ${detail}` : label}
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium', tone)}
    >
      {icon}
      <span className={cn(compact && 'sr-only')}>{label}</span>
    </div>
  );
}
