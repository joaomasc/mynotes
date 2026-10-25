import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { MEMORY_TIER_LABELS, fromMemoryTuple, memoryByNode, memoryTier, uuidv7, type GraphNode, type MemoryCard, type MemoryInfo } from '@mynotes/shared';
import { Segmented } from '@/components/ui/form';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { sessionLink } from '../review/use-review';
import type { TopicTree } from '../topics/use-topics';

/**
 * The memory graph (docs/grafo-memoria.md): every note, topic and book
 * colored by the chance of remembering its review cards, today or on a
 * later day (the time ruler shows the graph fading without reviews).
 */

export const MEMORY_DAYS = ['0', '7', '30', '90'] as const;
export type MemoryDays = (typeof MEMORY_DAYS)[number];

export function useGraphMemory(enabled: boolean, days: MemoryDays, tree: TopicTree) {
  const q = useQuery({ queryKey: qk.reviewMemory, queryFn: endpoints.review.memory, enabled, staleTime: 60_000 });
  const cards = useMemo<MemoryCard[]>(() => (q.data ? q.data.cards.map(fromMemoryTuple) : []), [q.data]);
  const memory = useMemo(() => {
    if (!enabled || !q.data) return null;
    const at = new Date(Date.now() + Number(days) * 86_400_000);
    return memoryByNode(cards, (id) => tree.byId.get(id)?.parentId ?? null, at);
  }, [enabled, q.data, cards, days, tree]);
  return { memory, cards, loading: enabled && q.isLoading };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** "Lembrança estimada: 64% · 3 cartões · 1 para hoje". */
export function memorySummary(info: MemoryInfo | undefined): string {
  if (!info) return 'Sem cartões de revisão.';
  const cards = `${info.cards} ${info.cards === 1 ? 'cartão' : 'cartões'}`;
  if (info.r === null) return `${cards}, nenhum revisado ainda.`;
  return `Lembrança estimada: ${pct(info.r)} · ${cards}${info.due ? ` · ${info.due} para revisar` : ''}`;
}

/** Where "Revisar agora" goes for a node: its notes (a book: the notes of its annotations) or its topic. */
export function reviewNowLink(node: GraphNode, cards: MemoryCard[]): string | null {
  const id = uuidv7();
  if (node.type === 'topic') return sessionLink(id, { topicIds: [node.entityId], mode: 'practice' });
  if (node.type === 'note') return sessionLink(id, { topicIds: [], noteIds: [node.entityId], mode: 'practice' });
  if (node.type === 'reading') {
    const notes = [...new Set(cards.filter((c) => c.readingId === node.entityId && c.noteId).map((c) => c.noteId!))].slice(0, 50);
    return notes.length ? sessionLink(id, { topicIds: [], noteIds: notes, mode: 'practice' }) : null;
  }
  return null;
}

/** The selected node's memory, with "Revisar agora". */
export function NodeMemory({ node, memory, cards }: { node: GraphNode; memory: Map<string, MemoryInfo>; cards: MemoryCard[] }) {
  const info = memory.get(node.key);
  const link = info ? reviewNowLink(node, cards) : null;
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
      <p>{memorySummary(info)}</p>
      {link && (
        <Link to={link} className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
          <Brain className="size-3.5" aria-hidden /> Revisar agora
        </Link>
      )}
    </div>
  );
}

/** Scale, the two kinds of ring and the time ruler. */
export function MemoryLegend({ days, onDays, suggestions }: { days: MemoryDays; onDays: (d: MemoryDays) => void; suggestions: boolean }) {
  return (
    <div className="absolute right-3 bottom-3 w-60 rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card" aria-label="Legenda da memória">
      <p className="mb-1.5 font-medium">Chance de lembrar</p>
      <ul className="space-y-1">
        {MEMORY_TIER_LABELS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: `var(--mem-${i})` }} aria-hidden />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-2 pt-1">
          <span className="size-2.5 rounded-full border-2" style={{ borderColor: 'var(--mem-2)' }} aria-hidden /> Cartões ainda não revisados
        </li>
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border-2 border-border-strong" aria-hidden /> Sem cartões
        </li>
        {suggestions && (
          <li className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed" style={{ borderColor: 'var(--suggest)' }} aria-hidden /> Ligação sugerida
          </li>
        )}
      </ul>
      <p className="mt-2.5 mb-1 font-medium">Como estará</p>
      <Segmented
        label="Como estará a memória"
        size="sm"
        value={days}
        onChange={onDays}
        options={MEMORY_DAYS.map((d) => ({ value: d, label: d === '0' ? 'hoje' : `+${d} d`, title: d === '0' ? 'Agora' : `Daqui a ${d} dias, sem revisar` }))}
      />
      {days !== '0' && <p className="mt-1.5 text-[11px] text-subtle">Daqui a {days} dias, se nada for revisado até lá.</p>}
    </div>
  );
}

/** The notes fading the most (an accessible list of what the colors show), with a review of them all. */
export function FadingList({ nodes, memory, onPick }: { nodes: GraphNode[]; memory: Map<string, MemoryInfo>; onPick: (key: string) => void }) {
  const fading = useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'note')
        .flatMap((n) => {
          const r = memory.get(n.key)?.r;
          return r != null && r < 0.9 ? [{ node: n, r }] : [];
        })
        .sort((a, b) => a.r - b.r)
        .slice(0, 6),
    [nodes, memory],
  );
  if (fading.length === 0) return null;
  const all = sessionLink(uuidv7(), { topicIds: [], noteIds: fading.map((f) => f.node.entityId), mode: 'practice' });
  return (
    <div className="absolute bottom-3 left-3 hidden w-64 rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card sm:block" aria-label="Esquecendo agora">
      <p className="mb-1.5 font-medium">Esquecendo agora</p>
      <ul className="space-y-0.5">
        {fading.map((f) => (
          <li key={f.node.key}>
            <button type="button" onClick={() => onPick(f.node.key)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--mem-${memoryTier(f.r)})` }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.node.label}</span>
              <span className="shrink-0 text-muted tabular-nums">{pct(f.r)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Link to={all} className="mt-2 inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
        <Brain className="size-3.5" aria-hidden /> Revisar estas notas
      </Link>
    </div>
  );
}
