import { INTERNAL_LINK_PREFIX, INTERNAL_LINK_TYPES, type InternalLinkType } from './constants';
import { isUuid } from './ids';

/** Lowercase, accent-free, whitespace-collapsed text used for searching. */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Accent-free lowercase text with exactly one output code point per input
 * code point (no whitespace collapsing). SQLite's instr()/substr() count code
 * points, so an offset found in the normalized text is valid in the original.
 * The input should already be NFC-normalized.
 */
export function normalizeAligned(input: string): string {
  let out = '';
  for (const ch of input) {
    if (/\s/u.test(ch)) {
      out += ' ';
      continue;
    }
    const base = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const first = base.length > 0 ? String.fromCodePoint(base.codePointAt(0)!) : ' ';
    out += first;
  }
  return out;
}

/** Splits a query into normalized search terms (deduplicated, bounded). */
export function searchTerms(query: string, max = 8): string[] {
  const terms = normalizeSearch(query)
    .split(' ')
    .filter((t) => t.length > 0)
    .map((t) => t.slice(0, 100));
  return [...new Set(terms)].slice(0, max);
}

/** Minimal structural type of a ProseMirror/Tiptap JSON node. */
export interface RichTextNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichTextNode[];
}

export interface RichTextDoc extends RichTextNode {
  type: 'doc';
  content: RichTextNode[];
}

export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [] };

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'taskList',
]);

export interface InternalLink {
  type: InternalLinkType;
  id: string;
}

export function parseInternalHref(href: unknown): InternalLink | null {
  if (typeof href !== 'string' || !href.startsWith(INTERNAL_LINK_PREFIX)) return null;
  const [type, id] = href.slice(INTERNAL_LINK_PREFIX.length).split('/');
  if (!type || !id) return null;
  if (!(INTERNAL_LINK_TYPES as readonly string[]).includes(type) || !isUuid(id)) return null;
  return { type: type as InternalLinkType, id };
}

export function internalHref(type: InternalLinkType, id: string): string {
  return `${INTERNAL_LINK_PREFIX}${type}/${id}`;
}

const SAFE_EXTERNAL_HREF = /^(https?:\/\/|mailto:)/i;

export function isAllowedHref(href: unknown): boolean {
  if (typeof href !== 'string' || href.length > 2048) return false;
  return SAFE_EXTERNAL_HREF.test(href) || parseInternalHref(href) !== null;
}

export interface DocAnalysis {
  text: string;
  wordCount: number;
  links: InternalLink[];
}

/**
 * Walks a rich-text document once and extracts plain text, word count and
 * internal links. Also strips link marks with disallowed protocols (e.g.
 * `javascript:`), mutating the given document in place.
 */
export function analyzeDoc(doc: RichTextNode): DocAnalysis {
  const parts: string[] = [];
  const links = new Map<string, InternalLink>();

  const visit = (node: RichTextNode, depth: number): void => {
    if (depth > 200) return;
    if (typeof node.text === 'string') parts.push(node.text);
    if (node.type === 'hardBreak') parts.push('\n');
    if (node.marks) {
      node.marks = node.marks.filter((mark) => {
        if (mark.type !== 'link') return true;
        const href = mark.attrs?.href;
        if (!isAllowedHref(href)) return false;
        const internal = parseInternalHref(href);
        if (internal) links.set(`${internal.type}:${internal.id}`, internal);
        return true;
      });
    }
    if (node.type === 'internalLink' || node.type === 'mention') {
      const internal = parseInternalHref(node.attrs?.href);
      if (internal) links.set(`${internal.type}:${internal.id}`, internal);
      if (typeof node.attrs?.label === 'string') parts.push(node.attrs.label);
    }
    for (const child of node.content ?? []) visit(child, depth + 1);
    if (BLOCK_TYPES.has(node.type)) parts.push('\n');
  };
  visit(doc, 0);

  const text = parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const wordCount = text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length;
  return { text, wordCount, links: [...links.values()] };
}

export function makeExcerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
