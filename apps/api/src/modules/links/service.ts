import { z } from 'zod';
import {
  RELATION_KINDS,
  SUGGESTED_KINDS,
  uuidv7,
  zLinkAccept,
  type LinkAccept,
  type LinkSuggestion,
  type LinkSuggestionsResult,
  type LinkableType,
  type RelationKind,
  type RelationWithTitles,
} from '@mynotes/shared';
import { badRequest, notFound } from '../../lib/errors';
import { all, first, num, placeholders, str, strOrNull, stmt, type Bindable, type Row } from '../../lib/db';
import { isoBefore, nowIso } from '../../lib/time';
import { parseVectorId, vectorId } from '../assistant/knowledge-index';
import { askStructured } from '../assistant/structured';
import { S } from '../assistant/tools/types';
import { createRelation } from '../knowledge/service';

/**
 * Suggested links (docs/grafo-memoria.md › Ligações sugeridas): the semantic
 * index already holds every note and concept as vectors, so the neighbours
 * of an item are one query away. Pairs close in meaning that are not linked
 * yet become suggestions; the AI only explains them (kind and one sentence),
 * from the two texts, once per pair.
 */

/** Pairs below this similarity are not even stored. */
const STORE_MIN_SCORE = 0.5;
/** Shown from this similarity on (LINKS_MIN_SCORE overrides it, calibrated on real notes). */
const SHOW_MIN_SCORE = 0.62;
/** New suggestions kept per item scanned. */
const KEEP_PER_ITEM = 5;
/** Chunks of an item whose neighbours are searched (its beginning). */
const CHUNKS_PER_ITEM = 2;
const NEIGHBOURS = 12;
/** Items scanned per cron tick and user (each costs one or two Vectorize queries). */
const SCAN_PER_TICK = 15;
/** Vectors take a little while to be queryable after an upsert. */
const VISIBLE_AFTER_SECONDS = 90;

const PREFIX_TYPES = new Set<string>(['note', 'concept']);

export function showMinScore(env: Env): number {
  const raw = Number((env as unknown as { LINKS_MIN_SCORE?: string }).LINKS_MIN_SCORE);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : SHOW_MIN_SCORE;
}

interface Item {
  type: LinkableType;
  id: string;
}
const keyOf = (i: Item) => `${i.type}:${i.id}`;
/** Pairs are stored in a fixed order, so (a, b) and (b, a) are the same suggestion. */
export function orderPair(x: Item, y: Item): [Item, Item] {
  return keyOf(x) < keyOf(y) ? [x, y] : [y, x];
}
const pairKey = (x: Item, y: Item) => orderPair(x, y).map(keyOf).join('|');

/** Pairs already linked (relations, "/" references) or already suggested (any status). */
async function knownPairs(db: D1Database, userId: string): Promise<Set<string>> {
  const rows = await all(
    db,
    `SELECT source_type AS at, source_id AS ai, target_type AS bt, target_id AS bi FROM relations
      WHERE user_id = ? AND source_type IN ('note','concept') AND target_type IN ('note','concept')
     UNION ALL
     SELECT 'note', l.note_id, l.target_type, l.target_id FROM note_links l JOIN notes n ON n.id = l.note_id
      WHERE n.user_id = ? AND l.target_type IN ('note','concept')
     UNION ALL
     SELECT a_type, a_id, b_type, b_id FROM link_suggestions WHERE user_id = ?`,
    userId,
    userId,
    userId,
  );
  return new Set(rows.map((r) => pairKey({ type: str(r.at) as LinkableType, id: str(r.ai) }, { type: str(r.bt) as LinkableType, id: str(r.bi) })));
}

interface Scannable extends Item {
  chunks: number;
  hash: string;
  indexedAt: string;
}

/**
 * Searches the neighbours of some items and stores the new pairs (best
 * first, a few per item). An item whose queries fail is left for later.
 */
