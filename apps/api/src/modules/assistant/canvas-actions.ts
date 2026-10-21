import {
  analyzeDoc,
  docToMarkdown,
  zMindMapData,
  type AiPreviewLine,
  type GraphEntityType,
  type MindMapData,
  type MindMapNode,
  type RichTextDoc,
} from '@mynotes/shared';
import { entityKey, type EntityRef } from '../../lib/entities';
import { createMindMap, getMindMap, updateMindMap } from '../knowledge/service';
import { PlanError, line, noteDoc, noteRefsInfo, quoted, requireEntities, source, type Execution, type Plan } from './actions';

/**
 * Canvases written by the assistant: the same cards the app makes (text with
 * Markdown and "/" references, notes and topics shown in full, web links,
 * groups that hold cards) and arrows between them. New cards are laid out
 * automatically; nothing is ever removed from a canvas.
 */

export const CANVAS_COLORS = {
  teal: '#0f6e6a',
  blue: '#3a5ba9',
  orange: '#a3532a',
  purple: '#7a4fa0',
  yellow: '#8a7a12',
  red: '#b4372f',
  green: '#2f7a3e',
  gray: '#5c5a54',
} as const;
export type CanvasColor = keyof typeof CANVAS_COLORS;
export const CANVAS_COLOR_NAMES = Object.keys(CANVAS_COLORS) as [CanvasColor, ...CanvasColor[]];
const colorName = (hex: string | null) => (Object.entries(CANVAS_COLORS).find(([, h]) => h.toLowerCase() === hex?.toLowerCase())?.[0] ?? hex ?? null);

export type CardKind = 'text' | 'item' | 'link' | 'group';

export interface CanvasCardInput {
  /** Short key, used by arrows and by cards placed inside this group. */
  key: string;
  kind: CardKind;
  /** Group label, link title. */
  title: string;
  /** Text cards. */
  markdown: string;
  /** Item cards. */
  ref: EntityRef | null;
  /** Link cards. */
  url: string | null;
  color: CanvasColor | null;
  /** Key of a new group, or id of a group card already on the canvas. */
  group: string | null;
}

export interface CanvasArrowInput {
  /** Card keys of this call, or ids of cards already on the canvas. */
  from: string;
  to: string;
  label: string;
  color: CanvasColor | null;
  arrow: 'none' | 'end' | 'both';
}

export interface CardEdit {
  cardId: string;
  markdown: string | null;
  title: string | null;
  url: string | null;
  /** "none" removes the color. */
  color: CanvasColor | 'none' | null;
}

export interface CreateCanvasPayload {
  title: string;
  topicId: string | null;
  noteId: string | null;
  cards: CanvasCardInput[];
  arrows: CanvasArrowInput[];
}

export interface UpdateCanvasPayload {
  canvasId: string;
  baseVersion: number;
  title: string | null;
  cards: CanvasCardInput[];
  arrows: CanvasArrowInput[];
  edits: CardEdit[];
}

type Node = MindMapNode;
type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (n: Node): Rect => ({ x: n.position.x, y: n.position.y, w: n.width ?? 280, h: n.height ?? 120 });
const inside = (a: Rect, g: Rect) => a.x >= g.x && a.y >= g.y && a.x + a.w <= g.x + g.w && a.y + a.h <= g.y + g.h;
const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/** A card's text for previews and for the model. */
export function cardText(n: Node, max = 80): string {
  const text = n.label || (n.doc ? analyzeDoc(structuredClone(n.doc)).text.replace(/\s+/g, ' ').trim() : '') || n.ref?.title || n.url || '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Size of a new card: text grows with its content; notes and topics show theirs. */
function sizeOf(card: CanvasCardInput, doc: RichTextDoc | null): { width: number; height: number } {
  if (card.kind === 'link') return { width: 300, height: 96 };
  if (card.kind === 'item') {
    if (card.ref?.type === 'note') return { width: 360, height: 320 };
    if (card.ref?.type === 'topic') return { width: 320, height: 280 };
    return { width: 280, height: 84 };
  }
  const code = !!doc?.content.some((b) => b.type === 'codeBlock');
  const width = code ? 440 : 320;
  const lines = card.markdown.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / (code ? 52 : 38))), 0);
  return { width, height: Math.min(640, Math.max(100, 48 + lines * 24)) };
}

