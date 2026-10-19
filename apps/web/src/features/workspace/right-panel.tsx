import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ChevronRight, Hash, Link2, ListTree, MessageSquareQuote, Waypoints, X, type LucideProps } from 'lucide-react';
import { analyzeDoc, type InternalLinkType, type Note } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { LocalGraph } from '../graph/local-graph';
import { findUnlinkedMentions, linkMention } from '../notes/mentions';
import { BacklinkList } from '../notes/backlink-list';
import { useTopics } from '../topics/use-topics';
import { workspace } from './store';
import { pathTarget, usePathTitle } from './tab-info';
import { useWorkspace } from './workspace';

export const RIGHT_TABS: { id: string; label: string; icon: ComponentType<LucideProps> }[] = [
  { id: 'backlinks', label: 'Menções', icon: MessageSquareQuote },
  { id: 'outline', label: 'Sumário', icon: ListTree },
  { id: 'graph', label: 'Grafo local', icon: Waypoints },
  { id: 'tags', label: 'Tags', icon: Hash },
];

/** Linked panels on the right (like Obsidian's right sidebar): they follow the active tab. */
export function RightPanel({ tab, onTab, onClose }: { tab: string; onTab: (t: string) => void; onClose: () => void }) {
  useWorkspace();
  const active = workspace.activeTab();
  const { title } = usePathTitle(active.path, active.title);
  const target = pathTarget(active.path).entity;
  return (
    <aside className="flex h-dvh w-80 shrink-0 flex-col border-l border-border bg-surface-2/40" aria-label="Painel direito">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-1">
        <div role="tablist" aria-label="Painéis" className="flex flex-1">
          {RIGHT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.label}
              onClick={() => onTab(t.id)}
              className={cn('flex size-8 items-center justify-center rounded-md', tab === t.id ? 'bg-surface-3 text-text' : 'text-muted hover:text-text')}
            >
              <t.icon className="size-4" aria-hidden />
              <span className="sr-only">{t.label}</span>
            </button>
          ))}
        </div>
        <IconButton label="Fechar painel (Ctrl+Shift+\)" size="sm" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <p className="truncate border-b border-border px-3 py-1.5 text-xs text-muted" title={title}>
        {RIGHT_TABS.find((t) => t.id === tab)?.label} · <span className="text-text">{title}</span>
      </p>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {tab === 'backlinks' ? (
          target && ['note', 'topic', 'reading', 'document', 'concept'].includes(target.type) ? (
            <Mentions key={`${target.type}:${target.id}`} type={target.type as InternalLinkType} id={target.id} title={title} />
          ) : (
            <Hint text="Abra uma nota, assunto, livro, documento ou conceito para ver quem o cita." />
          )
        ) : tab === 'outline' ? (
          <Outline tabId={active.id} />
        ) : tab === 'graph' ? (
          target && ['note', 'topic', 'reading', 'document', 'concept'].includes(target.type) ? (
            <div className="h-full">
              <LocalGraph focusKey={`${target.type}:${target.id}`} />
            </div>
          ) : (
            <Hint text="Abra um item para ver o seu grafo local." />
          )
        ) : (
          <TagsPanel noteId={target?.type === 'note' ? target.id : null} />
        )}
      </div>
    </aside>
  );
}

const Hint = ({ text }: { text: string }) => <p className="px-4 py-6 text-center text-xs text-muted">{text}</p>;

/* ----------------------------------------------------------- mentions -- */

