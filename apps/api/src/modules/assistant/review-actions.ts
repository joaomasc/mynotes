import { clozeIndices, clozePlain, quoteFound, sourceProbe, uuidv7, type CardKind } from '@mynotes/shared';
import { insertCardStmt, sourceNote } from '../review/cards';
import { nowIso } from '../../lib/time';
import { line, PlanError, quoted, source, type Execution, type Plan } from './actions';

/**
 * Review cards the assistant writes from a note (Revisar). Like the questions
 * of the review page, they always wait for the user's confirmation and each
 * one must quote a passage that is really in the note.
 */

export interface ReviewCardsPayload {
  noteId: string;
  cards: { kind: Extract<CardKind, 'basic' | 'cloze' | 'open' | 'essay'>; front: string; back: string; keyPoints: string[]; quote: string }[];
}

async function noteOf(db: D1Database, userId: string, noteId: string) {
  try {
    const note = await sourceNote(db, userId, noteId);
    const row = await db.prepare('SELECT title FROM notes WHERE id = ?').bind(noteId).first<{ title: string }>();
    return { ...note, title: row?.title || 'Sem título' };
  } catch {
    throw new PlanError('not_found', 'A nota não existe (ou está na lixeira). Busque o id certo com search.');
  }
}

function check(p: ReviewCardsPayload, body: string) {
  p.cards.forEach((c, i) => {
    const n = `Cartão ${i + 1}`;
    if (!quoteFound(body, c.quote)) throw new PlanError('quote_not_found', `${n}: o trecho em "quote" não está na nota. Copie-o literalmente do texto da nota (get_note).`);
    if (c.kind === 'cloze' && clozeIndices(c.front).length === 0) throw new PlanError('invalid_arguments', `${n}: lacunas precisam de {{c1::termo}} em "front".`);
    if (c.kind === 'basic' && !c.back.trim()) throw new PlanError('invalid_arguments', `${n}: falta a resposta ("back").`);
    if ((c.kind === 'open' || c.kind === 'essay') && c.keyPoints.length === 0 && !c.back.trim()) {
      throw new PlanError('invalid_arguments', `${n}: perguntas abertas e dissertações precisam de pontos-chave ou de uma resposta modelo.`);
    }
  });
}

export async function planCreateReviewCards(db: D1Database, userId: string, p: ReviewCardsPayload): Promise<Plan<ReviewCardsPayload>> {
  const note = await noteOf(db, userId, p.noteId);
  check(p, note.body);
  return {
    tool: 'create_review_cards',
    kind: 'write',
    title: `Criar ${p.cards.length} ${p.cards.length === 1 ? 'cartão de revisão' : 'cartões de revisão'} da nota ${quoted(note.title)}`,
    preview: p.cards.map((c) => line(0, c.kind === 'cloze' ? clozePlain(c.front) : c.front, 'new', c.kind === 'cloze' ? `lacuna: ${c.quote}` : c.back || c.keyPoints.join('; '))),
    payload: p,
    // The user decided that questions written by the AI enter the reviews only after approval.
    confirm: true,
  };
}

export async function executeCreateReviewCards(db: D1Database, userId: string, p: ReviewCardsPayload): Promise<Execution> {
  const note = await noteOf(db, userId, p.noteId);
  check(p, note.body);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  let created = 0;
  for (const c of p.cards) {
    const indices = c.kind === 'cloze' ? clozeIndices(c.front) : [null];
    const groupId = uuidv7();
    indices.forEach((clozeIndex, i) => {
      created++;
      statements.push(
        insertCardStmt(db, userId, i === 0 ? groupId : uuidv7(), groupId, {
          kind: c.kind,
          front: c.front,
          back: c.kind === 'cloze' ? '' : c.back,
          keyPoints: c.kind === 'open' || c.kind === 'essay' ? c.keyPoints : [],
          clozeIndex,
          origin: 'ai',
          topicId: note.topicId,
          noteId: p.noteId,
          sourceQuote: c.quote,
          sourceProbe: sourceProbe(note.body, c.quote),
        }, now),
      );
    });
  }
  await db.batch(statements);
  return {
    results: [source('note', p.noteId, note.title)],
    summary: `Criou ${created} ${created === 1 ? 'cartão' : 'cartões'} de revisão da nota ${quoted(note.title)}`,
    output: { created, review_link: '/review', note: { id: p.noteId, link: `mynotes:note/${p.noteId}` } },
  };
}
