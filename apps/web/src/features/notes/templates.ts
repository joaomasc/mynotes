import type { QueryClient } from '@tanstack/react-query';
import { fillTemplate, formatDate, uuidv7, type Note, type NoteSettings, type RichTextDoc, type RichTextNode } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { justCreatedNotes } from './use-create-note';

// Shared with the assistant (the API creates daily notes the same way).
export { fillTemplate, fillText, formatDate, parseDailyTitle, type TemplateVars } from '@mynotes/shared';

/** Template content without an empty last paragraph (for inserting at the cursor). */
export function templateBlocks(doc: RichTextDoc): RichTextNode[] {
  const blocks = [...(doc.content ?? [])];
  while (blocks.length && blocks[blocks.length - 1]!.type === 'paragraph' && !blocks[blocks.length - 1]!.content?.length) blocks.pop();
  return blocks;
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