function Mentions({ type, id, title }: { type: InternalLinkType; id: string; title: string }) {
  const qc = useQueryClient();
  const back = useQuery({ queryKey: qk.backlinks(type, id), queryFn: () => endpoints.notes.backlinks(type, id) });
  const [searching, setSearching] = useState(false);
  const linked = useMemo(() => new Set((back.data ?? []).map((b) => b.noteId)), [back.data]);
  const unlinked = useQuery({
    queryKey: ['unlinked-mentions', type, id, title],
    queryFn: () => findUnlinkedMentions(qc, title, { type, id }, linked),
    enabled: searching && back.isSuccess && title !== '…',
    staleTime: 30_000,
  });
  const link = useMutation({
    mutationFn: (noteId: string) => linkMention(qc, noteId, title, { type, id, label: title }),
    onSuccess: () => {
      toast.success('Menção vinculada');
      void unlinked.refetch();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-5 p-3">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <Link2 className="size-3.5" aria-hidden /> Menções vinculadas {back.data && <span className="font-normal text-subtle">({back.data.length})</span>}
        </h3>
        {back.isLoading ? <Spinner className="size-4" /> : <BacklinkList items={back.data} empty="Nenhuma nota cita este item com “/”." />}
      </section>
      <section>
        <button type="button" onClick={() => setSearching(!searching)} className="mb-2 flex w-full items-center gap-1.5 text-left text-[13px] font-semibold text-muted hover:text-text" aria-expanded={searching}>
          <ChevronRight className={cn('size-3.5 transition-transform', searching && 'rotate-90')} aria-hidden />
          Menções não vinculadas {unlinked.data && <span className="font-normal text-subtle">({unlinked.data.length})</span>}
        </button>
        {searching &&
          (unlinked.isLoading ? (
            <Spinner className="size-4" />
          ) : unlinked.isError ? (
            <p className="text-xs text-muted">A busca precisa de conexão com o servidor.</p>
          ) : !unlinked.data?.length ? (
            <p className="text-xs text-muted">Nenhuma nota escreve “{title}” sem citá-lo.</p>
          ) : (
            <ul className="space-y-2">
              {unlinked.data.map(({ note, excerpt }) => (
                <li key={note.id} className="rounded-lg border border-border bg-surface p-2">
                  <Link to={notePath(note)} className="block truncate text-sm font-medium hover:text-accent">
                    {note.title || 'Sem título'}
                  </Link>
                  <p className="mt-0.5 line-clamp-3 text-xs text-muted">{excerpt}</p>
                  <Button size="sm" variant="ghost" className="mt-1 -ml-1 h-7" icon={<Link2 className="size-3.5" />} loading={link.isPending && link.variables === note.id} onClick={() => link.mutate(note.id)}>
                    Vincular
                  </Button>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

const notePath = (n: Note) => referencePath({ type: 'note', id: n.id, role: n.role, readingId: n.readingId, page: n.page });

/* ------------------------------------------------------------ outline -- */

interface Heading {
  level: number;
  text: string;
  el: HTMLElement;
}

/** Headings of the notes shown in the tab, read from the page itself (always current, even while typing). */
function Outline({ tabId }: { tabId: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    let pane: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      pane = document.querySelector(`[data-tab-id="${tabId}"]`);
      const list = [...(pane?.querySelectorAll<HTMLElement>('.ProseMirror :is(h1, h2, h3)') ?? [])].map((el) => ({
        level: Number(el.tagName[1]),
        text: el.textContent?.trim() || 'Sem título',
        el,
      }));
      setHeadings(list);
    };
    const onScroll = () => {
      if (!pane) return;
      const top = pane.getBoundingClientRect().top + 80;
      let idx = -1;
      document.querySelectorAll(`[data-tab-id="${tabId}"] .ProseMirror :is(h1, h2, h3)`).forEach((el, i) => {
        if (el.getBoundingClientRect().top <= top) idx = i;
      });
      setCurrent(idx);
    };
    read();
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        read();
        onScroll();
      }, 250);
    });
    // The tab's page may not be rendered yet: watch the whole workspace.
    const root = document.querySelector('[aria-label="Área de trabalho"]') ?? document.body;
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener('scroll', onScroll, true);
    onScroll();
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', onScroll, true);
      clearTimeout(timer);
    };
  }, [tabId]);

  if (headings.length === 0) return <Hint text="Os títulos da nota aberta aparecem aqui (use Título 1, 2 e 3 na barra do editor)." />;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <nav aria-label="Sumário" className="p-2">
      <ul className="space-y-px">
        {headings.map((h, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => h.el.scrollIntoView({ block: 'start', behavior: 'smooth' })}
              className={cn('block w-full truncate rounded-md py-1 pr-2 text-left text-sm hover:bg-surface-2', i === current ? 'font-medium text-accent' : 'text-muted hover:text-text')}
              style={{ paddingLeft: `${0.5 + (h.level - min) * 0.9}rem` }}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* --------------------------------------------------------------- tags -- */

interface TagNode {
  name: string;
  full: string;
  count: number;
  children: TagNode[];
}

/** Nested tags (#historia/brasil) as a tree; the count of a parent includes its children. */
function buildTagTree(tags: { tag: string; count: number }[]): TagNode[] {
  const roots: TagNode[] = [];
  const index = new Map<string, TagNode>();
  for (const { tag, count } of [...tags].sort((a, b) => a.tag.localeCompare(b.tag))) {
    const parts = tag.split('/');
    let siblings = roots;
    let path = '';
    parts.forEach((name, i) => {
      path = path ? `${path}/${name}` : name;
      let node = index.get(path);
      if (!node) {
        node = { name, full: path, count: 0, children: [] };
        index.set(path, node);
        siblings.push(node);
      }
      node.count += i === parts.length - 1 ? count : 0;
      siblings = node.children;
    });
  }
  const total = (n: TagNode): number => {
    n.count += n.children.reduce((sum, c) => sum + total(c), 0);
    return n.count;
  };
  roots.forEach(total);
  return roots;
}

function TagTreeItem({ node, depth }: { node: TagNode; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 0.85}rem` }}>
        {node.children.length > 0 ? (
          <button type="button" onClick={() => setOpen(!open)} aria-label={open ? 'Recolher' : 'Expandir'} className="rounded p-0.5 text-subtle hover:text-text">
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-[1.125rem]" />
        )}
        <Link to={`/search?tag=${encodeURIComponent(node.full)}`} className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
          <span className="truncate text-accent">#{node.name}</span>
          <span className="ml-auto text-xs text-subtle tabular-nums">{node.count}</span>
        </Link>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TagTreeItem key={c.full} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TagsPanel({ noteId }: { noteId: string | null }) {
  const tags = useQuery({ queryKey: qk.tags(''), queryFn: () => endpoints.tags(undefined, 200) });
  const note = useQuery({ queryKey: qk.note(noteId ?? ''), queryFn: () => endpoints.notes.get(noteId!), enabled: !!noteId, staleTime: 30_000 });
  const tree = useMemo(() => buildTagTree(tags.data ?? []), [tags.data]);
  const noteTags = useMemo(() => (note.data ? analyzeDoc(structuredClone(note.data.content)).tags : []), [note.data]);
  const { isLoading } = useTopics();
  return (
    <div className="space-y-4 p-2">
      {noteId && noteTags.length > 0 && (
        <section className="px-1">
          <h3 className="mb-1.5 text-[13px] font-semibold text-muted">Nesta nota</h3>
          <div className="flex flex-wrap gap-1">
            {noteTags.map((t) => (
              <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent hover:underline">
                #{t}
              </Link>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="mb-1 px-1 text-[13px] font-semibold text-muted">Todas as tags</h3>
        {tags.isLoading || isLoading ? (
          <Spinner className="size-4" />
        ) : tree.length === 0 ? (
          <Hint text="Nenhuma tag ainda. Escreva #nome numa nota; use #pai/filho para aninhar." />
        ) : (
          <ul>
            {tree.map((n) => (
              <TagTreeItem key={n.full} node={n} depth={0} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
