import { z } from 'zod';
import {
  GRAPH_ENTITY_TYPES,
  RELATION_KIND_LABELS,
  zId,
  type GraphEdge,
  type GraphEntityType,
  type RelationKind,
  type SearchEntityType,
} from '@mynotes/shared';
import { num, parseJson, str, strOrNull, stmt, type Row } from '../../../lib/db';
import { entityKey, resolveEntities, type EntityRef } from '../../../lib/entities';
import { buildGraph } from '../../overview/service';
import { defineTool, linkOf, S, truncate } from './types';

const zEntity = z.enum(GRAPH_ENTITY_TYPES);

/** How each kind of graph edge reads, from source to target and back. */
const EDGE_TEXT: Record<string, { out: string; in: string }> = {
  parent: { out: 'tem como subassunto', in: 'é subassunto de' },
  contains: { out: 'contém', in: 'está no assunto' },
  links_to: { out: 'cita', in: 'é citado por' },
  annotates: { out: 'anota o livro', in: 'tem a anotação/resenha' },
  ...Object.fromEntries(
    (Object.keys(RELATION_KIND_LABELS) as RelationKind[]).map((k) => [
      k,
      { out: RELATION_KIND_LABELS[k].toLowerCase(), in: `(inverso) ${RELATION_KIND_LABELS[k].toLowerCase()}` },
    ]),
  ),
};

const edgeOrigin = (kind: string) =>
  kind === 'parent' || kind === 'contains' ? 'hierarquia' : kind === 'links_to' ? 'referência na nota' : kind === 'annotates' ? 'anotação de livro' : 'relação';

/* --------------------------------------------------------- get_connections -- */

const zConnections = z.strictObject({ type: zEntity, id: zId });

