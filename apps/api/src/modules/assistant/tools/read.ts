import { z } from 'zod';
import {
  ANNOTATION_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  NOTE_ROLE_LABELS,
  READING_STATUS_LABELS,
  normalizeTag,
  searchTerms,
  zId,
  type AnnotationType,
  type MaterialType,
  type NoteRole,
  type ReadingStatus,
  type SearchEntityType,
} from '@mynotes/shared';
import { num, numOrNull, str, strOrNull, stmt, type Bindable, type Row } from '../../../lib/db';
import { entityKey, resolveEntities, type EntityRef } from '../../../lib/entities';
import { defineTool, linkOf, q, S, truncate } from './types';

const SEARCHABLE = ['note', 'topic', 'reading', 'document', 'concept', 'mindmap'] as const;
type Searchable = (typeof SEARCHABLE)[number];

/** Words that never narrow a search ("notas sobre a teoria do valor" → teoria, valor). */
const STOPWORDS = new Set(
  'a o as os de da do das dos e em no na nos nas num numa um uma uns umas para pra por pelo pela com sem que se sobre ao aos ou meu minha meus minhas onde qual quais como isso essa esse esta este'.split(' '),
);

/** Search terms for the assistant: accent-free, without stopwords, at most 6. */
export function assistantTerms(query: string): string[] {
  const all = searchTerms(query, 16);
  const kept = all.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return (kept.length > 0 ? kept : all).slice(0, 6);
}

interface Source {
  table: string;
  title: string;
  topic: string;
  trashable: boolean;
  snippet: (pos: string) => string;
  extra: string;
}

const NULL_EXTRA = 'NULL AS role, NULL AS reading_id, NULL AS page, NULL AS reading_title';

const SOURCES: Record<Searchable, Source> = {
  note: {
    table: 'notes',
    title: 'title',
    topic: 'topic_id',
    trashable: true,
    // search_text is aligned character by character with title || ' ' || body_text.
    snippet: (pos) =>
      `CASE WHEN ${pos} > length(title) + 1 THEN substr(body_text, max(1, ${pos} - length(title) - 81), 260) ELSE substr(body_text, 1, 260) END`,
    extra: 'role, reading_id, page, (SELECT r.title FROM readings r WHERE r.id = notes.reading_id) AS reading_title',
  },
  topic: { table: 'topics', title: 'title', topic: 'parent_id', trashable: true, snippet: () => 'substr(description, 1, 260)', extra: NULL_EXTRA },
  reading: {
    table: 'readings',
    title: 'title',
    topic: 'topic_id',
    trashable: false,
    snippet: () => "author || CASE WHEN notes <> '' THEN ' — ' || substr(notes, 1, 200) ELSE '' END",
    extra: NULL_EXTRA,
  },
  document: {
    table: 'documents',
    title: 'title',
    topic: 'topic_id',
    trashable: true,
    snippet: () => "original_name || CASE WHEN description <> '' THEN ' — ' || substr(description, 1, 200) ELSE '' END",
    extra: NULL_EXTRA,
  },
  concept: { table: 'concepts', title: 'name', topic: 'topic_id', trashable: false, snippet: () => 'substr(description, 1, 260)', extra: NULL_EXTRA },
  mindmap: { table: 'mind_maps', title: 'title', topic: 'topic_id', trashable: false, snippet: () => "''", extra: NULL_EXTRA },
};

/**
 * One statement for several types: each row scores how many terms it
 * contains (any term matches, more matches rank higher, title matches next),
 * so a natural question still finds notes that mention only some of its
 * words. Numbered parameters (?1 user, ?2… terms) keep it under D1's 100
 * bindings.
 */
