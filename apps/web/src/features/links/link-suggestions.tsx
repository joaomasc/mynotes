import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { RELATION_KIND_LABELS, SUGGESTED_KINDS, type LinkEnd, type LinkSuggestion, type LinkableType, type RelationKind } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { useTopics, type TopicTree } from '../topics/use-topics';

/** The relation as a phrase between the two titles. */
const VERBS: Record<RelationKind, string> = {
  related: 'se relaciona com',
  references: 'cita',
  depends_on: 'depende de',
  part_of: 'é parte de',
  supports: 'sustenta',
  contrasts: 'contrasta com',
  example_of: 'é exemplo de',
};

const pathOf = (e: LinkEnd) => (e.type === 'note' ? `/notes/${e.id}` : `/concepts/${e.id}`);

function rootTitle(tree: TopicTree, topicId: string | null): string | null {
  let t = topicId ? tree.byId.get(topicId) : undefined;
  const seen = new Set<string>();
  while (t?.parentId && !seen.has(t.id)) {
    seen.add(t.id);
    const up = tree.byId.get(t.parentId);
    if (!up) break;
    t = up;
  }
  return t?.title ?? null;
}

/** "Economia ↔ Biologia" when the two items live under different top topics (the most valuable links). */
export function bridgeOf(tree: TopicTree, s: LinkSuggestion): string | null {
  const a = rootTitle(tree, s.a.topicId);
  const b = rootTitle(tree, s.b.topicId);
  return a && b && a !== b ? `${a} ↔ ${b}` : null;
}

/** Explains (once) the suggestions shown that the AI has not explained yet, and refreshes the lists. */
function useAutoExplain(suggestions: LinkSuggestion[] | undefined) {
  const qc = useQueryClient();
  const asked = useRef(new Set<string>());
  const explain = useMutation({
    mutationFn: (ids: string[]) => endpoints.links.explain(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.linksAll }),
    // Without the AI (budget, key), the suggestions stay as "related" without a reason.
    onError: () => undefined,
  });
  const { mutate } = explain;
  useEffect(() => {
    const ids = (suggestions ?? []).filter((s) => !s.explained && !asked.current.has(s.id)).map((s) => s.id).slice(0, 10);
    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);
    mutate(ids);
  }, [suggestions, mutate]);
  return explain.isPending;
}

/**
 * One suggestion: the two items, why they connect, the relation (which can
 * be changed) and the two decisions: link (a relation in the graph) or
 * dismiss (never suggested again).
 */
export function SuggestionCard({ s, from, explaining, onDone }: { s: LinkSuggestion; from?: { type: LinkableType; id: string }; explaining?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const { tree } = useTopics();
  const [kind, setKind] = useState<RelationKind>(s.kind ?? 'related');
  const [direction, setDirection] = useState(s.direction);
  useEffect(() => {
    setKind(s.kind ?? 'related');
    setDirection(s.direction);
  }, [s.kind, s.direction]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.linksAll });
    void qc.invalidateQueries({ queryKey: ['graph'] });
    void qc.invalidateQueries({ queryKey: qk.relationsAll });
  };
  const accept = useMutation({
    mutationFn: () => endpoints.links.accept(s.id, { kind, direction }),
    onSuccess: () => {
      toast.success('Ligação criada no grafo');
      refresh();
      onDone?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const dismiss = useMutation({
    mutationFn: () => endpoints.links.dismiss(s.id),
    onSuccess: () => {
      refresh();
      onDone?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [source, target] = direction === 'ab' ? [s.a, s.b] : [s.b, s.a];
  const other = from ? (s.a.type === from.type && s.a.id === from.id ? s.b : s.a) : null;
  const bridge = bridgeOf(tree, s);
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {other ? (
            <Link to={pathOf(other)} className="font-medium break-words hover:text-accent hover:underline">
              {other.title}
            </Link>
          ) : (
            <p className="text-sm break-words">
              <Link to={pathOf(s.a)} className="font-medium hover:text-accent hover:underline">
                {s.a.title}
              </Link>{' '}
              <span className="text-muted">↔</span>{' '}
              <Link to={pathOf(s.b)} className="font-medium hover:text-accent hover:underline">
                {s.b.title}
              </Link>
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">parecidas {Math.round(s.score * 100)}%</Badge>
            {bridge && <Badge tone="accent">ponte: {bridge}</Badge>}
          </div>
        </div>
      </div>
      {s.explained ? (
        s.reason && <p className="text-sm text-muted">{s.reason}</p>
      ) : explaining ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> A IA está lendo as duas notas…
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Select aria-label="Tipo de relação" value={kind} onChange={(e) => setKind(e.target.value as RelationKind)} className="h-8 text-xs sm:h-8">
            {SUGGESTED_KINDS.map((k) => (
              <option key={k} value={k}>
                {RELATION_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <IconButton label="Inverter o sentido" size="sm" variant="outline" onClick={() => setDirection(direction === 'ab' ? 'ba' : 'ab')}>
          <ArrowLeftRight className="size-3.5" />
        </IconButton>
      </div>
      <p className="text-xs text-muted">
        “{source.title}” <strong className="font-medium text-text">{VERBS[kind]}</strong> “{target.title}”
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={accept.isPending} onClick={() => accept.mutate()}>
          Ligar
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} loading={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Dispensar
        </Button>
      </div>
    </div>
  );
}

/** "Notes that talk to this one" in the panel of a note or concept. */
export function LinkSuggestions({ type, id, boxed = false }: { type: LinkableType; id: string; /** Inside a card of its own (shown only when there is something to show). */ boxed?: boolean }) {
  const q = useQuery({ queryKey: qk.links(type, id), queryFn: () => endpoints.links.forItem(type, id), staleTime: 60_000 });
  const suggestions = q.data?.suggestions;
  const explaining = useAutoExplain(suggestions);
  const visible = useMemo(() => suggestions ?? [], [suggestions]);
  if (q.data?.unavailable && visible.length === 0) return null;
  return (
    <section aria-label="Ligações sugeridas" className={boxed ? 'rounded-xl border border-border bg-surface p-4' : undefined}>
      <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <Sparkles className="size-3.5" aria-hidden /> {type === 'note' ? 'Notas que conversam com esta' : 'Itens que conversam com este'}
      </h3>
      <p className="mb-2 text-xs text-subtle">Parecidas no sentido e ainda sem ligação. Ligar cria a relação no grafo.</p>
      {q.isLoading ? (
        <p className="text-xs text-muted">Procurando…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted">{q.data?.pending ? 'O texto acabou de mudar: as sugestões aparecem em um ou dois minutos.' : 'Nenhuma sugestão por enquanto.'}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-3">
              <SuggestionCard s={s} from={{ type, id }} explaining={explaining && !s.explained} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { useAutoExplain };
