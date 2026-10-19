import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Maximize, Waypoints } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Checkbox, Segmented } from '@/components/ui/form';
import { Spinner } from '@/components/ui/feedback';
import { endpoints } from '@/lib/api/endpoints';
import { usePref } from '@/lib/prefs';
import { qk } from '@/lib/query';
import { hoverPreview } from '../preview/hover-preview';
import { useTopics } from '../topics/use-topics';
import { openModeOf, openPath } from '../workspace/store';
import { ForceGraph, type ForceGraphHandle } from './force-graph';
import { buildView, graphNodePath, neighbourhood, tagsByNote, useGraphPrefs } from './graph-data';

interface LocalPrefs {
  depth: '1' | '2' | '3';
  structure: boolean;
  tags: boolean;
}

/**
 * Local graph (like Obsidian's): the open item and what is linked to it,
 * following the active tab. Click opens in the tab, Ctrl+click in a new one.
 */
export function LocalGraph({ focusKey }: { focusKey: string }) {
  const navigate = useNavigate();
  const { tree } = useTopics();
  const fg = useRef<ForceGraphHandle>(null);
  const [prefs] = useGraphPrefs();
  const [local, setLocal] = usePref<LocalPrefs>('mynotes:local-graph', { depth: '1', structure: true, tags: false });
  const query = { structure: 'true' };
  const graph = useQuery({ queryKey: qk.graph(query), queryFn: () => endpoints.graph(query), staleTime: 60_000 });

  const ctx = useMemo(() => ({ tree, tagsByNote: tagsByNote(graph.data) }), [tree, graph.data]);
  const view = useMemo(() => {
    if (!graph.data) return null;
    const all = buildView(graph.data, { structure: local.structure, hidden: new Set(), showOrphans: true, showTags: local.tags, groups: prefs.groups, ctx });
    if (!all.source.has(focusKey)) return { ...all, nodes: [], edges: [] };
    const keep = neighbourhood(all.edges, [focusKey], Number(local.depth));
    return { ...all, nodes: all.nodes.filter((n) => keep.has(n.key)), edges: all.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [graph.data, local, prefs.groups, ctx, focusKey]);

  const settings = useMemo(() => ({ ...prefs, linkDistance: Math.min(prefs.linkDistance, 70), textFade: 0.6 }), [prefs]);

  useEffect(() => {
    const t = setTimeout(() => fg.current?.fit(), 700);
    return () => clearTimeout(t);
  }, [focusKey, local.depth]);

  const open = (key: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
    if (key.startsWith('tag:')) return void navigate(`/search?tag=${encodeURIComponent(key.slice(4))}`);
    const n = view?.source.get(key);
    if (!n || key === focusKey) return;
    const mode = openModeOf(e);
    if (mode === 'same') void navigate(graphNodePath(n));
    else openPath(graphNodePath(n), mode);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <Segmented
          label="Profundidade"
          size="sm"
          value={local.depth}
          onChange={(depth) => setLocal({ ...local, depth })}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
          ]}
        />
        <Checkbox checked={local.structure} onChange={(structure) => setLocal({ ...local, structure })} label="Hierarquia" />
        <Checkbox checked={local.tags} onChange={(tags) => setLocal({ ...local, tags })} label="Tags" />
        <IconButton label="Enquadrar" size="sm" className="ml-auto size-7" onClick={() => fg.current?.fit()}>
          <Maximize className="size-3.5" />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {graph.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : !view?.nodes.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted">
            <Waypoints className="size-5" aria-hidden />
            Nada ligado a este item ainda. Cite-o com “/” em outra nota ou crie uma relação.
          </div>
        ) : (
          <ForceGraph
            ref={fg}
            compact
            nodes={view.nodes}
            edges={view.edges}
            settings={settings}
            focusKey={focusKey}
            onSelect={(key, e) => key && open(key, e)}
            onOpen={open}
            onHover={(key, rect) => {
              const n = key ? view.source.get(key) : null;
              if (n && rect && key !== focusKey && !key!.startsWith('tag:')) hoverPreview.show(graphNodePath(n), rect, 500);
              else hoverPreview.hide();
            }}
            ariaLabel="Grafo local do item aberto"
          />
        )}
      </div>
    </div>
  );
}
