import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

/**
 * Knowledge graph drawn on a canvas with a live force simulation (like
 * Obsidian's): nodes keep moving into place, dragging one pulls its
 * neighbours, hovering highlights its connections, node size grows with the
 * number of links and labels fade in as you zoom. Purely presentation:
 * positions are never saved.
 */

export interface FGNode {
  key: string;
  label: string;
  /** CSS color, may be a var(): resolved when drawing. */
  color: string;
  /** Dashed outline (book reviews and annotations). */
  dashed?: boolean;
  /** Tags are drawn smaller and hollow. */
  shape?: 'tag';
  /** A root topic: its cluster gathers around it (one cluster per group of connected items). */
  root?: boolean;
}

export interface FGEdge {
  key: string;
  source: string;
  target: string;
  color: string;
  width: number;
  dash?: number[];
  arrow?: boolean;
}

export interface GraphSettings {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
  nodeSize: number;
  lineWidth: number;
  /** Zoom at which labels are fully shown. */
  textFade: number;
  arrows: boolean;
}

export const DEFAULT_FORCES: GraphSettings = {
  centerForce: 0.06,
  repelForce: 9,
  linkForce: 0.5,
  linkDistance: 80,
  nodeSize: 1,
  lineWidth: 1,
  textFade: 1,
  arrows: false,
};

export interface ForceGraphHandle {
  centerOn(key: string, zoom?: number): void;
  fit(): void;
  reheat(): void;
}

interface Props {
  nodes: FGNode[];
  edges: FGEdge[];
  settings: GraphSettings;
  selected?: string | null;
  /** Search hits: drawn with a ring, the rest faded. */
  hits?: Set<string> | null;
  /** Kept visible even when everything else is faded (e.g. the note open in a local graph). */
  focusKey?: string | null;
  connectMode?: boolean;
  compact?: boolean;
  onSelect?: (key: string | null, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => void;
  onOpen?: (key: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => void;
  onHover?: (key: string | null, rect: { left: number; top: number; right: number; bottom: number } | null) => void;
  onEdgeClick?: (key: string) => void;
  onConnect?: (source: string, target: string) => void;
  className?: string;
  ariaLabel?: string;
}

interface SimNode extends SimulationNodeDatum {
  key: string;
  degree: number;
  data: FGNode;
  /** Center of its cluster (connected component), where the centering force pulls it. */
  cx: number;
  cy: number;
  /** The node its cluster is centered on (the main root topic). */
  hub: boolean;
}
type SimLink = SimulationLinkDatum<SimNode> & { data: FGEdge };

const MIN_ZOOM = 0.04;
const MAX_ZOOM = 8;

/** Resolves var(--x) colors against the current theme (cached until the theme changes). */
function makeColorResolver() {
  const cache = new Map<string, string>();
  const style = () => getComputedStyle(document.documentElement);
  return {
    get(color: string): string {
      const hit = cache.get(color);
      if (hit) return hit;
      const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
      const value = m ? style().getPropertyValue(m[1]!).trim() || '#888' : color;
      cache.set(color, value);
      return value;
    },
    clear: () => cache.clear(),
  };
}

const radiusOf = (n: SimNode, size: number) => (n.data.shape === 'tag' ? 2.5 : 3.5 + Math.sqrt(n.degree) * 2.1) * size;

interface Cluster {
  keys: string[];
  hub: string;
  x: number;
  y: number;
}

/**
 * Splits the graph into clusters of connected items (like Obsidian: groups
 * with no link between them float apart) and gives each one a center: the
 * biggest in the middle, the others packed around it, lone items in a ring
 * outside. Each cluster is centered on its root topic with the most links.
 */
function layoutClusters(nodes: FGNode[], neighbours: Map<string, Set<string>>, linkDistance: number): { clusters: Cluster[]; byKey: Map<string, Cluster> } {
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.key)) continue;
    const keys = [n.key];
    seen.add(n.key);
    for (let i = 0; i < keys.length; i++) {
      for (const m of neighbours.get(keys[i]!) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        keys.push(m);
      }
    }
    groups.push(keys);
  }
  const data = new Map(nodes.map((n) => [n.key, n]));
  const degree = (k: string) => neighbours.get(k)?.size ?? 0;
  const rootCount = (keys: string[]) => keys.filter((k) => data.get(k)?.root).length;
  const hubOf = (keys: string[]) => {
    const roots = keys.filter((k) => data.get(k)?.root);
    return (roots.length ? roots : keys).reduce((a, b) => (degree(b) > degree(a) ? b : a));
  };
  // Biggest first; with a root topic before loose ones of the same size.
  groups.sort((a, b) => b.length - a.length || rootCount(b) - rootCount(a));

  const scale = linkDistance / 80;
  const radius = (size: number) => 24 + 36 * Math.sqrt(size) * scale;
  const gap = 30 + 70 * scale;
  const clusters: Cluster[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  const singles: string[][] = [];
  for (const keys of groups) {
    if (keys.length === 1 && placed.length > 0) {
      singles.push(keys);
      continue;
    }
    const r = radius(keys.length);
    let at = { x: 0, y: 0 };
    if (placed.length) {
      // Walks a spiral out from the middle until the cluster fits.
      for (let t = 0; ; t += 0.35) {
        const d = placed[0]!.r + r + gap + t * 14;
        const c = { x: Math.cos(t * 2.4) * d, y: Math.sin(t * 2.4) * d };
        if (placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= p.r + r + gap)) {
          at = c;
          break;
        }
      }
    }
    placed.push({ ...at, r });
    clusters.push({ keys, hub: hubOf(keys), ...at });
  }
  if (singles.length) {
    // Lone items: a ring around everything else (Obsidian's orphans).
    const outer = Math.max(...placed.map((p) => Math.hypot(p.x, p.y) + p.r)) + gap;
    singles.forEach((keys, i) => {
      const a = (i / singles.length) * Math.PI * 2;
      const ring = outer + (i % 3) * 22;
      clusters.push({ keys, hub: keys[0]!, x: Math.cos(a) * ring, y: Math.sin(a) * ring });
    });
  }
  const byKey = new Map<string, Cluster>();
  for (const c of clusters) for (const k of c.keys) byKey.set(k, c);
  return { clusters, byKey };
}

