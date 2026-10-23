import { z } from 'zod';
import {
  KEY_POINTS_MAX,
  KEY_POINT_MAX,
  clozeIndices,
  clozePlain,
  isAiGraded,
  normalizeAligned,
  parseCloze,
  quoteFound,
  quoteKey,
  ratingForScore,
  sourceProbe,
  uuidv7,
  zRecallEvaluation,
  zReviewGenerate,
  zReviewProposalDecision,
  zReviewRecallCreate,
  type CardKind,
  type GeneratedKind,
  type RecallEvaluation,
  type ReviewCard,
  type ReviewEvaluation,
  type ReviewGenerate,
  type ReviewGenerateResult,
  type ReviewHelp,
  type ReviewProposal,
  type ReviewProposalDecision,
  type ReviewRecall,
  type ReviewRecallCreate,
  type ReviewVariants,
} from '@mynotes/shared';
import { ApiError, badRequest, notFound } from '../../lib/errors';
import { all, first, num, parseJson, placeholders, str, strOrNull, stmt, type Bindable, type Row } from '../../lib/db';
import { nowIso } from '../../lib/time';
import { aiConfig, costOf, requireReady } from '../assistant/config';
import { createResponse, outputText } from '../assistant/openai';
import { assertWithinBudget, usageStatement } from '../assistant/usage';
import { expandCards, getCard, getCards, insertCardStmt, type NewCard } from './cards';
import {
  EVALUATE_INSTRUCTIONS,
  EVALUATE_SCHEMA,
  HELP_INSTRUCTIONS,
  HELP_SCHEMA,
  RECALL_INSTRUCTIONS,
  RECALL_SCHEMA,
  VARIANTS_INSTRUCTIONS,
  VARIANTS_SCHEMA,
  generateInstructions,
  generateSchema,
} from './prompt';
import { NOTE_FROM, NOTE_LIVE, NOTE_TOPIC, scopeOf } from './scope';

/* -------------------------------------------------------------- model -- */

/**
 * One structured call to the model: checks the daily budget, records what
 * it cost (paid for even when the answer is unusable) and parses the JSON.
 */
async function ask<T>(
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
  console.info(JSON.stringify({ level: 'info', msg: `review ${call.name}`, input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens, cost_usd: cost, ms: Date.now() - started }));
  try {
    if (res.status !== 'completed') throw new Error(res.incompleteReason ?? res.status);
    return { value: call.parse.parse(JSON.parse(outputText(res.output))), model: cfg.model };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: `review ${call.name} unusable`, status: res.status, error: String(err).slice(0, 200) }));
    throw new ApiError('service_unavailable', call.failure);
  }
}

const cut = (s: string, max: number) => s.trim().slice(0, max);

/* ------------------------------------------------------------ sources -- */

interface Source {
  ref: string;
  type: 'note' | 'concept';
  id: string;
  title: string;
  topicId: string | null;
  /** What the model reads (and what quotes are checked against). */
  text: string;
}

/** Window of a long note: a different part each time questions are written from it. */
const NOTE_WINDOW = 3500;
const SOURCES_BUDGET = 14_000;

function heading(r: Row): string {
  const role = str(r.role);
  if (role === 'annotation') return `Anotação de “${str(r.reading_title) || 'livro'}”${r.page != null ? `, p. ${num(r.page)}` : ''}${str(r.title) ? ` — ${str(r.title)}` : ''}`;
  if (role === 'review') return `Resenha de “${str(r.reading_title) || 'livro'}”`;
  return str(r.title) || 'Nota sem título';
}

