import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants';
import { UUID_RE } from '../ids';
import type { RichTextDoc, RichTextNode } from '../text';

// Validation messages reach the user (API errors, forms): keep them in Portuguese.
z.config(z.locales.ptBR());

export const zId = z.string().regex(UUID_RE, 'Identificador inválido');
export const zDateTime = z.iso.datetime({ offset: false });
export const zDate = z.iso.date();
export const zVersion = z.number().int().min(1);

export const zTrimmed = (max: number) => z.string().trim().max(max);
export const zTitle = (max: number) => z.string().trim().min(1, 'Informe um título').max(max);
export const zColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
  .nullable();

/** Base64 (standard or URL-safe), bounded length. */
export const zBase64 = (maxLen = 512) =>
  z
    .string()
    .max(maxLen)
    .regex(/^[A-Za-z0-9+/_-]+={0,2}$/, 'Codificação inválida');

export const zPageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export const zBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const zPageMeta = z.object({ nextCursor: z.string().nullable() });

/**
 * Rich-text (Tiptap/ProseMirror JSON). Shape is validated structurally here;
 * the API additionally bounds size and sanitizes links.
 */
function isRichTextNode(value: unknown, depth: number): value is RichTextNode {
  if (depth > 100 || typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== 'string' || node.type.length === 0 || node.type.length > 64) return false;
  if (node.text !== undefined && typeof node.text !== 'string') return false;
  if (node.attrs !== undefined && (typeof node.attrs !== 'object' || node.attrs === null)) return false;
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks) || node.marks.length > 20) return false;
    for (const mark of node.marks) {
      if (typeof mark !== 'object' || mark === null || typeof (mark as { type?: unknown }).type !== 'string') {
        return false;
      }
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return false;
    for (const child of node.content) if (!isRichTextNode(child, depth + 1)) return false;
  }
  return true;
}

export const zRichTextDoc = z
  .looseObject({
    type: z.literal('doc'),
    // ProseMirror omits `content` when a node has no children, so an empty
    // document serializes as `{ "type": "doc" }` (e.g. a new note whose title
    // was typed before its body). Normalized to an empty array.
    content: z.array(z.looseObject({ type: z.string() })).default([]),
  })
  .refine((value) => isRichTextNode(value, 0), { message: 'Documento de texto inválido' }) as unknown as z.ZodType<
  RichTextDoc,
  RichTextDoc
>;

export const zPosition = z.object({
  /** Place the item right after this sibling (null = first). */
  afterId: zId.nullable().optional(),
  /** Place the item right before this sibling (null = last). */
  beforeId: zId.nullable().optional(),
});

export type PageMeta = z.infer<typeof zPageMeta>;
