import { env } from 'cloudflare:workers';
import { vi } from 'vitest';
import { normalizeSearch } from '@mynotes/shared';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../src/modules/assistant/knowledge-index';

/*
 * Stand-ins for Workers AI embeddings and Vectorize (both only run remotely).
 * The "embedding" is a bag of words in which some words share a meaning, so a
 * test can show the semantic search finding a note without common keywords.
 */

const MEANING: Record<string, string> = {
  industrializacao: 'industria',
  industrial: 'industria',
  fabricas: 'industria',
  fabrica: 'industria',
  manufatura: 'industria',
  importacoes: 'importar',
  importacao: 'importar',
  substituicao: 'substituir',
  brasileira: 'brasil',
  brasil: 'brasil',
  nacional: 'brasil',
};

function dim(word: string): number {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % EMBEDDING_DIMENSIONS;
}

export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const w of normalizeSearch(text).split(/[^a-z0-9]+/)) {
    if (w.length < 3) continue;
    v[dim(MEANING[w] ?? w)]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

interface Stored {
  id: string;
  values: number[];
  namespace: string;
}

export class FakeVectorize {
  readonly vectors = new Map<string, Stored>();
  available = true;

  private check() {
    if (!this.available) throw new Error('Vectorize unavailable (simulated)');
  }
  async describe() {
    this.check();
    return { vectorsCount: this.vectors.size };
  }
  async upsert(vectors: { id: string; values: number[] | Float32Array; namespace?: string }[]) {
    this.check();
    for (const v of vectors) this.vectors.set(`${v.namespace ?? ''}|${v.id}`, { id: v.id, values: [...v.values], namespace: v.namespace ?? '' });
    return { ids: vectors.map((v) => v.id), count: vectors.length };
  }
  async deleteByIds(ids: string[]) {
    this.check();
    for (const key of [...this.vectors.keys()]) if (ids.includes(key.split('|')[1]!)) this.vectors.delete(key);
    return { ids, count: ids.length };
  }
  async query(vector: number[], opts: { topK?: number; namespace?: string } = {}) {
    this.check();
    const matches = [...this.vectors.values()]
      .filter((v) => v.namespace === (opts.namespace ?? ''))
      .map((v) => ({ id: v.id, score: v.values.reduce((s, x, i) => s + x * vector[i]!, 0) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK ?? 5);
    return { matches, count: matches.length };
  }
  async queryById(id: string, opts: { topK?: number; namespace?: string } = {}) {
    this.check();
    const v = this.vectors.get(`${opts.namespace ?? ''}|${id}`);
    return v ? this.query(v.values, opts) : { matches: [], count: 0 };
  }
  /** Vector ids of one user. */
  idsOf(namespace: string): string[] {
    return [...this.vectors.values()].filter((v) => v.namespace === namespace).map((v) => v.id).sort();
  }
}

/** Installs both fakes for the current test; returns the index and the embedding spy. */
export function installSemanticFakes() {
  const index = new FakeVectorize();
  (env as unknown as { VECTORIZE: unknown }).VECTORIZE = index;
  const embed = vi.spyOn(env.AI, 'run').mockImplementation((async (model: string, input: { text: string[] }) => {
    if (model !== EMBEDDING_MODEL) throw new Error(`unexpected model ${model}`);
    const data = input.text.map(fakeEmbedding);
    return { shape: [data.length, EMBEDDING_DIMENSIONS], data };
  }) as never);
  return { index, embed };
}
