import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BookOpen, FolderTree, Plus, Star, StickyNote, Target, TriangleAlert, Upload, Waypoints } from 'lucide-react';
import type { Dashboard } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { ErrorState, Progress, Skeleton } from '@/components/ui/feedback';
import { Card, Page, Section } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/session';
import { EntityIcon, entityPath } from '@/lib/entities';
import { duration, longDate, relativeTime, shortDate, todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { useCreateNote } from '../notes/use-create-note';
import { TopicChip } from '../shared/topic-breadcrumb';
import { useSetting } from '../settings/use-settings';
import { SpeakingCard } from '../speaking/dashboard-card';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function readingProgress(r: Dashboard['readingsInProgress'][number]): number {
  if (r.progressPercent != null) return r.progressPercent;
  if (r.totalPages && r.currentPage != null) return (r.currentPage / r.totalPages) * 100;
  return 0;
}

function Onboarding() {
  const createNote = useCreateNote();
  const steps = [
    { icon: <FolderTree />, title: 'Organize por assuntos', text: 'Crie um assunto na barra lateral e quantos subassuntos precisar.', to: null },
    { icon: <StickyNote />, title: 'Escreva notas', text: 'O editor salva sozinho, inclusive sem conexão.', action: () => createNote.mutate(null) },
    { icon: <Upload />, title: 'Guarde seus PDFs', text: 'Envie livros e artigos para a biblioteca e leia aqui mesmo.', to: '/library?upload=1' },
    { icon: <Waypoints />, title: 'Conecte as ideias', text: 'Numa nota, digite / para citar um assunto, nota ou livro e # para marcar com uma tag.', to: null },
  ];
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-semibold">Comece por aqui</h2>
      <p className="mt-1 text-sm text-muted">Seu espaço está vazio. Estes são bons primeiros passos:</p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {steps.map((s) => {
          const content = (
            <>
              <span className="mt-0.5 text-accent [&>svg]:size-5">{s.icon}</span>
              <span>
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-sm text-muted">{s.text}</span>
              </span>
            </>
          );
          const cls = 'flex gap-3 rounded-xl border border-border p-4 text-left hover:border-accent/60 hover:bg-accent-soft/40';
          return s.to ? (
            <Link key={s.title} to={s.to} className={cls}>
              {content}
            </Link>
          ) : s.action ? (
            <button key={s.title} type="button" onClick={s.action} className={cls}>
              {content}
            </button>
          ) : (
            <div key={s.title} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Component() {
  const { user } = useAuth();
  const createNote = useCreateNote();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: qk.dashboard, queryFn: endpoints.dashboard });
  const weeklyGoal = useSetting('study_goals').value.weeklyMinutes * 60;

  const empty =
    data &&
    data.topics.length === 0 &&
    data.recentNotes.length === 0 &&
    data.readingsInProgress.length === 0 &&
    data.study.recent.length === 0;

  return (
    <Page>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{longDate(todayIso())}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight">
            {greeting()}
            {user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
          </h1>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => createNote.mutate(null)} loading={createNote.isPending}>
          Nova nota
        </Button>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-40 lg:col-span-3" />
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      ) : isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data && empty ? (
        <Onboarding />
      ) : data ? (
        <div className="space-y-8">
          {data.continueItems.length > 0 && (
            <Section title="Continuar de onde parou">
              <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
                {data.continueItems.slice(0, 6).map((item) => (
                  <Link
                    key={`${item.entityType}:${item.entityId}`}
                    to={entityPath(item.entityType, item.entityId)}
                    className="flex w-60 shrink-0 snap-start items-center gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-border-strong sm:w-auto"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2">
                      <EntityIcon type={item.entityType} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title || 'Sem título'}</span>
                      <span className="block text-xs text-muted">{relativeTime(item.occurredAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="space-y-8 lg:col-span-2">
              <Section title="Notas recentes" action={<Link to="/notes" className="text-xs text-accent hover:underline">Ver todas</Link>}>
                {data.recentNotes.length === 0 ? (
                  <p className="text-sm text-muted">Nenhuma nota ainda.</p>
                ) : (
                  <Card className="divide-y divide-border">
                    {data.recentNotes.map((n) => (
                      <Link key={n.id} to={`/notes/${n.id}`} className="block px-4 py-3 hover:bg-surface-2/60">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium">{n.title || 'Sem título'}</span>
                          <span className="shrink-0 text-xs text-subtle">{relativeTime(n.updatedAt)}</span>
                        </div>
                        {n.excerpt && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{n.excerpt}</p>}
                        {n.topicId && (
                          <div className="mt-1.5">
                            <TopicChip topicId={n.topicId} link={false} />
                          </div>
                        )}
                      </Link>
                    ))}
                  </Card>
                )}
              </Section>

              {(data.readingsInProgress.length > 0 || data.overdueReadings.length > 0) && (
                <Section title="Leituras" action={<Link to="/library" className="text-xs text-accent hover:underline">Ver biblioteca</Link>}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {data.readingsInProgress.map((r) => (
                      <Link key={r.id} to={`/readings/${r.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
                        <div className="flex items-start gap-2">
                          <BookOpen className="mt-0.5 size-4 shrink-0 text-reading" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{r.title}</p>
                            {r.author && <p className="truncate text-xs text-muted">{r.author}</p>}
                          </div>
                        </div>
                        <Progress value={readingProgress(r)} className="mt-3" label={`Progresso de ${r.title}`} />
                        <p className="mt-1.5 text-xs text-muted">
                          {r.totalPages && r.currentPage != null ? `pág. ${r.currentPage} de ${r.totalPages}` : `${Math.round(readingProgress(r))}%`}
                          {r.dueOn ? ` · prazo ${shortDate(r.dueOn)}` : ''}
                        </p>
                      </Link>
                    ))}
                  </div>
                  {data.overdueReadings.length > 0 && (
                    <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
                      <p className="flex items-center gap-2 font-medium text-warning">
                        <TriangleAlert className="size-4" aria-hidden /> Leituras atrasadas
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {data.overdueReadings.map((r) => (
                          <li key={r.id}>
                            <Link to={`/readings/${r.id}`} className="hover:underline">
                              {r.title}
                            </Link>{' '}
                            <span className="text-muted">· prazo {shortDate(r.dueOn!)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Section>
              )}
            </div>

            <div className="space-y-8">
              <SpeakingCard />
              {(data.study.recent.length > 0 || weeklyGoal > 0) && (
              <Section title="Tempo de estudo" action={<Link to="/study" className="text-xs text-accent hover:underline">Histórico</Link>}>
                <Card className="p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted">Últimos 7 dias</p>
                      <p className="mt-0.5 text-xl font-semibold tabular-nums">{duration(data.study.last7DaysSeconds)}</p>
                      <p className="text-xs text-muted">{data.study.sessionsLast7Days} sessões</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Últimos 30 dias</p>
                      <p className="mt-0.5 text-xl font-semibold tabular-nums">{duration(data.study.last30DaysSeconds)}</p>
                    </div>
                  </div>
                  {weeklyGoal > 0 && (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>Meta semanal</span>
                        <span className="tabular-nums">
                          {Math.min(100, Math.round((data.study.last7DaysSeconds / weeklyGoal) * 100))}% de {duration(weeklyGoal)}
                        </span>
                      </div>
                      <Progress value={(data.study.last7DaysSeconds / weeklyGoal) * 100} label="Meta semanal de estudo" />
                    </div>
                  )}
                  {data.study.recent.length > 0 && (
                    <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
                      {data.study.recent.slice(0, 3).map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{s.objective || 'Sessão de estudo'}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {duration(s.durationSeconds)} · {shortDate(s.startedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </Section>
              )}

              {data.upcomingGoals.length > 0 && (
                <Section title="Próximas metas">
                  <Card className="divide-y divide-border">
                    {data.upcomingGoals.map((g) => {
                      const late = g.dueOn! < todayIso();
                      return (
                        <Link key={g.id} to={`/plans/${g.planId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60">
                          <Target className={`mt-0.5 size-4 shrink-0 ${late ? 'text-danger' : 'text-accent'}`} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{g.title}</span>
                            <span className="block truncate text-xs text-muted">{g.planTitle}</span>
                          </span>
                          <span className={`shrink-0 text-xs ${late ? 'font-medium text-danger' : 'text-muted'}`}>{shortDate(g.dueOn!)}</span>
                        </Link>
                      );
                    })}
                  </Card>
                </Section>
              )}

              {data.favorites.length > 0 && (
                <Section title="Favoritos">
                  <ul className="space-y-0.5">
                    {data.favorites.map((f) => (
                      <li key={f.id}>
                        <Link to={entityPath(f.entityType, f.entityId)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                          <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                          <span className="truncate">{f.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {data.topics.length > 0 && (
                <Section title="Assuntos">
                  <div className="flex flex-wrap gap-2">
                    {data.topics.map((t) => (
                      <Link
                        key={t.id}
                        to={`/topics/${t.id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
                      >
                        <span className="size-2 rounded-full" style={{ background: t.color ?? 'var(--border-strong)' }} aria-hidden />
                        {t.title}
                        <span className="text-xs text-subtle tabular-nums">{t.noteCount}</span>
                      </Link>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
