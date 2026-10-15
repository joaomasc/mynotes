import { Editor, type Content } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { noteExtensions } from '@/features/notes/editor/extensions';
import type { Trigger, TriggerStorage } from '@/features/notes/editor/triggers';

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as Content;
const link = [{ type: 'link', attrs: { href: 'https://example.com' } }];
const ref = { type: 'reference', attrs: { href: 'mynotes://topic/0190a0a0-0000-7000-8000-000000000000', label: 'Assunto' } };

/** Types `typed` at `at` (default: end of the note) and returns the open prompt, if any. */
function typeIn(content: Content, typed: string, at?: number): Trigger | null {
  // Plugin views (where triggers are detected) only run in a mounted editor.
  const editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions(''), content });
  let last: Trigger | null = null;
  (editor.storage as unknown as { triggers: TriggerStorage }).triggers.onChange = (x) => (last = x);
  if (at === undefined) editor.commands.focus('end');
  else editor.commands.setTextSelection(at);
  for (const ch of typed) editor.commands.insertContent(t(ch));
  const result = last;
  editor.destroy(); // reports null on the way out
  return result;
}

describe('"/" and "#" prompts', () => {
  it.each<[string, Content]>([
    ['an empty paragraph', doc(p())],
    ['a space', doc(p(t('texto ')))],
    ['a line break (Shift+Enter or pasted text)', doc(p(t('linha um'), { type: 'hardBreak' }))],
    ['a link followed by a space', doc(p(t('site', link), t(' ')))],
    ['the end of a link that swallowed the space', doc(p(t('site ', link)))],
    ['a reference chip', doc(p(ref))],
    ['a list item', doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item '))] }] })],
    ['a heading', doc({ type: 'heading', attrs: { level: 2 }, content: [t('Título ')] })],
  ])('opens "/" after %s', (_name, content) => {
    expect(typeIn(content, '/livro')).toMatchObject({ char: '/', query: 'livro' });
  });

  it('opens "#" after a line break', () => {
    expect(typeIn(doc(p(t('linha'), { type: 'hardBreak' })), '#tema')).toMatchObject({ char: '#', query: 'tema' });
  });

  it('stays closed inside words, addresses and links', () => {
    expect(typeIn(doc(p(t('e'))), '/ou')).toBeNull();
    expect(typeIn(doc(p(t('veja http:'))), '//x')).toBeNull();
    // Typing in the middle of a link's text ("abc |def").
    expect(typeIn(doc(p(t('abc def', link))), '/', 5)).toBeNull();
    expect(typeIn(doc(p(t('`', [{ type: 'code' }]), t(' ', [{ type: 'code' }]))), '/')).toBeNull();
  });
});
