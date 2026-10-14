import { describe, expect, it } from 'vitest';
import { analyzeDoc, asRichTextDoc, extractTags, internalHref, normalizeTag, parseInternalHref, uuidv7, zRichTextDoc } from '../src';

const id = uuidv7();

describe('internal references', () => {
  it('identify targets by id, with an optional page for books', () => {
    expect(parseInternalHref(`mynotes:topic/${id}`)).toEqual({ type: 'topic', id });
    expect(parseInternalHref(`mynotes:reading/${id}/p/125`)).toEqual({ type: 'reading', id, page: 125 });
    expect(parseInternalHref(`mynotes:reading/${id}/p/0`)).toEqual({ type: 'reading', id });
    expect(parseInternalHref(`mynotes:topic/${id}/p/3`)).toEqual({ type: 'topic', id });
    expect(parseInternalHref('mynotes:topic/Mercantilismo')).toBeNull();
    expect(internalHref('reading', id, 12)).toBe(`mynotes:reading/${id}/p/12`);
    expect(internalHref('topic', id, 12)).toBe(`mynotes:topic/${id}`);
  });

  it('are indexed from reference nodes, which also feed the search text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ver ' },
            { type: 'reference', attrs: { href: `mynotes:topic/${id}`, label: 'Mercantilismo' } },
            { type: 'reference', attrs: { href: 'javascript:alert(1)', label: 'x' } },
          ],
        },
      ],
    };
    const a = analyzeDoc(doc);
    expect(a.links).toEqual([{ type: 'topic', id }]);
    expect(a.text).toContain('Mercantilismo');
    expect((doc.content[0]!.content[2] as { attrs: { href: unknown } }).attrs.href).toBeNull();
  });
});

describe('tags', () => {
  it('are normalized and only recognized where they start a word', () => {
    expect(normalizeTag('#Crítica')).toBe('critica');
    expect(extractTags('#Revisar isto, (#dúvida) e C# ou #1 ou a/#b; #revisar de novo')).toEqual(['revisar', 'duvida']);
  });

  it('ignore code', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '#sim ' }, { type: 'text', text: '#nao', marks: [{ type: 'code' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: '#bloco' }] },
      ],
    };
    expect(analyzeDoc(doc).tags).toEqual(['sim']);
  });
});

describe('empty documents', () => {
  it('accepts the ProseMirror form without content (title typed before the body)', () => {
    expect(zRichTextDoc.parse({ type: 'doc' })).toEqual({ type: 'doc', content: [] });
    expect(zRichTextDoc.safeParse({ type: 'doc', content: 'x' }).success).toBe(false);
    expect(asRichTextDoc({ type: 'doc' })).toEqual({ type: 'doc', content: [] });
  });
});
