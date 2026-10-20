import { Link } from 'react-router';
import { Badge, ErrorState, Spinner } from '@/components/ui/feedback';
import { useAiStatus } from '../assistant/use-assistant';

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