export async function scanItems(env: Env, userId: string, items: Scannable[]): Promise<{ scanned: number; found: number }> {
  if (items.length === 0) return { scanned: 0, found: 0 };
  const db = env.DB;
  const known = await knownPairs(db, userId);
  const now = nowIso();
  const inserts: Row[] = [];
  const done: string[] = [];
  for (const item of items) {
    let matches: { id: string; score: number }[];
    try {
      const ids = Array.from({ length: Math.max(1, Math.min(CHUNKS_PER_ITEM, item.chunks)) }, (_, i) => vectorId(item.type, item.id, i));
      // The index is a Vectorize V2 index (namespaces); the generated binding type is the older one, without queryById.
      const index = env.VECTORIZE as unknown as Vectorize;
      const results = await Promise.all(ids.map((vid) => index.queryById(vid, { topK: NEIGHBOURS, namespace: userId, returnMetadata: 'none' })));
      matches = results.flatMap((r) => r.matches ?? []);
      // A vector not queryable yet does not even find itself: try again on a later run (given up after an hour, so it never blocks the queue).
      if (!matches.some((m) => ids.includes(m.id)) && item.indexedAt > isoBefore(3600)) continue;
    } catch (err) {
      console.error(JSON.stringify({ level: 'warn', msg: 'link scan failed', error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
      continue;
    }
    const best = new Map<string, { other: Item; score: number }>();
    for (const m of matches) {
      const v = parseVectorId(m.id);
      if (!v || !PREFIX_TYPES.has(v.type) || (v.type === item.type && v.id === item.id) || m.score < STORE_MIN_SCORE) continue;
      const other = { type: v.type as LinkableType, id: v.id };
      const k = keyOf(other);
      if (!best.has(k) || best.get(k)!.score < m.score) best.set(k, { other, score: m.score });
    }
    const fresh = [...best.values()].filter((b) => !known.has(pairKey(item, b.other))).sort((a, b) => b.score - a.score).slice(0, KEEP_PER_ITEM);
    for (const f of fresh) {
      const [a, b] = orderPair(item, f.other);
      known.add(pairKey(a, b));
      inserts.push({ id: uuidv7(), a_type: a.type, a_id: a.id, b_type: b.type, b_id: b.id, score: Math.round(f.score * 1e4) / 1e4 });
    }
    done.push(keyOf(item));
  }
  const statements: D1PreparedStatement[] = [];
  if (inserts.length) {
    statements.push(
      stmt(
        db,
        `INSERT INTO link_suggestions (id, user_id, a_type, a_id, b_type, b_id, score, status, direction, reason, hidden, version, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.a_type'), json_extract(value, '$.a_id'), json_extract(value, '$.b_type'),
                json_extract(value, '$.b_id'), json_extract(value, '$.score'), 'open', 'ab', '', 0, 1, ?2, ?2
           FROM json_each(?3) WHERE 1
         ON CONFLICT (user_id, a_type, a_id, b_type, b_id) DO NOTHING`,
        userId,
        now,
        JSON.stringify(inserts),
      ),
    );
  }
  if (done.length) {
    statements.push(
      stmt(
        db,
        `UPDATE knowledge_index SET links_hash = content_hash WHERE user_id = ?1 AND (entity_type || ':' || entity_id) IN (SELECT value FROM json_each(?2))`,
        userId,
        JSON.stringify(done),
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  return { scanned: done.length, found: inserts.length };
}

const PENDING_SQL = `SELECT entity_type, entity_id, chunk_count, content_hash, indexed_at FROM knowledge_index
  WHERE user_id = ? AND entity_type IN ('note','concept') AND (links_hash IS NULL OR links_hash <> content_hash) AND indexed_at < ?
  ORDER BY indexed_at LIMIT ?`;

const toScannable = (r: Row): Scannable => ({
  type: str(r.entity_type) as LinkableType,
  id: str(r.entity_id),
  chunks: num(r.chunk_count),
  hash: str(r.content_hash),
  indexedAt: str(r.indexed_at),
});

/** Items indexed (or changed) since their last search, a few at a time. */
export async function scanPending(env: Env, userId: string, max = SCAN_PER_TICK): Promise<{ scanned: number; found: number; more: boolean }> {
  const rows = await all(env.DB, PENDING_SQL, userId, isoBefore(VISIBLE_AFTER_SECONDS), max + 1);
  const res = await scanItems(env, userId, rows.slice(0, max).map(toScannable));
  return { ...res, more: rows.length > max };
}

/** Cron: every user with items to scan, one small batch each. */
export async function scanAllUsers(env: Env): Promise<void> {
  try {
    const users = await all<{ user_id: string }>(
      env.DB,
      `SELECT DISTINCT user_id FROM knowledge_index WHERE entity_type IN ('note','concept') AND (links_hash IS NULL OR links_hash <> content_hash) AND indexed_at < ? LIMIT 20`,
      isoBefore(VISIBLE_AFTER_SECONDS),
    );
    for (const u of users) {
      const res = await scanPending(env, u.user_id);
      if (res.found) console.info(JSON.stringify({ level: 'info', msg: 'link suggestions', scanned: res.scanned, found: res.found }));
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'link scan cron failed', error: String(err).slice(0, 200) }));
  }
}

/* ------------------------------------------------------------- listing -- */

const END_SQL = (side: 'a' | 'b') => `
  LEFT JOIN notes n${side} ON s.${side}_type = 'note' AND n${side}.id = s.${side}_id AND n${side}.deleted_at IS NULL
  LEFT JOIN readings r${side} ON r${side}.id = n${side}.reading_id
  LEFT JOIN concepts k${side} ON s.${side}_type = 'concept' AND k${side}.id = s.${side}_id`;

const TITLE = (side: 'a' | 'b') =>
  `CASE WHEN n${side}.id IS NOT NULL THEN COALESCE(NULLIF(n${side}.title, ''), CASE WHEN r${side}.id IS NOT NULL THEN 'Anotação de ' || r${side}.title ELSE 'Nota sem título' END) ELSE k${side}.name END`;
const TOPIC = (side: 'a' | 'b') => `CASE WHEN n${side}.id IS NOT NULL THEN COALESCE(n${side}.topic_id, r${side}.topic_id) ELSE k${side}.topic_id END`;

/** Still worth showing: both items exist (not in the trash) and nothing links them yet. */
const LIVE = `(na.id IS NOT NULL OR ka.id IS NOT NULL) AND (nb.id IS NOT NULL OR kb.id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.user_id = s.user_id AND (
        (r.source_type = s.a_type AND r.source_id = s.a_id AND r.target_type = s.b_type AND r.target_id = s.b_id)
     OR (r.source_type = s.b_type AND r.source_id = s.b_id AND r.target_type = s.a_type AND r.target_id = s.a_id)))
  AND NOT EXISTS (SELECT 1 FROM note_links l WHERE
        (s.a_type = 'note' AND l.note_id = s.a_id AND l.target_type = s.b_type AND l.target_id = s.b_id)
     OR (s.b_type = 'note' AND l.note_id = s.b_id AND l.target_type = s.a_type AND l.target_id = s.a_id))`;

const SELECT_SQL = `SELECT s.*, ${TITLE('a')} AS a_title, ${TOPIC('a')} AS a_topic, ${TITLE('b')} AS b_title, ${TOPIC('b')} AS b_topic
  FROM link_suggestions s ${END_SQL('a')} ${END_SQL('b')}`;

function toSuggestion(r: Row): LinkSuggestion {
  return {
    id: str(r.id),
    a: { type: str(r.a_type) as LinkableType, id: str(r.a_id), title: str(r.a_title), topicId: strOrNull(r.a_topic) },
    b: { type: str(r.b_type) as LinkableType, id: str(r.b_id), title: str(r.b_title), topicId: strOrNull(r.b_topic) },
    score: num(r.score),
    kind: (strOrNull(r.kind) as RelationKind | null) ?? null,
    direction: str(r.direction) === 'ba' ? 'ba' : 'ab',
    reason: str(r.reason),
    explained: r.explained_at != null,
    status: str(r.status) as LinkSuggestion['status'],
    createdAt: str(r.created_at),
  };
}

async function suggestionRows(env: Env, userId: string, q: { item?: Item | undefined; ids?: string[] | undefined; limit: number }): Promise<LinkSuggestion[]> {
  let where = `s.user_id = ? AND s.status = 'open' AND s.hidden = 0 AND s.score >= ? AND ${LIVE}`;
  const binds: Bindable[] = [userId, showMinScore(env)];
  if (q.item) {
    where += ' AND ((s.a_type = ? AND s.a_id = ?) OR (s.b_type = ? AND s.b_id = ?))';
    binds.push(q.item.type, q.item.id, q.item.type, q.item.id);
  }
  if (q.ids) {
    where += ` AND s.id IN (${placeholders(q.ids.length)})`;
    binds.push(...q.ids);
  }
  const rows = await all(env.DB, `${SELECT_SQL} WHERE ${where} ORDER BY s.score DESC LIMIT ?`, ...binds, q.limit);
  return rows.map(toSuggestion);
}

/**
 * The open suggestions of one item (searched on the spot when its text
 * changed since the last search) or of everything (the graph).
 */
export async function listSuggestions(env: Env, userId: string, q: { type?: LinkableType | undefined; id?: string | undefined; limit: number }): Promise<LinkSuggestionsResult> {
  let pending = false;
  let unavailable = false;
  const item = q.type && q.id ? { type: q.type, id: q.id } : undefined;
  if (q.type && !q.id) throw badRequest('Informe o id do item');
  if (item) {
    const row = await first(env.DB, 'SELECT entity_type, entity_id, chunk_count, content_hash, links_hash, indexed_at FROM knowledge_index WHERE user_id = ? AND entity_type = ? AND entity_id = ?', userId, item.type, item.id);
    if (!row) pending = true;
    else if (strOrNull(row.links_hash) !== str(row.content_hash)) {
      if (str(row.indexed_at) > isoBefore(VISIBLE_AFTER_SECONDS)) pending = true;
      else {
        const res = await scanItems(env, userId, [toScannable(row)]);
        if (res.scanned === 0) unavailable = true;
      }
    }
  }
  return { suggestions: await suggestionRows(env, userId, { item, limit: item ? 5 : q.limit }), pending, unavailable };
}

/* ------------------------------------------------------------- explain -- */

const EXPLAIN_INSTRUCTIONS = `Você ajuda um estudante brasileiro a ligar as notas da base de conhecimento dele. Cada par (P1, P2…) tem dois textos, A e B, que um índice achou parecidos.

Para cada par, leia SÓ os dois textos e diga:
- "kind": a relação que existe de verdade entre eles: "depends_on" (um depende do outro para ser entendido), "part_of" (um é parte do outro), "supports" (um sustenta ou comprova o outro), "contrasts" (opõem-se ou diferem num ponto importante), "example_of" (um é exemplo do outro), "related" (mesmo tema, sem relação mais precisa) ou "none" (parecidos só nas palavras, sem ligação que valha registrar).
- "direction": "a_to_b" quando a frase é "A <relação> B" (ex.: A depende de B, A é exemplo de B); "b_to_a" no sentido contrário. Para "related" e "contrasts", "a_to_b".
- "reason": uma frase curta (até 25 palavras), falando do conteúdo, que explique a ligação — ou "" quando "none".
Não invente nada que não esteja nos textos. Escreva em português do Brasil.`;

const EXPLAIN_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      id: S.str(),
      kind: S.enum([...SUGGESTED_KINDS, 'none']),
      direction: S.enum(['a_to_b', 'b_to_a']),
      reason: S.str(),
    }),
  ),
});

