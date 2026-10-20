/**
 * Structure methods (docs/oratoria-trilha.md › Biblioteca de métodos). Each
 * is taught in a unit and then offered as a template: the parts are shown
 * while the talk is prepared, and the model checks that each one appeared.
 */
export const METHOD_IDS = ['prep', 'scqa', 'pyramid', 'psb', 'aida', 'monroe', 'star'] as const;
export type MethodId = (typeof METHOD_IDS)[number];

export interface SpeechMethod {
  id: MethodId;
  name: string;
  parts: { name: string; hint: string }[];
  goodFor: string;
  /** Unit that teaches it. */
  unit: number;
  example: string;
}

export const SPEECH_METHODS: Record<MethodId, SpeechMethod> = {
  prep: {
    id: 'prep',
    name: 'PREP',
    parts: [
      { name: 'Ponto', hint: 'Diga logo o que você defende ou explica.' },
      { name: 'Razão', hint: 'Por que isso é verdade ou importa.' },
      { name: 'Exemplo', hint: 'Um caso concreto, um dado, uma imagem.' },
      { name: 'Ponto', hint: 'Repita o ponto, agora fortalecido.' },
    ],
    goodFor: 'Improviso, respostas curtas, dar uma opinião.',
    unit: 5,
    example:
      'Ler em voz alta melhora a fala (ponto). Quando você se ouve, percebe onde tropeça (razão). Eu cortei metade dos meus “né” em duas semanas lendo dez minutos por dia (exemplo). Por isso, ler em voz alta é o treino mais barato que existe (ponto).',
  },
  scqa: {
    id: 'scqa',
    name: 'SCQA',
    parts: [
      { name: 'Situação', hint: 'O cenário que todos reconhecem.' },
      { name: 'Complicação', hint: 'O que mudou ou deu errado.' },
      { name: 'Questão', hint: 'A pergunta que isso levanta.' },
      { name: 'Resposta', hint: 'A sua resposta: a ideia central.' },
    ],
    goodFor: 'Apresentações, relatórios, abrir um problema.',
    unit: 9,
    example:
      'Nossa equipe entrega um relatório por semana (situação). Ninguém lê até o fim (complicação). Como fazer a informação chegar (questão)? Com uma página de conclusões no topo e o detalhe em anexo (resposta).',
  },
  pyramid: {
    id: 'pyramid',
    name: 'Pirâmide',
    parts: [
      { name: 'Conclusão', hint: 'Comece pelo que você quer que fique.' },
      { name: 'Argumentos', hint: 'De 2 a 3 razões que sustentam a conclusão.' },
      { name: 'Detalhes', hint: 'Dados e exemplos de cada argumento.' },
    ],
    goodFor: 'Reuniões, público com pouco tempo.',
    unit: 9,
    example:
      'Devemos adiar o lançamento em um mês (conclusão). O teste mostrou falhas no pagamento, e o suporte não está treinado (argumentos). Em 300 compras de teste, 12 falharam (detalhe).',
  },
  psb: {
    id: 'psb',
    name: 'Problema → Solução → Benefício',
    parts: [
      { name: 'Problema', hint: 'O que está errado, de forma concreta.' },
      { name: 'Solução', hint: 'O que você propõe.' },
      { name: 'Benefício', hint: 'O que se ganha com isso.' },
    ],
    goodFor: 'Propostas, defesa de uma ideia.',
    unit: 11,
    example:
      'Metade dos alunos chega à prova sem ter lido os textos (problema). Proponho resumos de uma página feitos em dupla a cada aula (solução). Assim todos chegam com o essencial, e a discussão começa num patamar mais alto (benefício).',
  },
  aida: {
    id: 'aida',
    name: 'AIDA',
    parts: [
      { name: 'Atenção', hint: 'Uma pergunta, um dado ou uma cena que prende.' },
      { name: 'Interesse', hint: 'Por que isso diz respeito a quem ouve.' },
      { name: 'Desejo', hint: 'Como fica a vida com a mudança.' },
      { name: 'Ação', hint: 'O que você pede, concretamente.' },
    ],
    goodFor: 'Convencer a fazer algo, apresentar um projeto.',
    unit: 13,
    example:
      'Quantas horas você perdeu procurando arquivos este mês (atenção)? Cada uma delas saiu do seu tempo de estudo (interesse). Imagine abrir qualquer material em dois cliques (desejo). Reserve hoje uma hora para organizar suas pastas (ação).',
  },
  monroe: {
    id: 'monroe',
    name: 'Sequência de Monroe',
    parts: [
      { name: 'Atenção', hint: 'Desperte o interesse do público.' },
      { name: 'Necessidade', hint: 'Mostre o problema e quem ele atinge.' },
      { name: 'Satisfação', hint: 'Apresente a proposta que resolve.' },
      { name: 'Visualização', hint: 'Pinte o futuro com e sem a proposta.' },
      { name: 'Ação', hint: 'Diga o que cada um deve fazer agora.' },
    ],
    goodFor: 'Discurso persuasivo e político.',
    unit: 13,
    example:
      'Às seis da manhã, mil pessoas esperam o mesmo ônibus no nosso bairro (atenção). Muitas chegam atrasadas e perdem o emprego (necessidade). Uma linha expressa nos horários de pico resolve (satisfação). Com ela, são quarenta minutos a mais em casa por dia; sem ela, a fila só cresce (visualização). Assine o abaixo-assinado e venha à audiência de terça (ação).',
  },
  star: {
    id: 'star',
    name: 'STAR',
    parts: [
      { name: 'Situação', hint: 'Onde e quando aconteceu.' },
      { name: 'Tarefa', hint: 'O que precisava ser feito.' },
      { name: 'Ação', hint: 'O que você fez, em primeira pessoa.' },
      { name: 'Resultado', hint: 'O que mudou, de preferência com números.' },
    ],
    goodFor: 'Contar uma experiência, entrevistas.',
    unit: 14,
    example:
      'No meu estágio, o relatório mensal atrasava sempre (situação). Eu precisava entregá-lo no dia 5 (tarefa). Montei uma planilha que juntava os dados automaticamente (ação). O relatório passou a sair no dia 2, e virou padrão do setor (resultado).',
  },
};
