import {
  EMPTY_DOC,
  RELATION_KIND_LABELS,
  keysBetween,
  normalizeSearch,
  normalizeTag,
  uuidv7,
  zMindMapData,
  type AiAction,
  type AiActionDecision,
  type AiActionStatus,
  type AiMessage,
  type AiPreviewLine,
  type AiSource,
  type GraphEntityType,
  type MindMapData,
  type RelationKind,
  type RichTextDoc,
  type RichTextNode,
} from '@mynotes/shared';
import { ApiError, notFound } from '../../lib/errors';
import { all, first, num, parseJson, str, strOrNull, stmt, type Row } from '../../lib/db';
import { entityKey, resolveEntities, type EntityRef, type EntityInfo } from '../../lib/entities';
import { SUBTREE_SQL } from '../../lib/helpers';
import { isoAfter, nowIso } from '../../lib/time';
import { createMindMap, getMindMap, updateMindMap } from '../knowledge/service';
import { createNote, getNoteRow, updateNote } from '../notes/service';
import { getTopicRow, moveTopic, topicSearchText, updateTopic } from '../topics/service';
import { markdownToDoc, referencesIn } from '@mynotes/shared';

/**
 * Writes the assistant can request. Each one has a *plan* (validates ids,
 * ownership, duplicates, cycles and versions against the database and builds
 * the preview shown to the user) and an *executor* that applies it through
 * the same services the app uses. Proposals store the validated arguments;
 * confirming re-plans against fresh data before writing.
 */

export const ACTION_TOOLS = [
  'create_note',
  'update_note',
  'create_topics',
  'update_topic',
  'move_topic',
  'create_relations',
  'create_mind_map',
] as const;
export type ActionTool = (typeof ACTION_TOOLS)[number];

export interface Plan<P = unknown> {
  tool: ActionTool;
  kind: 'write' | 'sensitive';
  title: string;
  preview: AiPreviewLine[];
  payload: P;
  /** Needs the user's confirmation even when the model asked to execute (batches, possible duplicates). */
  confirm: boolean;
  /** Set when nothing would change (everything already exists). */
  noop?: string;
}

export interface Execution {
  results: AiSource[];
  /** What happened, in Portuguese ("Criou 4 assuntos"). */
  summary: string;
  /** Returned to the model. */
  output: Record<string, unknown>;
}

/** A validation failure the model can fix (wrong id, conflict...). */
export class PlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

const PROPOSAL_TTL_SECONDS = 24 * 3600;
const line = (depth: number, label: string, state: AiPreviewLine['state'], detail: string | null = null): AiPreviewLine => ({
  depth,
  label,
  state,
  detail,
});
const source = (type: AiSource['type'], id: string, title: string, extra: Partial<AiSource> = {}): AiSource => ({
  type,
  id,
  title,
  role: null,
  readingId: null,
  page: null,
  ...extra,
});
const quoted = (t: string) => `“${t}”`;
const sameTitle = (a: string, b: string) => normalizeSearch(a) === normalizeSearch(b);

async function requireEntities(db: D1Database, userId: string, refs: EntityRef[]): Promise<Map<string, EntityInfo>> {
  const info = await resolveEntities(db, userId, refs);
  const missing = refs.filter((r) => !info.has(entityKey(r.type, r.id)));
  if (missing.length) {
    throw new PlanError(
      'invalid_reference',
      `Estes itens não existem (ou estão na lixeira): ${missing.map((m) => `${m.type}:${m.id}`).join(', ')}. Use apenas ids retornados pelas ferramentas.`,
      { missing },
    );
  }
  return info;
}

/* ===================================================== notes: create == */

export interface CreateNotePayload {
  title: string;
  topicId: string | null;
  markdown: string;
  tags: string[];
  references: EntityRef[];
  /** Page annotation of a book (a note with role "annotation"). */
  book: { readingId: string; page: number | null; quote: string } | null;
}

function tagText(tags: string[]): string {
  return tags
    .map((t) => t.trim().replace(/^#+/, '').replace(/\s+/g, '-'))
    .filter((t) => normalizeTag(t))
    .map((t) => `#${t}`)
    .join(' ');
}

/** The note's document: the Markdown, then a "Referências" line with "/" references and the #tags. */
function noteDoc(markdown: string, references: EntityRef[], tags: string[], info: Map<string, EntityInfo>): RichTextDoc {
  const doc = markdownToDoc(markdown);
  const inline = new Set(referencesIn(doc).map((r) => `${r.type}:${r.id}`));
  // Labels are display snapshots: the app always shows the current title.
  const fix = (node: RichTextNode) => {
    if (node.type === 'reference') {
      const href = String(node.attrs?.href ?? '');
      const [type, id] = href.slice('mynotes:'.length).split('/');
      const title = info.get(entityKey(type ?? '', id ?? ''))?.title;
      if (title && node.attrs) node.attrs.label = title;
    }
    node.content?.forEach(fix);
  };
  doc.content.forEach(fix);
  const extra = references.filter((r) => !inline.has(`${r.type}:${r.id}`));
  if (extra.length) {
    const content: RichTextNode[] = [{ type: 'text', text: 'Referências: ', marks: [{ type: 'bold' }] }];
    extra.forEach((r, i) => {
      if (i > 0) content.push({ type: 'text', text: ', ' });
      content.push({
        type: 'reference',
        attrs: { href: `mynotes:${r.type}/${r.id}`, label: info.get(entityKey(r.type, r.id))?.title ?? '', heading: null },
      });
    });
    doc.content.push({ type: 'paragraph', content });
  }
  const tagLine = tagText(tags);
  if (tagLine) doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: tagLine }] });
  return doc;
}

const wordCount = (markdown: string) => markdown.split(/\s+/).filter(Boolean).length;