const zExplained = z.object({
  items: z.array(z.object({ id: z.string(), kind: z.enum([...RELATION_KINDS, 'none']), direction: z.enum(['a_to_b', 'b_to_a']), reason: z.string() })),
});

async function itemTexts(db: D1Database, userId: string, items: Item[]): Promise<Map<string, string>> {
  const notes = [...new Set(items.filter((i) => i.type === 'note').map((i) => i.id))];
  const concepts = [...new Set(items.filter((i) => i.type === 'concept').map((i) => i.id))];
  const out = new Map<string, string>();
  if (notes.length) {
    for (const r of await all(db, `SELECT id, title, substr(body_text, 1, 1500) AS text FROM notes WHERE user_id = ? AND id IN (${placeholders(notes.length)})`, userId, ...notes)) {
      out.set(`note:${str(r.id)}`, `${str(r.title) || 'Nota sem título'}\n${str(r.text)}`);
    }
  }
  if (concepts.length) {
    for (const r of await all(db, `SELECT id, name, substr(description, 1, 1500) AS text FROM concepts WHERE user_id = ? AND id IN (${placeholders(concepts.length)})`, userId, ...concepts)) {
      out.set(`concept:${str(r.id)}`, `Conceito: ${str(r.name)}\n${str(r.text)}`);
    }
  }
  return out;
}

