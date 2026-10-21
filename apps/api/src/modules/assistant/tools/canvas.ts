import { z } from 'zod';
import { zId } from '@mynotes/shared';
import { CANVAS_COLOR_NAMES, planCreateCanvas, planUpdateCanvas, type CanvasArrowInput, type CanvasCardInput, type CanvasColor } from '../canvas-actions';
import { apply, modeParam, zMode } from './write';
import { defineTool, q, S } from './types';

const ITEM_TYPES = ['note', 'topic', 'reading', 'document', 'concept'] as const;
const CARD_KINDS = ['text', 'item', 'link', 'group'] as const;
const ARROWS = ['none', 'end', 'both'] as const;
const zColor = z.enum(CANVAS_COLOR_NAMES);
const EDIT_COLORS = [...CANVAS_COLOR_NAMES, 'none'] as [CanvasColor | 'none', ...(CanvasColor | 'none')[]];

const zCard = z.strictObject({
  key: z.string().trim().min(1).max(40),
  kind: z.enum(CARD_KINDS),
  title: z.string().trim().max(300).nullable(),
  text_markdown: z.string().max(8000).nullable(),
  ref_type: z.enum(ITEM_TYPES).nullable(),
  ref_id: zId.nullable(),
  url: z.string().trim().max(2048).nullable(),
  color: zColor.nullable(),
  group: z.string().trim().min(1).max(64).nullable(),
});
const zArrow = z.strictObject({
  from: z.string().trim().min(1).max(64),
  to: z.string().trim().min(1).max(64),
  label: z.string().trim().max(200).nullable(),
  color: zColor.nullable(),
  arrow: z.enum(ARROWS),
});

const cardParam = S.obj({
  key: S.str('Short unique key in this call, e.g. "c1" (arrows and grouped cards use it).'),
  kind: S.enum(CARD_KINDS, 'text: a card with Markdown; item: a real note/topic/book/document/concept (a note shows its full text, a topic its subtopics and notes); link: a web page; group: a labelled area holding cards.'),
  title: S.nstr('group: its name; link: the page title; null for text and item cards.'),
  text_markdown: S.nstr('text cards: the content in Markdown (headings, lists, **bold**, code blocks with ```language, [Título](mynotes:<type>/<id>) references, #tags).'),
  ref_type: S.nenum(ITEM_TYPES, 'item cards: type of the item.'),
  ref_id: S.nstr('item cards: id of the item (from tools).'),
  url: S.nstr('link cards: http(s) address.'),
  color: S.nenum(CANVAS_COLOR_NAMES),
  group: S.nstr('Put this card inside a group: the key of a group card of this call, or the id of a group already on the canvas.'),
});
const arrowParam = S.obj({
  from: S.str('Card key of this call, or id of a card already on the canvas.'),
  to: S.str(),
  label: S.nstr('Short text on the arrow ("causa", "leva a"…).'),
  color: S.nenum(CANVAS_COLOR_NAMES),
  arrow: S.enum(ARROWS, 'Arrowheads: end (default), both or none.'),
});

function toCards(cards: z.infer<typeof zCard>[]): CanvasCardInput[] | { error: string; message: string } {
  for (const c of cards) {
    if ((c.ref_type === null) !== (c.ref_id === null)) return { error: 'invalid_arguments', message: `Cartão ${c.key}: ref_type e ref_id vão juntos.` };
  }
  return cards.map((c) => ({
    key: c.key,
    kind: c.kind,
    title: c.title ?? '',
    markdown: c.text_markdown ?? '',
    ref: c.ref_type && c.ref_id ? { type: c.ref_type, id: c.ref_id } : null,
    url: c.url,
    color: c.color,
    group: c.group,
  }));
}
const toArrows = (arrows: z.infer<typeof zArrow>[]): CanvasArrowInput[] =>
  arrows.map((a) => ({ from: a.from, to: a.to, label: a.label ?? '', color: a.color, arrow: a.arrow }));

/* ------------------------------------------------------------ create_canvas -- */

const zCreateCanvas = z.strictObject({
  title: z.string().trim().min(1).max(200),
  topic_id: zId.nullable(),
  note_id: zId.nullable(),
  cards: z.array(zCard).min(1).max(60),
  arrows: z.array(zArrow).max(80),
  mode: zMode,
});

