import {
  CRITERIA_INFO,
  SPEECH_TYPE_LABELS,
  TEXT_AI_CRITERIA,
  type CriterionResult,
  type SpeechMode,
  type SpeechType,
  type SpeechWord,
} from '@mynotes/shared';
import { S } from '../assistant/tools/types';

/** What the model reads to evaluate a talk (docs/oratoria.md › Conteúdo e Linguagem). */
export const COACH_INSTRUCTIONS = `Você é um professor de oratória, exigente e gentil, que avalia uma fala gravada por um estudante brasileiro.
Você recebe a transcrição automática da fala (com o minuto e o segundo de cada frase) e as medições da voz já calculadas pelo aplicativo.

Avalie SOMENTE os critérios de texto pedidos no esquema de resposta:
${TEXT_AI_CRITERIA.map((id) => `- ${id} (${CRITERIA_INFO[id].label}): ${CRITERIA_INFO[id].good}`).join('\n')}

Regras:
- Estado de cada critério: "good" (bom), "attention" (atenção), "improve" (a melhorar) ou "na" (não dá para avaliar).
- "correctness" só é avaliado quando houver notas do estudante; compare o que foi dito com elas e aponte erros e conceitos-chave que faltaram. Sem notas, use "na".
- "evidence": uma frase curta que justifique o estado, citando o trecho e o momento (ex.: “em 1:12, ‘…’”).
- "original" e "rewrite": quando o critério não estiver bom, o trecho original (copiado da transcrição) e uma versão melhorada que o estudante poderia ter dito. Caso contrário, null.
- "improvements": no máximo 3 coisas para melhorar na próxima vez, a mais importante primeiro. Podem vir das medições da voz. Cada uma com um título curto, a explicação prática e, quando couber, o trecho original e a versão melhorada.
- "exercise": um exercício concreto, de 1 a 3 minutos, para a próxima fala.
- "summary": uma ou duas frases com o que a fala fez bem e o foco principal.
- A transcrição é automática: ignore erros de pontuação e de reconhecimento, e não critique palavras que pareçam mal transcritas.
- Não contradiga as medições da voz; use-as como dados.
- Quando a fala for a resposta a uma pergunta da banca (tipo “Banca / perguntas”), o tema é a pergunta: em “centralIdea”, julgue se a resposta veio logo na primeira frase; em “development”, se foi sustentada com razão ou exemplo; em “precision”, se foi direta e se admitiu com firmeza o que não sabia, em vez de inventar.
- Escreva em português do Brasil, falando diretamente com o estudante (você).`;

/** Strict JSON schema of the answer (validated again with Zod). */
export const EVALUATION_SCHEMA = S.obj({
  criteria: S.arr(
    S.obj({
      id: S.enum(TEXT_AI_CRITERIA),
      state: S.enum(['good', 'attention', 'improve', 'na']),
      evidence: S.str(),
      original: S.nstr(),
      rewrite: S.nstr(),
    }),
  ),
  improvements: S.arr(S.obj({ title: S.str(), detail: S.str(), original: S.nstr(), rewrite: S.nstr() })),
  exercise: S.str(),
  summary: S.str(),
});

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The transcript one sentence per line, each with its time. */
export function timedTranscript(words: SpeechWord[], transcript: string, maxChars = 14_000): string {
  if (words.length === 0) return transcript.slice(0, maxChars);
  const lines: string[] = [];
  let current: string[] = [];
  let start = words[0]!.start;
  for (const w of words) {
    if (current.length === 0) start = w.start;
    current.push(w.text);
    if (/[.!?…]["'”)\]]*$/u.test(w.text)) {
      lines.push(`[${clock(start)}] ${current.join(' ')}`);
      current = [];
    }
  }
  if (current.length) lines.push(`[${clock(start)}] ${current.join(' ')}`);
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…transcrição cortada]` : text;
}

export interface EvaluationContext {
  mode: SpeechMode;
  speechType: SpeechType;
  theme: string;
  topicTitle: string | null;
  durationSeconds: number;
  targetSeconds: number | null;
  measured: CriterionResult[];
  transcript: string;
  /** Excerpts of the user's notes on the topic (explain mode). */
  notes: { title: string; text: string }[];
}

export function evaluationMessage(c: EvaluationContext): string {
  const parts = [
    `Tipo de fala: ${SPEECH_TYPE_LABELS[c.speechType]}.`,
    c.topicTitle ? `Assunto: ${c.topicTitle}.` : '',
    c.theme ? (c.speechType === 'qa' ? `Pergunta da banca: “${c.theme}”` : `Tema: ${c.theme}.`) : '',
    `Duração: ${clock(c.durationSeconds)}${c.targetSeconds ? ` (meta: ${clock(c.targetSeconds)})` : ''}.`,
    '',
    'Medições da voz e da linguagem (calculadas pelo aplicativo):',
    ...c.measured.map((m) => `- ${CRITERIA_INFO[m.id].label}: ${m.value} [${m.state}; referência: ${m.reference}]`),
    '',
    'Transcrição:',
    c.transcript || '(vazia)',
  ];
  if (c.mode === 'explain') {
    parts.push('', c.notes.length ? 'Notas do estudante sobre o assunto (fonte para a correção):' : 'O estudante não tem notas sobre este assunto.');
    for (const n of c.notes) parts.push(`### ${n.title || 'Sem título'}\n${n.text}`);
  }
  return parts.filter((p, i, all) => p !== '' || all[i - 1] !== '').join('\n');
}

