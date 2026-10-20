import { normalizeSearch } from '../text';

/**
 * Words the speaking coach looks for in a transcript (Brazilian Portuguese).
 * Phrases are written normalized: lowercase, without accents.
 */

/** Always fillers, wherever they appear. */
export const FILLER_PHRASES = ['ne', 'basicamente', 'enfim', 'tipo assim', 'na verdade'];

/** Fillers only at the start of a sentence followed by a comma or a pause (“Então, …”, “Aí, …”). */
export const FILLER_OPENERS = ['entao', 'ai', 'bom', 'olha'];

/** Fillers when used as a question tag at the end of a sentence (“…, sabe?”). */
export const FILLER_TAGS = ['sabe', 'entendeu', 'certo', 'ok', 'ne'];

/** Hedges that make a statement sound unsure. */
export const WEAK_PHRASES = [
  'eu acho que',
  'acho que',
  'eu acho',
  'talvez',
  'meio que',
  'um pouquinho',
  'pouquinho',
  'um pouco',
  'so queria',
  'nao sei se',
  'sei la',
  'mais ou menos',
  'de certa forma',
  'digamos',
  'realmente',
  'super',
];

/** Words before “tipo” that make it a noun (“o tipo de…”), not a filler. */
const TIPO_DETERMINERS = new Set(['o', 'um', 'esse', 'este', 'aquele', 'outro', 'mesmo', 'qual', 'cada', 'que', 'novo', 'certo', 'seu', 'meu']);
const TIPO_FOLLOWERS = new Set(['de', 'da', 'do', 'das', 'dos']);

/** Common words that never count as repetition. */
export const STOPWORDS = new Set(
  (
    'a o e de da do das dos que em um uma uns umas para pra pro com nao os as se na no nas nos por mais mas como foi ao aos ' +
    'ele ela eles elas isso isto esse essa este esta esses essas estes estas aquilo aquele aquela ser ter tem tinha era sao ' +
    'estao esta estava ja tambem muito muita muitos muitas quando entao sobre ou seu sua seus suas eu voce voces nos me te ' +
    'lhe porque aqui la ai so ainda entre depois antes sem mesmo ate tudo todo toda todos todas cada onde qual quais quem vai ' +
    'vou pode podem fazer faz fez sido sendo assim bem coisa coisas gente agora hoje outro outra outros outras dele dela ' +
    'deles delas pelo pela pelos pelas num numa essa disso desse dessa nesse nessa neste nesta isso tipo vez vezes'
  ).split(' '),
);

/** A transcript word reduced to letters and digits, lowercase, without accents. */
export function normalizeToken(raw: string): string {
  return normalizeSearch(raw).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** “é…”, “éé”, “hum”, “ahn”: vocal hesitations. Checked on the raw word, before accents are removed (“é” is also a verb). */
export function isVocalHesitation(raw: string): boolean {
  const word = raw.trim().toLowerCase();
  if (/^(é|e)(\.\.\.|…)/u.test(word)) return true;
  const bare = word.replace(/[\s,.;:!?…"'()]+/gu, '');
  return /^(éé+|ee+|eh+|hã+|ãh+|ahn+|ah+|hum+|hm+|uhm+|uh+|mm+)$/u.test(bare);
}

/** “tipo” as a filler (“é, tipo, muito grande”) rather than a noun (“esse tipo de coisa”). */
export function isTipoFiller(prev: string | undefined, next: string | undefined): boolean {
  return !(prev && TIPO_DETERMINERS.has(prev)) && !(next && TIPO_FOLLOWERS.has(next));
}

/** Phrases as token lists, longest first, so “eu acho que” wins over “acho que”. */
export function phraseTokens(phrases: readonly string[]): string[][] {
  return phrases.map((p) => p.split(' ')).sort((a, b) => b.length - a.length);
}
