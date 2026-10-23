import { useMemo, useState } from 'react';
import { Check, ChevronRight, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { topScope, uuidv7 } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { useTopics, type TopicNode } from '../topics/use-topics';
import { useReviewSettings } from './use-review';

/**
 * Choosing what to review: a topic covers itself and everything under it
 * (A covers its children B and grandchildren C; B alone covers B and C,
 * not A nor B's siblings). Nothing chosen: everything.
 */
export function ScopePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { tree, isLoading } = useTopics();
  const chosen = useMemo(() => new Set(value), [value]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const parentOf = (id: string) => tree.byId.get(id)?.parentId ?? null;

  /** The selected ancestor that already covers this topic, if any. */
  const coveredBy = (node: TopicNode): TopicNode | null => {
    let p = node.parentId ? tree.byId.get(node.parentId) : undefined;
    const seen = new Set<string>();
    while (p && !seen.has(p.id)) {
      if (chosen.has(p.id)) return p;
      seen.add(p.id);
      p = p.parentId ? tree.byId.get(p.parentId) : undefined;
    }
    return null;
  };
  const toggle = (node: TopicNode) => {
    if (chosen.has(node.id)) onChange(value.filter((id) => id !== node.id));
    else onChange(topScope([...value, node.id], parentOf));
  };
  // A topic with a selected descendant opens, so the selection is visible; a selected one opens to show the children it includes.
  const hasChosenBelow = (node: TopicNode): boolean => node.children.some((c) => chosen.has(c.id) || hasChosenBelow(c));
  const isOpen = (node: TopicNode) => open.has(node.id) || (!open.has(`-${node.id}`) && (chosen.has(node.id) || hasChosenBelow(node)));
  const flip = (node: TopicNode) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen(node)) {
        next.delete(node.id);
        next.add(`-${node.id}`);
      } else {
        next.add(node.id);
        next.delete(`-${node.id}`);
      }
      return next;
    });

  const rows: React.ReactNode[] = [];
  const walk = (nodes: TopicNode[]) => {
    for (const node of nodes) {
      const cover = coveredBy(node);
      const checked = chosen.has(node.id) || !!cover;
      rows.push(
        <li key={node.id} className="flex items-center gap-1" style={{ paddingLeft: node.depth * 18 }}>
          <button
            type="button"
            onClick={() => flip(node)}
            className={cn('flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-2', node.children.length === 0 && 'invisible')}
            aria-label={isOpen(node) ? `Fechar ${node.title}` : `Abrir ${node.title}`}
            aria-expanded={isOpen(node)}
          >
            <ChevronRight className={cn('size-4 transition-transform', isOpen(node) && 'rotate-90')} />
          </button>
          <label
            className={cn('flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-surface-2', cover && 'cursor-default text-muted hover:bg-transparent')}
            title={cover ? `Já incluído por “${cover.title}”` : undefined}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--accent)]"
              checked={checked}
              disabled={!!cover}
              onChange={() => toggle(node)}
            />
            <span className="min-w-0 truncate">{node.title}</span>
            {node.noteCount > 0 && (
              <span className="shrink-0 text-xs text-subtle tabular-nums" aria-hidden title={`${node.noteCount} ${node.noteCount === 1 ? 'nota' : 'notas'}`}>
                {node.noteCount}
              </span>
            )}
          </label>
        </li>,
      );
      if (node.children.length && isOpen(node)) walk(node.children);
    }
  };
  walk(tree.roots);

  return (
    <div className="space-y-3">
      <Presets value={value} onChange={onChange} />
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{value.length === 0 ? 'Nenhum assunto marcado: tudo entra.' : `${value.length} ${value.length === 1 ? 'assunto marcado' : 'assuntos marcados'}, cada um com os subassuntos.`}</span>
        {value.length > 0 && (
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange([])}>
            Limpar
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted">Carregando assuntos…</p>
      ) : tree.roots.length === 0 ? (
        <p className="text-sm text-muted">Você ainda não tem assuntos. Os cartões sem assunto entram sempre.</p>
      ) : (
        <ul className="scrollbar-thin max-h-80 overflow-y-auto rounded-lg border border-border p-1.5" aria-label="Assuntos">
          {rows}
        </ul>
      )}
    </div>
  );
}

/** Named selections, saved in the review settings (synced across devices). */
function Presets({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { settings, save, saving } = useReviewSettings();
  const { tree } = useTopics();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const same = (ids: string[]) => ids.length === value.length && ids.every((id) => value.includes(id));
  const alive = (ids: string[]) => ids.filter((id) => tree.byId.has(id));
  const add = async () => {
    const clean = name.trim();
    if (!clean || value.length === 0) return;
    try {
      await save({ scopes: [...settings.scopes.filter((s) => s.name !== clean), { id: uuidv7(), name: clean, topicIds: value }].slice(-30) });
      setNaming(false);
      setName('');
      toast.success('Seleção salva');
    } catch {
      // The setting hook already shows the error.
    }
  };
  if (settings.scopes.length === 0 && value.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {settings.scopes.map((s) => (
        <span key={s.id} className={cn('inline-flex items-center rounded-full border text-xs', same(alive(s.topicIds)) ? 'border-accent bg-accent-soft text-accent' : 'border-border')}>
          <button type="button" className="inline-flex items-center gap-1 py-1 pr-1 pl-2.5 font-medium" onClick={() => onChange(alive(s.topicIds))}>
            {same(alive(s.topicIds)) && <Check className="size-3" aria-hidden />}
            {s.name}
          </button>
          <button
            type="button"
            className="rounded-full p-1 text-subtle hover:text-danger"
            aria-label={`Apagar a seleção ${s.name}`}
            onClick={() => void save({ scopes: settings.scopes.filter((x) => x.id !== s.id) })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {value.length > 0 &&
        (naming ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da seleção" maxLength={80} className="h-8 w-44 sm:h-8" aria-label="Nome da seleção" />
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!name.trim()}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancelar
            </Button>
          </form>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft" onClick={() => setNaming(true)}>
            <Plus className="size-3" aria-hidden /> Salvar seleção
          </button>
        ))}
    </div>
  );
}
