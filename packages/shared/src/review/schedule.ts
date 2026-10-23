import { createEmptyCard, fsrs, type Card, type CardInput, type FSRS, type Grade } from 'ts-fsrs';
import type { ReviewRating } from './cards';

/**
 * When each item comes back: FSRS-6 (the scheduler of current Anki) through
 * ts-fsrs. The API computes and stores; the app uses the same functions to
 * show, on each button, when the item would return.
 */

/** 0 new, 1 learning, 2 review, 3 relearning (FSRS states). */
export type SchedulingPhase = 0 | 1 | 2 | 3;

export interface SchedulingState {
  phase: SchedulingPhase;
  /** ISO timestamp (UTC). */
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

export const PHASE_LABELS: Record<SchedulingPhase, string> = { 0: 'Novo', 1: 'Aprendendo', 2: 'Revisão', 3: 'Reaprendendo' };

export interface SchedulerOptions {
  /** Chance of remembering when an item comes back (0.8–0.97). */
  desiredRetention: number;
  /** Small random spread of the intervals (so items created together do not all return the same day). */
  fuzz: boolean;
}

export const DEFAULT_RETENTION = 0.9;
/** Longest interval: 10 years. */
const MAX_INTERVAL_DAYS = 3650;

const cache = new Map<string, FSRS>();
function scheduler(o: SchedulerOptions): FSRS {
  const key = `${o.desiredRetention}:${o.fuzz}`;
  let f = cache.get(key);
  if (!f) {
    f = fsrs({ request_retention: o.desiredRetention, maximum_interval: MAX_INTERVAL_DAYS, enable_fuzz: o.fuzz, enable_short_term: true });
    cache.set(key, f);
  }
  return f;
}

export function newSchedulingState(now: Date): SchedulingState {
  return fromCard(createEmptyCard(now));
}

function toCard(s: SchedulingState): CardInput {
  return {
    state: s.phase,
    due: s.due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    last_review: s.lastReview,
  };
}

function fromCard(c: Card): SchedulingState {
  return {
    phase: c.state as SchedulingPhase,
    due: c.due.toISOString(),
    stability: Math.round(c.stability * 1e4) / 1e4,
    difficulty: Math.round(c.difficulty * 1e4) / 1e4,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ? c.last_review.toISOString() : null,
  };
}

/** The state after one answer, and how many days had passed since the previous one. */
export function nextState(s: SchedulingState, now: Date, rating: ReviewRating, o: SchedulerOptions): { state: SchedulingState; elapsedDays: number } {
  const elapsedDays = s.lastReview ? Math.max(0, (now.getTime() - Date.parse(s.lastReview)) / 86_400_000) : 0;
  const { card } = scheduler(o).next(toCard(s), now, rating as Grade);
  return { state: fromCard(card), elapsedDays: Math.round(elapsedDays * 100) / 100 };
}

/** When the item would come back for each button (without the random spread). */
export function previewDue(s: SchedulingState, now: Date, desiredRetention: number): Record<ReviewRating, string> {
  const p = scheduler({ desiredRetention, fuzz: false }).repeat(toCard(s), now);
  return { 1: p[1].card.due.toISOString(), 2: p[2].card.due.toISOString(), 3: p[3].card.due.toISOString(), 4: p[4].card.due.toISOString() };
}

/** Chance of remembering now (0–1); 0 for an item never reviewed. */
export function retrievability(s: SchedulingState, now: Date): number {
  if (s.phase === 0 || !s.lastReview) return 0;
  return scheduler({ desiredRetention: DEFAULT_RETENTION, fuzz: false }).get_retrievability(toCard(s), now, false);
}

/** "1 min", "10 min", "5 h", "3 d", "2 meses", "1,3 ano". */
export function formatInterval(fromIso: string, toIso: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(minutes / 1440);
  if (days < 31) return `${days} d`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${String(years).replace('.', ',')} ${years < 2 ? 'ano' : 'anos'}`;
}
