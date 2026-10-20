import type { Level } from '../curriculum';

/** Level 2 — clarity and firmness (docs/oratoria-trilha.md › Nível 2). */
export const LEVEL_2: Level = {
  id: 'n2',
  number: 2,
  title: 'Clareza e firmeza',
  units: [
    {
      id: 'u6',
      number: 6,
      title: 'Vícios de linguagem',
      track: 'E',
      summary: 'Perceber os próprios vícios e trocá-los por pausas.',
      skills: ['fillers', 'pauses'],
      lessons: [
        {
          id: 'u6-l1',
          title: 'Conheça os seus vícios',
          skills: ['fillers'],
          exercises: [
            {
              type: 'concept',
              title: 'Por que eles aparecem',
              body:
                'Vícios de linguagem preenchem o tempo em que o cérebro procura a próxima palavra. Os mais comuns em português: **“né”, “tipo”, “então”, “aí”, “assim”, “basicamente”, “na verdade”** e o “éé” arrastado.\n\nUm ou outro passa despercebido. Muitos, e o público começa a contar em vez de ouvir. O primeiro passo é saber **quais são os seus**: veja a lista na tela de resultado de cada fala.',
            },
            {
              type: 'recognize',
              prompt: 'Em qual frase “tipo” é um vício de linguagem?',
              options: ['Esse tipo de solo é bom para café.', 'Ele chegou, tipo, muito cansado.', 'Qual tipo de música você prefere?'],
              answer: 1,
              explanation: 'Na segunda, “tipo” não significa nada: só ocupa espaço. Nas outras é um substantivo com sentido (espécie, categoria).',
            },
            {
              type: 'fix',
              instruction: 'Tire os vícios, mantendo a informação.',
              sentence: 'Aí, basicamente, o projeto, né, atrasou tipo duas semanas, entendeu?',
              sample: 'O projeto atrasou duas semanas.',
              focus: 'fillers',
            },
            {
              type: 'shortTalk',
              instruction: 'Fale 1 minuto sobre uma série, livro ou filme recente. Preste atenção em quais vícios aparecem.',
              topic: { text: 'Uma série, livro ou filme recente' },
              seconds: 60,
              goals: [{ metric: 'fillersPerMinute', max: 3 }, { metric: 'duration', min: 45 }],
            },
          ],
        },
        {
          id: 'u6-l2',
          title: 'Saber o próximo passo',
          skills: ['fillers', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'O vício nasce da dúvida',
              body:
                'Quem sabe o que vai dizer em seguida não precisa de “éé”. Três técnicas:\n\n**1. Frases curtas:** cada ponto final é um lugar natural para respirar.\n**2. Roteiro de pontos:** saiba os 3 tópicos da fala; o vício aparece quando você se perde entre eles.\n**3. Pausa consciente:** sentiu o vício chegando? Feche a boca por um segundo.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia fazendo uma pausa real em cada marca, sem preencher com som nenhum.',
              text: 'São três pontos. | Primeiro, | o custo. | Segundo, | o prazo. | Terceiro, | a equipe. | Vamos a cada um ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Antes de gravar, pense em três pontos sobre o tema. Depois fale 90 segundos, um ponto de cada vez.',
              topic: { text: 'Três coisas que melhorariam o lugar onde você mora' },
              seconds: 90,
              goals: [{ metric: 'fillersPerMinute', max: 2.5 }, { metric: 'betweenIdeas', min: 3 }, { metric: 'duration', min: 60 }],
            },
          ],
        },
        {
          id: 'u6-l3',
          title: 'Os vícios disfarçados',
          skills: ['fillers'],
          exercises: [
            {
              type: 'concept',
              title: 'Conectivos que viraram muleta',
              body:
                '“Então”, “aí”, “bom” e “na verdade” são palavras legítimas, mas viram vício quando abrem **toda** frase. “Na verdade” sugere que o resto era mentira; “basicamente” encolhe o que vem depois.\n\nUse o conectivo quando ele liga ideias de verdade (“então” = consequência). Quando só ocupa o começo da frase, corte.',
            },
            {
              type: 'recognize',
              prompt: 'Qual “então” é legítimo?',
              options: ['Então, eu acordei cedo hoje.', 'Choveu muito; então, a estrada fechou.', 'Então, bom, vamos começar.'],
              answer: 1,
              explanation: 'Na segunda, “então” indica consequência: a chuva causou o fechamento. Nas outras, é só um jeito de começar a falar.',
            },
            {
              type: 'fix',
              instruction: 'Reescreva sem os conectivos de muleta.',
              sentence: 'Então, na verdade, o problema basicamente é que, aí, ninguém leu o contrato.',
              sample: 'O problema é que ninguém leu o contrato.',
              focus: 'fillers',
            },
            {
              type: 'shortTalk',
              instruction: 'Explique o assunto abaixo em 2 minutos, começando cada frase direto pelo conteúdo.',
              topic: { fromNotes: true, prompt: 'Explique em 2 minutos' },
              seconds: 120,
              goals: [{ metric: 'fillersPerMinute', max: 2 }, { metric: 'duration', min: 90 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u6-desafio',
        instruction: 'Fale 2 minutos sobre o assunto abaixo com no máximo 2 vícios por minuto e sem hesitações no meio das frases.',
        topic: { fromNotes: true, prompt: 'Explique sem vícios' },
        seconds: 120,
        speechType: 'explain',
        goals: [{ metric: 'fillersPerMinute', max: 2 }, { metric: 'hesitationsPerMinute', max: 1.5 }, { metric: 'duration', min: 90 }],
      },
    },
    {
      id: 'u7',
      number: 7,
      title: 'Dicção',
      track: 'E',
      summary: 'Pronunciar as sílabas finais, abrir a boca e não embolar as palavras.',
      skills: ['articulation'],
      lessons: [
        {
          id: 'u7-l1',
          title: 'Abrir a boca',
          skills: ['articulation'],
          exercises: [
            {
              type: 'concept',
              title: 'Palavras inteiras',
              body:
                'Boa dicção é pronunciar **cada sílaba**, principalmente as finais: o “s” do plural, o “r” do infinitivo, o “do” de “estudando”. Quem fala com a boca quase fechada “come” sílabas e obriga o público a adivinhar.\n\nExercício clássico: leia com um lápis atravessado entre os dentes por um minuto, depois tire o lápis. A boca se abre mais.',
              good: 'Nós vamos estudar os capítulos.',
              bad: 'Nóis vamo estudá os capítulo.',
            },
            { type: 'articulation', text: 'Os livros novos estavam nas estantes das salas.' },
            { type: 'articulation', text: 'Vamos trabalhar, estudar e descansar sem parar.' },
            {
              type: 'recognize',
              prompt: 'O app marcou um trecho como “pouco claro”. O que isso indica?',
              options: ['Que você falou alto demais', 'Que o reconhecimento de fala teve dificuldade: pode ser dicção, ruído ou um nome incomum', 'Que a frase estava errada'],
              answer: 1,
              explanation: 'A confiança do reconhecimento cai quando as palavras saem emboladas, mas também com ruído ou nomes próprios. É um indício para você ouvir com atenção.',
            },
          ],
        },
        {
          id: 'u7-l2',
          title: 'Trava-línguas',
          skills: ['articulation'],
          exercises: [
            {
              type: 'concept',
              title: 'Devagar primeiro',
              body: 'Trava-línguas treinam a coordenação de lábios e língua. A regra é: **primeiro devagar e perfeito, depois mais rápido**. Acelerar errando só treina o erro.',
            },
            { type: 'articulation', text: 'Três pratos de trigo para três tigres tristes.' },
            { type: 'articulation', text: 'O peito do pé de Pedro é preto.' },
            { type: 'articulation', text: 'Num ninho de mafagafos há sete mafagafinhos.' },
          ],
        },
        {
          id: 'u7-l3',
          title: 'Clareza no ritmo normal',
          skills: ['articulation', 'pace'],
          exercises: [
            {
              type: 'concept',
              title: 'Dicção sem exagero',
              body: 'O objetivo não é falar como locutor, e sim que **nenhuma palavra se perca**. Em ritmo de conversa, mantenha as sílabas finais e não engula os plurais.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia em ritmo de conversa, pronunciando os finais das palavras.',
              text: 'As pesquisas mostram que os estudantes que leem em voz alta | lembram mais dos textos | e falam com mais segurança ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Descreva o seu trabalho ou o seu curso em 1 minuto, com clareza em cada palavra.',
              topic: { text: 'O meu trabalho ou o meu curso' },
              seconds: 60,
              goals: [{ metric: 'unclearShare', max: 0.15 }, { metric: 'duration', min: 45 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u7-desafio',
        instruction: 'Explique o assunto abaixo em 90 segundos com dicção clara e ritmo de conversa.',
        topic: { fromNotes: true, prompt: 'Explique com clareza' },
        seconds: 90,
        speechType: 'explain',
        goals: [{ metric: 'unclearShare', max: 0.1 }, { metric: 'wpm', min: 120, max: 165 }, { metric: 'duration', min: 60 }],
      },
    },
    {
      id: 'u8',
      number: 8,
      title: 'Linguagem e voz firmes',
      track: 'E+C',
      summary: 'Cortar palavras fracas e terminar as afirmações com o tom descendo.',
      skills: ['weakWords', 'finalContour'],
      lessons: [
        {
          id: 'u8-l1',
          title: 'Palavras fracas',
          skills: ['weakWords'],
          exercises: [
            {
              type: 'concept',
              title: 'Atenuar demais é se desculpar',
              body:
                '“Acho que”, “talvez”, “meio que”, “um pouquinho”, “só queria dizer”, “não sei se ficou claro”: cada uma tira força do que você diz. Use quando a dúvida é real; corte quando é só proteção.\n\nCompare: “Acho que talvez seja um problema” × “É um problema”.',
            },
            {
              type: 'recognize',
              prompt: 'Qual frase soa mais segura?',
              options: ['Eu só queria falar um pouquinho sobre o orçamento, se der.', 'Vou falar sobre o orçamento.', 'Talvez fosse bom falar do orçamento, acho.'],
              answer: 1,
              explanation: 'A segunda afirma. As outras pedem licença para existir.',
            },
            {
              type: 'fix',
              instruction: 'Reescreva sem as palavras fracas.',
              sentence: 'Eu acho que talvez a gente devesse meio que rever o plano, não sei.',
              sample: 'Precisamos rever o plano.',
              focus: 'weakWords',
            },
            {
              type: 'fix',
              instruction: 'Reescreva de forma firme, mantendo a honestidade sobre o que você não sabe.',
              sentence: 'Não sei se estou certo, mas acho que os números talvez estejam meio errados.',
              sample: 'Os números estão errados em duas linhas; ainda não sei a causa.',
              focus: 'weakWords',
            },
          ],
        },
        {
          id: 'u8-l2',
          title: 'Afirmar descendo',
          skills: ['finalContour'],
          exercises: [
            {
              type: 'concept',
              title: 'O tom do final',
              body:
                'Em português, a **afirmação termina com o tom descendo**; a pergunta, subindo. Quando uma afirmação termina subindo, ela soa como pergunta: “o prazo é sexta↗?”. Parece que você pede aprovação.\n\nO app mede o tom no fim de cada frase e conta quantas afirmações subiram.',
            },
            { type: 'readAloud', instruction: 'Afirme, deixando o tom descer no fim.', text: 'O prazo é sexta-feira. ↘' },
            { type: 'readAloud', instruction: 'Agora pergunte, deixando o tom subir.', text: 'O prazo é sexta-feira? ↗' },
            { type: 'readAloud', instruction: 'Afirme cada frase com o tom descendo, e faça as pausas.', text: 'Nós revisamos os dados. | Os números fecham. | A proposta está pronta. ↘' },
          ],
        },
        {
          id: 'u8-l3',
          title: 'Firmeza na prática',
          skills: ['weakWords', 'finalContour'],
          exercises: [
            {
              type: 'shortTalk',
              instruction: 'Defenda em 1 minuto uma opinião que você tem certeza. Sem “acho que”, e com as afirmações descendo no fim.',
              topic: { text: 'Uma opinião da qual você tem certeza' },
              seconds: 60,
              speechType: 'persuasive',
              goals: [{ metric: 'weakPerMinute', max: 1 }, { metric: 'risingShare', max: 0.3 }, { metric: 'duration', min: 45 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u8-desafio',
        instruction: 'Em 90 segundos, convença alguém a ler um livro de que você gostou. Linguagem firme e afirmações descendo.',
        topic: { text: 'Por que você deveria ler este livro' },
        seconds: 90,
        speechType: 'persuasive',
        goals: [
          { metric: 'weakPerMinute', max: 1 },
          { metric: 'risingShare', max: 0.3 },
          { metric: 'criterion', id: 'centralIdea', atLeast: 'attention' },
          { metric: 'duration', min: 60 },
        ],
      },
    },
    {
      id: 'u9',
      number: 9,
      title: 'Aberturas e conclusões',
      track: 'C',
      summary: 'Abrir com pergunta, fato ou caso; fechar retomando a ideia central. Métodos SCQA e Pirâmide.',
      skills: ['openingClosing', 'structure'],
      lessons: [
        {
          id: 'u9-l1',
          title: 'Aberturas que prendem',
          skills: ['openingClosing'],
          exercises: [
            {
              type: 'concept',
              title: 'Os primeiros 15 segundos',
              body:
                'O público decide nos primeiros segundos se vai prestar atenção. Três aberturas que funcionam:\n\n**Pergunta:** “Quantas horas você passou no celular ontem?”\n**Fato surpreendente:** “O Brasil tem mais faculdades de Direito do que todos os outros países juntos.”\n**Caso:** “Em 2019, uma estudante de Recife…”\n\nE três que derrubam: pedir desculpas (“não sou bom nisso”), agradecer longamente, ler o título do slide.',
            },
            {
              type: 'recognize',
              prompt: 'Qual abertura funciona melhor para uma fala sobre sono?',
              options: ['Bom dia a todos, obrigado pela presença, hoje vou falar sobre sono.', 'Quem aqui dormiu oito horas esta noite? Pois é: quase ninguém.', 'Desculpem, não preparei muito, mas vou tentar falar sobre sono.'],
              answer: 1,
              explanation: 'A pergunta envolve o público e já mostra o problema. As outras gastam o momento de maior atenção.',
            },
            {
              type: 'recognize',
              prompt: 'Que tipo de abertura é esta: “Em 1854, um médico de Londres tirou a alavanca de uma bomba d’água e parou uma epidemia”?',
              options: ['Pergunta', 'Caso', 'Fato estatístico'],
              answer: 1,
              explanation: 'Um caso: uma pequena história concreta, com lugar, tempo e ação, que leva ao tema.',
            },
            {
              type: 'build',
              part: 'opening',
              instruction: 'Escreva uma abertura de até duas frases para uma fala sobre um assunto que você estuda. Use uma pergunta, um fato ou um caso.',
              example: 'Você sabia que, por três séculos, o açúcar valeu mais que o ouro? Foi por causa dele que o Brasil foi colonizado do jeito que foi.',
            },
          ],
        },
        {
          id: 'u9-l2',
          title: 'Conclusões que ficam',
          skills: ['openingClosing'],
          exercises: [
            {
              type: 'concept',
              title: 'Terminar, não acabar',
              body:
                'Uma boa conclusão faz três coisas: **retoma a ideia central**, **resume os pontos** em uma frase e **fecha com uma frase final** (ou um chamado à ação). Nada de informação nova no fim.\n\nA frase final deve ser dita devagar, com o tom descendo, seguida de silêncio. Não emende com “é isso”.',
            },
            {
              type: 'recognize',
              prompt: 'Qual é a melhor frase final?',
              options: ['Então é isso, alguma pergunta?', 'Dormir não é perder tempo: é o que faz o resto do tempo valer.', 'Ah, e também tem a questão da alimentação, mas fica para outro dia.'],
              answer: 1,
              explanation: 'Uma frase final curta, que retoma a ideia com força. A terceira abre um assunto novo justamente no fim.',
            },
            {
              type: 'build',
              part: 'conclusion',
              instruction: 'Escreva a conclusão de uma fala sobre um assunto seu: retome a ideia central e feche com uma frase de efeito.',
              example: 'Ou seja: a imprensa não espalhou só livros, espalhou dúvidas. E foram as dúvidas que mudaram a Europa.',
            },
          ],
        },
        {
          id: 'u9-l3',
          title: 'SCQA e Pirâmide',
          skills: ['structure', 'openingClosing'],
          exercises: [
            {
              type: 'concept',
              title: 'SCQA: Situação, Complicação, Questão, Resposta',
              body:
                'Para abrir um problema: comece pela **situação** que todos conhecem, mostre a **complicação** (o que mudou), formule a **questão** que isso levanta e dê a **resposta**, que é a sua ideia central.',
              good: 'Todo semestre, estudamos para as provas (S). Duas semanas depois, esquecemos quase tudo (C). Como reter o que estudamos (Q)? Revisando em intervalos crescentes (R).',
            },
            {
              type: 'concept',
              title: 'Pirâmide: a conclusão primeiro',
              body: 'Com público sem tempo (uma reunião, um chefe), comece pela **conclusão**, depois os **argumentos** que a sustentam e, só se pedirem, os **detalhes**. Quem precisa decidir quer saber o que você recomenda antes do porquê.',
            },
            {
              type: 'recognize',
              prompt: 'Você tem 1 minuto para informar a diretora que o projeto vai atrasar. Qual estrutura usar?',
              options: ['Contar a história do projeto desde o início', 'Pirâmide: “Vamos atrasar duas semanas. Os motivos são…”', 'Começar por uma pergunta retórica'],
              answer: 1,
              explanation: 'Com pouco tempo e uma decisão a tomar, a conclusão vem primeiro.',
            },
            {
              type: 'shortTalk',
              instruction: 'Use SCQA para apresentar um problema do seu dia a dia e a sua solução.',
              topic: { text: 'Um problema do dia a dia e a minha solução' },
              seconds: 90,
              method: 'scqa',
              goals: [{ metric: 'criterion', id: 'opening', atLeast: 'attention' }, { metric: 'criterion', id: 'conclusion', atLeast: 'attention' }, { metric: 'duration', min: 50 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u9-desafio',
        instruction: 'Apresente o assunto abaixo em 2 minutos com uma abertura que prenda e uma conclusão que retome a ideia central.',
        topic: { fromNotes: true, prompt: 'Apresente' },
        seconds: 120,
        speechType: 'explain',
        goals: [
          { metric: 'criterion', id: 'opening', atLeast: 'good' },
          { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
          { metric: 'duration', min: 90 },
        ],
      },
    },
    {
      id: 'u10',
      number: 10,
      title: 'Volume e entonação',
      track: 'E',
      summary: 'Variar o tom, dar ênfase à palavra certa e não deixar a voz cair no fim.',
      skills: ['pitchVariation', 'volume'],
      lessons: [
        {
          id: 'u10-l1',
          title: 'Fugir da monotonia',
          skills: ['pitchVariation'],
          exercises: [
            {
              type: 'concept',
              title: 'Voz que sobe e desce',
              body:
                'Uma voz monótona, com o tom sempre igual, faz até um bom conteúdo soar lido e cansativo. O app mede a **variação do tom**: abaixo de 0,16 a fala é considerada monótona.\n\nVariar não é cantar: é subir um pouco em perguntas e novidades, descer em conclusões, e destacar as palavras importantes.',
            },
            { type: 'readAloud', instruction: 'Leia com entusiasmo, como se contasse uma boa notícia.', text: 'Depois de três meses de trabalho, | o projeto foi *aprovado*! | E começa na *segunda-feira* ↘' },
            { type: 'readAloud', instruction: 'Leia variando o tom entre a pergunta e a resposta.', text: 'E qual foi o resultado? ↗' },
            { type: 'readAloud', instruction: 'Agora a resposta, firme, descendo.', text: 'O resultado foi o melhor da história da empresa. ↘' },
          ],
        },
        {
          id: 'u10-l2',
          title: 'A palavra certa',
          skills: ['pitchVariation'],
          exercises: [
            {
              type: 'concept',
              title: 'A ênfase muda o sentido',
              body: 'A mesma frase diz coisas diferentes conforme a palavra destacada. Ênfase = um pouco mais de volume, tom um pouco mais alto e, às vezes, uma pausa antes. Destaque **uma** palavra por frase: se tudo é importante, nada é.',
            },
            { type: 'readAloud', instruction: 'Destaque a palavra marcada.', text: '*Eu* não disse que ele roubou o dinheiro. ↘' },
            { type: 'readAloud', instruction: 'Agora destaque outra palavra: veja como o sentido muda.', text: 'Eu não disse que ele *roubou* o dinheiro. ↘' },
            { type: 'readAloud', instruction: 'E mais uma.', text: 'Eu não disse que ele roubou o *dinheiro*. ↘' },
          ],
        },
        {
          id: 'u10-l3',
          title: 'Até a última palavra',
          skills: ['volume', 'pitchVariation'],
          exercises: [
            {
              type: 'concept',
              title: 'Não deixe a voz morrer',
              body: 'Muita gente começa a frase com força e termina engolindo as últimas palavras, justamente onde costuma estar a informação nova. Respire antes da frase e **mantenha o volume até o ponto final**.',
            },
            {
              type: 'readAloud',
              instruction: 'Mantenha o volume até a última palavra de cada frase.',
              text: 'O aumento foi de quarenta por cento. | E o principal motivo foi a mudança de fornecedor ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte, em 1 minuto e com entusiasmo, uma conquista sua. Varie o tom e mantenha o volume até o fim das frases.',
              topic: { text: 'Uma conquista de que me orgulho' },
              seconds: 60,
              goals: [{ metric: 'pvq', min: 0.16 }, { metric: 'dropShare', max: 0.3 }, { metric: 'duration', min: 45 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u10-desafio',
        instruction: 'Conte em 90 segundos uma história ou notícia que empolgou você, com voz viva e sem engolir os finais.',
        topic: { text: 'Uma história que me empolgou' },
        seconds: 90,
        speechType: 'persuasive',
        goals: [{ metric: 'pvq', min: 0.16 }, { metric: 'dropShare', max: 0.25 }, { metric: 'duration', min: 60 }],
      },
    },
  ],
  challenge: {
    id: 'n2-desafio',
    instruction:
      'Desafio do nível 2: em 3 minutos, convença o público sobre o tema abaixo. Abertura que prenda, conclusão que fique, linguagem firme, poucos vícios e voz viva.',
    topic: { text: 'Todo estudante deveria aprender a falar em público' },
    seconds: 180,
    speechType: 'persuasive',
    goals: [
      { metric: 'fillersPerMinute', max: 2 },
      { metric: 'weakPerMinute', max: 1.5 },
      { metric: 'pvq', min: 0.15 },
      { metric: 'risingShare', max: 0.35 },
      { metric: 'criterion', id: 'opening', atLeast: 'attention' },
      { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
      { metric: 'duration', min: 120 },
    ],
  },
};