/**
 * The AI explains suggestions not explained yet: the kind of relation, its
 * direction and one sentence. Pairs it finds unrelated are hidden. Each pair
 * is explained once (the answer is kept).
 */
export async function explainSuggestions(env: Env, userId: string, ids: string[]): Promise<LinkSuggestion[]> {
  const rows = await all(env.DB, `SELECT * FROM link_suggestions WHERE user_id = ? AND explained_at IS NULL AND id IN (${placeholders(ids.length)})`, userId, ...ids);
  if (rows.length) {
    const texts = await itemTexts(env.DB, userId, rows.flatMap((r) => [{ type: str(r.a_type) as LinkableType, id: str(r.a_id) }, { type: str(r.b_type) as LinkableType, id: str(r.b_id) }]));
    const pairs = rows.filter((r) => texts.has(`${str(r.a_type)}:${str(r.a_id)}`) && texts.has(`${str(r.b_type)}:${str(r.b_id)}`));
    if (pairs.length) {
      const message = pairs
        .map((r, i) => `[P${i + 1}]\nA: ${texts.get(`${str(r.a_type)}:${str(r.a_id)}`)}\n\nB: ${texts.get(`${str(r.b_type)}:${str(r.b_id)}`)}`)
        .join('\n\n---\n\n');
      const { value } = await askStructured(env, userId, {
        name: 'link_explanations',
        instructions: EXPLAIN_INSTRUCTIONS,
        message,
        schema: EXPLAIN_SCHEMA,
        parse: zExplained,
        maxOutputTokens: 1500,
        failure: 'A IA não conseguiu explicar as ligações agora. Tente de novo.',
      });
      const now = nowIso();
      const statements = value.items.flatMap((x) => {
        const row = pairs[Number(x.id.replace(/\D/g, '')) - 1];
        if (!row) return [];
        const none = x.kind === 'none' || x.kind === 'references';
        return [
          stmt(
            env.DB,
            `UPDATE link_suggestions SET kind = ?, direction = ?, reason = ?, hidden = ?, explained_at = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND user_id = ? AND explained_at IS NULL`,
            none ? null : x.kind,
            x.direction === 'b_to_a' ? 'ba' : 'ab',
            x.reason.trim().slice(0, 400),
            none ? 1 : 0,
            now,
            now,
            str(row.id),
            userId,
          ),
        ];
      });
      if (statements.length) await env.DB.batch(statements);
    }
  }
  return suggestionRows(env, userId, { ids, limit: ids.length });
}