export const getConnections = defineTool({
  name: 'get_connections',
  kind: 'read',
  description:
    'Lists what an item is connected to in the knowledge graph: explicit typed relations (with relation_id), notes that cite it ("/" references), items it cites, its topic, subtopics and contents, and book annotations. Use it to explain or explore connections.',
  parameters: S.obj({
    type: S.enum(GRAPH_ENTITY_TYPES, 'Item type.'),
    id: S.str('Item id (uuid).'),
  }),
  args: zConnections,
  label: () => 'Consultou as conexões de um item',
  async run(ctx, a) {
    const u = ctx.userId;
    const self = (await resolveEntities(ctx.db, u, [{ type: a.type, id: a.id }])).get(entityKey(a.type, a.id));
    if (!self) return { error: 'not_found', message: 'Item não encontrado.' };
    const statements: D1PreparedStatement[] = [
      stmt(
        ctx.db,
        `SELECT * FROM relations WHERE user_id = ? AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
          ORDER BY created_at DESC LIMIT 60`,
        u,
        a.type,
        a.id,
        a.type,
        a.id,
      ),
      stmt(
        ctx.db,
        `SELECT n.id FROM note_links l JOIN notes n ON n.id = l.note_id
          WHERE l.target_type = ? AND l.target_id = ? AND n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT 40`,
        a.type,
        a.id,
        u,
      ),
    ];
    if (a.type === 'note') {
      statements.push(
        stmt(
          ctx.db,
          'SELECT l.target_type, l.target_id FROM note_links l JOIN notes n ON n.id = l.note_id WHERE l.note_id = ? AND n.user_id = ? LIMIT 60',
          a.id,
          u,
        ),
        stmt(ctx.db, 'SELECT reading_id FROM notes WHERE id = ? AND user_id = ?', a.id, u),
      );
    } else if (a.type === 'topic') {
      statements.push(
        stmt(
          ctx.db,
          `SELECT 'topic' AS type, id FROM topics WHERE user_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL
           UNION ALL SELECT 'note', id FROM notes WHERE user_id = ?1 AND topic_id = ?2 AND deleted_at IS NULL
           UNION ALL SELECT 'reading', id FROM readings WHERE user_id = ?1 AND topic_id = ?2
           UNION ALL SELECT 'document', id FROM documents WHERE user_id = ?1 AND topic_id = ?2 AND deleted_at IS NULL
           UNION ALL SELECT 'concept', id FROM concepts WHERE user_id = ?1 AND topic_id = ?2
           LIMIT 80`,
          u,
          a.id,
        ),
      );
    } else if (a.type === 'reading') {
      statements.push(
        stmt(ctx.db, 'SELECT id FROM notes WHERE user_id = ? AND reading_id = ? AND deleted_at IS NULL ORDER BY page LIMIT 40', u, a.id),
      );
    }
    const res = await ctx.db.batch<Row>(statements);
    type Conn = { direction: 'out' | 'in'; kind: string; label: string; relationId: string | null; other: EntityRef };
    const conns: Conn[] = [];
    for (const r of res[0]?.results ?? []) {
      const out = str(r.source_type) === a.type && str(r.source_id) === a.id;
      conns.push({
        direction: out ? 'out' : 'in',
        kind: str(r.kind),
        label: str(r.label),
        relationId: str(r.id),
        other: out
          ? { type: str(r.target_type) as GraphEntityType, id: str(r.target_id) }
          : { type: str(r.source_type) as GraphEntityType, id: str(r.source_id) },
      });
    }
    for (const r of res[1]?.results ?? []) conns.push({ direction: 'in', kind: 'links_to', label: '', relationId: null, other: { type: 'note', id: str(r.id) } });
    if (a.type === 'note') {
      for (const r of res[2]?.results ?? []) {
        conns.push({ direction: 'out', kind: 'links_to', label: '', relationId: null, other: { type: str(r.target_type) as GraphEntityType, id: str(r.target_id) } });
      }
      const readingId = strOrNull(res[3]?.results?.[0]?.reading_id);
      if (readingId) conns.push({ direction: 'out', kind: 'annotates', label: '', relationId: null, other: { type: 'reading', id: readingId } });
    } else if (a.type === 'topic') {
      for (const r of res[2]?.results ?? []) {
        const type = str(r.type) as GraphEntityType;
        conns.push({ direction: 'out', kind: type === 'topic' ? 'parent' : 'contains', label: '', relationId: null, other: { type, id: str(r.id) } });
      }
    } else if (a.type === 'reading') {
      for (const r of res[2]?.results ?? []) conns.push({ direction: 'in', kind: 'annotates', label: '', relationId: null, other: { type: 'note', id: str(r.id) } });
    }
    if (self.topicId) {
      conns.push({ direction: 'in', kind: a.type === 'topic' ? 'parent' : 'contains', label: '', relationId: null, other: { type: 'topic', id: self.topicId } });
    }
    const info = await resolveEntities(ctx.db, u, conns.map((c) => c.other));
    ctx.sources.add({ type: a.type, id: a.id, title: self.title }, 'read');
    const connections = conns.flatMap((c) => {
      const found = info.get(entityKey(c.other.type, c.other.id));
      if (!found) return [];
      ctx.sources.add({ type: c.other.type as SearchEntityType, id: c.other.id, title: found.title });
      const text = EDGE_TEXT[c.kind] ?? { out: c.kind, in: c.kind };
      return [
        {
          reads_as: c.direction === 'out' ? `este item ${text.out}` : `este item ${text.in}`,
          origin: edgeOrigin(c.kind),
          ...(c.relationId ? { relation_id: c.relationId, relation_kind: c.kind } : {}),
          ...(c.label ? { relation_label: c.label } : {}),
          item: { type: c.other.type, id: c.other.id, title: found.title || 'Sem título', link: linkOf(c.other.type, c.other.id) },
        },
      ];
    });
    return {
      item: { type: a.type, id: a.id, title: self.title, link: linkOf(a.type, a.id) },
      connections,
      total: connections.length,
    };
  },
});

/* ---------------------------------------------------- find_connection_path -- */

const zPath = z.strictObject({
  from_type: zEntity,
  from_id: zId,
  to_type: zEntity,
  to_id: zId,
  max_depth: z.number().int().min(1).max(6).nullable(),
});

