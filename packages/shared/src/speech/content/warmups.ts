import type { Exercise } from '../curriculum';
import type { SkillId } from '../skills';

/**
 * Daily vocal warm-up (2 min): breathing, a tongue twister, a pitch phrase
 * and an emphasis phrase. Picked by the day, leaning on the weakest skills.
 */

export const TONGUE_TWISTERS = [
  'O rato roeu a roupa do rei de Roma.',
  'Três pratos de trigo para três tigres tristes.',
  'O peito do pé de Pedro é preto.',
  'A aranha arranha a rã. A rã arranha a aranha.',
  'Sabia que o sabiá sabia assobiar?',
  'Pedro pregou um prego na porta preta.',
  'Bagre branco, branco bagre.',
  'O tempo perguntou ao tempo quanto tempo o tempo tem.',
  'Num ninho de mafagafos há sete mafagafinhos.',
  'Paralelepípedo, paralelogramo, paralelismo.',
  'Fia, fio a fio, fino fio, frio a frio.',
  'A pia perto do pinto, o pinto perto da pia.',
  'Quem a paca cara compra, paca cara pagará.',
  'O doce perguntou pro doce qual é o doce mais doce.',
  'Trazei três pratos de trigo para três tigres tristes comerem.',
  'Larga a tia, lagartixa! Lagartixa, larga a tia!',
];

/** Sentences to read with the pitch going the marked way. */
export const PITCH_PHRASES = [
  'Você terminou o trabalho? ↗',
  'Eu terminei o trabalho. ↘',
  'Amanhã vai chover? ↗',
  'Amanhã vai chover. ↘',
  'Esse é o plano? ↗',
  'Esse é o plano. ↘',
  'Vamos começar agora? ↗',
  'Vamos começar agora. ↘',
  'Você leu o capítulo inteiro? ↗',
  'Eu li o capítulo inteiro. ↘',
];

/** The same sentence with a different stressed word changes the meaning. */
export const EMPHASIS_PHRASES = [
  '*Eu* não disse que ele roubou o dinheiro. ↘',
  'Eu não disse que ele *roubou* o dinheiro. ↘',
  'Eu não disse que *ele* roubou o dinheiro. ↘',
  'O problema não é o *preço*, | é o prazo. ↘',
  'Não é *o que* você diz, | é *como* você diz. ↘',
  'A reunião é *amanhã*, | não hoje. ↘',
  'Precisamos de *três* coisas: | tempo, | dinheiro | e coragem. ↘',
  'Isso não é um *gasto*. | É um *investimento*. ↘',
];

/** Deterministic pick for a calendar day (YYYY-MM-DD), so a warm-up stays the same all day. */
export function dayIndex(day: string, salt: number, size: number): number {
  let h = salt;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % size;
}

export function warmupFor(day: string, weakest: SkillId[] = []): Exercise[] {
  const pick = <T>(list: T[], salt: number) => list[dayIndex(day, salt, list.length)]!;
  const out: Exercise[] = [
    { type: 'breathing', instruction: 'Respire pela barriga: inspire pelo nariz, segure, e solte devagar com “sss”.', inhale: 4, hold: 2, exhale: 6, rounds: 2 },
    { type: 'articulation', text: pick(TONGUE_TWISTERS, 1) },
  ];
  // Pitch work first when the voice has been monotone or ending sentences rising.
  const pitchFirst = weakest.includes('pitchVariation') || weakest.includes('finalContour');
  const pitch: Exercise = { type: 'readAloud', instruction: 'Leia deixando o tom subir na pergunta e descer na afirmação.', text: pick(PITCH_PHRASES, 2) };
  const emphasis: Exercise = { type: 'readAloud', instruction: 'Destaque a palavra marcada com mais força e faça as pausas (|).', text: pick(EMPHASIS_PHRASES, 3) };
  out.push(...(pitchFirst ? [pitch, emphasis] : [emphasis, pitch]));
  if (weakest.includes('articulation')) out.push({ type: 'articulation', text: pick(TONGUE_TWISTERS, 4) });
  return out;
}
