import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, ErrorState, Progress, Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { useAiStatus } from '../assistant/use-assistant';

/**
 * Semantic index (vectors of notes, topics, books…): progress, "index now"
 * and rebuild. Indexing also runs every 10 minutes and when the assistant
 * opens; this is for the first time and after big imports.
 */
function IndexSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const index = useQuery({ queryKey: qk.aiIndex, queryFn: endpoints.ai.index, staleTime: 30_000 });
  const [running, setRunning] = useState(false);

  const run = async (reset: boolean) => {
    if (
      reset &&
      !(await confirm({
        title: 'Refazer o índice semântico?',
        description: 'Tudo é vetorizado de novo, aos poucos. As notas não mudam; a busca por palavras continua funcionando durante o processo.',
        confirmLabel: 'Refazer',
      }))
    ) {
      return;
    }
    setRunning(true);
    try {
      let first = true;
      for (let i = 0; i < 100; i++) {
        const res = await endpoints.ai.syncIndex({ reset: reset && first });
        first = false;
        qc.setQueryData(qk.aiIndex, { available: res.available, model: res.model, indexed: res.indexed, total: res.total });
        if (!res.more) break;
      }
      toast.success('Índice semântico atualizado');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: qk.aiIndex });
    }
  };

  if (index.isLoading) return <Spinner className="size-4" />;
  if (!index.data) return <p className="text-muted">Não foi possível ler o estado do índice.</p>;
  const { available, indexed, total, model } = index.data;
  const pct = total ? Math.min(100, (indexed / total) * 100) : 100;
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Busca por sentido (índice semântico)</h3>
      {!available ? (
        <p className="text-muted">
          Indisponível neste ambiente (Vectorize/Workers AI precisam dos bindings remotos). O assistente usa só a busca por palavras.
        </p>
      ) : (
        <>
          <p className="text-muted">
            {indexed} de {total} itens vetorizados com <span className="font-mono text-[13px]">{model}</span>. Atualiza sozinho a cada 10 minutos e ao abrir o
            assistente.
          </p>
          <Progress value={pct} label="Itens indexados" />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" loading={running} onClick={() => void run(false)}>
              Indexar agora
            </Button>
            <Button size="sm" variant="ghost" disabled={running} onClick={() => void run(true)}>
              Refazer índice
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const usd = (v: number) => `US$ ${v.toFixed(v < 0.01 ? 5 : 3)}`;
const int = (v: number) => v.toLocaleString('pt-BR');

/**
 * State and real usage of the AI assistant. Costs are computed by the server
 * from the token counts the OpenAI API reports, at the configured prices.
 */
export function AiSection() {
  const status = useAiStatus();
  if (status.isLoading) return <Spinner />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const total = s.usage.reduce(
    (acc, d) => ({
      requests: acc.requests + d.requests,
      input: acc.input + d.inputTokens,
      cached: acc.cached + d.cachedTokens,
      output: acc.output + d.outputTokens,
      cost: acc.cost + d.costUsd,
    }),
    { requests: 0, input: 0, cached: 0, output: 0, cost: 0 },
  );
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Situação</dt>
        <dd>
          {!s.enabled ? (
            <Badge tone="neutral">Desativado (AI_ENABLED=false)</Badge>
          ) : s.configured ? (
            <Badge tone="success">Ativo</Badge>
          ) : (
            <Badge tone="warning">Sem chave da OpenAI no servidor</Badge>
          )}
        </dd>
        <dt className="text-muted">Modelo</dt>
        <dd className="font-mono text-[13px]">{s.model}</dd>
        <dt className="text-muted">Gasto hoje (UTC)</dt>
        <dd>
          {usd(s.spentTodayUsd)}
          {s.dailyBudgetUsd !== null ? ` de ${usd(s.dailyBudgetUsd)} por dia` : ' (sem limite diário)'}
        </dd>
        <dt className="text-muted">Limites</dt>
        <dd>
          {s.limits.requestsPerMinute} mensagens/min · {s.limits.toolCallsPerTurn} consultas por mensagem · {int(s.limits.messageChars)} caracteres
        </dd>
        {s.pricing && (
          <>
            <dt className="text-muted">Preço usado (1M tokens)</dt>
            <dd>
              entrada US$ {s.pricing.inputPerMTok} · cache US$ {s.pricing.cachedInputPerMTok} · saída US$ {s.pricing.outputPerMTok}
            </dd>
          </>
        )}
      </dl>

      {s.enabled && s.configured && <IndexSection />}

      <div>
        <h3 className="mb-2 font-medium">Últimos 30 dias</h3>
        {s.usage.length === 0 ? (
          <p className="text-muted">Nenhum uso registrado.</p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-[13px] tabular-nums">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Dia</th>
                  <th className="py-1 text-right font-medium">Mensagens</th>
                  <th className="py-1 text-right font-medium">Entrada (cache)</th>
                  <th className="py-1 text-right font-medium">Saída</th>
                  <th className="py-1 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {s.usage.map((d) => (
                  <tr key={d.day}>
                    <td className="py-1">{d.day.split('-').reverse().join('/')}</td>
                    <td className="py-1 text-right">{int(d.requests)}</td>
                    <td className="py-1 text-right">
                      {int(d.inputTokens)} ({int(d.cachedTokens)})
                    </td>
                    <td className="py-1 text-right">{int(d.outputTokens)}</td>
                    <td className="py-1 text-right">{usd(d.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-medium">
                <tr>
                  <td className="py-1">Total</td>
                  <td className="py-1 text-right">{int(total.requests)}</td>
                  <td className="py-1 text-right">
                    {int(total.input)} ({int(total.cached)})
                  </td>
                  <td className="py-1 text-right">{int(total.output)}</td>
                  <td className="py-1 text-right">{usd(total.cost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        O custo é calculado com os tokens informados pela OpenAI em cada resposta e os preços configurados no servidor; o valor oficial está no painel de uso da
        OpenAI. <Link to="/assistant" className="text-accent hover:underline">Abrir o assistente</Link>
      </p>
    </div>
  );
}
