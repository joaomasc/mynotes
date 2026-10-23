import { z } from 'zod';
import { LEECH_LAPSES, zId } from '@mynotes/shared';
import { all, num, str, strOrNull } from '../../../lib/db';
import { nowIso } from '../../../lib/time';
import { planCreateReviewCards } from '../review-actions';
import { CARD_FROM, CARD_LIVE, CARD_TOPIC } from '../../review/scope';
import { reviewSummary } from '../../review/stats';
import { apply, modeParam, zMode } from './write';
import { defineTool, linkOf, q, S } from './types';

/* -------------------------------------------------------- get_review_status -- */

export const getReviewStatusTool = defineTool({
  name: 'get_review_status',
  kind: 'read',
  description:
    'Revisar (spaced repetition of cards and questions written from the notes): what is due today, new items available, streak, cards the user keeps forgetting, AI questions waiting for approval, and the topics with most items due. ' +
    'Use it for "o que tenho para revisar?", "como estão as minhas revisões?". The user reviews in the app (page Revisar, link /review); you cannot answer cards for them.',
  parameters: S.obj({}),
  args: z.strictObject({}),
  label: () => 'Consultou as revisões de hoje',
  async run(ctx) {
    const summary = await reviewSummary(ctx.db, ctx.userId, ctx.localToday);
    const rows = await all(
      ctx.db,
      `SELECT ${CARD_TOPIC} AS topic_id, t.title, COUNT(*) AS n,
         SUM(CASE WHEN c.lapses >= ? THEN 1 ELSE 0 END) AS hard
         FROM ${CARD_FROM} LEFT JOIN topics t ON t.id = ${CARD_TOPIC}
        WHERE c.user_id = ? AND c.status = 'active' AND c.phase > 0 AND c.due <= ? AND ${CARD_LIVE}
        GROUP BY ${CARD_TOPIC} ORDER BY n DESC LIMIT 10`,
      LEECH_LAPSES,
      ctx.userId,
      nowIso(),
    );
    return {
      due_now: summary.due,
      new_available_today: summary.newAvailable,
      answered_today: summary.reviewedToday,
      streak_days: summary.streak,
      active_items: summary.total,
      hard_items: summary.leeches,
      ai_questions_waiting_approval: summary.proposals,
      due_by_topic: rows.map((r) => ({
        topic: strOrNull(r.topic_id) ? { id: str(r.topic_id), title: str(r.title), link: linkOf('topic', str(r.topic_id)) } : null,
        due: num(r.n),
        hard: num(r.hard),
      })),
      app_link: '/review',
    };
  },
});

/* ------------------------------------------------------ create_review_cards -- */

const zCards = z.strictObject({
  note_id: zId,
  cards: z
    .array(
      z.strictObject({
        kind: z.enum(['basic', 'cloze', 'open', 'essay']),
        front: z.string().trim().min(3).max(1500),
        back: z.string().trim().max(3000),
        key_points: z.array(z.string().trim().min(1).max(300)).max(6),
        quote: z.string().trim().min(12).max(1000),
      }),
    )
    .min(1)
    .max(15),
  mode: zMode,
});

export const createReviewCardsTool = defineTool({
  name: 'create_review_cards',
  kind: 'write',
  description:
    'Proposes review cards (Revisar) written from ONE note: "crie cartões/flashcards/perguntas desta nota". Always waits for the user to confirm in the app. ' +
    'Read the note first (get_note). Each card: kind basic (short question + answer), cloze (a sentence of the note with {{c1::term}} blanks; back ""), open (1–3 sentence answer; key_points 2–4) or essay ("Explique/Compare/Por que…"; back = model answer; key_points 3–6). ' +
    '`quote` is a passage copied LITERALLY from the note that contains the answer (cards whose quote is not in the note are refused). Only facts from the note; one idea per basic card.',
  parameters: S.obj({
    note_id: S.str('The note the cards come from.'),
    cards: S.arr(
      S.obj({
        kind: S.enum(['basic', 'cloze', 'open', 'essay']),
        front: S.str(),
        back: S.str(),
        key_points: S.arr(S.str()),
        quote: S.str('Passage copied literally from the note.'),
      }),
    ),
    mode: modeParam,
  }),
  args: zCards,
  label: (a) => `Propôs ${a.cards.length} ${a.cards.length === 1 ? 'cartão' : 'cartões'} de revisão: ${q(a.cards[0]?.front ?? '')}`,
  async run(ctx, a) {
    const plan = await planCreateReviewCards(ctx.db, ctx.userId, {
      noteId: a.note_id,
      cards: a.cards.map((c) => ({ kind: c.kind, front: c.front, back: c.back, keyPoints: c.key_points, quote: c.quote })),
    });
    return apply(ctx, plan, a.mode);
  },
});

export const reviewTools = [getReviewStatusTool, createReviewCardsTool];