const GAP = 60;
const PAD = 40;

/** Places cards in rows of at most `maxWidth`, from (x, y). Returns the bottom. */
function flow(items: { w: number; h: number; place: (x: number, y: number) => void }[], x0: number, y0: number, maxWidth: number): number {
  let x = x0;
  let y = y0;
  let rowH = 0;
  for (const it of items) {
    if (x > x0 && x + it.w > x0 + maxWidth) {
      x = x0;
      y += rowH + GAP;
      rowH = 0;
    }
    it.place(x, y);
    x += it.w + GAP;
    rowH = Math.max(rowH, it.h);
  }
  return y + rowH;
}

/** Arrow sides from the cards' positions: the facing sides. */
function sides(a: Node, b: Node): { sourceHandle: string; targetHandle: string } {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const dx = rb.x + rb.w / 2 - (ra.x + ra.w / 2);
  const dy = rb.y + rb.h / 2 - (ra.y + ra.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { sourceHandle: 'right', targetHandle: 'left' } : { sourceHandle: 'left', targetHandle: 'right' };
  return dy >= 0 ? { sourceHandle: 'bottom', targetHandle: 'top' } : { sourceHandle: 'top', targetHandle: 'bottom' };
}

/** Checks keys, groups, arrow ends and the items and references the cards point to. */
async function checkCards(db: D1Database, userId: string, cards: CanvasCardInput[], arrows: CanvasArrowInput[], existing: Node[]) {
  const keys = new Map<string, CanvasCardInput>();
  const old = new Map(existing.map((n) => [n.id, n]));
  for (const c of cards) {
    if (keys.has(c.key) || old.has(c.key)) throw new PlanError('invalid_arguments', `Chave de cartão repetida: ${c.key}`);
    keys.set(c.key, c);
  }
  for (const c of cards) {
    if (c.kind === 'item' && !c.ref) throw new PlanError('invalid_arguments', `Cartão ${c.key}: um cartão "item" precisa de ref_type e ref_id.`);
    if (c.kind === 'link' && !/^https?:\/\/\S+$/i.test(c.url ?? '')) throw new PlanError('invalid_arguments', `Cartão ${c.key}: um link precisa de um endereço http(s).`);
    if (c.kind === 'text' && !c.markdown.trim()) throw new PlanError('invalid_arguments', `Cartão ${c.key}: o cartão de texto está vazio.`);
    if (c.group !== null) {
      const g = keys.get(c.group);
      const gOld = old.get(c.group);
      if (!(g?.kind === 'group' || (gOld && gOld.kind === 'group'))) throw new PlanError('invalid_arguments', `Cartão ${c.key}: "${c.group}" não é um grupo deste canvas.`);
      if (c.kind === 'group') throw new PlanError('invalid_arguments', `Grupo ${c.key}: grupos não ficam dentro de outros grupos.`);
    }
  }
  for (const a of arrows) {
    if (!(keys.has(a.from) || old.has(a.from)) || !(keys.has(a.to) || old.has(a.to))) {
      throw new PlanError('invalid_arguments', `Seta entre cartões desconhecidos: ${a.from} → ${a.to} (use chaves desta chamada ou ids do get_mind_map).`);
    }
    if (a.from === a.to) throw new PlanError('invalid_arguments', 'Uma seta não pode sair e chegar no mesmo cartão.');
  }
  const refs = cards.flatMap((c) => (c.kind === 'item' && c.ref ? [c.ref] : []));
  const info = await requireEntities(db, userId, refs);
  const markdown = cards.filter((c) => c.kind === 'text').map((c) => c.markdown);
  const refsInfo = await noteRefsInfo(db, userId, { markdown: markdown.join('\n\n'), references: [] });
  return { info, refsInfo };
}

/** New cards (laid out below what is already there) and the arrows between them. */
async function buildCards(db: D1Database, userId: string, cards: CanvasCardInput[], arrows: CanvasArrowInput[], existing: Node[]) {
  const { info, refsInfo } = await checkCards(db, userId, cards, arrows, existing);
  const nodes = new Map<string, Node>();
  for (const c of cards) {
    const doc = c.kind === 'text' ? noteDoc(c.markdown, [], [], refsInfo) : null;
    const size = sizeOf(c, doc);
    const refTitle = c.ref ? info.get(entityKey(c.ref.type, c.ref.id))?.title ?? '' : '';
    nodes.set(c.key, {
      id: `c-${shortId()}`,
      kind: c.kind,
      position: { x: 0, y: 0 },
      ...size,
      label: (c.kind === 'item' ? refTitle : c.kind === 'text' ? '' : c.title).slice(0, 500),
      color: c.color ? CANVAS_COLORS[c.color] : null,
      ref: c.kind === 'item' && c.ref ? { type: c.ref.type as GraphEntityType, id: c.ref.id, title: refTitle.slice(0, 300) } : null,
      parentId: null,
      ...(doc ? { doc } : {}),
      ...(c.kind === 'link' && c.url ? { url: c.url } : {}),
    });
  }
  const node = (key: string) => nodes.get(key)!;
  const membersOf = (group: string) => cards.filter((c) => c.group === group).map((c) => node(c.key));

  // New groups: their cards in two columns inside, the group sized around them.
  for (const g of cards.filter((c) => c.kind === 'group')) {
    const members = membersOf(g.key);
    const items = members.map((m) => ({ w: m.width!, h: m.height!, place: (x: number, y: number) => (m.position = { x, y }) }));
    const widest = Math.max(0, ...members.map((m) => m.width!));
    const bottom = flow(items, PAD, PAD, Math.max(widest, 2 * 340 + GAP));
    const right = Math.max(0, ...members.map((m) => m.position.x + m.width!));
    const gn = node(g.key);
    gn.width = Math.min(5000, Math.max(400, right + PAD));
    gn.height = Math.min(5000, Math.max(240, bottom + PAD));
  }

  // Top level: new groups and loose cards, in rows, below what the canvas already has.
  const top = existing.length ? Math.max(...existing.map((n) => n.position.y + (n.height ?? 120))) + 160 : 0;
  const left = existing.length ? Math.min(...existing.map((n) => n.position.x)) : 0;
  const level = cards.filter((c) => c.group === null);
  flow(
    level.map((c) => {
      const n = node(c.key);
      return {
        w: n.width!,
        h: n.height!,
        place: (x: number, y: number) => {
          const dx = x - n.position.x;
          const dy = y - n.position.y;
          n.position = { x, y };
          // A group's cards were placed relative to it.
          if (c.kind === 'group') for (const m of membersOf(c.key)) m.position = { x: m.position.x + dx, y: m.position.y + dy };
        },
      };
    }),
    left,
    top,
    1600,
  );

  // Cards going into groups already on the canvas: below what each group holds, the group grows.
  const grown = new Map<string, Node>();
  const placed: Node[] = [];
  for (const c of cards.filter((x) => x.group !== null && !nodes.has(x.group!))) {
    const g = grown.get(c.group!) ?? structuredClone(existing.find((n) => n.id === c.group)!);
    grown.set(g.id, g);
    const gr = rectOf(g);
    const held = [...existing, ...placed].filter((n) => n.id !== g.id && inside(rectOf(n), gr));
    const n = node(c.key);
    const y = held.length ? Math.max(...held.map((h) => h.position.y + (h.height ?? 120))) + GAP : gr.y + PAD;
    n.position = { x: gr.x + PAD, y };
    g.width = Math.min(5000, Math.max(gr.w, n.width! + 2 * PAD));
    g.height = Math.min(5000, Math.max(gr.h, y - gr.y + n.height! + PAD));
    placed.push(n);
  }

  const all = new Map([...existing.map((n) => [n.id, n] as const), ...[...nodes].map(([k, n]) => [k, n] as const)]);
  const edges: MindMapData['edges'] = arrows.map((a) => ({
    id: `e-${shortId()}`,
    source: all.get(a.from)!.id,
    target: all.get(a.to)!.id,
    label: a.label.slice(0, 200),
    ...sides(all.get(a.from)!, all.get(a.to)!),
    color: a.color ? CANVAS_COLORS[a.color] : null,
    arrow: a.arrow,
  }));
  return { nodes, edges, grown };
}

function cardPreview(cards: CanvasCardInput[], nodes: Map<string, Node>, arrows: CanvasArrowInput[], label: (key: string) => string): AiPreviewLine[] {
  const describe = (c: CanvasCardInput) => {
    const n = nodes.get(c.key)!;
    if (c.kind === 'group') return `Grupo ${quoted(c.title || 'Grupo')}`;
    if (c.kind === 'link') return `Link ${c.title ? quoted(c.title) : (c.url ?? '')}`;
    if (c.kind === 'item') return `${c.ref?.type === 'note' ? 'Nota' : c.ref?.type === 'topic' ? 'Assunto' : 'Item'} ${quoted(n.label || 'Sem título')}`;
    return `Texto: ${cardText(n, 90)}`;
  };
  const lines: AiPreviewLine[] = [];
  for (const c of cards.filter((x) => x.group === null || !cards.some((g) => g.key === x.group))) {
    lines.push(line(0, describe(c), 'new', c.group ? 'dentro de um grupo do canvas' : null));
    if (c.kind === 'group') for (const m of cards.filter((x) => x.group === c.key)) lines.push(line(1, describe(m), 'new'));
  }
  for (const a of arrows.slice(0, 40)) lines.push(line(0, `${label(a.from)} → ${label(a.to)}`, 'new', a.label || 'seta'));
  return lines.slice(0, 120);
}

/* ================================================================ create == */

export async function planCreateCanvas(db: D1Database, userId: string, p: CreateCanvasPayload): Promise<Plan<CreateCanvasPayload>> {
  const owners = await requireEntities(db, userId, [
    ...(p.topicId ? [{ type: 'topic' as const, id: p.topicId }] : []),
    ...(p.noteId ? [{ type: 'note' as const, id: p.noteId }] : []),
  ]);
  const { nodes } = await buildCards(db, userId, p.cards, p.arrows, []);
  const where = p.noteId
    ? ` na nota ${quoted(owners.get(entityKey('note', p.noteId))!.title || 'Sem título')}`
    : p.topicId
      ? ` em ${quoted(owners.get(entityKey('topic', p.topicId))!.title)}`
      : '';
  const label = (key: string) => cardText(nodes.get(key)!, 40);
  return {
    tool: 'create_canvas',
    kind: 'write',
    title: `Criar o canvas ${quoted(p.title)}${where}`,
    preview: cardPreview(p.cards, nodes, p.arrows, label),
    payload: p,
    confirm: false,
  };
}

export async function executeCreateCanvas(db: D1Database, userId: string, p: CreateCanvasPayload): Promise<Execution> {
  await planCreateCanvas(db, userId, p);
  const { nodes, edges } = await buildCards(db, userId, p.cards, p.arrows, []);
  // Groups first: they are drawn below their cards.
  const ordered = [...nodes.values()].sort((a, b) => Number(b.kind === 'group') - Number(a.kind === 'group'));
  const { map } = await createMindMap(db, userId, {
    kind: 'canvas',
    topicId: p.topicId,
    noteId: p.noteId,
    title: p.title,
    data: zMindMapData.parse({ nodes: ordered, edges, viewport: null }),
  });
  return {
    results: [source('mindmap', map.id, map.title)],
    summary: `Criou o canvas ${quoted(map.title)} com ${nodes.size} cartão(ões)`,
    output: {
      canvas: { id: map.id, title: map.title, link: `mynotes:mindmap/${map.id}`, version: map.version, cards: map.nodeCount },
      card_ids: Object.fromEntries([...nodes].map(([k, n]) => [k, n.id])),
    },
  };
}

/* ================================================================ update == */

async function currentCanvas(db: D1Database, userId: string, p: UpdateCanvasPayload) {
  const map = await getMindMap(db, userId, p.canvasId).catch(() => null);
  if (!map) throw new PlanError('not_found', 'Canvas não encontrado (confira o id com get_mind_map).');
  if (map.kind !== 'canvas') throw new PlanError('invalid_arguments', 'Isto é um mapa mental, não um canvas: use propose_mind_map com map_id.');
  if (map.version !== p.baseVersion) {
    throw new PlanError('version_conflict', `O canvas mudou (versão atual ${map.version}, a pedida era ${p.baseVersion}). Leia de novo com get_mind_map.`, {
      currentVersion: map.version,
    });
  }
  return map;
}

function checkEdits(edits: CardEdit[], existing: Node[]) {
  const byId = new Map(existing.map((n) => [n.id, n]));
  for (const e of edits) {
    const n = byId.get(e.cardId);
    if (!n) throw new PlanError('invalid_arguments', `Cartão inexistente neste canvas: ${e.cardId}`);
    const kind = n.kind ?? (n.ref ? 'item' : 'text');
    if (e.markdown !== null && kind !== 'text') throw new PlanError('invalid_arguments', `Cartão ${e.cardId}: só cartões de texto têm texto (para notas, use update_note).`);
    if (e.url !== null && (kind !== 'link' || !/^https?:\/\/\S+$/i.test(e.url))) throw new PlanError('invalid_arguments', `Cartão ${e.cardId}: endereço só em cartões de link, e http(s).`);
    if (e.title !== null && kind !== 'group' && kind !== 'link') throw new PlanError('invalid_arguments', `Cartão ${e.cardId}: título só em grupos e links.`);
  }
  return byId;
}

export async function planUpdateCanvas(db: D1Database, userId: string, p: UpdateCanvasPayload): Promise<Plan<UpdateCanvasPayload>> {
  if (p.title === null && !p.cards.length && !p.arrows.length && !p.edits.length) throw new PlanError('invalid_arguments', 'Nada para alterar no canvas.');
  const map = await currentCanvas(db, userId, p);
  const byId = checkEdits(p.edits, map.data.nodes);
  if (p.edits.some((e) => e.markdown !== null)) await noteRefsInfo(db, userId, { markdown: p.edits.map((e) => e.markdown ?? '').join('\n\n'), references: [] });
  const { nodes } = await buildCards(db, userId, p.cards, p.arrows, map.data.nodes);
  const label = (key: string) => cardText(nodes.get(key) ?? byId.get(key)!, 40);
  const preview: AiPreviewLine[] = [];
  if (p.title !== null) preview.push(line(0, `Título: ${quoted(map.title)} → ${quoted(p.title)}`, 'change'));
  for (const e of p.edits) {
    const n = byId.get(e.cardId)!;
    const what = [e.markdown !== null && 'texto novo', e.title !== null && `título ${quoted(e.title)}`, e.url !== null && 'endereço novo', e.color !== null && (e.color === 'none' ? 'sem cor' : `cor ${e.color}`)].filter(Boolean).join(', ');
    preview.push(line(0, `${cardText(n, 60) || 'Cartão'}: ${what}`, 'change', e.markdown?.slice(0, 300) ?? null));
  }
  preview.push(...cardPreview(p.cards, nodes, p.arrows, label));
  return {
    tool: 'update_canvas',
    kind: 'write',
    title: `Alterar o canvas ${quoted(map.title)}`,
    preview: preview.slice(0, 120),
    payload: p,
    // Rewriting a card's text replaces what the user wrote there (a canvas has no history).
    confirm: p.edits.some((e) => e.markdown !== null),
  };
}

export async function executeUpdateCanvas(db: D1Database, userId: string, p: UpdateCanvasPayload): Promise<Execution> {
  await planUpdateCanvas(db, userId, p);
  const map = await currentCanvas(db, userId, p);
  const { nodes, edges, grown } = await buildCards(db, userId, p.cards, p.arrows, map.data.nodes);
  const refsInfo = await noteRefsInfo(db, userId, { markdown: p.edits.map((e) => e.markdown ?? '').join('\n\n'), references: [] });
  const edits = new Map(p.edits.map((e) => [e.cardId, e]));
  const kept = map.data.nodes.map((n) => {
    const base = grown.get(n.id) ?? n;
    const e = edits.get(n.id);
    if (!e) return base;
    return {
      ...base,
      ...(e.markdown !== null ? { doc: noteDoc(e.markdown, [], [], refsInfo), label: '' } : {}),
      ...(e.title !== null ? { label: e.title.slice(0, 500) } : {}),
      ...(e.url !== null ? { url: e.url } : {}),
      ...(e.color !== null ? { color: e.color === 'none' ? null : CANVAS_COLORS[e.color] } : {}),
    };
  });
  const added = [...nodes.values()];
  const data = zMindMapData.parse({
    nodes: [...added.filter((n) => n.kind === 'group'), ...kept, ...added.filter((n) => n.kind !== 'group')],
    edges: [...map.data.edges, ...edges],
    viewport: map.data.viewport,
  });
  const summary = await updateMindMap(db, userId, map.id, { baseVersion: p.baseVersion, ...(p.title !== null ? { title: p.title } : {}), data });
  const parts = [added.length && `${added.length} cartão(ões)`, edges.length && `${edges.length} seta(s)`, p.edits.length && `${p.edits.length} edição(ões)`].filter(Boolean);
  return {
    results: [source('mindmap', summary.id, summary.title)],
    summary: `Alterou o canvas ${quoted(summary.title)}${parts.length ? `: ${parts.join(', ')}` : ''}`,
    output: {
      canvas: { id: summary.id, title: summary.title, link: `mynotes:mindmap/${summary.id}`, version: summary.version, cards: summary.nodeCount },
      card_ids: Object.fromEntries([...nodes].map(([k, n]) => [k, n.id])),
    },
  };
}

/* ================================================================== read == */

/** A canvas as the model reads it: cards with ids (to edit or connect them), groups and arrows. */
export function describeCanvas(data: MindMapData, linkOf: (type: string, id: string) => string, maxCards = 150) {
  const groups = data.nodes.filter((n) => n.kind === 'group');
  const groupOf = (n: Node) => groups.find((g) => g.id !== n.id && inside(rectOf(n), rectOf(g)))?.id ?? null;
  const cards = data.nodes.slice(0, maxCards).map((n) => {
    const kind = n.kind ?? (n.ref ? 'item' : 'text');
    return {
      id: n.id,
      kind,
      ...(kind === 'text' ? { text_markdown: n.doc ? docToMarkdown(n.doc) : n.label } : {}),
      ...(kind === 'group' || kind === 'link' ? { title: n.label } : {}),
      ...(kind === 'item' && n.ref ? { item: { type: n.ref.type, id: n.ref.id, title: n.ref.title ?? n.label, link: linkOf(n.ref.type, n.ref.id) } } : {}),
      ...(kind === 'item' && !n.ref ? { item: null, note: 'o item foi excluído' } : {}),
      ...(n.url ? { url: n.url } : {}),
      color: colorName(n.color),
      group: kind === 'group' ? null : groupOf(n),
      box: { x: Math.round(n.position.x), y: Math.round(n.position.y), w: n.width ?? null, h: n.height ?? null },
    };
  });
  const label = new Map(data.nodes.map((n) => [n.id, cardText(n, 40)]));
  const arrows = data.edges.slice(0, 200).map((e) => ({
    from: e.source,
    to: e.target,
    reads_as: `${label.get(e.source) ?? '?'} → ${label.get(e.target) ?? '?'}`,
    label: e.label || null,
    arrow: e.arrow ?? 'end',
  }));
  return { cards, arrows, truncated: data.nodes.length > maxCards };
}
