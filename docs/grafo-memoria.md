# Grafo da memória e ligações sugeridas

Duas camadas sobre o grafo de conhecimento (`/graph`), feitas com o que o MyNotes já tem: a agenda das revisões (FSRS, [revisar.md](revisar.md)) e o índice de busca por sentido do assistente ([ai.md](ai.md#índice-semântico)).

## Grafo da memória

No grafo, **Cor: Tipos | Memória**. No modo Memória:

- Cada **nota** ganha a chance média de lembrar dos seus cartões; cada **livro**, a dos cartões das suas anotações e resenha; cada **assunto**, a de todos os cartões abaixo dele (subassuntos incluídos).
- Um só tom, do forte ao claro: 90% ou mais, 80 a 90%, 70 a 80%, 50 a 70%, menos de 50%. A escala foi conferida para tema claro e escuro (um tom, degraus visíveis, o mais claro ainda legível sobre o fundo): tokens `--mem-0` a `--mem-4` em `index.css`.
- **Anel colorido:** o item tem cartões, mas nenhum foi revisado ainda. **Anel cinza:** sem cartões (o que você ainda não estuda).
- **Como estará:** hoje, +7, +30 ou +90 dias, mostrando como o grafo desbota se nada for revisado até lá.
- **Esquecendo agora:** as notas que mais desbotaram (abaixo de 90%), com "Revisar estas notas". Tocar num item do grafo mostra "Lembrança estimada: 64% · 3 cartões · 1 para revisar" e **Revisar agora** (uma sessão de treino só com aquela nota, livro ou assunto).

Como funciona:

- `GET /review/memory` devolve, de cada cartão ativo, só o necessário: nota, assunto (o da nota, o do livro para anotações, ou o do próprio cartão), livro, fase, estabilidade, última revisão e vencimento, em tuplas compactas.
- O navegador calcula a chance de lembrar com a curva de esquecimento do FSRS-6 (`cardRetrievability`, em `packages/shared/src/review/memory.ts`) e soma por nó (`memoryByNode`). Por isso a régua do tempo não chama o servidor.
- A fila da sessão aceita `noteIds` (`GET /review/queue?noteIds=…`), usado pelo "Revisar agora".

Custo: zero (sem IA).

## Ligações sugeridas

Notas e conceitos parecidos no sentido que ainda não estão ligados.

- **No painel da nota** (e na página do conceito): "Notas que conversam com esta", até 5, com o quanto se parecem, a explicação da IA, o tipo de relação sugerido e o sentido (que podem ser trocados), e **Ligar** ou **Dispensar**.
- **No grafo:** o botão **Sugestões** desenha as sugestões como linhas tracejadas (`--suggest`); tocar numa abre o mesmo cartão.
- **Ponte:** quando as duas pontas estão sob assuntos de topo diferentes ("Economia ↔ História"), a sugestão ganha destaque.
- Ligar cria uma relação comum (`relations`), que também alimenta as perguntas sobre ligações da Revisar.

Como funciona (`apps/api/src/modules/links`):

1. O índice por sentido já guarda cada nota e conceito em vetores (Vectorize). Os vizinhos de um item vêm de `queryById` dos seus primeiros trechos, sem gerar vetores de novo.
2. Ficam de fora: o próprio item, o que já está ligado (relações e referências "/" nos dois sentidos) e qualquer par já sugerido, aceito ou dispensado. São guardados até 5 pares novos por item, com semelhança a partir de 0,5.
3. **Quando:** a cada 10 minutos, depois da atualização do índice, até 15 itens novos ou alterados por vez (`knowledge_index.links_hash` guarda o texto já varrido). Ao abrir uma nota alterada, ela é varrida na hora. Um vetor recém-gravado leva um tempo para aparecer nas buscas: o item espera 90 segundos e, se ainda não se encontrar, fica para a próxima rodada (desiste depois de uma hora).
4. **Exibição:** a partir de 0,62 de semelhança (`LINKS_MIN_SCORE` nas `vars` ajusta sem mudar código). Pares de notas na lixeira não aparecem; apagar de vez uma nota apaga os seus pares.
5. **Explicação:** as sugestões exibidas e ainda sem explicação vão à IA num lote (até 10): ela lê só os dois textos e devolve o tipo (depende de, é parte de, sustenta, contrasta com, é exemplo de, se relaciona com, ou "nenhuma"), o sentido e uma frase. "Nenhuma" esconde a sugestão. Cada par é explicado uma vez e a resposta fica guardada.

Tabela `link_suggestions` (migração `0011`): o par em ordem fixa, a semelhança, a situação (aberta, aceita, dispensada), o tipo, o sentido, a explicação e se está escondida. Entra no backup, para que as dispensadas não voltem depois de restaurar.

| Rota | O que faz |
|---|---|
| `GET /links/suggestions?type=note&id=…` | Sugestões de um item (varrido na hora se o texto mudou); `pending` quando ainda não está no índice, `unavailable` sem o índice |
| `GET /links/suggestions` | As abertas de tudo (grafo) |
| `POST /links/suggestions/explain` | A IA explica até 10 |
| `POST /links/suggestions/{id}/accept` | Cria a relação (tipo e sentido sugeridos, ou os escolhidos) |
| `POST /links/suggestions/{id}/dismiss` | Não volta mais |
| `POST /links/scan` | Varre agora um lote |

Custo: a busca dos vizinhos entra na cota do Vectorize; a explicação, cerca de US$ 0,0003 por lote de 10 pares, uma vez.

## Testes

- `packages/shared/test/review.test.ts`: curva de esquecimento (90% quando o tempo passado é igual à estabilidade), faixas da escala, soma por nota, livro e assunto com os ancestrais.
- `apps/api/test/memory-links.test.ts`: a rota de memória (cartões suspensos de fora, assunto e livro de anotações), a sessão só de algumas notas; sugestões com índice simulado: pendente antes de indexar, o par parecido sugerido e o distante não, o já ligado de fora, explicação uma vez só, Ligar no sentido sugerido ou escolhido, Dispensar que não volta nem depois de o texto mudar, "nenhuma" escondida, lixeira e exclusão definitiva, varredura do cron e índice indisponível.
- `apps/web/test/graph-memory.test.ts`: as cores da memória, os anéis e as linhas tracejadas só entre itens visíveis.
- `e2e/tests/memory-graph.spec.ts`: o modo Memória com a régua do tempo, "Esquecendo agora" e a sessão aberta por ele; a seção da nota com a ponte, a explicação automática e Ligar.
