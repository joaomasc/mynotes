import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Inbox, Play, SquarePen, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import { KEY_POINTS_MAX, clozeIndices, uuidv7, type ReviewProposal } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { CardPrompt, KindBadge } from './card-view';
import { sessionLink, useInvalidateReview } from './use-review';

interface Edit {
  front: string;
  back: string;
  keyPoints: string;
}

/**
 * Questions written by the AI wait here: each shows the passage of the note
 * it came from. Approved ones (as edited) become cards; the others go away.
 */
export function Component() {
  const [params] = useSearchParams();
  const batchId = params.get('batch') ?? undefined;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const invalidate = useInvalidateReview();
  const list = useQuery({ queryKey: qk.reviewProposals({ batchId }), queryFn: () => endpoints.review.proposals(batchId ? { batchId } : {}) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const items = useMemo(() => list.data ?? [], [list.data]);
  // New suggestions start selected; the ones already shown keep the user's choice when the list reloads.
  const known = useRef(new Set<string>());
  useEffect(() => {
    // Decided now: the state updater runs later, after the ids below are already marked as known.
    const fresh = new Set(items.filter((p) => !known.current.has(p.id)).map((p) => p.id));
    for (const p of items) known.current.add(p.id);
    setSelected((prev) => new Set(items.filter((p) => fresh.has(p.id) || prev.has(p.id)).map((p) => p.id)));
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; noteId: string | null; items: ReviewProposal[] }>();
    for (const p of items) {
      const key = p.noteId ?? 'concepts';
      const g = map.get(key) ?? { title: p.noteTitle ?? 'Conceitos', noteId: p.noteId, items: [] };
      g.items.push(p);
      map.set(key, g);
    }
    return [...map.values()];
  }, [items]);

  const decide = useMutation({
    mutationFn: (o: { accept: string[]; discard: string[] }) =>
      endpoints.review.decide({
        accept: o.accept.map((id) => {
          const e = edits.get(id);
          return e ? { id, front: e.front, back: e.back, keyPoints: e.keyPoints.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, KEY_POINTS_MAX) } : { id };
        }),
        discard: o.discard,
      }),
    onSuccess: (res, o) => {
      invalidate();
      if (res.created.length) {
        const topicIds = [...new Set(res.created.map((c) => c.topicId).filter((x): x is string => !!x))];
        toast.success(`${res.created.length} ${res.created.length === 1 ? 'cartão criado' : 'cartões criados'}`, {
          action: { label: 'Revisar agora', onClick: () => void navigate(sessionLink(uuidv7(), { topicIds, mode: 'due' })) },
        });
      } else if (o.discard.length) {
        toast.success('Sugestões descartadas');
      }
      void list.refetch();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const approve = () => decide.mutate({ accept: [...selected], discard: items.filter((p) => !selected.has(p.id)).map((p) => p.id) });
  const discardAll = async () => {
    if (await confirm({ title: 'Descartar todas as sugestões?', description: 'Nenhuma vira cartão.', confirmLabel: 'Descartar', danger: true })) {
      decide.mutate({ accept: [], discard: items.map((p) => p.id) });
    }
  };
  const editOf = (p: ReviewProposal): Edit => edits.get(p.id) ?? { front: p.front, back: p.back, keyPoints: p.keyPoints.join('\n') };
  const setEdit = (p: ReviewProposal, patch: Partial<Edit>) => setEdits((prev) => new Map(prev).set(p.id, { ...editOf(p), ...patch }));
  const invalidCloze = items.some((p) => selected.has(p.id) && p.kind === 'cloze' && clozeIndices(editOf(p).front).length === 0);

  return (
    <Page width="narrow">
      <PageHeader
        above={
          <Link to="/review" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" aria-hidden /> Revisar
          </Link>
        }
        title="Sugestões da IA"
        subtitle="Perguntas escritas a partir das suas notas. Confira o trecho de cada uma, edite o que quiser e aprove: só as aprovadas entram nas revisões."
      />
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox />} title="Nenhuma sugestão esperando" description="Na página Revisar, escolha os assuntos e toque em “Gerar com IA”." action={<Link to="/review" className="text-sm font-medium text-accent">Ir para Revisar</Link>} />
      ) : (
        <div className="space-y-6 pb-24">
          {groups.map((g) => (
            <section key={g.noteId ?? 'concepts'} className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <StickyNote className="size-4 text-muted" aria-hidden />
                {g.noteId ? (
                  <Link to={`/notes/${g.noteId}`} className="hover:text-accent hover:underline">
                    {g.title || 'Nota sem título'}
                  </Link>
                ) : (
                  g.title
                )}
              </h2>
              {g.items.map((p) => {
                const on = selected.has(p.id);
                const e = editOf(p);
                return (
                  <Card key={p.id} className={cn('space-y-3 p-4 transition-opacity', !on && 'opacity-55')}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                        checked={on}
                        aria-label="Aprovar esta pergunta"
                        onChange={(ev) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (ev.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          })
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <KindBadge kind={p.kind} />
                            {p.origin === 'relation' && <span className="text-xs text-muted">sobre uma ligação entre notas</span>}
                          </div>
                          <IconButton label={editing === p.id ? 'Concluir edição' : 'Editar'} size="sm" active={editing === p.id} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                            {editing === p.id ? <Check className="size-4" /> : <SquarePen className="size-4" />}
                          </IconButton>
                        </div>
                        {editing === p.id ? (
                          <div className="space-y-2">
                            <Textarea aria-label="Pergunta" rows={2} value={e.front} onChange={(ev) => setEdit(p, { front: ev.target.value })} />
                            {p.kind !== 'cloze' && <Textarea aria-label="Resposta" rows={p.kind === 'essay' ? 4 : 2} value={e.back} onChange={(ev) => setEdit(p, { back: ev.target.value })} />}
                            {(p.kind === 'open' || p.kind === 'essay') && (
                              <Textarea aria-label="Pontos-chave (um por linha)" rows={3} value={e.keyPoints} onChange={(ev) => setEdit(p, { keyPoints: ev.target.value })} />
                            )}
                          </div>
                        ) : (
                          <>
                            <CardPrompt card={{ kind: p.kind, front: e.front, clozeIndex: clozeIndices(e.front)[0] ?? 1 }} revealed={false} className="text-base" />
                            {p.kind === 'cloze' ? (
                              <p className="text-sm text-muted">
                                Resposta: <CardPrompt card={{ kind: 'cloze', front: e.front, clozeIndex: clozeIndices(e.front)[0] ?? 1 }} revealed className="inline text-sm" />
                              </p>
                            ) : (
                              e.back && <p className="text-sm whitespace-pre-wrap text-muted">{e.back}</p>
                            )}
                            {(p.kind === 'open' || p.kind === 'essay') && e.keyPoints && (
                              <ul className="list-disc pl-5 text-xs text-muted">
                                {e.keyPoints
                                  .split('\n')
                                  .filter(Boolean)
                                  .map((k) => (
                                    <li key={k}>{k}</li>
                                  ))}
                              </ul>
                            )}
                          </>
                        )}
                        <blockquote className="border-l-2 border-border pl-2 text-xs text-muted italic">{p.sourceQuote}</blockquote>
                      </div>
                      <IconButton label="Descartar esta" size="sm" onClick={() => decide.mutate({ accept: [], discard: [p.id] })}>
                        <X className="size-4" />
                      </IconButton>
                    </div>
                  </Card>
                );
              })}
            </section>
          ))}
          <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:sticky lg:-mx-0 lg:rounded-xl lg:border">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => void discardAll()} disabled={decide.isPending}>
                Descartar todas
              </Button>
              <Button variant="primary" icon={<Play className="size-4" />} loading={decide.isPending} disabled={selected.size === 0 || invalidCloze} onClick={approve}>
                Aprovar {selected.size}
                {items.length > selected.size && ` e descartar ${items.length - selected.size}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
