import { describe, expect, it } from 'vitest';
import type { Graph, LinkSuggestion, MemoryInfo } from '@mynotes/shared';
import { buildView, memoryStyle } from '@/features/graph/graph-data';
import { buildTree } from '@/features/topics/use-topics';

const id = (n: number) => `0190f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const graph: Graph = {
  nodes: [
    { key: `topic:${id(1)}`, type: 'topic', entityId: id(1), label: 'Economia', topicId: null, role: null },
    { key: `note:${id(2)}`, type: 'note', entityId: id(2), label: 'Inflação', topicId: id(1), role: 'note' },
    { key: `note:${id(3)}`, type: 'note', entityId: id(3), label: 'Juros', topicId: id(1), role: 'note' },
    { key: `note:${id(4)}`, type: 'note', entityId: id(4), label: 'Anotação', topicId: id(1), role: 'annotation' },
    { key: `concept:${id(5)}`, type: 'concept', entityId: id(5), label: 'Moeda', topicId: id(1), role: null },
  ],
  edges: [{ key: 'e1', source: `topic:${id(1)}`, target: `note:${id(2)}`, kind: 'contains', relationId: null, label: '' }],
  truncated: false,
};
const ctx = { tree: buildTree([]), tagsByNote: new Map<string, string[]>() };
const base = { structure: true, hidden: new Set<never>(), showOrphans: true, showTags: false, groups: [{ id: 'g', query: 'Juros', color: '#ff0000' }], ctx };
const info = (r: number | null): MemoryInfo => ({ r, cards: 2, reviewed: r === null ? 0 : 2, due: 0 });

describe('memory graph colors', () => {
  it('colors by how much is remembered, rings for never reviewed and for no cards', () => {
    const memory = new Map([
      [`topic:${id(1)}`, info(0.93)],
      [`note:${id(2)}`, info(0.42)],
      [`note:${id(3)}`, info(null)],
    ]);
    const view = buildView(graph, { ...base, memory });
    const byKey = new Map(view.nodes.map((n) => [n.key, n]));
    expect(byKey.get(`topic:${id(1)}`)).toMatchObject({ color: 'var(--mem-0)', hollow: false });
    expect(byKey.get(`note:${id(2)}`)).toMatchObject({ color: 'var(--mem-4)', hollow: false });
    // Never reviewed: a ring (the color group "Juros" does not apply in memory mode).
    expect(byKey.get(`note:${id(3)}`)).toMatchObject({ color: 'var(--mem-2)', hollow: true });
    // No cards: a gray ring; annotations lose their dashed outline in this mode.
    expect(byKey.get(`concept:${id(5)}`)).toMatchObject({ color: 'var(--border-strong)', hollow: true });
    expect(byKey.get(`note:${id(4)}`)).toMatchObject({ hollow: true, dashed: false });
    expect(memoryStyle('nope', memory)).toEqual({ color: 'var(--border-strong)', hollow: true });
  });

  it('colors by type (and groups) otherwise', () => {
    const view = buildView(graph, base);
    expect(view.nodes.find((n) => n.key === `note:${id(3)}`)).toMatchObject({ color: '#ff0000' });
    expect(view.nodes.find((n) => n.key === `note:${id(4)}`)).toMatchObject({ dashed: true });
    expect(view.nodes.every((n) => !n.hollow)).toBe(true);
  });

  it('draws suggested links between visible items only', () => {
    const s = (a: string, b: string, n: number): LinkSuggestion => ({
      id: id(100 + n),
      a: { type: 'note', id: a, title: 'A', topicId: null },
      b: { type: 'note', id: b, title: 'B', topicId: null },
      score: 0.8,
      kind: null,
      direction: 'ab',
      reason: '',
      explained: false,
      status: 'open',
      createdAt: '2026-10-23T00:00:00.000Z',
    });
    const view = buildView(graph, { ...base, suggestions: [s(id(2), id(3), 1), s(id(2), id(99), 2)] });
    const sug = view.edges.filter((e) => e.key.startsWith('sug:'));
    expect(sug).toEqual([{ key: `sug:${id(101)}`, source: `note:${id(2)}`, target: `note:${id(3)}`, color: 'var(--suggest)', width: 1.6, dash: [5, 4] }]);
    // Not a data edge: clicking it opens the suggestion, not a relation.
    expect(view.edgeSource.has(`sug:${id(101)}`)).toBe(false);
  });
});
