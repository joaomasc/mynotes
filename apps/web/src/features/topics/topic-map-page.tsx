import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ExternalLink, FolderInput, Link2, Minus, Network, Plus, RotateCcw, Trash, X } from 'lucide-react';
import { RELATION_KIND_LABELS, type Graph, type GraphEdge, type GraphNode, type RelationKind, type ViewLayout, type ViewLayoutData } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/form';
import { ApiError, errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { ENTITY_CSS_VAR, EntityIcon, entityLabel } from '@/lib/entities';
import { useLocalPreference } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { referencePath } from '@/lib/references';
import { chainOf } from '../mindmaps/chain';
import { RelationDialog } from '../shared/relation-dialog';
import { TopicBreadcrumb } from '../shared/topic-breadcrumb';
import { openModeOf, openPath, workspace } from '../workspace/store';
import { usePane } from '../workspace/tab-info';
import { MoveTopicDialog, TopicFormDialog } from './topic-dialogs';
import { useTopics, type TopicNode } from './use-topics';

/**
 * Mind map generated from a topic: its subtopics are the branches (the
 * official hierarchy), notes/books hang from their topic, and explicit
 * relations are drawn as conceptual links. Book annotations and reviews
 * appear once moved to a topic, tied to their book (drawn under them when the
 * book is filed elsewhere). Three things are kept apart:
 *  - hierarchy: topics.parent_id, changed only with "Mover para…";
 *  - conceptual relations: the relations table;
 *  - presentation: positions and collapsed branches in view_layouts.
 */

type MNodeData = {
  label: string;
  type: GraphNode['type'];
  root: boolean;
  childCount: number;
  collapsed: boolean;
  connectable: boolean;
  /** Outside the chain of the clicked item: faded. */
  dim: boolean;
  onToggle: () => void;
  /** Opens the item (double click). */
  onOpen: () => void;
};
type MNode = Node<MNodeData, 'mind'>;

const MindNode = memo(function MindNode({ data, selected }: NodeProps<MNode>) {
  const color = ENTITY_CSS_VAR[data.type];
  const handle = data.connectable ? '!size-2.5 !border-surface !bg-accent' : '!pointer-events-none !opacity-0';
  return (
    <div
      onDoubleClick={(e) => {
        // Handled here, and kept from zooming the map.
        e.stopPropagation();
        data.onOpen();
      }}
      className={cn(
        'flex max-w-60 items-center gap-1.5 rounded-xl border-2 bg-surface px-3 py-1.5 shadow-card transition-opacity',
        data.root ? 'text-base font-semibold' : data.type === 'topic' ? 'text-sm font-medium' : 'rounded-full border px-2.5 py-1 text-xs',
        selected && 'ring-2 ring-text',
        data.dim && 'opacity-30',
      )}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      {data.type !== 'topic' && <EntityIcon type={data.type} className="size-3.5 shrink-0" />}
      <span className="truncate">{data.label}</span>
      {data.childCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle();
          }}
          aria-label={data.collapsed ? `Expandir (${data.childCount})` : 'Recolher'}
          title={data.collapsed ? `Expandir ${data.childCount} itens` : 'Recolher ramo'}
          className="nodrag ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1 text-[11px] text-muted hover:bg-surface-3"
        >
          {data.collapsed ? data.childCount : <Minus className="size-3" />}
        </button>
      )}
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
});
const nodeTypes = { mind: MindNode };

interface Branch {
  key: string;
  node: GraphNode;
  children: Branch[];
}

/** Map node id of a book drawn under one of its annotations (the same book may hang from several). */
const bookUnder = (bookKey: string, noteKey: string) => `${bookKey}@${noteKey}`;
const isBookUnder = (id: string) => id.includes('@');

const GAP_X = 250;
const GAP_Y = 52;

