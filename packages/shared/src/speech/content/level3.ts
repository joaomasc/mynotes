import type { Level } from '../curriculum';

/** Level 3 — arguing and persuading (docs/oratoria-trilha.md › Nível 3). */
export const LEVEL_3: Level = {
  id: 'n3',
  number: 3,
  title: 'Argumentar e persuadir',
  units: [
    {
      id: 'u11',
      number: 11,
      title: 'Argumentar',
      track: 'C',
      summary: 'Afirmação, evidência e raciocínio; responder a uma objeção; o método Problema → Solução → Benefício.',
      skills: ['argumentation', 'structure'],
      lessons: [
        {
          id: 'u11-l1',
          title: 'Afirmação, evidência, raciocínio',
          skills: ['argumentation'],
          exercises: [
            {
              type: 'concept',
              title: 'As três peças de um argumento',
              body:
                'Um argumento completo tem: a **afirmação** (o que você defende), a **evidência** (dado, exemplo, fonte) e o **raciocínio** (por que a evidência sustenta a afirmação).\n\nSem evidência, é opinião. Sem raciocínio, o público não vê a ligação.',
              good: 'A cidade deve ampliar as ciclovias (afirmação). Onde elas foram criadas, os acidentes com ciclistas caíram 40% (evidência). Ou seja, proteger quem pedala salva vidas (raciocínio).',
            },
            {
              type: 'recognize',
              prompt: '“Em 2023, as escolas que adotaram aulas de 50 minutos tiveram notas 12% maiores.” Que peça do argumento é esta?',
              options: ['Afirmação', 'Evidência', 'Raciocínio'],
              answer: 1,
              explanation: 'É um dado verificável: a evidência. A afirmação seria “aulas mais curtas funcionam melhor”.',
            },
            {
              type: 'recognize',
              prompt: 'Qual destes é só opinião, sem evidência?',
              options: ['Ler antes de dormir melhora o sono, segundo um estudo com 2 mil pessoas.', 'Ler antes de dormir é o melhor hábito que existe.', 'Quem lia 30 minutos antes de deitar dormiu, em média, 20 minutos a mais.'],
              answer: 1,
              explanation: 'A segunda afirma sem mostrar nada que a sustente.',
            },
            {
              type: 'build',
              part: 'argument',
              instruction: 'Escreva um argumento completo (afirmação, evidência, raciocínio) sobre um tema que você estuda.',
              example: 'O comércio de especiarias moldou as grandes navegações. Portugal chegou à Índia em 1498 buscando pimenta e canela. Quem controlava as rotas controlava a riqueza, por isso os reinos arriscaram tanto no mar.',
            },
          ],
        },
        {
          id: 'u11-l2',
          title: 'Responder à objeção',
          skills: ['argumentation'],
          exercises: [
            {
              type: 'concept',
              title: 'Antecipe o “mas…”',
              body:
                'Todo público tem uma objeção na cabeça. Quem a menciona primeiro ganha credibilidade: “Você pode pensar que custa caro. Mas…”. Reconheça o que a objeção tem de verdade e mostre por que, mesmo assim, a sua posição se sustenta.',
            },
            {
              type: 'recognize',
              prompt: 'Qual é a melhor forma de lidar com a objeção “isso vai custar caro”?',
              options: ['Ignorar: falar de custo enfraquece a proposta.', '“Custa, sim: 20 mil por ano. Mas economiza 60 mil em retrabalho.”', '“Quem pensa assim não entendeu a proposta.”'],
              answer: 1,
              explanation: 'Reconhecer e responder com dados. A terceira ataca a pessoa em vez da objeção.',
            },
            {
              type: 'build',
              part: 'argument',
              instruction: 'Escolha uma posição sua, escreva a objeção mais forte contra ela e a sua resposta.',
              example: 'Defendo a semana de quatro dias. A objeção é que a produtividade cairia. Mas os testes no Reino Unido mostraram produtividade igual ou maior, com menos faltas.',
            },
          ],
        },
        {
          id: 'u11-l3',
          title: 'Problema → Solução → Benefício',
          skills: ['argumentation', 'structure'],
          exercises: [
            {
              type: 'concept',
              title: 'Para propor algo',
              body: 'Mostre o **problema** de forma concreta, apresente a **solução** e termine com o **benefício**: o que melhora para quem ouve. É a estrutura das boas propostas.',
            },
            {
              type: 'recognize',
              prompt: '“Assim, cada aluno ganha duas horas por semana para estudar.” Que parte é esta?',
              options: ['Problema', 'Solução', 'Benefício'],
              answer: 2,
              explanation: 'É o ganho concreto para quem ouve: o benefício.',
            },
            {
              type: 'shortTalk',
              instruction: 'Proponha uma mudança no seu bairro, trabalho ou escola usando Problema → Solução → Benefício.',
              topic: { text: 'Uma mudança que eu proporia' },
              seconds: 90,
              method: 'psb',
              speechType: 'persuasive',
              goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'duration', min: 60 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u11-desafio',
        instruction: 'Em 2 minutos, defenda uma proposta com evidências e responda à principal objeção contra ela.',
        topic: { text: 'Uma proposta que eu defendo' },
        seconds: 120,
        speechType: 'persuasive',
        method: 'psb',
        goals: [
          { metric: 'criterion', id: 'development', atLeast: 'good' },
          { metric: 'criterion', id: 'centralIdea', atLeast: 'attention' },
          { metric: 'duration', min: 90 },
        ],
      },
    },
    {
      id: 'u12',
      number: 12,
      title: 'Argumentar com honestidade',
      track: 'C',
      summary: 'Reconhecer falácias para não cometê-las e para saber respondê-las.',
      skills: ['argumentation'],
      lessons: [
        {
          id: 'u12-l1',
          title: 'Atacar a pessoa e o espantalho',
          skills: ['argumentation'],
          exercises: [
            {
              type: 'concept',
              title: 'Duas falácias comuns',
              body:
                '**Ataque à pessoa (ad hominem):** desqualificar quem fala em vez do que foi dito. “Você nem é formado, o que sabe disso?”\n\n**Espantalho:** distorcer a posição do outro para atacar uma versão mais fraca. “Ele quer reduzir as aulas, ou seja, quer que ninguém aprenda.”\n\nAs duas podem ganhar aplausos, mas perdem a confiança de quem pensa.',
            },
            {
              type: 'recognize',
              prompt: '“O vereador quer fiscalizar os ônibus? Logo ele, que chega atrasado às sessões!” Que falácia é esta?',
              options: ['Espantalho', 'Ataque à pessoa', 'Falso dilema'],
              answer: 1,
              explanation: 'A crítica é ao vereador, não à proposta de fiscalização.',
            },
            {
              type: 'recognize',
              prompt: '“Ela defende ensino à distância, então ela quer fechar todas as escolas.” Que falácia é esta?',
              options: ['Espantalho', 'Apelo ao medo', 'Generalização apressada'],
              answer: 0,
              explanation: 'A posição dela foi distorcida para uma versão extrema, mais fácil de atacar.',
            },
          ],
        },
        {
          id: 'u12-l2',
          title: 'Falso dilema, medo e generalização',
          skills: ['argumentation'],
          exercises: [
            {
              type: 'concept',
              title: 'Mais três',
              body:
                '**Falso dilema:** apresentar só duas opções quando há outras. “Ou cortamos salários ou a empresa fecha.”\n\n**Apelo ao medo:** convencer pelo susto, não pela evidência. “Se não aprovarem, vai ser o caos.”\n\n**Generalização apressada:** tirar uma regra de poucos casos. “Meu primo largou a faculdade e ficou rico; faculdade não serve para nada.”',
            },
            {
              type: 'recognize',
              prompt: '“Ou você apoia o projeto inteiro, ou é contra o progresso.” Que falácia é esta?',
              options: ['Falso dilema', 'Ataque à pessoa', 'Generalização apressada'],
              answer: 0,
              explanation: 'Há outras posições: apoiar em parte, propor mudanças, pedir mais dados.',
            },
            {
              type: 'recognize',
              prompt: '“Dois alunos colaram na prova on-line; prova on-line não funciona.” Que falácia é esta?',
              options: ['Apelo ao medo', 'Generalização apressada', 'Espantalho'],
              answer: 1,
              explanation: 'Dois casos não bastam para uma conclusão sobre todas as provas on-line.',
            },
          ],
        },
        {
          id: 'u12-l3',
          title: 'Responder com honestidade',
          skills: ['argumentation'],
          exercises: [
            {
              type: 'fix',
              instruction: 'Reescreva o argumento sem a falácia, mantendo a posição.',
              sentence: 'Quem é contra a reforma é porque não quer trabalhar.',
              sample: 'Sou a favor da reforma porque ela reduz a burocracia em 30%; entendo a preocupação com prazos, e ela tem uma transição de dois anos.',
              focus: 'argumentation',
            },
            {
              type: 'fix',
              instruction: 'Reescreva sem o falso dilema.',
              sentence: 'Ou a gente proíbe o celular na escola, ou os alunos nunca mais vão aprender nada.',
              sample: 'O celular atrapalha a atenção nas aulas; limitar o uso em sala, com exceções para atividades, ajudaria.',
              focus: 'argumentation',
            },
            {
              type: 'shortTalk',
              instruction: 'Alguém disse: “Ler livro é perda de tempo, hoje tudo está na internet”. Responda em 1 minuto, sem atacar a pessoa e reconhecendo o que há de verdade na frase.',
              topic: { text: 'Ler livro é perda de tempo, hoje tudo está na internet' },
              seconds: 60,
              speechType: 'persuasive',
              goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'duration', min: 40 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u12-desafio',
        instruction: 'Responda em 90 segundos a esta provocação, com argumentos e sem falácias: “Quem estuda humanas não serve para o mercado”.',
        topic: { text: 'Quem estuda humanas não serve para o mercado' },
        seconds: 90,
        speechType: 'persuasive',
        goals: [{ metric: 'criterion', id: 'development', atLeast: 'good' }, { metric: 'weakPerMinute', max: 1.5 }, { metric: 'duration', min: 60 }],
      },
    },
    {
      id: 'u13',
      number: 13,
      title: 'Credibilidade, emoção e lógica',
      track: 'C',
      summary: 'Os três apoios da persuasão (ethos, pathos, logos) e os métodos AIDA e Sequência de Monroe.',
      skills: ['persuasion'],
      lessons: [
        {
          id: 'u13-l1',
          title: 'Ethos, pathos, logos',
          skills: ['persuasion'],
          exercises: [
            {
              type: 'concept',
              title: 'Os três apoios de Aristóteles',
              body:
                '**Ethos (credibilidade):** por que confiar em você? Experiência, honestidade, conhecimento do assunto.\n**Pathos (emoção):** por que o público deve se importar? Histórias, imagens, valores.\n**Logos (lógica):** por que é verdade? Dados, exemplos, raciocínio.\n\nSó lógica cansa; só emoção manipula; só credibilidade é vaidade. A persuasão honesta equilibra os três.',
            },
            {
              type: 'recognize',
              prompt: '“Trabalhei dez anos como enfermeira em UTI.” Que apoio é este?',
              options: ['Ethos', 'Pathos', 'Logos'],
              answer: 0,
              explanation: 'Mostra por que a pessoa tem autoridade para falar: credibilidade.',
            },
            {
              type: 'recognize',
              prompt: '“Imagine a sua mãe esperando seis horas num corredor de hospital.” Que apoio é este?',
              options: ['Ethos', 'Pathos', 'Logos'],
              answer: 1,
              explanation: 'Uma imagem que desperta emoção e faz o público se importar.',
            },
            {
              type: 'recognize',
              prompt: '“O tempo médio de espera subiu de 2 para 6 horas em três anos.” Que apoio é este?',
              options: ['Ethos', 'Pathos', 'Logos'],
              answer: 2,
              explanation: 'Um dado: lógica.',
            },
          ],
        },
        {
          id: 'u13-l2',
          title: 'AIDA',
          skills: ['persuasion', 'structure'],
          exercises: [
            {
              type: 'concept',
              title: 'Atenção, Interesse, Desejo, Ação',
              body: 'Para levar alguém a agir: capture a **atenção**, mostre por que o assunto **interessa** a quem ouve, faça **desejar** a mudança e peça uma **ação** concreta. Sem o pedido final, a fala inspira e nada acontece.',
            },
            {
              type: 'recognize',
              prompt: 'Qual destas é uma boa “Ação” no final de uma fala sobre doação de sangue?',
              options: ['Pensem nisso.', 'Doar sangue é importante.', 'O posto da rua 7 abre amanhã às 8h: vamos em grupo, saindo daqui às 7h30.'],
              answer: 2,
              explanation: 'Concreta: o quê, onde, quando e como. As outras não pedem nada.',
            },
            {
              type: 'build',
              part: 'structure',
              method: 'aida',
              instruction: 'Escreva uma fala curta em AIDA convidando colegas para um grupo de estudos. Uma ou duas frases por parte.',
              example: 'Quantas vezes você estudou sozinho e travou no mesmo exercício (atenção)? Em grupo, quem entende explica, e quem explica fixa (interesse). Imagine chegar à prova tendo resolvido tudo em conjunto (desejo). Quinta, às 18h, na biblioteca: traga a lista 3 (ação).',
            },
          ],
        },
        {
          id: 'u13-l3',
          title: 'Sequência de Monroe',
          skills: ['persuasion', 'structure'],
          exercises: [
            {
              type: 'concept',
              title: 'O roteiro clássico do discurso persuasivo',
              body:
                '**Atenção** (desperte o interesse), **Necessidade** (mostre o problema e quem ele atinge), **Satisfação** (a proposta que resolve), **Visualização** (o futuro com e sem a proposta) e **Ação** (o que cada um deve fazer). É a estrutura de muitos discursos políticos e campanhas.',
            },
            {
              type: 'build',
              part: 'structure',
              method: 'monroe',
              instruction: 'Escreva um discurso curto em Sequência de Monroe defendendo uma causa sua. Uma ou duas frases por parte.',
              example: 'Ontem, mais um ciclista foi atropelado na avenida (atenção). Sem ciclovia, quem pedala divide a pista com ônibus (necessidade). Uma faixa protegida de 3 km resolve o trecho mais perigoso (satisfação). Com ela, pais deixariam os filhos irem de bicicleta à escola; sem ela, contaremos mais vítimas (visualização). Assine a petição e venha à audiência de terça (ação).',
            },
            {
              type: 'shortTalk',
              instruction: 'Faça um discurso de 2 minutos em Sequência de Monroe sobre uma causa que você defende.',
              topic: { text: 'Uma causa que eu defendo' },
              seconds: 120,
              method: 'monroe',
              speechType: 'persuasive',
              goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'criterion', id: 'conclusion', atLeast: 'attention' }, { metric: 'duration', min: 80 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u13-desafio',
        instruction: 'Discurso persuasivo de 2 a 3 minutos sobre o tema abaixo, equilibrando credibilidade, emoção e lógica, e terminando com um pedido de ação.',
        topic: { text: 'A sua cidade deveria investir mais em transporte público' },
        seconds: 150,
        speechType: 'persuasive',
        method: 'monroe',
        goals: [
          { metric: 'criterion', id: 'development', atLeast: 'good' },
          { metric: 'criterion', id: 'conclusion', atLeast: 'good' },
          { metric: 'pvq', min: 0.15 },
          { metric: 'duration', min: 100 },
        ],
      },
    },
    {
      id: 'u14',
      number: 14,
      title: 'Contar histórias',
      track: 'E+C',
      summary: 'Situação, conflito, virada e lição; o método STAR; a voz a serviço da história.',
      skills: ['storytelling', 'pitchVariation'],
      lessons: [
        {
          id: 'u14-l1',
          title: 'A forma de uma história',
          skills: ['storytelling'],
          exercises: [
            {
              type: 'concept',
              title: 'Situação, conflito, virada, lição',
              body:
                'Histórias prendem porque o cérebro quer saber o que acontece. A forma mínima: uma **situação** (quem, onde), um **conflito** (o que deu errado), uma **virada** (a decisão, a descoberta) e a **lição** (o que isso tem a ver com a sua ideia).\n\nDetalhes concretos (um nome, um horário, uma cor) tornam a história real.',
            },
            {
              type: 'recognize',
              prompt: 'Qual frase tem o detalhe concreto que dá vida à história?',
              options: ['Um dia eu estava em um lugar e aconteceu uma coisa.', 'Às 6h de uma segunda-feira, no ponto de ônibus da Rua Bahia, o meu celular tocou.', 'Certa vez, alguém me falou algo importante.'],
              answer: 1,
              explanation: 'Hora, dia e lugar: o público vê a cena.',
            },
            {
              type: 'build',
              part: 'story',
              instruction: 'Escreva uma história curta (4 a 6 frases) com situação, conflito, virada e lição sobre algo que aconteceu com você.',
              example: 'No meu primeiro estágio, apresentei um relatório para vinte pessoas (situação). No terceiro slide, o projetor desligou (conflito). Fechei o notebook e contei os números de cabeça, olhando para as pessoas (virada). Foi a apresentação mais elogiada do mês: ninguém lembrava dos slides, todos lembravam da conversa (lição).',
            },
          ],
        },
        {
          id: 'u14-l2',
          title: 'STAR',
          skills: ['storytelling', 'structure'],
          exercises: [
            {
              type: 'concept',
              title: 'Situação, Tarefa, Ação, Resultado',
              body: 'Para contar uma experiência sua (numa entrevista, num relatório): a **situação**, a **tarefa** que você tinha, a **ação** que você tomou (em primeira pessoa: “eu fiz”) e o **resultado**, de preferência com números.',
            },
            {
              type: 'build',
              part: 'story',
              method: 'star',
              instruction: 'Conte em STAR um problema que você resolveu. Uma frase por parte.',
              example: 'No grupo de pesquisa, perdíamos dados toda semana (situação). Eu precisava garantir que ninguém perdesse trabalho (tarefa). Criei uma rotina de backup automático e ensinei o grupo a usar (ação). Em seis meses, não perdemos nenhum arquivo (resultado).',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte em 90 segundos, usando STAR, uma situação difícil que você resolveu.',
              topic: { text: 'Uma situação difícil que eu resolvi' },
              seconds: 90,
              method: 'star',
              goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'duration', min: 60 }],
            },
          ],
        },
        {
          id: 'u14-l3',
          title: 'A voz na história',
          skills: ['storytelling', 'pitchVariation', 'pauses'],
          exercises: [
            {
              type: 'concept',
              title: 'Contar, não relatar',
              body: 'Na história, a voz faz metade do trabalho: **acelere** na ação, **desacelere** no momento decisivo, faça uma **pausa antes da virada** e deixe o tom variar com as emoções.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia acelerando um pouco na ação e fazendo a pausa antes da virada.',
              text: 'Corri pela estação, subi a escada, cheguei na plataforma | e o trem já tinha partido. | Foi aí que eu *entendi* ↘',
            },
            {
              type: 'shortTalk',
              instruction: 'Conte em 90 segundos a história de um dia que mudou algo para você, com voz viva.',
              topic: { text: 'Um dia que mudou algo para mim' },
              seconds: 90,
              goals: [{ metric: 'pvq', min: 0.16 }, { metric: 'betweenIdeas', min: 3 }, { metric: 'duration', min: 60 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u14-desafio',
        instruction: 'Conte em 2 minutos uma história que ilustre uma ideia em que você acredita. Termine dizendo a lição.',
        topic: { text: 'Uma história que mostra no que eu acredito' },
        seconds: 120,
        speechType: 'persuasive',
        goals: [{ metric: 'criterion', id: 'development', atLeast: 'attention' }, { metric: 'criterion', id: 'conclusion', atLeast: 'attention' }, { metric: 'pvq', min: 0.16 }, { metric: 'duration', min: 90 }],
      },
    },
    {
      id: 'u15',
      number: 15,
      title: 'Recursos de retórica',
      track: 'E+C',
      summary: 'Regra de três, contraste, repetição intencional, pergunta retórica e frase de efeito.',
      skills: ['rhetoric', 'pitchVariation'],
      lessons: [
        {
          id: 'u15-l1',
          title: 'Regra de três e contraste',
          skills: ['rhetoric'],
          exercises: [
            {
              type: 'concept',
              title: 'Os recursos mais usados nos grandes discursos',
              body:
                '**Regra de três:** listas de três soam completas e ficam na memória. “Vim, vi, venci.”\n\n**Contraste:** “não é X, é Y” destaca a sua ideia ao lado do que ela não é. “Não pergunte o que o país pode fazer por você; pergunte o que você pode fazer pelo país.”',
            },
            {
              type: 'recognize',
              prompt: 'Qual frase usa contraste?',
              options: ['Precisamos de tempo, dinheiro e coragem.', 'O problema não é a falta de recursos; é a falta de prioridade.', 'Será que vamos esperar mais um ano?'],
              answer: 1,
              explanation: '“Não é… é…”: o contraste. A primeira é uma regra de três; a terceira, uma pergunta retórica.',
            },
            {
              type: 'fix',
              instruction: 'Reescreva usando a regra de três.',
              sentence: 'A biblioteca nova vai ser boa para muita coisa, como estudar e outras atividades.',
              sample: 'A biblioteca nova vai ser um lugar para estudar, para encontrar pessoas e para criar.',
              focus: 'rhetoric',
            },
          ],
        },
        {
          id: 'u15-l2',
          title: 'Repetição e pergunta retórica',
          skills: ['rhetoric', 'pitchVariation'],
          exercises: [
            {
              type: 'concept',
              title: 'Repetir de propósito',
              body:
                '**Anáfora:** repetir o começo de frases seguidas cria ritmo e ênfase. “Eu tenho um sonho…” (Martin Luther King repetiu oito vezes).\n\n**Pergunta retórica:** uma pergunta que não espera resposta, mas faz o público pensar. Diga-a com o tom subindo e faça uma pausa depois.',
            },
            {
              type: 'readAloud',
              instruction: 'Leia a repetição com força crescente, uma pausa entre cada frase.',
              text: 'Educação é o que nos tira da pobreza. | Educação é o que nos dá escolha. | Educação é o que nos faz *livres* ↘',
            },
            {
              type: 'readAloud',
              instruction: 'Faça a pergunta subindo o tom e, depois, a pausa.',
              text: 'Até quando vamos aceitar isso? ↗',
            },
          ],
        },
        {
          id: 'u15-l3',
          title: 'A frase de efeito',
          skills: ['rhetoric', 'openingClosing'],
          exercises: [
            {
              type: 'concept',
              title: 'A frase que o público leva para casa',
              body: 'Uma frase de efeito é curta, concreta e geralmente usa um dos recursos: contraste, regra de três, repetição. Coloque-a no fim da fala, diga devagar e deixe um silêncio depois.',
            },
            {
              type: 'build',
              part: 'conclusion',
              instruction: 'Escreva a frase final de um discurso sobre um tema seu, usando contraste ou regra de três.',
              example: 'Não estamos pedindo um favor; estamos pedindo um direito.',
            },
            {
              type: 'shortTalk',
              instruction: 'Fale 90 segundos defendendo uma ideia, usando pelo menos dois recursos: regra de três, contraste, repetição ou pergunta retórica. Feche com uma frase de efeito.',
              topic: { text: 'Uma ideia que vale a pena defender' },
              seconds: 90,
              speechType: 'persuasive',
              goals: [{ metric: 'criterion', id: 'conclusion', atLeast: 'good' }, { metric: 'pvq', min: 0.15 }, { metric: 'duration', min: 60 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u15-desafio',
        instruction: 'Em 2 minutos, faça um discurso curto sobre o tema abaixo usando regra de três, contraste e uma pergunta retórica, terminando com uma frase de efeito.',
        topic: { text: 'Por que vale a pena votar' },
        seconds: 120,
        speechType: 'persuasive',
        goals: [{ metric: 'criterion', id: 'opening', atLeast: 'attention' }, { metric: 'criterion', id: 'conclusion', atLeast: 'good' }, { metric: 'pvq', min: 0.16 }, { metric: 'duration', min: 90 }],
      },
    },
    {
      id: 'u16',
      number: 16,
      title: 'Perguntas e improviso',
      track: 'E+C',
      summary: 'Responder direto, ganhar tempo sem enrolar e admitir com firmeza o que não sabe.',
      skills: ['improvisation', 'structure'],
      lessons: [
        {
          id: 'u16-l1',
          title: 'Responder direto',
          skills: ['improvisation'],
          exercises: [
            {
              type: 'concept',
              title: 'A resposta primeiro',
              body:
                'Diante de uma pergunta, **responda na primeira frase** e só depois explique (é o PREP de novo). Quem começa explicando parece fugir da pergunta.\n\nPara ganhar tempo sem “éé”: repita a pergunta em voz alta (“Você pergunta se o prazo é realista…”) ou faça uma pausa de dois segundos. Os dois soam como reflexão.',
              good: '“Sim, o prazo é realista. Temos duas pessoas a mais desde março e…”',
              bad: '“Então, é… bom, a gente teve vários fatores, né, desde o começo do ano…”',
            },
            {
              type: 'recognize',
              prompt: 'A banca pergunta: “Por que você escolheu esse método?”. Qual é a melhor primeira frase?',
              options: ['Bom, é uma longa história…', 'Porque ele mede o que eu precisava medir: a variação ao longo do tempo.', 'Então, existem vários métodos, e cada um tem vantagens…'],
              answer: 1,
              explanation: 'Responde na primeira frase; a explicação vem depois.',
            },
            {
              type: 'qa',
              instruction: 'Responda a cada pergunta em até 45 segundos, com a resposta na primeira frase.',
              questions: ['Qual é o assunto que você mais gosta de estudar e por quê?', 'Que conselho você daria a quem vai fazer a primeira apresentação?'],
              seconds: 45,
              goals: [{ metric: 'duration', max: 60 }, { metric: 'fillersPerMinute', max: 3 }],
            },
          ],
        },
        {
          id: 'u16-l2',
          title: 'Quando você não sabe',
          skills: ['improvisation', 'weakWords'],
          exercises: [
            {
              type: 'concept',
              title: 'Admitir com firmeza',
              body: 'Inventar uma resposta é o maior risco numa banca. Dizer “não sei” com firmeza, e oferecer o que você sabe, passa segurança: “Não tenho esse dado agora. O que posso dizer é que… Envio o número até amanhã.”',
            },
            {
              type: 'recognize',
              prompt: 'Qual é a melhor resposta quando você não sabe?',
              options: ['Inventar um número plausível.', '“Hum, então, não sei, acho que talvez seja isso, né…”', '“Não tenho esse número agora. Sei que cresceu no último ano; confirmo o valor exato e envio hoje.”'],
              answer: 2,
              explanation: 'Firme, honesta e útil: admite, oferece o que sabe e propõe o próximo passo.',
            },
            {
              type: 'fix',
              instruction: 'Reescreva a resposta de forma firme e honesta.',
              sentence: 'Ah, então, essa pergunta é difícil, né, eu acho que não sei muito bem, talvez seja uns 20%, mais ou menos.',
              sample: 'Não sei o número exato. Pelo que vi no relatório, fica perto de 20%; confirmo e trago na próxima reunião.',
              focus: 'improvisation',
            },
          ],
        },
        {
          id: 'u16-l3',
          title: 'A banca',
          skills: ['improvisation'],
          exercises: [
            {
              type: 'concept',
              title: 'Simulando a banca',
              body: 'Agora o professor faz três perguntas seguidas, como numa banca, numa entrevista ou num debate. Responda cada uma direto, em até 1 minuto. Se não souber, diga com firmeza.',
            },
            {
              type: 'qa',
              instruction: 'Responda a cada pergunta em até 1 minuto.',
              questions: [
                'Qual foi o maior erro que você cometeu nos estudos ou no trabalho e o que aprendeu com ele?',
                'Se você tivesse que convencer alguém a estudar o que você estuda, qual seria o seu melhor argumento?',
                'Qual é a sua opinião sobre o uso de inteligência artificial em provas?',
              ],
              seconds: 60,
              goals: [{ metric: 'duration', max: 80 }, { metric: 'fillersPerMinute', max: 3 }, { metric: 'weakPerMinute', max: 2 }],
            },
          ],
        },
      ],
      challenge: {
        id: 'u16-desafio',
        instruction: 'Pergunta de improviso: responda em até 90 segundos, com a resposta na primeira frase e um exemplo.',
        topic: { text: 'Qual é a habilidade mais importante para o futuro e por quê?' },
        seconds: 90,
        speechType: 'qa',
        goals: [{ metric: 'criterion', id: 'centralIdea', atLeast: 'good' }, { metric: 'fillersPerMinute', max: 2.5 }, { metric: 'duration', min: 40, max: 110 }],
      },
    },
  ],
  challenge: {
    id: 'n3-desafio',
    instruction:
      'Desafio do nível 3: um discurso persuasivo de 3 a 4 minutos sobre o tema abaixo, com argumentos e evidências, resposta a uma objeção, uma história curta, recursos de retórica e um pedido de ação.',
    topic: { text: 'A escola deveria ensinar a argumentar' },
    seconds: 210,
    speechType: 'persuasive',
    goals: [
      { metric: 'criterion', id: 'opening', atLeast: 'attention' },
      { metric: 'criterion', id: 'development', atLeast: 'good' },
      { metric: 'criterion', id: 'conclusion', atLeast: 'attention' },
      { metric: 'fillersPerMinute', max: 2 },
      { metric: 'weakPerMinute', max: 1 },
      { metric: 'duration', min: 150 },
    ],
  },
};
