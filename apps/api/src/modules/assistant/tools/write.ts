import { z } from 'zod';
import { GRAPH_ENTITY_TYPES, INTERNAL_LINK_TYPES, NOTE_TITLE_MAX, RELATION_KINDS, TOPIC_TITLE_MAX, zId } from '@mynotes/shared';
import {
  execute,
  failureMessage,
  planCreateMindMap,
  planCreateNote,
  planCreateRelations,
  planCreateTopics,
  planMoveTopic,
  planUpdateNote,
  planUpdateTopic,
  recordAction,
  type Plan,
} from '../actions';
import { defineTool, q, S, type ToolContext, type ToolOutput } from './types';

export const MODES = ['execute', 'propose'] as const;
export const zMode = z.enum(MODES);
export const modeParam = S.enum(
  MODES,
  'execute: apply now — ONLY when the user\'s latest message explicitly asks for this change. propose: register a proposal the user confirms in the app (use for suggestions).',
);

/**
 * Runs a plan or registers it as a proposal. It runs only when it is a
 * single reversible write, the model asked to execute and the user's message
 * asks for a change; batches, overwrites and moves always wait for the user.
 */
export async function apply(ctx: ToolContext, plan: Plan, mode: 'execute' | 'propose'): Promise<ToolOutput> {
  if (plan.noop) return { status: 'nothing_to_do', message: plan.noop, preview: plan.preview.map((l) => l.label) };
  const reason =
    plan.kind === 'sensitive'
      ? 'operação sensível: sempre exige confirmação'
      : plan.confirm
        ? 'criação em lote ou possível duplicata: exige confirmação'
        : mode === 'propose'
          ? 'registrada como sugestão'
          : !ctx.writeIntent
            ? 'a mensagem do usuário não pede uma alteração explícita'
            : null;
  if (reason) {
    const action = await recordAction(ctx.db, ctx.userId, ctx.conversationId, plan, 'proposed');
    ctx.actions.push(action);
    return {
      status: 'awaiting_confirmation',
      action_id: action.id,
      title: plan.title,
      reason,
      message: 'Nada foi gravado ainda. O usuário vê um cartão com a prévia e os botões Confirmar/Descartar abaixo da sua resposta.',
    };
  }
  try {
    const result = await execute(ctx.db, ctx.userId, plan);
    const action = await recordAction(ctx.db, ctx.userId, ctx.conversationId, plan, 'executed', { results: result.results });
    ctx.actions.push(action);
    for (const r of result.results) ctx.sources.add(r, 'read');
    return { status: 'executed', action_id: action.id, summary: result.summary, ...result.output };
  } catch (err) {
    return { status: 'failed', error: 'write_failed', message: failureMessage(err) };
  }
}

/* -------------------------------------------------------------- create_note -- */

const zCreateNote = z.strictObject({
  title: z.string().trim().max(NOTE_TITLE_MAX),
  content_markdown: z.string().max(20_000),
  topic_id: zId.nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  references: z.array(z.strictObject({ type: z.enum(INTERNAL_LINK_TYPES), id: zId })).max(30),
  book: z
    .strictObject({
      reading_id: zId,
      page: z.number().int().min(1).max(100_000).nullable(),
      quote: z.string().trim().max(2000).nullable(),
    })
    .nullable(),
  mode: zMode,
});

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