function searchStatement(db: D1Database, userId: string, terms: string[], types: readonly Searchable[], limit: number) {
  const t = terms.map((_, k) => `?${k + 2}`);
  const branches = types.map((type) => {
    const s = SOURCES[type];
    const hits = t.map((p) => `(instr(search_text, ${p}) > 0)`).join(' + ');
    const titleHits = t.map((p) => `(instr(substr(search_text, 1, length(${s.title})), ${p}) > 0)`).join(' + ');
    const pos = `COALESCE(${t.map((p) => `NULLIF(instr(search_text, ${p}), 0)`).join(', ')}, 0)`;
    return `SELECT '${type}' AS type, id, ${s.title} AS title, ${s.snippet(pos)} AS snippet, ${s.topic} AS topic_id, updated_at,
              ${s.extra}, (${hits}) AS hits, (${titleHits}) AS title_hits
         FROM ${s.table}
        WHERE user_id = ?1${s.trashable ? ' AND deleted_at IS NULL' : ''} AND (${hits}) > 0`;
  });
  const sql = `SELECT * FROM (${branches.join(' UNION ALL ')}) ORDER BY hits DESC, title_hits DESC, updated_at DESC LIMIT ?${terms.length + 2}`;
  return stmt(db, sql, userId, ...terms, limit);
}

function untitled(role: NoteRole | null, readingTitle: string | null, page: number | null): string {
  if (role === 'review') return readingTitle ? `Resenha: ${readingTitle}` : 'Resenha';
  if (role === 'annotation') return [readingTitle, page ? `p. ${page}` : null].filter(Boolean).join(', ') || 'Anotação';
  return 'Sem título';
}

const day = (iso: unknown) => str(iso).slice(0, 10);
const clean = (text: unknown) => str(text).replace(/\s+/g, ' ').trim();

async function topicTitles(db: D1Database, userId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const refs: EntityRef[] = [...new Set(ids.filter((id): id is string => !!id))].map((id) => ({ type: 'topic', id }));
  const info = await resolveEntities(db, userId, refs);
  return new Map(refs.map((r) => [r.id, info.get(entityKey('topic', r.id))?.title ?? '']));
}

/* -------------------------------------------------------- search_knowledge -- */

const zSearch = z.strictObject({
  query: z.string().trim().min(1).max(200),
  types: z.array(z.enum(SEARCHABLE)).max(6).nullable(),
  limit: z.number().int().min(1).max(20).nullable(),
});

export const searchKnowledge = defineTool({
  name: 'search_knowledge',
  kind: 'read',
  description:
    'Full-text search over the user\'s MyNotes (notes, book reviews and page annotations, topics, books/readings, documents, concepts, mind maps). ' +
    'Accent and case insensitive; results rank by how many keywords match. Pass 1–4 keywords, not a sentence; try synonyms or a related term if nothing is found. ' +
    'A query starting with # lists the notes with that tag. Returns ids, titles and snippets; read a note in full with get_note.',
  parameters: S.obj({
    query: S.str('Keywords, e.g. "teoria valor Ricardo", or "#tag".'),
    types: S.narr(S.enum(SEARCHABLE), 'Restrict to these types (null = all).'),
    limit: S.nint('Max results, 1–20 (default 10).'),
  }),
  args: zSearch,
  label: (a) => `Pesquisou ${q(a.query)}`,
  async run(ctx, a) {
    const limit = a.limit ?? 10;
    let rows: Row[];
    let terms: string[];
    if (a.query.startsWith('#')) {
      const tag = normalizeTag(a.query);
      terms = [`#${tag}`];
      rows = (
        await stmt(
          ctx.db,
          `SELECT 'note' AS type, id, title, excerpt AS snippet, topic_id, updated_at, role, reading_id, page,
                  (SELECT r.title FROM readings r WHERE r.id = notes.reading_id) AS reading_title, 1 AS hits
             FROM notes WHERE user_id = ? AND deleted_at IS NULL
              AND id IN (SELECT note_id FROM note_tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\')
            ORDER BY updated_at DESC LIMIT ?`,
          ctx.userId,
          tag,
          `${tag.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`,
          limit,
        ).all<Row>()
      ).results;
    } else {
      terms = assistantTerms(a.query);
      if (terms.length === 0) return { error: 'invalid_arguments', message: 'Informe ao menos uma palavra-chave.' };
      const types = a.types?.length ? [...new Set(a.types)] : [...SEARCHABLE];
      // D1 caps compound SELECTs: at most 3 branches per statement, all in one batch.
      const groups = [types.slice(0, 3), types.slice(3)].filter((g) => g.length > 0);
      const res = await ctx.db.batch<Row>(groups.map((g) => searchStatement(ctx.db, ctx.userId, terms, g, limit)));
      rows = res
        .flatMap((r) => r.results ?? [])
        .sort(
          (x, y) =>
            num(y.hits) - num(x.hits) || num(y.title_hits) - num(x.title_hits) || str(y.updated_at).localeCompare(str(x.updated_at)),
        )
        .slice(0, limit);
    }
    const topics = await topicTitles(ctx.db, ctx.userId, rows.map((r) => strOrNull(r.topic_id)));
    const results = rows.map((r) => {
      const type = str(r.type) as SearchEntityType;
      const role = type === 'note' ? ((strOrNull(r.role) ?? 'note') as NoteRole) : null;
      const page = numOrNull(r.page);
      const readingTitle = strOrNull(r.reading_title);
      const title = str(r.title) || untitled(role, readingTitle, page);
      ctx.sources.add({ type, id: str(r.id), title, role, readingId: strOrNull(r.reading_id), page });
      const topicId = strOrNull(r.topic_id);
      return {
        type: role && role !== 'note' ? `${type}:${role}` : type,
        id: str(r.id),
        link: linkOf(type, str(r.id)),
        title,
        snippet: truncate(clean(r.snippet), 260).text,
        topic: topicId ? { id: topicId, title: topics.get(topicId) ?? '' } : null,
        ...(readingTitle ? { book: { id: strOrNull(r.reading_id), title: readingTitle }, page } : {}),
        matched_terms: num(r.hits),
        updated: day(r.updated_at),
      };
    });
    return { terms, total: results.length, results };
  },
});

