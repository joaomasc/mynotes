import type { Level } from '../curriculum';

/** Level 1 — fundamentals (docs/oratoria-trilha.md › Nível 1). */
export const LEVEL_1: Level = {
  id: 'n1',
  number: 1,
  title: 'Fundamentos',
  units: [
    {
      id: 'u1',
      number: 1,
      title: 'Primeira fala',
      track: 'E',
      summary: 'Conhecer o próprio ponto de partida: três falas curtas que viram a sua linha de base.',
      skills: ['pace', 'fillers', 'pauses'],
      lessons: [
        {
          id: 'u1-l1',
          title: 'Como o professor ouve você',
          skills: ['pace', 'fillers'],
          exercises: [
            {
              type: 'concept',
              title: 'Quatro coisas numa fala',
              body:
                'Toda fala é avaliada em quatro dimensões: **conteúdo e estrutura** (o que você diz e em que ordem), **linguagem** (como você formula), **voz** (ritmo, pausas, tom, volume, dicção) e **presença** (a impressão de quem ouve).\n\nO app mede a voz e a linguagem sozinho, sem custo. A IA lê a transcrição para julgar a estrutura e a clareza.',
            },
            {
              type: 'recognize',
              prompt: 'Qual destas coisas o app consegue medir sozinho, só pelo áudio e pela transcrição?',
              options: ['Se a sua conclusão retomou a ideia central', 'Quantos “né” você disse por minuto', 'Se o público ficou convencido'],
              answer: 1,
              explanation: 'Vícios de linguagem são contados na transcrição. Estrutura e conclusão precisam de alguém (a IA) que leia e entenda a fala.',
            },
            {
              type: 'concept',
              title: 'Gravar sempre do mesmo jeito',
              body:
                'O volume que o app mede é **relativo ao microfone**. Para comparar uma fala com a outra, grave sempre com o mesmo aparelho, à mesma distância (um palmo da boca é um bom padrão) e num lugar silencioso.',
              good: 'Celular apoiado na mesa, a um palmo, no mesmo cômodo de sempre.',
              bad: 'Um dia no fone de ouvido, outro dia com o celular no bolso.',
            },
            {
              type: 'shortTalk',
              instruction: 'Apresente-se em 1 minuto: quem você é, o que estuda e por que quer falar melhor. Não se preocupe com nada: esta é só a sua primeira medida.',
              topic: { text: 'Apresentação pessoal' },
              seconds: 60,
              goals: [{ metric: 'duration', min: 30 }],
            },
          ],
        },
        {
          id: 'u1-l2',
          title: 'Sua linha de base',
          skills: ['pace', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'Você contra você',
              body:
                'As faixas de referência (130 a 160 palavras por minuto, até 2 vícios por minuto…) são pontos de partida, não leis. O que mais importa é a **sua evolução**: estas falas iniciais são a régua com que as próximas serão comparadas.',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte algo que você aprendeu esta semana: o que era, como aprendeu e por que achou interessante.',
              topic: { text: 'Algo que aprendi esta semana' },
              seconds: 60,
              goals: [{ metric: 'duration', min: 30 }],
            },
            {
              type: 'recognize',
              prompt: 'Você gravou a primeira fala com 175 palavras por minuto. O que isso indica?',
              options: ['Que você fala devagar demais', 'Que você provavelmente acelera quando está nervoso', 'Que a fala foi ótima'],
              answer: 1,
              explanation: 'Acima de 160 palavras por minuto a fala costuma soar apressada. É comum acelerar diante do microfone: a unidade 2 trabalha isso.',
            },
          ],
        },
        {
          id: 'u1-l3',
          title: 'Explicar o que você estuda',
          skills: ['pace', 'fillers', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'Explicar é estudar duas vezes',
              body:
                'Quando você explica um assunto em voz alta, descobre o que realmente entendeu. Por isso o professor pode usar as **suas notas** como tema: o treino de oratória também revisa o conteúdo.',
            },
            {
              type: 'shortTalk',
              instruction: 'Explique, como se fosse para um colega, o assunto abaixo. Fale o que lembrar, sem ler.',
              topic: { fromNotes: true, prompt: 'Explique em 90 segundos' },
              seconds: 90,
              goals: [{ metric: 'duration', min: 45 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u1-desafio',
        instruction: 'Fale 1 minuto sobre um tema que você domina bem: um hobby, o seu trabalho, uma matéria preferida.',
        topic: { text: 'Um tema que eu domino' },
        seconds: 60,
        speechType: 'explain',
        goals: [{ metric: 'duration', min: 45 }],
      },
    },
    {
      id: 'u2',
      number: 2,
      title: 'Respiração e ritmo',
      track: 'E',
      summary: 'Respirar pelo diafragma, falar em ritmo de conversa calma e desacelerar no que importa.',
      skills: ['pace', 'volume'],
      lessons: [
        {
          id: 'u2-l1',
          title: 'Respirar para falar',
          skills: ['volume', 'pace'],
          exercises: [
            {
              type: 'concept',
              title: 'O fôlego vem da barriga',
              body:
                'Na respiração **diafragmática**, a barriga se expande ao inspirar e os ombros ficam parados. Ela dá mais ar e mais controle: a voz sai firme até o fim da frase, sem “morrer”.\n\nPara sentir: ponha uma mão na barriga e outra no peito. Só a de baixo deve se mexer.',
            },
            {
              type: 'breathing',
              instruction: 'Inspire pelo nariz enchendo a barriga, segure, e solte o ar devagar fazendo “sss”.',
              inhale: 4,
              hold: 4,
              exhale: 8,
              rounds: 3,
            },
            {
              type: 'recognize',
              prompt: 'No fim de uma frase longa, a sua voz costuma sumir. Qual a causa mais provável?',
              options: ['Falta de ar: a respiração está curta, no peito', 'O microfone está longe', 'A frase tem palavras difíceis'],
              answer: 0,
              explanation: 'Quando o ar acaba, a voz cai no fim da frase. Respirar pela barriga e pausar entre ideias resolve.',
            },
            {
              type: 'readAloud',
              instruction: 'Respire antes de começar e leia a frase inteira num fôlego só, mantendo o volume até a última palavra.',
              text: 'Quem respira bem antes de falar chega ao fim da frase com a mesma força com que começou ↘',
            },
          ],
        },
        {
          id: 'u2-l2',
          title: 'Ritmo de conversa',
          skills: ['pace'],
          exercises: [
            {
              type: 'concept',
              title: 'Nem corrida, nem arrasto',
              body:
                'Para explicar algo, o ritmo confortável fica entre **130 e 160 palavras por minuto**. Mais rápido, o público perde partes; mais devagar, a atenção se dispersa.\n\nO nervosismo acelera quase todo mundo. O antídoto é simples: frases curtas e pausas.',
            },
            {
              type: 'recognize',
              prompt: 'Qual destes trechos ajuda mais a desacelerar?',
              options: [
                'O mercantilismo que era a política econômica dos estados europeus que buscavam acumular metais preciosos através do comércio',
                'O mercantilismo era uma política econômica. Os estados queriam acumular metais preciosos. O caminho era o comércio.',
              ],
              answer: 1,
              explanation: 'Frases curtas criam pausas naturais no lugar dos pontos finais, e o ritmo cai sozinho.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia com calma, respeitando cada pausa marcada (|).',
              text: 'Falar bem não é falar rápido. | É dar tempo | para cada ideia chegar | a quem está ouvindo ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Descreva o caminho da sua casa até um lugar que você frequenta. Use frases curtas e mantenha um ritmo calmo.',
              topic: { text: 'O caminho até um lugar que frequento' },
              seconds: 60,
              goals: [{ metric: 'wpm', min: 115, max: 165 }, { metric: 'duration', min: 40 }],
            },
          ],
        },
        {
          id: 'u2-l3',
          title: 'Desacelerar no que importa',
          skills: ['pace', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'Mudar de velocidade',
              body:
                'Um ritmo bom não é constante: ele **desacelera** nas frases importantes (a ideia central, um número, a conclusão) e pode acelerar um pouco nos detalhes. Essa variação diz ao público o que guardar.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia a primeira parte normalmente e diminua a velocidade na frase final, com ênfase na palavra marcada.',
              text: 'Estudamos os dados de três anos, | comparamos com outras cidades | e chegamos a uma conclusão: | o problema é o *transporte* ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte uma notícia que chamou a sua atenção. Desacelere quando disser por que ela importa.',
              topic: { text: 'Uma notícia que chamou minha atenção' },
              seconds: 60,
              goals: [{ metric: 'wpm', min: 120, max: 165 }, { metric: 'duration', min: 40 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u2-desafio',
        instruction: 'Explique o assunto abaixo em 90 segundos, com ritmo calmo e frases curtas.',
        topic: { fromNotes: true, prompt: 'Explique com calma' },
        seconds: 90,
        speechType: 'explain',
        goals: [{ metric: 'wpm', min: 125, max: 165 }, { metric: 'avgSentenceWords', max: 25 }, { metric: 'duration', min: 60 }],
      },
    },
    {
      id: 'u3',
      number: 3,
      title: 'Pausas',
      track: 'E',
      summary: 'Pausar entre ideias e antes do que importa, e trocar o “éé” pelo silêncio.',
      skills: ['pauses', 'fillers'],
      lessons: [
        {
          id: 'u3-l1',
          title: 'A pausa entre ideias',
          skills: ['pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'O silêncio também fala',
              body:
                'A pausa é a pontuação da fala. Uma pausa curta (meio segundo a dois) **entre ideias** dá tempo ao público de entender e a você de respirar.\n\nPausa no **meio** da frase, ao contrário, soa como hesitação: parece que você esqueceu o que ia dizer.',
            },
            {
              type: 'recognize',
              prompt: 'Onde a pausa ajuda?',
              options: [
                'O comércio | colonial enriqueceu a metrópole.',
                'O comércio colonial enriqueceu a metrópole. | E empobreceu as colônias.',
                'O comércio colonial enriqueceu a | metrópole.',
              ],
              answer: 1,
              explanation: 'Entre duas ideias completas a pausa separa e destaca. No meio de uma ideia, ela quebra o sentido.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia respeitando as pausas marcadas (|). Conte mentalmente “um” em cada uma.',
              text: 'A primeira razão é o custo. | A segunda é o tempo. | E a terceira, | a mais importante, | é a *confiança* ↘',
            },
          ],
        },
        {
          id: 'u3-l2',
          title: 'Trocar o “éé” pelo silêncio',
          skills: ['fillers', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'O vício ocupa o silêncio',
              body:
                '“Éé”, “né”, “tipo”, “então” aparecem quando o cérebro procura a próxima palavra e a boca não quer ficar quieta. O truque é **aceitar o silêncio**: em vez de “éé”, feche a boca por um instante.\n\nPara quem ouve, uma pausa de um segundo soa como segurança; o “éé” soa como dúvida.',
            },
            {
              type: 'recognize',
              prompt: 'Qual versão soa mais segura?',
              options: ['Então, éé, o resultado foi, tipo, bom.', 'O resultado foi… bom.', 'Então o resultado, né, foi bom.'],
              answer: 1,
              explanation: 'A pausa no lugar do “éé” dá peso à palavra seguinte, sem enfeite.',
            },
            {
              type: 'fix',
              instruction: 'Reescreva tirando os vícios de linguagem, sem perder a ideia.',
              sentence: 'Então, tipo, a gente, né, precisa, éé, revisar o projeto até sexta, entendeu?',
              sample: 'Precisamos revisar o projeto até sexta.',
              focus: 'fillers',
            },
            {
              type: 'shortTalk',
              instruction: 'Fale 1 minuto sobre o seu dia de ontem. Toda vez que sentir vontade de dizer “éé” ou “né”, faça uma pausa.',
              topic: { text: 'Como foi o meu dia de ontem' },
              seconds: 60,
              goals: [{ metric: 'fillersPerMinute', max: 4 }, { metric: 'duration', min: 40 }],
            },
          ],
        },
        {
          id: 'u3-l3',
          title: 'A pausa de ênfase',
          skills: ['pauses', 'pitchVariation'],
          exercises: [
            {
              type: 'concept',
              title: 'Pausar antes do que importa',
              body:
                'Uma pausa logo **antes** de uma palavra importante cria expectativa; logo **depois**, dá tempo para ela ser absorvida. É o recurso mais simples para destacar uma ideia.',
              good: 'E o maior culpado foi… | o desperdício.',
              bad: 'E o maior culpado foi o desperdício.',
            },
            {
              type: 'readAloud',
              instruction: 'Faça a pausa marcada e diga a palavra destacada com mais força.',
              text: 'Depois de dez anos de pesquisa, | a resposta era uma só: | *paciência* ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte a melhor decisão que você já tomou. Faça uma pausa antes de dizer qual foi.',
              topic: { text: 'A melhor decisão que já tomei' },
              seconds: 60,
              goals: [{ metric: 'hesitationsPerMinute', max: 2 }, { metric: 'betweenIdeas', min: 3 }, { metric: 'duration', min: 40 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u3-desafio',
        instruction: 'Explique o assunto abaixo em 90 segundos usando pausas entre as ideias e nenhum “éé”.',
        topic: { fromNotes: true, prompt: 'Explique com pausas' },
        seconds: 90,
        speechType: 'explain',
        goals: [
          { metric: 'hesitationsPerMinute', max: 1.5 },
          { metric: 'blanks', max: 1 },
          { metric: 'betweenIdeas', min: 4 },
          { metric: 'fillersPerMinute', max: 3 },
          { metric: 'duration', min: 60 },
        ],
      },
    },
    {
      id: 'u4',
      number: 4,
      title: 'A ideia central',
      track: 'C',
      summary: 'Resumir o que você quer dizer em uma frase e saber o que o público deve lembrar.',
      skills: ['centralIdea'],
      lessons: [
        {
          id: 'u4-l1',
          title: 'O que deve ficar',
          skills: ['centralIdea'],
          exercises: [
            {
              type: 'concept',
              title: 'Uma frase só',
              body:
                'Antes de preparar qualquer fala, responda: **se o público lembrar de uma única frase, qual deve ser?** Essa é a ideia central. Ela cabe em uma frase, tem um verbo e diz algo que pode ser discutido.\n\nUm **tema** (“o mercantilismo”) não é uma ideia central; uma **afirmação** sobre ele é (“o mercantilismo explica por que Portugal colonizou o Brasil”).',
            },
            {
              type: 'recognize',
              prompt: 'Qual destas é uma ideia central, e não só um tema?',
              options: ['A Revolução Industrial', 'Os efeitos da Revolução Industrial no trabalho', 'A Revolução Industrial trocou o tempo da natureza pelo tempo do relógio'],
              answer: 2,
              explanation: 'Só a terceira afirma algo. As outras dizem do que você vai falar, não o que vai dizer.',
            },
            {
              type: 'recognize',
              prompt: 'Qual ideia central é mais clara?',
              options: [
                'Exercício físico, de modo geral, considerando vários fatores, tende a ser algo positivo para muitas pessoas',
                'Vinte minutos de caminhada por dia já melhoram o sono',
              ],
              answer: 1,
              explanation: 'Específica, concreta e verificável. A primeira se protege tanto que não diz nada.',
            },
            {
              type: 'fix',
              instruction: 'Transforme este tema numa ideia central: uma frase que afirme algo.',
              sentence: 'Hoje vou falar sobre a importância da leitura.',
              sample: 'Ler vinte páginas por dia vale mais do que um curso inteiro por ano.',
              focus: 'centralIdea',
            },
          ],
        },
        {
          id: 'u4-l2',
          title: 'Escrever a sua ideia central',
          skills: ['centralIdea'],
          exercises: [
            {
              type: 'build',
              part: 'centralIdea',
              instruction: 'Escolha um assunto que você estuda e escreva a ideia central de uma fala sobre ele: uma frase, até 20 palavras, que afirme algo.',
              example: 'A imprensa de Gutenberg tirou da Igreja o monopólio da leitura.',
            },
            {
              type: 'recognize',
              prompt: 'Onde a ideia central deve aparecer numa fala curta?',
              options: ['Só no fim, como surpresa', 'No começo e de novo no fim', 'Em nenhum lugar: o público deduz'],
              answer: 1,
              explanation: 'Dita no começo, ela orienta quem ouve; repetida no fim, ela fica.',
            },
          ],
        },
        {
          id: 'u4-l3',
          title: 'Falar a partir da ideia central',
          skills: ['centralIdea', 'structure'],
          exercises: [
            {
              type: 'shortTalk',
              instruction: 'Diga a sua ideia central sobre o assunto abaixo logo na primeira frase. Depois dê uma razão e termine repetindo a ideia.',
              topic: { fromNotes: true, prompt: 'Ideia central sobre' },
              seconds: 45,
              goals: [{ metric: 'criterion', id: 'centralIdea', atLeast: 'good' }, { metric: 'duration', min: 25 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u4-desafio',
        instruction: 'Em 1 minuto, defenda uma ideia central sobre o tema abaixo. A ideia deve aparecer no começo e no fim.',
        topic: { text: 'O celular deveria ser proibido na sala de aula?' },
        seconds: 60,
        speechType: 'persuasive',
        goals: [
          { metric: 'criterion', id: 'centralIdea', atLeast: 'good' },
          { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
          { metric: 'duration', min: 40 },
        ],
      },
    },
    {
      id: 'u5',
      number: 5,
      title: 'Estrutura em três partes',
      track: 'C',
      summary: 'Abertura, desenvolvimento e conclusão, e o primeiro método: PREP.',
      skills: ['structure', 'improvisation'],
      lessons: [
        {
          id: 'u5-l1',
          title: 'Começo, meio e fim',
          skills: ['structure'],
          exercises: [
            {
              type: 'concept',
              title: 'Três partes',
              body:
                'A **abertura** diz do que se trata e por que importa. O **desenvolvimento** traz de 2 a 4 pontos, cada um com explicação e exemplo. A **conclusão** retoma a ideia central e fecha com uma frase clara.\n\nO erro mais comum é a fala que “acaba” em vez de terminar: “é isso, acho que é só”.',
              good: 'Ou seja: quem controla o comércio controla a riqueza.',
              bad: 'Bom… acho que era isso.',
            },
            {
              type: 'recognize',
              prompt: 'Qual frase funciona melhor como conclusão?',
              options: ['Então é isso, pessoal.', 'Por isso, o mercantilismo explica a colonização: as colônias existiam para enriquecer a metrópole.', 'Também tem outros fatores, mas não dá tempo.'],
              answer: 1,
              explanation: 'Uma boa conclusão retoma a ideia central em uma frase. As outras só anunciam o fim, ou pior, abrem novos assuntos.',
            },
            {
              type: 'recognize',
              prompt: 'Qual destas aberturas prende mais a atenção?',
              options: ['Bom dia, meu nome é Ana e vou falar sobre água.', 'Você bebeu hoje um copo de água que já passou por um dinossauro.', 'Não sou especialista, mas vou tentar falar sobre água.'],
              answer: 1,
              explanation: 'Um fato surpreendente desperta curiosidade. Pedir desculpas na abertura tira a sua autoridade antes de começar.',
            },
          ],
        },
        {
          id: 'u5-l2',
          title: 'O método PREP',
          skills: ['structure', 'improvisation'],
          exercises: [
            {
              type: 'concept',
              title: 'PREP: Ponto, Razão, Exemplo, Ponto',
              body:
                'Para responder ou opinar de improviso: diga o **Ponto** (o que você defende), dê uma **Razão**, um **Exemplo** concreto, e volte ao **Ponto**. Cabe em 30 segundos e organiza qualquer resposta.',
              good: 'Devíamos ter aula de culinária na escola (ponto). Comer bem depende de saber cozinhar (razão). Minha avó nunca comprou comida pronta e viveu até os 98 (exemplo). Por isso, culinária devia ser matéria obrigatória (ponto).',
            },
            {
              type: 'recognize',
              prompt: '“Viajar sozinho ensina a resolver problemas.” Que parte do PREP é esta frase?',
              options: ['Ponto', 'Razão', 'Exemplo'],
              answer: 0,
              explanation: 'É a afirmação que vai ser defendida: o ponto. A razão diria por quê; o exemplo mostraria um caso.',
            },
            {
              type: 'build',
              part: 'structure',
              method: 'prep',
              instruction: 'Escreva uma resposta em PREP para a pergunta: “Vale a pena aprender um segundo idioma?” Uma frase para cada parte.',
              example: 'Vale (ponto). Um idioma abre o acesso a mais conhecimento (razão). Metade dos artigos da minha área só existe em inglês (exemplo). Por isso, vale cada hora de estudo (ponto).',
            },
          ],
        },
        {
          id: 'u5-l3',
          title: 'PREP de improviso',
          skills: ['structure', 'improvisation'],
          exercises: [
            {
              type: 'shortTalk',
              instruction: 'Responda de improviso usando PREP: “Qual é o melhor jeito de aprender algo novo?”',
              topic: { text: 'Qual é o melhor jeito de aprender algo novo?' },
              seconds: 60,
              method: 'prep',
              speechType: 'impromptu',
              goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'criterion', id: 'conclusion', atLeast: 'attention' }, { metric: 'duration', min: 30 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u5-desafio',
        instruction: 'Em 90 segundos, explique o assunto abaixo com começo, meio e fim: abertura que prenda, dois pontos com exemplo e conclusão que retome a ideia.',
        topic: { fromNotes: true, prompt: 'Explique com começo, meio e fim' },
        seconds: 90,
        speechType: 'explain',
        goals: [
          { metric: 'criterion', id: 'opening', atLeast: 'attention' },
          { metric: 'criterion', id: 'development', atLeast: 'attention' },
          { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
          { metric: 'duration', min: 60 },
        ],
      },
    },
  ],
  challenge: {
    id: 'n1-desafio',
    instruction: 'Desafio do nível 1: explique o assunto abaixo em 2 a 3 minutos. Ideia central clara, começo, meio e fim, ritmo calmo, pausas entre ideias e poucos vícios.',
    topic: { fromNotes: true, prompt: 'Desafio do nível 1' },
    seconds: 150,
    speechType: 'explain',
    goals: [
      { metric: 'wpm', min: 120, max: 170 },
      { metric: 'fillersPerMinute', max: 3 },
      { metric: 'hesitationsPerMinute', max: 2 },
      { metric: 'criterion', id: 'centralIdea', atLeast: 'attention' },
      { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
      { metric: 'duration', min: 100 },
    ],
  },
};