/** Pulls each node to its cluster's center; the root topic it is centered on is held there firmly. */
function applyCentering(sim: Simulation<SimNode, SimLink>, strength: number) {
  const of = (n: SimNode) => (n.hub && n.degree > 0 ? Math.max(0.35, strength * 4) : strength);
  (sim.force('x') as ReturnType<typeof forceX<SimNode>>).x((n) => n.cx).strength(of);
  (sim.force('y') as ReturnType<typeof forceY<SimNode>>).y((n) => n.cy).strength(of);
}

export const ForceGraph = forwardRef<ForceGraphHandle, Props>(function ForceGraph(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Everything below lives outside React state: the canvas is redrawn on animation frames.
  const engine = useRef<{
    sim: Simulation<SimNode, SimLink>;
    nodes: Map<string, SimNode>;
    links: SimLink[];
    neighbours: Map<string, Set<string>>;
    view: { x: number; y: number; k: number };
    hover: string | null;
    /** 0..1: fades the rest of the graph when hovering. */
    hoverFade: number;
    dirty: boolean;
    frame: number;
    colors: ReturnType<typeof makeColorResolver>;
    connecting: { from: string; x: number; y: number } | null;
    fitted: boolean;
    /** The main cluster, framed when the graph opens. */
    main: Cluster | null;
    width: number;
    height: number;
  } | null>(null);

  const requestDraw = () => {
    const e = engine.current;
    if (!e) return;
    e.dirty = true;
    if (!e.frame) e.frame = requestAnimationFrame(draw);
  };

  const toWorld = (sx: number, sy: number) => {
    const { view } = engine.current!;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };

  const nodeAt = (sx: number, sy: number): SimNode | null => {
    const e = engine.current!;
    const { x, y } = toWorld(sx, sy);
    const size = propsRef.current.settings.nodeSize;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of e.nodes.values()) {
      const dx = (n.x ?? 0) - x;
      const dy = (n.y ?? 0) - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const r = radiusOf(n, size) + 4 / e.view.k;
      if (d <= r && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const edgeAt = (sx: number, sy: number): SimLink | null => {
    const e = engine.current!;
    const p = toWorld(sx, sy);
    const tol = 5 / e.view.k;
    for (const l of e.links) {
      const a = l.source as SimNode;
      const b = l.target as SimNode;
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const dx = (b.x ?? 0) - ax;
      const dy = (b.y ?? 0) - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
      const cx = ax + t * dx - p.x;
      const cy = ay + t * dy - p.y;
      if (cx * cx + cy * cy <= tol * tol) return l;
    }
    return null;
  };

  function draw() {
    const e = engine.current;
    const canvas = canvasRef.current;
    if (!e || !canvas) return;
    e.frame = 0;
    const p = propsRef.current;
    const s = p.settings;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { x, y, k } = e.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);

    // Hover fades in and out smoothly.
    const target = e.hover ? 1 : 0;
    if (Math.abs(e.hoverFade - target) > 0.01) {
      e.hoverFade += (target - e.hoverFade) * 0.25;
      e.dirty = true;
    } else e.hoverFade = target;

    const focus = e.hover ?? (p.compact ? null : (p.selected ?? null));
    const near = focus ? (e.neighbours.get(focus) ?? new Set<string>()) : null;
    const fade = e.hover ? e.hoverFade : focus ? 1 : 0;
    const hits = p.hits;
    const isLit = (key: string) => !focus || key === focus || !!near?.has(key);
    const text = e.colors.get('var(--text)');
    const muted = e.colors.get('var(--text-muted)');
    const accent = e.colors.get('var(--accent)');
    const warning = e.colors.get('var(--warning)');
    const bg = e.colors.get('var(--bg)');

    // Edges.
    for (const l of e.links) {
      const a = l.source as SimNode;
      const b = l.target as SimNode;
      const lit = focus && (a.key === focus || b.key === focus);
      const dim = hits ? !(hits.has(a.key) || hits.has(b.key)) : false;
      ctx.globalAlpha = lit ? 1 : dim ? 0.08 : 0.55 - 0.42 * fade;
      ctx.strokeStyle = lit ? accent : e.colors.get(l.data.color);
      ctx.lineWidth = Math.max(l.data.width * s.lineWidth * (lit ? 1.6 : 1), 0.7 / k);
      ctx.setLineDash(l.data.dash ? l.data.dash.map((d) => d / Math.max(k, 0.4)) : []);
      ctx.beginPath();
      ctx.moveTo(a.x ?? 0, a.y ?? 0);
      ctx.lineTo(b.x ?? 0, b.y ?? 0);
      ctx.stroke();
      if ((s.arrows || l.data.arrow) && k > 0.25) {
        const ang = Math.atan2((b.y ?? 0) - (a.y ?? 0), (b.x ?? 0) - (a.x ?? 0));
        const r = radiusOf(b, s.nodeSize) + 1.5;
        const tx = (b.x ?? 0) - Math.cos(ang) * r;
        const ty = (b.y ?? 0) - Math.sin(ang) * r;
        const size = Math.max(4, 5 * s.lineWidth);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(ang - 0.45) * size, ty - Math.sin(ang - 0.45) * size);
        ctx.lineTo(tx - Math.cos(ang + 0.45) * size, ty - Math.sin(ang + 0.45) * size);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // Line being drawn in connect mode.
    if (e.connecting) {
      const from = e.nodes.get(e.connecting.from);
      if (from) {
        const to = toWorld(e.connecting.x, e.connecting.y);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([6 / k, 4 / k]);
        ctx.beginPath();
        ctx.moveTo(from.x ?? 0, from.y ?? 0);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Nodes.
    for (const n of e.nodes.values()) {
      const r = radiusOf(n, s.nodeSize);
      const lit = isLit(n.key);
      const dim = hits ? !hits.has(n.key) : false;
      ctx.globalAlpha = dim ? 0.15 : lit ? 1 : 1 - 0.8 * fade;
      const color = e.colors.get(n.data.color);
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      if (n.data.shape === 'tag') {
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 1.5 / Math.max(k, 0.5);
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        if (n.data.dashed) {
          ctx.lineWidth = 1.2 / Math.max(k, 0.5);
          ctx.strokeStyle = bg;
          ctx.setLineDash([2, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (n.key === p.selected || n.key === p.focusKey || hits?.has(n.key)) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = hits?.has(n.key) ? warning : n.key === p.selected ? text : accent;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, r + 3 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels: fade in with zoom; always shown for the hovered node and its neighbours.
    const base = Math.max(0, Math.min(1, (k - s.textFade * 0.55) / (s.textFade * 0.45)));
    const fontPx = Math.max(10, Math.min(13, 11.5 * Math.sqrt(k)));
    ctx.font = `${fontPx / k}px Inter Variable, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of e.nodes.values()) {
      const lit = isLit(n.key);
      const always = (focus && lit) || n.key === p.selected || n.key === p.focusKey || hits?.has(n.key);
      let alpha = always ? 1 : base * (lit ? 1 : 1 - 0.85 * fade);
      if (hits && !hits.has(n.key)) alpha *= 0.3;
      if (alpha < 0.03) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = n.key === focus || n.key === p.selected ? text : muted;
      const label = n.data.shape === 'tag' ? n.data.label : n.data.label.length > 42 ? `${n.data.label.slice(0, 40)}…` : n.data.label;
      ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + radiusOf(n, s.nodeSize) + 3 / k);
    }
    ctx.globalAlpha = 1;

    // The simulation's ticks schedule frames while it moves; the hover fade needs its own.
    e.dirty = false;
    if (e.hoverFade !== target) e.frame = requestAnimationFrame(draw);
  }

  /** Frames the whole graph, or one cluster centered on its root topic. */
  const fit = (animate = false, only?: Cluster | null) => {
    const e = engine.current;
    if (!e || e.nodes.size === 0) return;
    const list = only ? only.keys.map((k) => e.nodes.get(k)).filter((n): n is SimNode => !!n) : [...e.nodes.values()];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of list) {
      minX = Math.min(minX, n.x ?? 0);
      minY = Math.min(minY, n.y ?? 0);
      maxX = Math.max(maxX, n.x ?? 0);
      maxY = Math.max(maxY, n.y ?? 0);
    }
    const hub = only ? e.nodes.get(only.hub) : undefined;
    const cx = hub ? (hub.x ?? 0) : (minX + maxX) / 2;
    const cy = hub ? (hub.y ?? 0) : (minY + maxY) / 2;
    const w = hub ? 2 * Math.max(cx - minX, maxX - cx) : maxX - minX;
    const h = hub ? 2 * Math.max(cy - minY, maxY - cy) : maxY - minY;
    const pad = propsRef.current.compact ? 30 : 60;
    const k = Math.max(MIN_ZOOM, Math.min(propsRef.current.compact ? 1.6 : 1.4, Math.min((e.width - pad * 2) / (w || 1), (e.height - pad * 2) / (h || 1))));
    animateView({ k, x: e.width / 2 - cx * k, y: e.height / 2 - cy * k }, animate ? 350 : 0);
  };

  const animateView = (target: { x: number; y: number; k: number }, ms: number) => {
    const e = engine.current!;
    if (ms <= 0) {
      e.view = target;
      requestDraw();
      return;
    }
    const from = { ...e.view };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const ease = 1 - Math.pow(1 - t, 3);
      e.view = { x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease, k: from.k + (target.k - from.k) * ease };
      requestDraw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  useImperativeHandle(ref, () => ({
    centerOn(key, zoom) {
      const e = engine.current;
      const n = e?.nodes.get(key);
      if (!e || !n) return;
      const k = zoom ?? Math.max(e.view.k, 1.2);
      animateView({ k, x: e.width / 2 - (n.x ?? 0) * k, y: e.height / 2 - (n.y ?? 0) * k }, 400);
    },
    fit: () => fit(true),
    reheat() {
      const e = engine.current;
      if (!e) return;
      for (const n of e.nodes.values()) {
        n.x = n.cx + (Math.random() - 0.5) * 300;
        n.y = n.cy + (Math.random() - 0.5) * 300;
      }
      e.sim.alpha(1).restart();
      e.fitted = false;
    },
  }));

  // Set up once: simulation, sizing, theme changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const sim = forceSimulation<SimNode, SimLink>([])
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.key))
      .force('charge', forceManyBody<SimNode>().distanceMax(900))
      .force('collide', forceCollide<SimNode>((n) => radiusOf(n, propsRef.current.settings.nodeSize) + 2))
      .force('x', forceX<SimNode>((n) => n.cx))
      .force('y', forceY<SimNode>((n) => n.cy))
      .alphaDecay(0.025)
      .velocityDecay(0.35);
    engine.current = {
      sim,
      nodes: new Map(),
      links: [],
      neighbours: new Map(),
      view: { x: 0, y: 0, k: 1 },
      hover: null,
      hoverFade: 0,
      dirty: false,
      frame: 0,
      colors: makeColorResolver(),
      connecting: null,
      fitted: false,
      main: null,
      width: 0,
      height: 0,
    };
    sim.on('tick', () => {
      const e = engine.current!;
      // Once the first layout has settled a little, frame the main cluster centered on its root topic.
      if (!e.fitted && sim.alpha() < 0.35 && e.width > 0) {
        e.fitted = true;
        fit(true, e.main);
      }
      requestDraw();
    });

    const resize = () => {
      const e = engine.current!;
      const rect = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = e.width === 0;
      e.width = rect.width;
      e.height = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (first) e.view = { x: rect.width / 2, y: rect.height / 2, k: 1 };
      requestDraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    resize();

    const themeObserver = new MutationObserver(() => {
      engine.current?.colors.clear();
      requestDraw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      sim.stop();
      const e = engine.current;
      if (e?.frame) cancelAnimationFrame(e.frame);
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  // Data: keep positions of nodes that stay; new nodes start next to a neighbour.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const prev = e.nodes;
    const next = new Map<string, SimNode>();
    const neighbours = new Map<string, Set<string>>();
    for (const n of props.nodes) neighbours.set(n.key, new Set());
    const edges = props.edges.filter((l) => neighbours.has(l.source) && neighbours.has(l.target) && l.source !== l.target);
    for (const l of edges) {
      neighbours.get(l.source)!.add(l.target);
      neighbours.get(l.target)!.add(l.source);
    }
    const { clusters, byKey } = layoutClusters(props.nodes, neighbours, propsRef.current.settings.linkDistance);
    for (const n of props.nodes) {
      const c = byKey.get(n.key)!;
      const old = prev.get(n.key);
      if (old) {
        old.data = n;
        old.degree = neighbours.get(n.key)!.size;
        old.cx = c.x;
        old.cy = c.y;
        old.hub = c.hub === n.key;
        next.set(n.key, old);
        continue;
      }
      const anchor = [...neighbours.get(n.key)!].map((k) => prev.get(k) ?? next.get(k)).find(Boolean);
      const angle = Math.random() * Math.PI * 2;
      const dist = anchor ? 30 : c.keys.length === 1 ? 0 : 20 + Math.random() * 120;
      next.set(n.key, {
        key: n.key,
        data: n,
        degree: neighbours.get(n.key)!.size,
        cx: c.x,
        cy: c.y,
        hub: c.hub === n.key,
        x: (anchor?.x ?? c.x) + Math.cos(angle) * dist,
        y: (anchor?.y ?? c.y) + Math.sin(angle) * dist,
      });
    }
    const links: SimLink[] = edges.map((l) => ({ source: l.source, target: l.target, data: l }));
    e.nodes = next;
    e.neighbours = neighbours;
    e.main = clusters[0] ?? null;
    e.sim.nodes([...next.values()]);
    (e.sim.force('link') as ForceLink<SimNode, SimLink>).links(links);
    applyCentering(e.sim, propsRef.current.settings.centerForce);
    e.links = links;
    if (e.hover && !next.has(e.hover)) e.hover = null;
    const fresh = prev.size === 0;
    if (fresh) {
      // A first layout before showing it (no explosion from the center on large graphs).
      e.sim.alpha(1);
      const ticks = Math.min(220, 60 + next.size / 2);
      for (let i = 0; i < ticks; i++) e.sim.tick();
      e.sim.alpha(0.4).restart();
    } else {
      e.sim.alpha(Math.max(e.sim.alpha(), 0.3)).restart();
    }
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestDraw is stable in practice
  }, [props.nodes, props.edges]);

  // Forces.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const s = props.settings;
    (e.sim.force('charge') as ReturnType<typeof forceManyBody<SimNode>>).strength(-s.repelForce * 28);
    (e.sim.force('link') as ForceLink<SimNode, SimLink>).distance(s.linkDistance).strength(s.linkForce);
    applyCentering(e.sim, s.centerForce);
    (e.sim.force('collide') as ReturnType<typeof forceCollide<SimNode>>).radius((n) => radiusOf(n, s.nodeSize) + 2);
    e.sim.alpha(Math.max(e.sim.alpha(), 0.3)).restart();
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settings]);

  // Selection, hits, theme-dependent props: just redraw.
  useEffect(() => {
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected, props.hits, props.focusKey, props.connectMode]);

  // Pointer interaction: drag nodes, pan, zoom (wheel and pinch), hover, click, connect.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: { kind: 'none' } | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean } | { kind: 'drag'; node: SimNode; moved: boolean; sx: number; sy: number } | { kind: 'pinch'; dist: number; k: number; cx: number; cy: number; vx: number; vy: number } | { kind: 'connect'; from: SimNode } = { kind: 'none' };
    let lastClick = { key: '', at: 0 };

    const local = (ev: PointerEvent | WheelEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const mods = (ev: PointerEvent | MouseEvent) => ({ ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, shiftKey: ev.shiftKey, altKey: ev.altKey });

    const setHover = (n: SimNode | null) => {
      const e = engine.current!;
      const key = n?.key ?? null;
      if (e.hover === key) return;
      e.hover = key;
      canvas.style.cursor = n ? 'pointer' : '';
      requestDraw();
      if (n) {
        const r = canvas.getBoundingClientRect();
        const sx = r.left + e.view.x + (n.x ?? 0) * e.view.k;
        const sy = r.top + e.view.y + (n.y ?? 0) * e.view.k;
        const rad = radiusOf(n, propsRef.current.settings.nodeSize) * e.view.k;
        propsRef.current.onHover?.(key, { left: sx - rad, right: sx + rad, top: sy - rad, bottom: sy + rad });
      } else propsRef.current.onHover?.(null, null);
    };

    const onDown = (ev: PointerEvent) => {
      const e = engine.current!;
      canvas.setPointerCapture(ev.pointerId);
      const p = local(ev);
      pointers.set(ev.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        mode = { kind: 'pinch', dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: e.view.k, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2, vx: e.view.x, vy: e.view.y };
        return;
      }
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const n = nodeAt(p.x, p.y);
      if (n && propsRef.current.connectMode) {
        mode = { kind: 'connect', from: n };
        e.connecting = { from: n.key, x: p.x, y: p.y };
        return;
      }
      if (n) {
        mode = { kind: 'drag', node: n, moved: false, sx: p.x, sy: p.y };
        return;
      }
      mode = { kind: 'pan', sx: p.x, sy: p.y, vx: e.view.x, vy: e.view.y, moved: false };
    };

    const onMove = (ev: PointerEvent) => {
      const e = engine.current;
      if (!e) return;
      const p = local(ev);
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
      switch (mode.kind) {
        case 'pinch': {
          if (pointers.size < 2) return;
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (mode.k * dist) / (mode.dist || 1)));
          const wx = (mode.cx - mode.vx) / mode.k;
          const wy = (mode.cy - mode.vy) / mode.k;
          e.view = { k, x: mode.cx - wx * k, y: mode.cy - wy * k };
          requestDraw();
          return;
        }
        case 'drag': {
          if (!mode.moved && Math.hypot(p.x - mode.sx, p.y - mode.sy) < 3) return;
          if (!mode.moved) {
            mode.moved = true;
            e.sim.alphaTarget(0.25).restart();
            propsRef.current.onHover?.(null, null);
          }
          const w = toWorld(p.x, p.y);
          mode.node.fx = w.x;
          mode.node.fy = w.y;
          requestDraw();
          return;
        }
        case 'pan': {
          if (!mode.moved && Math.hypot(p.x - mode.sx, p.y - mode.sy) < 3) return;
          mode.moved = true;
          e.view = { ...e.view, x: mode.vx + p.x - mode.sx, y: mode.vy + p.y - mode.sy };
          requestDraw();
          return;
        }
        case 'connect': {
          e.connecting = { from: mode.from.key, x: p.x, y: p.y };
          setHover(nodeAt(p.x, p.y));
          requestDraw();
          return;
        }
        default:
          if (ev.pointerType === 'mouse') setHover(nodeAt(p.x, p.y));
      }
    };

    const onUp = (ev: PointerEvent) => {
      const e = engine.current;
      pointers.delete(ev.pointerId);
      if (!e) return;
      const p = local(ev);
      const m = mode;
      mode = { kind: 'none' };
      if (m.kind === 'pinch') return;
      if (m.kind === 'connect') {
        e.connecting = null;
        const target = nodeAt(p.x, p.y);
        if (target && target.key !== m.from.key) propsRef.current.onConnect?.(m.from.key, target.key);
        requestDraw();
        return;
      }
      if (m.kind === 'drag') {
        // Released nodes go back to the simulation (like Obsidian), with a little momentum.
        m.node.fx = null;
        m.node.fy = null;
        e.sim.alphaTarget(0);
        if (m.moved) return;
        const now = performance.now();
        if (lastClick.key === m.node.key && now - lastClick.at < 350) {
          lastClick = { key: '', at: 0 };
          propsRef.current.onOpen?.(m.node.key, mods(ev));
          return;
        }
        lastClick = { key: m.node.key, at: now };
        propsRef.current.onSelect?.(m.node.key, mods(ev));
        return;
      }
      if (m.kind === 'pan' && !m.moved) {
        const edge = edgeAt(p.x, p.y);
        if (edge) propsRef.current.onEdgeClick?.(edge.data.key);
        else propsRef.current.onSelect?.(null, mods(ev));
      }
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const e = engine.current;
      if (!e) return;
      const p = local(ev);
      const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018));
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, e.view.k * factor));
      const wx = (p.x - e.view.x) / e.view.k;
      const wy = (p.y - e.view.y) / e.view.k;
      e.view = { k, x: p.x - wx * k, y: p.y - wy * k };
      requestDraw();
    };

    const onLeave = () => {
      if (mode.kind === 'none') setHover(null);
    };

    const onKey = (ev: KeyboardEvent) => {
      const e = engine.current;
      if (!e) return;
      const zoomBy = (f: number) => {
        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, e.view.k * f));
        const cx = e.width / 2;
        const cy = e.height / 2;
        animateView({ k, x: cx - ((cx - e.view.x) / e.view.k) * k, y: cy - ((cy - e.view.y) / e.view.k) * k }, 150);
      };
      if (ev.key === '+' || ev.key === '=') zoomBy(1.25);
      else if (ev.key === '-') zoomBy(0.8);
      else if (ev.key === '0') fit(true);
      else if (ev.key.startsWith('Arrow')) {
        const d = 60;
        const dx = ev.key === 'ArrowLeft' ? d : ev.key === 'ArrowRight' ? -d : 0;
        const dy = ev.key === 'ArrowUp' ? d : ev.key === 'ArrowDown' ? -d : 0;
        animateView({ ...e.view, x: e.view.x + dx, y: e.view.y + dy }, 120);
      } else return;
      ev.preventDefault();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest props through refs
  }, []);

  return (
    <div className={props.className ?? 'absolute inset-0'}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={props.ariaLabel ?? 'Grafo: arraste para mover, role para aproximar, + e − para zoom, 0 para enquadrar'}
        className="block touch-none outline-none"
      />
    </div>
  );
});