/* ---------------------------------------------------------------- get_note -- */

const zGetNote = z.strictObject({ note_id: zId });

export const getNote = defineTool({
  name: 'get_note',
  kind: 'read',
  description:
    'Reads one note in full: text (plain), topic, book and page (for annotations), #tags, references it makes, and `version` (needed by update_note).',
  parameters: S.obj({ note_id: S.str('Note id (uuid).') }),
  args: zGetNote,
  label: () => 'Leu uma nota',
  async run(ctx, a) {
    const [rowRes, tagsRes, linksRes] = await ctx.db.batch<Row>([
      stmt(ctx.db, 'SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', a.note_id, ctx.userId),
      stmt(
        ctx.db,
        'SELECT t.tag FROM note_tags t JOIN notes n ON n.id = t.note_id WHERE t.note_id = ? AND n.user_id = ? ORDER BY t.tag LIMIT 50',
        a.note_id,
        ctx.userId,
      ),
      stmt(
        ctx.db,
        'SELECT l.target_type, l.target_id FROM note_links l JOIN notes n ON n.id = l.note_id WHERE l.note_id = ? AND n.user_id = ? LIMIT 60',
        a.note_id,
        ctx.userId,
      ),
    ]);
    const row = rowRes?.results?.[0];
    if (!row) return { error: 'not_found', message: 'Nota não encontrada (verifique o id com search_knowledge).' };
    const links = (linksRes?.results ?? []).map((l) => ({ type: str(l.target_type) as EntityRef['type'], id: str(l.target_id) }));
    const topicId = strOrNull(row.topic_id);
    const readingId = strOrNull(row.reading_id);
    const info = await resolveEntities(ctx.db, ctx.userId, [
      ...links,
      ...(topicId ? [{ type: 'topic' as const, id: topicId }] : []),
      ...(readingId ? [{ type: 'reading' as const, id: readingId }] : []),
    ]);
    const role = (strOrNull(row.role) ?? 'note') as NoteRole;
    const page = numOrNull(row.page);
    const bookTitle = readingId ? (info.get(entityKey('reading', readingId))?.title ?? null) : null;
    const title = str(row.title) || untitled(role, bookTitle, page);
    ctx.sources.add({ type: 'note', id: a.note_id, title, role, readingId, page }, 'read');
    const body = truncate(str(row.body_text), 8000);
    const references = links.flatMap((l) => {
      const found = info.get(entityKey(l.type, l.id));
      if (!found) return [];
      ctx.sources.add({ type: l.type as SearchEntityType, id: l.id, title: found.title });
      return [{ type: l.type, id: l.id, title: found.title || 'Sem título', link: linkOf(l.type, l.id) }];
    });
    const topicTitle = topicId ? info.get(entityKey('topic', topicId))?.title : undefined;
    if (topicId && topicTitle !== undefined) ctx.sources.add({ type: 'topic', id: topicId, title: topicTitle });
    if (readingId && bookTitle !== null) ctx.sources.add({ type: 'reading', id: readingId, title: bookTitle });
    const annotationType = strOrNull(row.annotation_type) as AnnotationType | null;
    return {
      id: a.note_id,
      link: linkOf('note', a.note_id),
      title,
      kind: NOTE_ROLE_LABELS[role],
      topic: topicId && topicTitle !== undefined ? { id: topicId, title: topicTitle, link: linkOf('topic', topicId) } : null,
      book: readingId && bookTitle !== null ? { id: readingId, title: bookTitle, link: linkOf('reading', readingId), page } : null,
      ...(role === 'annotation'
        ? {
            annotation_type: annotationType ? ANNOTATION_TYPE_LABELS[annotationType] : null,
            quoted_passage: truncate(str(row.quote), 800).text,
          }
        : {}),
      tags: (tagsRes?.results ?? []).map((t) => `#${str(t.tag)}`),
      references,
      version: num(row.version),
      updated: str(row.updated_at),
      word_count: num(row.word_count),
      text: body.text,
      text_truncated: body.truncated,
    };
  },
});