async function noteRefsInfo(db: D1Database, userId: string, p: CreateNotePayload | { markdown: string; references: EntityRef[] }) {
  const inline = referencesIn(markdownToDoc(p.markdown)) as EntityRef[];
  return requireEntities(db, userId, [...inline, ...p.references]);
}

export async function planCreateNote(db: D1Database, userId: string, p: CreateNotePayload): Promise<Plan<CreateNotePayload>> {
  const info = await noteRefsInfo(db, userId, p);
  const checks: EntityRef[] = [];
  if (p.topicId) checks.push({ type: 'topic', id: p.topicId });
  if (p.book) checks.push({ type: 'reading', id: p.book.readingId });
  const owners = await requireEntities(db, userId, checks);
  const topicTitle = p.topicId ? owners.get(entityKey('topic', p.topicId))!.title : null;
  const bookTitle = p.book ? owners.get(entityKey('reading', p.book.readingId))!.title : null;
  const duplicate = p.title
    ? await first<Row>(
        db,
        'SELECT id FROM notes WHERE user_id = ? AND topic_id IS ? AND deleted_at IS NULL AND title = ? COLLATE NOCASE LIMIT 1',
        userId,
        p.topicId,
        p.title.normalize('NFC'),
      )
    : null;
  const preview = [
    line(0, p.title || 'Sem título', 'new', `${wordCount(p.markdown)} palavras${topicTitle ? ` · em ${quoted(topicTitle)}` : ' · sem assunto'}`),
  ];
  if (bookTitle) preview.push(line(1, `Anotação de ${quoted(bookTitle)}${p.book?.page ? `, p. ${p.book.page}` : ''}`, 'new'));
  if (p.references.length) {
    preview.push(line(1, `Referências: ${p.references.map((r) => info.get(entityKey(r.type, r.id))?.title || 'Sem título').join(', ')}`, 'new'));
  }
  if (p.tags.length) preview.push(line(1, tagText(p.tags), 'new'));
  if (duplicate) preview.push(line(1, 'Já existe uma nota com este título neste lugar', 'existing'));
  return {
    tool: 'create_note',
    kind: 'write',
    title: `${p.book ? 'Criar anotação' : 'Criar nota'} ${quoted(p.title || 'Sem título')}`,
    preview,
    payload: p,
    confirm: !!duplicate,
  };
}

async function executeCreateNote(db: D1Database, userId: string, p: CreateNotePayload): Promise<Execution> {
  const info = await noteRefsInfo(db, userId, p);
  const { note } = await createNote(db, userId, {
    topicId: p.topicId,
    title: p.title,
    content: noteDoc(p.markdown, p.references, p.tags, info),
    role: p.book ? 'annotation' : 'note',
    readingId: p.book?.readingId ?? null,
    page: p.book?.page ?? null,
    quote: p.book?.quote ?? '',
  });
  const title = note.title || 'Sem título';
  const topicRow = note.topicId ? await getTopicRow(db, userId, note.topicId) : null;
  const topicTitle = topicRow ? str(topicRow.title) : null;
  return {
    results: [source('note', note.id, title, { role: note.role, readingId: note.readingId, page: note.page })],
    summary: `Criou a nota ${quoted(title)}${topicTitle ? ` em ${quoted(str(topicTitle))}` : ' (sem assunto)'}`,
    output: {
      note: {
        id: note.id,
        title,
        link: `mynotes:note/${note.id}`,
        version: note.version,
        // Report exactly this to the user: where the note really is.
        filed_under_topic: note.topicId ? { id: note.topicId, title: str(topicTitle) } : null,
        book: note.readingId ? { id: note.readingId, page: note.page } : null,
      },
    },
  };
}

/* ===================================================== notes: update == */

export interface UpdateNotePayload {
  noteId: string;
  baseVersion: number;
  title: string | null;
  append: string | null;
  replace: string | null;
  /** set=false keeps the topic; set=true moves to `id` (null = no topic). */
  topic: { set: boolean; id: string | null };
}

async function currentNote(db: D1Database, userId: string, p: UpdateNotePayload): Promise<Row> {
  const row = await getNoteRow(db, userId, p.noteId);
  if (!row) throw new PlanError('not_found', 'Nota não encontrada.');
  if (num(row.version) !== p.baseVersion) {
    throw new PlanError(
      'version_conflict',
      `A nota mudou (versão atual ${num(row.version)}, a pedida era ${p.baseVersion}). Leia de novo com get_note antes de editar.`,
      { currentVersion: num(row.version) },
    );
  }
  return row;
}

export async function planUpdateNote(db: D1Database, userId: string, p: UpdateNotePayload): Promise<Plan<UpdateNotePayload>> {
  if (p.title === null && p.append === null && p.replace === null && !p.topic.set) {
    throw new PlanError('invalid_arguments', 'Nada para alterar: informe título, texto ou assunto.');
  }
  if (p.append !== null && p.replace !== null) throw new PlanError('invalid_arguments', 'Use append_markdown ou replace_markdown, não os dois.');
  const row = await currentNote(db, userId, p);
  // Validates the "/" references written in the new text.
  await noteRefsInfo(db, userId, { markdown: p.replace ?? p.append ?? '', references: [] });
  let topicTitle: string | null = null;
  if (p.topic.set && p.topic.id) topicTitle = (await requireEntities(db, userId, [{ type: 'topic', id: p.topic.id }])).get(entityKey('topic', p.topic.id))!.title;
  const name = str(row.title) || 'Sem título';
  const preview: AiPreviewLine[] = [];
  if (p.title !== null && p.title !== str(row.title)) preview.push(line(0, `Título: ${quoted(name)} → ${quoted(p.title)}`, 'change'));
  if (p.append !== null) preview.push(line(0, `Acrescentar ao fim: ${wordCount(p.append)} palavras`, 'change', p.append.slice(0, 300)));
  if (p.replace !== null) {
    preview.push(
      line(0, `Substituir todo o texto (${num(row.word_count)} → ${wordCount(p.replace)} palavras)`, 'change', 'O texto atual fica no histórico de versões da nota.'),
    );
  }
  if (p.topic.set) preview.push(line(0, topicTitle ? `Mover para ${quoted(topicTitle)}` : 'Tirar do assunto atual', 'change'));
  if (preview.length === 0) throw new PlanError('invalid_arguments', 'Os valores informados são iguais aos atuais.');
  return {
    tool: 'update_note',
    kind: p.replace !== null ? 'sensitive' : 'write',
    title: `${p.replace !== null ? 'Reescrever' : 'Editar'} a nota ${quoted(name)}`,
    preview,
    payload: p,
    confirm: p.replace !== null,
  };
}

