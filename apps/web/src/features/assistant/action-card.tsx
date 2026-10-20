import { Link } from 'react-router';
import { Check, CircleAlert, Clock, ShieldAlert, X } from 'lucide-react';
import type { AiAction, AiPreviewLine } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { EntityIcon } from '@/lib/entities';
import { sourcePath } from './rich-text';

const STATUS: Record<AiAction['status'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  proposed: { label: 'Aguarda sua confirmação', tone: 'accent' },
  executing: { label: 'Executando…', tone: 'neutral' },
  executed: { label: 'Feito', tone: 'success' },
  rejected: { label: 'Descartada', tone: 'neutral' },
  failed: { label: 'Falhou — nada foi gravado', tone: 'danger' },
  expired: { label: 'Expirou', tone: 'neutral' },
};

const STATE: Record<AiPreviewLine['state'], { label: string; cls: string }> = {
  new: { label: 'novo', cls: 'text-success' },
  existing: { label: 'já existe', cls: 'text-muted' },
  change: { label: 'alteração', cls: 'text-warning' },
};

/**
 * A write requested by the assistant. Proposals show exactly what will be
 * written and run only when the user clicks "Confirmar"; the server checks
 * everything again before writing.
 */
export function ActionCard({
  action,
  onDecide,
  busy,
}: {
  action: AiAction;
  onDecide: (accept: boolean) => void;
  busy: boolean;
}) {
  const status = STATUS[action.status];
  const pending = action.status === 'proposed';
  return (
    <section
      aria-label={`Ação: ${action.title}`}
      className={cn('rounded-lg border bg-surface p-2.5 text-sm', pending ? 'border-accent/50' : 'border-border')}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted" aria-hidden>
          {action.status === 'executed' ? (
            <Check className="size-4 text-success" />
          ) : action.status === 'failed' ? (
            <CircleAlert className="size-4 text-danger" />
          ) : action.kind === 'sensitive' ? (
            <ShieldAlert className="size-4 text-warning" />
          ) : (
            <Clock className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{action.title}</p>
          <Badge tone={status.tone} className="mt-1">
            {status.label}
          </Badge>
        </div>
      </div>

      {action.preview.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-surface-2 p-2 text-[13px]" aria-label="Prévia">
          {action.preview.map((line, i) => (
            <li key={i} style={{ paddingLeft: `${line.depth * 0.9}rem` }} className="break-words">
              <span>{line.label}</span>{' '}
              <span className={cn('text-[11px]', STATE[line.state].cls)}>({STATE[line.state].label})</span>
              {line.detail && <span className="block text-xs text-muted">{line.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {action.kind === 'sensitive' && pending && (
        <p className="mt-2 text-xs text-warning">Operação sensível: muda a estrutura ou substitui conteúdo. Revise a prévia antes de confirmar.</p>
      )}
      {action.error && <p className="mt-2 text-xs text-danger">{action.error}</p>}

      {action.results.length > 0 && action.status === 'executed' && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Itens criados ou alterados">
          {action.results.slice(0, 12).map((r) => (
            <li key={`${r.type}:${r.id}`}>
              <Link to={sourcePath(r)} className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-surface-2">
                <EntityIcon type={r.type} className="size-3.5 shrink-0" />
                <span className="truncate">{r.title || 'Sem título'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<Check className="size-4" />} loading={busy} onClick={() => onDecide(true)}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} disabled={busy} onClick={() => onDecide(false)}>
            Descartar
          </Button>
        </div>
      )}
    </section>
  );
}
