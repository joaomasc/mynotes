import {
  MIND_MAP_MAX_BYTES,
  analyzeDoc,
  normalizeAligned,
  utf8Length,
  uuidv7,
  zMindMapData,
  type Concept,
  type ConceptCreate,
  type ConceptUpdate,
  type MindMap,
  type MindMapData,
  type MindMapKind,
  type MindMapSummary,
  zMindMapUpdate,
  type Relation,
  type RelationCreate,
  type RelationUpdate,
  type RelationWithTitles,
} from '@mynotes/shared';
import type { z } from 'zod';
import { badRequest, notFound, tooLarge } from '../../lib/errors';
import { all, first, num, parseJson, str, strOrNull, stmt, versionedUpdate, type Bindable, type Row } from '../../lib/db';
import { assertEntity, entityKey, resolveEntities } from '../../lib/entities';
import { activityStmt, assertReference } from '../../lib/helpers';
import { nowIso } from '../../lib/time';

/* --------------------------------------------------------------- concepts */

export function toConcept(r: Row): Concept {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    name: str(r.name),
    description: str(r.description),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const conceptSearch = (name: string, description: string) => normalizeAligned(`${name} ${description}`.normalize('NFC'));

export async function listConcepts(db: D1Database, userId: string, topicId?: string): Promise<Concept[]> {
  const rows = topicId
    ? await all(db, 'SELECT * FROM concepts WHERE user_id = ? AND topic_id = ? ORDER BY name', userId, topicId)
    : await all(db, 'SELECT * FROM concepts WHERE user_id = ? ORDER BY name LIMIT 2000', userId);
  return rows.map(toConcept);
}

export async function getConcept(db: D1Database, userId: string, id: string): Promise<Concept> {
  const row = await first(db, 'SELECT * FROM concepts WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Conceito');
  return toConcept(row);
}

export async function createConcept(
  db: D1Database,
  userId: string,
  input: Required<Omit<ConceptCreate, 'id'>> & { id?: string | undefined },
): Promise<{ concept: Concept; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM concepts WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { concept: toConcept(existing), created: false };
  }
  await assertReference(db, 'topics', input.topicId, userId);
  const now = nowIso();
  const name = input.name.normalize('NFC');
  const row = await first(
    db,
    `INSERT INTO concepts (id, user_id, topic_id, name, description, search_text, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
    id,
    userId,
    input.topicId,
    name,
    input.description,
    conceptSearch(name, input.description),
    now,
    now,
  );
  return { concept: toConcept(row!), created: true };
}

export async function updateConcept(db: D1Database, userId: string, id: string, input: ConceptUpdate): Promise<Concept> {
  const current = await getConcept(db, userId, id);
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  const name = (input.name ?? current.name).normalize('NFC');
  const description = input.description ?? current.description;
  const set: Record<string, Bindable> = { name, description, search_text: conceptSearch(name, description) };
  if (input.topicId !== undefined) set.topic_id = input.topicId;
  const row = await versionedUpdate(
    db,
    { table: 'concepts', id, userId, baseVersion: input.baseVersion, set },
    () => getConcept(db, userId, id).catch(() => null),
    'Conceito',
  );
  return toConcept(row);
}

export async function deleteConcept(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM concepts WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Conceito');
}

/* -------------------------------------------------------------- relations */

export function toRelation(r: Row): Relation {
  return {
    id: str(r.id),
    sourceType: str(r.source_type) as Relation['sourceType'],
    sourceId: str(r.source_id),
    targetType: str(r.target_type) as Relation['targetType'],
    targetId: str(r.target_id),
    kind: str(r.kind) as Relation['kind'],
    label: str(r.label),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

async function withTitles(db: D1Database, userId: string, relations: Relation[]): Promise<RelationWithTitles[]> {
  const info = await resolveEntities(db, userId, [
    ...relations.map((r) => ({ type: r.sourceType, id: r.sourceId })),
    ...relations.map((r) => ({ type: r.targetType, id: r.targetId })),
  ]);
  // Relations whose endpoint is in the trash are hidden (and come back on restore).
  return relations
    .filter((r) => info.has(entityKey(r.sourceType, r.sourceId)) && info.has(entityKey(r.targetType, r.targetId)))
    .map((r) => ({
      ...r,
      sourceTitle: info.get(entityKey(r.sourceType, r.sourceId))!.title,
      targetTitle: info.get(entityKey(r.targetType, r.targetId))!.title,
    }));
}

export async function listRelations(
  db: D1Database,
  userId: string,
  entityType: string,
  entityId: string,
): Promise<RelationWithTitles[]> {
  const rows = await all(
    db,
    `SELECT * FROM relations WHERE user_id = ?
        AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
      ORDER BY created_at DESC LIMIT 500`,
    userId,
    entityType,
    entityId,
    entityType,
    entityId,
  );
  return withTitles(db, userId, rows.map(toRelation));
}

export async function createRelation(
  db: D1Database,
  userId: string,
  input: Required<Omit<RelationCreate, 'id'>> & { id?: string | undefined },
): Promise<{ relation: RelationWithTitles; created: boolean }> {
  if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
    throw badRequest('Um item não pode se relacionar consigo mesmo');
  }
  const id = input.id ?? uuidv7();
  const existing = await first(
    db,
    `SELECT * FROM relations WHERE user_id = ? AND (id = ? OR (source_type = ? AND source_id = ? AND target_type = ?
        AND target_id = ? AND kind = ?))`,
    userId,
    id,
    input.sourceType,
    input.sourceId,
    input.targetType,
    input.targetId,
    input.kind,
  );
  if (existing) {
    const [rel] = await withTitles(db, userId, [toRelation(existing)]);
    if (rel) return { relation: rel, created: false };
  }
  await assertEntity(db, userId, { type: input.sourceType, id: input.sourceId });
  await assertEntity(db, userId, { type: input.targetType, id: input.targetId });
  const now = nowIso();
  const row = await first(
    db,
    `INSERT INTO relations (id, user_id, source_type, source_id, target_type, target_id, kind, label, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
    id,
    userId,
    input.sourceType,
    input.sourceId,
    input.targetType,
    input.targetId,
    input.kind,
    input.label,
    now,
    now,
  );
  const [rel] = await withTitles(db, userId, [toRelation(row!)]);
  return { relation: rel!, created: true };
}

export async function updateRelation(db: D1Database, userId: string, id: string, input: RelationUpdate): Promise<Relation> {
  const set: Record<string, Bindable> = {};
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.label !== undefined) set.label = input.label;
  const row = await versionedUpdate(
    db,
    { table: 'relations', id, userId, baseVersion: input.baseVersion, set },
    async () => {
      const r = await first(db, 'SELECT * FROM relations WHERE id = ? AND user_id = ?', id, userId);
      return r ? toRelation(r) : null;
    },
    'Relação',
  );
  return toRelation(row);
}

