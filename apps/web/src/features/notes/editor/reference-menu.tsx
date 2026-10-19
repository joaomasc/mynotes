import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { FolderPlus, Hash, Heading, StickyNote, TextCursorInput } from 'lucide-react';
import { internalHref, normalizeSearch, normalizeTag, uuidv7, type InternalLinkType, type Reference, type RichTextNode } from '@mynotes/shared';
import { Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon } from '@/lib/entities';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { REF_KINDS, parseRefQuery, refSyntax, type RefKind } from '@/lib/references';
import { topicPath, useTopics } from '../../topics/use-topics';
import { dismissTrigger, type Trigger, type TriggerStorage } from './triggers';

type Item =
  | { kind: 'ref'; ref: Reference }
  /** A book under "/pagina." before the page is typed: picking it asks for the page. */
  | { kind: 'pick-page'; ref: Reference }
  | { kind: 'type'; def: RefKind }
  | { kind: 'create-topic'; title: string }
  | { kind: 'create-note'; title: string }
  | { kind: 'keep' }
  /** A heading of a note: `/nota.Título#Seção`. */
  | { kind: 'heading'; ref: Reference; heading: string }
  | { kind: 'tag'; tag: string; count: number | null };

/** Text of the headings (levels 1–3) of a note's content. */
function headingsOf(doc: RichTextNode | undefined): string[] {
  const out: string[] = [];
  const text = (n: RichTextNode): string => (n.text ?? '') + (n.content ?? []).map(text).join('');
  const visit = (n: RichTextNode) => {
    if (n.type === 'heading') {
      const t = text(n).trim();
      if (t) out.push(t);
      return;
    }
    (n.content ?? []).forEach(visit);
  };
  if (doc) visit(doc);
  return out;
}

/** Inserts a reference node (plus a space) in place of the "/query". */
export function insertReference(
  editor: Editor,
  range: { from: number; to: number },
  ref: Pick<Reference, 'type' | 'id' | 'title' | 'role' | 'readingTitle' | 'page'>,
  page: number | null,
  heading: string | null = null,
) {
  const label =
    ref.type === 'note' && ref.role === 'annotation'
      ? `${ref.readingTitle ?? 'Livro'}${ref.page ? `, p. ${ref.page}` : ''}`
      : `${ref.title || 'Sem título'}${ref.type === 'reading' && page ? `, p. ${page}` : ''}`;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'reference', attrs: { href: internalHref(ref.type as InternalLinkType, ref.id, ref.type === 'reading' ? page : null), label, heading } },
      { type: 'text', text: ' ' },
    ])
    .run();
}

/**
 * Suggestions for "/" (references to existing items, with options to create
 * one or keep plain text when nothing matches) and "#" (existing tags).
 */
