import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  BoxSelect,
  Check,
  Download,
  Ellipsis,
  FolderInput,
  Globe,
  Maximize,
  Minus,
  Palette,
  Pencil,
  RefreshCw,
  SquarePlus,
  StickyNote,
  Trash,
  TriangleAlert,
  Type,
} from 'lucide-react';
import { analyzeDoc, type GraphEntityType, type MindMap, type SearchResult } from '@mynotes/shared';
import { stripBase } from '@/app/routes';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Menu } from '@/components/ui/menu';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon, TOPIC_COLORS } from '@/lib/entities';
import { useBeforeUnloadGuard } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { loadReference } from '@/lib/references';
import { EntityPicker } from '../shared/entity-picker';
import { FavoriteButton } from '../shared/favorite-button';
import { TopicChip } from '../shared/topic-breadcrumb';
import { TopicSelect } from '../topics/topic-dialogs';
import { pathTarget } from '../workspace/tab-info';
import {
  cardId,
  cardsInside,
  defaultSize,
  freeSpot,
  fromCanvasFlow,
  styledEdge,
  textDoc,
  toCanvasFlow,
  type Arrow,
  type CanvasEdge,
  type CardKind,
  type CardNode,
} from './canvas-model';
import { CanvasContext, cardTypes } from './canvas-nodes';

type Status = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
const ITEM_TYPES = ['note', 'topic', 'reading', 'document', 'concept'] as const;
const ARROWS: { value: Arrow; label: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'Sem seta', icon: <Minus /> },
  { value: 'end', label: 'Seta no fim', icon: <ArrowRight /> },
  { value: 'both', label: 'Nas duas pontas', icon: <ArrowLeftRight /> },
];

/** The note a canvas belongs to, as a link in the header. */
function NoteChip({ noteId }: { noteId: string }) {
  const qc = useQueryClient();
  const title = qc.getQueryData<{ title: string }>(qk.note(noteId))?.title;
  return (
    <Link to={`/notes/${noteId}`} className="inline-flex max-w-48 items-center gap-1 truncate rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted hover:text-accent">
      <EntityIcon type="note" className="size-3 shrink-0 text-note" />
      <span className="truncate">{title || 'Nota'}</span>
    </Link>
  );
}

/** JSON Canvas (jsoncanvas.org), the format of Obsidian's .canvas files. */
function toJsonCanvas(nodes: CardNode[], edges: CanvasEdge[]) {
  const colorOf = (c: string | null) => c ?? undefined;
  return {
    nodes: nodes.map((n) => {
      const base = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), width: Math.round(n.width ?? 200), height: Math.round(n.height ?? 100), color: colorOf(n.data.color) };
      if (n.type === 'group') return { ...base, type: 'group', label: n.data.label };
      if (n.type === 'link') return { ...base, type: 'link', url: n.data.url ?? '' };
      if (n.type === 'item') return { ...base, type: 'text', text: `[[${n.data.ref?.title ?? n.data.label}]]` };
      return { ...base, type: 'text', text: n.data.doc ? analyzeDoc(structuredClone(n.data.doc)).text.trim() : '' };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      fromNode: e.source,
      fromSide: e.sourceHandle ?? undefined,
      toNode: e.target,
      toSide: e.targetHandle ?? undefined,
      fromEnd: e.data?.arrow === 'both' ? 'arrow' : 'none',
      toEnd: e.data?.arrow === 'none' ? 'none' : 'arrow',
      label: typeof e.label === 'string' && e.label ? e.label : undefined,
      color: colorOf(e.data?.color ?? null),
    })),
  };
}

