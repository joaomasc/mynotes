import { sha256 } from '../../lib/crypto';
import { all, num, str, strOrNull, stmt, type Row } from '../../lib/db';
import { isoBefore, nowIso } from '../../lib/time';

/**
 * Semantic index of the user's knowledge (assistant search).
 *
 * Notes, topics, books, documents and concepts are split into chunks,
 * embedded with Workers AI (bge-m3, multilingual) and stored in Cloudflare
 * Vectorize — one namespace per user, vector ids "<n|t|r|d|c>:<id>:<chunk>",
 * no text in the index. Everything here is DERIVED from D1: the index can be
 * dropped and rebuilt, and `knowledge_index` records what was embedded so
 * only changed items are processed.
 *
 * Indexing runs in its own requests (cron every 10 minutes, and
 * POST /ai/index/sync when the assistant opens), never inside a chat turn, so
 * it does not use the turn's D1 query budget. When Vectorize or Workers AI are
 * unavailable (local `wrangler dev --local`, quota), search falls back to text.
 */

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;

export const INDEXED_TYPES = ['note', 'topic', 'reading', 'document', 'concept'] as const;
export type IndexedType = (typeof INDEXED_TYPES)[number];
const PREFIX: Record<IndexedType, string> = { note: 'n', topic: 't', reading: 'r', document: 'd', concept: 'c' };
const BY_PREFIX = Object.fromEntries(Object.entries(PREFIX).map(([t, p]) => [p, t])) as Record<string, IndexedType>;

/** ~300 tokens per chunk, a little overlap so a sentence cut in half is still found. */
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
/** Long notes: only the first chunks are indexed (the text search still covers everything). */
const MAX_CHUNKS_PER_ITEM = 40;
/** Texts per Workers AI call. */
const EMBED_BATCH = 32;
/** Notes being edited are indexed once they settle (autosave would re-embed every few seconds). */
const SETTLE_SECONDS = 120;

export const vectorId = (type: IndexedType, id: string, chunk: number) => `${PREFIX[type]}:${id}:${chunk}`;

export function parseVectorId(vid: string): { type: IndexedType; id: string; chunk: number } | null {
  const [p, id, chunk] = vid.split(':');
  const type = BY_PREFIX[p ?? ''];
  if (!type || !id || !/^\d+$/.test(chunk ?? '')) return null;
  return { type, id, chunk: Number(chunk) };
}

/* -------------------------------------------------------------- chunks -- */

/**
 * Splits text at paragraph boundaries into chunks of up to CHUNK_CHARS (long
 * paragraphs at sentences, then words), each starting with the last
 * CHUNK_OVERLAP characters of the previous one. Deterministic: the same text
 * always gives the same chunks, so a chunk number found in the index maps
 * back to its text.
 */
