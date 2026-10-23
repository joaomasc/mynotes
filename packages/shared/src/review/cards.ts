/**
 * Review ("Revisar", docs/revisar.md): the kinds of items, how each is
 * answered and graded, and the labels shown in the app.
 */

export const CARD_KINDS = ['basic', 'cloze', 'typed', 'open', 'essay'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_KIND_LABELS: Record<CardKind, string> = {
  basic: 'Frente e verso',
  cloze: 'Lacuna',
  typed: 'Resposta digitada',
  open: 'Pergunta aberta',
  essay: 'Dissertação',
};

/** Kinds the AI corrects (by key points); the others are graded by the user. */
export const AI_GRADED_KINDS: readonly CardKind[] = ['open', 'essay'];
export const isAiGraded = (kind: CardKind): boolean => AI_GRADED_KINDS.includes(kind);

/** Kinds the AI may propose from the notes. */
export const GENERATED_KINDS = ['basic', 'cloze', 'open', 'essay'] as const;
export type GeneratedKind = (typeof GENERATED_KINDS)[number];

export const CARD_STATUSES = ['active', 'suspended'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** manual: written by the user; ai: proposed from the notes and approved; relation: a question about a link in the graph. */
export const CARD_ORIGINS = ['manual', 'ai', 'relation'] as const;
export type CardOrigin = (typeof CARD_ORIGINS)[number];

export const REVIEW_MODES = ['due', 'cards', 'questions', 'practice', 'recall'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  due: 'Revisão do dia',
  cards: 'Só cartões',
  questions: 'Perguntas e dissertações',
  practice: 'Treino livre',
  recall: 'Escrever tudo que lembra',
};

export const REVIEW_MODE_HINTS: Record<ReviewMode, string> = {
  due: 'Tudo que vence hoje e alguns itens novos, com os assuntos misturados.',
  cards: 'Frente e verso, lacunas e respostas digitadas que vencem hoje.',
  questions: 'Perguntas abertas e dissertações que vencem hoje, corrigidas pela IA.',
  practice: 'Os itens que você está mais perto de esquecer, mesmo que não vençam hoje.',
  recall: 'Você escreve (ou fala) tudo que lembra de um assunto e a IA mostra o que faltou.',
};

/** Ratings of a review (FSRS grades). */
export const RATINGS = [1, 2, 3, 4] as const;
export type ReviewRating = (typeof RATINGS)[number];
export const RATING_LABELS: Record<ReviewRating, string> = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };

/** How sure the user was before seeing the answer (hypercorrection). */
export const CONFIDENCES = [1, 2, 3] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABELS: Record<Confidence, string> = { 1: 'Não sei', 2: 'Acho que sei', 3: 'Tenho certeza' };

/** A card lapsed this many times is a "leech": it gets help (split, rewrite, mnemonic). */
export const LEECH_LAPSES = 6;

/** Key points of an open question or essay (what a good answer must have). */
export const KEY_POINTS_MAX = 6;
export const KEY_POINT_MAX = 300;
export const CARD_FRONT_MAX = 4000;
export const CARD_BACK_MAX = 8000;
export const SOURCE_QUOTE_MAX = 2000;
export const ANSWER_MAX = 20_000;

/**
 * Rating suggested by a 0–100 score (AI correction or typed answer): the
 * user can always change it before saving.
 */
export function ratingForScore(score: number): ReviewRating {
  if (score >= 85) return 3;
  if (score >= 60) return 2;
  return 1;
}

/** A review counts as correct from "Difícil" up. */
export const isCorrect = (rating: number): boolean => rating >= 2;

/** Sure of an answer that was wrong: worth a second look (it tends to come back). */
export const isConfidentError = (rating: number, confidence: number | null | undefined): boolean => rating === 1 && confidence === 3;