async function executeUpdateNote(db: D1Database, userId: string, p: UpdateNotePayload): Promise<Execution> {
  const row = await currentNote(db, userId, p);
  let content: RichTextDoc | undefined;
  if (p.replace !== null || p.append !== null) {
    const info = await noteRefsInfo(db, userId, { markdown: p.replace ?? p.append ?? '', references: [] });
    const added = noteDoc(p.replace ?? p.append ?? '', [], [], info);
    if (p.replace !== null) content = added;
    else {
      const current = parseJson<RichTextDoc>(row.content, structuredClone(EMPTY_DOC));
      content = { ...current, type: 'doc', content: [...(current.content ?? []), ...added.content] };
    }
  }
  const summary = await updateNote(
    db,
    userId,
    p.noteId,
    {
      baseVersion: p.baseVersion,
      ...(p.title !== null ? { title: p.title } : {}),
      ...(content ? { content } : {}),
      ...(p.topic.set ? { topicId: p.topic.id } : {}),
    },
    { forceRevision: true },
  );
  const title = summary.title || 'Sem título';
  return {
    results: [source('note', summary.id, title, { role: summary.role, readingId: summary.readingId, page: summary.page })],
    summary: `Editou a nota ${quoted(title)}`,
    output: {
      note: { id: summary.id, title, link: `mynotes:note/${summary.id}`, version: summary.version, word_count: summary.wordCount, updated: summary.updatedAt },
    },
  };
}

/* ==================================================== topics: create == */

export interface TopicItem {
  key: string;
  title: string;
  description: string;
  parentKey: string | null;
}

export interface CreateTopicsPayload {
  parentId: string | null;
  topics: TopicItem[];
}

interface ResolvedTopic extends TopicItem {
  id: string;
  parentRealId: string | null;
  depth: number;
  existing: boolean;
}

/** Resolves the requested tree against the current one: equivalent topics (same title under the same parent) are reused. */
async function resolveTopics(db: D1Database, userId: string, p: CreateTopicsPayload) {
  const rows = await all<Row>(db, 'SELECT id, parent_id, title, sort_key FROM topics WHERE user_id = ? AND deleted_at IS NULL', userId);
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) byParent.set(strOrNull(r.parent_id), [...(byParent.get(strOrNull(r.parent_id)) ?? []), r]);
  const parentRow = p.parentId ? rows.find((r) => str(r.id) === p.parentId) : null;
  if (p.parentId && !parentRow) throw new PlanError('invalid_reference', 'O assunto pai informado não existe (ou está na lixeira).');

  const items = new Map<string, TopicItem>();
  for (const t of p.topics) {
    if (items.has(t.key)) throw new PlanError('invalid_arguments', `Chave repetida: ${t.key}`);
    items.set(t.key, t);
  }
  for (const t of p.topics) {
    if (t.parentKey !== null && !items.has(t.parentKey)) throw new PlanError('invalid_arguments', `parent_key desconhecida: ${t.parentKey}`);
  }
  // Parents before children (input order kept among siblings); cycles are rejected.
  const ordered: TopicItem[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: TopicItem, depth: number) => {
    if (state.get(t.key) === 'done') return;
    if (state.get(t.key) === 'visiting' || depth > 12) throw new PlanError('invalid_arguments', 'A hierarquia pedida tem um ciclo.');
    state.set(t.key, 'visiting');
    if (t.parentKey) visit(items.get(t.parentKey)!, depth + 1);
    state.set(t.key, 'done');
    ordered.push(t);
  };
  for (const t of p.topics) visit(t, 0);

  const resolved = new Map<string, ResolvedTopic>();
  for (const t of ordered) {
    const parent = t.parentKey ? resolved.get(t.parentKey)! : null;
    const parentRealId = parent ? parent.id : p.parentId;
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > 6) throw new PlanError('invalid_arguments', 'Profundidade máxima de 6 níveis por pedido.');
    // Only children of existing topics can already exist.
    const siblings = !parent || parent.existing ? (byParent.get(parentRealId) ?? []) : [];
    const twin = siblings.find((s) => sameTitle(str(s.title), t.title));
    const twinNew = [...resolved.values()].find((r) => r.parentRealId === parentRealId && !r.existing && sameTitle(r.title, t.title));
    if (twinNew) throw new PlanError('invalid_arguments', `${quoted(t.title)} aparece duas vezes no mesmo nível.`);
    resolved.set(t.key, {
      ...t,
      id: twin ? str(twin.id) : uuidv7(),
      parentRealId,
      depth,
      existing: !!twin,
      title: twin ? str(twin.title) : t.title.normalize('NFC'),
    });
  }
  return { resolved: [...resolved.values()], byParent, parentTitle: parentRow ? str(parentRow.title) : null };
}

function topicPreview(resolved: ResolvedTopic[], parentTitle: string | null): AiPreviewLine[] {
  const children = new Map<string | null, ResolvedTopic[]>();
  for (const r of resolved) children.set(r.parentKey, [...(children.get(r.parentKey) ?? []), r]);
  const out: AiPreviewLine[] = [];
  const walk = (key: string | null, depth: number) => {
    for (const r of children.get(key) ?? []) {
      out.push(line(depth, r.title, r.existing ? 'existing' : 'new', r.existing ? 'já existe — será reaproveitado' : r.description || null));
      walk(r.key, depth + 1);
    }
  };
  walk(null, 0);
  if (parentTitle) out.unshift(line(0, `Dentro de ${quoted(parentTitle)}`, 'existing'));
  return parentTitle ? out.map((l, i) => (i === 0 ? l : { ...l, depth: l.depth + 1 })) : out;
}

