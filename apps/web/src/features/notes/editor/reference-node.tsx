import { useState } from 'react';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type ReactNodeViewProps } from '@tiptap/react';
import { useNavigate } from 'react-router';
import { Link2Off, Replace, TextCursorInput, Trash } from 'lucide-react';
import { internalHref, parseInternalHref, type InternalLinkType, type SearchResult } from '@mynotes/shared';
import { Dialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { ENTITY_CSS_VAR } from '@/lib/entities';
import { referencePath, refSyntax, useReference } from '@/lib/references';
import { EntityPicker } from '../../shared/entity-picker';

/**
 * A reference to another item, inserted with "/". Stored as
 * `{ href: "mynotes:<type>/<id>[/p/<page>]", label }`: the id is the source
 * of truth, `label` is only a snapshot of the title for search and fallback.
 * The view always shows the current title, so renaming the target keeps the
 * reference working; a deleted target is shown as broken and can be repaired.
 */
export const ReferenceNode = Node.create({
  name: 'reference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      href: { default: null },
      label: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'a[data-reference]',
        getAttrs: (el) => ({ href: el.getAttribute('href'), label: el.getAttribute('data-label') ?? el.textContent ?? '' }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-reference': '', 'data-label': node.attrs.label }), `/${node.attrs.label}`];
  },
  renderText({ node }) {
    return `/${node.attrs.label as string}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReferenceView, { as: 'span', className: 'reference-wrapper' });
  },
});

function ReferenceView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const navigate = useNavigate();
  const [repairing, setRepairing] = useState(false);
  const label = String(node.attrs.label ?? '');
  const link = parseInternalHref(node.attrs.href);
  const { data, isError } = useReference(link?.type, link?.id);
  const broken = !link || data?.exists === false;
  const text = broken || !data ? `/${label || 'referência'}` : refSyntax(data, link?.page);
  const color = link ? ENTITY_CSS_VAR[data?.type === 'note' && data.role !== 'note' ? 'reading' : link.type] : undefined;

  const toText = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, label || 'referência').run();
  };
  const retarget = (item: SearchResult) => {
    updateAttributes({ href: internalHref(item.type as InternalLinkType, item.id), label: item.title });
    setRepairing(false);
  };

  const chip = (
    <span
      role="link"
      tabIndex={-1}
      title={broken ? 'Referência quebrada: o item foi excluído ou movido para a lixeira' : isError ? 'Sem conexão para confirmar o item' : undefined}
      data-broken={broken || undefined}
      onClick={(e) => {
        if (broken) return; // the repair menu opens instead
        e.preventDefault();
        e.stopPropagation();
        if (data && link) void navigate(referencePath(data, link.page));
      }}
      className={cn(
        'reference-chip cursor-pointer rounded px-1 py-px font-medium no-underline',
        broken ? 'bg-danger-soft text-danger line-through decoration-danger/50' : 'bg-accent-soft text-accent hover:underline',
        selected && 'ring-2 ring-accent/50',
      )}
      style={broken ? undefined : { color, background: color ? `color-mix(in srgb, ${color} 12%, transparent)` : undefined }}
    >
      {text}
    </span>
  );

  return (
    <NodeViewWrapper as="span" className="reference-node">
      {broken && editor.isEditable ? (
        <Menu
          label="Reparar referência"
          align="start"
          trigger={<button type="button" className="inline">{chip}</button>}
          items={[
            { label: 'Escolher outro item…', icon: <Replace />, onSelect: () => setRepairing(true) },
            { label: 'Manter como texto', icon: <TextCursorInput />, onSelect: toText },
            { label: 'Remover referência', icon: <Trash />, danger: true, onSelect: deleteNode },
          ]}
        />
      ) : (
        chip
      )}
      {repairing && (
        <Dialog
          open
          onOpenChange={setRepairing}
          title="Reparar referência"
          description={
            <span className="inline-flex items-center gap-1.5">
              <Link2Off className="size-3.5" aria-hidden /> “{label || 'item'}” não existe mais. Escolha o item certo.
            </span>
          }
        >
          <EntityPicker types={['topic', 'note', 'reading', 'document', 'concept']} onPick={retarget} />
        </Dialog>
      )}
    </NodeViewWrapper>
  );
}
