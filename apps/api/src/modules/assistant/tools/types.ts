import type { z } from 'zod';
import type { AiAction, AiContext, AiSource, AiToolKind, NoteRole, SearchEntityType } from '@mynotes/shared';

/**
 * JSON Schema builders for OpenAI strict function calling: every property is
 * required and optional values are expressed as `null`. Only keywords that
 * strict mode accepts are used; lengths and formats are enforced again by the
 * Zod schema of each tool.
 */
type Json = Record<string, unknown>;
const withDesc = (schema: Json, description?: string): Json => (description ? { ...schema, description } : schema);

export const S = {
  str: (description?: string) => withDesc({ type: 'string' }, description),
  nstr: (description?: string) => withDesc({ type: ['string', 'null'] }, description),
  int: (description?: string) => withDesc({ type: 'integer' }, description),
  nint: (description?: string) => withDesc({ type: ['integer', 'null'] }, description),
  bool: (description?: string) => withDesc({ type: 'boolean' }, description),
  enum: (values: readonly string[], description?: string) => withDesc({ type: 'string', enum: [...values] }, description),
  nenum: (values: readonly string[], description?: string) =>
    withDesc({ type: ['string', 'null'], enum: [...values, null] }, description),
  arr: (items: Json, description?: string) => withDesc({ type: 'array', items }, description),
  narr: (items: Json, description?: string) => withDesc({ type: ['array', 'null'], items }, description),
  obj: (properties: Record<string, Json>, description?: string) =>
    withDesc({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, description),
};

/* ----------------------------------------------------------- sources -- */

export interface SourceInfo extends AiSource {
  /** read: the full item was returned to the model; seen: it appeared in a list or search. */
  depth: 'read' | 'seen';
}

/** Items returned to the model in this turn: citations are checked against them. */
export class SourceCollector {
  private readonly items = new Map<string, SourceInfo>();

  add(
    source: { type: SearchEntityType; id: string; title: string; role?: NoteRole | null; readingId?: string | null; page?: number | null },
    depth: 'read' | 'seen' = 'seen',
  ): void {
    const key = `${source.type}:${source.id}`;
    const prev = this.items.get(key);
    this.items.set(key, {
      type: source.type,
      id: source.id,
      title: source.title,
      role: source.role ?? prev?.role ?? null,
      readingId: source.readingId ?? prev?.readingId ?? null,
      page: source.page ?? prev?.page ?? null,
      depth: prev?.depth === 'read' || depth === 'read' ? 'read' : 'seen',
    });
  }

  get(type: string, id: string): SourceInfo | undefined {
    return this.items.get(`${type}:${id}`);
  }

  list(): SourceInfo[] {
    return [...this.items.values()];
  }
}

/* ---------------------------------------------------------- context -- */

export interface ToolContext {
  db: D1Database;
  userId: string;
  conversationId: string;
  /** Item the user is looking at (already verified). */
  focus: AiContext | null;
  sources: SourceCollector;
  /** Proposals and writes made in this turn. */
  actions: AiAction[];
  /**
   * Whether the user's message explicitly asks for a change. When false,
   * write tools only register proposals, whatever the model asked.
   */
  writeIntent: boolean;
  /** D1 statements run by tools in this request (`db` counts them) and how many they may use. */
  dbBudget: { used: number; limit: number };
}

/**
 * Wraps D1 to count the statements tools run — a batch counts each of its
 * statements — so a turn stays under the per-request query limit (50 on
 * Workers Free). The statements stay real D1 objects (batch() needs them).
 */
export function meteredDb(db: D1Database, meter: { used: number }): D1Database {
  const patch = (s: D1PreparedStatement): D1PreparedStatement => {
    const bind = s.bind.bind(s);
    const first = s.first.bind(s) as (...args: unknown[]) => Promise<unknown>;
    const all = s.all.bind(s);
    const run = s.run.bind(s);
    const raw = s.raw.bind(s) as (...args: unknown[]) => Promise<unknown>;
    return Object.assign(s, {
      bind: (...values: unknown[]) => patch(bind(...values)),
      first: (...args: unknown[]) => (meter.used++, first(...args)),
      all: () => (meter.used++, all()),
      run: () => (meter.used++, run()),
      raw: (...args: unknown[]) => (meter.used++, raw(...args)),
    }) as D1PreparedStatement;
  };
  return {
    prepare: (sql: string) => patch(db.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) => {
      meter.used += statements.length;
      return db.batch(statements);
    },
    exec: (sql: string) => {
      meter.used++;
      return db.exec(sql);
    },
    withSession: (...args: Parameters<D1Database['withSession']>) => db.withSession(...args),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

/** Result returned to the model (serialized as JSON). */
export type ToolOutput = Record<string, unknown>;

export interface ToolDef<A = unknown> {
  name: string;
  kind: AiToolKind;
  description: string;
  parameters: Json;
  args: z.ZodType<A>;
  /** D1 statements one call usually needs at most: a call starts only if the budget still has them. */
  dbCost: number;
  /** Short Portuguese description of the call for the activity list. */
  label: (args: A) => string;
  run: (ctx: ToolContext, args: A) => Promise<ToolOutput>;
}

/** Erases the argument type so tools of different shapes can share a list. */
export const defineTool = <A>(tool: ToolDef<A>): ToolDef<unknown> => tool as unknown as ToolDef<unknown>;

/** `mynotes:<type>/<id>`: how the model cites an item (rendered as a link by the app). */
export const linkOf = (type: string, id: string) => `mynotes:${type}/${id}`;

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return { text: `${space > max * 0.8 ? cut.slice(0, space) : cut}…`, truncated: true };
}

/** Quoted title for activity labels. */
export const q = (text: string, max = 60) => `“${truncate(text.replace(/\s+/g, ' ').trim(), max).text}”`;
