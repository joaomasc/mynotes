import { parseInternalHref, type RichTextDoc, type RichTextNode } from './text';

/**
 * Converts the Markdown written by the assistant into the editor's document
 * (Tiptap/ProseMirror JSON), so a note created by the AI is an ordinary note.
 *
 * Only a safe subset becomes structure: headings (#, ##, ###), paragraphs,
 * bullet / numbered / task lists (nested by indentation), quotes, fenced code,
 * horizontal rules, **bold**, *italic*, ~~strike~~, `code` and links. HTML is
 * kept as plain text. Links to `mynotes:<type>/<id>` become "/" references
 * (validated by the caller); other links must be http(s) or mailto, otherwise
 * only their text is kept.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

const SAFE_EXTERNAL = /^(https?:\/\/|mailto:)/i;

/* ---------------------------------------------------------------- inline -- */

function textNode(text: string, marks: Mark[]): RichTextNode {
  return marks.length > 0 ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text };
}

/** Finds the closing delimiter that is not escaped. */
function findClose(src: string, delim: string, from: number): number {
  for (let i = from; i <= src.length - delim.length; i++) {
    if (src[i] === '\\') {
      i++;
      continue;
    }
    if (src.startsWith(delim, i) && i > from) return i;
  }
  return -1;
}

export function parseInline(src: string, marks: Mark[] = []): RichTextNode[] {
  const out: RichTextNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(textNode(buf, marks));
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && /[\\`*_~[\]()#>-]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(textNode(src.slice(i + 1, end), [{ type: 'code' }]));
        i = end + 1;
        continue;
      }
    }
    const pair = src.startsWith('**', i) ? '**' : src.startsWith('__', i) ? '__' : src.startsWith('~~', i) ? '~~' : null;
    if (pair) {
      const end = findClose(src, pair, i + 2);
      if (end > 0) {
        flush();
        out.push(...parseInline(src.slice(i + 2, end), [...marks, { type: pair === '~~' ? 'strike' : 'bold' }]));
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ' ' && src[i + 1] !== ch) {
      // `_` inside a word (snake_case) is not emphasis.
      const wordBefore = ch === '_' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]!);
      const end = wordBefore ? -1 : findClose(src, ch, i + 1);
      if (end > 0 && src[end - 1] !== ' ') {
        flush();
        out.push(...parseInline(src.slice(i + 1, end), [...marks, { type: 'italic' }]));
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = findClose(src, ']', i + 1);
      if (close > 0 && src[close + 1] === '(') {
        const end = src.indexOf(')', close + 2);
        if (end > 0) {
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, end).trim();
          flush();
          const internal = parseInternalHref(href);
          if (internal) {
            out.push({ type: 'reference', attrs: { href, label: label.replace(/[*_`~]/g, '').trim(), heading: null } });
          } else if (SAFE_EXTERNAL.test(href) && href.length <= 2048) {
            out.push(...parseInline(label, [...marks, { type: 'link', attrs: { href } }]));
          } else {
            out.push(...parseInline(label, marks));
          }
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

function paragraph(text: string): RichTextNode {
  const content = parseInline(text.trim());
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/* ----------------------------------------------------------------- lists -- */

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

interface ListLine {
  indent: number;
  ordered: boolean;
  text: string;
}

function buildList(lines: ListLine[], start: number, indent: number): { node: RichTextNode; next: number } {
  const ordered = lines[start]!.ordered;
  const task = !ordered && TASK.test(lines[start]!.text);
  const items: RichTextNode[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.indent >= indent) {
    const line = lines[i]!;
    if (line.indent > indent) {
      // Nested list: belongs to the previous item.
      const nested = buildList(lines, i, line.indent);
      const prev = items[items.length - 1];
      if (prev) prev.content = [...(prev.content ?? []), nested.node];
      else items.push({ type: task ? 'taskItem' : 'listItem', attrs: task ? { checked: false } : undefined, content: [paragraph(''), nested.node] });
      i = nested.next;
      continue;
    }
    if (line.ordered !== ordered) break;
    const m = TASK.exec(line.text);
    if (task && m) items.push({ type: 'taskItem', attrs: { checked: m[1] !== ' ' }, content: [paragraph(m[2]!)] });
    else if (task) break;
    else items.push({ type: 'listItem', content: [paragraph(line.text)] });
    i++;
  }
  for (const item of items) if (item.attrs === undefined) delete item.attrs;
  return {
    node: { type: task ? 'taskList' : ordered ? 'orderedList' : 'bulletList', content: items },
    next: i,
  };
}

/* ---------------------------------------------------------------- blocks -- */

function parseBlocks(lines: string[], depth: number): RichTextNode[] {
  const blocks: RichTextNode[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(paragraph(para.join(' ')));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      flushPara();
      continue;
    }
    const fence = /^(```|~~~)\s*([\w+-]{0,30})\s*$/.exec(trimmed);
    if (fence) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== fence[1]) code.push(lines[i++]!);
      const text = code.join('\n');
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[2] || null },
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      flushPara();
      const content = parseInline(heading[2]!);
      blocks.push({ type: 'heading', attrs: { level: Math.min(3, heading[1]!.length) }, ...(content.length ? { content } : {}) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s+/g, ''))) {
      flushPara();
      blocks.push({ type: 'horizontalRule' });
      continue;
    }
    if (trimmed.startsWith('>') && depth < 5) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoted.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      const inner = parseBlocks(quoted, depth + 1);
      blocks.push({ type: 'blockquote', content: inner.length ? inner : [paragraph('')] });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flushPara();
      const items: ListLine[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (m) {
          items.push({ indent: m[1]!.replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]!), text: m[3]! });
        } else if (lines[i]!.trim() !== '' && /^\s{2,}/.test(lines[i]!) && items.length) {
          // Continuation line of the previous item.
          items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
        } else break;
        i++;
      }
      i--;
      let k = 0;
      while (k < items.length) {
        const { node, next } = buildList(items, k, items[k]!.indent);
        blocks.push(node);
        k = next > k ? next : k + 1;
      }
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

export function markdownToDoc(markdown: string): RichTextDoc {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  return { type: 'doc', content: parseBlocks(lines, 0) };
}

/** Internal links (`mynotes:` references) written in the Markdown. */
export function referencesIn(doc: RichTextNode): { type: string; id: string }[] {
  const found = new Map<string, { type: string; id: string }>();
  const visit = (node: RichTextNode) => {
    if (node.type === 'reference') {
      const link = parseInternalHref(node.attrs?.href);
      if (link) found.set(`${link.type}:${link.id}`, { type: link.type, id: link.id });
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return [...found.values()];
}
