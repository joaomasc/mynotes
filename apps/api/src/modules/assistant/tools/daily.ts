import { z } from 'zod';
import { EMPTY_DOC, docToMarkdown, zDate, type RichTextDoc } from '@mynotes/shared';
import { num, parseJson, str } from '../../../lib/db';
import { entityKey, resolveEntities } from '../../../lib/entities';
import { dailyNotesOf, dailyTitle, noteSettings, planWriteDailyNote } from '../daily-actions';
import { apply, modeParam, zMode } from './write';
import { defineTool, linkOf, S, truncate } from './types';

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]!;
const MAX_DAYS = 62;

/* ---------------------------------------------------------- get_daily_notes -- */

const zGetDaily = z.strictObject({ from: zDate.nullable(), to: zDate.nullable() });

export const getDailyNotesTool = defineTool({
  name: 'get_daily_notes',
  kind: 'read',
  description:
    'Reads the user\'s daily notes (one note per day, like Obsidian) in a date range: each day\'s note as Markdown (start of it), id and `version`, and which days have no note. ' +
    'Dates are YYYY-MM-DD; null `to` = today, null `from` = 6 days before `to` (at most 62 days). Also returns where daily notes are kept (topic, title format, template).',
  parameters: S.obj({ from: S.nstr('First day, YYYY-MM-DD (null = a week before `to`).'), to: S.nstr('Last day, YYYY-MM-DD (null = today).') }),
  args: zGetDaily,
  label: (a) => (a.from || a.to ? `Leu as notas diárias${a.from ? ` de ${a.from}` : ''}${a.to ? ` até ${a.to}` : ''}` : 'Leu as notas diárias da semana'),
  async run(ctx, a) {
    const to = a.to ?? ctx.localToday;
    const from = a.from ?? addDays(to, -6);
    const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
    if (span < 0) return { error: 'invalid_arguments', message: '`from` vem depois de `to`.' };
    if (span >= MAX_DAYS) return { error: 'invalid_arguments', message: `Peça no máximo ${MAX_DAYS} dias por vez.` };
    const days = Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
    const settings = await noteSettings(ctx.db, ctx.userId);
    const found = await dailyNotesOf(ctx.db, ctx.userId, settings, days);
    const topic = settings.dailyTopicId
      ? (await resolveEntities(ctx.db, ctx.userId, [{ type: 'topic', id: settings.dailyTopicId }])).get(entityKey('topic', settings.dailyTopicId))
      : undefined;
    const perNote = found.size > 14 ? 500 : 1500;
    return {
      today: ctx.localToday,
      kept_in: {
        topic: settings.dailyTopicId && topic ? { id: settings.dailyTopicId, title: topic.title, link: linkOf('topic', settings.dailyTopicId) } : null,
        title_format: settings.dailyFormat,
        title_today: dailyTitle(settings, ctx.localToday),
        uses_template: !!settings.dailyTemplateId,
      },
      notes: days.flatMap((day) => {
        const row = found.get(day);
        if (!row) return [];
        const id = str(row.id);
        ctx.sources.add({ type: 'note', id, title: str(row.title) }, found.size === 1 ? 'read' : 'seen');
        const body = truncate(docToMarkdown(parseJson<RichTextDoc>(row.content, structuredClone(EMPTY_DOC))), perNote);
        return [{ day, weekday: weekday(day), id, link: linkOf('note', id), title: str(row.title), version: num(row.version), word_count: num(row.word_count), content_markdown: body.text, truncated: body.truncated }];
      }),
      days_without_note: days.filter((d) => !found.has(d)),
    };
  },
});

/* --------------------------------------------------------- write_daily_note -- */

const zWriteDaily = z.strictObject({
  date: zDate.nullable(),
  append_markdown: z.string().max(20_000).nullable(),
  mode: zMode,
});

export const writeDailyNoteTool = defineTool({
  name: 'write_daily_note',
  kind: 'write',
  description:
    'Opens the daily note of a day — creating it, if missing, exactly as the app does (title format, daily topic and daily template from Settings) — and optionally adds Markdown to its end (keeps everything already there). ' +
    'Use it for "anote no diário de hoje", "registre na nota diária de ontem", "crie a nota de amanhã com…". `date` YYYY-MM-DD (null = today in the user\'s time zone). ' +
    'Markdown as in create_note: headings, lists, tasks (- [ ]), code blocks with their language, [Título](mynotes:<type>/<id>) references, #tags.',
  parameters: S.obj({
    date: S.nstr('Day, YYYY-MM-DD (null = today).'),
    append_markdown: S.nstr('Markdown to add at the end (null = only open/create the note).'),
    mode: modeParam,
  }),
  args: zWriteDaily,
  label: (a) => `Nota diária ${a.date ?? 'de hoje'}`,
  async run(ctx, a) {
    const plan = await planWriteDailyNote(ctx.db, ctx.userId, { day: a.date ?? ctx.localToday, append: a.append_markdown });
    return apply(ctx, plan, a.mode);
  },
});

export const dailyTools = [getDailyNotesTool, writeDailyNoteTool];