/** Horizontal tree layout (root on the left). */
function treeLayout(root: Branch, collapsed: Set<string>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  const visit = (b: Branch, depth: number): number => {
    const kids = collapsed.has(b.key) ? [] : b.children;
    if (kids.length === 0) {
      const y = cursor;
      cursor += GAP_Y;
      out.set(b.key, { x: depth * GAP_X, y });
      return y;
    }
    const ys = kids.map((k) => visit(k, depth + 1));
    const y = (ys[0]! + ys[ys.length - 1]!) / 2;
    out.set(b.key, { x: depth * GAP_X, y });
    return y;
  };
  visit(root, 0);
  return out;
}

function MapView({ topic, graph, layout, showItems, showRefs }: { topic: TopicNode; graph: Graph; layout: ViewLayout | null; showItems: boolean; showRefs: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = `mindmap:topic:${topic.id}`;
  const [positions, setPositions] = useState<ViewLayoutData['positions']>(layout?.data.positions ?? {});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(layout?.data.collapsed ?? []));
  const version = useRef(layout?.version);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [pair, setPair] = useState<{ source: GraphNode; target: GraphNode } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'sub' | 'move'; topic: TopicNode } | null>(null);
  const { tree } = useTopics();

  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  /** Graph node behind a map node id (a book drawn under an annotation shares the book's node). */
  const nodeOf = useCallback((id: string) => byKey.get(id.split('@')[0]!), [byKey]);

  // Branches: subtopics (official hierarchy) and, optionally, the items of each topic.
  const root = useMemo<Branch>(() => {
    const items = new Map<string, GraphNode[]>();
    // Book of each annotation/review (reviews and page notes start without a
    // topic and only show up here once the user files them under one).
    const bookOf = new Map(graph.edges.filter((e) => e.kind === 'annotates').map((e) => [e.source, e.target]));
    if (showItems) {
      for (const n of graph.nodes) {
        if (n.type === 'topic' || !n.topicId) continue;
        items.set(n.topicId, [...(items.get(n.topicId) ?? []), n]);
      }
    }
    // Books already in this map get a dashed link instead of a copy.
    const inMap = new Set<string>();
    const collect = (t: TopicNode) => {
      for (const n of items.get(t.id) ?? []) inMap.add(n.key);
      t.children.forEach(collect);
    };
    collect(topic);
    const leaf = (n: GraphNode): Branch => {
      const book = bookOf.get(n.key);
      const bookNode = book && !inMap.has(book) ? byKey.get(book) : undefined;
      return { key: n.key, node: n, children: bookNode ? [{ key: bookUnder(bookNode.key, n.key), node: bookNode, children: [] }] : [] };
    };
    const build = (t: TopicNode): Branch => {
      const k = `topic:${t.id}`;
      const node = byKey.get(k) ?? { key: k, type: 'topic' as const, entityId: t.id, label: t.title, topicId: t.parentId, role: null };
      return {
        key: k,
        node: { ...node, label: t.title },
        children: [
          ...t.children.map(build),
          ...(items.get(t.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)).map(leaf),
        ],
      };
    };
    return build(topic);
  }, [topic, graph, byKey, showItems]);

  const visible = useMemo(() => {
    const list: { branch: Branch; parent: string | null }[] = [];
    const walk = (b: Branch, parent: string | null) => {
      list.push({ branch: b, parent });
      if (!collapsed.has(b.key)) b.children.forEach((c) => walk(c, b.key));
    };
    walk(root, null);
    return list;
  }, [root, collapsed]);
  const auto = useMemo(() => treeLayout(root, collapsed), [root, collapsed]);

  /* --------------------------------------------- presentation storage -- */
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ positions, collapsed });
  latest.current = { positions, collapsed };
  const save = useCallback(
    async (retry = true) => {
      const data: ViewLayoutData = { positions: latest.current.positions, collapsed: [...latest.current.collapsed], viewport: null };
      try {
        const saved = await endpoints.layouts.put(key, data, version.current);
        version.current = saved.version;
        qc.setQueryData(qk.layout(key), saved);
      } catch (err) {
        if (isVersionConflict(err) && retry) {
          // Changed on another device: keep ours (it is only presentation) on top of the latest version.
          const current = (err.details as { current: ViewLayout | null }).current;
          version.current = current?.version;
          await save(false);
        } else toast.error(errorMessage(err));
      }
    },
    [key, qc],
  );
  const saveSoon = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 800);
  }, [save]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const toggle = useCallback(
    (k: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
      saveSoon();
    },
    [saveSoon],
  );

  // Items open beside the map (which stays on the left); in the phone layout, in place.
  const pane = usePane();
  const open = useCallback(
    (g: GraphNode, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      const path = referencePath({ type: g.type, id: g.entityId, role: g.role, readingId: null, page: null });
      const mode = e ? openModeOf(e) : 'same';
      if (mode !== 'same') openPath(path, mode);
      else if (pane) workspace.openBeside(path, pane.paneId);
      else void navigate(path);
    },
    [navigate, pane],
  );

  const shown = useMemo(() => new Set(visible.map((v) => v.branch.key)), [visible]);
  const baseEdges = useMemo<Edge[]>(() => [
    ...visible
      .filter((v) => v.parent)
      .map((v) => ({
        id: `h|${v.parent}|${v.branch.key}`,
        source: v.parent!,
        target: v.branch.key,
        type: 'smoothstep',
        style: isBookUnder(v.branch.key)
          ? { stroke: 'var(--c-reading)', strokeWidth: 1, strokeDasharray: '4 3' }
          : { stroke: 'var(--border-strong)', strokeWidth: v.branch.node.type === 'topic' ? 2 : 1 },
      })),
    // Annotation → its book, when both are in the map.
    ...(showItems
      ? graph.edges
          .filter((e) => e.kind === 'annotates' && shown.has(e.source) && shown.has(e.target))
          .map((e) => ({
            id: e.key,
            source: e.source,
            target: e.target,
            style: { stroke: 'var(--c-reading)', strokeWidth: 1, strokeDasharray: '4 3' },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--c-reading)' },
          }))
      : []),
    ...graph.edges
      .filter((e) => (e.relationId || (showRefs && e.kind === 'links_to')) && shown.has(e.source) && shown.has(e.target))
      .map((e) => ({
        id: e.key,
        source: e.source,
        target: e.target,
        style: e.relationId
          ? { stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '6 4' }
          : { stroke: 'var(--c-note)', strokeWidth: 1, strokeDasharray: '2 3' },
        markerEnd: { type: MarkerType.ArrowClosed, color: e.relationId ? 'var(--accent)' : 'var(--c-note)' },
        ...(e.relationId
          ? {
              label: RELATION_KIND_LABELS[e.kind as RelationKind] + (e.label ? ` · ${e.label}` : ''),
              labelStyle: { fontSize: 10, fill: 'var(--text-muted)' },
              labelBgStyle: { fill: 'var(--surface)' },
            }
          : {}),
      })),
  ], [visible, showItems, showRefs, graph, shown]);

  // Clicking an item lights its chain: path to the root, branch below, relations followed link after link.
  const chain = useMemo(() => {
    if (!selected || !shown.has(selected)) return null;
    const parentOf = new Map(visible.map((v) => [v.branch.key, v.parent]));
    return chainOf(selected, (id) => parentOf.get(id), baseEdges, (e) => e.id.startsWith('h|'));
  }, [selected, shown, visible, baseEdges]);

  const edges: Edge[] = baseEdges.map((e) => {
    const picked = selectedEdge?.key === e.id;
    if (!chain) return picked ? { ...e, selected: true } : e;
    if (!chain.edges.has(e.id)) return { ...e, selected: picked, style: { ...e.style, opacity: 0.12 }, labelStyle: { ...e.labelStyle, opacity: 0.3 } };
    return {
      ...e,
      selected: picked,
      animated: !e.id.startsWith('h|'),
      zIndex: 1,
      style: { ...e.style, stroke: 'var(--accent)', strokeWidth: Math.max(2, Number(e.style?.strokeWidth ?? 1) + 1) },
    };
  });

  const [nodes, setNodes] = useState<MNode[]>([]);
  useEffect(() => {
    // Keeps each node's measured size: React Flow hides unmeasured nodes for a
    // moment, which made the second click of a double click hit the background.
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return visible.map(({ branch }) => ({
        id: branch.key,
        measured: measured.get(branch.key),
        type: 'mind',
        position: positions[branch.key] ?? auto.get(branch.key) ?? { x: 0, y: 0 },
        selected: branch.key === selected,
        data: {
          label: branch.node.label,
          type: branch.node.type,
          root: branch.key === root.key,
          childCount: branch.children.length,
          collapsed: collapsed.has(branch.key),
          connectable: connectMode,
          dim: !!chain && !chain.nodes.has(branch.key),
          onToggle: () => toggle(branch.key),
          onOpen: () => open(branch.node),
        },
      }));
    });
  }, [visible, positions, auto, selected, root.key, collapsed, connectMode, toggle, open, chain]);

  const removeRelation = useMutation({
    mutationFn: (id: string) => endpoints.relations.remove(id),
    onSuccess: () => {
      setSelectedEdge(null);
      void qc.invalidateQueries({ queryKey: ['graph'] });
      void qc.invalidateQueries({ queryKey: qk.relationsAll });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const sel = selected ? (visible.find((v) => v.branch.key === selected)?.branch.node ?? null) : null;
  const selTopic = sel?.type === 'topic' ? tree.byId.get(sel.entityId) : undefined;

  return (
    <div className="relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
        onNodeDragStop={(_e, _node, dragged) => {
          // Only the picture changes: the hierarchy stays as it is.
          setPositions((prev) => {
            const next = { ...prev };
            for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
            return next;
          });
          saveSoon();
        }}
        nodesConnectable={connectMode}
        onConnect={(c: Connection) => {
          const source = nodeOf(c.source);
          const target = nodeOf(c.target);
          if (source && target && source.key !== target.key) setPair({ source, target });
        }}
        onNodeClick={(_e, n) => {
          setSelected(n.id);
          setSelectedEdge(null);
        }}
        onEdgeClick={(_e, edge) => setSelectedEdge(graph.edges.find((x) => x.key === edge.id) ?? null)}
        onPaneClick={() => {
          setSelected(null);
          setSelectedEdge(null);
        }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.1}
      >
        <Background gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
        <Button size="sm" variant={connectMode ? 'primary' : 'outline'} icon={<Link2 className="size-3.5" />} onClick={() => setConnectMode(!connectMode)}>
          {connectMode ? 'Conectando…' : 'Relacionar'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<RotateCcw className="size-3.5" />}
          onClick={() => {
            setPositions({});
            saveSoon();
          }}
        >
          Reorganizar
        </Button>
      </div>
      {connectMode && (
        <p className="absolute top-13 left-3 rounded-lg bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card">
          Arraste da borda direita de um item até outro para criar uma relação conceitual (a hierarquia não muda).
        </p>
      )}

      <div className="absolute right-3 bottom-3 hidden rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card sm:block" aria-label="Legenda">
        <ul className="space-y-1">
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-5 bg-border-strong" aria-hidden /> Hierarquia dos assuntos
          </li>
          <li className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed border-accent" aria-hidden /> Relação conceitual
          </li>
          {showRefs && (
            <li className="flex items-center gap-2">
              <span className="w-5 border-t border-dotted border-note" aria-hidden /> Referência numa nota
            </li>
          )}
          <li className="pt-1 text-subtle">Arrastar itens só muda a disposição.</li>
        </ul>
      </div>

      {selectedEdge?.relationId && (
        <aside className="absolute top-14 right-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop">
          <p className="text-sm">
            {byKey.get(selectedEdge.source)?.label} <span className="text-muted">— {RELATION_KIND_LABELS[selectedEdge.kind as RelationKind]} →</span>{' '}
            {byKey.get(selectedEdge.target)?.label}
          </p>
          <Button className="mt-3" size="sm" variant="outline" icon={<Trash className="size-3.5" />} onClick={() => removeRelation.mutate(selectedEdge.relationId!)}>
            Remover relação
          </Button>
        </aside>
      )}

      {sel && !selectedEdge && (
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
          <div className="mt-3 flex flex-col items-start gap-2 text-sm">
            <button
              type="button"
              onClick={(e) => open(sel, e)}
              title={pane ? 'Abre ao lado, mantendo o mapa à esquerda' : undefined}
              className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
            >
              Abrir {pane && 'ao lado'} <ExternalLink className="size-3.5" aria-hidden />
            </button>
            {selTopic && (
              <>
                <button type="button" onClick={() => setDialog({ kind: 'sub', topic: selTopic })} className="inline-flex items-center gap-1.5 text-muted hover:text-accent">
                  <Plus className="size-3.5" aria-hidden /> Novo subassunto aqui
                </button>
                {selTopic.id !== topic.id && (
                  <>
                    <Link to={`/topics/${selTopic.id}/map`} className="inline-flex items-center gap-1.5 text-muted hover:text-accent">
                      <Network className="size-3.5" aria-hidden /> Focar neste ramo
                    </Link>
                    <button type="button" onClick={() => setDialog({ kind: 'move', topic: selTopic })} className="inline-flex items-center gap-1.5 text-muted hover:text-accent">
                      <FolderInput className="size-3.5" aria-hidden /> Mover na hierarquia…
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      )}

      <RelationDialog pair={pair} onClose={() => setPair(null)} />
      <TopicFormDialog open={dialog?.kind === 'sub'} onOpenChange={(o) => !o && setDialog(null)} parentId={dialog?.topic.id ?? null} />
      <MoveTopicDialog open={dialog?.kind === 'move'} onOpenChange={(o) => !o && setDialog(null)} topic={dialog?.kind === 'move' ? dialog.topic : null} />
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const { tree, isLoading: topicsLoading } = useTopics();
  const topic = tree.byId.get(id);
  const [showItems, setShowItems] = useLocalPreference('mynotes:map-items', true);
  const [showRefs, setShowRefs] = useLocalPreference('mynotes:map-refs', false);
  const query = { topicId: id, structure: 'true' };
  const graph = useQuery({ queryKey: qk.graph(query), queryFn: () => endpoints.graph(query), placeholderData: (prev) => prev });
  const key = `mindmap:topic:${id}`;
  const layout = useQuery({ queryKey: qk.layout(key), queryFn: () => endpoints.layouts.get(key), staleTime: Infinity });

  if (topicsLoading || graph.isLoading || layout.isLoading) return <PageLoader />;
  if (!topic) {
    return <EmptyState className="mt-16" title="Assunto não encontrado" action={<Link to="/" className="text-accent">Voltar ao início</Link>} />;
  }
  if ((graph.isError && !graph.data) || (layout.isError && !(layout.error instanceof ApiError && layout.error.status === 404))) {
    return <ErrorState error={graph.error ?? layout.error} onRetry={() => void graph.refetch()} />;
  }

  return (
    <div className="flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col lg:h-(--view-h)">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
        <div className="min-w-0">
          <TopicBreadcrumb topicId={topic.parentId} />
          <h1 className="flex items-center gap-2 text-[15px] font-semibold">
            <Network className="size-4 text-accent" aria-hidden /> Mapa de {topic.title}
          </h1>
        </div>
        <Checkbox checked={showItems} onChange={setShowItems} label="Notas e livros" />
        <Checkbox checked={showRefs} onChange={setShowRefs} label="Referências" />
        <Link to={`/topics/${topic.id}`} className="ml-auto text-sm text-accent hover:underline">
          Abrir assunto
        </Link>
      </div>
      {graph.data && (
        <ReactFlowProvider>
          <MapView
            key={topic.id}
            topic={topic}
            graph={graph.data}
            layout={layout.data ?? null}
            showItems={showItems}
            showRefs={showRefs}
          />
        </ReactFlowProvider>
      )}
    </div>
  );
}