export function chunkText(text: string, max = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const pieces: string[] = [];
  const pushPiece = (p: string) => {
    if (p.length <= max) return pieces.push(p);
    // A long paragraph: sentences, and words for anything still too long.
    let buf = '';
    for (const sentence of p.split(/(?<=[.!?…;:])\s+/)) {
      const parts = sentence.length > max ? (sentence.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) ?? [sentence]) : [sentence];
      for (const part of parts) {
        if (buf && buf.length + part.length + 1 > max) {
          pieces.push(buf.trim());
          buf = '';
        }
        buf += (buf ? ' ' : '') + part.trim();
      }
    }
    if (buf.trim()) pieces.push(buf.trim());
    return pieces.length;
  };
  for (const para of clean.split(/\n{2,}|\n(?=[-*•#>]|\d+[.)]\s)/)) if (para.trim()) pushPiece(para.trim());

  const chunks: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 1 > max) {
      chunks.push(cur);
      const tail = cur.slice(-overlap);
      cur = tail.slice(tail.indexOf(' ') + 1);
    }
    cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** The text indexed for an item and the line repeated at the top of each chunk. */
export interface IndexText {
  heading: string;
  body: string;
}

export function indexTextOf(type: IndexedType, r: Row): IndexText {
  switch (type) {
    case 'note': {
      const role = str(r.role);
      const book = strOrNull(r.reading_title);
      const page = r.page == null ? null : num(r.page);
      const title = str(r.title);
      const heading =
        role === 'annotation'
          ? `Anotação de “${book ?? 'livro'}”${page ? `, p. ${page}` : ''}${title ? ` — ${title}` : ''}`
          : role === 'review'
            ? `Resenha de “${book ?? 'livro'}”${title ? ` — ${title}` : ''}`
            : title || 'Nota sem título';
      const quote = str(r.quote);
      return { heading, body: `${quote ? `Trecho citado: ${quote}\n\n` : ''}${str(r.body_text)}` };
    }
    case 'topic':
      return { heading: `Assunto: ${str(r.title)}`, body: str(r.description) };
    case 'reading':
      return { heading: `Livro/leitura: ${str(r.title)}${str(r.author) ? ` — ${str(r.author)}` : ''}`, body: str(r.notes) };
    case 'document':
      return { heading: `Documento: ${str(r.title)} (${str(r.original_name)})`, body: str(r.description) };
    case 'concept':
      return { heading: `Conceito: ${str(r.name)}`, body: str(r.description) };
  }
}

/** Chunks with the item's heading on top (what is embedded). */
export function chunksOf(t: IndexText): string[] {
  const body = chunkText(t.body).slice(0, MAX_CHUNKS_PER_ITEM);
  return body.length ? body.map((c) => `${t.heading}\n${c}`) : [t.heading];
}

/* ------------------------------------------------------------- sources -- */

const NOTE_COLS = `n.id, n.user_id, n.updated_at, n.title, n.body_text, n.role, n.page, n.quote,
  (SELECT r.title FROM readings r WHERE r.id = n.reading_id) AS reading_title`;

/** Items whose text may have changed since they were indexed (or never were). */
const STALE_SQL: Record<IndexedType, string> = {
  note: `SELECT ${NOTE_COLS} FROM notes n LEFT JOIN knowledge_index k ON k.entity_type = 'note' AND k.entity_id = n.id
          WHERE n.user_id = ?1 AND n.deleted_at IS NULL AND n.updated_at < ?2
            AND (k.entity_id IS NULL OR k.source_updated_at <> n.updated_at OR k.model <> ?3)
          ORDER BY n.updated_at LIMIT ?4`,
  topic: `SELECT t.id, t.user_id, t.updated_at, t.title, t.description FROM topics t
           LEFT JOIN knowledge_index k ON k.entity_type = 'topic' AND k.entity_id = t.id
          WHERE t.user_id = ?1 AND t.deleted_at IS NULL AND t.updated_at < ?2
            AND (k.entity_id IS NULL OR k.source_updated_at <> t.updated_at OR k.model <> ?3)
          ORDER BY t.updated_at LIMIT ?4`,
  reading: `SELECT r.id, r.user_id, r.updated_at, r.title, r.author, r.notes FROM readings r
             LEFT JOIN knowledge_index k ON k.entity_type = 'reading' AND k.entity_id = r.id
            WHERE r.user_id = ?1 AND r.updated_at < ?2
              AND (k.entity_id IS NULL OR k.source_updated_at <> r.updated_at OR k.model <> ?3)
            ORDER BY r.updated_at LIMIT ?4`,
  document: `SELECT d.id, d.user_id, d.updated_at, d.title, d.original_name, d.description FROM documents d
              LEFT JOIN knowledge_index k ON k.entity_type = 'document' AND k.entity_id = d.id
             WHERE d.user_id = ?1 AND d.deleted_at IS NULL AND d.updated_at < ?2
               AND (k.entity_id IS NULL OR k.source_updated_at <> d.updated_at OR k.model <> ?3)
             ORDER BY d.updated_at LIMIT ?4`,
  concept: `SELECT c.id, c.user_id, c.updated_at, c.name, c.description FROM concepts c
             LEFT JOIN knowledge_index k ON k.entity_type = 'concept' AND k.entity_id = c.id
            WHERE c.user_id = ?1 AND c.updated_at < ?2
              AND (k.entity_id IS NULL OR k.source_updated_at <> c.updated_at OR k.model <> ?3)
            ORDER BY c.updated_at LIMIT ?4`,
};

/** Indexed items that no longer exist, are in the trash or belong to nobody: their vectors go. */
const GONE_SQL = `SELECT k.entity_type, k.entity_id, k.chunk_count FROM knowledge_index k
  WHERE k.user_id = ?1 AND (
    (k.entity_type = 'note' AND NOT EXISTS (SELECT 1 FROM notes x WHERE x.id = k.entity_id AND x.user_id = ?1 AND x.deleted_at IS NULL))
    OR (k.entity_type = 'topic' AND NOT EXISTS (SELECT 1 FROM topics x WHERE x.id = k.entity_id AND x.user_id = ?1 AND x.deleted_at IS NULL))
    OR (k.entity_type = 'reading' AND NOT EXISTS (SELECT 1 FROM readings x WHERE x.id = k.entity_id AND x.user_id = ?1))
    OR (k.entity_type = 'document' AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.id = k.entity_id AND x.user_id = ?1 AND x.deleted_at IS NULL))
    OR (k.entity_type = 'concept' AND NOT EXISTS (SELECT 1 FROM concepts x WHERE x.id = k.entity_id AND x.user_id = ?1))
  ) LIMIT ?2`;

/* ------------------------------------------------------------ embedding -- */

/** Embeddings for the given texts (bge-m3, 1024 dimensions), in order. */
export async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = (await ai.run(EMBEDDING_MODEL, { text: batch, truncate_inputs: true })) as { data?: number[][] };
    const data = res.data ?? [];
    if (data.length !== batch.length || data.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error(`unexpected embedding shape (${data.length}×${data[0]?.length ?? 0})`);
    }
    out.push(...data);
  }
  return out;
}

/* ----------------------------------------------------------------- sync -- */

export interface SyncResult {
  /** Items embedded (or confirmed unchanged) in this run. */
  processed: number;
  /** Items whose vectors were removed (deleted, trashed). */
  removed: number;
  /** More changes are waiting for another run. */
  more: boolean;
}

/**
 * Indexes what changed for one user, bounded per run: at most `maxItems`
 * items and `maxChunks` embedded chunks. A few D1 statements (one batch to
 * find changes, one to record them), Workers AI calls of 32 texts and one or
 * two Vectorize mutations.
 */
export async function syncKnowledgeIndex(
  env: Env,
  userId: string,
  opts: { maxItems?: number; maxChunks?: number; settleSeconds?: number } = {},
): Promise<SyncResult> {
  const db = env.DB;
  const maxItems = opts.maxItems ?? 30;
  const maxChunks = opts.maxChunks ?? 128;
  const settledBefore = isoBefore(opts.settleSeconds ?? SETTLE_SECONDS);
  const res = await db.batch<Row>([
    ...INDEXED_TYPES.map((t) => stmt(db, STALE_SQL[t], userId, settledBefore, EMBEDDING_MODEL, maxItems + 1)),
    stmt(db, GONE_SQL, userId, 200),
    stmt(db, 'SELECT entity_type, entity_id, content_hash, chunk_count FROM knowledge_index WHERE user_id = ?', userId),
  ]);
  const known = new Map((res[INDEXED_TYPES.length + 1]?.results ?? []).map((r) => [`${str(r.entity_type)}:${str(r.entity_id)}`, r]));
  const gone = res[INDEXED_TYPES.length]?.results ?? [];

  // Changed items, oldest first, across types.
  let candidates = INDEXED_TYPES.flatMap((type, i) => (res[i]?.results ?? []).map((row) => ({ type, row })));
  let more = INDEXED_TYPES.some((_, i) => (res[i]?.results?.length ?? 0) > maxItems);
  candidates.sort((a, b) => str(a.row.updated_at).localeCompare(str(b.row.updated_at)));
  if (candidates.length > maxItems) {
    candidates = candidates.slice(0, maxItems);
    more = true;
  }

  interface Pending {
    type: IndexedType;
    id: string;
    updatedAt: string;
    hash: string;
    chunks: string[];
    previous: number;
    embed: boolean;
  }
  const pending: Pending[] = [];
  let budget = maxChunks;
  for (const { type, row } of candidates) {
    const text = indexTextOf(type, row);
    const chunks = chunksOf(text);
    const hash = await sha256(`${text.heading}\n${text.body}`);
    const prev = known.get(`${type}:${str(row.id)}`);
    const unchanged = !!prev && str(prev.content_hash) === hash && num(prev.chunk_count) === chunks.length;
    if (!unchanged && chunks.length > budget) {
      more = true;
      if (pending.length > 0) break;
    }
    if (!unchanged) budget -= chunks.length;
    pending.push({
      type,
      id: str(row.id),
      updatedAt: str(row.updated_at),
      hash,
      chunks,
      previous: prev ? num(prev.chunk_count) : 0,
      embed: !unchanged,
    });
  }

  const toEmbed = pending.filter((p) => p.embed);
  const texts = toEmbed.flatMap((p) => p.chunks);
  const vectors = texts.length ? await embed(env.AI, texts) : [];
  const upserts: VectorizeVector[] = [];
  let v = 0;
  for (const p of toEmbed) {
    p.chunks.forEach((_, i) => upserts.push({ id: vectorId(p.type, p.id, i), values: vectors[v++]!, namespace: userId }));
  }
  // Fewer chunks than before, or the item is gone: delete the extra vectors.
  const deletes = [
    ...toEmbed.flatMap((p) => Array.from({ length: Math.max(0, p.previous - p.chunks.length) }, (_, i) => vectorId(p.type, p.id, p.chunks.length + i))),
    ...gone.flatMap((g) => Array.from({ length: num(g.chunk_count) }, (_, i) => vectorId(str(g.entity_type) as IndexedType, str(g.entity_id), i))),
  ];
  for (let i = 0; i < upserts.length; i += 1000) await env.VECTORIZE.upsert(upserts.slice(i, i + 1000));
  for (let i = 0; i < deletes.length; i += 1000) await env.VECTORIZE.deleteByIds(deletes.slice(i, i + 1000));

  const now = nowIso();
  const rows = pending.map((p) => ({
    entity_type: p.type,
    entity_id: p.id,
    source_updated_at: p.updatedAt,
    content_hash: p.hash,
    chunk_count: p.chunks.length,
  }));
  const statements: D1PreparedStatement[] = [];
  if (rows.length) {
    statements.push(
      stmt(
        db,
        `INSERT INTO knowledge_index (entity_type, entity_id, user_id, source_updated_at, content_hash, chunk_count, model, indexed_at)
         SELECT json_extract(value, '$.entity_type'), json_extract(value, '$.entity_id'), ?1, json_extract(value, '$.source_updated_at'),
                json_extract(value, '$.content_hash'), json_extract(value, '$.chunk_count'), ?2, ?3
           FROM json_each(?4) WHERE 1
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET source_updated_at = excluded.source_updated_at,
           content_hash = excluded.content_hash, chunk_count = excluded.chunk_count, model = excluded.model, indexed_at = excluded.indexed_at`,
        userId,
        EMBEDDING_MODEL,
        now,
        JSON.stringify(rows),
      ),
    );
  }
  if (gone.length) {
    statements.push(
      stmt(
        db,
        `DELETE FROM knowledge_index WHERE user_id = ?1 AND (entity_type || ':' || entity_id) IN (SELECT value FROM json_each(?2))`,
        userId,
        JSON.stringify(gone.map((g) => `${str(g.entity_type)}:${str(g.entity_id)}`)),
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  if (texts.length || deletes.length) {
    console.info(JSON.stringify({ level: 'info', msg: 'knowledge index', items: pending.length, chunks: texts.length, deleted: deletes.length, more }));
  }
  return { processed: pending.length, removed: gone.length, more: more || gone.length >= 200 };
}

/** Every user (cron). Bounded: one run per user per tick. */
export async function syncAllUsers(env: Env): Promise<void> {
  const users = await all<{ id: string }>(env.DB, 'SELECT id FROM users ORDER BY created_at DESC LIMIT 10');
  for (const u of users) {
    try {
      await syncKnowledgeIndex(env, u.id, { maxItems: 40, maxChunks: 160 });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'knowledge index sync failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }));
    }
  }
}

export interface IndexStatus {
  available: boolean;
  model: string;
  indexed: number;
  total: number;
}

/** How much of the user's knowledge is indexed (pending = total − indexed, roughly). */
export async function indexStatus(env: Env, userId: string): Promise<IndexStatus> {
  const row = await stmt(
    env.DB,
    `SELECT
       (SELECT COUNT(*) FROM knowledge_index WHERE user_id = ?1 AND model = ?2) AS indexed,
       (SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM topics WHERE user_id = ?1 AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM readings WHERE user_id = ?1)
       + (SELECT COUNT(*) FROM documents WHERE user_id = ?1 AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM concepts WHERE user_id = ?1) AS total`,
    userId,
    EMBEDDING_MODEL,
  ).first<Row>();
  const available = await env.VECTORIZE.describe().then(
    () => true,
    () => false,
  );
  return { available, model: EMBEDDING_MODEL, indexed: num(row?.indexed), total: num(row?.total) };
}

/** Forgets what was indexed: the next runs embed everything again (vectors are overwritten). */
export async function resetIndex(env: Env, userId: string): Promise<void> {
  await stmt(env.DB, 'DELETE FROM knowledge_index WHERE user_id = ?', userId).run();
}

/* --------------------------------------------------------------- search -- */

export interface SemanticHit {
  type: IndexedType;
  id: string;
  chunk: number;
  score: number;
}

/**
 * Items closest in meaning to the query (best chunk per item), or null when
 * semantic search is unavailable (bindings off, quota) — callers then rely on
 * the text search alone.
 */
export async function semanticSearch(env: Env, userId: string, query: string, topK = 24): Promise<SemanticHit[] | null> {
  try {
    const [vector] = await embed(env.AI, [query.slice(0, 2000)]);
    const res = await env.VECTORIZE.query(vector!, { topK: Math.min(100, topK), namespace: userId, returnMetadata: 'none' });
    const best = new Map<string, SemanticHit>();
    for (const m of res.matches ?? []) {
      const parsed = parseVectorId(m.id);
      if (!parsed) continue;
      const key = `${parsed.type}:${parsed.id}`;
      if (!best.has(key) || best.get(key)!.score < m.score) best.set(key, { ...parsed, score: m.score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', msg: 'semantic search unavailable', error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
    return null;
  }
}

