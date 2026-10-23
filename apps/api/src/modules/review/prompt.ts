import { CARD_KIND_LABELS, type GeneratedKind } from '@mynotes/shared';
import { S } from '../assistant/tools/types';

/**
 * What the model reads in Revisar (docs/revisar.md › Onde a IA entra). The
 * reference is always the user's notes: questions must point to a passage
 * copied from them, and answers are corrected only against them.
 */

const KIND_RULES: Record<GeneratedKind, string> = {
  basic: '"basic": pergunta curta e precisa em "front" e a resposta em "back" (uma ideia por cartão; resposta de poucas palavras ou uma frase). "keyPoints": [].',
  cloze:
    '"cloze": em "front", uma frase da fonte (pode encurtar) com 1 ou 2 lacunas no formato {{c1::termo}} (c1, c2…), escondendo termos importantes, nunca palavras óbvias. "back": "". "keyPoints": [].',
  open: '"open": pergunta que pede uma resposta de 1 a 3 frases. "back": a resposta modelo. "keyPoints": de 2 a 4 pontos curtos que a resposta precisa ter.',
  essay:
    '"essay": pedido de dissertação ("Explique…", "Compare…", "Por que…", ou "Explique como para alguém que nunca estudou o assunto…"). "back": uma resposta modelo de um parágrafo. "keyPoints": de 3 a 6 pontos curtos.',
};

export function generateInstructions(kinds: GeneratedKind[], connections: boolean): string {
  return `Você cria perguntas de revisão para um estudante brasileiro a partir das notas DELE (as fontes N1, N2… e os conceitos C1, C2…).

Regras:
- Use SOMENTE o que está nas fontes. Não acrescente fatos, datas, nomes ou explicações que não estejam nelas.
- Cada item se baseia em UMA fonte: "source" é a referência (ex.: "N2") e "quote" é um trecho COPIADO LITERALMENTE dessa fonte (1 a 3 frases, até 300 caracteres) que contém a resposta. Não parafraseie o trecho.
- Tipos permitidos: ${kinds.map((k) => `"${k}" (${CARD_KIND_LABELS[k]})`).join(', ')}. Distribua os itens entre esses tipos e entre as fontes.
${kinds.map((k) => `- ${KIND_RULES[k]}`).join('\n')}
- Prefira o que vale a pena lembrar: conceitos, definições, causas e consequências, diferenças, etapas, exemplos. Nada de perguntas sobre a própria nota (“o que diz a nota?”) ou triviais.
- Não repita nem reformule as perguntas que já existem (listadas no fim).
${
  connections
    ? '- As ligações (L1, L2…) dizem como duas fontes se relacionam. Crie perguntas sobre a RELAÇÃO (a diferença, a dependência, o exemplo, a causa) que exijam as duas fontes; em "source", a fonte de onde veio o "quote"; "connection": true.\n'
    : '- "connection": false.\n'
}- Escreva em português do Brasil.`;
}

export const generateSchema = (kinds: GeneratedKind[]) =>
  S.obj({
    items: S.arr(
      S.obj({
        kind: S.enum(kinds),
        source: S.str('Referência da fonte, ex.: N1 ou C2'),
        front: S.str(),
        back: S.str(),
        keyPoints: S.arr(S.str()),
        quote: S.str('Trecho copiado literalmente da fonte'),
        connection: S.bool(),
      }),
    ),
  });

export const EVALUATE_INSTRUCTIONS = `Você corrige a resposta de um estudante brasileiro a uma pergunta de revisão, usando SOMENTE as notas dele como referência.

- Para cada ponto-chave, diga se a resposta o cobriu ("covered", mesmo com outras palavras), cobriu em parte ("partial", vago ou incompleto) ou não mencionou ("missing"). Em "evidence", cite o trecho da resposta que comprova; se faltou, diga em uma frase o que faltou.
- Se não houver pontos-chave, extraia de 2 a 5 da resposta modelo e do trecho da nota, e avalie esses.
- "errors": só afirmações da resposta que CONTRADIZEM as notas, com a correção tirada das notas. O que não está nas notas não é erro: ignore.
- "noteIssue": se você suspeitar que a própria nota tem um erro ou está incompleta, explique em uma frase (isso não conta contra o estudante). Senão, null.
- "modelAnswer": uma resposta ideal e curta, só com o que está nas notas.
- "feedback": duas ou três frases diretas e gentis, falando com o estudante (você): o que acertou e o que faltou.
- Não dê nota: o aplicativo calcula a nota pelos pontos.
- A resposta pode ter sido ditada: ignore erros de pontuação e de reconhecimento de fala.
- Escreva em português do Brasil.`;