export async function planCreateTopics(db: D1Database, userId: string, p: CreateTopicsPayload): Promise<Plan<CreateTopicsPayload>> {
  const { resolved, parentTitle } = await resolveTopics(db, userId, p);
  const created = resolved.filter((r) => !r.existing);
  const plan: Plan<CreateTopicsPayload> = {
    tool: 'create_topics',
    kind: 'write',
    title:
      created.length === 1 && resolved.length === 1
        ? `Criar o assunto ${quoted(created[0]!.title)}`
        : `Criar ${created.length} assunto(s)${resolved.length > created.length ? ` (${resolved.length - created.length} já existem)` : ''}`,
    preview: topicPreview(resolved, parentTitle),
    payload: p,
    // Creating a structure (more than one topic) always waits for the user.
    confirm: created.length > 1,
  };
  if (created.length === 0) plan.noop = 'Todos os assuntos pedidos já existem.';
  return plan;
}

async function executeCreateTopics(db: D1Database, userId: string, p: CreateTopicsPayload): Promise<Execution> {
  const { resolved, byParent } = await resolveTopics(db, userId, p);
  const created = resolved.filter((r) => !r.existing);
  if (created.length > 0) {
    // Sort keys: after the existing siblings, in the requested order.
    const groups = new Map<string | null, ResolvedTopic[]>();
    for (const r of created) groups.set(r.parentRealId, [...(groups.get(r.parentRealId) ?? []), r]);
    const keys = new Map<string, string>();
    for (const [parent, list] of groups) {
      const siblings = byParent.get(parent) ?? [];
      const last = siblings.reduce<string | null>((max, s) => (max === null || str(s.sort_key) > max ? str(s.sort_key) : max), null);
      keysBetween(last, null, list.length).forEach((k, i) => keys.set(list[i]!.id, k));
    }
    const now = nowIso();
    const rows = created.map((r) => ({
      id: r.id,
      parent_id: r.parentRealId,
      title: r.title,
      description: r.description,
      sort_key: keys.get(r.id)!,
      search_text: topicSearchText(r.title, r.description),
      aid: uuidv7(),
    }));
    // Two statements for the whole tree (D1 counts statements per request). Parents come first in the array.
    await db.batch([
      stmt(
        db,
        `INSERT INTO topics (id, user_id, parent_id, title, description, color, sort_key, search_text, version, created_at, updated_at)
         SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.parent_id'), json_extract(value, '$.title'),
                json_extract(value, '$.description'), NULL, json_extract(value, '$.sort_key'), json_extract(value, '$.search_text'), 1, ?2, ?2
           FROM json_each(?3)`,
        userId,
        now,
        JSON.stringify(rows),
      ),
      stmt(
        db,
        `INSERT INTO activity_events (id, user_id, entity_type, entity_id, action, title, occurred_at)
         SELECT json_extract(value, '$.aid'), ?1, 'topic', json_extract(value, '$.id'), 'created', substr(json_extract(value, '$.title'), 1, 300), ?2
           FROM json_each(?3)`,
        userId,
        now,
        JSON.stringify(rows),
      ),
    ]);
  }
  const reused = resolved.filter((r) => r.existing);
  return {
    results: resolved.map((r) => source('topic', r.id, r.title)),
    summary:
      created.length > 0
        ? `Criou ${created.length} assunto(s): ${created.map((c) => c.title).join(', ')}`
        : 'Nenhum assunto novo: todos já existiam',
    output: {
      created: created.map((r) => ({ key: r.key, id: r.id, title: r.title, link: `mynotes:topic/${r.id}`, parent_id: r.parentRealId })),
      reused_existing: reused.map((r) => ({ key: r.key, id: r.id, title: r.title, link: `mynotes:topic/${r.id}` })),
    },
  };
}

/* ==================================================== topics: update == */

export interface UpdateTopicPayload {
  topicId: string;
  baseVersion: number;
  title: string | null;
  description: string | null;
}

async function currentTopic(db: D1Database, userId: string, topicId: string, baseVersion: number): Promise<Row> {
  const row = await getTopicRow(db, userId, topicId);
  if (!row) throw new PlanError('not_found', 'Assunto não encontrado.');
  if (num(row.version) !== baseVersion) {
    throw new PlanError('version_conflict', `O assunto mudou (versão atual ${num(row.version)}). Leia de novo com get_topic.`, {
      currentVersion: num(row.version),
    });
  }
  return row;
}

export async function planUpdateTopic(db: D1Database, userId: string, p: UpdateTopicPayload): Promise<Plan<UpdateTopicPayload>> {
  const row = await currentTopic(db, userId, p.topicId, p.baseVersion);
  const preview: AiPreviewLine[] = [];
  if (p.title !== null && p.title !== str(row.title)) preview.push(line(0, `Título: ${quoted(str(row.title))} → ${quoted(p.title)}`, 'change'));
  if (p.description !== null && p.description !== str(row.description)) {
    preview.push(line(0, 'Nova descrição', 'change', p.description.slice(0, 300) || '(vazia)'));
  }
  if (preview.length === 0) throw new PlanError('invalid_arguments', 'Nada para alterar.');
  return { tool: 'update_topic', kind: 'write', title: `Editar o assunto ${quoted(str(row.title))}`, preview, payload: p, confirm: false };
}

