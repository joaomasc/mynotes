import type { Edge, Viewport } from '@xyflow/react';
import { zMindMapData, type MindMapData } from '@mynotes/shared';
import type { MindFlowNode } from './mind-node';

export function toFlow(data: MindMapData): { nodes: MindFlowNode[]; edges: Edge[] } {
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: 'mind',
      position: n.position,
      data: { label: n.label, color: n.color, ref: n.ref, parentId: n.parentId },
    })),
    edges: data.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label || undefined })),
  };
}

export function fromFlow(nodes: MindFlowNode[], edges: Edge[], viewport: Viewport | null): MindMapData {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      label: n.data.label.slice(0, 500),
      color: n.data.color,
      ref: n.data.ref,
      parentId: n.data.parentId && ids.has(n.data.parentId) ? n.data.parentId : null,
    })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : '' })),
    viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: Math.min(10, Math.max(0.05, viewport.zoom)) } : null,
  };
}

/** Horizontal tree layout from the parent links; nodes outside a tree keep their place. */
export function treeLayout(nodes: MindFlowNode[]): MindFlowNode[] {
  const children = new Map<string, MindFlowNode[]>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: MindFlowNode[] = [];
  for (const n of nodes) {
    const p = n.data.parentId ? byId.get(n.data.parentId) : undefined;
    if (p) children.set(p.id, [...(children.get(p.id) ?? []), n]);
    else roots.push(n);
  }
  const placed = new Map<string, { x: number; y: number }>();
  let cursorY = 0;
  const GAP_X = 260;
  const GAP_Y = 76;
  const visit = (n: MindFlowNode, depth: number, seen: Set<string>): number => {
    if (seen.has(n.id)) return cursorY;
    seen.add(n.id);
    const kids = (children.get(n.id) ?? []).sort((a, b) => a.position.y - b.position.y);
    if (kids.length === 0) {
      const y = cursorY;
      cursorY += GAP_Y;
      placed.set(n.id, { x: depth * GAP_X, y });
      return y;
    }
    const ys = kids.map((k) => visit(k, depth + 1, seen));
    const y = (ys[0]! + ys[ys.length - 1]!) / 2;
    placed.set(n.id, { x: depth * GAP_X, y });
    return y;
  };
  const seen = new Set<string>();
  for (const r of roots.filter((r) => children.has(r.id))) {
    visit(r, 0, seen);
    cursorY += GAP_Y;
  }
  return nodes.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id)! } : n));
}

export function parseImportedMap(text: string): MindMapData {
  const json = JSON.parse(text) as unknown;
  const candidate = (json && typeof json === 'object' && 'data' in json ? (json as { data: unknown }).data : json) as unknown;
  return zMindMapData.parse(candidate);
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
