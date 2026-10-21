import { normalizeSearch, type RichTextDoc, type RichTextNode } from './text';

/**
 * Templates and daily notes, shared by the app and the assistant. Templates
 * are ordinary notes kept in a topic chosen in Settings (like Obsidian's
 * templates folder). Their text may use variables, replaced when the template
 * is used: {{data}}, {{hora}}, {{titulo}}, {{assunto}}, and
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

/** "2026-10-21" (calendar day) → a local Date at noon (no time zone surprises). */
export function dateFromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
}
