import { EMPTY_DOC, dateFromDay, fillTemplate, formatDate, zNoteSettings, type NoteSettings, type RichTextDoc } from '@mynotes/shared';
import { all, first, num, parseJson, str, type Row } from '../../lib/db';
import { entityKey } from '../../lib/entities';
import { createNote, updateNote } from '../notes/service';
import { PlanError, line, noteDoc, noteRefsInfo, quoted, requireEntities, source, wordCount, type Execution, type Plan } from './actions';

/**
 * Daily notes, as the app makes them (Settings › Notas): one note per day,
 * titled with the configured format, in the daily notes topic, started from
 * the daily template. Nothing marks them in the database: the title does.
 */

export async function noteSettings(db: D1Database, userId: string): Promise<NoteSettings> {
  const row = await first<Row>(db, "SELECT value FROM settings WHERE user_id = ? AND key = 'notes'", userId);
  const parsed = zNoteSettings.safeParse(parseJson(row?.value, {}));
  return parsed.success ? parsed.data : zNoteSettings.parse({});
}

export const dailyTitle = (settings: NoteSettings, day: string) => formatDate(settings.dailyFormat, dateFromDay(day));

/** The daily notes of these days that exist (by title, in the daily topic). */
export async function dailyNotesOf(db: D1Database, userId: string, settings: NoteSettings, days: string[]): Promise<Map<string, Row>> {
  const byTitle = new Map(days.map((d) => [dailyTitle(settings, d), d]));
  const rows = await all<Row>(
    db,
    `SELECT id, title, version, content, word_count, updated_at FROM notes
      WHERE user_id = ? AND topic_id IS ? AND role = 'note' AND deleted_at IS NULL AND title IN (${[...byTitle.keys()].map(() => '?').join(',')})
      ORDER BY updated_at`,
    userId,
    settings.dailyTopicId,
    ...byTitle.keys(),
  );
  // Two notes with the same title: the most recently edited one (as in the app's calendar).
  const out = new Map<string, Row>();
  for (const r of rows) out.set(byTitle.get(str(r.title))!, r);
  return out;
}

export interface WriteDailyNotePayload {
  /** "2026-10-21". */
  day: string;
  /** Markdown added at the end (null = only make sure the note exists). */
  append: string | null;
}

async function dailyPlace(db: D1Database, userId: string, settings: NoteSettings) {
  if (!settings.dailyTopicId) return { topicTitle: null };
  try {
    const info = await requireEntities(db, userId, [{ type: 'topic', id: settings.dailyTopicId }]);
    return { topicTitle: info.get(entityKey('topic', settings.dailyTopicId))!.title };
  } catch {
    throw new PlanError('invalid_settings', 'O assunto das notas diárias (Configurações › Notas) não existe mais. Peça ao usuário para escolher outro.');
  }
}

export async function planWriteDailyNote(db: D1Database, userId: string, p: WriteDailyNotePayload): Promise<Plan<WriteDailyNotePayload>> {
  const settings = await noteSettings(db, userId);
  const { topicTitle } = await dailyPlace(db, userId, settings);
  if (p.append !== null) await noteRefsInfo(db, userId, { markdown: p.append, references: [] });
  const title = dailyTitle(settings, p.day);
  const existing = (await dailyNotesOf(db, userId, settings, [p.day])).get(p.day);
  const where = topicTitle ? ` em ${quoted(topicTitle)}` : ' (sem assunto)';
  if (existing && p.append === null) {
    return {
      tool: 'write_daily_note',
      kind: 'write',
      title: `Nota diária ${quoted(title)}`,
      preview: [],
      payload: p,
      confirm: false,
      noop: `A nota diária de ${p.day} já existe: mynotes:note/${str(existing.id)} (versão ${num(existing.version)}).`,
    };
  }
  const preview = [line(0, `Nota diária ${quoted(title)}${where}`, existing ? 'existing' : 'new', existing ? null : settings.dailyTemplateId ? 'criada a partir do modelo diário' : null)];
  if (p.append !== null) preview.push(line(1, `Acrescentar ao fim: ${wordCount(p.append)} palavras`, 'change', p.append.slice(0, 300)));
  return {
    tool: 'write_daily_note',
    kind: 'write',
    title: existing ? `Escrever na nota diária ${quoted(title)}` : `Criar a nota diária ${quoted(title)}`,
    preview,
    payload: p,
    confirm: false,
  };
}

export async function executeWriteDailyNote(db: D1Database, userId: string, p: WriteDailyNotePayload): Promise<Execution> {
  const settings = await noteSettings(db, userId);
  const { topicTitle } = await dailyPlace(db, userId, settings);
  const title = dailyTitle(settings, p.day);
  const added = p.append !== null ? noteDoc(p.append, [], [], await noteRefsInfo(db, userId, { markdown: p.append, references: [] })).content : [];
  const existing = (await dailyNotesOf(db, userId, settings, [p.day])).get(p.day);
  let id: string;
  let version: number;
  if (existing) {
    // Only adds to the end: the note as it is now, whatever its version.
    const current = parseJson<RichTextDoc>(existing.content, structuredClone(EMPTY_DOC));
    const saved = await updateNote(
      db,
      userId,
      str(existing.id),
      { baseVersion: num(existing.version), content: { ...current, type: 'doc', content: [...(current.content ?? []), ...added] } },
      { forceRevision: true },
    );
    id = saved.id;
    version = saved.version;
  } else {
    let start: RichTextDoc = structuredClone(EMPTY_DOC);
    if (settings.dailyTemplateId) {
      const template = await first<Row>(db, 'SELECT content FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', settings.dailyTemplateId, userId);
      if (template) start = fillTemplate(parseJson<RichTextDoc>(template.content, structuredClone(EMPTY_DOC)), { title, topic: topicTitle ?? '', date: dateFromDay(p.day) });
    }
    const { note } = await createNote(db, userId, {
      topicId: settings.dailyTopicId,
      title,
      content: { ...start, type: 'doc', content: [...(start.content ?? []), ...added] },
      role: 'note',
    });
    id = note.id;
    version = note.version;
  }
  return {
    results: [source('note', id, title)],
    summary: `${existing ? 'Escreveu na' : 'Criou a'} nota diária ${quoted(title)}`,
    output: {
      note: { id, title, link: `mynotes:note/${id}`, version, day: p.day, created: !existing, filed_under_topic: topicTitle ? { id: settings.dailyTopicId, title: topicTitle } : null },
    },
  };
}