export function CanvasEditor({ map }: { map: MindMap }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const flow = useReactFlow<CardNode, CanvasEdge>();
  const area = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => toCanvasFlow(map.data), [map.data]);
  const [nodes, setNodes] = useState<CardNode[]>(initial.nodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [title, setTitle] = useState(map.title);
  const [owner, setOwner] = useState({ topicId: map.topicId, noteId: map.noteId });
  const [status, setStatus] = useState<Status>('saved');
  const statusRef = useRef<Status>('saved');
  statusRef.current = status;
  const [dialog, setDialog] = useState<'item' | 'rename' | 'owner' | 'edge' | null>(null);
  const [ownerDraft, setOwnerDraft] = useState(owner);
  const version = useRef(map.version);
  const dirty = useRef(false);
  const viewport = useRef<Viewport | null>(map.data.viewport);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ nodes, edges, title, owner });
  latest.current = { nodes, edges, title, owner };
  useBeforeUnloadGuard(status === 'pending' || status === 'saving');

  const save = useCallback(
    async (force = false) => {
      clearTimeout(timer.current);
      if (!dirty.current && !force) return;
      dirty.current = false;
      setStatus('saving');
      try {
        const { nodes: n, edges: e, title: t, owner: o } = latest.current;
        const saved = await endpoints.mindMaps.update(map.id, {
          baseVersion: version.current,
          title: t.trim() || 'Canvas sem título',
          topicId: o.topicId,
          noteId: o.noteId,
          data: fromCanvasFlow(n, e, viewport.current),
        });
        version.current = saved.version;
        setStatus(dirty.current ? 'pending' : 'saved');
        void qc.invalidateQueries({ queryKey: qk.mindMaps });
      } catch (err) {
        dirty.current = true;
        if (isVersionConflict(err)) setStatus('conflict');
        else {
          setStatus('error');
          toast.error(errorMessage(err));
        }
      }
    },
    [map.id, qc],
  );

  const touch = useCallback(() => {
    dirty.current = true;
    setStatus((s) => (s === 'conflict' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (statusRef.current !== 'conflict') void save();
    }, 1500);
  }, [save]);

  // Flush when leaving the page.
  useEffect(() => () => void (dirty.current && save()), [save]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      const saves = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace' || (c.type === 'position' && c.dragging === false) || (c.type === 'dimensions' && c.resizing === false),
      );
      if (saves) touch();
    },
    [touch],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== 'select')) touch();
    },
    [touch],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) => addEdge({ ...c, id: `e-${cardId()}`, data: { color: null, arrow: 'end' as Arrow } }, es));
      touch();
    },
    [touch],
  );

  /* Groups carry the cards inside them, as in Obsidian. */
  const carried = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> }[]>([]);
  const onNodeDragStart = useCallback((_e: unknown, _node: CardNode, dragged: CardNode[]) => {
    const draggedIds = new Set(dragged.map((n) => n.id));
    const all = latest.current.nodes;
    carried.current = dragged
      .filter((n) => n.type === 'group')
      .map((g) => ({
        id: g.id,
        start: { ...g.position },
        members: new Map(cardsInside(g, all).filter((m) => !draggedIds.has(m.id)).map((m) => [m.id, { ...m.position }])),
      }));
  }, []);
  const onNodeDrag = useCallback((_e: unknown, _node: CardNode, dragged: CardNode[]) => {
    if (carried.current.length === 0) return;
    const at = new Map(dragged.map((n) => [n.id, n.position]));
    const moved = new Map<string, { x: number; y: number }>();
    for (const g of carried.current) {
      const p = at.get(g.id);
      if (!p) continue;
      for (const [id, s] of g.members) moved.set(id, { x: s.x + p.x - g.start.x, y: s.y + p.y - g.start.y });
    }
    setNodes((ns) => ns.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)));
  }, []);
  const onNodeDragStop = useCallback(() => {
    carried.current = [];
  }, []);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const oneEdge = selectedEdges.length === 1 && selectedNodes.length === 0 ? selectedEdges[0]! : null;
  const shownEdges = useMemo(() => edges.map(styledEdge), [edges]);

  /** Center of the visible canvas, in canvas coordinates. */
  const viewCenter = () => {
    const r = area.current?.getBoundingClientRect();
    return flow.screenToFlowPosition(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  };

  const addCard = (kind: CardKind, data: Partial<CardNode['data']> = {}, at?: { x: number; y: number }) => {
    const size = defaultSize(kind, data.ref?.type);
    const center = at ?? viewCenter();
    // Dropped or double-clicked: exactly there. From the toolbar: in the middle of the view, beside what is already there.
    const position = at ?? (kind === 'group' ? { x: center.x - size.width / 2, y: center.y - size.height / 2 } : freeSpot({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size, nodes));
    const node: CardNode = {
      id: cardId(),
      type: kind,
      position,
      ...size,
      selected: true,
      ...(kind === 'group' ? { zIndex: -1 } : {}),
      data: { label: '', color: null, ref: null, ...data },
    };
    setNodes((ns) => {
      const rest = ns.map((n) => (n.selected ? { ...n, selected: false } : n));
      return kind === 'group' ? [node, ...rest] : [...rest, node];
    });
    touch();
    return node;
  };

  const addItem = (ref: { type: GraphEntityType; id: string; title: string }, at?: { x: number; y: number }) =>
    addCard('item', { ref, label: ref.title }, at);

  /** A group around the selected cards, or an empty one in the middle of the view. */
  const addGroup = () => {
    const inside = selectedNodes.filter((n) => n.type !== 'group');
    if (inside.length === 0) return addCard('group', { label: 'Grupo', editing: true });
    const pad = 40;
    const xs = inside.map((n) => n.position.x);
    const ys = inside.map((n) => n.position.y);
    const x2 = inside.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 0));
    const y2 = inside.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 0));
    const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...x2) - Math.min(...xs) + pad * 2, height: Math.max(...y2) - Math.min(...ys) + pad * 2 };
    const node: CardNode = { id: cardId(), type: 'group', position: { x: box.x, y: box.y }, width: box.width, height: box.height, zIndex: -1, selected: true, data: { label: 'Grupo', color: null, ref: null, editing: true } };
    setNodes((ns) => [node, ...ns.map((n) => (n.selected ? { ...n, selected: false } : n))]);
    touch();
  };

  const updateSelection = (patch: { color: string | null }) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, data: { arrow: e.data?.arrow ?? 'end', ...e.data, ...patch } } : e)));
    touch();
  };

  const updateEdge = (id: string, patch: { label?: string; arrow?: Arrow }) => {
    setEdges((es) =>
      es.map((e) =>
        e.id === id
          ? { ...e, ...(patch.label !== undefined ? { label: patch.label || undefined } : {}), data: { color: e.data?.color ?? null, arrow: patch.arrow ?? e.data?.arrow ?? 'end' } }
          : e,
      ),
    );
    touch();
  };

  const removeSelected = () => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
    touch();
  };

  // Links dragged from the sidebar, a list, a topic card or another tab become cards where they are dropped.
  const onDrop = async (e: React.DragEvent) => {
    const uri = e.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim();
    if (!uri) return;
    e.preventDefault();
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    let url: URL;
    try {
      url = new URL(uri, window.location.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) {
      if (/^https?:$/.test(url.protocol)) addCard('link', { url: url.href }, at);
      return;
    }
    const target = pathTarget(stripBase(url.pathname) + url.search).entity;
    if (!target || !(ITEM_TYPES as readonly string[]).includes(target.type)) return;
    try {
      const ref = await loadReference(target.type as GraphEntityType, target.id);
      addItem({ type: ref.type, id: ref.id, title: ref.title }, at);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Pasting on the canvas: a web address becomes a link card; other text, a text card.
  const onPaste = (e: React.ClipboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, [contenteditable="true"]')) return;
    const text = e.clipboardData.getData('text/plain').trim();
    if (!text) return;
    e.preventDefault();
    if (/^https?:\/\/\S+$/i.test(text)) addCard('link', { url: text });
    else addCard('text', { doc: textDoc(text) });
  };

  // Double-click on the empty canvas: a new text card, ready to type (as in Obsidian).
  const onDoubleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (!el.closest('.react-flow__pane') || el.closest('.react-flow__node, .react-flow__edge')) return;
    addCard('text', { editing: true }, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const exportCanvas = () => {
    const blob = new Blob([JSON.stringify(toJsonCanvas(nodes, edges), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\p{L}\p{N}\- ]/gu, '').trim() || 'canvas'}.canvas`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resolveConflict = async (choice: 'mine' | 'server') => {
    const server = await endpoints.mindMaps.get(map.id);
    if (choice === 'server') {
      const f = toCanvasFlow(server.data);
      setNodes(f.nodes);
      setEdges(f.edges);
      setTitle(server.title);
      setOwner({ topicId: server.topicId, noteId: server.noteId });
      version.current = server.version;
      dirty.current = false;
      setStatus('saved');
    } else {
      version.current = server.version;
      await save(true);
    }
  };

  const backTo = owner.noteId ? `/notes/${owner.noteId}` : owner.topicId ? `/topics/${owner.topicId}` : '/canvas';

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este canvas?', description: 'Os cartões são apagados; as notas e assuntos citados continuam onde estão.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      dirty.current = false;
      await endpoints.mindMaps.remove(map.id);
      void qc.invalidateQueries({ queryKey: qk.mindMaps });
      void navigate(backTo);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save(true);
    }
  };

  const statusView = {
    saved: { icon: <Check className="size-3.5" />, label: 'Salvo', tone: 'text-muted' },
    pending: { icon: <RefreshCw className="size-3.5" />, label: 'Alterações pendentes', tone: 'text-muted' },
    saving: { icon: <RefreshCw className="size-3.5 animate-spin" />, label: 'Salvando…', tone: 'text-muted' },
    error: { icon: <TriangleAlert className="size-3.5" />, label: 'Erro ao salvar', tone: 'text-danger' },
    conflict: { icon: <TriangleAlert className="size-3.5" />, label: 'Conflito', tone: 'text-danger' },
  }[status];

  return (
    <CanvasContext.Provider value={{ topicId: owner.topicId }}>
      <div className="flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col lg:h-(--view-h)" onKeyDown={onKeyDown}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <Link to={backTo} aria-label="Voltar" className="rounded-lg p-1.5 text-muted hover:bg-surface-2">
            <ArrowLeft className="size-4" />
          </Link>
          <button type="button" onClick={() => setDialog('rename')} className="min-w-0 truncate text-[15px] font-semibold hover:text-accent" title="Renomear">
            {title}
          </button>
          {owner.noteId ? <NoteChip noteId={owner.noteId} /> : owner.topicId ? <TopicChip topicId={owner.topicId} /> : null}
          <span role="status" className={cn('inline-flex items-center gap-1 text-xs', statusView.tone)}>
            {statusView.icon}
            <span className="hidden sm:inline">{statusView.label}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="secondary" icon={<Type className="size-4" />} onClick={() => addCard('text', { editing: true })} title="Cartão de texto (ou duplo clique no fundo)">
              <span className="hidden sm:inline">Texto</span>
            </Button>
            <Button size="sm" variant="secondary" icon={<StickyNote className="size-4" />} onClick={() => setDialog('item')} title="Nota, assunto, livro ou documento (ou arraste um link para cá)">
              <span className="hidden sm:inline">Nota/assunto</span>
            </Button>
            <IconButton label="Link da web (ou cole um endereço no canvas)" size="sm" onClick={() => addCard('link', { editing: true })}>
              <Globe className="size-4" />
            </IconButton>
            <IconButton label={selectedNodes.length ? 'Agrupar os cartões selecionados' : 'Novo grupo'} size="sm" onClick={addGroup}>
              <BoxSelect className="size-4" />
            </IconButton>
            {oneEdge && (
              <>
                <Menu
                  label="Pontas da ligação"
                  trigger={
                    <IconButton label="Setas da ligação" size="sm">
                      <ArrowRight className="size-4" />
                    </IconButton>
                  }
                  items={ARROWS.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => updateEdge(oneEdge.id, { arrow: a.value }) }))}
                />
                <IconButton label="Rótulo da ligação" size="sm" onClick={() => setDialog('edge')}>
                  <Pencil className="size-4" />
                </IconButton>
              </>
            )}
            <Menu
              label="Cor"
              trigger={
                <IconButton label="Cor" size="sm" disabled={selectedNodes.length === 0 && selectedEdges.length === 0}>
                  <Palette className="size-4" />
                </IconButton>
              }
              items={[{ label: 'Sem cor', onSelect: () => updateSelection({ color: null }) }, ...TOPIC_COLORS.map((c) => ({ label: c, icon: <span className="size-3 rounded-full" style={{ background: c }} />, onSelect: () => updateSelection({ color: c }) }))]}
            />
            <IconButton label="Excluir selecionados (Delete)" size="sm" disabled={selectedNodes.length === 0 && selectedEdges.length === 0} onClick={removeSelected}>
              <Trash className="size-4" />
            </IconButton>
            <FavoriteButton type="mindmap" id={map.id} />
            <Menu
              label="Mais ações"
              trigger={
                <IconButton label="Mais ações" size="sm">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                { label: 'Ajustar à tela', icon: <Maximize />, onSelect: () => void flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1 }) },
                { label: 'Renomear', icon: <Pencil />, onSelect: () => setDialog('rename') },
                {
                  label: 'Mover para assunto ou nota…',
                  icon: <FolderInput />,
                  onSelect: () => {
                    setOwnerDraft(owner);
                    setDialog('owner');
                  },
                },
                { label: 'Exportar para o Obsidian (.canvas)', icon: <Download />, onSelect: exportCanvas },
                'separator',
                { label: 'Excluir canvas', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
          </div>
        </div>
        {status === 'conflict' && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm">
            <TriangleAlert className="size-4 text-danger" aria-hidden />
            <span className="flex-1">Este canvas foi alterado em outro dispositivo.</span>
            <Button size="sm" variant="primary" onClick={() => void resolveConflict('mine')}>
              Manter o meu
            </Button>
            <Button size="sm" variant="outline" onClick={() => void resolveConflict('server')}>
              Carregar o do servidor
            </Button>
          </div>
        )}
        <div
          ref={area}
          tabIndex={-1}
          className="relative min-h-0 flex-1 outline-none"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('text/uri-list')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'link';
            }
          }}
          onDrop={(e) => void onDrop(e)}
          onPaste={onPaste}
          onDoubleClick={onDoubleClick}
        >
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={cardTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onEdgeDoubleClick={(_e, edge) => {
              setEdges((es) => es.map((x) => ({ ...x, selected: x.id === edge.id })));
              setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
              setDialog('edge');
            }}
            onMoveEnd={(_e, vp) => {
              viewport.current = vp;
            }}
            defaultViewport={map.data.viewport ?? undefined}
            fitView={!map.data.viewport && nodes.length > 0}
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={['Delete', 'Backspace']}
            zoomOnDoubleClick={false}
            elevateNodesOnSelect={false}
            connectionRadius={30}
            minZoom={0.1}
            maxZoom={3}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable className="!hidden md:!block" nodeColor={(n) => ((n.data as CardNode['data']).color ?? 'var(--border-strong)')} />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <SquarePlus className="size-8 text-subtle" aria-hidden />
              <p className="text-sm text-muted">Canvas vazio — dê um duplo clique para escrever,</p>
              <p className="text-sm text-muted">ou traga notas e assuntos pelo botão “Nota/assunto” ou arrastando da barra lateral.</p>
            </div>
          )}
          <p className="pointer-events-none absolute right-3 bottom-3 hidden text-[11px] text-subtle lg:block">
            Duplo clique no fundo cria texto · duplo clique num cartão edita · arraste das bordas para ligar · cole links aqui
          </p>
        </div>

        <Dialog open={dialog === 'item'} onOpenChange={(o) => !o && setDialog(null)} title="Adicionar ao canvas" description="Notas mostram o texto (duplo clique para editar ali mesmo); assuntos mostram subassuntos e notas.">
          <EntityPicker
            types={[...ITEM_TYPES]}
            onPick={(item: SearchResult) => {
              addItem({ type: item.type as GraphEntityType, id: item.id, title: item.title });
              setDialog(null);
            }}
          />
        </Dialog>
        <Dialog
          open={dialog === 'rename'}
          onOpenChange={(o) => !o && setDialog(null)}
          title="Renomear canvas"
          size="sm"
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setDialog(null);
                touch();
              }}
            >
              Salvar
            </Button>
          }
        >
          <Field label="Título">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />}</Field>
        </Dialog>
        <Dialog
          open={dialog === 'owner'}
          onOpenChange={(o) => !o && setDialog(null)}
          title="Onde fica este canvas"
          description="Ele aparece na página do assunto ou da nota escolhida."
          size="sm"
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setOwner(ownerDraft);
                latest.current.owner = ownerDraft;
                setDialog(null);
                touch();
              }}
            >
              Salvar
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="Assunto" optional>
              {(p) => <TopicSelect {...p} value={ownerDraft.topicId} onChange={(topicId) => setOwnerDraft({ ...ownerDraft, topicId })} emptyLabel="Sem assunto" />}
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Nota</p>
              {ownerDraft.noteId ? (
                <div className="flex items-center gap-2">
                  <NoteChip noteId={ownerDraft.noteId} />
                  <Button size="sm" variant="ghost" onClick={() => setOwnerDraft({ ...ownerDraft, noteId: null })}>
                    Remover
                  </Button>
                </div>
              ) : (
                <EntityPicker types={['note']} autoFocus={false} placeholder="Buscar nota…" onPick={(item) => setOwnerDraft({ ...ownerDraft, noteId: item.id })} />
              )}
            </div>
          </div>
        </Dialog>
        <Dialog open={dialog === 'edge' && !!oneEdge} onOpenChange={(o) => !o && setDialog(null)} title="Ligação" size="sm" footer={<Button variant="primary" onClick={() => setDialog(null)}>Pronto</Button>}>
          {oneEdge && (
            <div className="space-y-4">
              <Field label="Rótulo" optional>
                {(p) => <Input {...p} defaultValue={typeof oneEdge.label === 'string' ? oneEdge.label : ''} maxLength={200} autoFocus onChange={(e) => updateEdge(oneEdge.id, { label: e.target.value })} placeholder="Ex.: causa, leva a, contradiz…" />}
              </Field>
              <div className="flex gap-2">
                {ARROWS.map((a) => (
                  <Button key={a.value} size="sm" variant={(oneEdge.data?.arrow ?? 'end') === a.value ? 'primary' : 'outline'} icon={a.icon} onClick={() => updateEdge(oneEdge.id, { arrow: a.value })}>
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </CanvasContext.Provider>
  );
}
