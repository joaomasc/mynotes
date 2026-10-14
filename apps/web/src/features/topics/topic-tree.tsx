import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ChevronRight, Ellipsis, FolderInput, FolderTree, Pencil, Plus, StickyNote, Trash } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { useCreateNote } from '../notes/use-create-note';
import { DeleteTopicDialog, MoveTopicDialog, TopicFormDialog, invalidateTopicData } from './topic-dialogs';
import { descendantIds, useTopics, type TopicNode } from './use-topics';

const EXPANDED_KEY = 'mynotes:tree-expanded';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type DropZone = 'before' | 'inside' | 'after';

export function TopicTree({ onNavigate }: { onNavigate?: () => void }) {
  const { tree, isLoading, isError } = useTopics();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const match = useMatch('/topics/:id');
  const activeId = match?.params.id;

  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [dialog, setDialog] = useState<
    | { kind: 'create'; parentId: string | null }
    | { kind: 'edit' | 'move' | 'delete'; node: TopicNode }
    | null
  >(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; zone?: DropZone } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // storage unavailable: expansion simply isn't remembered
    }
  }, [expanded]);

  // Reveal the active topic.
  useEffect(() => {
    if (!activeId) return;
    const node = tree.byId.get(activeId);
    if (!node?.parentId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = node.parentId ? tree.byId.get(node.parentId) : undefined;
      while (p) {
        next.add(p.id);
        p = p.parentId ? tree.byId.get(p.parentId) : undefined;
      }
      return next.size === prev.size ? prev : next;
    });
  }, [activeId, tree]);

  const toggle = useCallback((id: string, force?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const open = force ?? !next.has(id);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const out: TopicNode[] = [];
    const walk = (nodes: TopicNode[]) => {
      for (const n of nodes) {
        out.push(n);
        if (expanded.has(n.id)) walk(n.children);
      }
    };
    walk(tree.roots);
    return out;
  }, [tree, expanded]);

  const move = useMutation({
    mutationFn: (v: { node: TopicNode; parentId: string | null; afterId?: string | null; beforeId?: string | null }) =>
      endpoints.topics.move(v.node.id, {
        baseVersion: v.node.version,
        parentId: v.parentId,
        ...(v.afterId !== undefined ? { afterId: v.afterId } : {}),
        ...(v.beforeId !== undefined ? { beforeId: v.beforeId } : {}),
      }),
    onSuccess: (_d, v) => {
      if (v.parentId) toggle(v.parentId, true);
      invalidateTopicData(qc);
    },
    onError: (err) => {
      invalidateTopicData(qc);
      toast.error(errorMessage(err));
    },
  });

  const focusRow = (id: string | undefined) => id && rowRefs.current.get(id)?.focus();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, node: TopicNode) => {
    const idx = visible.findIndex((n) => n.id === node.id);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(visible[idx + 1]?.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(visible[idx - 1]?.id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node.children.length && !expanded.has(node.id)) toggle(node.id, true);
        else focusRow(node.children[0]?.id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expanded.has(node.id)) toggle(node.id, false);
        else focusRow(node.parentId ?? undefined);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(visible[0]?.id);
        break;
      case 'End':
        e.preventDefault();
        focusRow(visible[visible.length - 1]?.id);
        break;
      case 'Enter':
        e.preventDefault();
        void navigate(`/topics/${node.id}`);
        onNavigate?.();
        break;
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, node: TopicNode) => {
    if (!drag || drag.id === node.id) return;
    const dragged = tree.byId.get(drag.id);
    if (!dragged || descendantIds(dragged).has(node.id)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone: DropZone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    if (drag.over !== node.id || drag.zone !== zone) setDrag({ ...drag, over: node.id, zone });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, target: TopicNode) => {
    e.preventDefault();
    const dragged = drag ? tree.byId.get(drag.id) : undefined;
    const zone = drag?.zone;
    setDrag(null);
    if (!dragged || !zone || dragged.id === target.id) return;
    if (zone === 'inside') move.mutate({ node: dragged, parentId: target.id });
    else if (zone === 'before') move.mutate({ node: dragged, parentId: target.parentId, beforeId: target.id });
    else move.mutate({ node: dragged, parentId: target.parentId, afterId: target.id });
  };

  const renderNode = (node: TopicNode) => {
    const isOpen = expanded.has(node.id);
    const isActive = node.id === activeId;
    const hasChildren = node.children.length > 0;
    const count = node.noteCount + node.documentCount;
    const dropping = drag?.over === node.id ? drag.zone : undefined;
    return (
      <div key={node.id} role="none">
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(node.id, el);
            else rowRefs.current.delete(node.id);
          }}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={isActive}
          aria-label={node.title}
          tabIndex={isActive || (!activeId && node === visible[0]) ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, node)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
            setDrag({ id: node.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => onDragOver(e, node)}
          onDragLeave={() => drag?.over === node.id && setDrag({ id: drag.id })}
          onDrop={(e) => onDrop(e, node)}
          className={cn(
            'group relative flex h-9 items-center gap-0.5 rounded-lg pr-1 text-sm outline-none lg:h-8',
            'focus-visible:ring-2 focus-visible:ring-accent',
            isActive ? 'bg-accent-soft font-medium text-accent' : 'text-text hover:bg-surface-2',
            dropping === 'inside' && 'ring-2 ring-accent',
            drag?.id === node.id && 'opacity-50',
          )}
          style={{ paddingLeft: 4 + node.depth * 14 }}
        >
          {dropping === 'before' && <span className="absolute inset-x-2 top-0 h-0.5 rounded bg-accent" aria-hidden />}
          {dropping === 'after' && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" aria-hidden />}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden={!hasChildren}
            onClick={() => hasChildren && toggle(node.id)}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded text-subtle hover:text-text',
              !hasChildren && 'invisible',
            )}
            aria-label={isOpen ? 'Recolher' : 'Expandir'}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
          </button>
          <span
            className="mr-1.5 size-2 shrink-0 rounded-full"
            style={{ background: node.color ?? 'var(--border-strong)' }}
            aria-hidden
          />
          <Link
            to={`/topics/${node.id}`}
            tabIndex={-1}
            onClick={onNavigate}
            className="min-w-0 flex-1 truncate py-1"
            draggable={false}
          >
            {node.title}
          </Link>
          {count > 0 && <span className="px-1 text-xs text-subtle tabular-nums group-hover:hidden">{count}</span>}
          <Menu
            label={`Ações de ${node.title}`}
            trigger={
              <IconButton
                label="Ações"
                size="sm"
                tabIndex={-1}
                className="size-7 opacity-100 group-hover:opacity-100 focus:opacity-100 lg:opacity-0 [@media(hover:none)]:opacity-100"
              >
                <Ellipsis className="size-4" />
              </IconButton>
            }
            items={[
              { label: 'Nova nota aqui', icon: <StickyNote />, onSelect: () => createNote.mutate(node.id) },
              { label: 'Novo subassunto', icon: <Plus />, onSelect: () => setDialog({ kind: 'create', parentId: node.id }) },
              'separator',
              { label: 'Editar', icon: <Pencil />, onSelect: () => setDialog({ kind: 'edit', node }) },
              { label: 'Mover para…', icon: <FolderInput />, onSelect: () => setDialog({ kind: 'move', node }) },
              'separator',
              { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => setDialog({ kind: 'delete', node }) },
            ]}
          />
        </div>
        {hasChildren && isOpen && <div role="group">{node.children.map(renderNode)}</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-xs font-semibold tracking-wide text-subtle uppercase">Assuntos</span>
        <IconButton label="Novo assunto" size="sm" className="size-7" onClick={() => setDialog({ kind: 'create', parentId: null })}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      {isLoading ? (
        <div className="space-y-1 px-2" aria-hidden>
          {[70, 55, 80].map((w) => (
            <div key={w} className="h-6 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : isError && tree.roots.length === 0 ? (
        <p className="px-2 text-xs text-muted">Não foi possível carregar os assuntos.</p>
      ) : tree.roots.length === 0 ? (
        <button
          type="button"
          onClick={() => setDialog({ kind: 'create', parentId: null })}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-left text-sm text-muted hover:border-accent hover:text-accent"
        >
          <FolderTree className="size-4" /> Crie seu primeiro assunto
        </button>
      ) : (
        <div role="tree" aria-label="Assuntos" className="space-y-px">
          {tree.roots.map(renderNode)}
        </div>
      )}

      <TopicFormDialog
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onOpenChange={(o) => !o && setDialog(null)}
        topic={dialog?.kind === 'edit' ? dialog.node : undefined}
        parentId={dialog?.kind === 'create' ? dialog.parentId : undefined}
      />
      <MoveTopicDialog
        open={dialog?.kind === 'move'}
        onOpenChange={(o) => !o && setDialog(null)}
        topic={dialog?.kind === 'move' ? dialog.node : null}
      />
      <DeleteTopicDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        topic={dialog?.kind === 'delete' ? dialog.node : null}
        onDeleted={() => {
          if (dialog?.kind === 'delete' && dialog.node.id === activeId) void navigate('/');
        }}
      />
    </div>
  );
}
