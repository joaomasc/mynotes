import { useMemo } from 'react';
import { RELATION_KIND_LABELS, normalizeSearch, type Graph, type GraphEdge, type GraphEntityType, type GraphNode, type RelationKind } from '@mynotes/shared';
import { ENTITY_CSS_VAR } from '@/lib/entities';
import { usePref } from '@/lib/prefs';
import { referencePath } from '@/lib/references';
import type { TopicTree } from '../topics/use-topics';
import { DEFAULT_FORCES, type FGEdge, type FGNode, type GraphSettings } from './force-graph';

/** A color group: nodes matching the query get the color (like Obsidian's graph groups). */
export interface ColorGroup {
  id: string;
  query: string;
  color: string;
}

export interface GraphPrefs extends GraphSettings {
  showOrphans: boolean;
  showTags: boolean;
  groups: ColorGroup[];
}

export const DEFAULT_GRAPH_PREFS: GraphPrefs = { ...DEFAULT_FORCES, showOrphans: true, showTags: false, groups: [] };

export function useGraphPrefs(key = 'mynotes:graph-settings'): [GraphPrefs, (p: GraphPrefs) => void] {
  const [value, set] = usePref<Partial<GraphPrefs>>(key, DEFAULT_GRAPH_PREFS);
  // Stable while unchanged: the simulation reheats whenever its settings object changes.
  const merged = useMemo(() => ({ ...DEFAULT_GRAPH_PREFS, ...value }), [value]);
  return [merged, set];
}

export const GROUP_COLORS = ['#d9534f', '#e8912d', '#d4b106', '#4caf50', '#1fa3a3', '#3d7be0', '#8e5bd6', '#d6589b'];

export const EDGE_LABELS: Partial<Record<GraphEdge['kind'], string>> = {
  parent: 'subassunto',
  contains: 'contém',
  links_to: 'cita',
  annotates: 'anota',
};
export const edgeLabel = (e: GraphEdge) => EDGE_LABELS[e.kind] ?? RELATION_KIND_LABELS[e.kind as RelationKind] + (e.label ? ` · ${e.label}` : '');

/** Reviews and page annotations are notes, drawn with the color of books. */
export const isBookNote = (n: GraphNode) => n.type === 'note' && !!n.role && n.role !== 'note';
export const nodeColor = (n: GraphNode) => ENTITY_CSS_VAR[isBookNote(n) ? 'reading' : n.type]!;

export const graphNodePath = (n: GraphNode) => referencePath({ type: n.type, id: n.entityId, role: n.role, readingId: null, page: null });

const TYPE_WORDS: Record<string, GraphEntityType> = {
  nota: 'note',
  notas: 'note',
  assunto: 'topic',
  assuntos: 'topic',
  livro: 'reading',
  livros: 'reading',
  leitura: 'reading',
  documento: 'document',
  documentos: 'document',
  conceito: 'concept',
  conceitos: 'concept',
};

export interface MatchContext {
  tree: TopicTree;
  tagsByNote: Map<string, string[]>;
}

/**
 * Queries of color groups and the graph search:
 * `#tag` (and nested tags), `tipo:nota`, `assunto:Economia` (the topic and
 * everything under it) or any text of the title.
 */
export function matchesQuery(raw: string, node: GraphNode, ctx: MatchContext): boolean {
  const q = raw.trim();
  if (!q) return false;
  if (node.key.startsWith('tag:')) return q.startsWith('#') && node.key.slice(4).startsWith(normalizeSearch(q.slice(1)));
  if (q.startsWith('#')) {
    const tag = normalizeSearch(q.slice(1));
    if (!tag) return false;
    return (ctx.tagsByNote.get(node.entityId) ?? []).some((t) => t === tag || t.startsWith(`${tag}/`));
  }
  const field = /^(tipo|assunto|path):\s*(.+)$/i.exec(q);
  if (field) {
    const value = normalizeSearch(field[2]!);
    if (field[1]!.toLowerCase() === 'tipo') {
      const type = TYPE_WORDS[value];
      return type ? node.type === type || (type === 'reading' && isBookNote(node)) : false;
    }
    // Topic and its subtree.
    let topicId = node.type === 'topic' ? node.entityId : node.topicId;
    const seen = new Set<string>();
    while (topicId && !seen.has(topicId)) {
      seen.add(topicId);
      const t = ctx.tree.byId.get(topicId);
      if (!t) break;
      if (normalizeSearch(t.title).includes(value)) return true;
      topicId = t.parentId;
    }
    return false;
  }
  return normalizeSearch(node.label).includes(normalizeSearch(q));
}

