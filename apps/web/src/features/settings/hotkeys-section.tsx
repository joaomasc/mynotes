import { useEffect, useMemo, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { normalizeSearch } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Kbd } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { effectiveHotkey, eventToHotkey, formatHotkey, resetHotkeys, setHotkey, useHotkeyOverrides } from '@/lib/hotkeys';
import { useCommands } from '../commands/commands';

/** Every command with its shortcut: change, remove or restore (saved on this device). */
export function HotkeysSection() {
  const commands = useCommands();
  const [overrides] = useHotkeyOverrides();
  const [filter, setFilter] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);

  // While capturing, the next key combination becomes the shortcut (Esc cancels).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      const hotkey = eventToHotkey(e);
      if (!hotkey) return;
      setHotkey(capturing, hotkey);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of commands) {
      const k = effectiveHotkey(c.id, c.hotkey, overrides);
      if (k) map.set(k, [...(map.get(k) ?? []), c.id]);
    }
    return map;
  }, [commands, overrides]);

  const q = normalizeSearch(filter);
  const list = commands.filter((c) => !q || normalizeSearch(`${c.label} ${c.group}`).includes(q) || normalizeSearch(effectiveHotkey(c.id, c.hotkey, overrides) ?? '').includes(q));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar comandos ou teclas" aria-label="Filtrar comandos" className="max-w-xs" />
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={resetHotkeys} disabled={Object.keys(overrides).length === 0}>
          Restaurar todos
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {list.map((c) => {
          const key = effectiveHotkey(c.id, c.hotkey, overrides);
          const conflict = key ? (usage.get(key)?.length ?? 0) > 1 : false;
          const changed = c.id in overrides;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="text-muted [&>svg]:size-4">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.label}</span>
                <span className="block text-[11px] text-subtle">
                  {c.group}
                  {conflict && <span className="text-danger"> · tecla usada por outro comando</span>}
                </span>
              </span>
              {capturing === c.id ? (
                <span className="animate-pulse rounded-md bg-accent-soft px-2 py-1 text-xs text-accent">Pressione as teclas… (Esc cancela)</span>
              ) : key ? (
                <Kbd>{formatHotkey(key)}</Kbd>
              ) : (
                <span className="text-xs text-subtle">sem atalho</span>
              )}
              <div className="flex">
                <IconButton label="Definir atalho" size="sm" active={capturing === c.id} onClick={() => setCapturing(capturing === c.id ? null : c.id)}>
                  <Keyboard className="size-4" />
                </IconButton>
                <IconButton label="Remover atalho" size="sm" disabled={!key} onClick={() => setHotkey(c.id, null)}>
                  <X className="size-4" />
                </IconButton>
                <IconButton label="Restaurar padrão" size="sm" disabled={!changed} className={cn(!changed && 'invisible')} onClick={() => setHotkey(c.id, undefined)}>
                  <RotateCcw className="size-3.5" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-subtle">
        Os atalhos valem neste aparelho. Atalhos reservados pelo navegador (como Ctrl+T e Ctrl+W) não podem ser usados; por isso as abas usam Alt.
      </p>
    </div>
  );
}