export const createNoteTool = defineTool({
  name: 'create_note',
  kind: 'write',
  description:
    'Creates a note (an ordinary note, or a page annotation of a book when `book` is given). Content is Markdown (headings, lists, bold, quotes). ' +
    'Link items inline with [Title](mynotes:<type>/<id>) — they become "/" references; a book page is mynotes:reading/<id>/p/<page>. ' +
    '`references` adds a "Referências" line; `tags` adds #tags (existing ones preferred: list_tags). All ids must come from tools.',
  parameters: S.obj({
    title: S.str('Note title.'),
    content_markdown: S.str('Body in Markdown.'),
    topic_id: S.nstr('Topic to file the note under (null = no topic).'),
    tags: S.arr(S.str(), 'Tag names without "#" (may be empty).'),
    references: S.arr(S.obj({ type: S.enum(INTERNAL_LINK_TYPES), id: S.str() }), 'Items to reference (may be empty).'),
    book: nullable(
      S.obj({
        reading_id: S.str('Book/reading id.'),
        page: S.nint('Page the annotation refers to (only if known).'),
        quote: S.nstr('Quoted passage from the book, if the user gave one.'),
      }),
    ),
    mode: modeParam,
  }),
  args: zCreateNote,
  label: (a) => `Nota ${q(a.title || 'Sem título')}`,
  async run(ctx, a) {
    const plan = await planCreateNote(ctx.db, ctx.userId, {
      title: a.title,
      topicId: a.topic_id,
      markdown: a.content_markdown,
      tags: a.tags,
      references: a.references,
      book: a.book ? { readingId: a.book.reading_id, page: a.book.page, quote: a.book.quote ?? '' } : null,
    });
    return apply(ctx, plan, a.mode);
  },
});

/* -------------------------------------------------------------- update_note -- */

const zUpdateNote = z.strictObject({
  note_id: zId,
  base_version: z.number().int().min(1),
  title: z.string().trim().max(NOTE_TITLE_MAX).nullable(),
  append_markdown: z.string().max(20_000).nullable(),
  replace_markdown: z.string().max(20_000).nullable(),
  move_to_topic_id: zId.nullable(),
  remove_from_topic: z.boolean(),
  mode: zMode,
});

export const updateNoteTool = defineTool({
  name: 'update_note',
  kind: 'write',
  description:
    'Edits a note. Read it first with get_note and pass its `version` as base_version (a changed note is refused, never overwritten). ' +
    'Fields left null are kept. Prefer append_markdown (adds to the end, keeps everything). replace_markdown rewrites the whole text and always needs the user\'s confirmation (the old text stays in the note history).',
  parameters: S.obj({
    note_id: S.str(),
    base_version: S.int('`version` from get_note.'),
    title: S.nstr('New title (null = keep).'),
    append_markdown: S.nstr('Markdown to add at the end (null = none).'),
    replace_markdown: S.nstr('New full text (null = keep).'),
    move_to_topic_id: S.nstr('Move the note to this topic (null = keep).'),
    remove_from_topic: S.bool('true = take the note out of its topic.'),
    mode: modeParam,
  }),
  args: zUpdateNote,
  label: () => 'Edição de nota',
  async run(ctx, a) {
    const plan = await planUpdateNote(ctx.db, ctx.userId, {
      noteId: a.note_id,
      baseVersion: a.base_version,
      title: a.title,
      append: a.append_markdown,
      replace: a.replace_markdown,
      topic: a.remove_from_topic ? { set: true, id: null } : a.move_to_topic_id ? { set: true, id: a.move_to_topic_id } : { set: false, id: null },
    });
    return apply(ctx, plan, a.mode);
  },
});

/* ------------------------------------------------------------ create_topics -- */

const zCreateTopics = z.strictObject({
  parent_id: zId.nullable(),
  topics: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(TOPIC_TITLE_MAX),
        description: z.string().trim().max(2000).nullable(),
        parent_key: z.string().trim().min(1).max(40).nullable(),
      }),
    )
    .min(1)
    .max(40),
  mode: zMode,
});

