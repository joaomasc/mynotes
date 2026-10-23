# Revisar: cartões e perguntas das suas notas

A seção **Revisar** (`/review`) traz de volta o que você estudou na hora certa para não esquecer. Ela mistura cartões no estilo Anki, perguntas abertas, dissertações e recordação livre, tudo tirado das suas notas, e agenda cada item com o FSRS, o algoritmo do Anki atual.

Decisões que guiam tudo:

- **Você escolhe os assuntos.** Um assunto inclui ele e toda a descendência: marcar **A** traz A, os filhos B e os netos C; marcar só **B** traz B e C, mas não A nem os irmãos de B. Sem nada marcado, entra tudo.
- **As perguntas da IA passam pela sua aprovação** antes de entrar nas revisões.
- **A correção usa só as suas notas.** Se a IA achar que a própria nota tem um erro, avisa à parte, sem descontar da resposta.

## Sumário

1. [Escolher os assuntos](#escolher-os-assuntos)
2. [Tipos de item](#tipos-de-item)
3. [Quando cada item volta](#quando-cada-item-volta)
4. [A sessão](#a-sessão)
5. [Onde a IA entra](#onde-a-ia-entra)
6. [Técnicas de memória](#técnicas-de-memória)
7. [Dados](#dados)
8. [API](#api)
9. [Interface](#interface)
10. [Integração com o resto do MyNotes](#integração-com-o-resto-do-mynotes)
11. [Custos](#custos)
12. [Testes](#testes)
13. [Limitações e o que ficou de fora](#limitações-e-o-que-ficou-de-fora)
14. [Etapas](#etapas)

## Escolher os assuntos

- A árvore de assuntos tem caixas de seleção. Marcar um pai deixa os filhos marcados e travados, para mostrar que já estão incluídos. Marcar um assunto cujo pai já está marcado não é possível (ele já entra).
- A seleção pode ganhar um nome ("Prova de Civil") e fica salva nas configurações (sincroniza entre aparelhos). A última seleção usada volta na próxima vez.
- Na página de um assunto, o botão **Revisar** abre a Revisão com ele marcado.
- **O que conta como conteúdo de um assunto:** notas, anotações e resenhas de livros (que seguem o assunto do livro), conceitos e a descrição do próprio assunto. O texto de dentro dos PDFs fica de fora, porque o MyNotes não o extrai.
- **O assunto de um cartão** é o da nota de onde ele veio (ou o do livro, para anotações). Se a nota muda de assunto, os cartões vão junto; se a nota vai para a lixeira, os cartões somem das revisões até ela voltar. Cartões sem nota têm o assunto escolhido ao criá-los.

Na API, a seleção vira uma CTE recursiva (`scope.ts`), a mesma ideia do `SUBTREE_SQL`, para vários assuntos de uma vez e sem os que estão na lixeira.

## Tipos de item

| Tipo | Como funciona | Quem corrige |
|---|---|---|
| Frente e verso | Pergunta e resposta; "também ao contrário" cria o cartão inverso | Você: Errei / Difícil / Bom / Fácil |
| Lacuna | Texto com `{{c1::termo}}` (ou `{{c1::termo::dica}}`); cada número vira um cartão | Você |
| Resposta digitada | O app compara ignorando acentos, maiúsculas e pontuação; uma letra a cada cinco errada conta como "quase"; várias respostas aceitas separadas por " \| " | O app sugere, você confirma |
| Pergunta aberta | Resposta curta, escrita ou falada | IA, por pontos-chave |
| Dissertação | "Explique…", "Compare…", "Por que…" | IA, por pontos-chave |
| Recordação livre | "Escreva tudo que lembra sobre B" (não é um cartão: é um modo da sessão) | IA compara com as notas |

Cartões criados juntos (as lacunas de um mesmo texto, um cartão e o seu inverso) formam um **grupo**: só um deles aparece por sessão, para um não dar a resposta do outro.

Cada item guarda a nota e o trecho de onde saiu, com o link "ver na nota". Um pedaço curto do trecho (`source_probe`, normalizado como `notes.search_text`) permite ao banco saber se o trecho ainda está na nota: se sumir, o cartão avisa "o trecho mudou na nota".

## Quando cada item volta

- **FSRS-6** pela biblioteca `ts-fsrs` 5.4 (MIT, sem dependências; a 6.0 ainda estava em beta em outubro de 2026). As funções puras ficam em `packages/shared/src/review/schedule.ts`: a API calcula e grava; o app usa as mesmas para mostrar, em cada botão, quando o item voltaria.
- **Memória desejada** ajustável (85%, 90% ou 95%; padrão 90%) e **novos por dia** (padrão 20), nas configurações da Revisão.
- Os primeiros passos de um item novo são em minutos (1 e 10 min); depois o intervalo cresce com a estabilidade. Errar volta o item a "reaprendendo".
- Um pequeno espalhamento aleatório dos intervalos (o *fuzz* do FSRS) evita que itens criados juntos voltem sempre no mesmo dia.
- Cada resposta fica em `review_logs` com nota, certeza, tempo e o texto respondido: é o histórico que permite, mais tarde, ajustar os parâmetros do FSRS à sua memória.
- Um item que você erra 6 vezes vira **difícil** ("sanguessuga", no Anki) e ganha a ajuda da IA.

## A sessão

1. Na página Revisar: os assuntos, o **modo** e quantos itens.
   - **Revisão do dia:** o que vence e alguns novos, de todos os tipos.
   - **Só cartões:** frente e verso, lacunas e digitadas.
   - **Perguntas e dissertações:** as corrigidas pela IA.
   - **Treino livre:** os itens que você está mais perto de esquecer, mesmo que não vençam hoje.
   - **Escrever tudo que lembra:** recordação livre de um assunto.
2. Antes de ver a resposta: **"quão certo você está?"** (Não sei / Acho que sei / Tenho certeza). Um erro cometido "tendo certeza" volta logo depois do próximo item (os outros erros, três itens depois) e fica marcado no resumo e nas estatísticas. Dá para desligar a pergunta nas configurações.
3. **Errou, volta:** o item errado reaparece três itens depois (ou no fim), até três vezes na mesma sessão. É a reaprendizagem sucessiva: recuperar até acertar, em várias sessões espaçadas.
4. **Assuntos misturados:** a fila espalha cada assunto ao longo da sessão em vez de um bloco por assunto (`interleave`).
5. Teclas: espaço mostra a resposta; 1 a 4 escolhem a nota.
6. **Sem internet:** as respostas ficam guardadas no aparelho (IndexedDB) com o horário em que foram dadas e são enviadas quando a conexão volta; a API agenda a partir desse horário. A correção pela IA precisa de internet.
7. No fim: itens, certos de primeira, tempo, erros cometidos com certeza, acertos por assunto e quando o próximo item volta. A sessão de 1 minuto ou mais vira uma **sessão de estudo** (origem "revisão") na página Estudo.

## Onde a IA entra

Usa a mesma chave da OpenAI do assistente, o mesmo modelo e o mesmo orçamento diário. Todas as chamadas pedem saída estruturada (JSON com esquema) e são validadas de novo pela API.

**Gerar perguntas** (`POST /review/generate`)
- Escolhe as notas da seleção que têm menos perguntas (sorteando entre as empatadas, para pedir de novo trazer outras notas) e, de notas longas, uma janela de 3.500 caracteres que anda conforme a nota ganha perguntas. Até cerca de 14 mil caracteres por lote, e alguns conceitos se sobrar espaço.
- Cada pergunta volta com a fonte (`N1`, `C2`…) e um **trecho copiado da fonte**. A API **descarta** a pergunta quando o trecho não está na nota, quando uma lacuna esconde uma palavra que não está na nota, quando ela repete uma pergunta existente ou quando falta algo do tipo (resposta, pontos-chave). O número de descartadas aparece para você.
- O foco "ligações entre notas" usa as relações do grafo (depende de, contrasta com, exemplo de…) e as referências escritas nas notas entre itens da seleção, e pede perguntas sobre a relação, que exigem as duas notas.
- As perguntas ficam em `review_proposals` até você aprovar (com edições) ou descartar. As que você nunca decidir são apagadas depois de 30 dias.

**Corrigir** (`POST /review/cards/{id}/evaluate`)
- A IA recebe a pergunta, os pontos-chave, a resposta modelo, o trecho e a parte da nota em volta dele. Para cada ponto-chave diz "cobriu", "em parte" ou "faltou", com o trecho da sua resposta que comprova; lista só o que **contradiz** as notas (o que não está nas notas não é erro); e pode apontar um possível erro na própria nota, que não conta contra você.
- **A nota é calculada pelo app, não pela IA:** cobriu vale 1, em parte vale ½, sobre o total de pontos, menos 15 por contradição (até −45). A partir dela vem a sugestão: 85 ou mais, Bom; 60 a 84, Difícil; abaixo, Errei. Fácil nunca é sugerido.
- Você pode escolher outro botão: fica registrado que discordou (`disputed`).
- Sem a IA (ou se ela falhar), "Ver a resposta modelo e avaliar sozinho" mostra a resposta e os pontos-chave.

**Recordação livre** (`POST /review/recalls`): a IA escolhe de 6 a 12 ideias principais das notas do assunto, cada uma com um trecho copiado (conferido pela API), e marca quais o seu texto cobriu. A cobertura é calculada como na correção. Cada ideia que faltou tem o botão "Criar cartão".

**Perguntas de outro jeito** (`POST /review/variants`): ao começar uma sessão, as perguntas abertas e dissertações já respondidas antes voltam reformuladas (mesmos pontos-chave), para você lembrar a resposta e não o texto da pergunta. Não é guardado; sem IA, a pergunta fica como foi escrita.

**Ajuda para cartões difíceis** (`POST /review/cards/{id}/help`): uma versão mais clara, a divisão em cartões menores (o original é suspenso) ou um macete guardado na resposta. Nada muda até você aplicar.

## Técnicas de memória

| Técnica | O que a pesquisa diz | Onde está |
|---|---|---|
| Tentar lembrar antes de ver (prática de recuperação) | Uma das duas técnicas de "alta utilidade" na revisão de Dunlosky e colegas (2013) | Todo item pede a resposta antes de mostrá-la |
| Revisões espaçadas | A outra das duas | FSRS |
| Reaprender até acertar | Junta as duas anteriores | O item errado volta na mesma sessão |
| Escrever tudo que lembra | Karpicke e Blunt (2011): uma semana depois, cerca de 50% mais retenção do que fazer mapas conceituais | Modo "Escrever tudo que lembra" |
| Explicar a si mesmo, perguntar "por quê?" | Utilidade moderada; melhor quando a explicação é sua | Dissertações e perguntas sobre as ligações do grafo |
| Misturar assuntos | Atrapalha durante o treino, ajuda na prova mais tarde | Sessões intercaladas |
| Explicar em voz alta (técnica Feynman) | A mesma ideia de explicar a si mesmo | "Responder falando" (o ditado do MyNotes) nas perguntas e na recordação |
| Dizer quão certo está | Erros cometidos com certeza se corrigem melhor, mas voltam se não forem revistos | Pergunta de certeza; o erro com certeza volta logo na sessão, fica marcado e entra na estatística de calibração |
| Um fato por cartão | Prática de quem usa Anki | Ajuda da IA para dividir cartões difíceis |

## Dados

Migração `0010_review.sql`:

| Tabela | O que guarda | No backup |
|---|---|---|
| `review_cards` | Tipo, texto, pontos-chave, nota e trecho de origem, grupo, situação e o estado do FSRS (fase, vencimento, estabilidade, dificuldade, repetições, erros) | Sim |
| `review_logs` | Cada resposta: nota, certeza, fase anterior, dias desde a anterior, tempo, texto respondido, pergunta reformulada, correção da IA, discordância | Sim |
| `review_sessions` | Modo, assuntos, tempo, totais e a sessão de estudo criada | Sim |
| `review_recalls` | Texto da recordação livre e a comparação | Sim |
| `review_proposals` | Perguntas da IA esperando aprovação | Não (é um cache) |

A mesma migração **recria a tabela `study_sessions`** para aceitar `source = 'review'`: o SQLite não altera uma restrição `CHECK`. As linhas de `study_session_notes` e `study_session_documents` (que são apagadas em cascata) são guardadas numa tabela temporária e devolvidas; todas as colunas, índices e linhas continuam iguais (testado com dados antes de publicar). Também ganha a coluna `speech_push_subscriptions.review_last_sent_on`, para o lembrete da Revisão não depender do da Oratória.

## API

Tudo em `apps/api/src/modules/review` (tag "Revisar" na documentação OpenAPI, `/api/v1/docs`).

| Rota | O que faz |
|---|---|
| `GET /review/summary` | Para hoje, novos disponíveis, respostas do dia, sequência, sugestões esperando, itens difíceis |
| `GET /review/scope` | O que uma seleção cobre (notas, anotações, conceitos, itens, vencidos, novos, sugestões) |
| `GET /review/queue` | Os itens de uma sessão (vencidos primeiro, novos até o limite do dia, um por grupo, intercalados) |
| `GET/POST /review/cards`, `GET/PATCH/DELETE /review/cards/{id}` | Cartões: listar com filtros, criar (lacunas e inverso), editar, suspender, recomeçar, excluir |
| `POST /review/cards/{id}/answer` | Registra uma resposta (id gerado no app: repetir não conta duas vezes) |
| `POST /review/cards/{id}/evaluate` | Correção pela IA |
| `POST /review/cards/{id}/help` | Ajuda da IA para um cartão difícil |
| `POST /review/variants` | Perguntas reformuladas |
| `POST /review/generate`, `GET /review/proposals`, `POST /review/proposals/decide` | Perguntas da IA e aprovação |
| `GET/POST /review/sessions`, `GET /review/sessions/{id}`, `POST /review/sessions/{id}/finish` | Sessões |
| `GET/POST /review/recalls`, `GET /review/recalls/{id}` | Recordação livre |
| `GET /review/stats` | Memória real × desejada, previsão de 30 dias, histórico de 90, calibração, assuntos fracos, erros com certeza, sequência |

As configurações ficam na chave `review` de `/settings` (memória desejada, novos por dia, itens por sessão, pergunta de certeza, lembrete, seleções salvas, última seleção).

## Interface

| Página | O que tem |
|---|---|
| `/review` | Resumo do dia, aviso de sugestões esperando e de respostas offline, seletor de assuntos com seleções salvas, modo, tamanho da sessão, "Gerar com IA", "Novo cartão", sessões recentes e configurações |
| `/review/session/:id` | A sessão (ou o resumo, para uma sessão já encerrada) |
| `/review/cards` | Todos os cartões com busca e filtros (assunto com subassuntos, tipo, ativos/suspensos/difíceis, nota); tocar edita |
| `/review/proposals` | Sugestões da IA agrupadas por nota, com o trecho de cada uma, edição e aprovação em lote |
| `/review/stats` | Estatísticas |

## Integração com o resto do MyNotes

- **Menu lateral:** "Revisar", com o número de itens para hoje.
- **Nota (menu ⋯):** "Criar cartão (com o trecho selecionado)" abre uma lacuna com o texto selecionado (é só marcar as palavras); "Gerar perguntas desta nota (IA)"; "Cartões desta nota".
- **Assunto:** botão "Revisar".
- **Início:** cartão "Revisar" com a sequência e o botão "Revisar agora".
- **Estudo:** as sessões aparecem com a marca "revisão".
- **Paleta de comandos:** "Ir para Revisar" e "Revisar agora o que vence hoje".
- **Assistente:** `get_review_status` ("o que tenho para revisar?") e `create_review_cards` (cartões de uma nota, sempre com a sua confirmação e com trecho conferido).
- **Lembrete diário** (Web Push, as mesmas inscrições do navegador da Oratória): depois do horário escolhido, nos dias com itens para revisar e nenhuma revisão feita, uma vez por dia por navegador. Desligar um lembrete não cancela as notificações do navegador enquanto o outro estiver ligado.
- **Backup:** as quatro tabelas acima entram no ZIP.

## Custos

Com os preços do `gpt-6-luna` (US$ 0,10 por milhão de tokens de entrada, US$ 0,50 de saída). Medido em 2026-10-22 com uma nota de quatro parágrafos (teste real `test/live/review.live.ts`):

| Chamada | Medido (nota curta) | Lote cheio (estimativa) |
|---|---|---|
| Gerar 6 perguntas | 739 tokens de entrada, 693 de saída: US$ 0,0004 | ~14 mil caracteres de notas: ~US$ 0,002 |
| Corrigir uma dissertação | 663 + 402 tokens: US$ 0,0003 | nota longa: ~US$ 0,001 |
| Recordação livre | 540 + 687 tokens: US$ 0,0004 | ~16 mil caracteres: ~US$ 0,002 |
| Ajuda para um cartão difícil | 459 + 159 tokens: US$ 0,0001 | — |
| Perguntas de outro jeito | 178 + 108 tokens: US$ 0,00007 por pergunta | 20 perguntas: ~US$ 0,001 |

As cinco chamadas do teste real somaram US$ 0,0013. Uma sessão mista de 15 itens com 5 dissertações fica abaixo de US$ 0,01. Tudo entra no `ai_usage_daily` e respeita `AI_DAILY_BUDGET_USD`. As perguntas aprovadas são reaproveitadas para sempre; só gerar novas custa de novo.

## Testes

- **Regras (packages/shared/test/review.test.ts):** lacunas (números, dicas, sem marcação), resposta digitada (acentos, "quase", alternativas), trechos citados (acentos, aspas, pedaços com "…") e o pedaço curto conferido pelo banco, FSRS (novo → aprendendo → revisão; erro → reaprendendo; memória desejada mais alta traz o item antes), intervalos em português, intercalação, seleção reduzida aos assuntos do topo, volta do item errado, e a presença das tabelas no backup na ordem certa.
- **API (apps/api/test/review.test.ts):** o exemplo A › B › C (marcar B revisa só B e C), cartões que acompanham a nota (mudança de assunto, lixeira, anotações de livro), lacunas e inverso, "o trecho mudou", versões, FSRS e respostas repetidas, limite de novos por dia e um cartão por grupo, sessão que entra em Estudo, resumo e estatísticas; a IA simulada: perguntas fundamentadas e descartadas, ligações do grafo, aprovação, correção por pontos-chave com contradição, recordação com ideias conferidas, ajuda e perguntas reformuladas; o assistente propondo cartões e consultando o dia; o lembrete. Em `backup.test.ts`, a ida e volta dos dados da Revisão.
- **Ponta a ponta (e2e/tests/review.spec.ts):** a seleção A › B › C na tela com a sessão completa e o item errado voltando; uma lacuna criada a partir do texto selecionado numa nota; sugestões da IA aprovadas, dissertação corrigida (com discordância registrada) e recordação livre, com as respostas do modelo simuladas.
- **IA de verdade (opcional, ~US$ 0,0015):** `npx vitest run --config vitest.live.config.ts test/live/review.live.ts` em `apps/api` gera perguntas de uma nota, corrige uma dissertação, compara uma recordação livre, pede ajuda para um cartão e reformula uma pergunta, conferindo que a OpenAI aceita os formatos e que as respostas ficam presas à nota. Com `--disableConsoleIntercept` mostra as respostas do modelo.
- **Migração com dados:** `0001` a `0009` aplicadas num D1 local, sessões de estudo com notas e documentos inseridas, `0010` aplicada: linhas, vínculos e índices preservados, `review` aceito, valores inválidos e chaves estrangeiras ainda recusados.

## Limitações e o que ficou de fora

- **Pré-teste antes de ler um livro:** ficou de fora. Sem notas sobre o livro, as perguntas teriam de vir do conhecimento geral da IA, o que contraria a decisão de usar só as suas notas. O "Treino livre" e as perguntas novas de um assunto cumprem parte desse papel.
- **Texto dos PDFs:** não entra (o MyNotes não extrai o texto dos documentos). Anotações e resenhas dos livros entram.
- **Imagens (oclusão de imagem do Anki):** não há cartões com imagem.
- **Parâmetros do FSRS:** usam os padrões do FSRS-6. As respostas ficam guardadas para um ajuste futuro à sua memória.
- **Offline:** as respostas sem internet ficam guardadas e são enviadas depois, mas uma sessão só começa com internet (a fila vem do servidor), e a correção pela IA precisa de conexão.

## Etapas

| Etapa | Entrega |
|---|---|
| **1. Base** ✓ | Seleção de assuntos com descendência, cartões (frente e verso, inverso, lacuna, digitada) manuais e a partir de uma nota, FSRS, sessão com reaprendizagem e intercalação, lista de cartões |
| **2. Perguntas da IA** ✓ | Geração com trecho conferido e aprovação em lote, perguntas abertas e dissertações corrigidas por pontos-chave só pelas notas, discordância, pergunta de certeza, resposta falada |
| **3. Outras técnicas** ✓ | Recordação livre, perguntas sobre as ligações do grafo, perguntas reformuladas nas revisões, ajuda para cartões difíceis |
| **4. Hábito e números** ✓ | Lembrete diário, cartão no início, estatísticas, sessão em Estudo, backup, respostas offline, ferramentas do assistente, paleta de comandos |
