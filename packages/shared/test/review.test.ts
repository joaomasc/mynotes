import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLES,
  SETTINGS_SCHEMAS,
  afterAnswer,
  clozeIndices,
  clozePlain,
  clozeSegments,
  compareTyped,
  formatInterval,
  interleave,
  isConfidentError,
  newSchedulingState,
  nextState,
  normalizeAligned,
  parseCloze,
  previewDue,
  quoteFound,
  ratingForScore,
  renderCloze,
  retrievability,
  sourceProbe,
  topScope,
  typedScore,
  zReviewCardCreate,
  zReviewSettings,
} from '../src';

describe('cloze deletions', () => {
  it('numbers blanks like Anki: same number hides together, unnumbered blanks get their own', () => {
    const text = 'A {{c1::mitocôndria}} produz {{c2::ATP::sigla}}; o {{núcleo}} guarda o {{c1::DNA}}.';
    expect(parseCloze(text).map((b) => [b.index, b.answer, b.hint])).toEqual([
      [1, 'mitocôndria', null],
      [2, 'ATP', 'sigla'],
      [3, 'núcleo', null],
      [1, 'DNA', null],
    ]);
    expect(clozeIndices(text)).toEqual([1, 2, 3]);
    expect(renderCloze(text, 1)).toEqual({
      prompt: 'A […] produz ATP; o núcleo guarda o […].',
      answer: 'mitocôndria · DNA',
      full: 'A mitocôndria produz ATP; o núcleo guarda o DNA.',
    });
    expect(renderCloze(text, 2).prompt).toBe('A mitocôndria produz [sigla]; o núcleo guarda o DNA.');
    expect(clozeSegments(text, 3).filter((s) => s.blank === 'active').map((s) => s.text)).toEqual(['núcleo']);
    expect(clozePlain(text)).toBe('A mitocôndria produz ATP; o núcleo guarda o DNA.');
  });

  it('ignores empty blanks and text without markers', () => {
    expect(clozeIndices('Sem lacunas aqui {{ }}.')).toEqual([]);
  });
});

describe('typed answers', () => {
  it('ignores case, accents and punctuation, and forgives small slips', () => {
    expect(compareTyped('Fotossíntese', 'fotossintese!').verdict).toBe('exact');
    expect(compareTyped('Fotossíntese', 'fotosintese').verdict).toBe('close');
    expect(compareTyped('Fotossíntese', 'respiração').verdict).toBe('wrong');
    expect(compareTyped('Fotossíntese', '').verdict).toBe('wrong');
    expect(compareTyped('1822 | mil oitocentos e vinte e dois', '1822').verdict).toBe('exact');
    expect(ratingForScore(typedScore('exact'))).toBe(3);
    expect(ratingForScore(typedScore('close'))).toBe(2);
    expect(ratingForScore(typedScore('wrong'))).toBe(1);
  });
});

describe('passages quoted from notes', () => {
  const body = 'A Revolução Francesa começou em 1789.\n\nO “Terceiro Estado” reuniu-se em assembleia — e jurou não se separar.';
  it('finds the passage regardless of accents, quotes and spacing, and in pieces cut with “…”', () => {
    expect(quoteFound(body, 'a revolucao francesa comecou em 1789')).toBe(true);
    expect(quoteFound(body, '"Terceiro Estado" reuniu-se em assembleia - e jurou')).toBe(true);
    expect(quoteFound(body, 'A Revolução Francesa … jurou não se separar')).toBe(true);
    expect(quoteFound(body, 'A Revolução Russa começou em 1917')).toBe(false);
    // Too short to prove anything.
    expect(quoteFound(body, '1789')).toBe(false);
  });

  it('keeps a short piece that the database can find in notes.search_text', () => {
    const probe = sourceProbe(body, 'O “Terceiro Estado” reuniu-se em assembleia e jurou não se separar');
    expect(probe.length).toBeGreaterThanOrEqual(12);
    expect(normalizeAligned(body)).toContain(probe);
    expect(sourceProbe(body, 'nada disso está na nota de verdade')).toBe('');
  });
});

describe('scheduling (FSRS)', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');

  it('starts new, learns in minutes and spaces out the reviews', () => {
    const s0 = newSchedulingState(now);
    expect(s0).toMatchObject({ phase: 0, reps: 0, lapses: 0, lastReview: null });
    const preview = previewDue(s0, now, 0.9);
    expect(Date.parse(preview[1])).toBeLessThan(Date.parse(preview[3]));
    expect(Date.parse(preview[3])).toBeLessThan(Date.parse(preview[4]));
    expect(formatInterval(now.toISOString(), preview[1])).toBe('1 min');

    const good = nextState(s0, now, 3, { desiredRetention: 0.9, fuzz: false });
    expect(good.state.phase).toBe(1);
    const learned = nextState(good.state, new Date(good.state.due), 3, { desiredRetention: 0.9, fuzz: false });
    expect(learned.state.phase).toBe(2);
    expect(learned.state.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(learned.elapsedDays).toBeGreaterThan(0);
    // Forgotten: back to relearning, one more lapse.
    const later = new Date(Date.parse(learned.state.due) + 86_400_000);
    expect(retrievability(learned.state, later)).toBeLessThan(retrievability(learned.state, new Date(learned.state.due)));
    const lapse = nextState(learned.state, later, 1, { desiredRetention: 0.9, fuzz: false });
    expect(lapse.state).toMatchObject({ phase: 3, lapses: 1 });
  });

  it('a higher desired retention brings items back sooner', () => {
    let s = newSchedulingState(now);
    s = nextState(s, now, 3, { desiredRetention: 0.9, fuzz: false }).state;
    s = nextState(s, new Date(s.due), 3, { desiredRetention: 0.9, fuzz: false }).state;
    const at = new Date(s.due);
    expect(Date.parse(previewDue(s, at, 0.95)[3])).toBeLessThan(Date.parse(previewDue(s, at, 0.85)[3]));
  });

  it('formats intervals in Portuguese', () => {
    const at = '2026-10-21T00:00:00.000Z';
    expect(formatInterval(at, '2026-10-21T00:10:00.000Z')).toBe('10 min');
    expect(formatInterval(at, '2026-10-21T05:00:00.000Z')).toBe('5 h');
    expect(formatInterval(at, '2026-10-24T00:00:00.000Z')).toBe('3 d');
    expect(formatInterval(at, '2027-01-21T00:00:00.000Z')).toBe('3 meses');
    expect(formatInterval(at, '2028-04-21T00:00:00.000Z')).toBe('1,5 ano');
  });
});

