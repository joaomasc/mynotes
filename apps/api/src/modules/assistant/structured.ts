import type { z } from 'zod';
import { ApiError } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { aiConfig, costOf, requireReady } from './config';
import { createResponse, outputText } from './openai';
import { assertWithinBudget, usageStatement } from './usage';

/**
 * One structured call to the model (Revisar, suggested links): checks the
 * daily budget, records what it cost (paid for even when the answer is
 * unusable) and parses the JSON with the given schema.
 */
export async function askStructured<T>(
  env: Env,
  userId: string,
  call: { name: string; instructions: string; message: string; schema: Record<string, unknown>; parse: z.ZodType<T>; maxOutputTokens: number; failure: string },
): Promise<{ value: T; model: string }> {
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(env.DB, userId, cfg, today);
  const started = Date.now();
  const res = await createResponse(cfg, {
    instructions: call.instructions,
    input: [{ role: 'user', content: call.message }],
    tools: [],
    toolChoice: 'none',
    textFormat: { name: call.name, schema: call.schema },
    maxOutputTokens: Math.max(cfg.maxOutputTokens, call.maxOutputTokens),
  });
  const cost = costOf(res.usage, cfg.prices);
  await usageStatement(env.DB, userId, today, res.usage, cost, 1).run();
  console.info(JSON.stringify({ level: 'info', msg: `ai ${call.name}`, input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens, cost_usd: cost, ms: Date.now() - started }));
  try {
    if (res.status !== 'completed') throw new Error(res.incompleteReason ?? res.status);
    return { value: call.parse.parse(JSON.parse(outputText(res.output))), model: cfg.model };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: `ai ${call.name} unusable`, status: res.status, error: String(err).slice(0, 200) }));
    throw new ApiError('service_unavailable', call.failure);
  }
}
