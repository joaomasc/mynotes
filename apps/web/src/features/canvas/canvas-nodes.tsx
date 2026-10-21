import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { Link } from 'react-router';
import { ExternalLink, Globe, TriangleAlert } from 'lucide-react';
import { asRichTextDoc, type RichTextDoc } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { plural } from '@/lib/format';
import { qk } from '@/lib/query';
import { EmbeddedNote } from '../notes/embedded-note';
import { noteExtensions } from '../notes/editor/extensions';
import { ReferenceMenu } from '../notes/editor/reference-menu';
import { ReadOnlyDoc } from '../notes/read-only-doc';
import { openModeOf, workspace } from '../workspace/store';
import { usePane } from '../workspace/tab-info';
import { SIDES, type CardData, type CardNode } from './canvas-model';

/** Where the canvas lives: items created from "/" in its text cards go to its topic. */
export const CanvasContext = createContext<{ topicId: string | null }>({ topicId: null });

const BLANK: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const POSITIONS = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
const handleClass =
  '!size-3 !border-2 !border-surface !bg-border-strong opacity-0 transition-opacity group-hover:opacity-100 group-[.selected]:opacity-100 [@media(hover:none)]:opacity-100';

/** Tinted card background for a color (Obsidian colors whole cards). */
const tint = (color: string | null, amount = 7) => (color ? { borderColor: color, background: `color-mix(in srgb, ${color} ${amount}%, var(--surface))` } : undefined);

function useCardUpdate(id: string) {
  const { updateNodeData } = useReactFlow();
  return (patch: Partial<CardData>) => updateNodeData(id, patch);
}

/** Leaving a card (selecting something else) ends its editing. */
function useStopEditingWhenDeselected(id: string, selected: boolean, editing: boolean | undefined) {
  const update = useCardUpdate(id);
  useEffect(() => {
    if (!selected && editing) update({ editing: false });
  }, [selected, editing]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Frame({
  selected,
  color,
  minWidth = 120,
  minHeight = 60,
  className,
  children,
}: {
  selected: boolean;
  color: string | null;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('group relative h-full w-full', selected && 'selected')}>
      <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} lineClassName="!border-accent/60" handleClassName="!size-2.5 !rounded-sm !border-accent !bg-surface" />
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={POSITIONS[side]} className={handleClass} />
      ))}
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-xl border bg-surface shadow-card',
          selected ? 'border-accent ring-2 ring-accent/30' : 'border-border',
          className,
        )}
        style={tint(color)}
      >
        {children}
      </div>
    </div>
  );
}

/** A link inside a card: in the workspace it opens beside the canvas, which stays where it is. */
function OpenLink({ to, className, title, children }: { to: string; className?: string; title?: string; children: ReactNode }) {
  const pane = usePane();
  return (
    <Link
      to={to}
      title={title}
      onClick={(e) => {
        if (!pane || openModeOf(e) !== 'same') return;
        e.preventDefault();
        workspace.openBeside(to, pane.paneId);
      }}
      className={cn('nodrag', className)}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------- text card */

/** Rich text edited inside a card: same editor as notes, "/" references and code blocks included. */
function CardTextEditor({ id, doc }: { id: string; doc: RichTextDoc | undefined }) {
  const update = useCardUpdate(id);
  const { topicId } = useContext(CanvasContext);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<RichTextDoc | null>(null);
  const editor = useEditor({
    extensions: noteExtensions('Escreva… / cita um assunto, nota ou livro; # marca uma tag.'),
    content: doc?.content?.length ? doc : BLANK,
    autofocus: 'end',
    editorProps: { attributes: { class: 'prose-note prose-card min-h-full', 'aria-label': 'Texto do cartão' } },
    onUpdate: ({ editor: e }) => {
      pending.current = asRichTextDoc(e.getJSON() as RichTextDoc);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current) update({ doc: pending.current });
        pending.current = null;
      }, 400);
    },
  });
  // Typing stopped less than 400 ms ago: keep it when leaving the card.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) update({ doc: pending.current });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div
      className="nodrag nopan nowheel nokey h-full cursor-text overflow-y-auto px-4 py-3"
      onKeyDown={(e) => {
        // The "/" menu handles its own Escape first.
        if (e.key === 'Escape' && !e.defaultPrevented) update({ editing: false });
      }}
    >
      <EditorContent editor={editor} />
      {editor && <ReferenceMenu editor={editor} topicId={topicId} />}
    </div>
  );
}