async function executeUpdateTopic(db: D1Database, userId: string, p: UpdateTopicPayload): Promise<Execution> {
  await currentTopic(db, userId, p.topicId, p.baseVersion);
  const topic = await updateTopic(db, userId, p.topicId, {
    baseVersion: p.baseVersion,
    ...(p.title !== null ? { title: p.title } : {}),
    ...(p.description !== null ? { description: p.description } : {}),
  });
  return {
    results: [source('topic', topic.id, topic.title)],
    summary: `Editou o assunto ${quoted(topic.title)}`,
    output: { topic: { id: topic.id, title: topic.title, link: `mynotes:topic/${topic.id}`, version: topic.version } },
  };
}

/* ====================================================== topics: move == */

export interface MoveTopicPayload {
  topicId: string;
  baseVersion: number;
  parentId: string | null;
}

export async function planMoveTopic(db: D1Database, userId: string, p: MoveTopicPayload): Promise<Plan<MoveTopicPayload>> {
  const row = await currentTopic(db, userId, p.topicId, p.baseVersion);
  if (p.parentId === p.topicId) throw new PlanError('invalid_arguments', 'Um assunto não pode ficar dentro de si mesmo.');
  if (strOrNull(row.parent_id) === p.parentId) throw new PlanError('invalid_arguments', 'O assunto já está nesse lugar.');
  let parentTitle: string | null = null;
  if (p.parentId) {
    const parent = await getTopicRow(db, userId, p.parentId);
    if (!parent) throw new PlanError('invalid_reference', 'O novo assunto pai não existe.');
    parentTitle = str(parent.title);
    const cycle = await first(db, `SELECT 1 AS hit FROM (${SUBTREE_SQL}) WHERE id = ?`, p.topicId, userId, p.parentId);
    if (cycle) throw new PlanError('invalid_arguments', 'Não é possível mover um assunto para dentro de um de seus subassuntos.');
  }
  const size = await first<{ topics: number; notes: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM (${SUBTREE_SQL})) - 1 AS topics,
            (SELECT COUNT(*) FROM notes WHERE user_id = ? AND deleted_at IS NULL AND topic_id IN (${SUBTREE_SQL})) AS notes`,
    p.topicId,
    userId,
    userId,
    p.topicId,
    userId,
  );
  const title = str(row.title);
  return {
    tool: 'move_topic',
    kind: 'sensitive',
    title: `Mover o assunto ${quoted(title)}`,
    preview: [
      line(0, `${quoted(title)} → ${parentTitle ? `dentro de ${quoted(parentTitle)}` : 'raiz (caderno)'}`, 'change', `Leva junto ${num(size?.topics)} subassunto(s) e ${num(size?.notes)} nota(s).`),
    ],
    payload: p,
    confirm: true,
  };
}

async function executeMoveTopic(db: D1Database, userId: string, p: MoveTopicPayload): Promise<Execution> {
  await planMoveTopic(db, userId, p);
  const topic = await moveTopic(db, userId, p.topicId, { baseVersion: p.baseVersion, parentId: p.parentId });
  return {
    results: [source('topic', topic.id, topic.title)],
    summary: `Moveu o assunto ${quoted(topic.title)}`,
    output: { topic: { id: topic.id, title: topic.title, parent_id: topic.parentId, version: topic.version } },
  };
}

/* ================================================== relations: create == */

export interface RelationItem {
  sourceType: GraphEntityType;
  sourceId: string;
  targetType: GraphEntityType;
  targetId: string;
  kind: RelationKind;
  label: string;
}

export interface CreateRelationsPayload {
  relations: RelationItem[];
}

/** Read the same in both directions: an existing B→A counts as A→B. */
const SYMMETRIC = new Set<RelationKind>(['related', 'contrasts']);
/** Must not form cycles (A depends on B depends on A). */
const ACYCLIC = new Set<RelationKind>(['depends_on', 'part_of']);

async function checkRelations(db: D1Database, userId: string, p: CreateRelationsPayload) {
  const info = await requireEntities(
    db,
    userId,
    p.relations.flatMap((r) => [
      { type: r.sourceType, id: r.sourceId },
      { type: r.targetType, id: r.targetId },
    ]),
  );
  const existing = await all<Row>(db, 'SELECT source_type, source_id, target_type, target_id, kind FROM relations WHERE user_id = ? LIMIT 5000', userId);
  const keyOf = (st: string, si: string, tt: string, ti: string, k: string) => `${st}:${si}>${tt}:${ti}#${k}`;
  const have = new Set(existing.map((r) => keyOf(str(r.source_type), str(r.source_id), str(r.target_type), str(r.target_id), str(r.kind))));
  const edges = new Map<string, Set<string>>();
  const addEdge = (kind: string, from: string, to: string) => {
    const k = `${kind}|${from}`;
    edges.set(k, (edges.get(k) ?? new Set()).add(to));
  };
  for (const r of existing) {
    if (ACYCLIC.has(str(r.kind) as RelationKind)) addEdge(str(r.kind), `${str(r.source_type)}:${str(r.source_id)}`, `${str(r.target_type)}:${str(r.target_id)}`);
  }
  const reaches = (kind: string, from: string, to: string) => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of edges.get(`${kind}|${cur}`) ?? []) stack.push(n);
    }
    return false;
  };
  const title = (t: string, id: string) => info.get(entityKey(t, id))?.title || 'Sem título';
  const out: (RelationItem & { exists: boolean; text: string })[] = [];
  for (const r of p.relations) {
    const a = `${r.sourceType}:${r.sourceId}`;
    const b = `${r.targetType}:${r.targetId}`;
    const text = `${title(r.sourceType, r.sourceId)} — ${RELATION_KIND_LABELS[r.kind]} → ${title(r.targetType, r.targetId)}`;
    if (a === b) throw new PlanError('invalid_arguments', 'Um item não pode se relacionar consigo mesmo.');
    if (r.kind === 'part_of' && r.sourceType === 'topic' && r.targetType === 'topic') {
      throw new PlanError('invalid_arguments', 'Hierarquia entre assuntos não é uma relação: use move_topic (ou create_topics com parent).');
    }
    const dup =
      have.has(keyOf(r.sourceType, r.sourceId, r.targetType, r.targetId, r.kind)) ||
      (SYMMETRIC.has(r.kind) && have.has(keyOf(r.targetType, r.targetId, r.sourceType, r.sourceId, r.kind))) ||
      out.some((o) => o.text === text);
    if (!dup && ACYCLIC.has(r.kind) && reaches(r.kind, b, a)) {
      throw new PlanError('invalid_arguments', `Relação circular: ${text} fecharia um ciclo de “${RELATION_KIND_LABELS[r.kind]}”.`);
    }
    if (!dup && ACYCLIC.has(r.kind)) addEdge(r.kind, a, b);
    out.push({ ...r, exists: dup, text });
  }
  return out;
}

