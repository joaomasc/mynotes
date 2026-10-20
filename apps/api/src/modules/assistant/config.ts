import { AI_MESSAGE_MAX } from '@mynotes/shared';
import { ApiError } from '../../lib/errors';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface AiPrices {
  /** USD per 1M tokens. */
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

export interface AiConfig {
  enabled: boolean;
  /** Never logged, returned or stored. */
  apiKey: string | null;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  maxOutputTokens: number;
  /**
   * Tool calls the model may make in one chat turn. Each runs in its own
   * Worker invocation; a request may have at most 32 (see MAX_TOOL_CALLS).
   */
  maxToolCalls: number;
  requestsPerMinute: number;
  /** null = no application budget ("none"). */
  dailyBudgetUsd: number | null;
  prices: AiPrices | null;
  timeoutMs: number;
  messageMax: number;
}

/** Secrets and vars the assistant reads (all optional in the generated Env type). */
type AiEnv = Partial<
  Record<
    | 'OPENAI_API_KEY'
    | 'OPENAI_MODEL'
    | 'AI_ENABLED'
    | 'AI_REASONING_EFFORT'
    | 'AI_MAX_OUTPUT_TOKENS'
    | 'AI_MAX_TOOL_CALLS'
    | 'AI_MAX_REQUESTS_PER_MINUTE'
    | 'AI_DAILY_BUDGET_USD'
    | 'AI_PRICE_INPUT_PER_MTOK'
    | 'AI_PRICE_CACHED_INPUT_PER_MTOK'
    | 'AI_PRICE_OUTPUT_PER_MTOK'
    | 'AI_TIMEOUT_SECONDS',
    string
  >
>;

const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_BUDGET_USD = 0.5;
/** Default and ceiling of AI_MAX_TOOL_CALLS: 30 tool invocations + the chat request stay under the 32 per request. */
const MAX_TOOL_CALLS = 30;

function intIn(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function nonNegative(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Reads the assistant configuration. Invalid or missing values fall back to
 * safe defaults (small limits, a daily budget), never to "unlimited".
 */
export function aiConfig(env: Env): AiConfig {
  const e = env as unknown as AiEnv;
  const key = e.OPENAI_API_KEY?.trim();
  const effort = e.AI_REASONING_EFFORT?.trim().toLowerCase();
  const budgetRaw = e.AI_DAILY_BUDGET_USD?.trim().toLowerCase();
  const input = nonNegative(e.AI_PRICE_INPUT_PER_MTOK);
  const output = nonNegative(e.AI_PRICE_OUTPUT_PER_MTOK);
  return {
    enabled: e.AI_ENABLED?.trim().toLowerCase() !== 'false',
    apiKey: key && key.startsWith('sk-') && !/EXEMPLO|replace|COLE/i.test(key) ? key : null,
    model: e.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    reasoningEffort: (REASONING_EFFORTS as readonly string[]).includes(effort ?? '') ? (effort as ReasoningEffort) : null,
    maxOutputTokens: intIn(e.AI_MAX_OUTPUT_TOKENS, 2000, 256, 16_000),
    maxToolCalls: intIn(e.AI_MAX_TOOL_CALLS, MAX_TOOL_CALLS, 0, MAX_TOOL_CALLS),
    requestsPerMinute: intIn(e.AI_MAX_REQUESTS_PER_MINUTE, 6, 1, 60),
    dailyBudgetUsd: budgetRaw === 'none' ? null : (nonNegative(budgetRaw) ?? DEFAULT_BUDGET_USD),
    prices:
      input !== null && output !== null
        ? { inputPerMTok: input, cachedInputPerMTok: nonNegative(e.AI_PRICE_CACHED_INPUT_PER_MTOK) ?? input, outputPerMTok: output }
        : null,
    timeoutMs: intIn(e.AI_TIMEOUT_SECONDS, 45, 5, 120) * 1000,
    messageMax: AI_MESSAGE_MAX,
  };
}

/** Fails with a clear, safe message when the assistant cannot run. */
export function requireReady(cfg: AiConfig): AiConfig & { apiKey: string } {
  if (!cfg.enabled) {
    throw new ApiError('service_unavailable', 'O assistente de IA está desativado nesta instalação (AI_ENABLED=false).');
  }
  if (!cfg.apiKey) {
    throw new ApiError(
      'service_unavailable',
      'O assistente de IA não está configurado: falta a chave da OpenAI (OPENAI_API_KEY) no servidor.',
    );
  }
  if (cfg.dailyBudgetUsd !== null && !cfg.prices) {
    // Without prices the spend cannot be measured, so the budget could not stop anything.
    throw new ApiError(
      'service_unavailable',
      'O orçamento diário da IA exige os preços do modelo (AI_PRICE_INPUT_PER_MTOK e AI_PRICE_OUTPUT_PER_MTOK).',
    );
  }
  return cfg as AiConfig & { apiKey: string };
}

export interface TokenUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** Cost of the usage reported by the API at the configured prices (0 when prices are unknown). */
export function costOf(usage: TokenUsage, prices: AiPrices | null): number {
  if (!prices) return 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const cost =
    uncached * prices.inputPerMTok + usage.cachedTokens * prices.cachedInputPerMTok + usage.outputTokens * prices.outputPerMTok;
  return Math.round((cost / 1e6) * 1e8) / 1e8;
}
