import { beforeEach, describe, expect, it } from 'vitest';
import type { RichTextDoc } from '@mynotes/shared';
import { fuzzyFilter, fuzzyScore } from '@/lib/fuzzy';
import { eventToHotkey, formatHotkey } from '@/lib/hotkeys';
import { linkFirstMention, mentionExcerpt } from '@/features/notes/mentions';
import { fillTemplate, fillText, formatDate } from '@/features/notes/templates';
import { allPanes, workspace } from '@/features/workspace/store';
import { pathTarget } from '@/features/workspace/tab-info';

const para = (...content: object[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: object[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const doc = (...content: object[]) => ({ type: 'doc', content }) as RichTextDoc;

describe('fuzzy matching (quick switcher)', () => {
  it('matches letters in order, ignoring accents and case', () => {
    expect(fuzzyScore('ocap', 'O Capital')).not.toBeNull();
    expect(fuzzyScore('inflacao', 'Inflação e moeda')).not.toBeNull();
    expect(fuzzyScore('xyz', 'O Capital')).toBeNull();
  });

  it('ranks prefixes and word starts first', () => {
    const titles = ['Organização da capela', 'O Capital', 'Capitalismo tardio'];
    expect(fuzzyFilter(titles, 'capital', (t) => t)[0]).toBe('Capitalismo tardio');
    expect(fuzzyFilter(titles, 'o cap', (t) => t)[0]).toBe('O Capital');
  });
});

describe('shortcuts', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('come from the physical key, so Alt+T works where Alt types a symbol', () => {
    expect(eventToHotkey(key({ key: '†', code: 'KeyT', altKey: true }))).toBe('Alt+T');
    expect(eventToHotkey(key({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K');
    expect(eventToHotkey(key({ key: '\\', code: 'Backslash', altKey: true }))).toBe('Alt+\\');
    expect(eventToHotkey(key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }))).toBe('Alt+ArrowLeft');
    expect(eventToHotkey(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
  });
  it('are shown readably', () => {
    expect(formatHotkey('Alt+ArrowLeft')).toMatch(/←$/);
  });
});

describe('unlinked mentions', () => {
  const target = { type: 'note' as const, id: '01900000-0000-7000-8000-000000000001', label: 'Mais-valia' };

  it('finds the title as a whole word, ignoring accents and case', () => {
    expect(mentionExcerpt(doc(para(text('A mais-valia é central.'))), 'Mais-valia')).toContain('mais-valia');
    expect(mentionExcerpt(doc(para(text('Maisvaliar não conta.'))), 'Mais-valia')).toBeNull();
    // Code and existing links are not mentions.
    expect(mentionExcerpt(doc(para(text('mais-valia', [{ type: 'code' }]))), 'Mais-valia')).toBeNull();
  });

  it('links the first mention, keeping the text around it', () => {
    const linked = linkFirstMention(doc(para(text('Sobre a mais-valia e a mais-valia relativa.', [{ type: 'bold' }]))), 'Mais-valia', target)!;
    const parts = linked.content[0]!.content!;
    expect(parts.map((p) => p.text ?? `[${p.type}]`)).toEqual(['Sobre a ', '[reference]', ' e a mais-valia relativa.']);
    expect(parts[0]!.marks).toEqual([{ type: 'bold' }]);
    expect(parts[1]!.attrs).toEqual({ href: `mynotes:note/${target.id}`, label: 'Mais-valia' });
    expect(linkFirstMention(doc(para(text('nada aqui'))), 'Mais-valia', target)).toBeNull();
  });
});

describe('templates', () => {
  const date = new Date(2026, 9, 19, 8, 5);
  it('fill variables', () => {
    expect(formatDate('YYYY-MM-DD', date)).toBe('2026-10-19');
    expect(fillText('{{data}} às {{hora}} — {{titulo}} ({{assunto}}) {{data:YYYY}} {{outra}}', { title: 'Aula', topic: 'História', date })).toBe(
      '19/10/2026 às 08:05 — Aula (História) 2026 {{outra}}',
    );
  });
  it('without changing the template itself', () => {
    const template = doc(para(text('Resumo de {{titulo}}')));
    const filled = fillTemplate(template, { title: 'Marx', topic: '', date });
    expect(filled.content[0]!.content![0]!.text).toBe('Resumo de Marx');
    expect(template.content[0]!.content![0]!.text).toBe('Resumo de {{titulo}}');
  });
});

describe('workspace (tabs and split panes)', () => {
  beforeEach(() => {
    localStorage.clear();
    workspace.enabled = true;
    // Back to a single tab.
    for (const p of allPanes(workspace.getState().root)) for (const t of p.tabs) workspace.closeTab(t.id);
  });

  it('opens tabs, splits panes and collapses empty panes', () => {
    workspace.openTab('/notes');
    expect(workspace.activePane().tabs.map((t) => t.path)).toEqual(['/', '/notes']);
    workspace.openSplit('/graph', 'row');
    let root = workspace.getState().root;
    expect(root.kind).toBe('split');
    expect(allPanes(root)).toHaveLength(2);
    expect(workspace.activeTab().path).toBe('/graph');
    // Closing the only tab of a pane removes the pane.
    workspace.closeTab(workspace.activeTab().id);
    root = workspace.getState().root;
    expect(root.kind).toBe('pane');
    // …and it can be reopened.
    workspace.reopenClosed();
    expect(workspace.activeTab().path).toBe('/graph');
  });

  it('moves a tab into a new split by dropping it on an edge', () => {
    const tab = workspace.openTab('/notes')!;
    const pane = workspace.activePane();
    workspace.moveTab(tab.id, pane.id, 'right');
    const root = workspace.getState().root;
    expect(root.kind === 'split' && root.dir).toBe('row');
    expect(allPanes(root).map((p) => p.tabs.map((t) => t.path))).toEqual([['/'], ['/notes']]);
  });

  it('pinned tabs keep their page: navigation opens a new tab', () => {
    const first = workspace.activeTab();
    workspace.togglePin(first.id);
    workspace.navigateActive('/library');
    const tabs = workspace.activePane().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.path).toBe('/');
    expect(workspace.activeTab().path).toBe('/library');
  });

  it('names what a path shows (titles, linked panels)', () => {
    expect(pathTarget('/notes/abc').entity).toEqual({ type: 'note', id: 'abc' });
    expect(pathTarget('/readings/r1?page=3&annotation=n1').entity).toEqual({ type: 'note', id: 'n1' });
    expect(pathTarget('/graph')).toMatchObject({ entity: null, fixed: 'Grafo' });
  });
});
