import { ApiError } from '../../lib/errors';
import { first, num, stmt } from '../../lib/db';
import type { AiConfig, TokenUsage } from './config';

/**
 * AI spend per user and UTC day (ai_usage_daily), shared by every feature
 * that calls a model: the assistant and the speaking coach count against the
 * same daily budget.
 */

export function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

export function usageStatement(db: D1Database, userId: string, day: string, usage: TokenUsage, cost: number, requests: number) {
  return stmt(
    db,
    `INSERT INTO ai_usage_daily (user_id, day, requests, input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET
       requests = requests + excluded.requests,
       input_tokens = input_tokens + excluded.input_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
       cost_usd = cost_usd + excluded.cost_usd`,
    userId,
    day,
    requests,
    usage.inputTokens,
    usage.cachedTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    cost,
  );
}

/** Fails when today's spend (UTC) reached the daily budget; returns what was spent. */
export async function assertWithinBudget(db: D1Database, userId: string, cfg: AiConfig, today: string): Promise<number> {
  const row = await first(db, 'SELECT cost_usd FROM ai_usage_daily WHERE user_id = ? AND day = ?', userId, today);
  const spent = num(row?.cost_usd);
  if (cfg.dailyBudgetUsd !== null && spent >= cfg.dailyBudgetUsd) {
    throw new ApiError(
      'rate_limited',
      `O orçamento diário da IA (US$ ${cfg.dailyBudgetUsd.toFixed(2)}) foi atingido. Ele renova às 21h de Brasília (00h UTC).`,
      undefined,
      { 'Retry-After': String(secondsUntilUtcMidnight()) },
    );
  }
  return spent;
}
