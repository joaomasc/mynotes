import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Columns2, Ellipsis, FileText, Gavel, Plus, Sparkles, Trash, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CRITERIA_INFO,
  METHOD_IDS,
  PROJECT_STEPS,
  PROJECT_TYPE_INFO,
  SPEECH_METHODS,
  markdownToDoc,
  projectScript,
  stepFilled,
  stepText,
  type MethodId,
  type ProjectData,
  type ProjectStep,
  type SpeechAttempt,
  type SpeechFeedback,
  type SpeechProject,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { ErrorState, PageLoader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { Menu } from '@/components/ui/menu';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { RichText } from './exercises';
import { projectsKey } from './projects-section';
import { StateBadge, scoreTone } from './speaking-ui';
import { TalkRecorder } from './talk-recorder';

const projectKey = (id: string) => ['speech-project', id] as const;

/** Text field bound to the project draft. */
function Text({ label, value, onChange, rows = 3, placeholder }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <Field label={label}>{(f) => <Textarea {...f} rows={rows} value={value} maxLength={4000} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</Field>;
}

function WriteStep({ step, project, data, set }: { step: ProjectStep; project: SpeechProject; data: ProjectData; set: (patch: Partial<ProjectData>) => void }) {
  const info = PROJECT_TYPE_INFO[project.type];
  const method = data.method ? SPEECH_METHODS[data.method] : null;
  switch (step.id) {
    case 'audience':
      return (
        <>
          <Text label="Quem vai ouvir" value={data.audience} onChange={(v) => set({ audience: v })} placeholder="Ex.: moradores do bairro, a maioria de carro, desconfiados de obras" />
          <Text label="O que você quer que pensem ou façam ao final" value={data.goal} onChange={(v) => set({ goal: v })} placeholder="Ex.: assinar a petição e ir à audiência de terça" />
        </>
      );
    case 'centralIdea':
      return <Text label="Ideia central (uma frase)" rows={2} value={data.centralIdea} onChange={(v) => set({ centralIdea: v })} />;
    case 'structure':
      return (
        <>
          <Field label="Método" hint={`Sugerido para ${info.label.toLowerCase()}: ${SPEECH_METHODS[info.method].name}.`}>
            {(f) => (
              <Select {...f} value={data.method ?? ''} onChange={(e) => set({ method: (e.target.value || null) as MethodId | null })}>
                <option value="">Escolha…</option>
                {METHOD_IDS.map((m) => (
                  <option key={m} value={m}>
                    {SPEECH_METHODS[m].name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {method && (
            <ol className="space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
              {method.parts.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.name}:</span> <span className="text-muted">{p.hint}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Pontos (de 2 a 4), na ordem da fala</p>
            {data.points.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Ponto ${i + 1}`}
                  value={p.title}
                  maxLength={300}
                  onChange={(e) => set({ points: data.points.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })}
                  placeholder={`Ponto ${i + 1}`}
                />
                <IconButton label="Remover ponto" onClick={() => set({ points: data.points.filter((_, k) => k !== i) })}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
            {data.points.length < 4 && (
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ points: [...data.points, { title: '', argument: '', evidence: '' }] })}>
                Acrescentar ponto
              </Button>
            )}
          </div>
        </>
      );
    case 'arguments':
      return (
        <>
          {data.points.length === 0 && <p className="text-sm text-muted">Defina os pontos na etapa 3 primeiro.</p>}
          {data.points.map((p, i) => (
            <Card key={i} className="space-y-3 p-3">
              <p className="text-sm font-medium">{p.title || `Ponto ${i + 1}`}</p>
              <Text label="Argumento" value={p.argument} onChange={(v) => set({ points: data.points.map((x, k) => (k === i ? { ...x, argument: v } : x)) })} />
              <Text label="Evidência" rows={2} value={p.evidence} onChange={(v) => set({ points: data.points.map((x, k) => (k === i ? { ...x, evidence: v } : x)) })} />
            </Card>
          ))}
          <Text label="A objeção mais forte" rows={2} value={data.objection} onChange={(v) => set({ objection: v })} />
          <Text label="A sua resposta à objeção" value={data.objectionResponse} onChange={(v) => set({ objectionResponse: v })} />
        </>
      );
    case 'story':
      return <Text label="A história (situação, conflito, virada, lição)" rows={7} value={data.story} onChange={(v) => set({ story: v })} />;
    case 'openingClosing':
      return (
        <>
          <Text label="Abertura" value={data.opening} onChange={(v) => set({ opening: v })} />
          <Text label="Conclusão" value={data.conclusion} onChange={(v) => set({ conclusion: v })} />
          <Text label="Chamado à ação" rows={2} value={data.callToAction} onChange={(v) => set({ callToAction: v })} />
        </>
      );
    default:
      return null;
  }
}

/** The coach's comment on what was written in a step. */
function StepFeedback({ step, data, aiReady }: { step: ProjectStep; data: ProjectData; aiReady: boolean }) {
  const [result, setResult] = useState<SpeechFeedback | null>(null);
  const ask = useMutation({
    mutationFn: () =>
      endpoints.speech.feedback({ kind: 'build', instruction: step.hint, context: step.title, answer: stepText(step, data).slice(0, 2000), method: data.method }),
    onSuccess: setResult,
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!aiReady) return null;
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" icon={<Sparkles className="size-4" />} loading={ask.isPending} disabled={!stepFilled(step, data)} onClick={() => ask.mutate()}>
        Pedir o comentário do professor
      </Button>
      {result && (
        <div className={cn('rounded-lg p-3 text-sm', result.verdict === 'good' ? 'bg-success-soft' : result.verdict === 'redo' ? 'bg-danger-soft' : 'bg-surface-2')}>
          <p className="font-medium">{{ good: 'Muito bom!', almost: 'Quase lá.', redo: 'Vale refazer.' }[result.verdict]}</p>
          <p className="mt-1">{result.feedback}</p>
          <p className="mt-2 text-muted">
            Uma versão melhor: <span className="text-text">“{result.suggestion}”</span>
          </p>
        </div>
      )}
    </div>
  );
}

function ScriptPreview({ project, data }: { project: SpeechProject; data: ProjectData }) {
  return (
    <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Ver o roteiro</summary>
      <pre className="mt-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">{projectScript(project.title, project.type, data)}</pre>
    </details>
  );
}

function AttemptSummary({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: qk.speechAttempt(id), queryFn: () => endpoints.speech.get(id) });
  if (!data) return <Spinner className="size-4" />;
  return (
    <Link to={`/speaking/attempts/${id}`} className="flex items-center gap-4 rounded-xl border border-border p-3 hover:bg-surface-2">
      <span className={cn('text-3xl font-semibold tabular-nums', scoreTone(data.score))}>{data.score ?? '—'}</span>
      <span className="min-w-0 flex-1 text-sm">
        {data.evaluation?.summary ?? 'Ver o resultado completo'}
        {data.fullEvaluation && <span className="mt-1 block text-xs text-muted">Avaliação completa: {data.fullEvaluation.summary}</span>}
      </span>
      <ArrowRight className="size-4 shrink-0 text-subtle" aria-hidden />
    </Link>
  );
}

/** Rehearsals and the final presentation: recorded with the audio, evaluated, linked to the project. */
function RehearseStep({ step, project, data, aiReady, onRecorded }: { step: ProjectStep; project: SpeechProject; data: ProjectData; aiReady: boolean; onRecorded: (a: SpeechAttempt) => Promise<void> }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const info = PROJECT_TYPE_INFO[project.type];
  const existing = step.id === 'rehearsal1' ? data.rehearsal1Id : step.id === 'rehearsal2' ? data.rehearsal2Id : data.finalId;
  const recorded = async (a: SpeechAttempt) => {
    let attempt = a;
    try {
      if (aiReady && attempt.transcript.trim()) {
        setBusy('O professor está lendo a sua fala…');
        attempt = await endpoints.speech.evaluate(attempt.id);
        if (step.id === 'final' && attempt.hasAudio) {
          setBusy('O professor está ouvindo a sua voz…');
          attempt = await endpoints.speech.fullEvaluation(attempt.id).catch(() => attempt);
        }
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
    qc.setQueryData(qk.speechAttempt(attempt.id), attempt);
    await onRecorded(attempt);
  };
  return (
    <div className="space-y-4">
      <ScriptPreview project={project} data={data} />
      {existing && <AttemptSummary id={existing} />}
      {step.id === 'rehearsal2' && data.rehearsal1Id && data.rehearsal2Id && (
        <Link to={`/speaking/compare?a=${data.rehearsal1Id}&b=${data.rehearsal2Id}`} className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline">
          <Columns2 className="size-4" aria-hidden /> Comparar com o primeiro ensaio
        </Link>
      )}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" label="Avaliando" /> {busy}
        </p>
      ) : (
        <TalkRecorder
          persist
          startLabel={existing ? 'Gravar de novo' : step.id === 'final' ? 'Apresentar' : 'Começar o ensaio'}
          setup={{
            mode: project.topicId ? 'explain' : 'free',
            speechType: info.speechType,
            topicId: project.topicId,
            theme: project.title,
            targetSeconds: null,
            themeWords: [project.title],
            lessonId: step.id === 'rehearsal1' ? 'ensaio-1' : step.id === 'rehearsal2' ? 'ensaio-2' : 'final',
            projectId: project.id,
            keepAudio: true,
          }}
          onAttempt={(a) => void recorded(a)}
        />
      )}
    </div>
  );
}

function ReviewStep({ data, onEdit }: { data: ProjectData; onEdit: (step: number) => void }) {
  const { data: a } = useQuery({ queryKey: qk.speechAttempt(data.rehearsal1Id ?? ''), queryFn: () => endpoints.speech.get(data.rehearsal1Id!), enabled: !!data.rehearsal1Id });
  if (!data.rehearsal1Id) return <p className="text-sm text-muted">Grave o primeiro ensaio (etapa 7) antes da revisão.</p>;
  if (!a) return <Spinner className="size-4" />;
  const items = a.evaluation?.improvements.length
    ? a.evaluation.improvements
    : a.measured.filter((m) => m.state === 'improve').slice(0, 3).map((m) => ({ title: CRITERIA_INFO[m.id].label, detail: m.value, original: null, rewrite: null }));
  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-sm text-muted">O primeiro ensaio não tem pontos a melhorar marcados. Siga para o segundo ensaio.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((imp, i) => (
            <li key={i}>
              <Card className="p-4 text-sm">
                <p className="font-semibold">
                  {i + 1}. {imp.title}
                </p>
                <p className="mt-1 text-muted">{imp.detail}</p>
                {imp.rewrite && <p className="mt-2 rounded-lg bg-surface-2 p-2">“{imp.rewrite}”</p>}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {PROJECT_STEPS.filter((s) => s.kind === 'write').map((s) => (
          <Button key={s.id} size="sm" variant="ghost" onClick={() => onEdit(s.number)}>
            Editar: {s.title}
          </Button>
        ))}
      </div>
      {a.measured.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {a.measured
            .filter((m) => m.state !== 'na')
            .map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1">
                {CRITERIA_INFO[m.id].label} <StateBadge state={m.state} />
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: projectKey(id), queryFn: () => endpoints.speech.project(id) });
  const ai = useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
  const [data, setData] = useState<ProjectData | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const version = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Local edits not saved yet: a newer server copy must not overwrite them. */
  const dirty = useRef(false);

  // The draft follows the server copy whenever it is newer and nothing local is pending
  // (the first copy may come from the offline cache and be outdated).
  useEffect(() => {
    if (!query.data) return;
    if (data === null || (query.data.version > version.current && !dirty.current)) {
      setData(query.data.data);
      version.current = query.data.version;
    }
  }, [query.data, data]);

  const save = async (patch: { data?: ProjectData; step?: number; noteId?: string | null }) => {
    try {
      const p = await endpoints.speech.updateProject(id, { baseVersion: version.current, ...patch });
      version.current = p.version;
      dirty.current = false;
      qc.setQueryData(projectKey(id), p);
      void qc.invalidateQueries({ queryKey: projectsKey });
      return p;
    } catch (err) {
      if (isVersionConflict(err)) {
        toast.warning('O discurso foi alterado em outro aparelho: carregamos a versão mais recente.');
        const fresh = await qc.fetchQuery({ queryKey: projectKey(id), queryFn: () => endpoints.speech.project(id) });
        version.current = fresh.version;
        dirty.current = false;
        setData(fresh.data);
      } else {
        toast.error(errorMessage(err));
      }
      return null;
    }
  };

  /** Edits the draft and saves it shortly after the typing stops. */
  const edit = (patch: Partial<ProjectData>) => {
    const next = { ...data!, ...patch };
    setData(next);
    dirty.current = true;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => void save({ data: next }), 800);
  };
  useEffect(() => () => clearTimeout(pending.current), []);

  if (query.isPending || !data) return <PageLoader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const project = query.data;
  const aiReady = !!ai.data?.enabled && !!ai.data.configured;
  const current = selected ?? project.step;
  const step = PROJECT_STEPS[current - 1]!;
  const info = PROJECT_TYPE_INFO[project.type];

  const advance = async (extra: Partial<ProjectData> = {}) => {
    clearTimeout(pending.current);
    const nextData = { ...data, ...extra };
    setData(nextData);
    const nextStep = Math.min(PROJECT_STEPS.length, Math.max(project.step, step.number + 1));
    const p = await save({ data: nextData, step: nextStep });
    if (p) setSelected(Math.min(PROJECT_STEPS.length, step.number + 1));
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      clearTimeout(pending.current);
      const content = markdownToDoc(projectScript(project.title, project.type, data));
      if (project.noteId) {
        const note = await endpoints.notes.get(project.noteId);
        await endpoints.notes.update(project.noteId, { baseVersion: note.version, title: project.title, content });
      } else {
        const note = await endpoints.notes.create({ topicId: project.topicId, title: project.title, content });
        await save({ data, noteId: note.id });
      }
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      toast.success('Roteiro salvo como nota.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingNote(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este discurso?', description: 'Os ensaios continuam nas suas falas, e a nota do roteiro continua nas notas.', confirmLabel: 'Excluir', danger: true }))) return;
    await endpoints.speech.removeProject(id);
    void qc.invalidateQueries({ queryKey: projectsKey });
    void navigate('/speaking');
  };

  const done = (n: number) => n < project.step || (n === PROJECT_STEPS.length && !!data.finalId);

  return (
    <Page width="narrow">
      <PageHeader
        title={project.title}
        subtitle={
          <>
            {info.label} · {info.focus}
          </>
        }
        actions={
          <>
            <Button variant="outline" icon={<FileText className="size-4" />} loading={savingNote} onClick={() => void saveNote()}>
              {project.noteId ? 'Atualizar a nota' : 'Salvar como nota'}
            </Button>
            <Menu
              label="Ações do discurso"
              trigger={
                <IconButton label="Ações" variant="outline">
                  <Ellipsis className="size-4" />
                </IconButton>
              }
              items={[
                ...(project.noteId ? [{ label: 'Abrir a nota do roteiro', icon: <FileText />, onSelect: () => void navigate(`/notes/${project.noteId}`) }] : []),
                { label: 'Excluir', icon: <Trash />, danger: true, onSelect: () => void remove() },
              ]}
            />
          </>
        }
      />
      <nav aria-label="Etapas" className="scrollbar-none -mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {PROJECT_STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.number)}
            aria-current={s.number === current ? 'step' : undefined}
            disabled={s.number > project.step}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap disabled:opacity-40',
              s.number === current ? 'border-accent bg-accent text-accent-fg' : done(s.number) ? 'border-success-soft bg-success-soft text-success' : 'border-border',
            )}
          >
            {done(s.number) && s.number !== current ? <Check className="size-3" aria-label="Concluída" /> : <span className="tabular-nums">{s.number}</span>}
            {s.title}
          </button>
        ))}
      </nav>

      <section className="space-y-5">
        <header>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Etapa {step.number} de {PROJECT_STEPS.length}
          </p>
          <h2 className="text-xl font-semibold">{step.title}</h2>
          <RichText text={step.hint} className="mt-1 text-sm text-muted" />
        </header>

        {step.kind === 'write' && (
          <>
            <WriteStep step={step} project={project} data={data} set={edit} />
            <StepFeedback key={step.id} step={step} data={data} aiReady={aiReady} />
            <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} onClick={() => void advance()}>
              Concluir a etapa
            </Button>
          </>
        )}

        {(step.kind === 'rehearse' || step.kind === 'final') && (
          <RehearseStep
            key={step.id}
            step={step}
            project={project}
            data={data}
            aiReady={aiReady}
            onRecorded={async (a) => {
              const field = step.id === 'rehearsal1' ? 'rehearsal1Id' : step.id === 'rehearsal2' ? 'rehearsal2Id' : 'finalId';
              await advance({ [field]: a.id });
              if (step.id === 'final') toast.success('Discurso apresentado! Veja o resultado completo.');
            }}
          />
        )}

        {step.kind === 'review' && (
          <>
            <ReviewStep data={data} onEdit={setSelected} />
            <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} disabled={!data.rehearsal1Id} onClick={() => void advance()}>
              Pronto para o segundo ensaio
            </Button>
          </>
        )}

        {step.kind === 'board' && (
          <div className="space-y-4">
            {data.rehearsal2Id ? (
              <Link to={`/speaking/attempts/${data.rehearsal2Id}/banca`} className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2">
                <Gavel className="size-4" aria-hidden /> Abrir a banca sobre o segundo ensaio
              </Link>
            ) : (
              <p className="text-sm text-muted">Grave o segundo ensaio (etapa 9) antes da banca.</p>
            )}
            <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} disabled={!data.rehearsal2Id} onClick={() => void advance()}>
              Concluí a banca
            </Button>
          </div>
        )}
      </section>
    </Page>
  );
}