export async function planCreateRelations(db: D1Database, userId: string, p: CreateRelationsPayload): Promise<Plan<CreateRelationsPayload>> {
  const checked = await checkRelations(db, userId, p);
  const fresh = checked.filter((c) => !c.exists);
  const plan: Plan<CreateRelationsPayload> = {
    tool: 'create_relations',
    kind: 'write',
    title: fresh.length === 1 ? `Criar a relação ${fresh[0]!.text}` : `Criar ${fresh.length} relação(ões)`,
    preview: checked.map((c) => line(0, c.text, c.exists ? 'existing' : 'new', c.exists ? 'já existe' : c.label || null)),
    payload: p,
    confirm: fresh.length > 1,
  };
  if (fresh.length === 0) plan.noop = 'Todas as relações pedidas já existem.';
  return plan;
}

async function executeCreateRelations(db: D1Database, userId: string, p: CreateRelationsPayload): Promise<Execution> {
  const checked = await checkRelations(db, userId, p);
  const fresh = checked.filter((c) => !c.exists).map((c) => ({ ...c, id: uuidv7() }));
  if (fresh.length) {
    const now = nowIso();
    await stmt(
      db,
      `INSERT INTO relations (id, user_id, source_type, source_id, target_type, target_id, kind, label, version, created_at, updated_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.sourceType'), json_extract(value, '$.sourceId'),
              json_extract(value, '$.targetType'), json_extract(value, '$.targetId'), json_extract(value, '$.kind'),
              json_extract(value, '$.label'), 1, ?2, ?2
         FROM json_each(?3) WHERE 1
       ON CONFLICT (user_id, source_type, source_id, target_type, target_id, kind) DO NOTHING`,
      userId,
      now,
      JSON.stringify(fresh.map(({ text: _t, exists: _e, ...r }) => r)),
    ).run();
  }
  const info = await resolveEntities(db, userId, fresh.map((f) => ({ type: f.sourceType, id: f.sourceId })));
  return {
    results: fresh.map((f) => source(f.sourceType, f.sourceId, info.get(entityKey(f.sourceType, f.sourceId))?.title ?? '')),
    summary: fresh.length ? `Criou ${fresh.length} relação(ões): ${fresh.map((f) => f.text).join('; ')}` : 'Nenhuma relação nova',
    output: { created: fresh.map((f) => ({ relation_id: f.id, reads_as: f.text })), already_existed: checked.filter((c) => c.exists).map((c) => c.text) },
  };
}

/* ================================================== mind maps: create == */

export interface MapNodeItem {
  key: string;
  label: string;
  parentKey: string | null;
  ref: EntityRef | null;
}

export interface CreateMindMapPayload {
  title: string;
  topicId: string | null;
  /** Add to this free map instead of creating one. */
  mapId: string | null;
  baseVersion: number | null;
  nodes: MapNodeItem[];
  links: { from: string; to: string; label: string }[];
}

function checkMapShape(p: CreateMindMapPayload) {
  const keys = new Map<string, MapNodeItem>();
  for (const n of p.nodes) {
    if (keys.has(n.key)) throw new PlanError('invalid_arguments', `Chave de nó repetida: ${n.key}`);
    keys.set(n.key, n);
  }
  for (const n of p.nodes) {
    if (n.parentKey !== null && !keys.has(n.parentKey)) throw new PlanError('invalid_arguments', `parent_key desconhecida: ${n.parentKey}`);
    let cur: MapNodeItem | undefined = n;
    for (let steps = 0; cur?.parentKey; steps++) {
      if (steps > p.nodes.length) throw new PlanError('invalid_arguments', 'A hierarquia do mapa tem um ciclo.');
      cur = keys.get(cur.parentKey);
    }
  }
  for (const l of p.links) {
    if (!keys.has(l.from) || !keys.has(l.to)) throw new PlanError('invalid_arguments', `Ligação entre nós desconhecidos: ${l.from} → ${l.to}`);
    if (l.from === l.to) throw new PlanError('invalid_arguments', 'Uma ligação não pode sair e chegar no mesmo nó.');
  }
}

export async function planCreateMindMap(db: D1Database, userId: string, p: CreateMindMapPayload): Promise<Plan<CreateMindMapPayload>> {
  checkMapShape(p);
  const refs = p.nodes.flatMap((n) => (n.ref ? [n.ref] : []));
  const info = await requireEntities(db, userId, [...refs, ...(p.topicId ? [{ type: 'topic' as const, id: p.topicId }] : [])]);
  let mapTitle = p.title;
  if (p.mapId) {
    const map = await first<Row>(db, 'SELECT title, version FROM mind_maps WHERE id = ? AND user_id = ?', p.mapId, userId);
    if (!map) throw new PlanError('not_found', 'Mapa mental não encontrado.');
    if (p.baseVersion !== null && num(map.version) !== p.baseVersion) {
      throw new PlanError('version_conflict', `O mapa mudou (versão atual ${num(map.version)}). Leia de novo com get_mind_map.`);
    }
    mapTitle = str(map.title);
  }
  const depthOf = (n: MapNodeItem): number => (n.parentKey ? 1 + depthOf(p.nodes.find((x) => x.key === n.parentKey)!) : 0);
  const preview = p.nodes.slice(0, 80).map((n) => {
    const linked = n.ref ? info.get(entityKey(n.ref.type, n.ref.id))?.title : null;
    return line(Math.min(10, depthOf(n)), n.label || linked || '(sem texto)', 'new', linked ? `ligado a ${quoted(linked)}` : null);
  });
  const byKey = new Map(p.nodes.map((n) => [n.key, n.label]));
  for (const l of p.links.slice(0, 40)) preview.push(line(0, `${byKey.get(l.from)} → ${byKey.get(l.to)}`, 'new', l.label || 'ligação'));
  return {
    tool: 'create_mind_map',
    kind: p.mapId ? 'sensitive' : 'write',
    title: p.mapId ? `Acrescentar ${p.nodes.length} nó(s) ao mapa ${quoted(mapTitle)}` : `Criar o mapa mental ${quoted(p.title)}`,
    preview,
    payload: p,
    confirm: true,
  };
}

