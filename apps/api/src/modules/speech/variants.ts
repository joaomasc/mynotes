import { z } from 'zod';
import {
  SKILL_LABELS,
  SPEECH_PATH,
  parseReadText,
  uuidv7,
  zVariantExercise,
  type Exercise,
  type SkillId,
  type VariantExercise,
} from '@mynotes/shared';
import { all, parseJson, stmt } from '../../lib/db';
import { nowIso } from '../../lib/time';
import { aiConfig, costOf, requireReady } from '../assistant/config';
import { createResponse, outputText } from '../assistant/openai';
import { assertWithinBudget, usageStatement } from '../assistant/usage';
import { VARIANTS_INSTRUCTIONS, VARIANTS_SCHEMA } from './prompt';

/**
 * Extra exercises for reviews (docs/oratoria-trilha.md › De onde vem o
 * conteúdo): written by the model in batches of 6 per skill, kept, and served
 * once each, so reviews do not repeat and the cost does not grow with use.
 */

const SERVE = 3;
/** A new batch is written when fewer than this many are left unused. */
const REFILL_BELOW = 2;

/** What each skill practices, for the model. */
const SKILL_GUIDE: Record<SkillId, string> = {
  pace: 'ritmo de fala: frases curtas que ajudam a desacelerar (prefira "readAloud" com pausas)',
  pauses: 'pausas entre ideias e antes do que importa (prefira "readAloud" com "|")',
  pitchVariation: 'variação do tom e ênfase na palavra certa (prefira "readAloud" com *ênfase*)',
  finalContour: 'afirmações terminando com o tom descendo e perguntas subindo (prefira "readAloud" com ↘ e ↗)',
  volume: 'manter o volume até o fim da frase (prefira "readAloud")',
  articulation: 'dicção: frases com finais difíceis e sílabas que costumam ser engolidas ("readAloud")',
  fillers: 'vícios de linguagem: “né”, “tipo”, “então”, “aí”, “basicamente”, “na verdade” (prefira "fix" e "recognize")',
  weakWords: 'linguagem firme, sem “acho que”, “talvez”, “meio que”, “um pouquinho” (prefira "fix" e "recognize")',
  sentences: 'frases curtas e claras, uma ideia por frase (prefira "fix")',
  centralIdea: 'ideia central: uma frase que afirma algo, não só um tema ("recognize" e "fix")',
  structure: 'estrutura: abertura, desenvolvimento e conclusão; métodos como PREP e SCQA ("recognize")',
  openingClosing: 'aberturas que prendem e conclusões que retomam a ideia central ("recognize" e "fix")',
  argumentation: 'argumentos com afirmação, evidência e raciocínio; falácias ("recognize" e "fix")',
  persuasion: 'credibilidade, emoção e lógica; pedido de ação concreto ("recognize")',
  storytelling: 'histórias com situação, conflito, virada e lição; detalhes concretos ("recognize" e "fix")',
  rhetoric: 'regra de três, contraste, repetição, pergunta retórica, frase de efeito ("fix" e "readAloud")',
  improvisation: 'responder perguntas direto na primeira frase e admitir com firmeza o que não sabe ("fix" e "recognize")',
};

const zModelItems = z.object({
  items: z.array(
    z.object({
      type: z.enum(['fix', 'recognize', 'readAloud']),
      instruction: z.string().nullable(),
      sentence: z.string().nullable(),
      sample: z.string().nullable(),
      prompt: z.string().nullable(),
      options: z.array(z.string()).nullable(),
      answer: z.number().int().nullable(),
      explanation: z.string().nullable(),
      text: z.string().nullable(),
    }),
  ),
});

