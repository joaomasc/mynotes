import { memo, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, ExternalLink, Expand, Link2, RotateCcw, Search, Trash, Waypoints, X } from 'lucide-react';
import {
  GRAPH_ENTITY_TYPES,
  RELATION_KIND_LABELS,
  normalizeSearch,
  type Graph,
  type GraphEdge,
  type GraphEntityType,
  type GraphNode,
  type RelationKind,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Checkbox, Segmented, Select } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { ENTITY_CSS_VAR, EntityIcon, entityLabel } from '@/lib/entities';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { RelationDialog } from '../shared/relation-dialog';
import { useTopics } from '../topics/use-topics';

type GNodeData = { label: string; type: GraphEntityType; reading: boolean; dim: boolean; hit: boolean; connectable: boolean };
type GNode = Node<GNodeData, 'entity'>;

/** Reviews and page annotations are notes, drawn with the color of books. */
const colorOf = (n: { type: GraphEntityType; reading: boolean }) => ENTITY_CSS_VAR[n.reading ? 'reading' : n.type];

const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<GNode>) {
  const size = data.type === 'topic' ? 'text-[13px] font-semibold' : 'text-xs';
  const handle = data.connectable ? '!size-2.5 !border-surface !bg-accent' : '!pointer-events-none !opacity-0';
  return (
    <div
      className={cn(
        'flex max-w-52 items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 shadow-card transition-opacity',
        size,
        data.reading && 'border-dashed',
        selected ? 'ring-2 ring-text' : '',
        data.hit && 'ring-2 ring-warning',
        data.dim && 'opacity-25',
      )}
      style={{ borderColor: colorOf(data) }}
    >
      <Handle type="target" position={Position.Top} className={handle} />
      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(data) }} aria-hidden />
      <span className="truncate">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className={handle} />
    </div>
  );
});
const nodeTypes = { entity: EntityNode };

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/** Force layout computed once per set of nodes (presentation only). */
function layout(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Map<string, { x: number; y: number }> {
  const nodes: SimNode[] = graph.nodes.map((n, i) => ({ id: n.key, x: Math.cos(i) * i * 6, y: Math.sin(i) * i * 6 }));
  const ids = new Set(nodes.map((n) => n.id));
  const links: SimulationLinkDatum<SimNode>[] = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
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

const EDGE_LABELS: Partial<Record<GraphEdge['kind'], string>> = {
  parent: 'subassunto',
  contains: 'contém',
  links_to: 'cita',
  annotates: 'anota',
};
const edgeLabel = (e: GraphEdge) => EDGE_LABELS[e.kind] ?? RELATION_KIND_LABELS[e.kind as RelationKind] + (e.label ? ` · ${e.label}` : '');

function edgeStyle(e: GraphEdge): Partial<Edge> {
  if (e.kind === 'parent' || e.kind === 'contains') {
    return { style: { stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 4' } };
  }
  if (e.kind === 'annotates') return { style: { stroke: 'var(--c-reading)', strokeWidth: 1, strokeDasharray: '2 3' } };
  if (e.kind === 'links_to') {
    return { style: { stroke: 'var(--c-note)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--c-note)' } };
  }
  return {
    style: { stroke: 'var(--accent)', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
    label: edgeLabel(e),
    labelStyle: { fontSize: 10, fill: 'var(--text-muted)' },
    labelBgStyle: { fill: 'var(--surface)' },
  };
}

function GraphView({ graph, structure, focus, hidden }: { graph: Graph; structure: boolean; focus: string | null; hidden: Set<GraphEntityType> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const flow = useReactFlow();
  const [selected, setSelected] = useState<string | null>(focus);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  // Local view: neighbourhood of these roots (expanded progressively).
  const [roots, setRoots] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const [depth, setDepth] = useState<'0' | '1' | '2'>(focus ? '1' : '0');
  const [query, setQuery] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [pair, setPair] = useState<{ source: GraphNode; target: GraphNode } | null>(null);
  const [layoutSeed, setLayoutSeed] = useState(0);

  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const visibleGraph = useMemo(() => {
    const nodes = graph.nodes.filter((n) => !hidden.has(n.type));
    const keys = new Set(nodes.map((n) => n.key));
    const edges = graph.edges.filter((e) => keys.has(e.source) && keys.has(e.target) && (structure || (e.kind !== 'parent' && e.kind !== 'contains')));
    return { nodes, edges };
  }, [graph, hidden, structure]);
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of visibleGraph.edges) {
      adj.set(e.source, (adj.get(e.source) ?? new Set()).add(e.target));
      adj.set(e.target, (adj.get(e.target) ?? new Set()).add(e.source));
    }
    return adj;
  }, [visibleGraph]);

  const focusSet = useMemo(() => {
    const starts = roots.size ? [...roots] : selected ? [selected] : [];
    if (depth === '0' || starts.length === 0) return null;
    const set = new Set(starts);
    let frontier = starts;
    for (let d = 0; d < Number(depth); d++) {
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
  }, [roots, selected, depth, adjacency]);

  const shownNodes = useMemo(() => visibleGraph.nodes.filter((n) => !focusSet || focusSet.has(n.key)), [visibleGraph, focusSet]);
  // Layout of what is shown; recomputed on demand ("Reorganizar"). Dragging only moves nodes on screen.
  const positions = useMemo(
    () => layout({ nodes: shownNodes, edges: visibleGraph.edges }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutSeed forces a new layout
    [shownNodes, visibleGraph.edges, layoutSeed],
  );

  const q = normalizeSearch(query);
  const hits = useMemo(() => (q.length >= 2 ? new Set(shownNodes.filter((n) => normalizeSearch(n.label).includes(q)).map((n) => n.key)) : null), [shownNodes, q]);

  const [nodes, setNodes] = useState<GNode[]>([]);
  useEffect(() => {
    setNodes(
      shownNodes.map((n) => ({
        id: n.key,
        type: 'entity',
        position: positions.get(n.key) ?? { x: 0, y: 0 },
        selected: n.key === selected,
        data: {
          label: n.label,
          type: n.type,
          reading: n.type === 'note' && !!n.role && n.role !== 'note',
          dim: !!hits && !hits.has(n.key),
          hit: !!hits?.has(n.key),
          connectable: connectMode,
        },
      })),
    );
  }, [shownNodes, positions, selected, hits, connectMode]);
  const shownKeys = new Set(shownNodes.map((n) => n.key));
  const edges: Edge[] = visibleGraph.edges
    .filter((e) => shownKeys.has(e.source) && shownKeys.has(e.target))
    .map((e) => ({ id: e.key, source: e.source, target: e.target, selected: selectedEdge?.key === e.key, ...edgeStyle(e) }));

  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => void flow.fitView({ duration: 300, padding: 0.3, maxZoom: 1.1 }), 50);
    return () => clearTimeout(t);
  }, [focus, flow]);

  const sel = selected ? byKey.get(selected) : undefined;
  const outgoing = sel ? visibleGraph.edges.filter((e) => e.source === sel.key) : [];
  const incoming = sel ? visibleGraph.edges.filter((e) => e.target === sel.key) : [];

  const removeRelation = useMutation({
    mutationFn: (id: string) => endpoints.relations.remove(id),
    onSuccess: () => {
      setSelectedEdge(null);
      void qc.invalidateQueries({ queryKey: ['graph'] });
      void qc.invalidateQueries({ queryKey: qk.relationsAll });
      toast.success('Relação removida');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const open = (n: GraphNode) => void navigate(referencePath({ type: n.type, id: n.entityId, role: n.role, readingId: null, page: null }));

  const connection = (e: GraphEdge, other: string, dir: 'in' | 'out') => {
    const n = byKey.get(other);
    if (!n) return null;
    return (
      <li key={`${dir}${e.key}`}>
        <button type="button" onClick={() => setSelected(n.key)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-2">
          <EntityIcon type={n.type} className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{n.label}</span>
          <span className="shrink-0 text-[11px] text-subtle">{edgeLabel(e)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        // Moving nodes only changes the picture: positions are not saved and never touch data.
        onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
        nodesConnectable={connectMode}
        onConnect={(c: Connection) => {
          const source = byKey.get(c.source);
          const target = byKey.get(c.target);
          if (source && target && source.key !== target.key) setPair({ source, target });
        }}
        nodesDraggable
        onNodeClick={(_e, n) => {
          setSelected(n.id);
          setSelectedEdge(null);
        }}
        onNodeDoubleClick={(_e, n) => {
          const g = byKey.get(n.id);
          if (g) open(g);
        }}
        onEdgeClick={(_e, edge) => {
          const g = visibleGraph.edges.find((x) => x.key === edge.id);
          setSelectedEdge(g ?? null);
        }}
        onPaneClick={() => {
          setSelected(null);
          setSelectedEdge(null);
        }}
        fitView
        fitViewOptions={{ maxZoom: 1.1 }}
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
                const p = nodes.find((n) => n.id === first)?.position;
                if (p) void flow.setCenter(p.x, p.y, { zoom: 1.2, duration: 400 });
              }
            }}
            placeholder="Localizar no grafo"
            aria-label="Localizar no grafo"
            className="h-9 w-48 rounded-lg border border-border bg-surface pr-3 pl-8 text-base shadow-card outline-none focus:border-accent sm:text-sm"
          />
        </div>
        {(selected || roots.size > 0) && (
          <Segmented
            label="Mostrar"
            size="sm"
            value={depth}
            onChange={setDepth}
            options={[
              { value: '0', label: 'Tudo' },
              { value: '1', label: 'Vizinhos' },
              { value: '2', label: '2 níveis' },
            ]}
          />
        )}
        <Button
          size="sm"
          variant={connectMode ? 'primary' : 'outline'}
          icon={<Link2 className="size-3.5" />}
          onClick={() => setConnectMode(!connectMode)}
          title="Arraste do ponto inferior de um item até outro para criar uma relação"
        >
          {connectMode ? 'Conectando…' : 'Conectar'}
        </Button>
        <IconButton label="Reorganizar disposição" size="sm" variant="outline" onClick={() => setLayoutSeed((s) => s + 1)}>
          <RotateCcw className="size-4" />
        </IconButton>
      </div>
      {connectMode && (
        <p className="absolute top-14 left-3 rounded-lg bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card">
          Arraste do ponto inferior de um item até outro item para relacioná-los.
        </p>
      )}

      <div className="absolute right-3 bottom-3 hidden rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card sm:block" aria-label="Legenda">
        <p className="mb-1.5 font-medium">Legenda</p>
        <ul className="space-y-1">
          {GRAPH_ENTITY_TYPES.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: ENTITY_CSS_VAR[t] }} aria-hidden />
              {t === 'reading' ? 'Livro / leitura / anotação' : entityLabel(t)}
            </li>
          ))}
          <li className="flex items-center gap-2 pt-1">
            <span className="h-0.5 w-5 bg-accent" aria-hidden /> Relação definida
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-5 bg-note" aria-hidden /> Referência numa nota
          </li>
          {structure && (
            <li className="flex items-center gap-2">
              <span className="w-5 border-t border-dashed border-border-strong" aria-hidden /> Hierarquia
            </li>
          )}
        </ul>
      </div>

      {selectedEdge && (
        <aside className="absolute top-14 right-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop" aria-label="Ligação selecionada">
          <p className="text-xs text-subtle">{selectedEdge.relationId ? 'Relação definida' : 'Ligação derivada dos dados'}</p>
          <p className="mt-1 text-sm">
            {byKey.get(selectedEdge.source)?.label} <span className="text-muted">— {edgeLabel(selectedEdge)} →</span> {byKey.get(selectedEdge.target)?.label}
          </p>
          {selectedEdge.relationId ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              icon={<Trash className="size-3.5" />}
              loading={removeRelation.isPending}
              onClick={() => removeRelation.mutate(selectedEdge.relationId!)}
            >
              Remover relação
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Vem da hierarquia, de uma referência escrita numa nota ou de uma anotação de livro. Altere-a no próprio conteúdo.
            </p>
          )}
        </aside>
      )}

      {sel && !selectedEdge && (
        <aside className="absolute top-14 right-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop" aria-label="Item selecionado">
          <div className="flex items-start gap-2">
            <EntityIcon type={sel.type} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">{sel.role === 'annotation' ? 'Anotação de leitura' : sel.role === 'review' ? 'Resenha' : entityLabel(sel.type)}</p>
              <p className="font-medium break-words">{sel.label}</p>
            </div>
            <IconButton label="Fechar" size="sm" onClick={() => setSelected(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <button type="button" onClick={() => open(sel)} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              Abrir <ExternalLink className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setRoots((r) => new Set([...r, sel.key]));
                if (depth === '0') setDepth('1');
              }}
              className="inline-flex items-center gap-1.5 text-muted hover:text-accent"
            >
              <Expand className="size-3.5" aria-hidden /> Expandir vizinhos
            </button>
          </div>
          <div className="scrollbar-thin mt-3 max-h-64 space-y-3 overflow-y-auto border-t border-border pt-3">
            {outgoing.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs text-muted">
                  <ArrowRight className="size-3" aria-hidden /> Saídas ({outgoing.length})
                </p>
                <ul className="space-y-0.5">{outgoing.map((e) => connection(e, e.target, 'out'))}</ul>
              </div>
            )}
            {incoming.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs text-muted">
                  <ArrowLeft className="size-3" aria-hidden /> Entradas ({incoming.length})
                </p>
                <ul className="space-y-0.5">{incoming.map((e) => connection(e, e.source, 'in'))}</ul>
              </div>
            )}
            {outgoing.length + incoming.length === 0 && <p className="text-xs text-muted">Sem conexões visíveis com os filtros atuais.</p>}
          </div>
        </aside>
      )}
      <RelationDialog pair={pair} onClose={() => setPair(null)} />
    </div>
  );
}