const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/** Same horizontal tree layout as the map editor (260 × 76 px). */
function layout(nodes: { id: string; parentId: string | null }[], top: number) {
  const children = new Map<string, string[]>();
  const ids = new Set(nodes.map((n) => n.id));
  const roots: string[] = [];
  for (const n of nodes) {
    if (n.parentId && ids.has(n.parentId)) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
    else roots.push(n.id);
  }
  const placed = new Map<string, { x: number; y: number }>();
  let cursorY = top;
  const visit = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      const y = cursorY;
      cursorY += 76;
      placed.set(id, { x: depth * 260, y });
      return y;
    }
    const ys = kids.map((k) => visit(k, depth + 1));
    const y = (ys[0]! + ys[ys.length - 1]!) / 2;
    placed.set(id, { x: depth * 260, y });
    return y;
  };
  for (const r of roots) {
    visit(r, 0);
    cursorY += 76;
  }
  return placed;
}

async function executeCreateMindMap(db: D1Database, userId: string, p: CreateMindMapPayload): Promise<Execution> {
  await planCreateMindMap(db, userId, p);
  const ids = new Map(p.nodes.map((n) => [n.key, `n-${shortId()}`]));
  const base = p.mapId ? await getMindMap(db, userId, p.mapId) : null;
  const top = base && base.data.nodes.length ? Math.max(...base.data.nodes.map((n) => n.position.y)) + 200 : 0;
  const shaped = p.nodes.map((n) => ({ id: ids.get(n.key)!, parentId: n.parentKey ? ids.get(n.parentKey)! : null }));
  const positions = layout(shaped, top);
  const nodes: MindMapData['nodes'] = p.nodes.map((n) => ({
    id: ids.get(n.key)!,
    position: positions.get(ids.get(n.key)!) ?? { x: 0, y: top },
    label: n.label.slice(0, 500),
    color: null,
    ref: n.ref ? { type: n.ref.type as GraphEntityType, id: n.ref.id } : null,
    parentId: n.parentKey ? ids.get(n.parentKey)! : null,
  }));
  // Like the editor: every child has a tree edge from its parent, plus the extra links.
  const edges: MindMapData['edges'] = [
    ...nodes.filter((n) => n.parentId).map((n) => ({ id: `e-${shortId()}`, source: n.parentId!, target: n.id, label: '' })),
    ...p.links.map((l) => ({ id: `e-${shortId()}`, source: ids.get(l.from)!, target: ids.get(l.to)!, label: l.label.slice(0, 200) })),
  ];
  // The same schema the app validates maps with: only labelled nodes and edges, never markup.
  if (base) {
    const summary = await updateMindMap(db, userId, base.id, {
      baseVersion: p.baseVersion ?? base.version,
      data: zMindMapData.parse({ nodes: [...base.data.nodes, ...nodes], edges: [...base.data.edges, ...edges], viewport: base.data.viewport }),
    });
    return {
      results: [source('mindmap', summary.id, summary.title)],
      summary: `Acrescentou ${nodes.length} nó(s) ao mapa ${quoted(summary.title)}`,
      output: { map: { id: summary.id, title: summary.title, link: `mynotes:mindmap/${summary.id}`, version: summary.version } },
    };
  }
  const { map } = await createMindMap(db, userId, { topicId: p.topicId, title: p.title, data: zMindMapData.parse({ nodes, edges, viewport: null }) });
  return {
    results: [source('mindmap', map.id, map.title)],
    summary: `Criou o mapa mental ${quoted(map.title)}`,
    output: { map: { id: map.id, title: map.title, link: `mynotes:mindmap/${map.id}`, nodes: map.nodeCount } },
  };
}

/* ======================================================== dispatching == */

const EXECUTORS: Record<ActionTool, (db: D1Database, userId: string, payload: never) => Promise<Execution>> = {
  create_note: executeCreateNote,
  update_note: executeUpdateNote,
  create_topics: executeCreateTopics,
  update_topic: executeUpdateTopic,
  move_topic: executeMoveTopic,
  create_relations: executeCreateRelations,
  create_mind_map: executeCreateMindMap,
};

export function execute(db: D1Database, userId: string, plan: Pick<Plan, 'tool' | 'payload'>): Promise<Execution> {
  return EXECUTORS[plan.tool](db, userId, plan.payload as never);
}

/** Message for errors of an execution: service errors are already safe; others are not shown. */
export function failureMessage(err: unknown): string {
  if (err instanceof PlanError || err instanceof ApiError) return err.message;
  return 'Falha ao gravar no banco de dados. Nada foi confirmado; tente de novo.';
}

/* ======================================================== persistence == */

