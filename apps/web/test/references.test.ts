import { describe, expect, it } from 'vitest';
import { parseRefQuery, referencePath, refSyntax } from '@/lib/references';

describe('"/" reference syntax', () => {
  it('narrows the search with readable prefixes and book pages', () => {
    expect(parseRefQuery('assunto.Mercantilismo')).toMatchObject({ kind: { types: 'topic' }, text: 'Mercantilismo', page: null });
    expect(parseRefQuery('livro.O Capital#p-125')).toMatchObject({ kind: { types: 'reading' }, text: 'O Capital', page: 125 });
    expect(parseRefQuery('leitura.O Capital#capitulo')).toMatchObject({ kind: { prefix: 'livro' }, text: 'O Capital#capitulo' });
    expect(parseRefQuery('pagina.O Capital')).toMatchObject({ kind: { types: 'annotation' }, text: 'O Capital' });
    expect(parseRefQuery('Página.capital')).toMatchObject({ kind: { types: 'annotation' } });
    // Unknown prefixes and plain text search everything.
    expect(parseRefQuery('e.g. inflação')).toMatchObject({ kind: null, text: 'e.g. inflação' });
    expect(parseRefQuery('assunto.#5')).toMatchObject({ kind: { types: 'topic' }, text: '#5', page: null });
  });

  it('reads back as the visible syntax and opens the right place', () => {
    const base = { readingTitle: null, page: null, materialType: null, role: null };
    expect(refSyntax({ ...base, type: 'topic', title: 'Mercantilismo' })).toBe('/assunto.Mercantilismo');
    expect(refSyntax({ ...base, type: 'reading', title: 'O Capital', materialType: 'book' }, 125)).toBe('/livro.O Capital, p. 125');
    expect(refSyntax({ ...base, type: 'note', title: '', role: 'annotation', readingTitle: 'O Capital', page: 24 })).toBe('/pagina.O Capital, p. 24');
    expect(referencePath({ type: 'note', id: 'n', role: 'annotation', readingId: 'r', page: 24 })).toBe('/readings/r?page=24&annotation=n');
    expect(referencePath({ type: 'reading', id: 'r', role: null, readingId: null, page: null }, 7)).toBe('/readings/r?page=7');
    expect(referencePath({ type: 'topic', id: 't', role: null, readingId: null, page: null })).toBe('/topics/t');
  });
});
