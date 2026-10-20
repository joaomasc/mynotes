/**
 * Skills of the speaking path (docs/oratoria-trilha.md): the measured criteria
 * of the rubric plus the speech-building skills taught by the “C” units. Each
 * has a level from 0 to 5 that grows with practice and decides the reviews.
 */
export const SPEECH_SKILLS = [
  'pace',
  'pauses',
  'pitchVariation',
  'finalContour',
  'volume',
  'articulation',
  'fillers',
  'weakWords',
  'sentences',
  'centralIdea',
  'structure',
  'openingClosing',
  'argumentation',
  'persuasion',
  'storytelling',
  'rhetoric',
  'improvisation',
] as const;
export type SkillId = (typeof SPEECH_SKILLS)[number];

export const SKILL_LABELS: Record<SkillId, string> = {
  pace: 'Ritmo',
  pauses: 'Pausas',
  pitchVariation: 'Entonação',
  finalContour: 'Final das afirmações',
  volume: 'Volume',
  articulation: 'Dicção',
  fillers: 'Vícios de linguagem',
  weakWords: 'Linguagem firme',
  sentences: 'Frases claras',
  centralIdea: 'Ideia central',
  structure: 'Estrutura',
  openingClosing: 'Abertura e conclusão',
  argumentation: 'Argumentação',
  persuasion: 'Persuasão',
  storytelling: 'Histórias',
  rhetoric: 'Recursos de retórica',
  improvisation: 'Improviso e perguntas',
};

/** Skills whose state comes straight from a measured criterion of the rubric (same id). */
export const MEASURED_SKILLS: SkillId[] = ['pace', 'pauses', 'pitchVariation', 'finalContour', 'volume', 'articulation', 'fillers', 'weakWords', 'sentences'];

/** XP needed for each level: level n from LEVEL_XP[n] up. */
export const LEVEL_XP = [0, 20, 60, 120, 200, 300] as const;
export const SKILL_MAX_LEVEL = LEVEL_XP.length - 1;

export function skillLevel(xp: number): number {
  let level = 0;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]!) level = i;
  return level;
}

/** Days until a skill should be practiced again, by level (spaced repetition). */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 14, 30] as const;