export const findConnectionPath = defineTool({
  name: 'find_connection_path',
  kind: 'read',
  description:
    'Finds the shortest chain of connections between two items in the knowledge graph (hierarchy, "/" references, book annotations and typed relations), plus shared #tags. Use it to explain why two notes or topics are connected.',
  parameters: S.obj({
    from_type: S.enum(GRAPH_ENTITY_TYPES),
    from_id: S.str(),
    to_type: S.enum(GRAPH_ENTITY_TYPES),
    to_id: S.str(),
    max_depth: S.nint('Max number of steps, 1–6 (default 4).'),
  }),
  args: zPath,
  label: () => 'Procurou um caminho no grafo',
  async run(ctx, a) {
    const graph = await buildGraph(ctx.db, ctx.userId, { structure: 'true' });
    const from = entityKey(a.from_type, a.from_id);
    const to = entityKey(a.to_type, a.to_id);
    const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
    for (const [key, side] of [
      [from, 'origem'],
      [to, 'destino'],
    ] as const) {
      if (!nodes.has(key)) {
        return { error: 'not_found', message: `Item de ${side} não encontrado no grafo${graph.truncated ? ' (o grafo foi truncado)' : ''}.` };
      }
    }
    const adjacency = new Map<string, { edge: GraphEdge; other: string; forward: boolean }[]>();
    const link = (k: string, v: { edge: GraphEdge; other: string; forward: boolean }) => adjacency.set(k, [...(adjacency.get(k) ?? []), v]);
    for (const e of graph.edges) {
      link(e.source, { edge: e, other: e.target, forward: true });
      link(e.target, { edge: e, other: e.source, forward: false });
    }
    const maxDepth = a.max_depth ?? 4;
    const prev = new Map<string, { from: string; edge: GraphEdge; forward: boolean }>();
    const depth = new Map<string, number>([[from, 0]]);
    const queue = [from];
    while (queue.length && !depth.has(to)) {
      const cur = queue.shift()!;
      const d = depth.get(cur)!;
      if (d >= maxDepth) continue;
      for (const next of adjacency.get(cur) ?? []) {
        if (depth.has(next.other)) continue;
        depth.set(next.other, d + 1);
        prev.set(next.other, { from: cur, edge: next.edge, forward: next.forward });
        queue.push(next.other);
      }
    }
    const describe = (key: string) => {
      const n = nodes.get(key)!;
      ctx.sources.add({ type: n.type, id: n.entityId, title: n.label, role: n.role });
      return { type: n.type, id: n.entityId, title: n.label, link: linkOf(n.type, n.entityId) };
    };
    const tagsOf = (key: string) => {
      const node = nodes.get(key)!;
      return node.type === 'note' ? (graph.tags ?? []).filter((t) => t.noteIds.includes(node.entityId)).map((t) => t.tag) : [];
    };
    const fromTags = new Set(tagsOf(from));
    const sharedTags = tagsOf(to).filter((t) => fromTags.has(t)).map((t) => `#${t}`);
    if (!depth.has(to)) {
      return {
        found: false,
        from: describe(from),
        to: describe(to),
        shared_tags: sharedTags,
        message: `Nenhum caminho com até ${maxDepth} passos.`,
      };
    }
    const steps: Record<string, unknown>[] = [];
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur)!;
      const text = EDGE_TEXT[p.edge.kind] ?? { out: p.edge.kind, in: p.edge.kind };
      const a1 = describe(p.from);
      const b1 = describe(cur);
      steps.unshift({
        from: a1,
        to: b1,
        reads_as: `${a1.title} ${p.forward ? text.out : text.in} ${b1.title}`,
        origin: edgeOrigin(p.edge.kind),
        ...(p.edge.relationId ? { relation_id: p.edge.relationId } : {}),
        ...(p.edge.label ? { relation_label: p.edge.label } : {}),
      });
      cur = p.from;
    }
    return { found: true, length: steps.length, steps, shared_tags: sharedTags };
  },
});

/* ------------------------------------------------------------ get_mind_map -- */

const zMindMap = z.strictObject({ topic_id: zId.nullable(), map_id: zId.nullable() });
const MAP_MAX_LINES = 150;