export const EVALUATE_SCHEMA = S.obj({
  points: S.arr(S.obj({ point: S.str(), status: S.enum(['covered', 'partial', 'missing']), evidence: S.str() })),
  errors: S.arr(S.obj({ claim: S.str(), correction: S.str() })),
  noteIssue: S.nstr(),
  modelAnswer: S.str(),
  feedback: S.str(),
});

export const RECALL_INSTRUCTIONS = `Você compara o que um estudante brasileiro escreveu de memória sobre um assunto com as notas dele (fontes N1, N2…).

1. Leia as notas e escolha de 6 a 12 ideias principais, as que mais valem ser lembradas.
2. Para cada ideia: "idea" (uma frase curta); "status" em relação ao texto do estudante: "covered" (lembrou), "partial" (lembrou em parte) ou "missing" (não lembrou); "source", a referência da nota; "quote", um trecho COPIADO LITERALMENTE da nota que contém a ideia; "evidence", o trecho do estudante que a cobre (ou "" se faltou).
3. "errors": afirmações do estudante que CONTRADIZEM as notas, com a correção e a referência da nota em "source". O que ele escreveu e não está nas notas não é erro.
4. "summary": duas frases, falando com o estudante (você): o que lembra bem e o que precisa rever.
O texto pode ter sido ditado: ignore erros de pontuação e de reconhecimento de fala. Escreva em português do Brasil.`;

export const RECALL_SCHEMA = S.obj({
  ideas: S.arr(S.obj({ idea: S.str(), status: S.enum(['covered', 'partial', 'missing']), source: S.str(), quote: S.str(), evidence: S.str() })),
  errors: S.arr(S.obj({ claim: S.str(), correction: S.str(), source: S.str() })),
  summary: S.str(),
});

export const HELP_INSTRUCTIONS = `Um cartão de revisão está difícil de memorizar: o estudante já errou muitas vezes. Ajude a torná-lo fácil de lembrar.
- "diagnosis": em uma frase, por que provavelmente é difícil (informação demais, pergunta ambígua, parecido com outro, resposta longa…).
- "rewrite": uma versão mais clara e menor ("front" e "back"), ou null se já estiver boa.
- "split": se o cartão tiver mais de uma informação, de 2 a 4 cartões menores, uma ideia cada; senão, [].
- "mnemonic": um macete para lembrar a resposta (associação, acrônimo, imagem mental, rima), ou null.
Use só o conteúdo do cartão e da nota. Escreva em português do Brasil.`;

export const HELP_SCHEMA = S.obj({
  diagnosis: S.str(),
  // A nullable object in strict mode (as in create_note's `book`).
  rewrite: { anyOf: [S.obj({ front: S.str(), back: S.str() }), { type: 'null' }] },
  split: S.arr(S.obj({ front: S.str(), back: S.str() })),
  mnemonic: S.nstr(),
});

export const VARIANTS_INSTRUCTIONS = `Reescreva cada pergunta de revisão de outro jeito (outro ângulo, outras palavras, ou pedindo um exemplo ou uma aplicação), cobrando os MESMOS pontos-chave, para que o estudante não decore o texto da pergunta.
Não revele a resposta. Uma ou duas frases por pergunta. Mantenha o "id" de cada uma. Escreva em português do Brasil.`;

export const VARIANTS_SCHEMA = S.obj({ items: S.arr(S.obj({ id: S.str(), prompt: S.str() })) });
