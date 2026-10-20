import { Link } from 'react-router';
import { Check, Lock } from 'lucide-react';
import { METHOD_IDS, SPEECH_METHODS, learnedMethods } from '@mynotes/shared';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { cn } from '@/lib/cn';
import { useSpeechPath } from './use-speech-path';

/** The structure methods (docs/oratoria-trilha.md › Biblioteca de métodos). */
export function Component() {
  const path = useSpeechPath();
  const learned = new Set(path.data ? learnedMethods(new Set(path.data.completed)) : []);
  return (
    <Page width="narrow">
      <PageHeader
        title="Métodos de estrutura"
        subtitle={
          <>
            Modelos prontos para organizar uma fala. Cada um é ensinado numa unidade da trilha e depois fica disponível no treino livre e no Discurso do Dia.{' '}
            <Link to="/speaking" className="text-accent hover:underline">
              Voltar à trilha
            </Link>
          </>
        }
      />
      <div className="space-y-4">
        {METHOD_IDS.map((id) => {
          const m = SPEECH_METHODS[id];
          const ok = learned.has(id);
          return (
            <Card key={id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{m.name}</h2>
                  <p className="text-sm text-muted">{m.goodFor}</p>
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium', ok ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>
                  {ok ? <Check className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  {ok ? 'Aprendido' : `Unidade ${m.unit}`}
                </span>
              </div>
              <ol className="mt-4 space-y-1.5 text-sm">
                {m.parts.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {i + 1}. {p.name}:
                    </span>{' '}
                    <span className="text-muted">{p.hint}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                <span className="font-medium">Exemplo: </span>
                {m.example}
              </p>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