export const createTopicsTool = defineTool({
  name: 'create_topics',
  kind: 'write',
  description:
    'Creates one topic or a whole tree of topics/subtopics in one call. Each item has a short `key`; `parent_key` points to another item of this call (null = directly under parent_id, or at the root when parent_id is null). ' +
    'Equivalent existing topics (same title, same parent) are reused, never duplicated. More than one new topic always waits for the user\'s confirmation (a preview is shown).',
  parameters: S.obj({
    parent_id: S.nstr('Existing topic under which the new ones go (null = root).'),
    topics: S.arr(
      S.obj({
        key: S.str('Short unique key, e.g. "t1".'),
        title: S.str(),
        description: S.nstr(),
        parent_key: S.nstr('Key of the parent item in this call (null = top level).'),
      }),
    ),
    mode: modeParam,
  }),
  args: zCreateTopics,
  label: (a) => (a.topics.length === 1 ? `Assunto ${q(a.topics[0]!.title)}` : `Estrutura de ${a.topics.length} assuntos`),
  async run(ctx, a) {
    const plan = await planCreateTopics(ctx.db, ctx.userId, {
      parentId: a.parent_id,
      topics: a.topics.map((t) => ({ key: t.key, title: t.title, description: t.description ?? '', parentKey: t.parent_key })),
    });
    return apply(ctx, plan, a.mode);
  },
});

/* ------------------------------------------------------------- update_topic -- */

const zUpdateTopic = z.strictObject({
  topic_id: zId,
  base_version: z.number().int().min(1),
  title: z.string().trim().min(1).max(TOPIC_TITLE_MAX).nullable(),
  description: z.string().trim().max(10_000).nullable(),
  mode: zMode,
});

export const updateTopicTool = defineTool({
  name: 'update_topic',
  kind: 'write',
  description: 'Renames a topic or changes its description. Pass `version` from get_topic as base_version. Null fields are kept.',
  parameters: S.obj({
    topic_id: S.str(),
    base_version: S.int(),
    title: S.nstr(),
    description: S.nstr(),
    mode: modeParam,
  }),
  args: zUpdateTopic,
  label: () => 'Edição de assunto',
  async run(ctx, a) {
    const plan = await planUpdateTopic(ctx.db, ctx.userId, {
      topicId: a.topic_id,
      baseVersion: a.base_version,
      title: a.title,
      description: a.description,
    });
    return apply(ctx, plan, a.mode);
  },
});

/* --------------------------------------------------------------- move_topic -- */

const zMoveTopic = z.strictObject({ topic_id: zId, base_version: z.number().int().min(1), new_parent_id: zId.nullable() });

export const moveTopicTool = defineTool({
  name: 'move_topic',
  kind: 'sensitive',
  description:
    'Moves a topic (with all its subtopics and notes) under another topic, or to the root. Changes the hierarchy, so it is always a proposal the user confirms. Cycles are refused.',
  parameters: S.obj({
    topic_id: S.str(),
    base_version: S.int('`version` from get_topic.'),
    new_parent_id: S.nstr('New parent topic (null = root).'),
  }),
  args: zMoveTopic,
  label: () => 'Mudança na hierarquia',
  async run(ctx, a) {
    const plan = await planMoveTopic(ctx.db, ctx.userId, { topicId: a.topic_id, baseVersion: a.base_version, parentId: a.new_parent_id });
    return apply(ctx, plan, 'propose');
  },
});

/* --------------------------------------------------------- create_relations -- */

const zCreateRelations = z.strictObject({
  relations: z
    .array(
      z.strictObject({
        source_type: z.enum(GRAPH_ENTITY_TYPES),
        source_id: zId,
        target_type: z.enum(GRAPH_ENTITY_TYPES),
        target_id: zId,
        kind: z.enum(RELATION_KINDS),
        label: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(20),
  mode: zMode,
});

export const createRelationsTool = defineTool({
  name: 'create_relations',
  kind: 'write',
  description:
    'Creates typed relations between real items (graph edges): related, references, depends_on, part_of, supports, contrasts, example_of. ' +
    'Duplicates (also the reverse of related/contrasts), self-links, cycles of depends_on/part_of and topic→topic part_of (that is hierarchy: move_topic) are refused. ' +
    'More than one new relation always waits for the user\'s confirmation. To only suggest connections, use mode "propose".',
  parameters: S.obj({
    relations: S.arr(
      S.obj({
        source_type: S.enum(GRAPH_ENTITY_TYPES),
        source_id: S.str(),
        target_type: S.enum(GRAPH_ENTITY_TYPES),
        target_id: S.str(),
        kind: S.enum(RELATION_KINDS),
        label: S.nstr('Optional short explanation shown on the edge.'),
      }),
    ),
    mode: modeParam,
  }),
  args: zCreateRelations,
  label: (a) => (a.relations.length === 1 ? 'Relação no grafo' : `${a.relations.length} relações no grafo`),
  async run(ctx, a) {
    const plan = await planCreateRelations(ctx.db, ctx.userId, {
      relations: a.relations.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        targetType: r.target_type,
        targetId: r.target_id,
        kind: r.kind,
        label: r.label ?? '',
      })),
    });
    return apply(ctx, plan, a.mode);
  },
});

