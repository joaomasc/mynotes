import type { QueryClient } from '@tanstack/react-query';
import { normalizeSearch, uuidv7, type Note, type NoteSettings, type RichTextDoc, type RichTextNode } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { justCreatedNotes } from './use-create-note';

/**
 * Templates are ordinary notes kept in a topic chosen in Settings (like
 * Obsidian's templates folder). Their text may use variables, replaced when
 * the template is used: {{data}}, {{hora}}, {{titulo}}, {{assunto}}, and
 * {{data:DD/MM/YYYY}} for a custom date format.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a date with YYYY, MM, DD, HH and mm tokens. */
export function formatDate(format: string, date = new Date()): string {
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()));
}

export interface TemplateVars {
  title: string;
  topic: string;
  date?: Date;
}

export function fillText(text: string, vars: TemplateVars): string {
  const date = vars.date ?? new Date();
  return text.replace(/\{\{\s*([\p{L}]+)(?::([^}]+))?\s*\}\}/gu, (match, rawName: string, fmt?: string) => {
    const name = normalizeSearch(rawName);
    if (name === 'data' || name === 'date') return formatDate(fmt?.trim() || 'DD/MM/YYYY', date);
    if (name === 'hora' || name === 'time') return formatDate(fmt?.trim() || 'HH:mm', date);
    if (name === 'titulo' || name === 'title') return vars.title;
    if (name === 'assunto' || name === 'topic') return vars.topic;
    return match;
  });
}

/** A copy of the template's document with its variables filled in. */
export function fillTemplate(doc: RichTextDoc, vars: TemplateVars): RichTextDoc {
  const visit = (node: RichTextNode): RichTextNode => ({
    ...node,
    ...(typeof node.text === 'string' ? { text: fillText(node.text, vars) } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return visit(structuredClone(doc)) as RichTextDoc;
}

/** Template content without an empty last paragraph (for inserting at the cursor). */
export function templateBlocks(doc: RichTextDoc): RichTextNode[] {
  const blocks = [...(doc.content ?? [])];
  while (blocks.length && blocks[blocks.length - 1]!.type === 'paragraph' && !blocks[blocks.length - 1]!.content?.length) blocks.pop();
  return blocks;
}

/**
 * The day a daily note's title stands for ("2026-10-21" with "YYYY-MM-DD"),
 * like Obsidian recognizes daily notes by their file name. Null for any other title.
 */
export function parseDailyTitle(format: string, title: string): Date | null {
  const order: string[] = [];
  const pattern = format.replace(/YYYY|MM|DD|HH|mm|[.*+?^${}()|[\]\\]/g, (token) => {
    if (token.length === 1) return `\\${token}`;
    order.push(token);
    return token === 'YYYY' ? '(\\d{4})' : '(\\d{2})';
  });
  const match = new RegExp(`^${pattern}$`).exec(title.trim());
  if (!match || !['YYYY', 'MM', 'DD'].every((t) => order.includes(t))) return null;
  const part = (token: string) => Number(match[order.indexOf(token) + 1]);
  const date = new Date(part('YYYY'), part('MM') - 1, part('DD'));
  return date.getMonth() === part('MM') - 1 && date.getDate() === part('DD') ? date : null;
}

/** Opens the daily note of a day (today by default), creating it (from its template) when it doesn't exist yet. */
export async function dailyNote(qc: QueryClient, settings: NoteSettings, topicTitle: string, date = new Date()): Promise<Note> {
  const title = formatDate(settings.dailyFormat, date);
  const results = await endpoints.search(title, 'note', 30);
  const found = results.find((r) => r.type === 'note' && r.title === title && (r.topicId ?? null) === settings.dailyTopicId);
  if (found) return endpoints.notes.get(found.id);
  let content: RichTextDoc | undefined;
  if (settings.dailyTemplateId) {
    try {
      const template = await endpoints.notes.get(settings.dailyTemplateId);
      content = fillTemplate(template.content, { title, topic: topicTitle, date });
    } catch {
      // template deleted: start empty
    }
  }
  const note = await endpoints.notes.create({ id: uuidv7(), title, topicId: settings.dailyTopicId, content });
  qc.setQueryData(qk.note(note.id), note);
  justCreatedNotes.add(note.id);
  void qc.invalidateQueries({ queryKey: qk.notesAll });
  void qc.invalidateQueries({ queryKey: qk.topics });
  return note;
}
