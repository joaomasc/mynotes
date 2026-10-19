import { INTERNAL_LINK_PREFIX, INTERNAL_LINK_TYPES, NOTE_TAGS_MAX, TAG_MAX_LENGTH, type InternalLinkType } from './constants';
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

/**
 * Coerces editor/ProseMirror JSON into a RichTextDoc. ProseMirror drops the
 * `content` key of empty nodes, so an empty document comes out as
 * `{ type: 'doc' }`.
 */
export function asRichTextDoc(json: { type?: string; content?: RichTextNode[] } | null | undefined): RichTextDoc {
  return { ...json, type: 'doc', content: Array.isArray(json?.content) ? json.content : [] };
}

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
  'properties',
]);

export interface InternalLink {
  type: InternalLinkType;
  id: string;
  /** Page of a book/reading (`mynotes:reading/<id>/p/<page>`). */
  page?: number | undefined;
}

/**
 * Internal links identify the target by its stable id, never by its title:
 * `mynotes:<type>/<id>`, or `mynotes:reading/<id>/p/<page>` for a page.
 */
export function parseInternalHref(href: unknown): InternalLink | null {
  if (typeof href !== 'string' || !href.startsWith(INTERNAL_LINK_PREFIX)) return null;
  const [type, id, anchor, value] = href.slice(INTERNAL_LINK_PREFIX.length).split('/');
  if (!type || !id) return null;
  if (!(INTERNAL_LINK_TYPES as readonly string[]).includes(type) || !isUuid(id)) return null;
  if (type === 'reading' && anchor === 'p' && value && /^[1-9]\d{0,5}$/.test(value)) {
    return { type, id, page: Number(value) };
  }
  return { type: type as InternalLinkType, id };
}

export function internalHref(type: InternalLinkType, id: string, page?: number | null): string {
  return `${INTERNAL_LINK_PREFIX}${type}/${id}${type === 'reading' && page ? `/p/${page}` : ''}`;
}

/**
 * Tags are written inline as `#name`. They start with a letter and follow the
 * start of the text, a space or punctuation, so `C#`, `#1`, `a/#b` and URL
 * fragments are not tags. `#historia/brasil` is a nested tag: searching
 * `#historia` also finds it.
 */
export const TAG_PATTERN = /(^|[\s([{"'“‘,;:!?.])#(\p{L}[\p{L}\p{N}_-]*(?:\/\p{L}[\p{L}\p{N}_-]*)*)/gu;

/** Canonical form of a tag: lowercase and without accents ("#Crítica" → "critica"). */
export function normalizeTag(name: string): string {
  return normalizeSearch(name.replace(/^#/, '')).replace(/\s+/g, '-').slice(0, TAG_MAX_LENGTH);
}

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) {
    const tag = normalizeTag(match[2]!);
    if (tag) tags.add(tag);
    if (tags.size >= NOTE_TAGS_MAX) break;
  }
  return [...tags];
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
  /** Normalized #tags (text in code is ignored). */
  tags: string[];
}

/** Inline node types that point to another item through `attrs.href`. */
const REFERENCE_NODES = new Set(['internalLink', 'mention', 'reference']);

/**
 * Walks a rich-text document once and extracts plain text, word count and
 * internal links. Also strips link marks with disallowed protocols (e.g.
 * `javascript:`), mutating the given document in place.
 */
export function analyzeDoc(doc: RichTextNode): DocAnalysis {
  const parts: string[] = [];
  const tagText: string[] = [];
  const links = new Map<string, InternalLink>();

  const visit = (node: RichTextNode, depth: number, inCode: boolean): void => {
    if (depth > 200) return;
    if (typeof node.text === 'string') {
      parts.push(node.text);
      tagText.push(inCode || node.marks?.some((m) => m.type === 'code') ? ' ' : node.text);
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      tagText.push('\n');
    }
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
    if (REFERENCE_NODES.has(node.type)) {
      const internal = parseInternalHref(node.attrs?.href);
      if (internal) links.set(`${internal.type}:${internal.id}`, internal);
      // Only internal targets are allowed; anything else renders as a broken reference.
      else if (node.attrs && 'href' in node.attrs) node.attrs.href = null;
      if (typeof node.attrs?.label === 'string') parts.push(node.attrs.label);
      tagText.push(' ');
    }
    // Note properties are searchable as "key: value" lines.
    if (node.type === 'properties' && Array.isArray(node.attrs?.items)) {
      for (const item of node.attrs.items as unknown[]) {
        const p = item as { key?: unknown; value?: unknown } | null;
        if (p && typeof p.key === 'string' && typeof p.value === 'string') parts.push(`${p.key}: ${p.value}\n`);
      }
      tagText.push('\n');
    }
    for (const child of node.content ?? []) visit(child, depth + 1, inCode || node.type === 'codeBlock');
    if (BLOCK_TYPES.has(node.type)) {
      parts.push('\n');
      tagText.push('\n');
    }
  };
  visit(doc, 0, false);

  const text = parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const wordCount = text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length;
  return { text, wordCount, links: [...links.values()], tags: extractTags(tagText.join('')) };
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
