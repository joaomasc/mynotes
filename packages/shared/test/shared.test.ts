import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLE_ORDER,
  analyzeDoc,
  backupColumns,
  isAllowedHref,
  keyBetween,
  makeExcerpt,
  normalizeAligned,
  normalizeSearch,
  parseInternalHref,
  searchTerms,
  uuidv7,
  zMindMapData,
  zRichTextDoc,
} from '../src';

describe('search normalization', () => {
  it('removes accents and case', () => {
    expect(normalizeSearch('  Política   Monetária ')).toBe('politica monetaria');
    expect(searchTerms('Inflação  INFLAÇÃO juros')).toEqual(['inflacao', 'juros']);
  });

  it('keeps one output code point per input code point (SQLite offsets stay valid)', () => {
    const samples = ['Ação e reação', 'Ελληνικά', 'emoji 📚 aqui', 'İstanbul', 'tab\tand\nnewline', 'é combinado'];
    for (const s of samples) {
      const nfc = s.normalize('NFC');
      expect([...normalizeAligned(nfc)].length).toBe([...nfc].length);
    }
    const original = 'Título — A inflação no Brasil';
    const norm = normalizeAligned(original);
    const offset = [...norm].join('').indexOf('inflacao');
    expect([...original].slice(offset, offset + 8).join('')).toBe('inflação');
  });
});

describe('rich text analysis', () => {
  const doc = {
    type: 'doc' as const,
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'ver ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'isto', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: ' e aquilo', marks: [{ type: 'link', attrs: { href: 'mynotes:note/0190f0c0-0000-7000-8000-000000000001' } }] },
        ],
      },
    ],
  };

  it('extracts text, words and internal links, and strips unsafe links', () => {
    const a = analyzeDoc(doc);
    expect(a.text).toBe('Título\nver isto e aquilo');
    expect(a.wordCount).toBe(5);
    expect(a.links).toEqual([{ type: 'note', id: '0190f0c0-0000-7000-8000-000000000001' }]);
    expect(JSON.stringify(doc)).not.toContain('javascript:');
  });

  it('validates hrefs', () => {
    expect(isAllowedHref('https://example.com')).toBe(true);
    expect(isAllowedHref('mailto:a@b.c')).toBe(true);
    expect(isAllowedHref('javascript:alert(1)')).toBe(false);
    expect(isAllowedHref('data:text/html,x')).toBe(false);
    expect(parseInternalHref('mynotes:note/not-a-uuid')).toBeNull();
  });

  it('validates the document structure', () => {
    expect(zRichTextDoc.safeParse({ type: 'doc', content: [] }).success).toBe(true);
    expect(zRichTextDoc.safeParse({ type: 'doc', content: [{ type: 5 }] }).success).toBe(false);
    expect(zRichTextDoc.safeParse({ type: 'paragraph', content: [] }).success).toBe(false);
  });

  it('builds excerpts on word boundaries', () => {
    expect(makeExcerpt('palavra '.repeat(100), 30).endsWith('…')).toBe(true);
  });
});

describe('ids and ordering', () => {
  it('generates time-ordered UUIDv7', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('creates fractional keys between neighbours', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b && b < c).toBe(true);
  });
});

describe('mind map schema', () => {
  it('rejects edges to unknown nodes and duplicate ids', () => {
    const node = { id: 'a', position: { x: 0, y: 0 }, label: 'A' };
    expect(zMindMapData.safeParse({ nodes: [node], edges: [{ id: 'e', source: 'a', target: 'b' }] }).success).toBe(false);
    expect(zMindMapData.safeParse({ nodes: [node, node], edges: [] }).success).toBe(false);
  });
});

describe('backup format', () => {
  it('only uses columns that exist in the database schema (all migrations)', () => {
    const dir = new URL('../../../apps/api/migrations/', import.meta.url);
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n');
    for (const table of BACKUP_TABLE_ORDER) {
      const match = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
      expect(match, `table ${table} exists`).not.toBeNull();
      const added = [...sql.matchAll(new RegExp(`ALTER TABLE ${table} ADD COLUMN (\\w+)`, 'g'))].map((m) => m[1]);
      const body = match![1]!;
      for (const col of backupColumns(table)) {
        expect(new RegExp(`^\\s+${col}\\s`, 'm').test(body) || added.includes(col), `${table}.${col}`).toBe(true);
      }
    }
  });
});
