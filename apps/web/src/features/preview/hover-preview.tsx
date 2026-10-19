import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Columns2, ExternalLink, SquarePlus } from 'lucide-react';
import { ANNOTATION_TYPE_LABELS, MATERIAL_TYPE_LABELS, READING_STATUS_LABELS } from '@mynotes/shared';
import { Spinner } from '@/components/ui/feedback';
import { basename, stripBase } from '@/app/routes';
import { endpoints } from '@/lib/api/endpoints';
import { EntityIcon, entityLabel } from '@/lib/entities';
import { fileSize, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { topicPath, useTopics } from '../topics/use-topics';
import { pathTarget } from '../workspace/tab-info';
import { openPath, workspace } from '../workspace/store';

/**
 * Page preview (like Obsidian's): hovering a link to a note, topic, book,
 * document or concept shows its content in a popover. In the note editor,
 * where hovering is constant while writing, hold Ctrl/⌘.
 */

interface Preview {
  path: string;
  rect: { left: number; top: number; bottom: number; right: number };
}

let current: Preview | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

// The editor is heavy: loaded with the first note preview.
const ReadOnlyDoc = lazy(() => import('../notes/read-only-doc').then((m) => ({ default: m.ReadOnlyDoc })));

const PREVIEWABLE = new Set(['note', 'topic', 'reading', 'document', 'concept']);

export function previewablePath(path: string | null | undefined): boolean {
  const entity = path ? pathTarget(path).entity : null;
  return !!entity && PREVIEWABLE.has(entity.type);
}

/** For non-DOM targets (graph nodes on a canvas). */
export const hoverPreview = {
  show(path: string, rect: Preview['rect'], delay = 400) {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (!previewablePath(path)) return;
    if (current?.path === path) return;
    showTimer = setTimeout(() => {
      current = { path, rect };
      emit();
    }, delay);
  },
  hide(delay = 220) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      current = null;
      emit();
    }, delay);
  },
  keep() {
    clearTimeout(hideTimer);
  },
};

function appPath(el: Element): string | null {
  const explicit = el.getAttribute('data-preview-href');
  if (explicit) return explicit;
  const href = el.getAttribute('href');
  if (!href) return null;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || (basename !== '/' && !url.pathname.startsWith(basename))) return null;
    return `${stripBase(url.pathname)}${url.search}`;
  } catch {
    return null;
  }
}

function useDomPreviews() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    let candidate: { el: Element; path: string } | null = null;
    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
    };
    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-hover-preview]')) return hoverPreview.keep();
      const el = target?.closest?.('a[href], [data-preview-href]');
      if (!el) return;
      const path = appPath(el);
      if (!previewablePath(path)) return;
      candidate = { el, path: path! };
      // While writing (and in the sidebar, crossed all the time), previews need Ctrl/⌘ like in Obsidian.
      const editing = !!el.closest('.ProseMirror[contenteditable="true"], aside[aria-label="Barra lateral"]');
      if (editing && !(e.ctrlKey || e.metaKey)) return;
      hoverPreview.show(path!, rectOf(el), editing ? 150 : 450);
    };
    const onOut = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('a[href], [data-preview-href], [data-hover-preview]');
      if (!el || el.contains(e.relatedTarget as Node | null)) return;
      if (candidate?.el === el) candidate = null;
      hoverPreview.hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        current = null;
        emit();
        return;
      }
      if ((e.key === 'Control' || e.key === 'Meta') && candidate && candidate.el.isConnected && candidate.el.matches(':hover')) {
        hoverPreview.show(candidate.path, rectOf(candidate.el), 0);
      }
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-hover-preview]')) return;
      clearTimeout(showTimer);
      if (current) {
        current = null;
        emit();
      }
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
}

const WIDTH = 400;

