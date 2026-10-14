import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Check, Download, Ellipsis, GitBranch, Link2, Palette, Pencil, Plus, RefreshCw, Trash, TriangleAlert, Unlink, Wand } from 'lucide-react';
import type { GraphEntityType, MindMap, SearchResult } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Menu } from '@/components/ui/menu';
import { ApiError, errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { TOPIC_COLORS } from '@/lib/entities';
import { useBeforeUnloadGuard } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { EntityPicker } from '../shared/entity-picker';
import { FavoriteButton } from '../shared/favorite-button';
import { useRecordView } from '../shared/use-view';
import { fromFlow, shortId, toFlow, treeLayout } from './convert';
import { MindNode, type MindFlowNode } from './mind-node';

const nodeTypes = { mind: MindNode };
type Status = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

function Editor({ map }: { map: MindMap }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const flow = useReactFlow<MindFlowNode, Edge>();
  const initial = useMemo(() => toFlow(map.data), [map.data]);
  const [nodes, setNodes] = useState<MindFlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [status, setStatus] = useState<Status>('saved');
  const statusRef = useRef<Status>('saved');
  statusRef.current = status;
  const [title, setTitle] = useState(map.title);
  const [dialog, setDialog] = useState<'link' | 'rename' | null>(null);
  const version = useRef(map.version);
  const dirty = useRef(false);
  const viewport = useRef<Viewport | null>(map.data.viewport);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ nodes, edges, title });
  latest.current = { nodes, edges, title };
  useBeforeUnloadGuard(status === 'pending' || status === 'saving');

  const save = useCallback(
    async (force = false) => {
      clearTimeout(timer.current);
      if (!dirty.current && !force) return;
      dirty.current = false;
      setStatus('saving');
      try {
        const { nodes: n, edges: e, title: t } = latest.current;
        const saved = await endpoints.mindMaps.update(map.id, {
          baseVersion: version.current,
          title: t.trim() || 'Mapa sem título',
          data: fromFlow(n, e, viewport.current),
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
    (changes: NodeChange<MindFlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace' || (c.type === 'position' && c.dragging === false))) touch();
    },
    [touch],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== 'select')) touch();
    },
    [touch],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) => addEdge({ ...c, id: `e-${shortId()}` }, es));
      touch();
    },
    [touch],
  );

  const selected = nodes.filter((n) => n.selected);
  const one = selected.length === 1 ? selected[0]! : null;

  const addNode = (parent: MindFlowNode | null, asSibling = false) => {
    const base = asSibling && parent?.data.parentId ? nodes.find((n) => n.id === parent.data.parentId) ?? null : parent;
    const id = `n-${shortId()}`;
    const siblings = base ? nodes.filter((n) => n.data.parentId === base.id).length : 0;
    const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const position = base ? { x: base.position.x + 260, y: base.position.y + siblings * 76 - 38 } : center;
    const node: MindFlowNode = {
      id,
      type: 'mind',
      position,
      selected: true,
      data: { label: 'Nova ideia', color: null, ref: null, parentId: base?.id ?? null, editing: true },
    };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    if (base) setEdges((es) => [...es, { id: `e-${shortId()}`, source: base.id, target: id }]);
    touch();
  };

  const updateSelected = (patch: Partial<MindFlowNode['data']>) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)));
    touch();
  };

  const removeSelected = () => {
    const ids = new Set(selected.map((n) => n.id));
    if (ids.size === 0) return;
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)).map((n) => (n.data.parentId && ids.has(n.data.parentId) ? { ...n, data: { ...n.data, parentId: null } } : n)));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    touch();
  };

  const layout = () => {
    setNodes((ns) => treeLayout(ns));
    touch();
    setTimeout(() => void flow.fitView({ padding: 0.2, duration: 300 }), 50);
  };

  const exportJson = () => {
    const data = fromFlow(nodes, edges, viewport.current);
    const blob = new Blob([JSON.stringify({ format: 'mynotes-mindmap', version: 1, title, data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\p{L}\p{N}\- ]/gu, '').trim() || 'mapa'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resolveConflict = async (choice: 'mine' | 'server') => {
    const server = await endpoints.mindMaps.get(map.id);
    if (choice === 'server') {
      const f = toFlow(server.data);
      setNodes(f.nodes);
      setEdges(f.edges);
      setTitle(server.title);
      version.current = server.version;
      dirty.current = false;
      setStatus('saved');
    } else {
      version.current = server.version;
      await save(true);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este mapa?', description: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      dirty.current = false;
      await endpoints.mindMaps.remove(map.id);
      void qc.invalidateQueries({ queryKey: qk.mindMaps });
      void navigate('/maps');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Tab' && one) {
      e.preventDefault();
      addNode(one);
    } else if (e.key === 'Enter' && one) {
      e.preventDefault();
      addNode(one, true);
    } else if (e.key === 'F2' && one) {
      e.preventDefault();
      setNodes((ns) => ns.map((n) => (n.id === one.id ? { ...n, data: { ...n.data, editing: true } } : n)));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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
    <div className="flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col lg:h-dvh" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link to="/maps" aria-label="Voltar aos mapas" className="rounded-lg p-1.5 text-muted hover:bg-surface-2">
          <ArrowLeft className="size-4" />
        </Link>
        <button type="button" onClick={() => setDialog('rename')} className="min-w-0 truncate text-[15px] font-semibold hover:text-accent" title="Renomear">
          {title}
        </button>
        <span role="status" className={cn('inline-flex items-center gap-1 text-xs', statusView.tone)}>
          {statusView.icon}
          <span className="hidden sm:inline">{statusView.label}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => addNode(one)} title="Adicionar (Tab: filho, Enter: irmão)">
            <span className="hidden sm:inline">{one ? 'Filho' : 'Nó'}</span>
          </Button>
          <IconButton label="Editar texto (F2)" size="sm" disabled={!one} onClick={() => one && setNodes((ns) => ns.map((n) => (n.id === one.id ? { ...n, data: { ...n.data, editing: true } } : n)))}>
            <Pencil className="size-4" />
          </IconButton>
          <Menu
            label="Cor do nó"
            trigger={
              <IconButton label="Cor" size="sm" disabled={selected.length === 0}>
                <Palette className="size-4" />
              </IconButton>
            }
            items={[{ label: 'Sem cor', onSelect: () => updateSelected({ color: null }) }, ...TOPIC_COLORS.map((c) => ({ label: c, icon: <span className="size-3 rounded-full" style={{ background: c }} />, onSelect: () => updateSelected({ color: c }) }))]}
          />
          <IconButton label={one?.data.ref ? 'Remover vínculo' : 'Vincular a nota, assunto…'} size="sm" disabled={!one} onClick={() => (one?.data.ref ? updateSelected({ ref: null }) : setDialog('link'))}>
            {one?.data.ref ? <Unlink className="size-4" /> : <Link2 className="size-4" />}
          </IconButton>
          <IconButton label="Excluir selecionados (Delete)" size="sm" disabled={selected.length === 0} onClick={removeSelected}>
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
              { label: 'Organizar automaticamente', icon: <Wand />, onSelect: layout },
              { label: 'Exportar JSON', icon: <Download />, onSelect: exportJson },
              { label: 'Renomear', icon: <Pencil />, onSelect: () => setDialog('rename') },
              'separator',
              { label: 'Excluir mapa', icon: <Trash />, danger: true, onSelect: () => void remove() },
            ]}
          />
        </div>
      </div>
      {status === 'conflict' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm">
          <TriangleAlert className="size-4 text-danger" aria-hidden />
          <span className="flex-1">Este mapa foi alterado em outro dispositivo.</span>
          <Button size="sm" variant="primary" onClick={() => void resolveConflict('mine')}>
            Manter o meu
          </Button>
          <Button size="sm" variant="outline" onClick={() => void resolveConflict('server')}>
            Carregar o do servidor
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onMoveEnd={(_e, vp) => {
            viewport.current = vp;
          }}
          defaultViewport={map.data.viewport ?? undefined}
          fitView={!map.data.viewport}
          deleteKeyCode={['Delete', 'Backspace']}
          connectionRadius={30}
          defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
          minZoom={0.1}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable className="!hidden md:!block" nodeColor={(n) => ((n.data as MindFlowNode['data']).color ?? 'var(--border-strong)')} />
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted">Mapa vazio — use “Nó” para começar.</p>
          </div>
        )}
        <p className="pointer-events-none absolute right-3 bottom-3 hidden text-[11px] text-subtle lg:block">
          Duplo clique edita · Tab cria filho · Enter cria irmão · arraste das bordas para conectar
        </p>
      </div>

      <Dialog open={dialog === 'link'} onOpenChange={(o) => !o && setDialog(null)} title="Vincular nó a um item">
        <EntityPicker
          types={['topic', 'note', 'document', 'reading', 'concept']}
          onPick={(item: SearchResult) => {
            updateSelected({ ref: { type: item.type as GraphEntityType, id: item.id, title: item.title } });
            setDialog(null);
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Renomear mapa"
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
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: qk.mindMap(id), queryFn: () => endpoints.mindMaps.get(id), staleTime: 0, refetchOnWindowFocus: false });
  useRecordView('mindmap', id, query.isSuccess);
  if (query.isLoading) return <PageLoader />;
  if (!query.data) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState className="mt-16" icon={<GitBranch />} title="Mapa não encontrado" action={<Link to="/maps" className="text-accent">Ver mapas</Link>} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return (
    <ReactFlowProvider>
      <Editor key={query.data.id} map={query.data} />
    </ReactFlowProvider>
  );
}