/** The model's items that are complete and valid, in the path's exercise shape. */
export function toVariants(raw: z.infer<typeof zModelItems>['items'], skill: SkillId): VariantExercise[] {
  const out: VariantExercise[] = [];
  for (const i of raw) {
    const candidate =
      i.type === 'fix'
        ? { type: 'fix', instruction: i.instruction, sentence: i.sentence, sample: i.sample, focus: skill }
        : i.type === 'recognize'
          ? { type: 'recognize', prompt: i.prompt, options: i.options, answer: i.answer, explanation: i.explanation }
          : { type: 'readAloud', instruction: i.instruction, text: i.text };
    const parsed = zVariantExercise.safeParse(candidate);
    if (!parsed.success) continue;
    const v = parsed.data;
    if (v.type === 'recognize' && v.answer >= v.options.length) continue;
    if (v.type === 'readAloud' && parseReadText(v.text).words.length < 3) continue;
    out.push(v);
  }
  return out;
}

/** Two exercises of the path for the skill, as examples of the expected style. */
function examples(skill: SkillId): Exercise[] {
  return SPEECH_PATH.flatMap((l) => l.units)
    .flatMap((u) => u.lessons)
    .filter((l) => l.skills.includes(skill))
    .flatMap((l) => l.exercises)
    .filter((e) => e.type === 'fix' || e.type === 'recognize' || e.type === 'readAloud')
    .slice(0, 2);
}

async function generate(env: Env, userId: string, skill: SkillId): Promise<number> {
  const cfg = requireReady(aiConfig(env));
  const today = nowIso().slice(0, 10);
  await assertWithinBudget(env.DB, userId, cfg, today);
  const message = `Habilidade: ${SKILL_LABELS[skill]} — ${SKILL_GUIDE[skill]}.\nExemplos do estilo (não repita):\n${JSON.stringify(examples(skill))}`;
  const res = await createResponse(cfg, {
    instructions: VARIANTS_INSTRUCTIONS,
    input: [{ role: 'user', content: message }],
    tools: [],
    toolChoice: 'none',
    textFormat: { name: 'exercise_variants', schema: VARIANTS_SCHEMA },
    maxOutputTokens: Math.max(cfg.maxOutputTokens, 3000),
  });
  await usageStatement(env.DB, userId, today, res.usage, costOf(res.usage, cfg.prices), 1).run();
  const parsed = res.status === 'completed' ? zModelItems.safeParse(parseJson(outputText(res.output), null)) : null;
  const items = parsed?.success ? toVariants(parsed.data.items, skill) : [];
  if (items.length === 0) {
    console.error(JSON.stringify({ level: 'error', msg: 'speech variants unusable', status: res.status }));
    return 0;
  }
  const now = nowIso();
  await env.DB.batch(
    items.map((v) => stmt(env.DB, 'INSERT INTO speech_exercise_variants (id, user_id, skill, content_json, used_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', uuidv7(), userId, skill, JSON.stringify(v), now)),
  );
  return items.length;
}

const unused = (db: D1Database, userId: string, skill: SkillId) =>
  all<{ id: string; content_json: string }>(
    db,
    'SELECT id, content_json FROM speech_exercise_variants WHERE user_id = ? AND skill = ? AND used_count = 0 ORDER BY created_at, rowid LIMIT ?',
    userId,
    skill,
    SERVE,
  );

/**
 * Up to 3 fresh exercises for a skill. Writes a new batch when the stock is
 * low and the AI is available; without it, serves what is left (maybe none).
 */
export async function serveVariants(env: Env, userId: string, skill: SkillId): Promise<VariantExercise[]> {
  const db = env.DB;
  let rows = await unused(db, userId, skill);
  if (rows.length < REFILL_BELOW) {
    const cfg = aiConfig(env);
    if (cfg.enabled && cfg.apiKey) {
      try {
        if ((await generate(env, userId, skill)) > 0) rows = await unused(db, userId, skill);
      } catch (err) {
        // Over budget or OpenAI down: reviews go on with the path's own exercises.
        console.error(JSON.stringify({ level: 'error', msg: 'speech variants not generated', error: String(err).slice(0, 200) }));
      }
    }
  }
  if (rows.length === 0) return [];
  await db.batch(rows.map((r) => stmt(db, 'UPDATE speech_exercise_variants SET used_count = used_count + 1 WHERE id = ?', r.id)));
  return rows.flatMap((r) => {
    const parsed = zVariantExercise.safeParse(parseJson(r.content_json, null));
    return parsed.success ? [parsed.data] : [];
  });
}