export function HoverPreviewLayer() {
  useDomPreviews();
  const preview = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!preview) return setPos(null);
    const height = Math.min(360, box.current?.offsetHeight ?? 360);
    const { rect } = preview;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
    const below = window.innerHeight - rect.bottom > height + 16 || rect.top < height + 16;
    setPos({ left, top: below ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const close = () => {
      current = null;
      emit();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [preview]);

  if (!preview) return null;
  const close = () => {
    current = null;
    emit();
  };
  return createPortal(
    <div
      ref={box}
      data-hover-preview
      role="dialog"
      aria-label="Pré-visualização"
      onPointerEnter={() => hoverPreview.keep()}
      onPointerLeave={() => hoverPreview.hide()}
      className="fixed z-[60] flex max-h-[360px] animate-fade-in flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-pop"
      style={{ width: Math.min(WIDTH, window.innerWidth - 16), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <PreviewBody path={preview.path} />
      <div className="flex items-center gap-3 border-t border-border bg-surface-2/60 px-3 py-1.5 text-xs">
        <Link to={preview.path} onClick={close} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Abrir <ExternalLink className="size-3" aria-hidden />
        </Link>
        {workspace.enabled && (
          <>
            <button type="button" onClick={() => (close(), openPath(preview.path, 'tab'))} className="inline-flex items-center gap-1 text-muted hover:text-accent">
              <SquarePlus className="size-3" aria-hidden /> Nova aba
            </button>
            <button type="button" onClick={() => (close(), openPath(preview.path, 'split'))} className="inline-flex items-center gap-1 text-muted hover:text-accent">
              <Columns2 className="size-3" aria-hidden /> Ao lado
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Header({ type, title, detail }: { type: string; title: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-4 py-2.5">
      <EntityIcon type={type} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-semibold">{title || 'Sem título'}</p>
        {detail && <p className="truncate text-xs text-muted">{detail}</p>}
      </div>
    </div>
  );
}

function PreviewBody({ path }: { path: string }) {
  const target = pathTarget(path).entity;
  const page = new URLSearchParams(path.split('?')[1] ?? '').get('page');
  if (!target) return null;
  switch (target.type) {
    case 'note':
      return <NotePreview id={target.id} />;
    case 'topic':
      return <TopicPreview id={target.id} />;
    case 'reading':
      return <ReadingPreview id={target.id} page={page} />;
    case 'document':
      return <DocumentPreview id={target.id} />;
    default:
      return <ConceptPreview id={target.id} />;
  }
}

const Loading = () => (
  <div className="flex h-24 items-center justify-center">
    <Spinner />
  </div>
);
const Failed = () => <p className="p-4 text-sm text-muted">Não foi possível carregar a pré-visualização.</p>;

function NotePreview({ id }: { id: string }) {
  const { tree } = useTopics();
  const q = useQuery({ queryKey: qk.note(id), queryFn: ({ signal }) => endpoints.notes.get(id, signal) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed />;
  const n = q.data;
  const where =
    n.role === 'annotation'
      ? `Anotação${n.page ? `, p. ${n.page}` : ''}${n.annotationType ? ` · ${ANNOTATION_TYPE_LABELS[n.annotationType]}` : ''}`
      : n.role === 'review'
        ? 'Resenha'
        : topicPath(tree, n.topicId).map((t) => t.title).join(' › ') || 'Sem assunto';
  return (
    <>
      <Header type={n.role === 'note' ? 'note' : 'reading'} title={n.title} detail={`${where} · editada ${relativeTime(n.updatedAt)}`} />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {n.quote && <blockquote className="mb-2 border-l-2 border-reading pl-3 text-sm text-muted italic">{n.quote}</blockquote>}
        {n.content.content.length ? (
          <Suspense fallback={<p className="text-sm text-muted">{n.excerpt}</p>}>
            <ReadOnlyDoc key={n.version} content={n.content} className="prose-note prose-preview" />
          </Suspense>
        ) : (
          <p className="text-sm text-subtle">Nota vazia.</p>
        )}
      </div>
    </>
  );
}

function TopicPreview({ id }: { id: string }) {
  const { tree, isLoading } = useTopics();
  const t = tree.byId.get(id);
  if (isLoading) return <Loading />;
  if (!t) return <Failed />;
  const parents = topicPath(tree, t.parentId).map((p) => p.title).join(' › ');
  return (
    <>
      <Header type="topic" title={t.title} detail={parents || 'Assunto principal'} />
      <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {t.description && <p className="text-muted">{t.description}</p>}
        <p className="text-xs text-subtle">
          {t.noteCount} notas · {t.readingCount} leituras · {t.documentCount} documentos
        </p>
        {t.children.length > 0 && (
          <ul className="space-y-1">
            {t.children.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <EntityIcon type="topic" className="size-3.5 shrink-0" />
                <span className="truncate">{c.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ReadingPreview({ id, page }: { id: string; page: string | null }) {
  const q = useQuery({ queryKey: qk.reading(id), queryFn: () => endpoints.readings.get(id) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed />;
  const r = q.data;
  const progress = r.progressPercent ?? (r.totalPages && r.currentPage ? Math.round((r.currentPage / r.totalPages) * 100) : null);
  return (
    <>
      <Header type="reading" title={`${r.title}${page ? `, p. ${page}` : ''}`} detail={[r.author, MATERIAL_TYPE_LABELS[r.materialType]].filter(Boolean).join(' · ')} />
      <div className="space-y-2 px-4 py-3 text-sm">
        <p>
          {READING_STATUS_LABELS[r.status]}
          {r.currentPage ? ` · página ${r.currentPage}${r.totalPages ? ` de ${r.totalPages}` : ''}` : ''}
        </p>
        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-label={`${progress}% lido`}>
            <div className="h-full bg-reading" style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        )}
        {r.notes && <p className="line-clamp-4 text-muted">{r.notes}</p>}
      </div>
    </>
  );
}

function DocumentPreview({ id }: { id: string }) {
  const q = useQuery({ queryKey: qk.document(id), queryFn: () => endpoints.documents.get(id) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed />;
  const d = q.data;
  return (
    <>
      <Header type="document" title={d.title} detail={`${d.originalName} · ${fileSize(d.sizeBytes)}`} />
      {d.description && <p className="line-clamp-6 px-4 py-3 text-sm text-muted">{d.description}</p>}
    </>
  );
}

function ConceptPreview({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['concept', id], queryFn: () => endpoints.concepts.get(id) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed />;
  return (
    <>
      <Header type="concept" title={q.data.name} detail={entityLabel('concept')} />
      {q.data.description && <p className="line-clamp-8 px-4 py-3 text-sm text-muted">{q.data.description}</p>}
    </>
  );
}