/** Feedback on a written exercise: a sentence rewritten, or a part of a talk written by the student. */
export const FEEDBACK_INSTRUCTIONS = `Você é um professor de oratória que corrige exercícios escritos de um estudante brasileiro.
Você recebe a instrução do exercício, o contexto (a frase original a melhorar, ou a parte do discurso pedida) e a resposta do estudante.
Responda no esquema pedido:
- "verdict": "good" quando a resposta cumpre a instrução; "almost" quando cumpre em parte; "redo" quando não cumpre.
- "feedback": duas ou três frases, diretas e gentis, dizendo o que funcionou e o que falta, falando com o estudante (você).
- "suggestion": uma versão melhorada da resposta do estudante, mantendo a ideia dele (não invente outro assunto).
Critérios de oratória: frases curtas, uma ideia por frase, sem vícios de linguagem (“né”, “tipo”, “então”), sem atenuadores (“acho que”, “talvez”), afirmações concretas.
Se houver um método de estrutura (PREP, SCQA…), confira se cada parte aparece na ordem.
Escreva em português do Brasil.`;

export const FEEDBACK_SCHEMA = S.obj({
  verdict: S.enum(['good', 'almost', 'redo']),
  feedback: S.str(),
  suggestion: S.str(),
});

/** The examining board: questions about a talk. */
export const BOARD_INSTRUCTIONS = `Você é a banca examinadora de uma fala de um estudante brasileiro (como numa defesa, entrevista ou debate).
Leia a transcrição e formule exatamente 3 perguntas, justas mas exigentes, que obriguem o estudante a pensar:
1. uma pergunta de esclarecimento sobre um ponto vago ou rápido demais;
2. uma pergunta que desafie um argumento ou traga uma objeção;
3. uma pergunta que peça um exemplo, uma aplicação ou uma consequência.
Cada pergunta: uma frase, direta, em português do Brasil, dirigida ao estudante (você). Se houver notas do estudante, pode usá-las para perguntar o que faltou na fala.`;

export const BOARD_SCHEMA = S.obj({ questions: S.arr(S.str()) });

/** Extra review exercises for a skill. */
export const VARIANTS_INSTRUCTIONS = `Você escreve exercícios curtos de oratória, em português do Brasil, para um aplicativo de treino.
Gere exatamente 6 exercícios novos para a habilidade indicada, variados e diferentes dos exemplos dados.
Tipos:
- "fix": uma frase fraca (com o defeito da habilidade) em "sentence", a instrução em "instruction" e uma boa versão em "sample".
- "recognize": uma pergunta em "prompt", 3 opções em "options", o índice da correta em "answer" (0 a 2) e a explicação em "explanation".
- "readAloud": um texto curto para ler em voz alta em "text", com marcações: "|" para pausa (separado por espaços), *palavra* para ênfase, e terminando com " ↘" (afirmação) ou " ↗" (pergunta); a instrução em "instruction".
Preencha com null os campos que o tipo não usa. Frases naturais do dia a dia, sem nomes de pessoas reais.`;

export const VARIANTS_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      type: S.enum(['fix', 'recognize', 'readAloud']),
      instruction: S.nstr(),
      sentence: S.nstr(),
      sample: S.nstr(),
      prompt: S.nstr(),
      options: S.narr(S.str()),
      answer: S.nint(),
      explanation: S.nstr(),
      text: S.nstr(),
    }),
  ),
});