describe('sessions', () => {
  it('spreads topics through the session instead of blocks', () => {
    const items = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'c1'];
    const out = interleave(items, (x) => x[0]!);
    expect(out).toHaveLength(7);
    expect(new Set(out)).toEqual(new Set(items));
    // Order inside a topic is kept, and no two items of the same topic in a row.
    expect(out.filter((x) => x.startsWith('a'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(out.every((x, i) => i === 0 || x[0] !== out[i - 1]![0])).toBe(true);
  });

  it('reduces a selection to its top topics (A already includes B and C)', () => {
    const parent: Record<string, string | null> = { A: null, B: 'A', C: 'B', D: null };
    expect(topScope(['C', 'A', 'B'], (id) => parent[id])).toEqual(['A']);
    expect(topScope(['B', 'D'], (id) => parent[id]).sort()).toEqual(['B', 'D']);
    expect(topScope(['C'], (id) => parent[id])).toEqual(['C']);
  });

  it('brings a mistake back later in the session, a few times at most', () => {
    const q = ['x', 'y', 'z', 'w', 'v'].map((cardId) => ({ cardId, round: 0 }));
    const after = afterAnswer(q, 1);
    expect(after.map((i) => i.cardId)).toEqual(['y', 'z', 'w', 'x', 'v']);
    expect(after[3]).toEqual({ cardId: 'x', round: 1 });
    expect(afterAnswer(q, 3).map((i) => i.cardId)).toEqual(['y', 'z', 'w', 'v']);
    // A mistake made with certainty comes back right after the next item.
    expect(afterAnswer(q, 1, 1).map((i) => i.cardId)).toEqual(['y', 'x', 'z', 'w', 'v']);
    expect(afterAnswer([{ cardId: 'x', round: 3 }], 1)).toEqual([]);
    expect(afterAnswer([{ cardId: 'x', round: 0 }], 1)).toEqual([{ cardId: 'x', round: 1 }]);
  });

  it('flags errors made with certainty', () => {
    expect(isConfidentError(1, 3)).toBe(true);
    expect(isConfidentError(1, 1)).toBe(false);
    expect(isConfidentError(3, 3)).toBe(false);
  });
});

describe('contract', () => {
  it('validates cards: answers for flashcards, key points or a model answer for questions', () => {
    expect(zReviewCardCreate.safeParse({ kind: 'basic', front: 'Capital da França?' }).success).toBe(false);
    expect(zReviewCardCreate.safeParse({ kind: 'basic', front: 'Capital da França?', back: 'Paris' }).success).toBe(true);
    expect(zReviewCardCreate.safeParse({ kind: 'essay', front: 'Explique a fotossíntese.' }).success).toBe(false);
    expect(zReviewCardCreate.safeParse({ kind: 'essay', front: 'Explique a fotossíntese.', keyPoints: ['luz', 'clorofila'] }).success).toBe(true);
    expect(zReviewCardCreate.safeParse({ kind: 'cloze', front: 'A {{c1::luz}} entra.' }).success).toBe(true);
  });

  it('has defaults for the review settings and keeps them in the backup', () => {
    expect(zReviewSettings.parse({})).toMatchObject({ desiredRetention: 0.9, newPerDay: 20, sessionSize: 20, askConfidence: true, scopes: [] });
    expect('review' in SETTINGS_SCHEMAS).toBe(true);
    expect(Object.keys(BACKUP_TABLES)).toEqual(expect.arrayContaining(['review_cards', 'review_logs', 'review_sessions', 'review_recalls']));
    expect(Object.keys(BACKUP_TABLES)).not.toContain('review_proposals');
    // Parents come before the tables that point to them.
    const order = Object.keys(BACKUP_TABLES);
    expect(order.indexOf('review_cards')).toBeGreaterThan(order.indexOf('notes'));
    expect(order.indexOf('review_logs')).toBeGreaterThan(order.indexOf('review_cards'));
    expect(order.indexOf('review_logs')).toBeGreaterThan(order.indexOf('review_sessions'));
    expect(order.indexOf('review_sessions')).toBeGreaterThan(order.indexOf('study_sessions'));
  });
});
