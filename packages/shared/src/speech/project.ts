import { z } from 'zod';
import type { BuildPart } from './curriculum';
import type { SpeechType } from './criteria';
import { METHOD_IDS, SPEECH_METHODS, type MethodId } from './methods';

/**
 * Level 4 — your own speech (docs/oratoria-trilha.md › Nível 4): a project
 * built step by step, rehearsed twice, questioned by the board and presented.
 * The script is kept as one of the user's notes.
 */

export const PROJECT_TYPES = ['presentation', 'political', 'idea'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_INFO: Record<ProjectType, { label: string; forWhat: string; method: MethodId; speechType: SpeechType; focus: string }> = {
  presentation: {
    label: 'Apresentação',
    forWhat: 'Seminário, trabalho, reunião, defesa de TCC',
    method: 'scqa',
    speechType: 'explain',
    focus: 'Clareza e estrutura acima de tudo; foco no tempo; prepare-se para as perguntas.',
  },
  political: {
    label: 'Discurso político',
    forWhat: 'Defender uma causa, uma candidatura ou uma proposta diante de um público',
    method: 'monroe',
    speechType: 'persuasive',
    focus: 'Público e chamado à ação no centro; contraste, histórias e recursos de retórica; resposta a críticas.',
  },
  idea: {
    label: 'Defesa de uma ideia',
    forWhat: 'Uma convicção sua, no estilo de uma palestra curta',
    method: 'psb',
    speechType: 'persuasive',
    focus: 'Uma ideia central forte, uma história pessoal e um fechamento memorável.',
  },
};

const text = (max = 2000) => z.string().max(max).default('');

/** Everything written in the project (all optional until filled). */
export const zProjectData = z.object({
  audience: text(1000),
  goal: text(1000),
  centralIdea: text(500),
  method: z.enum(METHOD_IDS).nullable().default(null),
  points: z
    .array(z.object({ title: z.string().max(300), argument: text(), evidence: text() }))
    .max(4)
    .default([]),
  objection: text(1000),
  objectionResponse: text(),
  story: text(4000),
  opening: text(),
  conclusion: text(),
  callToAction: text(1000),
  /** Talks recorded at each stage. */
  rehearsal1Id: z.string().max(64).nullable().default(null),
  rehearsal2Id: z.string().max(64).nullable().default(null),
  finalId: z.string().max(64).nullable().default(null),
});
export type ProjectData = z.infer<typeof zProjectData>;

export type ProjectStepKind = 'write' | 'rehearse' | 'review' | 'board' | 'final';

export interface ProjectStep {
  number: number;
  id: string;
  title: string;
  kind: ProjectStepKind;
  hint: string;
  /** For written steps: the part sent to the coach for feedback. */
  part?: BuildPart;
}

export const PROJECT_STEPS: ProjectStep[] = [
  { number: 1, id: 'audience', title: 'Público e objetivo', kind: 'write', part: 'structure', hint: 'Quem vai ouvir, o que essas pessoas já pensam e o que você quer que façam ou pensem ao final.' },
  { number: 2, id: 'centralIdea', title: 'Ideia central', kind: 'write', part: 'centralIdea', hint: 'Uma frase, até 20 palavras, que afirme algo.' },
  { number: 3, id: 'structure', title: 'Estrutura', kind: 'write', part: 'structure', hint: 'Escolha o método e de 2 a 4 pontos, na ordem que mais convence esse público.' },
  { number: 4, id: 'arguments', title: 'Argumentos e evidências', kind: 'write', part: 'argument', hint: 'Para cada ponto, o argumento e a evidência. E a objeção mais forte, com a sua resposta.' },
  { number: 5, id: 'story', title: 'A história', kind: 'write', part: 'story', hint: 'Um caso real que torne a ideia concreta: situação, conflito, virada e lição.' },
  { number: 6, id: 'openingClosing', title: 'Abertura e conclusão', kind: 'write', part: 'opening', hint: 'Uma abertura que prenda e uma conclusão que retome a ideia central, com o chamado à ação quando houver.' },
  { number: 7, id: 'rehearsal1', title: 'Primeiro ensaio', kind: 'rehearse', hint: 'Fale o discurso inteiro, sem ler. A régua completa avalia.' },
  { number: 8, id: 'review', title: 'Revisão', kind: 'review', hint: 'O professor aponta até 3 mudanças. Ajuste o roteiro antes do segundo ensaio.' },
  { number: 9, id: 'rehearsal2', title: 'Segundo ensaio', kind: 'rehearse', hint: 'Fale de novo e compare lado a lado com o primeiro.' },
  { number: 10, id: 'board', title: 'Banca', kind: 'board', hint: 'Perguntas difíceis sobre o seu discurso, como num debate ou numa entrevista.' },
  { number: 11, id: 'final', title: 'Apresentação final', kind: 'final', hint: 'A versão para valer, gravada e avaliada também pela IA ouvindo a sua voz.' },
];

/** The script as Markdown (it becomes the project's note). */
export function projectScript(title: string, type: ProjectType, d: ProjectData): string {
  const method = d.method ? SPEECH_METHODS[d.method] : null;
  const block = (heading: string, body: string) => (body.trim() ? [`## ${heading}`, '', body.trim(), ''] : []);
  const lines = [
    `# ${title.trim() || PROJECT_TYPE_INFO[type].label}`,
    '',
    `*${PROJECT_TYPE_INFO[type].label}*`,
    '',
    ...(d.audience.trim() ? [`**Público:** ${d.audience.trim()}`, ''] : []),
    ...(d.goal.trim() ? [`**Objetivo:** ${d.goal.trim()}`, ''] : []),
    ...block('Ideia central', d.centralIdea),
    ...block('Abertura', d.opening),
  ];
  const points = d.points.filter((p) => p.title.trim() || p.argument.trim());
  if (points.length) {
    lines.push(`## Desenvolvimento${method ? ` (${method.name})` : ''}`, '');
    for (const p of points) {
      lines.push(`### ${p.title.trim() || 'Ponto'}`, '');
      if (p.argument.trim()) lines.push(p.argument.trim(), '');
      if (p.evidence.trim()) lines.push(`*Evidência:* ${p.evidence.trim()}`, '');
    }
  }
  if (d.objection.trim() || d.objectionResponse.trim()) {
    lines.push('## Objeção e resposta', '');
    if (d.objection.trim()) lines.push(`*Objeção:* ${d.objection.trim()}`, '');
    if (d.objectionResponse.trim()) lines.push(d.objectionResponse.trim(), '');
  }
  lines.push(...block('História', d.story), ...block('Conclusão', d.conclusion));
  if (d.callToAction.trim()) lines.push(`**Chamado à ação:** ${d.callToAction.trim()}`, '');
  return lines.join('\n').trim() + '\n';
}

/** Whether a written step has anything to comment on. */
export function stepFilled(step: ProjectStep, d: ProjectData): boolean {
  const any = (...xs: string[]) => xs.some((x) => x.trim().length > 0);
  switch (step.id) {
    case 'audience':
      return any(d.audience, d.goal);
    case 'centralIdea':
      return any(d.centralIdea);
    case 'structure':
      return d.method !== null || d.points.some((p) => any(p.title));
    case 'arguments':
      return d.points.some((p) => any(p.argument, p.evidence)) || any(d.objection, d.objectionResponse);
    case 'story':
      return any(d.story);
    case 'openingClosing':
      return any(d.opening, d.conclusion, d.callToAction);
    default:
      return false;
  }
}

/** What the student wrote at a step, as plain text (sent for the coach's feedback). */
export function stepText(step: ProjectStep, d: ProjectData): string {
  switch (step.id) {
    case 'audience':
      return `Público: ${d.audience}\nObjetivo: ${d.goal}`;
    case 'centralIdea':
      return d.centralIdea;
    case 'structure':
      return `Método: ${d.method ? SPEECH_METHODS[d.method].name : '—'}\nPontos: ${d.points.map((p) => p.title).join(' | ')}`;
    case 'arguments':
      return [...d.points.map((p) => `${p.title}: ${p.argument} (evidência: ${p.evidence})`), `Objeção: ${d.objection}`, `Resposta: ${d.objectionResponse}`].join('\n');
    case 'story':
      return d.story;
    case 'openingClosing':
      return `Abertura: ${d.opening}\nConclusão: ${d.conclusion}\nChamado à ação: ${d.callToAction}`;
    default:
      return '';
  }
}