export function toAction(r: Row): AiAction {
  return {
    id: str(r.id),
    conversationId: strOrNull(r.conversation_id),
    tool: str(r.tool),
    kind: str(r.kind) as AiAction['kind'],
    status: str(r.status) as AiActionStatus,
    title: str(r.title),
    preview: parseJson<AiPreviewLine[]>(r.preview, []),
    results: parseJson<AiSource[]>(r.results, []),
    error: strOrNull(r.error),
    createdAt: str(r.created_at),
    decidedAt: strOrNull(r.decided_at),
    expiresAt: strOrNull(r.expires_at),
  };
}

export async function recordAction(
  db: D1Database,
  userId: string,
  conversationId: string,
  plan: Plan,
  status: 'proposed' | 'executed' | 'failed',
  extra: { results?: AiSource[]; error?: string } = {},
): Promise<AiAction> {
  const now = nowIso();
  const row = await first<Row>(
    db,
    `INSERT INTO ai_actions (id, user_id, conversation_id, tool, kind, status, title, preview, payload, results, error, created_at, decided_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    uuidv7(),
    userId,
    conversationId,
    plan.tool,
    plan.kind,
    status,
    plan.title.slice(0, 300),
    JSON.stringify(plan.preview.slice(0, 120)),
    JSON.stringify(plan.payload),
    JSON.stringify(extra.results ?? []),
    extra.error ?? null,
    now,
    status === 'proposed' ? null : now,
    status === 'proposed' ? isoAfter(PROPOSAL_TTL_SECONDS) : null,
  );
  return toAction(row!);
}

function eventMessage(id: string, conversationId: string, content: string, createdAt: string): AiMessage {
  return { id, conversationId, role: 'event', content, sources: [], tools: [], actionIds: [], status: 'ok', usage: null, createdAt };
}

/** Records the decision in the conversation, so the model knows about it in the next turns. */
async function decisionEvent(db: D1Database, userId: string, action: AiAction, content: string, results: AiSource[]): Promise<AiMessage | null> {
  if (!action.conversationId) return null;
  const id = uuidv7();
  const now = nowIso();
  const meta = JSON.stringify({ sources: results, tools: [], actionIds: [action.id] });
  await db.batch([
    stmt(
      db,
      `INSERT INTO ai_messages (id, conversation_id, user_id, role, content, meta, status, created_at)
       SELECT ?, id, user_id, 'event', ?, ?, 'ok', ? FROM ai_conversations WHERE id = ? AND user_id = ?`,
      id,
      content,
      meta,
      now,
      action.conversationId,
      userId,
    ),
    stmt(
      db,
      'UPDATE ai_conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ? AND user_id = ?',
      now,
      action.conversationId,
      userId,
    ),
  ]);
  return { ...eventMessage(id, action.conversationId, content, now), sources: results, actionIds: [action.id] };
}

async function loadAction(db: D1Database, userId: string, id: string): Promise<AiAction> {
  const row = await first<Row>(db, 'SELECT * FROM ai_actions WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Ação');
  return toAction(row);
}

/**
 * Runs a proposal the user confirmed. The row is claimed atomically
 * (proposed → executing), so a double click or a retry never runs it twice.
 */
export async function confirmAction(db: D1Database, userId: string, id: string): Promise<AiActionDecision> {
  const now = nowIso();
  const claimed = await first<Row>(
    db,
    `UPDATE ai_actions SET status = 'executing', decided_at = ?
      WHERE id = ? AND user_id = ? AND status = 'proposed' AND (expires_at IS NULL OR expires_at > ?) RETURNING *`,
    now,
    id,
    userId,
    now,
  );
  if (!claimed) {
    const current = await loadAction(db, userId, id);
    if (current.status === 'proposed') {
      await stmt(db, "UPDATE ai_actions SET status = 'expired', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'proposed'", now, id, userId).run();
      throw new ApiError('conflict', 'A proposta expirou (vale por 24 horas). Peça de novo ao assistente.', { action: { ...current, status: 'expired' } });
    }
    if (current.status === 'executed') return { action: current, event: null };
    throw new ApiError('conflict', 'Esta proposta já foi decidida.', { action: current });
  }
  const action = toAction(claimed);
  const payload = parseJson<unknown>(claimed.payload, null);
  try {
    const result = await execute(db, userId, { tool: action.tool as ActionTool, payload });
    const row = await first<Row>(
      db,
      "UPDATE ai_actions SET status = 'executed', results = ? WHERE id = ? AND user_id = ? RETURNING *",
      JSON.stringify(result.results),
      id,
      userId,
    );
    const done = toAction(row!);
    const event = await decisionEvent(db, userId, done, `Confirmado pelo usuário e executado pelo MyNotes: ${result.summary}.`, result.results);
    return { action: done, event };
  } catch (err) {
    const message = failureMessage(err);
    if (!(err instanceof PlanError || err instanceof ApiError)) {
      console.error(JSON.stringify({ level: 'error', msg: 'ai action failed', tool: action.tool, error: err instanceof Error ? err.message.slice(0, 300) : String(err) }));
    }
    const row = await first<Row>(db, "UPDATE ai_actions SET status = 'failed', error = ? WHERE id = ? AND user_id = ? RETURNING *", message, id, userId);
    const failed = toAction(row!);
    const event = await decisionEvent(db, userId, failed, `A ação “${failed.title}” falhou e nada foi gravado: ${message}`, []);
    return { action: failed, event };
  }
}

export async function rejectAction(db: D1Database, userId: string, id: string): Promise<AiActionDecision> {
  const now = nowIso();
  const row = await first<Row>(
    db,
    "UPDATE ai_actions SET status = 'rejected', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'proposed' RETURNING *",
    now,
    id,
    userId,
  );
  if (!row) {
    const current = await loadAction(db, userId, id);
    if (current.status === 'rejected') return { action: current, event: null };
    throw new ApiError('conflict', 'Esta proposta já foi decidida.', { action: current });
  }
  const action = toAction(row);
  const event = await decisionEvent(db, userId, action, `O usuário descartou a proposta “${action.title}”. Nada foi alterado.`, []);
  return { action, event };
}
