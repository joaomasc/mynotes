import type { QueryClient } from '@tanstack/react-query';
import { internalHref, normalizeAligned, normalizeSearch, type InternalLinkType, type Note, type RichTextDoc, type RichTextNode } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { notesSync } from '@/lib/sync/notes-sync';

/**
 * Unlinked mentions (like Obsidian's): notes whose text contains the title of
 * an item without referencing it. "Vincular" turns the first occurrence into
 * a reference, as if it had been written with "/".
 */

const WORD = /[\p{L}\p{N}]/u;

/** Index of the title in the text as a whole word, ignoring case and accents (-1 if absent). */
function findTitle(text: string, title: string): number {
  const t = normalizeAligned(text.normalize('NFC'));
  const q = normalizeAligned(title.normalize('NFC'));
  let from = 0;
  for (;;) {
    const i = t.indexOf(q, from);
    if (i < 0) return -1;
    const before = i > 0 ? t[i - 1]! : ' ';
    const after = t[i + q.length] ?? ' ';
    // The aligned text keeps offsets only for plain (BMP) characters: double-check the slice.
    if (!WORD.test(before) && !WORD.test(after) && normalizeSearch(text.slice(i, i + title.length)) === normalizeSearch(title)) return i;
    from = i + 1;
  }
}

const skippable = (node: RichTextNode) => node.marks?.some((m) => m.type === 'code' || m.type === 'link');

/** Text around the first mention, for the list. */
export function mentionExcerpt(doc: RichTextDoc, title: string): string | null {
  let found: string | null = null;
  const visit = (node: RichTextNode, inCode: boolean) => {
    if (found) return;
    if (typeof node.text === 'string' && !inCode && !skippable(node)) {
      const i = findTitle(node.text, title);
      if (i >= 0) {
        const start = Math.max(0, i - 60);
        found = `${start > 0 ? '…' : ''}${node.text.slice(start, i + title.length + 60).trim()}${i + title.length + 60 < node.text.length ? '…' : ''}`;
        return;
      }
    }
    for (const child of node.content ?? []) visit(child, inCode || node.type === 'codeBlock');
  };
  visit(doc, false);
  return found;
}

/** A copy of the document with the first mention replaced by a reference, or null when there is none. */
export function linkFirstMention(doc: RichTextDoc, title: string, target: { type: InternalLinkType; id: string; label: string }): RichTextDoc | null {
  const copy = structuredClone(doc);
  let done = false;
  const visit = (node: RichTextNode, inCode: boolean) => {
    if (done || !node.content) return;
    for (let i = 0; i < node.content.length && !done; i++) {
      const child = node.content[i]!;
      if (typeof child.text === 'string' && !inCode && !skippable(child)) {
        const at = findTitle(child.text, title);
        if (at < 0) continue;
        const parts: RichTextNode[] = [];
        const before = child.text.slice(0, at);
        const after = child.text.slice(at + title.length);
        if (before) parts.push({ ...child, text: before });
        parts.push({ type: 'reference', attrs: { href: internalHref(target.type, target.id), label: target.label } });
        if (after) parts.push({ ...child, text: after });
        node.content.splice(i, 1, ...parts);
        done = true;
        return;
      }
      visit(child, inCode || child.type === 'codeBlock');
    }
  };
  visit(copy, false);
  return done ? copy : null;
}

export interface UnlinkedMention {
  note: Note;
  excerpt: string;
}

export async function findUnlinkedMentions(
  qc: QueryClient,
  title: string,
  target: { type: string; id: string },
  linked: Set<string>,
): Promise<UnlinkedMention[]> {
  if (normalizeSearch(title).length < 3) return [];
  const results = await endpoints.search(title, 'note', 30);
  const candidates = results.filter((r) => r.type === 'note' && !(target.type === 'note' && r.id === target.id) && !linked.has(r.id)).slice(0, 15);
  const notes = await Promise.all(
    candidates.map((c) => qc.fetchQuery({ queryKey: qk.note(c.id), queryFn: () => endpoints.notes.get(c.id), staleTime: 30_000 }).catch(() => null)),
  );
  const out: UnlinkedMention[] = [];
  for (const note of notes) {
    if (!note) continue;
    const excerpt = mentionExcerpt(note.content, title);
    if (excerpt) out.push({ note, excerpt });
  }
  return out;
}

/** Links the first mention in a note, saving it on the server. */
export async function linkMention(qc: QueryClient, noteId: string, title: string, target: { type: InternalLinkType; id: string; label: string }): Promise<void> {
  if (await notesSync.getDraft(noteId)) throw new Error('Esta nota tem alterações ainda não enviadas. Abra-a e vincule pelo editor.');
  const note = await endpoints.notes.get(noteId);
  const content = linkFirstMention(note.content, title, target);
  if (!content) throw new Error('A menção não foi encontrada (a nota pode ter mudado).');
  await endpoints.notes.update(noteId, { baseVersion: note.version, content });
  void qc.invalidateQueries({ queryKey: qk.note(noteId) });
  void qc.invalidateQueries({ queryKey: ['backlinks'] });
  void qc.invalidateQueries({ queryKey: qk.notesAll });
  void qc.invalidateQueries({ queryKey: ['graph'] });
}