/* --------------------------------------------------------------- get_topic -- */

const zGetTopic = z.strictObject({ topic_id: zId });

export const getTopic = defineTool({
  name: 'get_topic',
  kind: 'read',
  description:
    'Reads one topic (assunto/subassunto): description, path from the root, subtopics with counts, its notes (titles and excerpts), books, documents, tags and `version` (needed by update_topic and move_topic).',
  parameters: S.obj({ topic_id: S.str('Topic id (uuid).') }),
  args: zGetTopic,
  label: () => 'Abriu um assunto',
  async run(ctx, a) {
    const u = ctx.userId;
    const id = a.topic_id;
    const res = await ctx.db.batch<Row>([
      stmt(ctx.db, 'SELECT * FROM topics WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, u),
      stmt(
        ctx.db,
        `WITH RECURSIVE anc(id, parent_id, title, depth) AS (
           SELECT id, parent_id, title, 0 FROM topics WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT t.id, t.parent_id, t.title, anc.depth + 1 FROM topics t JOIN anc ON t.id = anc.parent_id WHERE anc.depth < 50
         ) SELECT id, title FROM anc WHERE depth > 0 ORDER BY depth DESC`,
        id,
        u,
      ),
      stmt(
        ctx.db,
        `SELECT t.id, t.title, t.description,
                (SELECT COUNT(*) FROM notes n WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS notes,
                (SELECT COUNT(*) FROM topics c WHERE c.parent_id = t.id AND c.deleted_at IS NULL) AS subtopics
           FROM topics t WHERE t.user_id = ? AND t.parent_id = ? AND t.deleted_at IS NULL ORDER BY t.sort_key LIMIT 60`,
        u,
        id,
      ),
      stmt(
        ctx.db,
        `SELECT id, title, excerpt, role, reading_id, page, updated_at FROM notes
          WHERE user_id = ? AND topic_id = ? AND deleted_at IS NULL ORDER BY sort_key LIMIT 40`,
        u,
        id,
      ),
      stmt(ctx.db, 'SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND topic_id = ? AND deleted_at IS NULL', u, id),
      stmt(ctx.db, 'SELECT id, title, author, status FROM readings WHERE user_id = ? AND topic_id = ? ORDER BY updated_at DESC LIMIT 20', u, id),
      stmt(
        ctx.db,
        'SELECT id, title, mime_type FROM documents WHERE user_id = ? AND topic_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20',
        u,
        id,
      ),
      stmt(
        ctx.db,
        `SELECT t.tag, COUNT(*) AS n FROM note_tags t JOIN notes n ON n.id = t.note_id
          WHERE n.user_id = ? AND n.topic_id = ? AND n.deleted_at IS NULL GROUP BY t.tag ORDER BY n DESC LIMIT 20`,
        u,
        id,
      ),
    ]);
    const row = res[0]?.results?.[0];
    if (!row) return { error: 'not_found', message: 'Assunto não encontrado (verifique o id com search_knowledge ou get_topic_tree).' };
    const rows = (i: number) => res[i]?.results ?? [];
    const ancestors = rows(1);
    ctx.sources.add({ type: 'topic', id, title: str(row.title) }, 'read');
    const subtopics = rows(2).map((t) => {
      ctx.sources.add({ type: 'topic', id: str(t.id), title: str(t.title) });
      return {
        id: str(t.id),
        link: linkOf('topic', str(t.id)),
        title: str(t.title),
        description: truncate(clean(t.description), 160).text,
        notes: num(t.notes),
        subtopics: num(t.subtopics),
      };
    });
    const notes = rows(3).map((n) => {
      const role = (strOrNull(n.role) ?? 'note') as NoteRole;
      const title = str(n.title) || untitled(role, null, numOrNull(n.page));
      ctx.sources.add({ type: 'note', id: str(n.id), title, role, readingId: strOrNull(n.reading_id), page: numOrNull(n.page) });
      return { id: str(n.id), link: linkOf('note', str(n.id)), title, excerpt: truncate(clean(n.excerpt), 200).text, updated: day(n.updated_at) };
    });
    const books = rows(5).map((b) => {
      ctx.sources.add({ type: 'reading', id: str(b.id), title: str(b.title) });
      return {
        id: str(b.id),
        link: linkOf('reading', str(b.id)),
        title: str(b.title),
        author: str(b.author),
        status: READING_STATUS_LABELS[str(b.status) as ReadingStatus] ?? str(b.status),
      };
    });
    const documents = rows(6).map((d) => {
      ctx.sources.add({ type: 'document', id: str(d.id), title: str(d.title) });
      return { id: str(d.id), link: linkOf('document', str(d.id)), title: str(d.title), mime_type: str(d.mime_type) };
    });
    const parent = ancestors[ancestors.length - 1];
    return {
      id,
      link: linkOf('topic', id),
      title: str(row.title),
      description: truncate(str(row.description), 2000).text,
      version: num(row.version),
      path: [...ancestors.map((t) => str(t.title)), str(row.title)].join(' › '),
      parent: parent ? { id: str(parent.id), title: str(parent.title) } : null,
      subtopics,
      notes,
      notes_total: num(rows(4)[0]?.n),
      books,
      documents,
      tags: rows(7).map((t) => ({ tag: `#${str(t.tag)}`, notes: num(t.n) })),
    };
  },
});

/* ---------------------------------------------------------- get_topic_tree -- */

const zTree = z.strictObject({
  root_topic_id: zId.nullable(),
  max_depth: z.number().int().min(1).max(6).nullable(),
});

const TREE_MAX_LINES = 150;

export const getTopicTree = defineTool({
  name: 'get_topic_tree',
  kind: 'read',
  description:
    'Lists the topic hierarchy (assuntos and subassuntos) as an indented outline with ids and note counts — all topics, or the subtree of one topic. Use it before creating topics, to reuse existing ones and avoid duplicates.',
  parameters: S.obj({
    root_topic_id: S.nstr('Only this topic and its subtopics (null = whole tree).'),
    max_depth: S.nint('Levels below the root to show, 1–6 (default 3).'),
  }),
  args: zTree,
  label: (a) => (a.root_topic_id ? 'Consultou a árvore de um assunto' : 'Consultou a árvore de assuntos'),
  async run(ctx, a) {
    const rows = (
      await stmt(
        ctx.db,
        `SELECT t.id, t.parent_id, t.title,
                (SELECT COUNT(*) FROM notes n WHERE n.user_id = ?1 AND n.topic_id = t.id AND n.deleted_at IS NULL) AS notes
           FROM topics t WHERE t.user_id = ?1 AND t.deleted_at IS NULL ORDER BY t.parent_id, t.sort_key, t.id`,
        ctx.userId,
      ).all<Row>()
    ).results;
    const children = new Map<string | null, Row[]>();
    const byId = new Map<string, Row>();
    for (const r of rows) {
      byId.set(str(r.id), r);
      const p = strOrNull(r.parent_id);
      children.set(p, [...(children.get(p) ?? []), r]);
    }
    if (a.root_topic_id && !byId.has(a.root_topic_id)) return { error: 'not_found', message: 'Assunto não encontrado.' };
    const maxDepth = a.max_depth ?? 3;
    const lines: string[] = [];
    let truncated = false;
    const visit = (r: Row, depth: number) => {
      if (lines.length >= TREE_MAX_LINES) {
        truncated = true;
        return;
      }
      const id = str(r.id);
      const kids = children.get(id) ?? [];
      ctx.sources.add({ type: 'topic', id, title: str(r.title) });
      const extra = [num(r.notes) ? `${num(r.notes)} nota(s)` : null, kids.length ? `${kids.length} subassunto(s)` : null]
        .filter(Boolean)
        .join(', ');
      lines.push(`${'  '.repeat(depth)}- ${str(r.title)} [id ${id}]${extra ? ` (${extra})` : ''}`);
      if (depth < maxDepth) for (const k of kids) visit(k, depth + 1);
      else if (kids.length) truncated = true;
    };
    const roots = a.root_topic_id ? [byId.get(a.root_topic_id)!] : (children.get(null) ?? []);
    for (const r of roots) visit(r, 0);
    return { topics_total: rows.length, outline: lines.join('\n') || '(nenhum assunto)', truncated };
  },
});

/* --------------------------------------------------------------- list_tags -- */

const zTags = z.strictObject({ query: z.string().trim().max(60).nullable() });

export const listTags = defineTool({
  name: 'list_tags',
  kind: 'read',
  description: 'Lists the #tags already used in notes (most used first), optionally containing a text. Tags are written inline in note text as #name.',
  parameters: S.obj({ query: S.nstr('Only tags containing this text (null = all).') }),
  args: zTags,
  label: () => 'Consultou as tags',
  async run(ctx, a) {
    const term = a.query ? normalizeTag(a.query) : '';
    const binds: Bindable[] = [ctx.userId];
    if (term) binds.push(term);
    const rows = (
      await stmt(
        ctx.db,
        `SELECT t.tag, COUNT(*) AS n FROM note_tags t JOIN notes n ON n.id = t.note_id
          WHERE n.user_id = ? AND n.deleted_at IS NULL${term ? ' AND instr(t.tag, ?) > 0' : ''}
          GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 80`,
        ...binds,
      ).all<Row>()
    ).results;
    return { tags: rows.map((r) => ({ tag: `#${str(r.tag)}`, notes: num(r.n) })) };
  },
});

/* ---------------------------------------------------------- search_library -- */

const zLibrary = z.strictObject({
  query: z.string().trim().max(200).nullable(),
  topic_id: zId.nullable(),
  kind: z.enum(['all', 'books', 'documents']).nullable(),
});

export const searchLibrary = defineTool({
  name: 'search_library',
  kind: 'read',
  description:
    'Finds books/readings (title, author, type, status, pages, number of page annotations) and uploaded documents such as PDFs (title, file name, type) by metadata, optionally within a topic. ' +
    'The text inside PDFs is NOT indexed: to know what the user wrote about a book, use get_reading (annotations with page numbers and quoted passages).',
  parameters: S.obj({
    query: S.nstr('Keywords for title, author or file name (null = most recent).'),
    topic_id: S.nstr('Only items filed under this topic (null = any).'),
    kind: S.nenum(['all', 'books', 'documents'], 'Default all.'),
  }),
  args: zLibrary,
  label: (a) => (a.query ? `Procurou na biblioteca ${q(a.query)}` : 'Consultou a biblioteca'),
  async run(ctx, a) {
    const terms = a.query ? assistantTerms(a.query) : [];
    const kind = a.kind ?? 'all';
    const filter = (alias: string) => {
      const parts: string[] = [];
      const binds: Bindable[] = [];
      if (terms.length) {
        parts.push(`(${terms.map(() => `instr(${alias}.search_text, ?) > 0`).join(' OR ')})`);
        binds.push(...terms);
      }
      if (a.topic_id) {
        parts.push(`${alias}.topic_id = ?`);
        binds.push(a.topic_id);
      }
      return { sql: parts.map((p) => ` AND ${p}`).join(''), binds };
    };
    const rf = filter('r');
    const df = filter('d');
    const statements: D1PreparedStatement[] = [];
    if (kind !== 'documents') {
      statements.push(
        stmt(
          ctx.db,
          `SELECT r.id, r.title, r.author, r.material_type, r.status, r.total_pages, r.current_page, r.topic_id, r.document_id,
                  (SELECT COUNT(*) FROM notes n WHERE n.reading_id = r.id AND n.deleted_at IS NULL AND n.role = 'annotation') AS annotations,
                  (SELECT COUNT(*) FROM notes n WHERE n.reading_id = r.id AND n.deleted_at IS NULL AND n.role = 'review') AS reviews
             FROM readings r WHERE r.user_id = ?${rf.sql} ORDER BY r.updated_at DESC LIMIT 25`,
          ctx.userId,
          ...rf.binds,
        ),
      );
    }
    if (kind !== 'books') {
      statements.push(
        stmt(
          ctx.db,
          `SELECT d.id, d.title, d.original_name, d.mime_type, d.size_bytes, d.status, d.topic_id,
                  (SELECT r.id FROM readings r WHERE r.document_id = d.id AND r.user_id = d.user_id LIMIT 1) AS reading_id
             FROM documents d WHERE d.user_id = ? AND d.deleted_at IS NULL${df.sql} ORDER BY d.created_at DESC LIMIT 25`,
          ctx.userId,
          ...df.binds,
        ),
      );
    }
    const res = await ctx.db.batch<Row>(statements);
    const bookRows = kind !== 'documents' ? (res[0]?.results ?? []) : [];
    const docRows = kind === 'books' ? [] : (res[kind === 'documents' ? 0 : 1]?.results ?? []);
    const topics = await topicTitles(ctx.db, ctx.userId, [...bookRows, ...docRows].map((r) => strOrNull(r.topic_id)));
    const books = bookRows.map((r) => {
      ctx.sources.add({ type: 'reading', id: str(r.id), title: str(r.title) });
      const topicId = strOrNull(r.topic_id);
      return {
        id: str(r.id),
        link: linkOf('reading', str(r.id)),
        title: str(r.title),
        author: str(r.author),
        type: MATERIAL_TYPE_LABELS[str(r.material_type) as MaterialType] ?? str(r.material_type),
        status: READING_STATUS_LABELS[str(r.status) as ReadingStatus] ?? str(r.status),
        pages: numOrNull(r.total_pages),
        current_page: numOrNull(r.current_page),
        topic: topicId ? { id: topicId, title: topics.get(topicId) ?? '' } : null,
        has_file: !!r.document_id,
        page_annotations: num(r.annotations),
        has_review: num(r.reviews) > 0,
      };
    });
    const documents = docRows.map((r) => {
      ctx.sources.add({ type: 'document', id: str(r.id), title: str(r.title) });
      const topicId = strOrNull(r.topic_id);
      return {
        id: str(r.id),
        link: linkOf('document', str(r.id)),
        title: str(r.title),
        file: str(r.original_name),
        mime_type: str(r.mime_type),
        size_kb: Math.round(num(r.size_bytes) / 1024),
        status: str(r.status),
        topic: topicId ? { id: topicId, title: topics.get(topicId) ?? '' } : null,
        book_id: strOrNull(r.reading_id),
      };
    });
    return { books, documents, pdf_text_indexed: false };
  },
});

/* ------------------------------------------------------------- get_reading -- */

const zReading = z.strictObject({ reading_id: zId, page: z.number().int().min(1).max(100_000).nullable() });

export const getReading = defineTool({
  name: 'get_reading',
  kind: 'read',
  description:
    'Reads a book/reading: metadata, attached file, the review ("Minha resenha") and the page annotations (page number, type, quoted passage, excerpt), optionally only one page. ' +
    'Page numbers here were recorded by the user and are reliable; never invent other page numbers.',
  parameters: S.obj({
    reading_id: S.str('Book/reading id (uuid).'),
    page: S.nint('Only annotations of this page (null = all).'),
  }),
  args: zReading,
  label: () => 'Abriu um livro',
  async run(ctx, a) {
    const u = ctx.userId;
    const pageFilter = a.page ? ` AND (page = ? OR role = 'review')` : '';
    const res = await ctx.db.batch<Row>([
      stmt(ctx.db, 'SELECT * FROM readings WHERE id = ? AND user_id = ?', a.reading_id, u),
      stmt(
        ctx.db,
        `SELECT id, title, role, page, annotation_type, quote, excerpt, updated_at FROM notes
          WHERE user_id = ? AND reading_id = ? AND deleted_at IS NULL${pageFilter}
          ORDER BY role = 'review' DESC, page, created_at LIMIT 80`,
        u,
        a.reading_id,
        ...(a.page ? [a.page] : []),
      ),
      stmt(
        ctx.db,
        `SELECT d.id, d.title, d.mime_type, d.status FROM documents d JOIN readings r ON r.document_id = d.id
          WHERE r.id = ? AND d.user_id = ? AND d.deleted_at IS NULL`,
        a.reading_id,
        u,
      ),
    ]);
    const book = res[0]?.results?.[0];
    if (!book) return { error: 'not_found', message: 'Livro/leitura não encontrado.' };
    const title = str(book.title);
    ctx.sources.add({ type: 'reading', id: a.reading_id, title }, 'read');
    const notes = res[1]?.results ?? [];
    const review = notes.find((n) => n.role === 'review');
    const annotations = notes
      .filter((n) => n.role === 'annotation')
      .map((n) => {
        const page = numOrNull(n.page);
        const name = str(n.title) || untitled('annotation', title, page);
        ctx.sources.add({ type: 'note', id: str(n.id), title: name, role: 'annotation', readingId: a.reading_id, page }, 'read');
        const type = strOrNull(n.annotation_type) as AnnotationType | null;
        return {
          id: str(n.id),
          link: linkOf('note', str(n.id)),
          page,
          type: type ? ANNOTATION_TYPE_LABELS[type] : null,
          title: str(n.title) || null,
          quoted_passage: truncate(clean(n.quote), 400).text || null,
          excerpt: truncate(clean(n.excerpt), 300).text,
        };
      });
    if (review) {
      ctx.sources.add({ type: 'note', id: str(review.id), title: `Resenha: ${title}`, role: 'review', readingId: a.reading_id }, 'read');
    }
    const file = res[2]?.results?.[0];
    if (file) ctx.sources.add({ type: 'document', id: str(file.id), title: str(file.title) });
    return {
      id: a.reading_id,
      link: linkOf('reading', a.reading_id),
      title,
      author: str(book.author),
      type: MATERIAL_TYPE_LABELS[str(book.material_type) as MaterialType] ?? str(book.material_type),
      status: READING_STATUS_LABELS[str(book.status) as ReadingStatus] ?? str(book.status),
      pages: numOrNull(book.total_pages),
      current_page: numOrNull(book.current_page),
      topic_id: strOrNull(book.topic_id),
      file: file ? { id: str(file.id), title: str(file.title), mime_type: str(file.mime_type), text_indexed: false } : null,
      review: review
        ? { id: str(review.id), link: linkOf('note', str(review.id)), excerpt: truncate(clean(review.excerpt), 400).text }
        : null,
      annotations,
      annotations_shown: annotations.length,
    };
  },
});

export const readTools = [searchKnowledge, getNote, getTopic, getTopicTree, listTags, searchLibrary, getReading];
