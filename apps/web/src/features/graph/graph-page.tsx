import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Clapperboard,
  Expand,
  ExternalLink,
  Link2,
  Maximize,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash,
  Waypoints,
  X,
} from 'lucide-react';
import { GRAPH_ENTITY_TYPES, type Graph, type GraphEdge, type GraphEntityType } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { Checkbox, Segmented, Select } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { ENTITY_CSS_VAR, EntityIcon, entityLabel } from '@/lib/entities';
import { qk } from '@/lib/query';
import { hoverPreview } from '../preview/hover-preview';
import { RelationDialog } from '../shared/relation-dialog';
import { useTopics } from '../topics/use-topics';
import { openModeOf, openPath } from '../workspace/store';
import { ForceGraph, type ForceGraphHandle } from './force-graph';
import {
  DEFAULT_GRAPH_PREFS,
  GROUP_COLORS,
  buildView,
  edgeLabel,
  graphNodePath,
  matchesQuery,
  neighbourhood,
  tagsByNote,
  useGraphPrefs,
  type GraphPrefs,
} from './graph-data';

/* ----------------------------------------------------------- settings -- */

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-muted hover:text-text" aria-expanded={open}>
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
        {title}
      </button>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between text-muted">
        {label} <span className="tabular-nums">{value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
    </label>
  );
}

