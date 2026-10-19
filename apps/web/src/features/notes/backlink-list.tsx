import { Link } from 'react-router';
import { Hash } from 'lucide-react';
import type { Backlink } from '@mynotes/shared';
import { referencePath } from '@/lib/references';

/** "Anotação · O Capital, p. 125" / "Resenha · O Capital": where a backlink comes from. */
export function backlinkLabel(b: Pick<Backlink, 'role' | 'title' | 'readingTitle' | 'page'>): string {
  if (b.role === 'annotation') return `Anotação · ${b.readingTitle ?? 'livro'}${b.page ? `, p. ${b.page}` : ''}${b.title ? ` — ${b.title}` : ''}`;
  if (b.role === 'review') return `Resenha · ${b.readingTitle ?? 'livro'}`;
  return b.title || 'Sem título';
}

export function BacklinkList({
  items,
  empty,
  pageLink,
}: {
  items: Backlink[] | undefined;
  empty: string;
  /** For a book's backlinks: where each cited page leads. */
  pageLink?: (page: number) => string;
}) {
  if (!items?.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((b) => (
        <li key={b.noteId}>
          <Link
            to={referencePath({ type: 'note', id: b.noteId, role: b.role, readingId: b.readingId, page: b.page })}
            className="block rounded-lg px-1.5 py-1 text-sm hover:bg-surface-2"
          >
            <span className="block truncate">{backlinkLabel(b)}</span>
            {b.excerpt && <span className="block truncate text-xs text-muted">{b.excerpt}</span>}
          </Link>
          {pageLink && !!b.citedPages?.length && (
            <span className="flex flex-wrap gap-1 px-1.5 pb-1">
              {b.citedPages.map((p) => (
                <Link key={p} to={pageLink(p)} className="rounded-md bg-reading/10 px-1.5 py-0.5 text-[11px] font-medium text-reading hover:underline">
                  p. {p}
                </Link>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Link
          key={t}
          to={`/search?tag=${encodeURIComponent(t)}`}
          className="inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent hover:underline"
        >
          <Hash className="size-3" aria-hidden />
          {t}
        </Link>
      ))}
    </div>
  );
}
