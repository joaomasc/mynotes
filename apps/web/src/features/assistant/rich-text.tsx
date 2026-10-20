import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { parseInternalHref, type AiSource, type RichTextNode } from '@mynotes/shared';
import { EntityIcon, entityPath } from '@/lib/entities';
import { referencePath } from '@/lib/references';

/**
 * Renders an editor document (as produced by `markdownToDoc`) with plain
 * React elements: no HTML strings, no scripts, no editor instance. Internal
 * references open the item inside the app; external links open in a new tab.
 */
export function RichText({ doc, sources }: { doc: RichTextNode; sources: AiSource[] }) {
  return <div className="ai-rich space-y-2 text-sm leading-relaxed break-words">{renderChildren(doc, sources)}</div>;
}

function renderChildren(node: RichTextNode, sources: AiSource[]): ReactNode[] {
  return (node.content ?? []).map((child, i) => renderNode(child, sources, i));
}

/** Where a source opens: annotations and reviews inside their book, a cited page at that page. */
export function sourcePath(s: Pick<AiSource, 'type' | 'id' | 'role' | 'readingId' | 'page'>): string {
  if (s.type === 'note' || s.type === 'reading') {
    return referencePath({ type: s.type, id: s.id, role: s.role, readingId: s.readingId, page: s.page }, s.type === 'reading' ? s.page : null);
  }
  return entityPath(s.type, s.id);
}

function pathOf(href: string, sources: AiSource[]): { path: string; type: string } | null {
  const link = parseInternalHref(href);
  if (!link) return null;
  const known = sources.find((s) => s.type === link.type && s.id === link.id);
  return {
    path: sourcePath({ type: link.type, id: link.id, role: known?.role ?? null, readingId: known?.readingId ?? null, page: link.page ?? known?.page ?? null }),
    type: link.type,
  };
}

function renderText(node: RichTextNode, key: number): ReactNode {
  let out: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong className="font-semibold">{out}</strong>;
    else if (mark.type === 'italic') out = <em>{out}</em>;
    else if (mark.type === 'strike') out = <s>{out}</s>;
    else if (mark.type === 'code') out = <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">{out}</code>;
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && /^(https?:\/\/|mailto:)/i.test(mark.attrs.href)) {
      out = (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
          {out}
        </a>
      );
    }
  }
  return <span key={key}>{out}</span>;
}

function renderNode(node: RichTextNode, sources: AiSource[], key: number): ReactNode {
  const children = () => renderChildren(node, sources);
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children()}</p>;
    case 'heading': {
      const level = Number(node.attrs?.level ?? 3);
      const cls = level <= 1 ? 'text-base font-semibold' : 'text-[15px] font-semibold';
      return (
        <p key={key} role="heading" aria-level={Math.min(6, level + 2)} className={`${cls} pt-1`}>
          {children()}
        </p>
      );
    }
    case 'bulletList':
      return (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {children()}
        </ul>
      );
    case 'orderedList':
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {children()}
        </ol>
      );
    case 'taskList':
      return (
        <ul key={key} className="space-y-1 pl-1">
          {children()}
        </ul>
      );
    case 'listItem':
      return (
        <li key={key} className="[&>p]:inline">
          {children()}
        </li>
      );
    case 'taskItem':
      return (
        <li key={key} className="flex gap-2">
          <input type="checkbox" checked={!!node.attrs?.checked} readOnly disabled className="mt-1" aria-label={node.attrs?.checked ? 'Concluído' : 'Pendente'} />
          <div>{children()}</div>
        </li>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="space-y-1 border-l-2 border-border-strong pl-3 text-muted">
          {children()}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre key={key} className="scrollbar-thin overflow-x-auto rounded-lg bg-surface-3 p-2 font-mono text-xs">
          <code>{(node.content ?? []).map((c) => c.text ?? '').join('')}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} className="border-border" />;
    case 'hardBreak':
      return <br key={key} />;
    case 'reference': {
      const href = String(node.attrs?.href ?? '');
      const target = pathOf(href, sources);
      const label = String(node.attrs?.label ?? '') || 'item';
      if (!target) return <span key={key}>{label}</span>;
      return (
        <Link
          key={key}
          to={target.path}
          data-ai-ref={href}
          className="inline-flex max-w-full items-baseline gap-1 rounded-md bg-accent-soft/60 px-1 font-medium text-accent hover:underline"
        >
          <EntityIcon type={target.type} className="size-3.5 shrink-0 self-center" />
          <span className="truncate">{label}</span>
        </Link>
      );
    }
    case 'text':
      return renderText(node, key);
    default:
      return <span key={key}>{children()}</span>;
  }
}