export const getMindMapTool = defineTool({
  name: 'get_mind_map',
  kind: 'read',
  description:
    'Reads a mind map as an outline. topic_id: the map generated from a topic (subtopics as branches, items under their topic, typed relations as cross-links). ' +
    'map_id: a free mind map (nodes, parent links, extra labelled links, items linked to nodes) with `version`. Both null: lists the free mind maps.',
  parameters: S.obj({
    topic_id: S.nstr('Topic whose generated map to read.'),
    map_id: S.nstr('Free mind map id.'),
  }),
  args: zMindMap,
  label: (a) => (a.map_id ? 'Leu um mapa mental' : a.topic_id ? 'Leu o mapa mental de um assunto' : 'Listou os mapas mentais'),
  async run(ctx, a) {
    if (a.map_id) {
      const row = await stmt(ctx.db, 'SELECT * FROM mind_maps WHERE id = ? AND user_id = ?', a.map_id, ctx.userId).first<Row>();
      if (!row) return { error: 'not_found', message: 'Mapa mental não encontrado.' };
      const data = parseJson<{
        nodes: { id: string; label: string; parentId: string | null; ref: { type: string; id: string; title?: string } | null }[];
        edges: { source: string; target: string; label: string }[];
      }>(row.data, { nodes: [], edges: [] });
      ctx.sources.add({ type: 'mindmap', id: a.map_id, title: str(row.title) }, 'read');
      const byParent = new Map<string | null, typeof data.nodes>();
      const ids = new Set(data.nodes.map((n) => n.id));
      for (const n of data.nodes) {
        const p = n.parentId && ids.has(n.parentId) ? n.parentId : null;
        byParent.set(p, [...(byParent.get(p) ?? []), n]);
      }
      const label = new Map(data.nodes.map((n) => [n.id, n.label]));
      const lines: string[] = [];
      const visit = (n: (typeof data.nodes)[number], depth: number, seen: Set<string>) => {
        if (seen.has(n.id) || lines.length >= MAP_MAX_LINES) return;
        seen.add(n.id);
        const ref = n.ref ? ` → ${n.ref.type} ${linkOf(n.ref.type, n.ref.id)}` : '';
        lines.push(`${'  '.repeat(depth)}- ${truncate(n.label || n.ref?.title || '(sem texto)', 120).text}${ref}`);
        for (const c of byParent.get(n.id) ?? []) visit(c, depth + 1, seen);
      };
      const seen = new Set<string>();
      for (const r of byParent.get(null) ?? []) visit(r, 0, seen);
      const parentOf = new Map(data.nodes.map((n) => [n.id, n.parentId]));
      const cross = data.edges
        .filter((e) => parentOf.get(e.target) !== e.source)
        .slice(0, 60)
        .map((e) => `${label.get(e.source) ?? '?'} —${e.label ? ` ${e.label} ` : ''}→ ${label.get(e.target) ?? '?'}`);
      return {
        id: a.map_id,
        link: linkOf('mindmap', a.map_id),
        title: str(row.title),
        version: num(row.version),
        topic_id: strOrNull(row.topic_id),
        nodes: data.nodes.length,
        outline: lines.join('\n'),
        cross_links: cross,
        truncated: lines.length >= MAP_MAX_LINES,
      };
    }
    if (a.topic_id) {
      const graph = await buildGraph(ctx.db, ctx.userId, { topicId: a.topic_id, structure: 'true' });
      const root = graph.nodes.find((n) => n.key === entityKey('topic', a.topic_id!));
      if (!root) return { error: 'not_found', message: 'Assunto não encontrado.' };
      const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
      const children = new Map<string, string[]>();
      for (const e of graph.edges) {
        if (e.kind === 'parent' || e.kind === 'contains' || e.kind === 'annotates') {
          const [p, c] = e.kind === 'annotates' ? [e.target, e.source] : [e.source, e.target];
          children.set(p, [...(children.get(p) ?? []), c]);
        }
      }
      const lines: string[] = [];
      const visit = (key: string, depth: number, seen: Set<string>) => {
        if (seen.has(key) || lines.length >= MAP_MAX_LINES) return;
        seen.add(key);
        const n = nodes.get(key)!;
        ctx.sources.add({ type: n.type, id: n.entityId, title: n.label, role: n.role });
        lines.push(`${'  '.repeat(depth)}- [${n.type}${n.role && n.role !== 'note' ? `:${n.role}` : ''}] ${truncate(n.label, 100).text} (${linkOf(n.type, n.entityId)})`);
        // Subtopics first, then the items of the topic.
        const kids = (children.get(key) ?? []).sort((x, y) => Number(nodes.get(x)?.type !== 'topic') - Number(nodes.get(y)?.type !== 'topic'));
        for (const c of kids) visit(c, depth + 1, seen);
      };
      visit(root.key, 0, new Set());
      const relations = graph.edges
        .filter((e) => e.relationId)
        .slice(0, 60)
        .map((e) => `${nodes.get(e.source)?.label} —${RELATION_KIND_LABELS[e.kind as RelationKind] ?? e.kind}${e.label ? ` (${e.label})` : ''}→ ${nodes.get(e.target)?.label}`);
      return {
        topic: { id: a.topic_id, title: root.label, link: linkOf('topic', a.topic_id) },
        outline: lines.join('\n'),
        relations,
        references_between_items: graph.edges.filter((e) => e.kind === 'links_to').length,
        truncated: lines.length >= MAP_MAX_LINES || graph.truncated,
      };
    }
    const maps = (
      await stmt(ctx.db, 'SELECT id, title, topic_id, node_count, updated_at FROM mind_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 40', ctx.userId).all<Row>()
    ).results;
    return {
      free_maps: maps.map((m) => {
        ctx.sources.add({ type: 'mindmap', id: str(m.id), title: str(m.title) });
        return { id: str(m.id), link: linkOf('mindmap', str(m.id)), title: str(m.title), nodes: num(m.node_count), topic_id: strOrNull(m.topic_id) };
      }),
      note: 'Cada assunto também tem um mapa gerado (use topic_id).',
    };
  },
});

export const graphTools = [getConnections, findConnectionPath, getMindMapTool];