function edgeStyle(e: GraphEdge): Omit<FGEdge, 'key' | 'source' | 'target'> {
  if (e.kind === 'parent' || e.kind === 'contains') return { color: 'var(--border-strong)', width: 1, dash: [3, 4] };
  if (e.kind === 'annotates') return { color: 'var(--c-reading)', width: 1, dash: [2, 3] };
  if (e.kind === 'links_to') return { color: 'var(--c-note)', width: 1.3, arrow: true };
  return { color: 'var(--accent)', width: 2, arrow: true };
}

export interface ViewOptions {
  structure: boolean;
  hidden: Set<GraphEntityType>;
  showOrphans: boolean;
  showTags: boolean;
  groups: ColorGroup[];
  ctx: MatchContext;
}

/** Nodes and edges to draw, with filters, tags as nodes and group colors applied. */
export function buildView(graph: Graph, o: ViewOptions): { nodes: FGNode[]; edges: FGEdge[]; source: Map<string, GraphNode>; edgeSource: Map<string, GraphEdge> } {
  const source = new Map<string, GraphNode>();
  for (const n of graph.nodes) if (!o.hidden.has(n.type)) source.set(n.key, n);
  const edgeSource = new Map<string, GraphEdge>();
  const edges: FGEdge[] = [];
  for (const e of graph.edges) {
    if (!source.has(e.source) || !source.has(e.target)) continue;
    if (!o.structure && (e.kind === 'parent' || e.kind === 'contains')) continue;
    edgeSource.set(e.key, e);
    edges.push({ key: e.key, source: e.source, target: e.target, ...edgeStyle(e) });
  }
  const nodes: FGNode[] = [];
  if (o.showTags && !o.hidden.has('note')) {
    for (const t of graph.tags ?? []) {
      const key = `tag:${t.tag}`;
      const linked = t.noteIds.filter((id) => source.has(`note:${id}`));
      if (linked.length === 0) continue;
      source.set(key, { key, type: 'note', entityId: t.noteIds[0]!, label: `#${t.tag}`, topicId: null, role: null });
      for (const id of linked) edges.push({ key: `tag|${t.tag}|${id}`, source: `note:${id}`, target: key, color: 'var(--accent)', width: 0.8, dash: [1, 3] });
    }
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const n of source.values()) {
    if (!o.showOrphans && !degree.get(n.key)) continue;
    const isTag = n.key.startsWith('tag:');
    const group = isTag ? undefined : o.groups.find((g) => matchesQuery(g.query, n, o.ctx));
    nodes.push({
      key: n.key,
      label: n.label,
      color: isTag ? 'var(--accent)' : (group?.color ?? nodeColor(n)),
      dashed: isBookNote(n),
      shape: isTag ? 'tag' : undefined,
      // Top of the hierarchy shown (a topic whose parent is not in the graph): clusters are centered on it.
      root: n.type === 'topic' && !isTag && !(n.topicId && source.has(`topic:${n.topicId}`)),
    });
  }
  return { nodes, edges, source, edgeSource };
}

export function tagsByNote(graph: Graph | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of graph?.tags ?? []) for (const id of t.noteIds) map.set(id, [...(map.get(id) ?? []), t.tag]);
  return map;
}

/** Keys within `depth` links of the roots. */
export function neighbourhood(edges: { source: string; target: string }[], roots: string[], depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const set = new Set(roots);
  let frontier = roots;
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (set.has(n)) continue;
        set.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return set;
}
