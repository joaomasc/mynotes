import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Link, useNavigate } from 'react-router';
import { ExternalLink, Search, Waypoints, X } from 'lucide-react';
import { GRAPH_ENTITY_TYPES, RELATION_KIND_LABELS, type Graph, type GraphEdge, type GraphEntityType, type GraphNode } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Checkbox, Segmented, Select } from '@/components/ui/form';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { ENTITY_CSS_VAR, EntityIcon, entityLabel, entityPath } from '@/lib/entities';
import { normalizeSearch } from '@mynotes/shared';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';

type GNodeData = { label: string; type: GraphEntityType; dim: boolean; hit: boolean; degree: number };
type GNode = Node<GNodeData, 'entity'>;

const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<GNode>) {
  const size = data.type === 'topic' ? 'text-[13px] font-semibold' : 'text-xs';
  return (
    <div
      className={cn(
        'flex max-w-52 items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 shadow-card transition-opacity',
        size,
        selected ? 'ring-2 ring-text' : '',
        data.hit && 'ring-2 ring-warning',
        data.dim && 'opacity-25',
      )}
      style={{ borderColor: ENTITY_CSS_VAR[data.type] }}
    >
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" />
      <span className="size-2 shrink-0 rounded-full" style={{ background: ENTITY_CSS_VAR[data.type] }} aria-hidden />
      <span className="truncate">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" />
    </div>
  );
});
const nodeTypes = { entity: EntityNode };

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/** Deterministic-ish force layout computed once per graph. */
function layout(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Map<string, { x: number; y: number }> {
  const nodes: SimNode[] = graph.nodes.map((n, i) => ({ id: n.key, x: Math.cos(i) * i * 6, y: Math.sin(i) * i * 6 }));
  const links: SimulationLinkDatum<SimNode>[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(nodes)
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(90).strength(0.6))
    .force('charge', forceManyBody().strength(-260))
    .force('collide', forceCollide(48))
    .force('center', forceCenter(0, 0))
    // Weak pull to the middle keeps isolated items from drifting away.
    .force('x', forceX(0).strength(0.07))
    .force('y', forceY(0).strength(0.07))
    .stop();
  const ticks = Math.min(400, 120 + nodes.length);
  for (let i = 0; i < ticks; i++) sim.tick();
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

function edgeStyle(e: GraphEdge): Partial<Edge> {
  if (e.kind === 'parent' || e.kind === 'contains') {
    return { style: { stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 4' } };
  }
  if (e.kind === 'links_to') {
    return { style: { stroke: 'var(--c-note)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--c-note)' } };
  }
  return {
    style: { stroke: 'var(--accent)', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
    label: RELATION_KIND_LABELS[e.kind as keyof typeof RELATION_KIND_LABELS] + (e.label ? ` · ${e.label}` : ''),
    labelStyle: { fontSize: 10, fill: 'var(--text-muted)' },
    labelBgStyle: { fill: 'var(--surface)' },
  };
}

function GraphView({ graph, structure }: { graph: Graph; structure: boolean }) {
  const navigate = useNavigate();
  const flow = useReactFlow();
  const [selected, setSelected] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState<'0' | '1' | '2'>('0');
  const [query, setQuery] = useState('');

  const positions = useMemo(() => layout(graph), [graph]);
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      adj.set(e.source, (adj.get(e.source) ?? new Set()).add(e.target));
      adj.set(e.target, (adj.get(e.target) ?? new Set()).add(e.source));
    }
    return adj;
  }, [graph]);

  const focusSet = useMemo(() => {
    if (!selected || focusDepth === '0') return null;
    const set = new Set([selected]);
    let frontier = [selected];
    for (let d = 0; d < Number(focusDepth); d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of adjacency.get(id) ?? []) {
          if (set.has(n)) continue;
          set.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    return set;
  }, [selected, focusDepth, adjacency]);

  const q = normalizeSearch(query);
  const hits = useMemo(() => (q.length >= 2 ? new Set(graph.nodes.filter((n) => normalizeSearch(n.label).includes(q)).map((n) => n.key)) : null), [graph, q]);

  const nodes: GNode[] = graph.nodes
    .filter((n) => !focusSet || focusSet.has(n.key))
    .map((n) => ({
      id: n.key,
      type: 'entity',
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      selected: n.key === selected,
      data: { label: n.label, type: n.type, dim: !!hits && !hits.has(n.key), hit: !!hits?.has(n.key), degree: adjacency.get(n.key)?.size ?? 0 },
    }));
  const visible = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = graph.edges
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({ id: e.key, source: e.source, target: e.target, ...edgeStyle(e) }));

  const sel = selected ? graph.nodes.find((n) => n.key === selected) : undefined;
  const neighbours = sel ? [...(adjacency.get(sel.key) ?? [])].map((k) => graph.nodes.find((n) => n.key === k)).filter((n): n is GraphNode => !!n) : [];

  return (
    <div className="relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable
        edgesFocusable={false}
        onNodeClick={(_e, n) => setSelected(n.id)}
        onNodeDoubleClick={(_e, n) => {
          const g = graph.nodes.find((x) => x.key === n.id);
          if (g) void navigate(entityPath(g.type, g.entityId));
        }}
        onPaneClick={() => setSelected(null)}
        fitView
        minZoom={0.05}
      >
        <Background gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <div className="absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits?.size) {
                const first = [...hits][0]!;
                setSelected(first);
                const p = positions.get(first);
                if (p) void flow.setCenter(p.x, p.y, { zoom: 1.2, duration: 400 });
              }
            }}
            placeholder="Localizar no grafo"
            aria-label="Localizar no grafo"
            className="h-9 w-52 rounded-lg border border-border bg-surface pr-3 pl-8 text-base shadow-card outline-none focus:border-accent sm:text-sm"
          />
        </div>
        {selected && (
          <Segmented
            label="Mostrar"
            size="sm"
            value={focusDepth}
            onChange={setFocusDepth}
            options={[
              { value: '0', label: 'Tudo' },
              { value: '1', label: 'Vizinhos' },
              { value: '2', label: '2 níveis' },
            ]}
          />
        )}
      </div>

      <div className="absolute right-3 bottom-3 hidden rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card sm:block" aria-label="Legenda">
        <p className="mb-1.5 font-medium">Legenda</p>
        <ul className="space-y-1">
          {GRAPH_ENTITY_TYPES.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: ENTITY_CSS_VAR[t] }} aria-hidden />
              {entityLabel(t)}
            </li>
          ))}
          <li className="flex items-center gap-2 pt-1">
            <span className="h-0.5 w-5 bg-accent" aria-hidden /> Relação definida
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-5 bg-note" aria-hidden /> Link interno
          </li>
          {structure && (
            <li className="flex items-center gap-2">
              <span className="w-5 border-t border-dashed border-border-strong" aria-hidden /> Hierarquia
            </li>
          )}
        </ul>
      </div>

      {sel && (
        <aside className="absolute top-14 right-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop" aria-label="Item selecionado">
          <div className="flex items-start gap-2">
            <EntityIcon type={sel.type} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">{entityLabel(sel.type)}</p>
              <p className="font-medium break-words">{sel.label}</p>
            </div>
            <IconButton label="Fechar" size="sm" onClick={() => setSelected(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <Link to={entityPath(sel.type, sel.entityId)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            Abrir <ExternalLink className="size-3.5" aria-hidden />
          </Link>
          {neighbours.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-xs text-muted">{neighbours.length} conexões</p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                {neighbours.map((n) => (
                  <li key={n.key}>
                    <button type="button" onClick={() => setSelected(n.key)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-2">
                      <EntityIcon type={n.type} className="size-3.5 shrink-0" />
                      <span className="truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

export function Component() {
  const { tree } = useTopics();
  const [types, setTypes] = useState<Set<GraphEntityType>>(new Set(GRAPH_ENTITY_TYPES));
  const [structure, setStructure] = useState(true);
  const [topicId, setTopicId] = useState('');
  const params = { types: [...types].join(','), structure: String(structure), ...(topicId ? { topicId } : {}) };
  const graph = useQuery({ queryKey: qk.graph(params), queryFn: () => endpoints.graph(params), placeholderData: (prev) => prev });

  const toggle = (t: GraphEntityType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size > 1) next.delete(t);
      } else next.add(t);
      return next;
    });

  return (
    <div className="flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col lg:h-dvh">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold">
          <Waypoints className="size-4 text-accent" aria-hidden /> Grafo de conhecimento
        </h1>
        <div className="flex flex-wrap items-center gap-x-3" role="group" aria-label="Tipos exibidos">
          {GRAPH_ENTITY_TYPES.map((t) => (
            <Checkbox
              key={t}
              checked={types.has(t)}
              onChange={() => toggle(t)}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: ENTITY_CSS_VAR[t] }} aria-hidden />
                  {entityLabel(t)}s
                </span>
              }
            />
          ))}
        </div>
        <Checkbox checked={structure} onChange={setStructure} label="Hierarquia" />
        <div className="w-52">
          <Select aria-label="Limitar a um assunto" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">Todos os assuntos</option>
            {tree.flat.map((t) => (
              <option key={t.id} value={t.id}>
                {'  '.repeat(t.depth)}
                {t.title}
              </option>
            ))}
          </Select>
        </div>
        {graph.data && (
          <span className="text-xs text-muted">
            {graph.data.nodes.length} itens · {graph.data.edges.length} ligações
            {graph.data.truncated && ' · limitado aos mais recentes; use os filtros'}
          </span>
        )}
      </div>
      {graph.isLoading ? (
        <PageLoader />
      ) : graph.isError && !graph.data ? (
        <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
      ) : !graph.data?.nodes.length ? (
        <EmptyState
          className="flex-1"
          icon={<Waypoints />}
          title="Nada para mostrar"
          description="O grafo aparece conforme você cria assuntos, notas com links internos e relações entre itens."
          action={
            <Button variant="outline" onClick={() => setTypes(new Set(GRAPH_ENTITY_TYPES))}>
              Mostrar todos os tipos
            </Button>
          }
        />
      ) : (
        <ReactFlowProvider>
          <GraphView key={JSON.stringify(params)} graph={graph.data} structure={structure} />
        </ReactFlowProvider>
      )}
    </div>
  );
}
