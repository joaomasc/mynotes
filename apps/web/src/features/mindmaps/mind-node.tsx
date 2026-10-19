import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { MindMapNode } from '@mynotes/shared';
import { cn } from '@/lib/cn';
import { endpoints } from '@/lib/api/endpoints';
import { EntityIcon, entityPath } from '@/lib/entities';
import { qk } from '@/lib/query';
import { openModeOf, workspace } from '../workspace/store';
import { usePane } from '../workspace/tab-info';

export interface MindNodeData extends Record<string, unknown> {
  label: string;
  color: string | null;
  ref: MindMapNode['ref'];
  parentId: string | null;
  editing?: boolean;
}
export type MindFlowNode = Node<MindNodeData, 'mind'>;

const handle = '!size-2.5 !border-2 !border-surface !bg-border-strong opacity-0 group-hover:opacity-100 group-[.selected]:opacity-100 [@media(hover:none)]:opacity-100';

/** Text of a linked note, shown on the node like a canvas card. */
function NoteCard({ id }: { id: string }) {
  const note = useQuery({ queryKey: qk.note(id), queryFn: () => endpoints.notes.get(id), staleTime: 60_000 });
  if (!note.data) return null;
  return note.data.excerpt ? (
    <p className="mt-1.5 line-clamp-6 border-t border-border pt-1.5 text-xs leading-relaxed text-muted">{note.data.excerpt}</p>
  ) : (
    <p className="mt-1.5 border-t border-border pt-1.5 text-xs text-subtle">Nota vazia</p>
  );
}

export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps<MindFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const pane = usePane();
  const [draft, setDraft] = useState(data.label);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (data.editing) {
      setDraft(data.label);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
  }, [data.editing, data.label]);

  const commit = () => updateNodeData(id, { label: draft.trim() || data.label || 'Ideia', editing: false });
  const isRoot = data.parentId === null && id === 'root';

  return (
    <div
      className={cn(
        'group min-w-24 rounded-xl border bg-surface px-3 py-2 text-sm shadow-card transition-shadow',
        data.ref?.type === 'note' ? 'w-72' : 'max-w-64',
        selected ? 'selected border-accent ring-2 ring-accent/30' : 'border-border',
        isRoot && 'px-4 py-3 text-base font-semibold',
      )}
      style={data.color ? { borderLeftColor: data.color, borderLeftWidth: 4 } : undefined}
      onDoubleClick={() => updateNodeData(id, { editing: true })}
    >
      {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => (
        <Handle key={`s${side}`} id={`s-${side}`} type="source" position={Position[side]} className={handle} />
      ))}
      {data.editing ? (
        <textarea
          ref={input}
          value={draft}
          rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 28)))}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') updateNodeData(id, { editing: false });
          }}
          aria-label="Texto do nó"
          className="nodrag w-full resize-none bg-transparent outline-none"
        />
      ) : (
        <p className="break-words whitespace-pre-wrap">{data.label || <span className="text-subtle">Sem texto</span>}</p>
      )}
      {data.ref && (
        <Link
          to={entityPath(data.ref.type, data.ref.id)}
          onClick={(e) => {
            // Opens beside the map, which stays where it is (Ctrl+click etc. keep their meaning).
            if (!pane || openModeOf(e) !== 'same') return;
            e.preventDefault();
            workspace.openBeside(entityPath(data.ref!.type, data.ref!.id), pane.paneId);
          }}
          className="nodrag mt-1.5 flex items-center gap-1 truncate text-xs text-muted hover:text-accent"
          title={pane ? 'Abrir item vinculado ao lado' : 'Abrir item vinculado'}
        >
          <EntityIcon type={data.ref.type} className="size-3" />
          <span className="truncate">{data.ref.title ?? 'Item vinculado'}</span>
        </Link>
      )}
      {data.ref?.type === 'note' && <NoteCard id={data.ref.id} />}
    </div>
  );
});