/* ------------------------------------------------------------ deciding -- */

async function openRow(db: D1Database, userId: string, id: string): Promise<Row> {
  const row = await first(db, "SELECT * FROM link_suggestions WHERE id = ? AND user_id = ? AND status = 'open'", id, userId);
  if (!row) throw notFound('Sugestão');
  return row;
}

/** Links the pair: a relation in the graph (kind and direction as suggested, or as chosen). */
export async function acceptSuggestion(db: D1Database, userId: string, id: string, raw: LinkAccept): Promise<{ relation: RelationWithTitles }> {
  const input = zLinkAccept.parse(raw);
  const row = await openRow(db, userId, id);
  const kind = input.kind ?? ((strOrNull(row.kind) as RelationKind | null) ?? 'related');
  const direction = input.direction ?? (str(row.direction) === 'ba' ? 'ba' : 'ab');
  const a = { type: str(row.a_type) as LinkableType, id: str(row.a_id) };
  const b = { type: str(row.b_type) as LinkableType, id: str(row.b_id) };
  const [source, target] = direction === 'ab' ? [a, b] : [b, a];
  const { relation } = await createRelation(db, userId, { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, kind, label: input.label });
  await db
    .prepare("UPDATE link_suggestions SET status = 'accepted', kind = ?, direction = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(kind, direction, nowIso(), id, userId)
    .run();
  return { relation };
}

/** Never suggested again. */
export async function dismissSuggestion(db: D1Database, userId: string, id: string): Promise<void> {
  await openRow(db, userId, id);
  await db.prepare("UPDATE link_suggestions SET status = 'dismissed', version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?").bind(nowIso(), id, userId).run();
}
