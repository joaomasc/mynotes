import type { SpeechType } from './criteria';
import type { SpeechGoal } from './goals';
import type { MethodId } from './methods';
import type { SkillId } from './skills';

/**
 * The speaking path as data (docs/oratoria-trilha.md): levels of units, units
 * of short lessons, lessons of exercises. Content lives in speech/content/;
 * ids are stable, so rewriting a lesson never loses progress.
 */

/** Where the theme of a talk comes from: fixed text, or one of the user's notes. */
export type TalkTopic = { text: string } | { fromNotes: true; prompt: string };

export type Exercise =
  /** A short card with the idea, a good and a bad example. */
  | { type: 'concept'; title: string; body: string; good?: string; bad?: string }
  /** Multiple choice. */
  | { type: 'recognize'; prompt: string; options: string[]; answer: number; explanation: string }
  /** Rewrite a weak sentence; checked by the model, with a sample answer when it is unavailable. */
  | { type: 'fix'; instruction: string; sentence: string; sample: string; focus: SkillId }
  /** Write a part of a talk (central idea, opening…). */
  | { type: 'build'; part: BuildPart; instruction: string; example: string; method?: MethodId }
  /** Read a text with marks (| pause, *emphasis*, ↘ ↗ ending). */
  | { type: 'readAloud'; instruction: string; text: string }
  /** Tongue twisters and hard endings: every word must come out. */
  | { type: 'articulation'; text: string }
  /** Breathing: inhale, hold, exhale (seconds), repeated. */
  | { type: 'breathing'; instruction: string; inhale: number; hold: number; exhale: number; rounds: number }
  /** Talk for a while on a theme, with goals over the metrics. */
  | { type: 'shortTalk'; instruction: string; topic: TalkTopic; seconds: number; goals: SpeechGoal[]; method?: MethodId; speechType?: SpeechType };

export type ExerciseType = Exercise['type'];

export const BUILD_PARTS = ['centralIdea', 'opening', 'conclusion', 'argument', 'story', 'callToAction', 'structure', 'answer'] as const;
export type BuildPart = (typeof BUILD_PARTS)[number];

export const BUILD_PART_LABELS: Record<BuildPart, string> = {
  centralIdea: 'Ideia central',
  opening: 'Abertura',
  conclusion: 'Conclusão',
  argument: 'Argumento',
  story: 'História',
  callToAction: 'Chamado à ação',
  structure: 'Estrutura',
  answer: 'Resposta',
};

export interface Lesson {
  /** Stable id, e.g. “u3-l2”. */
  id: string;
  title: string;
  skills: SkillId[];
  exercises: Exercise[];
}

/** The talk that closes a unit or a level. */
export interface Challenge {
  id: string;
  instruction: string;
  topic: TalkTopic;
  seconds: number;
  speechType: SpeechType;
  goals: SpeechGoal[];
  method?: MethodId;
}

export interface Unit {
  id: string;
  number: number;
  title: string;
  track: 'E' | 'C' | 'E+C';
  summary: string;
  skills: SkillId[];
  lessons: Lesson[];
  challenge: Challenge;
}

export interface Level {
  id: string;
  number: number;
  title: string;
  units: Unit[];
  /** Longer talk over everything seen in the level; passing it also lets the user skip the level. */
  challenge: Challenge;
}