export function ReferenceMenu({ editor, noteId, topicId }: { editor: Editor; noteId?: string; topicId?: string | null }) {
  const qc = useQueryClient();
  const { tree } = useTopics();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Enter pressed before the results matched the typed text: applied when they arrive. */
  const queuedEnter = useRef(false);

  useEffect(() => {
    const storage = (editor.storage as unknown as { triggers: TriggerStorage }).triggers;
    storage.onChange = (t) => {
      setTrigger(t);
      setActive(0);
      queuedEnter.current = false;
    };
    return () => {
      storage.onChange = null;
      storage.onKeyDown = null;
    };
  }, [editor]);

  const query = useDebounced(trigger?.query ?? '', 120);
  const parsed = useMemo(() => parseRefQuery(query), [query]);
  const slash = trigger?.char === '/';
  // "/nota.Título#Seção" (or "/Título#Seção"): a heading of a note.
  const headingQuery = useMemo(() => {
    if (parsed.kind && parsed.kind.prefix !== 'nota') return null;
    const m = /^(.+?)#([^#]*)$/.exec(parsed.text);
    if (!m || /^\s*p?-?\d/.test(m[2]!)) return null;
    return { title: m[1]!.trim(), heading: m[2]!.trim() };
  }, [parsed]);
  const searchText = headingQuery?.title ?? parsed.text;
  const searchTypes = headingQuery ? 'note' : parsed.kind?.types;
  const refs = useQuery({
    queryKey: ['reference-suggest', searchTypes ?? '', searchText],
    queryFn: ({ signal }) => endpoints.references.suggest(searchText, searchTypes, 10, signal),
    enabled: slash,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
  const tags = useQuery({
    queryKey: qk.tags(query),
    queryFn: ({ signal }) => endpoints.tags(query || undefined, 8, signal),
    enabled: trigger?.char === '#',
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const headingNotes = (headingQuery ? (refs.data ?? []).filter((r) => r.type === 'note' && r.id !== noteId) : []).slice(0, 3);
  const noteContents = useQueries({
    queries: headingNotes.map((r) => ({ queryKey: qk.note(r.id), queryFn: () => endpoints.notes.get(r.id), staleTime: 30_000 })),
  });
  const headingItems: Item[] = useMemo(() => {
    if (!headingQuery) return [];
    const wanted = normalizeSearch(headingQuery.heading);
    return headingNotes.flatMap((ref, i) =>
      headingsOf(noteContents[i]?.data?.content)
        .filter((h) => !wanted || normalizeSearch(h).includes(wanted))
        .map((heading): Item => ({ kind: 'heading', ref, heading })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the loaded contents change
  }, [headingQuery, refs.data, noteContents.map((q) => q.dataUpdatedAt).join()]);

  const items: Item[] = useMemo(() => {
    if (!trigger) return [];
    if (headingQuery) return headingItems;
    if (trigger.char === '#') {
      const list: Item[] = (tags.data ?? []).map((t) => ({ kind: 'tag', tag: t.tag, count: t.count }));
      const typed = normalizeTag(query);
      if (typed && !list.some((i) => i.kind === 'tag' && i.tag === typed)) list.push({ kind: 'tag', tag: typed, count: null });
      return list;
    }
    const out: Item[] = [];
    const typedKind = !parsed.kind && query && !query.includes(' ') ? normalizeSearch(query) : '';
    if (!parsed.kind && (!query || typedKind)) {
      for (const def of REF_KINDS) if (!typedKind || def.prefix.startsWith(typedKind)) out.push({ kind: 'type', def });
    }
    const pageMode = parsed.kind?.prefix === 'pagina';
    for (const ref of refs.data ?? []) {
      if (ref.type === 'note' && ref.id === noteId) continue;
      out.push(pageMode && ref.type === 'reading' && !parsed.page ? { kind: 'pick-page', ref } : { kind: 'ref', ref });
    }
    const text = parsed.text;
    if (text.length >= 2) {
      const exact = (refs.data ?? []).some((r) => normalizeSearch(r.title) === normalizeSearch(text));
      // Keeping the text comes before creating, so Enter with no match never creates anything.
      out.push({ kind: 'keep' });
      // Creating is always explicit and never offered when an item with this exact title exists.
      if (!exact && (!parsed.kind || parsed.kind.types === 'topic')) out.push({ kind: 'create-topic', title: text });
      if (!exact && (!parsed.kind || parsed.kind.types === 'note')) out.push({ kind: 'create-note', title: text });
    }
    return out;
  }, [trigger, tags.data, refs.data, parsed, query, noteId, headingQuery, headingItems]);

  const close = () => trigger && dismissTrigger(editor.view, trigger.from);

  const select = async (item: Item | undefined) => {
    if (!item || !trigger || busy) return;
    const range = { from: trigger.from, to: trigger.to };
    switch (item.kind) {
      case 'ref':
        insertReference(editor, range, item.ref, parsed.page);
        return;
      case 'heading':
        insertReference(editor, range, item.ref, null, item.heading);
        return;
      case 'type':
        editor.chain().focus().insertContentAt(range, `/${item.def.prefix}.`).run();
        return;
      case 'pick-page':
        // Keeps the prompt open on this book, waiting for the page number.
        editor.chain().focus().insertContentAt(range, `/pagina.${item.ref.title}, p. `).run();
        return;
      case 'tag':
        editor.chain().focus().insertContentAt(range, `#${item.tag} `).run();
        return;
      case 'keep':
        close();
        return;
      case 'create-topic':
      case 'create-note': {
        setBusy(true);
        try {
          const created =
            item.kind === 'create-topic'
              ? await endpoints.topics.create({ id: uuidv7(), title: item.title, parentId: topicId ?? null })
              : await endpoints.notes.create({ id: uuidv7(), title: item.title, topicId: topicId ?? null });
          void qc.invalidateQueries({ queryKey: qk.topics });
          void qc.invalidateQueries({ queryKey: qk.notesAll });
          insertReference(
            editor,
            range,
            { type: item.kind === 'create-topic' ? 'topic' : 'note', id: created.id, title: item.title, role: 'note', readingTitle: null, page: null },
            null,
          );
          toast.success(item.kind === 'create-topic' ? 'Assunto criado e referenciado' : 'Nota criada e referenciada');
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }
    }
  };

  // Results still catching up with the typed text: Enter must not pick a stale item.
  const pending = !!trigger && (query !== trigger.query || (slash ? refs.isPlaceholderData : tags.isPlaceholderData));

  // Keyboard while the prompt is open (the editor keeps focus).
  const latest = useRef({ items, active, select, close, pending });
  latest.current = { items, active, select, close, pending };
  useEffect(() => {
    const storage = (editor.storage as unknown as { triggers: TriggerStorage }).triggers;
    storage.onKeyDown = (e) => {
      const { items: list, active: i } = latest.current;
      if (e.key === 'Escape') {
        latest.current.close();
        return true;
      }
      if (list.length === 0) return false;
      if (e.key === 'ArrowDown') setActive((i + 1) % list.length);
      else if (e.key === 'ArrowUp') setActive((i - 1 + list.length) % list.length);
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (latest.current.pending) queuedEnter.current = true;
        else void latest.current.select(list[i]);
      } else return false;
      return true;
    };
  }, [editor]);

  useEffect(() => {
    if (pending || !queuedEnter.current) return;
    queuedEnter.current = false;
    void select(items[active]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the results settle
  }, [pending]);

  useEffect(() => {
    menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Follow the caret; open above it when there is no room below.
  useLayoutEffect(() => {
    if (!trigger) {
      setPos(null);
      return;
    }
    const place = () => {
      try {
        const c = editor.view.coordsAtPos(trigger.from);
        const width = Math.min(360, window.innerWidth - 16);
        const left = Math.max(8, Math.min(c.left, window.innerWidth - width - 8));
        setPos(window.innerHeight - c.bottom < 260 ? { left, bottom: window.innerHeight - c.top + 6 } : { left, top: c.bottom + 6 });
      } catch {
        setPos(null);
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [trigger, editor]);

  if (!trigger || !pos) return null;
  const loading = slash ? refs.isFetching && !refs.data : tags.isFetching && !tags.data;

  const row = (item: Item, i: number) => {
    let icon: ReactNode;
    let title: ReactNode;
    let detail: ReactNode = null;
    switch (item.kind) {
      case 'ref': {
        const r = item.ref;
        icon = <EntityIcon type={r.type === 'note' && r.role !== 'note' ? 'reading' : r.type} />;
        title = refSyntax(r, r.type === 'reading' ? parsed.page : null);
        const path = topicPath(tree, r.type === 'topic' ? tree.byId.get(r.id)?.parentId : r.topicId).map((t) => t.title);
        detail =
          r.type === 'note' && r.role === 'annotation'
            ? 'Anotação de leitura'
            : r.type === 'reading' && parsed.page
              ? 'Página do livro (não precisa de anotação)'
              : path.length
                ? path.join(' › ')
                : null;
        break;
      }
      case 'heading':
        icon = <Heading className="size-4 text-note" />;
        title = `${refSyntax(item.ref)}#${item.heading}`;
        detail = 'Título dentro da nota';
        break;
      case 'pick-page':
        icon = <EntityIcon type="reading" />;
        title = `/pagina.${item.ref.title}`;
        detail = 'Escolher a página — anotada ou não';
        break;
      case 'type':
        icon = <span className="font-mono text-xs text-muted">/</span>;
        title = (
          <>
            <span className="font-mono">{item.def.prefix}.</span> <span className="text-muted">{item.def.label}</span>
          </>
        );
        detail = item.def.hint;
        break;
      case 'create-topic':
        icon = <FolderPlus className="size-4 text-topic" />;
        title = `Criar assunto “${item.title}”`;
        detail = topicId ? `Dentro de ${tree.byId.get(topicId)?.title ?? 'este assunto'}` : 'Na raiz';
        break;
      case 'create-note':
        icon = <StickyNote className="size-4 text-note" />;
        title = `Criar nota “${item.title}”`;
        break;
      case 'keep':
        icon = <TextCursorInput className="size-4 text-muted" />;
        title = 'Manter como texto, sem vínculo';
        detail = 'Esc';
        break;
      case 'tag':
        icon = <Hash className="size-4 text-accent" />;
        title = `#${item.tag}`;
        detail = item.count === null ? 'Nova tag' : `${item.count} ${item.count === 1 ? 'nota' : 'notas'}`;
        break;
    }
    return (
      <li
        key={item.kind === 'heading' ? `h:${item.ref.id}:${item.heading}:${i}` : item.kind === 'ref' || item.kind === 'pick-page' ? `${item.kind}:${item.ref.type}:${item.ref.id}` : item.kind === 'type' ? item.def.prefix : item.kind === 'tag' ? `t:${item.tag}` : item.kind}
        id={`refmenu-${i}`}
        data-index={i}
        role="option"
        aria-selected={i === active}
        onMouseDown={(e) => {
          e.preventDefault(); // keep the editor focused
          void select(item);
        }}
        onMouseMove={() => setActive(i)}
        className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm', i === active && 'bg-surface-2')}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {detail && <span className="block truncate text-xs text-subtle">{detail}</span>}
        </span>
      </li>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 w-[min(360px,calc(100vw-16px))] animate-fade-in rounded-xl border border-border bg-surface p-1 shadow-pop"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
    >
      <ul role="listbox" aria-label={slash ? 'Referenciar item' : 'Tags'} aria-busy={pending} className="scrollbar-thin max-h-72 overflow-y-auto">
        {items.map(row)}
        {items.length === 0 && (
          <li className="px-2.5 py-3 text-center text-sm text-muted">
            {loading ? (
              <Spinner className="mx-auto size-4" />
            ) : headingQuery ? (
              noteContents.some((q) => q.isLoading) ? <Spinner className="mx-auto size-4" /> : 'Nenhum título com esse nome nas notas encontradas'
            ) : slash ? (
              'Digite para buscar assuntos, notas, livros… (Título#seção cita um título)'
            ) : (
              'Digite o nome da tag'
            )}
          </li>
        )}
      </ul>
      <p className="flex items-center justify-between gap-2 border-t border-border px-2.5 pt-1.5 pb-0.5 text-[11px] text-subtle">
        <span>↑↓ escolher · Enter inserir · Esc fechar</span>
        {(refs.isFetching || tags.isFetching || busy) && <Spinner className="size-3" />}
      </p>
      <span className="sr-only" aria-live="polite">
        {items.length} sugestões
      </span>
    </div>,
    document.body,
  );
}