export async function deleteRelation(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM relations WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Relação');
}

/* -------------------------------------------------------------- mind maps */

const EMPTY_MAP: MindMapData = { nodes: [], edges: [], viewport: null };

function toMindMapSummary(r: Row): MindMapSummary {
  return {
    id: str(r.id),
    kind: str(r.kind) === 'canvas' ? 'canvas' : 'mindmap',
    topicId: strOrNull(r.topic_id),
    noteId: strOrNull(r.note_id),
    title: str(r.title),
    nodeCount: num(r.node_count),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toMindMap(r: Row): MindMap {
  const parsed = zMindMapData.safeParse(parseJson(r.data, EMPTY_MAP));
  return { ...toMindMapSummary(r), data: parsed.success ? parsed.data : EMPTY_MAP };
}

/** Validates entity references inside the map and serializes it. */
async function prepareMapData(db: D1Database, userId: string, title: string, data: MindMapData) {
  const refs = data.nodes.flatMap((n) => (n.ref ? [n.ref] : []));
  if (refs.length > 0) {
    const found = await resolveEntities(db, userId, refs);
    for (const node of data.nodes) {
      // Links to deleted items are dropped instead of failing the whole save.
      if (node.ref && !found.has(entityKey(node.ref.type, node.ref.id))) node.ref = null;
      else if (node.ref) node.ref.title = found.get(entityKey(node.ref.type, node.ref.id))!.title.slice(0, 300);
    }
  }
  // Canvas text cards: unsafe links are dropped (as in notes) and the text is searchable.
  const texts = data.nodes.map((n) => [n.label, n.doc ? analyzeDoc(n.doc).text : '', n.url ?? ''].join(' '));
  const json = JSON.stringify(data);
  if (utf8Length(json) > MIND_MAP_MAX_BYTES) throw tooLarge('O mapa mental excede o tamanho máximo');
  const searchText = normalizeAligned([title, ...texts].join(' ').normalize('NFC')).slice(0, 100_000);
  return { json, searchText, nodeCount: data.nodes.length };
}

export async function listMindMaps(
  db: D1Database,
  userId: string,
  q: { kind?: MindMapKind | undefined; topicId?: string | undefined; noteId?: string | undefined } = {},
): Promise<MindMapSummary[]> {
  let where = 'user_id = ?';
  const binds: Bindable[] = [userId];
  for (const [column, value] of [['kind', q.kind], ['topic_id', q.topicId], ['note_id', q.noteId]] as const) {
    if (!value) continue;
    where += ` AND ${column} = ?`;
    binds.push(value);
  }
  const rows = await all(
    db,
    `SELECT id, kind, topic_id, note_id, title, node_count, version, created_at, updated_at FROM mind_maps WHERE ${where} ORDER BY updated_at DESC`,
    ...binds,
  );
  return rows.map(toMindMapSummary);
}

export async function getMindMap(db: D1Database, userId: string, id: string): Promise<MindMap> {
  const row = await first(db, 'SELECT * FROM mind_maps WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Mapa mental');
  return toMindMap(row);
}

export async function createMindMap(
  db: D1Database,
  userId: string,
  input: {
    id?: string | undefined;
    kind?: MindMapKind | undefined;
    topicId: string | null;
    noteId?: string | null | undefined;
    title: string;
    data?: MindMapData | undefined;
  },
): Promise<{ map: MindMap; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT * FROM mind_maps WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { map: toMindMap(existing), created: false };
  }
  await assertReference(db, 'topics', input.topicId, userId);
  await assertReference(db, 'notes', input.noteId, userId);
  const kind = input.kind ?? 'mindmap';
  const title = input.title.normalize('NFC');
  const data: MindMapData = input.data ?? {
    // A mind map starts from its central idea; a canvas, empty.
    nodes: kind === 'canvas' ? [] : [{ id: 'root', position: { x: 0, y: 0 }, label: title, color: null, ref: null, parentId: null }],
    edges: [],
    viewport: null,
  };
  const prepared = await prepareMapData(db, userId, title, data);
  const now = nowIso();
  const [inserted] = await db.batch([
    stmt(
      db,
      `INSERT INTO mind_maps (id, user_id, kind, topic_id, note_id, title, data, node_count, search_text, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
      id,
      userId,
      kind,
      input.topicId,
      input.noteId ?? null,
      title,
      prepared.json,
      prepared.nodeCount,
      prepared.searchText,
      now,
      now,
    ),
    activityStmt(db, userId, 'mindmap', id, 'created', title),
  ]);
  return { map: toMindMap((inserted?.results as Row[])[0]!), created: true };
}

export async function updateMindMap(db: D1Database, userId: string, id: string, input: z.infer<typeof zMindMapUpdate>): Promise<MindMapSummary> {
  const current = await getMindMap(db, userId, id);
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  if (input.noteId !== undefined) await assertReference(db, 'notes', input.noteId, userId);
  const title = (input.title ?? current.title).normalize('NFC');
  const set: Record<string, Bindable> = { title };
  if (input.topicId !== undefined) set.topic_id = input.topicId;
  if (input.noteId !== undefined) set.note_id = input.noteId;
  const prepared = await prepareMapData(db, userId, title, input.data ?? current.data);
  set.search_text = prepared.searchText;
  if (input.data) {
    set.data = prepared.json;
    set.node_count = prepared.nodeCount;
  }
  const row = await versionedUpdate(
    db,
    { table: 'mind_maps', id, userId, baseVersion: input.baseVersion, set },
    () => getMindMap(db, userId, id).catch(() => null),
    'Mapa mental',
  );
  await activityStmt(db, userId, 'mindmap', id, 'updated', title, 600).run();
  return toMindMapSummary(row);
}

export async function deleteMindMap(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM mind_maps WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Mapa mental');
}
