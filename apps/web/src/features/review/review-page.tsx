import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart3, CloudOff, Flame, Inbox, Layers, Play, Plus, Settings2, Sparkles, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { REVIEW_MODES, REVIEW_MODE_HINTS, REVIEW_MODE_LABELS, uuidv7, type ReviewMode } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Segmented, Select } from '@/components/ui/form';
import { Card, Page, PageHeader, Section } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { useTopics } from '../topics/use-topics';
import { CardDialog } from './card-dialog';
import { GenerateDialog } from './generate-dialog';
import { useOutbox } from './outbox';
import { ReviewSettingsDialog } from './review-settings';
import { ScopePicker } from './scope-picker';
import { sessionLink, useInvalidateReview, useReviewSettings, useReviewSummary } from './use-review';

function Tile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted [&>svg]:size-3.5">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="text-xs text-subtle">{detail}</p>}
    </Card>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tree, isLoading: topicsLoading } = useTopics();
  const { settings, save, isLoading: settingsLoading } = useReviewSettings();
  const summary = useReviewSummary();
  const invalidate = useInvalidateReview();
  const pending = useOutbox((n) => {
    toast.success(`${n} ${n === 1 ? 'resposta enviada' : 'respostas enviadas'} agora que a internet voltou`);
    invalidate();
  });

  // The selection: from the link (“Revisar este assunto”), or the last one used.
  const [topicIds, setTopicIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (topicIds !== null || settingsLoading || topicsLoading) return;
    const fromLink = params.get('topics')?.split(',').filter(Boolean);
    setTopicIds(fromLink ?? settings.lastTopicIds);
  }, [topicIds, settingsLoading, topicsLoading, params, settings.lastTopicIds]);
  // A new link while the page stays open (tabs keep pages mounted) replaces the selection.
  const linkTopics = params.get('topics');
  useEffect(() => {
    if (linkTopics) setTopicIds(linkTopics.split(',').filter(Boolean));
  }, [linkTopics]);
  // Filtered as the topic list arrives: a topic created a moment ago may be missing from a cached list, and deleted ones drop out.
  const selection = useMemo(() => (topicIds ?? []).filter((id) => tree.byId.has(id)), [topicIds, tree]);

  const [mode, setMode] = useState<ReviewMode>('due');
  const [limit, setLimit] = useState<string | null>(null);
  const [recallTopic, setRecallTopic] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'card' | 'generate' | 'settings' | null>(null);
  const today = todayIso();
  const scope = useQuery({ queryKey: qk.reviewScope(selection), queryFn: () => endpoints.review.scope(selection, today), enabled: topicIds !== null });
  const sessions = useQuery({ queryKey: qk.reviewSessions, queryFn: () => endpoints.review.sessions(8) });

  const size = limit ?? String(settings.sessionSize);
  const recallChoices = selection.flatMap((id) => tree.byId.get(id) ?? []);
  const recallTarget = mode === 'recall' ? (recallTopic && selection.includes(recallTopic) ? recallTopic : (selection[0] ?? null)) : null;
  const title = selection.length === 0 ? 'todos os assuntos' : selection.map((id) => `“${tree.byId.get(id)?.title ?? '…'}”`).join(', ');
  const info = scope.data;
  const nothing = mode !== 'recall' && mode !== 'practice' && info && info.due + Math.min(info.new, summary.data?.newAvailable ?? info.new) === 0;

  const start = () => {
    if (mode === 'recall' && !recallTarget) return;
    void save({ lastTopicIds: selection }).catch(() => undefined);
    void navigate(sessionLink(uuidv7(), { topicIds: selection, mode, limit: Number(size), ...(recallTarget ? { topicId: recallTarget } : {}) }));
  };

  const s = summary.data;
  return (
    <Page width="wide">
      <PageHeader
        title="Revisar"
        subtitle="Cartões e perguntas tirados das suas notas, de volta na hora certa para você não esquecer."
        actions={
          <>
            <Link to="/review/cards" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
              <Layers className="size-4" aria-hidden /> Cartões
            </Link>
            <Link to="/review/stats" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
              <BarChart3 className="size-4" aria-hidden /> Estatísticas
            </Link>
            <IconButton label="Configurações da revisão" onClick={() => setDialog('settings')}>
              <Settings2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={<Sun />} label="Para hoje" value={s ? s.due + s.newAvailable : '–'} detail={s ? `${s.due} para rever · ${s.newAvailable} novos` : undefined} />
        <Tile icon={<Play />} label="Respostas hoje" value={s?.reviewedToday ?? '–'} />
        <Tile icon={<Flame className={cn(s?.reviewedToday ? 'text-warning' : '')} />} label="Sequência" value={s?.streak ?? '–'} detail={s?.streak === 1 ? 'dia' : 'dias'} />
        <Tile icon={<Layers />} label="Itens" value={s?.total ?? '–'} detail={s?.leeches ? <Link to="/review/cards?status=leech" className="text-warning hover:underline">{s.leeches} difíceis</Link> : 'ativos'} />
      </div>

      {(s?.proposals ?? 0) > 0 && (
        <Link to="/review/proposals" className="mt-4 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent hover:bg-accent-soft/70">
          <Inbox className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {s!.proposals} {s!.proposals === 1 ? 'pergunta da IA espera' : 'perguntas da IA esperam'} a sua aprovação.
          </span>
          <span className="font-medium">Revisar sugestões</span>
        </Link>
      )}
      {pending > 0 && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <CloudOff className="size-4 shrink-0" aria-hidden /> {pending} {pending === 1 ? 'resposta dada' : 'respostas dadas'} sem internet {pending === 1 ? 'será enviada' : 'serão enviadas'} quando a conexão voltar.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Section title="O que revisar">
          <Card className="p-4">
            {topicIds === null ? <p className="text-sm text-muted">Carregando…</p> : <ScopePicker value={selection} onChange={setTopicIds} />}
          </Card>
        </Section>

        <Section title="Como">
          <Card className="space-y-4 p-4">
            <div role="radiogroup" aria-label="Modo da sessão" className="space-y-1.5">
              {REVIEW_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors', mode === m ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
                >
                  <span className={cn('block text-sm font-medium', mode === m && 'text-accent')}>{REVIEW_MODE_LABELS[m]}</span>
                  <span className="block text-xs text-muted">{REVIEW_MODE_HINTS[m]}</span>
                </button>
              ))}
            </div>

            {mode === 'recall' ? (
              recallChoices.length === 0 ? (
                <p className="text-sm text-warning">Marque ao menos um assunto ao lado para escrever o que lembra dele.</p>
              ) : recallChoices.length > 1 ? (
                <label className="block space-y-1.5 text-[13px] font-medium">
                  Assunto
                  <Select value={recallTarget ?? ''} onChange={(e) => setRecallTopic(e.target.value)}>
                    {recallChoices.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium">Itens na sessão</span>
                <Segmented label="Itens na sessão" size="sm" value={size} onChange={setLimit} options={['10', '20', '30', '50'].map((v) => ({ value: v, label: v }))} />
              </div>
            )}

            {info && (
              <p className="text-xs leading-relaxed text-muted">
                {info.notes} {info.notes === 1 ? 'nota' : 'notas'}
                {info.annotations > 0 && ` · ${info.annotations} ${info.annotations === 1 ? 'anotação' : 'anotações'} de livros`} · {info.cards} {info.cards === 1 ? 'item' : 'itens'}: <strong className="text-text">{info.due}</strong> para rever e{' '}
                <strong className="text-text">{info.new}</strong> {info.new === 1 ? 'novo' : 'novos'}
                {info.proposals > 0 && ` · ${info.proposals} sugestões da IA esperando`}
              </p>
            )}

            <Button variant="primary" size="lg" className="w-full" icon={<Play className="size-4" />} disabled={(mode === 'recall' && !recallTarget) || !!nothing} onClick={start}>
              {mode === 'recall' ? 'Começar a escrever' : 'Começar'}
            </Button>
            {nothing && <p className="text-center text-xs text-muted">Nada vence hoje nesta seleção. Crie cartões, gere perguntas com a IA ou faça um treino livre.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                icon={<Sparkles className="size-4" />}
                onClick={() => setDialog('generate')}
                disabled={selection.length === 0 || (info?.notes ?? 0) + (info?.annotations ?? 0) + (info?.concepts ?? 0) === 0}
                title={selection.length === 0 ? 'Marque os assuntos das perguntas' : undefined}
              >
                Gerar com IA
              </Button>
              <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => setDialog('card')}>
                Novo cartão
              </Button>
            </div>
          </Card>
        </Section>
      </div>

      {(sessions.data?.length ?? 0) > 0 && (
        <Section title="Sessões recentes" className="mt-8">
          <Card>
            <ul className="divide-y divide-border">
              {sessions.data!.map((x) => (
                <li key={x.id}>
                  <Link to={`/review/session/${x.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{REVIEW_MODE_LABELS[x.mode]}</p>
                      <p className="text-xs text-muted">
                        {format(parseISO(x.startedAt), "d 'de' MMM, HH:mm", { locale: ptBR })}
                        {x.topicIds.length > 0 && ` · ${x.topicIds.map((id) => tree.byId.get(id)?.title ?? 'assunto excluído').join(', ')}`}
                      </p>
                    </div>
                    {x.reviewed > 0 && (
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {x.correct}/{x.reviewed} certas
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <CardDialog open={dialog === 'card'} onOpenChange={(o) => !o && setDialog(null)} draft={{ topicId: selection.length === 1 ? selection[0]! : null }} />
      <GenerateDialog open={dialog === 'generate'} onOpenChange={(o) => !o && setDialog(null)} topicIds={selection} label={title} />
      <ReviewSettingsDialog open={dialog === 'settings'} onOpenChange={(o) => !o && setDialog(null)} />
    </Page>
  );
}