const shuffle = <T>(list: T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/** Starts a window at a paragraph or sentence when one is near. */
function tidyWindow(text: string, offset: number): string {
  if (offset === 0) return text;
  const cutAt = text.slice(0, 400).search(/\n|(?<=[.!?…])\s/);
  return cutAt >= 0 ? text.slice(cutAt + 1).trimStart() : text;
}

/**
 * Notes to write questions from: the ones with fewest questions first
 * (shuffled among equals, so asking again reads other notes), a window of
 * each long note that moves as it gets questions, within a size budget.
 */
async function noteSources(db: D1Database, userId: string, where: { topicIds: string[]; noteId: string | null }, budget = SOURCES_BUDGET, maxNotes = 8): Promise<Source[]> {
  const s = scopeOf(userId, where.noteId ? undefined : where.topicIds);
  const filter = where.noteId ? 'AND n.id = ?' : `AND ${s.has(NOTE_TOPIC)}`;
  const candidates = await all(
    db,
    `${s.cte}SELECT n.id, n.title, n.role, n.page, r.title AS reading_title, ${NOTE_TOPIC} AS topic_id, length(n.body_text) AS len,
        (SELECT COUNT(*) FROM review_cards c WHERE c.note_id = n.id) + (SELECT COUNT(*) FROM review_proposals p WHERE p.note_id = n.id) AS covered
       FROM ${NOTE_FROM} WHERE n.user_id = ? AND ${NOTE_LIVE} AND length(n.body_text) >= 60 ${filter}
      ORDER BY covered ASC, n.updated_at DESC LIMIT 40`,
    ...s.binds,
    userId,
    ...(where.noteId ? [where.noteId] : []),
  );
  // Least covered first; random order among notes equally covered.
  const byCovered = new Map<number, Row[]>();
  for (const r of candidates) byCovered.set(num(r.covered), [...(byCovered.get(num(r.covered)) ?? []), r]);
  const ordered = [...byCovered.keys()].sort((a, b) => a - b).flatMap((k) => shuffle(byCovered.get(k)!));

  const picked: { row: Row; offset: number; size: number }[] = [];
  let used = 0;
  for (const r of ordered) {
    if (picked.length >= maxNotes || used >= budget) break;
    const len = num(r.len);
    const size = Math.min(len, NOTE_WINDOW, budget - used);
    if (size < 200 && len > 200) continue;
    const windows = Math.max(1, Math.ceil(len / NOTE_WINDOW));
    const offset = len > NOTE_WINDOW ? Math.min(len - size, (num(r.covered) % windows) * NOTE_WINDOW) : 0;
    picked.push({ row: r, offset, size });
    used += size;
  }
  if (picked.length === 0) return [];
  const texts = await db.batch<{ id: string; text: string }>(picked.map((p) => stmt(db, 'SELECT id, substr(body_text, ?, ?) AS text FROM notes WHERE id = ?', p.offset + 1, p.size, str(p.row.id))));
  return picked.map((p, i) => ({
    ref: `N${i + 1}`,
    type: 'note' as const,
    id: str(p.row.id),
    title: heading(p.row),
    topicId: strOrNull(p.row.topic_id),
    text: tidyWindow(str(texts[i]?.results?.[0]?.text), p.offset),
  }));
}

async function conceptSources(db: D1Database, userId: string, topicIds: string[], max: number): Promise<Source[]> {
  if (max <= 0) return [];
  const s = scopeOf(userId, topicIds);
  const rows = await all(
    db,
    `${s.cte}SELECT k.id, k.name, k.description, k.topic_id FROM concepts k
      WHERE k.user_id = ? AND length(k.description) >= 40 AND ${s.has('k.topic_id')}
        AND (k.topic_id IS NULL OR k.topic_id IN (SELECT id FROM topics WHERE user_id = k.user_id AND deleted_at IS NULL))
      ORDER BY k.updated_at DESC LIMIT 30`,
    ...s.binds,
    userId,
  );
  return shuffle(rows)
    .slice(0, max)
    .map((r, i) => ({ ref: `C${i + 1}`, type: 'concept' as const, id: str(r.id), title: `Conceito: ${str(r.name)}`, topicId: strOrNull(r.topic_id), text: `${str(r.name)}: ${str(r.description).slice(0, 2000)}` }));
}

const RELATION_LABELS: Record<string, string> = {
  related: 'está relacionado a',
  references: 'cita',
  depends_on: 'depende de',
  part_of: 'é parte de',
  supports: 'sustenta',
  contrasts: 'contrasta com',
  example_of: 'é exemplo de',
};

/**
 * Pairs of notes or concepts linked in the graph (typed relations and
 * references written in notes) inside the selection, with their texts.
 */
async function connectionSources(db: D1Database, userId: string, topicIds: string[]): Promise<{ sources: Source[]; links: string[] }> {
  const s = scopeOf(userId, topicIds);
  const [notes, concepts] = await db.batch<{ id: string }>([
    stmt(db, `${s.cte}SELECT n.id FROM ${NOTE_FROM} WHERE n.user_id = ? AND ${NOTE_LIVE} AND length(n.body_text) >= 20 AND ${s.has(NOTE_TOPIC)}`, ...s.binds, userId),
    stmt(db, `${s.cte}SELECT k.id FROM concepts k WHERE k.user_id = ? AND length(k.description) >= 20 AND ${s.has('k.topic_id')}`, ...s.binds, userId),
  ]);
  const inScope = new Set([...(notes?.results ?? []).map((r) => `note:${r.id}`), ...(concepts?.results ?? []).map((r) => `concept:${r.id}`)]);
  const relations = await all(
    db,
    `SELECT source_type, source_id, target_type, target_id, kind, label FROM relations
      WHERE user_id = ? AND source_type IN ('note','concept') AND target_type IN ('note','concept')
     UNION ALL
     SELECT 'note', l.note_id, l.target_type, l.target_id, 'references', '' FROM note_links l JOIN notes n ON n.id = l.note_id
      WHERE n.user_id = ? AND l.target_type IN ('note','concept')
     LIMIT 1000`,
    userId,
    userId,
  );
  const pairs = shuffle(relations.filter((r) => inScope.has(`${str(r.source_type)}:${str(r.source_id)}`) && inScope.has(`${str(r.target_type)}:${str(r.target_id)}`) && str(r.source_id) !== str(r.target_id)));
  const chosen: Row[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const key = [str(p.source_id), str(p.target_id)].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(p);
    if (chosen.length >= 4) break;
  }
  if (chosen.length === 0) return { sources: [], links: [] };

  const sources = new Map<string, Source>();
  const sourceOf = async (type: string, id: string): Promise<Source | null> => {
    const key = `${type}:${id}`;
    const known = sources.get(key);
    if (known) return known;
    let src: Source | null = null;
    if (type === 'note') {
      const r = await first(db, `SELECT n.id, n.title, n.role, n.page, r.title AS reading_title, ${NOTE_TOPIC} AS topic_id, substr(n.body_text, 1, 2500) AS text FROM ${NOTE_FROM} WHERE n.id = ? AND n.user_id = ?`, id, userId);
      if (r) src = { ref: `N${[...sources.values()].filter((x) => x.type === 'note').length + 1}`, type: 'note', id, title: heading(r), topicId: strOrNull(r.topic_id), text: str(r.text) };
    } else {
      const r = await first(db, 'SELECT id, name, description, topic_id FROM concepts WHERE id = ? AND user_id = ?', id, userId);
      if (r) src = { ref: `C${[...sources.values()].filter((x) => x.type === 'concept').length + 1}`, type: 'concept', id, title: `Conceito: ${str(r.name)}`, topicId: strOrNull(r.topic_id), text: `${str(r.name)}: ${str(r.description).slice(0, 2000)}` };
    }
    if (src) sources.set(key, src);
    return src;
  };
  const links: string[] = [];
  for (const p of chosen) {
    const a = await sourceOf(str(p.source_type), str(p.source_id));
    const b = await sourceOf(str(p.target_type), str(p.target_id));
    if (a && b) links.push(`L${links.length + 1}: [${a.ref}] ${RELATION_LABELS[str(p.kind)] ?? 'está ligado a'} [${b.ref}]${str(p.label) ? ` (${str(p.label)})` : ''}`);
  }
  return { sources: [...sources.values()], links };
}

const sourcesText = (sources: Source[]) => sources.map((s) => `### [${s.ref}] ${s.title}\n${s.text}`).join('\n\n');

/* ----------------------------------------------------------- generate -- */

const zGenerated = z.object({
  items: z.array(
    z.object({
      kind: z.enum(['basic', 'cloze', 'open', 'essay']),
      source: z.string(),
      front: z.string(),
      back: z.string(),
      keyPoints: z.array(z.string()),
      quote: z.string(),
      connection: z.boolean(),
    }),
  ),
});
type GeneratedItem = z.infer<typeof zGenerated>['items'][number];

/**
 * Keeps only questions that are complete and grounded: the quote must be in
 * the source, cloze blanks must hide words of the source, and nothing may
 * repeat an existing question. Exported for tests.
 */
export function validGenerated(items: GeneratedItem[], sources: Source[], kinds: GeneratedKind[], existing: Set<string>, count: number) {
  const byRef = new Map(sources.map((s) => [s.ref.toUpperCase(), s]));
  const seen = new Set(existing);
  const out: { item: GeneratedItem; source: Source }[] = [];
  let discarded = 0;
  for (const raw of items) {
    const item = {
      ...raw,
      front: cut(raw.front, 1500),
      back: cut(raw.back, 3000),
      keyPoints: raw.keyPoints.map((p) => cut(p, KEY_POINT_MAX)).filter(Boolean).slice(0, KEY_POINTS_MAX),
      quote: cut(raw.quote, 1000),
    };
    const source = byRef.get(item.source.trim().replace(/^\[|\]$/g, '').toUpperCase());
    const plain = item.kind === 'cloze' ? clozePlain(item.front) : item.front;
    const key = quoteKey(plain);
    const ok =
      out.length < count &&
      kinds.includes(item.kind) &&
      !!source &&
      quoteFound(source.text, item.quote) &&
      key.length >= 8 &&
      !seen.has(key) &&
      (item.kind !== 'basic' || item.back.length > 0) &&
      (item.kind !== 'open' || item.keyPoints.length >= 1 || item.back.length > 0) &&
      (item.kind !== 'essay' || item.keyPoints.length >= 2) &&
      (item.kind !== 'cloze' ||
        (clozeIndices(item.front).length >= 1 && clozeIndices(item.front).length <= 3 && parseCloze(item.front).every((b) => quoteKey(source.text).includes(quoteKey(b.answer)))));
    if (!ok) {
      discarded++;
      continue;
    }
    seen.add(key);
    out.push({ item, source: source! });
  }
  return { valid: out, discarded };
}

function toProposal(r: Row): ReviewProposal {
  return {
    id: str(r.id),
    batchId: str(r.batch_id),
    kind: str(r.kind) as CardKind,
    origin: str(r.origin) as ReviewProposal['origin'],
    front: str(r.front),
    back: str(r.back),
    keyPoints: parseJson<string[]>(r.key_points, []),
    sourceQuote: str(r.source_quote),
    noteId: strOrNull(r.note_id),
    noteTitle: r.note_id == null ? null : str(r.note_title),
    topicId: strOrNull(r.topic_id),
    createdAt: str(r.created_at),
  };
}

const PROPOSAL_COLUMNS = 'p.*, n.title AS note_title';

export async function listProposals(db: D1Database, userId: string, q: { batchId?: string | undefined; topicIds?: string[] | undefined }): Promise<ReviewProposal[]> {
  const s = scopeOf(userId, q.topicIds);
  const rows = await all(
    db,
    `${s.cte}SELECT ${PROPOSAL_COLUMNS} FROM review_proposals p LEFT JOIN notes n ON n.id = p.note_id
      WHERE p.user_id = ? AND ${s.has('p.topic_id')}${q.batchId ? ' AND p.batch_id = ?' : ''} ORDER BY p.created_at, p.rowid LIMIT 300`,
    ...s.binds,
    userId,
    ...(q.batchId ? [q.batchId] : []),
  );
  return rows.map(toProposal);
}

/**
 * The AI writes questions from the notes of the selection (or one note).
 * They wait for approval as proposals; nothing enters the reviews before
 * the user accepts it.
 */
export async function generateQuestions(env: Env, userId: string, raw: ReviewGenerate): Promise<ReviewGenerateResult> {
  const input = zReviewGenerate.parse(raw);
  const db = env.DB;
  const connections = input.focus === 'connections' && !input.noteId;
  let sources: Source[];
  let links: string[] = [];
  if (connections) {
    ({ sources, links } = await connectionSources(db, userId, input.topicIds));
    if (sources.length === 0) {
      throw badRequest('Não há ligações entre as notas destes assuntos. Ligue notas e conceitos no grafo (ou cite uma nota em outra) e tente de novo, ou gere perguntas sobre as notas.');
    }
  } else {
    if (input.noteId && !(await first(db, 'SELECT 1 AS ok FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', input.noteId, userId))) throw notFound('Nota');
    sources = await noteSources(db, userId, { topicIds: input.topicIds, noteId: input.noteId });
    const room = SOURCES_BUDGET - sources.reduce((n, s) => n + s.text.length, 0);
    if (!input.noteId) sources.push(...(await conceptSources(db, userId, input.topicIds, room > 1500 ? 3 : 0)));
    if (sources.length === 0) {
      throw badRequest(input.noteId ? 'Esta nota tem pouco texto para gerar perguntas.' : 'Os assuntos escolhidos ainda não têm notas com texto suficiente para gerar perguntas.');
    }
  }

  const noteIds = sources.filter((s) => s.type === 'note').map((s) => s.id);
  const existingRows = noteIds.length
    ? await all(
        db,
        `SELECT front, kind FROM review_cards WHERE user_id = ? AND note_id IN (${placeholders(noteIds.length)})
         UNION ALL SELECT front, kind FROM review_proposals WHERE user_id = ? AND note_id IN (${placeholders(noteIds.length)}) LIMIT 80`,
        userId,
        ...noteIds,
        userId,
        ...noteIds,
      )
    : [];
  const existing = existingRows.map((r) => (str(r.kind) === 'cloze' ? clozePlain(str(r.front)) : str(r.front)));
  const message = [
    `Escreva ${input.count} itens.`,
    '',
    'Fontes:',
    sourcesText(sources),
    ...(links.length ? ['', 'Ligações:', ...links] : []),
    '',
    existing.length ? `Perguntas que já existem (não repita):\n${existing.slice(0, 60).map((e) => `- ${e.slice(0, 200)}`).join('\n')}` : 'Ainda não há perguntas sobre estas fontes.',
  ].join('\n');

  const { value } = await ask(env, userId, {
    name: 'review_questions',
    instructions: generateInstructions(input.kinds, connections),
    message,
    schema: generateSchema(input.kinds),
    parse: zGenerated,
    maxOutputTokens: 6000,
    failure: 'A IA não conseguiu escrever as perguntas desta vez. Tente de novo.',
  });
  const { valid, discarded } = validGenerated(value.items, sources, input.kinds, new Set(existing.map(quoteKey)), input.count);

  const batchId = uuidv7();
  const now = nowIso();
  if (valid.length) {
    await db.batch(
      valid.map(({ item, source }) =>
        stmt(
          db,
          `INSERT INTO review_proposals (id, user_id, batch_id, topic_id, note_id, kind, origin, front, back, key_points, source_quote, source_probe, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uuidv7(),
          userId,
          batchId,
          source.topicId,
          source.type === 'note' ? source.id : null,
          item.kind,
          item.connection && connections ? 'relation' : 'ai',
          item.front,
          item.kind === 'cloze' ? '' : item.back,
          JSON.stringify(item.kind === 'open' || item.kind === 'essay' ? item.keyPoints : []),
          item.quote,
          source.type === 'note' ? sourceProbe(source.text, item.quote) : '',
          now,
        ),
      ),
    );
  }
  return { batchId, proposals: await listProposals(db, userId, { batchId }), discarded, notesRead: sources.length };
}

/** Accepted proposals become cards (edited as the user left them); the rest are discarded. */
export async function decideProposals(db: D1Database, userId: string, raw: ReviewProposalDecision): Promise<{ created: ReviewCard[]; discarded: number }> {
  const input = zReviewProposalDecision.parse(raw);
  const ids = [...new Set([...input.accept.map((a) => a.id), ...input.discard])];
  if (ids.length === 0) return { created: [], discarded: 0 };
  const rows = await all(
    db,
    `SELECT p.*, n.id AS live_note FROM review_proposals p LEFT JOIN notes n ON n.id = p.note_id AND n.deleted_at IS NULL
      WHERE p.user_id = ? AND p.id IN (${placeholders(ids.length)})`,
    userId,
    ...ids,
  );
  const byId = new Map(rows.map((r) => [str(r.id), r]));
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  const createdIds: string[] = [];
  for (const a of input.accept) {
    const p = byId.get(a.id);
    if (!p) continue;
    const kind = str(p.kind) as CardKind;
    const front = a.front ?? str(p.front);
    if (kind === 'cloze' && clozeIndices(front).length === 0) throw badRequest('Uma lacuna aprovada ficou sem {{c1::…}}');
    const cards: NewCard[] = expandCards(
      { kind, front, back: a.back ?? str(p.back), keyPoints: a.keyPoints ?? parseJson<string[]>(p.key_points, []), topicId: strOrNull(p.topic_id), noteId: strOrNull(p.live_note), sourceQuote: str(p.source_quote), reverse: false },
      { origin: str(p.origin) as NewCard['origin'], topicId: strOrNull(p.topic_id), noteId: strOrNull(p.live_note), sourceQuote: str(p.source_quote), sourceProbe: p.live_note ? str(p.source_probe) : '' },
    );
    const groupId = uuidv7();
    cards.forEach((c, i) => {
      const id = i === 0 ? groupId : uuidv7();
      createdIds.push(id);
      statements.push(insertCardStmt(db, userId, id, groupId, c, now));
    });
  }
  statements.push(stmt(db, `DELETE FROM review_proposals WHERE user_id = ? AND id IN (${placeholders(ids.length)})`, userId, ...ids));
  await db.batch(statements);
  const discarded = input.discard.filter((id) => byId.has(id)).length;
  return { created: await getCards(db, userId, createdIds), discarded };
}

/* ----------------------------------------------------------- evaluate -- */

const zEvaluated = z.object({
  points: z.array(z.object({ point: z.string(), status: z.enum(['covered', 'partial', 'missing']), evidence: z.string() })),
  errors: z.array(z.object({ claim: z.string(), correction: z.string() })),
  noteIssue: z.string().nullable(),
  modelAnswer: z.string(),
  feedback: z.string(),
});

/** Score from the key points: covered 1, partial ½, each contradiction of the notes −15 (at most −45). */
export function scoreOf(points: { status: string }[], errors: number): number {
  if (points.length === 0) return 0;
  const base = (points.reduce((n, p) => n + (p.status === 'covered' ? 1 : p.status === 'partial' ? 0.5 : 0), 0) / points.length) * 100;
  return Math.max(0, Math.min(100, Math.round(base - Math.min(3, errors) * 15)));
}

/** The note around the quoted passage (or its beginning). */
async function noteExcerpt(db: D1Database, userId: string, noteId: string, quote: string, chars = 3000): Promise<{ title: string; text: string } | null> {
  const r = await first(db, 'SELECT title, body_text FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', noteId, userId);
  if (!r) return null;
  const body = str(r.body_text);
  if (body.length <= chars) return { title: str(r.title), text: body };
  const probe = sourceProbe(body, quote);
  const at = probe ? normalizeAligned(body).indexOf(probe) : -1;
  const start = at < 0 ? 0 : Math.max(0, Math.min(body.length - chars, at - Math.floor(chars / 2)));
  return { title: str(r.title), text: `${start > 0 ? '…' : ''}${body.slice(start, start + chars)}${start + chars < body.length ? '…' : ''}` };
}

/**
 * Corrects an answer to an open question or essay against the card's key
 * points and the note it came from (only the notes are the reference).
 */
export async function evaluateAnswer(env: Env, userId: string, cardId: string, input: { answer: string; prompt?: string | undefined }): Promise<ReviewEvaluation> {
  const db = env.DB;
  const card = await getCard(db, userId, cardId);
  if (!isAiGraded(card.kind)) throw badRequest('Só perguntas abertas e dissertações são corrigidas pela IA');
  const note = card.noteId ? await noteExcerpt(db, userId, card.noteId, card.sourceQuote) : null;
  const asked = input.prompt?.trim() && input.prompt.trim() !== card.front ? input.prompt.trim() : null;
  const message = [
    `Pergunta: ${asked ?? card.front}`,
    asked ? `(Pergunta original do cartão: ${card.front})` : '',
    card.keyPoints.length ? `Pontos-chave esperados:\n${card.keyPoints.map((p) => `- ${p}`).join('\n')}` : 'Pontos-chave: (não definidos)',
    card.back ? `Resposta modelo do cartão: ${card.back}` : '',
    card.sourceQuote ? `Trecho da nota de origem: «${card.sourceQuote}»` : '',
    note ? `Nota “${note.title || 'Sem título'}” (referência):\n${note.text}` : '',
    '',
    `Resposta do estudante:\n${input.answer.slice(0, 12_000)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const { value, model } = await ask(env, userId, {
    name: 'review_evaluation',
    instructions: EVALUATE_INSTRUCTIONS,
    message,
    schema: EVALUATE_SCHEMA,
    parse: zEvaluated,
    maxOutputTokens: 2500,
    failure: 'A correção da IA veio incompleta. Tente corrigir de novo.',
  });
  const points = value.points
    .map((p) => ({ point: cut(p.point, KEY_POINT_MAX), status: p.status, evidence: cut(p.evidence, 1000) }))
    .filter((p) => p.point)
    .slice(0, 8);
  if (points.length === 0) throw new ApiError('service_unavailable', 'A correção da IA veio incompleta. Tente corrigir de novo.');
  const errors = value.errors.map((e) => ({ claim: cut(e.claim, 500), correction: cut(e.correction, 1000) })).filter((e) => e.claim).slice(0, 5);
  const score = scoreOf(points, errors.length);
  return {
    points,
    errors,
    noteIssue: value.noteIssue?.trim() ? cut(value.noteIssue, 1000) : null,
    modelAnswer: cut(value.modelAnswer, 3000),
    feedback: cut(value.feedback, 1500),
    score,
    suggestedRating: ratingForScore(score),
    model,
    evaluatedAt: nowIso(),
  };
}

/* -------------------------------------------------------- free recall -- */

const zRecalled = z.object({
  ideas: z.array(z.object({ idea: z.string(), status: z.enum(['covered', 'partial', 'missing']), source: z.string(), quote: z.string(), evidence: z.string() })),
  errors: z.array(z.object({ claim: z.string(), correction: z.string(), source: z.string() })),
  summary: z.string(),
});

function toRecall(r: Row): ReviewRecall {
  const evaluation = zRecallEvaluation.safeParse(parseJson(r.evaluation_json, null));
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    topicTitle: str(r.topic_title) || 'Assunto excluído',
    sessionId: strOrNull(r.session_id),
    text: str(r.text),
    evaluation: evaluation.success ? evaluation.data : null,
    coverage: r.coverage == null ? null : num(r.coverage),
    localDay: str(r.local_day),
    createdAt: str(r.created_at),
  };
}

const RECALL_COLUMNS = 'rc.*, t.title AS topic_title';

export async function getRecall(db: D1Database, userId: string, id: string): Promise<ReviewRecall> {
  const r = await first(db, `SELECT ${RECALL_COLUMNS} FROM review_recalls rc LEFT JOIN topics t ON t.id = rc.topic_id WHERE rc.id = ? AND rc.user_id = ?`, id, userId);
  if (!r) throw notFound('Recordação');
  return toRecall(r);
}

export async function listRecalls(db: D1Database, userId: string, topicId: string | undefined, limit = 20): Promise<ReviewRecall[]> {
  const rows = await all(
    db,
    `SELECT ${RECALL_COLUMNS} FROM review_recalls rc LEFT JOIN topics t ON t.id = rc.topic_id
      WHERE rc.user_id = ?${topicId ? ' AND rc.topic_id = ?' : ''} ORDER BY rc.created_at DESC LIMIT ?`,
    userId,
    ...((topicId ? [topicId, limit] : [limit]) as Bindable[]),
  );
  return rows.map(toRecall);
}

/**
 * "Write everything you remember": the AI picks the main ideas of the
 * topic's notes (with a passage of each, checked) and marks which ones the
 * text covered. Coverage = covered + ½ partial, over the ideas kept.
 */
export async function createRecall(env: Env, userId: string, raw: ReviewRecallCreate): Promise<ReviewRecall> {
  const input = zReviewRecallCreate.parse(raw);
  const db = env.DB;
  const done = await first(db, 'SELECT id FROM review_recalls WHERE id = ? AND user_id = ?', input.id, userId);
  if (done) return getRecall(db, userId, input.id);
  const topic = await first(db, 'SELECT title FROM topics WHERE id = ? AND user_id = ? AND deleted_at IS NULL', input.topicId, userId);
  if (!topic) throw notFound('Assunto');
  if (input.sessionId && !(await first(db, 'SELECT 1 AS ok FROM review_sessions WHERE id = ? AND user_id = ?', input.sessionId, userId))) {
    throw badRequest('Sessão de revisão não existe');
  }
  const sources = await noteSources(db, userId, { topicIds: [input.topicId], noteId: null }, 16_000, 10);
  if (sources.length === 0) throw badRequest('Este assunto ainda não tem notas com texto para comparar.');

  const message = [`Assunto: ${str(topic.title)}`, '', 'Notas do estudante:', sourcesText(sources), '', `O que o estudante escreveu de memória:\n${input.text.slice(0, 12_000)}`].join('\n');
  const { value, model } = await ask(env, userId, {
    name: 'review_recall',
    instructions: RECALL_INSTRUCTIONS,
    message,
    schema: RECALL_SCHEMA,
    parse: zRecalled,
    maxOutputTokens: 4000,
    failure: 'A comparação da IA veio incompleta. Tente de novo.',
  });
  const byRef = new Map(sources.map((s) => [s.ref.toUpperCase(), s]));
  const refOf = (ref: string) => byRef.get(ref.trim().replace(/^\[|\]$/g, '').toUpperCase());
  const ideas = value.ideas.flatMap((i) => {
    const src = refOf(i.source);
    if (!src || !cut(i.idea, 300) || !quoteFound(src.text, i.quote)) return [];
    return [{ idea: cut(i.idea, 300), status: i.status, noteId: src.id, noteTitle: src.title, quote: cut(i.quote, 600), evidence: cut(i.evidence, 600) }];
  });
  if (ideas.length < 2) throw new ApiError('service_unavailable', 'A comparação da IA veio incompleta. Tente de novo.');
  const coverage = scoreOf(ideas, 0);
  const evaluation: RecallEvaluation = {
    ideas: ideas.slice(0, 14),
    errors: value.errors.map((e) => ({ claim: cut(e.claim, 500), correction: cut(e.correction, 1000), noteId: refOf(e.source)?.id ?? null })).filter((e) => e.claim).slice(0, 6),
    coverage,
    summary: cut(value.summary, 1500),
    model,
    evaluatedAt: nowIso(),
  };
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO review_recalls (id, user_id, topic_id, session_id, text, evaluation_json, coverage, local_day, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(input.id, userId, input.topicId, input.sessionId, input.text, JSON.stringify(evaluation), coverage, input.localDay, now, now)
    .run();
  return getRecall(db, userId, input.id);
}

/* -------------------------------------------------- help and variants -- */

const zHelped = z.object({
  diagnosis: z.string(),
  rewrite: z.object({ front: z.string(), back: z.string() }).nullable(),
  split: z.array(z.object({ front: z.string(), back: z.string() })),
  mnemonic: z.string().nullable(),
});

/** Help with a card that keeps being forgotten: a clearer version, smaller cards, a mnemonic. */
export async function cardHelp(env: Env, userId: string, cardId: string): Promise<ReviewHelp> {
  const card = await getCard(env.DB, userId, cardId);
  const note = card.noteId ? await noteExcerpt(env.DB, userId, card.noteId, card.sourceQuote, 2000) : null;
  const message = [
    `Tipo: ${card.kind}. Erros até agora: ${card.schedule.lapses}.`,
    `Frente: ${card.kind === 'cloze' ? clozePlain(card.front) : card.front}`,
    card.kind === 'cloze' ? `Lacunas: ${parseCloze(card.front).map((b) => b.answer).join(', ')}` : `Verso: ${card.back}`,
    card.keyPoints.length ? `Pontos-chave: ${card.keyPoints.join('; ')}` : '',
    note ? `Nota “${note.title}”:\n${note.text}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const { value } = await ask(env, userId, {
    name: 'review_help',
    instructions: HELP_INSTRUCTIONS,
    message,
    schema: HELP_SCHEMA,
    parse: zHelped,
    maxOutputTokens: 1500,
    failure: 'A IA não conseguiu sugerir nada desta vez. Tente de novo.',
  });
  const pair = (p: { front: string; back: string }) => ({ front: cut(p.front, 1000), back: cut(p.back, 2000) });
  return {
    diagnosis: cut(value.diagnosis, 500),
    rewrite: value.rewrite && value.rewrite.front.trim() ? pair(value.rewrite) : null,
    split: value.split.map(pair).filter((p) => p.front && p.back).slice(0, 4),
    mnemonic: value.mnemonic?.trim() ? cut(value.mnemonic, 600) : null,
  };
}

const zVaried = z.object({ items: z.array(z.object({ id: z.string(), prompt: z.string() })) });

/**
 * The same open questions asked another way (same key points), so the
 * answer is remembered, not the wording. Only for items answered before.
 */
export async function questionVariants(env: Env, userId: string, cardIds: string[]): Promise<ReviewVariants> {
  const cards = (await getCards(env.DB, userId, [...new Set(cardIds)])).filter((c) => isAiGraded(c.kind) && c.schedule.reps > 0);
  if (cards.length === 0) return { variants: [] };
  const message = cards
    .map((c, i) => `[Q${i + 1}] ${c.front}${c.keyPoints.length ? `\nPontos-chave: ${c.keyPoints.join('; ')}` : ''}`)
    .join('\n\n');
  const { value } = await ask(env, userId, {
    name: 'review_variants',
    instructions: VARIANTS_INSTRUCTIONS,
    message,
    schema: VARIANTS_SCHEMA,
    parse: zVaried,
    maxOutputTokens: 1500,
    failure: 'A IA não conseguiu variar as perguntas.',
  });
  const variants = value.items.flatMap((v) => {
    const card = cards[Number(v.id.replace(/\D/g, '')) - 1];
    const prompt = cut(v.prompt, 600);
    return card && prompt && quoteKey(prompt) !== quoteKey(card.front) ? [{ cardId: card.id, prompt }] : [];
  });
  return { variants };
}
