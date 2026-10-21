import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { zMindMapData, type MindMapData } from '@mynotes/shared';
import { cardsInside, fromCanvasFlow, styledEdge, toCanvasFlow, type CardNode } from '@/features/canvas/canvas-model';
import { canonicalLanguage, lowlight } from '@/features/notes/editor/code-block';
import { noteExtensions } from '@/features/notes/editor/extensions';
import { formatDate, parseDailyTitle } from '@/features/notes/templates';
import { pathTarget } from '@/features/workspace/tab-info';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('daily notes', () => {
  it('recognizes a daily note by its title in the configured format', () => {
    expect(dayKey(parseDailyTitle('YYYY-MM-DD', '2026-10-21')!)).toBe('2026-10-21');
    expect(dayKey(parseDailyTitle('DD/MM/YYYY', '05/01/2027')!)).toBe('2027-01-05');
    expect(dayKey(parseDailyTitle('Diário YYYY.MM.DD', 'Diário 2026.02.28')!)).toBe('2026-02-28');
    expect(parseDailyTitle('YYYY-MM-DD', 'Reunião 2026-10-21')).toBeNull();
    expect(parseDailyTitle('YYYY-MM-DD', '2026-02-30')).toBeNull();
    // A format without a full date never matches.
    expect(parseDailyTitle('MM/YYYY', '10/2026')).toBeNull();
  });

  it('round-trips with the title it creates', () => {
    const day = new Date(2026, 9, 21, 14, 30);
    for (const format of ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD HH:mm']) {
      expect(dayKey(parseDailyTitle(format, formatDate(format, day))!)).toBe('2026-10-21');
    }
  });

  it('has its own page', () => {
    expect(pathTarget('/daily').fixed).toBe('Notas diárias');
  });
});

describe('code blocks', () => {
  it('maps the names typed after ``` to the language in the picker', () => {
    expect(canonicalLanguage('js')).toBe('javascript');
    expect(canonicalLanguage('PY')).toBe('python');
    expect(canonicalLanguage('c#')).toBe('csharp');
    expect(canonicalLanguage('elixir')).toBe('elixir');
    expect(canonicalLanguage(null)).toBeNull();
  });

  /** A note with one code block; the cursor at `cursor` (default: its end). */
  const codeEditor = (language: string, code: string, cursor = code.length) => {
    const editor = new Editor({ extensions: noteExtensions(''), content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: code }] }] } });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1 + cursor)));
    return editor;
  };
  const press = (editor: Editor, key: string, shiftKey = false) =>
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key, shiftKey })));
  const code = (editor: Editor) => editor.state.doc.firstChild!.textContent;

  it('keeps and adds indentation on Enter', () => {
    const py = codeEditor('python', 'def soma(a, b):');
    press(py, 'Enter');
    py.commands.insertContent('return a + b');
    expect(code(py)).toBe('def soma(a, b):\n    return a + b');
    // At the end of the block: an arrow down leaves it.
    press(py, 'ArrowDown');
    expect(py.state.selection.$from.parent.type.name).toBe('paragraph');

    // Between brackets the closing one goes to its own line.
    const js = codeEditor('js', 'if (ok) {}', 'if (ok) {'.length);
    press(js, 'Enter');
    js.commands.insertContent('run();');
    expect(code(js)).toBe('if (ok) {\n  run();\n}');
  });

  it('indents and outdents the selected lines with Tab and Shift+Tab', () => {
    const editor = codeEditor('typescript', 'a\nb');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)));
    press(editor, 'Tab');
    expect(code(editor)).toBe('  a\n  b');
    press(editor, 'Tab', true);
    expect(code(editor)).toBe('a\nb');
  });

  it('highlights the languages offered', () => {
    for (const language of ['python', 'typescript', 'csharp', 'sql', 'powershell', 'dockerfile', 'js', 'html']) {
      expect(lowlight.registered(language)).toBe(true);
    }
    const tree = lowlight.highlight('python', 'def soma(a, b):\n    return a + b');
    expect(JSON.stringify(tree)).toContain('hljs-keyword');
  });
});

describe('canvas', () => {
  const data: MindMapData = zMindMapData.parse({
    nodes: [
      { id: 'g', kind: 'group', position: { x: 0, y: 0 }, width: 600, height: 400, label: 'Causas' },
      { id: 't', kind: 'text', position: { x: 40, y: 40 }, width: 200, height: 100, label: '', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Crise fiscal' }] }] } },
      { id: 'n', kind: 'item', position: { x: 700, y: 0 }, label: 'Revolução', ref: { type: 'note', id: '0192a0b0-0000-7000-8000-000000000001', title: 'Revolução' } },
      { id: 'old', position: { x: 0, y: 500 }, label: 'Nó de um mapa mental' },
    ],
    edges: [{ id: 'e', source: 't', target: 'n', sourceHandle: 'right', targetHandle: 'left', arrow: 'both', color: '#b4372f' }],
    viewport: { x: 10, y: 20, zoom: 1.5 },
  });

  it('round-trips cards, sizes, sides and arrows', () => {
    const flow = toCanvasFlow(data);
    // Groups are drawn below the cards.
    expect(flow.nodes[0]!.type).toBe('group');
    expect(flow.nodes[0]!.zIndex).toBe(-1);
    // A node without a kind (from a mind map) becomes a text card with its label as text.
    const old = flow.nodes.find((n) => n.id === 'old')!;
    expect(old.type).toBe('text');
    expect(old.data.doc?.content[0]?.content?.[0]?.text).toBe('Nó de um mapa mental');
    // Items without a size get the default one (notes are large).
    expect(flow.nodes.find((n) => n.id === 'n')!.width).toBe(360);

    const back = zMindMapData.parse(fromCanvasFlow(flow.nodes, flow.edges, data.viewport));
    expect(back.nodes.find((n) => n.id === 'g')).toMatchObject({ kind: 'group', width: 600, height: 400, label: 'Causas' });
    expect(back.nodes.find((n) => n.id === 't')?.doc).toEqual(data.nodes[1]!.doc);
    expect(back.nodes.find((n) => n.id === 'n')?.ref?.id).toBe('0192a0b0-0000-7000-8000-000000000001');
    expect(back.edges[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left', arrow: 'both', color: '#b4372f' });
    expect(back.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
  });

  it('draws arrowheads and colors', () => {
    const [edge] = toCanvasFlow(data).edges;
    const styled = styledEdge(edge!);
    expect(styled.markerEnd).toBeTruthy();
    expect(styled.markerStart).toBeTruthy();
    expect(styled.style?.stroke).toBe('#b4372f');
    expect(styledEdge({ ...edge!, data: { color: null, arrow: 'none' } }).markerEnd).toBeUndefined();
  });

  it('moves with a group only the cards entirely inside it', () => {
    const nodes = toCanvasFlow(data).nodes as CardNode[];
    const group = nodes.find((n) => n.id === 'g')!;
    expect(cardsInside(group, nodes).map((n) => n.id)).toEqual(['t']);
  });

  it('opens on its own routes', () => {
    expect(pathTarget('/canvas').fixed).toBe('Canvas');
    expect(pathTarget('/canvas/0192a0b0-0000-7000-8000-000000000001').entity).toEqual({ type: 'mindmap', id: '0192a0b0-0000-7000-8000-000000000001' });
  });
});
