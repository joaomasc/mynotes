import { MarkerType, type Edge, type Node, type Viewport } from '@xyflow/react';
import type { MindMapData, MindMapNode, RichTextDoc } from '@mynotes/shared';

/**
 * A canvas is stored as a mind map (kind "canvas") whose nodes are cards:
 * text (rich text, with "/" references), item (a note, topic, book…), link
 * (a web page) and group (a labelled area that carries the cards inside it).
 */

export type CardKind = 'text' | 'item' | 'link' | 'group';

export interface CardData extends Record<string, unknown> {
  label: string;
  color: string | null;
  ref: MindMapNode['ref'];
  doc?: RichTextDoc | undefined;
  url?: string | undefined;
  /** Being edited in place (not saved). */
  editing?: boolean;
}
export type CardNode = Node<CardData, CardKind>;

export type Arrow = 'none' | 'end' | 'both';
export interface LinkData extends Record<string, unknown> {
  color: string | null;
  arrow: Arrow;
}
export type CanvasEdge = Edge<LinkData>;

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Size of a new card. Notes and topics are larger: they show their content. */
export function defaultSize(kind: CardKind, refType?: string | null): { width: number; height: number } {
  if (kind === 'group') return { width: 520, height: 360 };
  if (kind === 'link') return { width: 300, height: 96 };
  if (kind === 'text') return { width: 280, height: 150 };
  if (refType === 'note') return { width: 360, height: 320 };
  if (refType === 'topic') return { width: 320, height: 280 };
  return { width: 280, height: 84 };
}

const kindOf = (n: MindMapNode): CardKind => n.kind ?? (n.ref ? 'item' : 'text');

export function toCanvasFlow(data: MindMapData): { nodes: CardNode[]; edges: CanvasEdge[] } {
  const nodes = data.nodes.map((n): CardNode => {
    const kind = kindOf(n);
    const size = defaultSize(kind, n.ref?.type);
    return {
      id: n.id,
      type: kind,
      position: n.position,
      width: n.width ?? size.width,
      height: n.height ?? size.height,
      // Groups stay behind the cards they hold.
      ...(kind === 'group' ? { zIndex: -1 } : {}),
      data: {
        label: n.label,
        color: n.color,
        ref: n.ref,
        // A mind map node opened as a canvas: its label becomes the card text.
        doc: n.doc ?? (kind === 'text' && n.label ? textDoc(n.label) : undefined),
        url: n.url,
      },
    };
  });
  // Groups first, so they are drawn below.
  nodes.sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'));
  const edges = data.edges.map(
    (e): CanvasEdge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      label: e.label || undefined,
      data: { color: e.color ?? null, arrow: e.arrow ?? 'end' },
    }),
  );
  return { nodes, edges };
}

export function fromCanvasFlow(nodes: CardNode[], edges: CanvasEdge[], viewport: Viewport | null): MindMapData {
  const ids = new Set(nodes.map((n) => n.id));
  const size = (v: number | undefined, fallback: number) => Math.min(5000, Math.max(40, Math.round(v ?? fallback)));
  return {
    nodes: nodes.map((n) => {
      const kind = n.type ?? 'text';
      const fallback = defaultSize(kind, n.data.ref?.type);
      return {
        id: n.id,
        kind,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        width: size(n.width ?? n.measured?.width, fallback.width),
        height: size(n.height ?? n.measured?.height, fallback.height),
        label: n.data.label.slice(0, 500),
        color: n.data.color,
        ref: kind === 'item' ? n.data.ref : null,
        parentId: null,
        ...(kind === 'text' && n.data.doc ? { doc: n.data.doc } : {}),
        ...(kind === 'link' && n.data.url ? { url: n.data.url } : {}),
      };
    }),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === 'string' ? e.label.slice(0, 200) : '',
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        color: e.data?.color ?? null,
        arrow: e.data?.arrow ?? 'end',
      })),
    viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: Math.min(10, Math.max(0.05, viewport.zoom)) } : null,
  };
}

/** Arrowheads and color of a link, applied when drawing it. */
export function styledEdge(e: CanvasEdge): CanvasEdge {
  const color = e.data?.color ?? undefined;
  const arrow = e.data?.arrow ?? 'end';
  const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, ...(color ? { color } : {}) };
  return {
    ...e,
    markerEnd: arrow === 'none' ? undefined : marker,
    markerStart: arrow === 'both' ? marker : undefined,
    style: { ...e.style, strokeWidth: 2, ...(color ? { stroke: color } : {}) },
  };
}

export function textDoc(text: string): RichTextDoc {
  return { type: 'doc', content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) };
}

/** Cards entirely inside a group's area (they move with it). */
export function cardsInside(group: CardNode, nodes: CardNode[]): CardNode[] {
  const gw = group.width ?? group.measured?.width ?? 0;
  const gh = group.height ?? group.measured?.height ?? 0;
  return nodes.filter((n) => {
    if (n.id === group.id) return false;
    const w = n.width ?? n.measured?.width ?? 0;
    const h = n.height ?? n.measured?.height ?? 0;
    return n.position.x >= group.position.x && n.position.y >= group.position.y && n.position.x + w <= group.position.x + gw && n.position.y + h <= group.position.y + gh;
  });
}

/** Where a new card fits near `at` without covering another card: to the right of whatever is in the way. */
export function freeSpot(at: { x: number; y: number }, size: { width: number; height: number }, nodes: CardNode[]): { x: number; y: number } {
  const spot = { ...at };
  const cards = nodes.filter((n) => n.type !== 'group');
  for (let i = 0; i < 50; i++) {
    const hit = cards.find((n) => {
      const w = n.width ?? n.measured?.width ?? 0;
      const h = n.height ?? n.measured?.height ?? 0;
      return spot.x < n.position.x + w && spot.x + size.width > n.position.x && spot.y < n.position.y + h && spot.y + size.height > n.position.y;
    });
    if (!hit) break;
    spot.x = hit.position.x + (hit.width ?? hit.measured?.width ?? 0) + 40;
  }
  return spot;
}

export function cardId(): string {
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