export const createCanvasTool = defineTool({
  name: 'create_canvas',
  kind: 'write',
  description:
    'Creates a canvas (a free board, like Obsidian Canvas) with cards and arrows, laid out automatically: text cards in Markdown, real notes/topics/books as cards, web links, and groups holding cards. ' +
    'It belongs to a topic (topic_id: shown on the topic page) and/or a note (note_id: shown on the note). Use it for "monte um canvas…", "organize visualmente…", "faça um quadro de estudo…". ' +
    'Prefer real items (item cards with ids from tools) over copying their text; write text cards for explanations, summaries, questions and code. Returns the new card ids.',
  parameters: S.obj({
    title: S.str('Canvas title.'),
    topic_id: S.nstr('Topic the canvas belongs to (null = none).'),
    note_id: S.nstr('Note the canvas belongs to (null = none).'),
    cards: S.arr(cardParam),
    arrows: S.arr(arrowParam, 'Arrows between cards (may be empty).'),
    mode: modeParam,
  }),
  args: zCreateCanvas,
  label: (a) => `Canvas ${q(a.title)}`,
  async run(ctx, a) {
    const cards = toCards(a.cards);
    if ('error' in cards) return cards;
    const plan = await planCreateCanvas(ctx.db, ctx.userId, { title: a.title, topicId: a.topic_id, noteId: a.note_id, cards, arrows: toArrows(a.arrows) });
    return apply(ctx, plan, a.mode);
  },
});

/* ------------------------------------------------------------ update_canvas -- */

const zUpdateCanvas = z.strictObject({
  canvas_id: zId,
  base_version: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).nullable(),
  add_cards: z.array(zCard).max(60),
  add_arrows: z.array(zArrow).max(80),
  edit_cards: z
    .array(
      z.strictObject({
        card_id: z.string().trim().min(1).max(64),
        text_markdown: z.string().max(8000).nullable(),
        title: z.string().trim().max(300).nullable(),
        url: z.string().trim().max(2048).nullable(),
        color: z.enum(EDIT_COLORS).nullable(),
      }),
    )
    .max(60),
  mode: zMode,
});

export const updateCanvasTool = defineTool({
  name: 'update_canvas',
  kind: 'write',
  description:
    'Changes an existing canvas: adds cards (placed below what is there, or inside an existing group via `group`), adds arrows (between new keys and/or existing card ids), edits cards (text of text cards, title of groups/links, link address, color) and renames it. ' +
    'Read it first with get_mind_map (map_id) to get card ids and `version` (base_version). Nothing is ever removed. Rewriting the text of an existing card waits for the user\'s confirmation.',
  parameters: S.obj({
    canvas_id: S.str(),
    base_version: S.int('`version` from get_mind_map.'),
    title: S.nstr('New title (null = keep).'),
    add_cards: S.arr(cardParam, 'May be empty.'),
    add_arrows: S.arr(arrowParam, 'May be empty.'),
    edit_cards: S.arr(
      S.obj({
        card_id: S.str('Id of a card on the canvas.'),
        text_markdown: S.nstr('text cards: new full text (null = keep).'),
        title: S.nstr('groups and links: new title (null = keep).'),
        url: S.nstr('links: new address (null = keep).'),
        color: S.nenum(EDIT_COLORS, '"none" removes the color (null = keep).'),
      }),
      'May be empty.',
    ),
    mode: modeParam,
  }),
  args: zUpdateCanvas,
  label: () => 'Alteração de canvas',
  async run(ctx, a) {
    const cards = toCards(a.add_cards);
    if ('error' in cards) return cards;
    const plan = await planUpdateCanvas(ctx.db, ctx.userId, {
      canvasId: a.canvas_id,
      baseVersion: a.base_version,
      title: a.title,
      cards,
      arrows: toArrows(a.add_arrows),
      edits: a.edit_cards.map((e) => ({ cardId: e.card_id, markdown: e.text_markdown, title: e.title, url: e.url, color: e.color })),
    });
    return apply(ctx, plan, a.mode);
  },
});

export const canvasTools = [createCanvasTool, updateCanvasTool];