export const TextCard = memo(function TextCard({ id, data, selected }: NodeProps<CardNode>) {
  const update = useCardUpdate(id);
  useStopEditingWhenDeselected(id, selected, data.editing);
  return (
    <Frame selected={selected} color={data.color}>
      {data.editing ? (
        <CardTextEditor id={id} doc={data.doc} />
      ) : (
        <div className={cn('h-full overflow-y-auto px-4 py-3', selected && 'nowheel')} onDoubleClick={() => update({ editing: true })}>
          {data.doc?.content?.length ? (
            <ReadOnlyDoc key={JSON.stringify(data.doc)} content={data.doc} className="prose-note prose-card" />
          ) : (
            <p className="text-sm text-subtle">Duplo clique para escrever</p>
          )}
        </div>
      )}
    </Frame>
  );
});

/* ------------------------------------------------------------- item card */

function NoteBody({ id, editing, selected }: { id: string; editing: boolean; selected: boolean }) {
  const note = useQuery({ queryKey: qk.note(id), queryFn: ({ signal }) => endpoints.notes.get(id, signal), staleTime: 30_000 });
  if (editing) {
    return (
      <div className="nodrag nopan nowheel nokey min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <EmbeddedNote noteId={id} hideTitle />
      </div>
    );
  }
  if (!note.data) return <p className="px-4 pb-3 text-xs text-subtle">{note.isError ? 'Não foi possível carregar a nota.' : 'Carregando…'}</p>;
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-3', selected && 'nowheel')}>
      {note.data.content.content.length ? (
        <ReadOnlyDoc key={`${note.data.id}:${note.data.version}`} content={note.data.content} className="prose-note prose-card" />
      ) : (
        <p className="text-sm text-subtle">Nota vazia — duplo clique para escrever.</p>
      )}
    </div>
  );
}

