import { useEffect, useId, useRef, useState } from 'react';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type ReactNodeViewProps } from '@tiptap/react';
import { Plus, SlidersHorizontal, Trash, X } from 'lucide-react';

/**
 * Note properties (like Obsidian's): a block of key/value pairs at the top of
 * a note — status, prazo, fonte… They are part of the note's text index as
 * "chave: valor", so the search finds "status: lendo".
 */
export interface Property {
  key: string;
  value: string;
}

export const PROPERTY_SUGGESTIONS = ['status', 'prazo', 'fonte', 'autor', 'tipo', 'prioridade', 'link'];

export const PropertiesNode = Node.create({
  name: 'properties',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { items: { default: [] as Property[] } };
  },
  parseHTML() {
    return [
      {
        tag: 'dl[data-properties]',
        getAttrs: (el) => {
          try {
            return { items: JSON.parse(el.getAttribute('data-items') ?? '[]') as Property[] };
          } catch {
            return { items: [] };
          }
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const items = (node.attrs.items as Property[]) ?? [];
    const { items: _omit, ...attrs } = HTMLAttributes as Record<string, unknown>;
    void _omit;
    return ['dl', mergeAttributes(attrs, { 'data-properties': '', 'data-items': JSON.stringify(items) }), ...items.map((p) => ['div', ['dt', p.key], ['dd', p.value]])];
  },
  renderText({ node }) {
    return ((node.attrs.items as Property[]) ?? []).map((p) => `${p.key}: ${p.value}`).join('\n');
  },
  addNodeView() {
    return ReactNodeViewRenderer(PropertiesView, {
      // Typing in the fields belongs to them, not to the document.
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('input, button'),
    });
  },
});

function PropertiesView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const items = (node.attrs.items as Property[]) ?? [];
  const [draft, setDraft] = useState<Property[]>(items);
  const editable = editor.isEditable;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(items), [node.attrs.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Property[]) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => updateAttributes({ items: next.filter((p) => p.key.trim() || p.value.trim()) }), 400);
  };
  const set = (i: number, patch: Partial<Property>) => commit(draft.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const listId = useId();
  return (
    <NodeViewWrapper className="properties-node not-prose my-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm" contentEditable={false}>
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted">
        <SlidersHorizontal className="size-3.5" aria-hidden /> Propriedades
        {editable && (
          <button type="button" onClick={deleteNode} title="Remover propriedades" className="ml-auto rounded p-0.5 text-subtle hover:text-danger">
            <Trash className="size-3.5" />
          </button>
        )}
      </div>
      <datalist id={listId}>
        {PROPERTY_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="space-y-1">
        {draft.map((p, i) => (
          <div key={i} className="group flex items-center gap-2">
            <input
              value={p.key}
              readOnly={!editable}
              list={listId}
              placeholder="chave"
              aria-label="Nome da propriedade"
              onChange={(e) => set(i, { key: e.target.value.slice(0, 40) })}
              className="w-32 shrink-0 rounded-md bg-transparent px-1.5 py-1 font-medium text-muted outline-none focus:bg-surface"
            />
            <input
              value={p.value}
              readOnly={!editable}
              placeholder="valor"
              aria-label={`Valor de ${p.key || 'propriedade'}`}
              onChange={(e) => set(i, { value: e.target.value.slice(0, 300) })}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 outline-none focus:bg-surface"
            />
            {editable && (
              <button type="button" aria-label="Remover" onClick={() => commit(draft.filter((_, j) => j !== i))} className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:text-text">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <button type="button" onClick={() => commit([...draft, { key: '', value: '' }])} className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:text-accent">
          <Plus className="size-3.5" /> Adicionar propriedade
        </button>
      )}
    </NodeViewWrapper>
  );
}