function SettingsPanel({ prefs, onChange, onClose, onReset }: { prefs: GraphPrefs; onChange: (p: GraphPrefs) => void; onClose: () => void; onReset: () => void }) {
  const set = <K extends keyof GraphPrefs>(k: K, v: GraphPrefs[K]) => onChange({ ...prefs, [k]: v });
  return (
    <aside className="scrollbar-thin absolute top-3 right-3 z-10 max-h-[calc(100%-1.5rem)] w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-border bg-surface/95 shadow-pop backdrop-blur" aria-label="Configurações do grafo">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Configurações do grafo</span>
        <div className="flex">
          <IconButton label="Restaurar padrões" size="sm" onClick={onReset}>
            <RotateCcw className="size-3.5" />
          </IconButton>
          <IconButton label="Fechar" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      <Section title="Filtros">
        <Checkbox checked={prefs.showOrphans} onChange={(v) => set('showOrphans', v)} label="Mostrar itens sem ligações" />
        <Checkbox checked={prefs.showTags} onChange={(v) => set('showTags', v)} label="Mostrar tags como nós" />
      </Section>
      <Section title="Grupos de cor">
        <p className="text-[11px] text-subtle">
          Pinte os itens que combinam com a busca: <code>#tag</code>, <code>assunto:Economia</code>, <code>tipo:livro</code> ou parte do título.
        </p>
        {prefs.groups.map((g, i) => (
          <div key={g.id} className="flex items-center gap-1.5">
            <input
              type="color"
              value={g.color}
              aria-label="Cor do grupo"
              onChange={(e) => set('groups', prefs.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
              className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            <input
              value={g.query}
              placeholder="#tag, assunto:…"
              aria-label="Busca do grupo"
              onChange={(e) => set('groups', prefs.groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-accent"
            />
            <IconButton label="Remover grupo" size="sm" className="size-7" onClick={() => set('groups', prefs.groups.filter((_, j) => j !== i))}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          icon={<Plus className="size-3.5" />}
          onClick={() => set('groups', [...prefs.groups, { id: Math.random().toString(36).slice(2), query: '', color: GROUP_COLORS[prefs.groups.length % GROUP_COLORS.length]! }])}
        >
          Novo grupo
        </Button>
      </Section>
      <Section title="Exibição">
        <Checkbox checked={prefs.arrows} onChange={(v) => set('arrows', v)} label="Setas em todas as ligações" />
        <Slider label="Mostrar textos a partir do zoom" value={prefs.textFade} min={0.2} max={3} step={0.1} onChange={(v) => set('textFade', v)} />
        <Slider label="Tamanho dos nós" value={prefs.nodeSize} min={0.4} max={3} step={0.1} onChange={(v) => set('nodeSize', v)} />
        <Slider label="Espessura das linhas" value={prefs.lineWidth} min={0.3} max={4} step={0.1} onChange={(v) => set('lineWidth', v)} />
      </Section>
      <Section title="Forças">
        <Slider label="Força para o centro" value={prefs.centerForce} min={0} max={0.5} step={0.01} onChange={(v) => set('centerForce', v)} />
        <Slider label="Repulsão" value={prefs.repelForce} min={0} max={30} step={0.5} onChange={(v) => set('repelForce', v)} />
        <Slider label="Força das ligações" value={prefs.linkForce} min={0} max={1} step={0.02} onChange={(v) => set('linkForce', v)} />
        <Slider label="Distância das ligações" value={prefs.linkDistance} min={20} max={300} step={5} onChange={(v) => set('linkDistance', v)} />
      </Section>
    </aside>
  );
}

/* --------------------------------------------------------------- view -- */

function GraphView({ graph, structure, focus, hidden }: { graph: Graph; structure: boolean; focus: string | null; hidden: Set<GraphEntityType> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tree } = useTopics();
  const fg = useRef<ForceGraphHandle>(null);
  const [prefs, setPrefs] = useGraphPrefs();
  const [selected, setSelected] = useState<string | null>(focus);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  // Local view: neighbourhood of these roots (expanded progressively).
  const [roots, setRoots] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const [depth, setDepth] = useState<'0' | '1' | '2'>(focus ? '1' : '0');
  const [query, setQuery] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [pair, setPair] = useState<{ source: Graph['nodes'][number]; target: Graph['nodes'][number] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Timeline: how many items (oldest first) are shown while it plays.
  const [revealed, setRevealed] = useState<number | null>(null);

  const ctx = useMemo(() => ({ tree, tagsByNote: tagsByNote(graph) }), [tree, graph]);
  const view = useMemo(
    () => buildView(graph, { structure, hidden, showOrphans: prefs.showOrphans, showTags: prefs.showTags, groups: prefs.groups, ctx }),
    [graph, structure, hidden, prefs.showOrphans, prefs.showTags, prefs.groups, ctx],
  );

  const focusSet = useMemo(() => {
    const starts = roots.size ? [...roots] : selected ? [selected] : [];
    if (depth === '0' || starts.length === 0) return null;
    return neighbourhood(view.edges, starts, Number(depth));
  }, [roots, selected, depth, view.edges]);

  const order = useMemo(
    () => [...view.nodes].sort((a, b) => (view.source.get(a.key)?.createdAt ?? '').localeCompare(view.source.get(b.key)?.createdAt ?? '')).map((n) => n.key),
    [view],
  );
  const shown = useMemo(() => {
    let nodes = focusSet ? view.nodes.filter((n) => focusSet.has(n.key)) : view.nodes;
    if (revealed !== null) {
      const visible = new Set(order.slice(0, revealed));
      nodes = nodes.filter((n) => visible.has(n.key));
    }
    const keys = new Set(nodes.map((n) => n.key));
    return { nodes, edges: view.edges.filter((e) => keys.has(e.source) && keys.has(e.target)) };
  }, [view, focusSet, revealed, order]);

  useEffect(() => {
    if (revealed === null) return;
    if (revealed >= order.length) {
      const t = setTimeout(() => setRevealed(null), 800);
      return () => clearTimeout(t);
    }
    const step = Math.max(1, Math.ceil(order.length / 160));
    const t = setTimeout(() => setRevealed((r) => (r === null ? r : r + step)), 45);
    return () => clearTimeout(t);
  }, [revealed, order.length]);

  const hits = useMemo(() => {
    if (query.trim().length < 2) return null;
    return new Set(shown.nodes.filter((n) => matchesQuery(query, view.source.get(n.key)!, ctx)).map((n) => n.key));
  }, [query, shown.nodes, view.source, ctx]);

  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => fg.current?.centerOn(focus, 1.3), 900);
    return () => clearTimeout(t);
  }, [focus]);

  const sel = selected ? view.source.get(selected) : undefined;
  const outgoing = sel ? view.edges.filter((e) => e.source === sel.key) : [];
  const incoming = sel ? view.edges.filter((e) => e.target === sel.key) : [];

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

  const open = (key: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
    if (key.startsWith('tag:')) return void navigate(`/search?tag=${encodeURIComponent(key.slice(4))}`);
    const n = view.source.get(key);
    if (!n) return;
    const mode = e ? openModeOf(e) : 'same';
    if (mode === 'same') void navigate(graphNodePath(n));
    else openPath(graphNodePath(n), mode);
  };

  const connection = (e: { key: string; source: string; target: string }, other: string, dir: 'in' | 'out') => {
    const n = view.source.get(other);
    const g = view.edgeSource.get(e.key);
    if (!n) return null;
    return (
      <li key={`${dir}${e.key}`}>
        <button
          type="button"
          onClick={() => {
            setSelected(n.key);
            fg.current?.centerOn(n.key);
          }}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-2"
        >
          <EntityIcon type={n.type} className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{n.label}</span>
          <span className="shrink-0 text-[11px] text-subtle">{g ? edgeLabel(g) : 'tag'}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
      <ForceGraph
        ref={fg}
        nodes={shown.nodes}
        edges={shown.edges}
        settings={prefs}
        selected={selected}
        hits={hits}
        connectMode={connectMode}
        onSelect={(key, e) => {
          setSelectedEdge(null);
          if (key && (e.ctrlKey || e.metaKey)) return open(key, e);
          setSelected(key);
        }}
        onOpen={(key, e) => open(key, e)}
        onHover={(key, rect) => {
          const n = key ? view.source.get(key) : null;
          if (n && rect && !key!.startsWith('tag:')) hoverPreview.show(graphNodePath(n), rect, 650);
          else hoverPreview.hide();
        }}
        onEdgeClick={(key) => setSelectedEdge(view.edgeSource.get(key) ?? null)}
        onConnect={(a, b) => {
          const source = view.source.get(a);
          const target = view.source.get(b);
          if (source && target && !a.startsWith('tag:') && !b.startsWith('tag:')) setPair({ source, target });
        }}
      />

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
                fg.current?.centerOn(first, 1.4);
              }
            }}
            placeholder="Localizar: título, #tag, assunto:…"
            aria-label="Localizar no grafo"
            className="h-9 w-56 rounded-lg border border-border bg-surface pr-3 pl-8 text-base shadow-card outline-none focus:border-accent sm:text-sm"
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
          title="Arraste de um item até outro para criar uma relação"
        >
          {connectMode ? 'Conectando…' : 'Conectar'}
        </Button>
        <IconButton label="Enquadrar tudo (0)" size="sm" variant="outline" onClick={() => fg.current?.fit()}>
          <Maximize className="size-4" />
        </IconButton>
        <IconButton label="Reorganizar disposição" size="sm" variant="outline" onClick={() => fg.current?.reheat()}>
          <RotateCcw className="size-4" />
        </IconButton>
        <IconButton label={revealed === null ? 'Linha do tempo: mostrar na ordem de criação' : 'Parar a linha do tempo'} size="sm" variant="outline" active={revealed !== null} onClick={() => setRevealed(revealed === null ? 1 : null)}>
          <Clapperboard className="size-4" />
        </IconButton>
        <IconButton label="Configurações do grafo" size="sm" variant="outline" active={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
          <Settings2 className="size-4" />
        </IconButton>
      </div>
      {connectMode && (
        <p className="absolute top-14 left-3 rounded-lg bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card">Arraste de um item até outro para relacioná-los.</p>
      )}
      {revealed !== null && (
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-surface/95 px-3 py-1.5 text-xs text-muted tabular-nums shadow-card" role="status">
          {Math.min(revealed, order.length)} de {order.length} itens, do mais antigo ao mais novo
        </p>
      )}

      {settingsOpen ? (
        <SettingsPanel prefs={prefs} onChange={setPrefs} onClose={() => setSettingsOpen(false)} onReset={() => setPrefs(DEFAULT_GRAPH_PREFS)} />
      ) : (
        <div className="absolute right-3 bottom-3 hidden rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card sm:block" aria-label="Legenda">
          <p className="mb-1.5 font-medium">Legenda</p>
          <ul className="space-y-1">
            {GRAPH_ENTITY_TYPES.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: ENTITY_CSS_VAR[t] }} aria-hidden />
                {t === 'reading' ? 'Livro / leitura / anotação' : entityLabel(t)}
              </li>
            ))}
            {prefs.groups
              .filter((g) => g.query.trim())
              .map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
                  {g.query}
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
          <p className="mt-2 text-[11px] text-subtle">Duplo clique abre · Ctrl+clique abre em nova aba</p>
        </div>
      )}

      {selectedEdge && (
        <aside className="absolute top-14 left-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop" aria-label="Ligação selecionada">
          <p className="text-xs text-subtle">{selectedEdge.relationId ? 'Relação definida' : 'Ligação derivada dos dados'}</p>
          <p className="mt-1 text-sm">
            {view.source.get(selectedEdge.source)?.label} <span className="text-muted">— {edgeLabel(selectedEdge)} →</span> {view.source.get(selectedEdge.target)?.label}
          </p>
          {selectedEdge.relationId ? (
            <Button className="mt-3" size="sm" variant="outline" icon={<Trash className="size-3.5" />} loading={removeRelation.isPending} onClick={() => removeRelation.mutate(selectedEdge.relationId!)}>
              Remover relação
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted">Vem da hierarquia, de uma referência escrita numa nota ou de uma anotação de livro. Altere-a no próprio conteúdo.</p>
          )}
        </aside>
      )}

      {sel && !selectedEdge && (
        <aside className="absolute top-14 left-3 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface p-4 shadow-pop" aria-label="Item selecionado">
          <div className="flex items-start gap-2">
            <EntityIcon type={sel.type} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">{sel.key.startsWith('tag:') ? 'Tag' : sel.role === 'annotation' ? 'Anotação de leitura' : sel.role === 'review' ? 'Resenha' : entityLabel(sel.type)}</p>
              <p className="font-medium break-words">{sel.label}</p>
            </div>
            <IconButton label="Fechar" size="sm" onClick={() => setSelected(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <button type="button" onClick={(e) => open(sel.key, e)} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
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
const OVERVIEW_LIMIT = 400;

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
  const effectiveHidden = useMemo(() => hidden ?? new Set<GraphEntityType>(overview ? ['note', 'document', 'concept'] : []), [hidden, overview]);
  const toggle = (t: GraphEntityType) => {
    const next = new Set(effectiveHidden);
    if (next.has(t)) next.delete(t);
    else if (next.size < GRAPH_ENTITY_TYPES.length - 1) next.add(t);
    setHidden(next);
  };
  const hiddenCount = graph.data?.nodes.filter((n) => effectiveHidden.has(n.type)).length ?? 0;

  return (
    <div className="flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col lg:h-(--view-h)">
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
        <GraphView
          key={`${topicId}|${focus ?? ''}`}
          graph={graph.data}
          structure={structure}
          focus={focus && graph.data.nodes.some((n) => n.key === focus) ? focus : null}
          hidden={effectiveHidden}
        />
      )}
    </div>
  );
}