/** Subtopics and notes of a topic. Each row is a link: drag it onto the canvas to make it a card. */
function TopicBody({ id, selected }: { id: string; selected: boolean }) {
  const detail = useQuery({ queryKey: qk.topic(id), queryFn: () => endpoints.topics.get(id) });
  const notes = useQuery({
    queryKey: qk.notes({ topicId: id, sort: 'manual' }),
    queryFn: () => endpoints.notes.list({ topicId: id, sort: 'manual', limit: 100 }),
  });
  const children = detail.data?.children ?? [];
  const items = notes.data?.data ?? [];
  return (
    <div className={cn('min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 text-sm', selected && 'nowheel')}>
      {detail.data?.topic.description && <p className="text-xs text-muted">{detail.data.topic.description}</p>}
      {children.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Subassuntos</p>
          <div className="flex flex-wrap gap-1">
            {children.map((c) => (
              <OpenLink key={c.id} to={`/topics/${c.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent">
                <span className="size-2 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--border-strong)' }} aria-hidden />
                <span className="truncate">{c.title}</span>
              </OpenLink>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{notes.data ? plural(items.length, 'nota', 'notas') : 'Notas'}</p>
        {items.length ? (
          <ul className="space-y-0.5">
            {items.slice(0, 30).map((n) => (
              <li key={n.id}>
                <OpenLink to={`/notes/${n.id}`} className="flex items-center gap-1.5 truncate rounded px-1 py-0.5 hover:bg-surface-2 hover:text-accent">
                  <EntityIcon type="note" className="size-3 shrink-0 text-note" />
                  <span className="truncate">{n.title || 'Sem título'}</span>
                </OpenLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-subtle">{notes.isLoading ? 'Carregando…' : 'Nenhuma nota.'}</p>
        )}
      </div>
    </div>
  );
}

export const ItemCard = memo(function ItemCard({ id, data, selected }: NodeProps<CardNode>) {
  const update = useCardUpdate(id);
  useStopEditingWhenDeselected(id, selected, data.editing);
  const ref = data.ref;
  if (!ref) {
    return (
      <Frame selected={selected} color={data.color}>
        <div className="flex h-full items-center gap-2 px-4 text-sm text-muted">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="truncate">“{data.label || 'Item'}” foi excluído</span>
        </div>
      </Frame>
    );
  }
  const path = entityPath(ref.type, ref.id);
  const big = ref.type === 'note' || ref.type === 'topic';
  return (
    <Frame selected={selected} color={data.color} minHeight={big ? 120 : 56}>
      <div className={cn('flex shrink-0 items-center gap-2 px-4', big ? 'border-b border-border/70 py-2.5' : 'h-full')} onDoubleClick={() => ref.type === 'note' && update({ editing: true })}>
        <EntityIcon type={ref.type} className="size-4 shrink-0" />
        <OpenLink to={path} className="min-w-0 flex-1 truncate font-medium hover:text-accent" title={`Abrir ${entityLabel(ref.type).toLowerCase()}`}>
          {ref.title || data.label || 'Sem título'}
        </OpenLink>
        {!big && <span className="shrink-0 text-xs text-subtle">{entityLabel(ref.type)}</span>}
      </div>
      {ref.type === 'note' && (
        <div className="flex min-h-0 flex-1 flex-col pt-2" onDoubleClick={() => !data.editing && update({ editing: true })}>
          <NoteBody id={ref.id} editing={!!data.editing} selected={selected} />
        </div>
      )}
      {ref.type === 'topic' && (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
          <TopicBody id={ref.id} selected={selected} />
        </div>
      )}
    </Frame>
  );
});

/* ------------------------------------------------------------- link card */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const LinkCard = memo(function LinkCard({ id, data, selected }: NodeProps<CardNode>) {
  const update = useCardUpdate(id);
  useStopEditingWhenDeselected(id, selected, data.editing);
  const [draft, setDraft] = useState({ label: data.label, url: data.url ?? '' });
  useEffect(() => {
    if (data.editing) setDraft({ label: data.label, url: data.url ?? '' });
  }, [data.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const url = draft.url.trim();
    update({ label: draft.label.trim(), editing: false, ...(/^https?:\/\//i.test(url) ? { url } : {}) });
  };
  return (
    <Frame selected={selected} color={data.color} minHeight={56}>
      {data.editing ? (
        <div
          className="nodrag nopan nokey flex h-full flex-col justify-center gap-1.5 px-3"
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') update({ editing: false });
          }}
        >
          <input autoFocus value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" aria-label="Endereço" className="h-7 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent" />
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Título (opcional)" aria-label="Título" maxLength={500} className="h-7 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent" />
        </div>
      ) : (
        <div className="flex h-full items-center gap-3 px-4" onDoubleClick={() => update({ editing: true })}>
          <Globe className="size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{data.label || (data.url ? hostOf(data.url) : 'Link')}</p>
            <p className="truncate text-xs text-muted">{data.url ?? 'Duplo clique para colocar o endereço'}</p>
          </div>
          {data.url && (
            <a href={data.url} target="_blank" rel="noopener noreferrer nofollow" className="nodrag shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-accent" title="Abrir em nova aba" aria-label="Abrir em nova aba">
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      )}
    </Frame>
  );
});

/* ------------------------------------------------------------ group card */

export const GroupCard = memo(function GroupCard({ id, data, selected }: NodeProps<CardNode>) {
  const update = useCardUpdate(id);
  useStopEditingWhenDeselected(id, selected, data.editing);
  const [draft, setDraft] = useState(data.label);
  useEffect(() => {
    if (data.editing) setDraft(data.label);
  }, [data.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => update({ label: draft.trim(), editing: false });
  return (
    <div className={cn('group relative h-full w-full', selected && 'selected')}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} lineClassName="!border-accent/60" handleClassName="!size-2.5 !rounded-sm !border-accent !bg-surface" />
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={POSITIONS[side]} className={handleClass} />
      ))}
      <div
        className={cn('h-full w-full rounded-2xl border-2', selected ? 'border-accent' : 'border-border-strong/70')}
        style={data.color ? { borderColor: data.color, background: `color-mix(in srgb, ${data.color} 6%, transparent)` } : { background: 'color-mix(in srgb, var(--surface-3) 35%, transparent)' }}
      />
      <div className="absolute -top-8 left-1 max-w-full" onDoubleClick={() => update({ editing: true })}>
        {data.editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') update({ editing: false });
            }}
            aria-label="Nome do grupo"
            className="nodrag nokey h-7 rounded-md border border-accent bg-surface px-2 text-sm font-semibold outline-none"
          />
        ) : (
          <span className="inline-block max-w-full truncate rounded-md px-2 py-1 text-sm font-semibold" style={data.color ? { color: data.color } : { color: 'var(--text-muted)' }}>
            {data.label || 'Grupo'}
          </span>
        )}
      </div>
    </div>
  );
});

export const cardTypes = { text: TextCard, item: ItemCard, link: LinkCard, group: GroupCard };