/** Above this size the graph opens in an overview (topics and books). */
const OVERVIEW_LIMIT = 200;

export function Component() {
  const { tree } = useTopics();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const [hidden, setHidden] = useState<Set<GraphEntityType> | null>(null);
  const [structure, setStructure] = useState(true);
  const [topicId, setTopicId] = useState('');
  const query = { structure: 'true', ...(topicId ? { topicId } : {}) };
  const graph = useQuery({ queryKey: qk.graph(query), queryFn: () => endpoints.graph(query), placeholderData: (prev) => prev });

  // Default: everything when focused or small; an overview of topics and books when large.
  const overview = !focus && (graph.data?.nodes.length ?? 0) > OVERVIEW_LIMIT;
  const effectiveHidden = hidden ?? new Set<GraphEntityType>(overview ? ['note', 'document', 'concept'] : []);
  const toggle = (t: GraphEntityType) => {
    const next = new Set(effectiveHidden);
    if (next.has(t)) next.delete(t);
    else if (next.size < GRAPH_ENTITY_TYPES.length - 1) next.add(t);
    setHidden(next);
  };
  const hiddenCount = graph.data?.nodes.filter((n) => effectiveHidden.has(n.type)).length ?? 0;

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
              checked={!effectiveHidden.has(t)}
              onChange={() => toggle(t)}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: ENTITY_CSS_VAR[t] }} aria-hidden />
                  {t === 'reading' ? 'Livros' : `${entityLabel(t)}s`}
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
                {'  '.repeat(t.depth)}
                {t.title}
              </option>
            ))}
          </Select>
        </div>
        {graph.data && (
          <span className="text-xs text-muted">
            {graph.data.nodes.length - hiddenCount} itens
            {hiddenCount > 0 && ` (${hiddenCount} ocultos pelos filtros)`}
            {graph.data.truncated && ' · limitado aos mais recentes; filtre por assunto'}
          </span>
        )}
        {focus && (
          <Link to="/graph" className="text-xs text-accent hover:underline">
            Ver o grafo inteiro
          </Link>
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
          description="O grafo é gerado dos seus dados: hierarquia de assuntos, referências escritas com / nas notas, livros e anotações, e relações."
        />
      ) : (
        <ReactFlowProvider>
          <GraphView
            key={`${topicId}|${focus ?? ''}`}
            graph={graph.data}
            structure={structure}
            focus={focus && graph.data.nodes.some((n) => n.key === focus) ? focus : null}
            hidden={effectiveHidden}
          />
        </ReactFlowProvider>
      )}
    </div>
  );
}