/* --------------------------------------------------------- propose_mind_map -- */

const zMindMap = z.strictObject({
  title: z.string().trim().min(1).max(200),
  topic_id: zId.nullable(),
  map_id: zId.nullable(),
  base_version: z.number().int().min(1).nullable(),
  nodes: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(40),
        label: z.string().trim().max(300),
        parent_key: z.string().trim().min(1).max(40).nullable(),
        ref_type: z.enum(GRAPH_ENTITY_TYPES).nullable(),
        ref_id: zId.nullable(),
      }),
    )
    .min(1)
    .max(60),
  links: z
    .array(z.strictObject({ from_key: z.string().min(1).max(40), to_key: z.string().min(1).max(40), label: z.string().trim().max(120).nullable() }))
    .max(60),
});

export const proposeMindMapTool = defineTool({
  name: 'propose_mind_map',
  kind: 'write',
  description:
    'Proposes a concept/mind map: nodes in a hierarchy (key/parent_key), optional cross-links with labels, and nodes linked to real items (ref_type + ref_id from tools; create nodes without ref only for concepts that have no item). ' +
    'Creates a new free mind map, or (map_id + base_version from get_mind_map) adds the nodes to an existing one. Always waits for the user\'s confirmation. ' +
    'Note: the map generated from a topic follows its real subtopics; to change that structure use create_topics instead.',
  parameters: S.obj({
    title: S.str('Map title (ignored when map_id is set).'),
    topic_id: S.nstr('Topic to file the new map under.'),
    map_id: S.nstr('Existing free map to extend (null = new map).'),
    base_version: S.nint('`version` of the existing map.'),
    nodes: S.arr(
      S.obj({
        key: S.str(),
        label: S.str(),
        parent_key: S.nstr(),
        ref_type: S.nenum(GRAPH_ENTITY_TYPES),
        ref_id: S.nstr(),
      }),
    ),
    links: S.arr(S.obj({ from_key: S.str(), to_key: S.str(), label: S.nstr() })),
  }),
  args: zMindMap,
  label: (a) => `Mapa mental ${q(a.title)}`,
  async run(ctx, a) {
    for (const n of a.nodes) {
      if ((n.ref_type === null) !== (n.ref_id === null)) {
        return { error: 'invalid_arguments', message: `Nó ${n.key}: ref_type e ref_id vão juntos (ou ambos null).` };
      }
    }
    const plan = await planCreateMindMap(ctx.db, ctx.userId, {
      title: a.title,
      topicId: a.topic_id,
      mapId: a.map_id,
      baseVersion: a.base_version,
      nodes: a.nodes.map((n) => ({
        key: n.key,
        label: n.label,
        parentKey: n.parent_key,
        ref: n.ref_type && n.ref_id ? { type: n.ref_type, id: n.ref_id } : null,
      })),
      links: a.links.map((l) => ({ from: l.from_key, to: l.to_key, label: l.label ?? '' })),
    });
    return apply(ctx, plan, 'propose');
  },
});

export const writeTools = [
  createNoteTool,
  updateNoteTool,
  createTopicsTool,
  updateTopicTool,
  moveTopicTool,
  createRelationsTool,
  proposeMindMapTool,
];
