import { WorkerEntrypoint } from 'cloudflare:workers';
import { runIsolatedTool, type IsolatedCall, type IsolatedResult } from './service';

/**
 * Runs one assistant tool per invocation, called by the chat turn through the
 * Worker's loopback binding (`exports.AssistantTools`). Each invocation gets
 * its own D1 query limit, so the number of reads in a turn is bounded by the
 * tool calls allowed, not by the queries of a single request. Named
 * entrypoints have no public URL: only this Worker can call it.
 */
export class AssistantTools extends WorkerEntrypoint<Env> {
  run(input: IsolatedCall): Promise<IsolatedResult> {
    return runIsolatedTool(this.env, input);
  }
}
