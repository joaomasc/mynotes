# Assistente de IA

O assistente conversa sobre o conteúdo do MyNotes e, quando você pede, cria e organiza notas, assuntos, relações e mapas. Ele usa a **OpenAI Responses API** com *function calling*: o modelo só **pede** operações; quem consulta e grava é o Worker, com as mesmas regras e serviços do app.

```
 Navegador                          Worker (Hono)                                 OpenAI
┌─────────────────────┐  POST     ┌──────────────────────────────────────────┐  /v1/responses
│ Painel “Assistente” │ /ai/chat  │ auth → limites → histórico → modelo ───────┼────────────►
│ ou página /assistant│ ────────► │        ▲                         │         │ ◄───────────
│ (contexto: tipo+id) │           │        │ resultado (JSON)         ▼         │  function_call
│                     │ ◄──────── │   ferramentas autorizadas (17) → D1       │
│ cartões: Confirmar  │ /ai/actions│  leitura direta · escrita validada        │
└─────────────────────┘           │  propostas → ai_actions (confirmação)     │
                                  └──────────────────────────────────────────┘
```

- **Fonte oficial dos dados:** as tabelas existentes (`notes`, `topics`, `relations`, `mind_maps`…). O assistente não tem base própria de conhecimento; guarda só a conversa, as propostas/ações e o consumo.
- **A chave nunca sai do Worker:** o navegador fala só com a API do MyNotes. `GET /ai/status` informa apenas *se* há chave configurada.
- **Dados não ficam na OpenAI:** as requisições usam `store: false`.

## Como funciona um turno

1. `POST /api/v1/ai/chat` com `{ messageId, message, conversationId?, context? }`. O `messageId` é gerado pelo navegador: reenviar o mesmo id devolve a resposta já dada (`replayed: true`) sem chamar o modelo de novo.
2. O Worker autentica, valida o payload (Zod), aplica o limite por minuto e o orçamento diário, confere que o item em contexto existe e é seu, e monta a entrada: até 12 mensagens anteriores (cortadas em 1.500 caracteres), uma mensagem `developer` com o item aberto (tipo, id e título — nunca o conteúdo) e a pergunta.
3. O modelo pode chamar ferramentas. Cada chamada é revalidada com Zod, executada com `user_id` em todas as consultas e devolvida como JSON. Cada ferramenta roda numa invocação própria do Worker (entrypoint `AssistantTools`, chamada por `exports` de `cloudflare:workers`), com seu próprio limite de consultas D1. No máximo `AI_MAX_TOOL_CALLS` chamadas e 16 rodadas por turno; esgotado o limite, uma última chamada com `tool_choice: "none"` obriga o modelo a responder.
4. A resposta passa por verificação de citações: links `mynotes:<tipo>/<id>` só ficam se o item existir e for seu; os demais viram texto. As fontes exibidas são os itens citados e os lidos por inteiro.
5. Mensagens, atividade das ferramentas (só rótulos), fontes, tokens e custo vão para o D1. Resultados brutos de ferramentas **não** são guardados.

## Ferramentas

Lista explícita em `apps/api/src/modules/assistant/service.ts` (`TOOLS`). Não há SQL livre, acesso genérico ao R2, HTTP arbitrário nem exclusão.

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `search_knowledge` | leitura | Busca sem acento em notas, resenhas, anotações, assuntos, livros, documentos, conceitos e mapas (pontua por termos encontrados; `#tag` lista notas da tag). |
| `get_note` | leitura | Texto da nota, assunto, livro/página, tags, referências e `version`. |
| `get_topic` | leitura | Assunto com caminho, subassuntos, notas, livros, documentos, tags e `version`. |
| `get_topic_tree` | leitura | Hierarquia (toda ou de um assunto) com ids — usada antes de criar assuntos. |
| `list_tags` | leitura | Tags em uso. |
| `search_library` | leitura | Livros e documentos por metadados. |
| `get_reading` | leitura | Livro com resenha e anotações por página (páginas e trechos registrados por você). |
| `get_connections` | leitura | Relações tipadas, quem cita / é citado, hierarquia e anotações de um item. |
| `find_connection_path` | leitura | Menor caminho entre dois itens no grafo derivado + tags em comum. |
| `get_mind_map` | leitura | Mapa gerado de um assunto, mapa livre ou lista de mapas. |
| `create_note` | escrita | Nota (ou anotação de página) em Markdown → documento do editor; links internos viram referências “/”; tags `#`. |
| `update_note` | escrita | Título, acrescentar texto, mover de assunto; **reescrever tudo exige confirmação**. Sempre com `base_version` e versão salva no histórico antes. |
| `create_topics` | escrita | Um assunto ou uma árvore inteira; reaproveita equivalentes (mesmo título e pai). **Mais de um assunto novo exige confirmação.** |
| `update_topic` | escrita | Renomear / descrever. |
| `move_topic` | sensível | Mudar a hierarquia — **sempre** proposta. Impede ciclos. |
| `create_relations` | escrita | Relações tipadas (`related`, `references`, `depends_on`, `part_of`, `supports`, `contrasts`, `example_of`); recusa duplicatas, autorreferência, ciclos de `depends_on`/`part_of` e `part_of` entre assuntos. **Mais de uma exige confirmação.** |
| `propose_mind_map` | escrita | Mapa conceitual (novo ou acrescentado a um existente) com nós ligados a itens reais — **sempre** proposta. |

### Política de confirmação

| Situação | O que acontece |
|---|---|
| Leitura | Executa direto. |
| Uma escrita reversível pedida explicitamente (“crie”, “adicione”, “renomeie”…) com `mode: "execute"` | Executa e registra em `ai_actions` (auditoria). |
| A mensagem é pergunta ou pedido de conselho (“como eu organizaria…?”, “o que você sugere…”) | **Vira proposta**, mesmo que o modelo peça para executar (verificação no servidor, `prompt.ts › hasWriteIntent`). |
| Lote (vários assuntos/relações), possível duplicata, reescrita de nota, mudança de hierarquia, mapa mental | **Sempre proposta**: o cartão mostra a prévia; nada é gravado até você clicar em **Confirmar**. |

Confirmar (`POST /ai/actions/{id}/confirm`) reserva a proposta de forma atômica (não executa duas vezes), **revalida tudo com os dados atuais** e grava. Propostas valem 24 h. O resultado (feito ou falha) entra na conversa como registro, e o modelo o vê nos turnos seguintes.

### Conteúdo não confiável

Texto de notas, títulos, trechos de livros e nomes de arquivos são **dados**. As instruções do sistema (enviadas em `instructions`, separadas da conversa) mandam ignorar ordens escritas dentro deles, e as defesas não dependem do modelo obedecer: toda autorização é do backend, não há ferramenta de exclusão, escritas sensíveis exigem clique, links para ids inexistentes são removidos e a interface nunca renderiza HTML (o Markdown vira elementos React; imagens não são exibidas). Links externos abrem em nova aba com `rel="noopener noreferrer nofollow"`.

## Busca

Etapa atual: **busca textual** no D1 (`search_text` sem acentos), numa única instrução por grupo de tipos, com pontuação por termos encontrados, palavras vazias removidas e prioridade para o título. O modelo faz *query expansion* sozinho: tenta sinônimos e termos relacionados quando não encontra nada.

**Busca semântica (embeddings): não implementada, de propósito.** Para uma base pessoal, a busca textual com reformulação pelo modelo responde às perguntas típicas (“onde anotei…”, “quais notas falam de…”) sem infraestrutura nova. Se um dia for preciso: embeddings via API (por exemplo `text-embedding-3-small`) guardados no Cloudflare Vectorize, como índice **derivado e reconstruível** — gerado ao salvar a nota (fila no `ctx.waitUntil`), apagado ao purgar, e reconstruído por um script a partir das notas.

## PDFs

O texto dos PDFs **não é extraído nem indexado** (o leitor usa pdf.js no navegador; extrair no Worker estouraria os 10 ms de CPU do plano gratuito). O assistente encontra livros e documentos por título, autor e nome do arquivo, e lê **as anotações por página** — com o trecho citado e o número da página registrados por você, que são confiáveis. Ele não inventa páginas. Próximo passo possível: extrair o texto no navegador (pdf.js) ao abrir o livro e enviar por página para uma tabela própria.

## Configuração

### Variáveis

| Nome | Onde | Padrão | Função |
|---|---|---|---|
| `OPENAI_API_KEY` | **secret** (produção) / `apps/api/.dev.vars` (local) | — | Chave da OpenAI. Nunca em arquivos versionados. |
| `AI_ENABLED` | `vars` em `wrangler.jsonc` | `true` | `false` desliga o assistente (a API responde 503 com mensagem clara). |
| `OPENAI_MODEL` | `vars` | `gpt-6-luna` | Qualquer modelo da Responses API com function calling. |
| `AI_REASONING_EFFORT` | `vars` | `low` | `none` · `minimal` · `low` · `medium` · `high` (vazio = padrão do modelo). Raciocínio é cobrado como saída. |
| `AI_MAX_OUTPUT_TOKENS` | `vars` | `2000` | Teto de saída por chamada ao modelo. |
| `AI_MAX_TOOL_CALLS` | `vars` | `30` | Chamadas de ferramenta por mensagem (máximo 30: cada uma é uma invocação, e a Cloudflare permite 32 por requisição). |
| `AI_MAX_REQUESTS_PER_MINUTE` | `vars` | `6` | Mensagens por minuto. |
| `AI_DAILY_BUDGET_USD` | `vars` | `0.50` | Recusa novas mensagens quando o gasto do dia (UTC) chega ao valor. `none` = sem limite do app. |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_CACHED_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` | `vars` | `0.10`, `0.01`, `0.50` | Preço (US$ por 1M de tokens) do modelo configurado, para converter o uso real em custo. Obrigatórios quando há orçamento. |
| `AI_TIMEOUT_SECONDS` | `vars` (opcional) | `45` | Tempo máximo de cada chamada à OpenAI. |

Valores inválidos caem nos padrões seguros (nunca em “ilimitado”). Os preços padrão são os da [tabela oficial](https://developers.openai.com/api/docs/pricing) para `gpt-6-luna` (Standard), conferidos em 20/10/2026. **Ao trocar o modelo, atualize os preços.**

### Criar a chave da OpenAI

1. Em [platform.openai.com/api-keys](https://platform.openai.com/settings/organization/api-keys), crie uma chave de **projeto**, de preferência com data de expiração.
2. Em *Settings › Limits*, defina um alerta de gasto e, se quiser, um limite rígido mensal. O app tem seu próprio orçamento diário, mas o limite da conta é a última barreira.
3. Não configure recarga automática se o crédito for só de teste.

### Local

```bash
# a chave vai SOMENTE em apps/api/.dev.vars (ignorado pelo git)
#   OPENAI_API_KEY=sk-...
npm run ai:check -w @mynotes/api            # valida chave e modelo — gratuito (GET /v1/models)
npm run ai:check -w @mynotes/api -- --ping  # 1 resposta real mínima, mostra tokens e custo (~US$ 0,00001)
npm run db:migrate:local -w @mynotes/api    # cria as tabelas ai_* no D1 local
npm run dev:api                              # wrangler dev --local (lê .dev.vars)
npm run dev:web
```

### Produção

```bash
cd apps/api
npx wrangler secret put OPENAI_API_KEY        # cole a chave quando pedir (não fica no histórico do shell)
npm run db:migrate:remote                     # aplica 0003_ai_assistant.sql (só cria tabelas)
npm run deploy                                # publica o Worker com as vars de wrangler.jsonc
```

A migração `0003` é aditiva: só cria `ai_conversations`, `ai_messages`, `ai_actions` e `ai_usage_daily`. Para desfazer: `DROP` dessas quatro tabelas (nada mais depende delas). As conversas **não** fazem parte do backup.

### Trocar o modelo ou desligar

- Modelo: altere `OPENAI_MODEL` e os três `AI_PRICE_*` em `wrangler.jsonc` (ou em `.dev.vars` localmente) e publique. Nenhum código muda. `npm run ai:check -w @mynotes/api -- --model <id>` confere se a chave tem acesso ao modelo.
- Desligar: `AI_ENABLED=false` (ou remova o secret: `npx wrangler secret delete OPENAI_API_KEY`).

## Consumo

- **No app:** *Configurações › Assistente de IA* mostra o gasto de hoje, o orçamento e os últimos 30 dias (mensagens, tokens de entrada/cache/saída e custo). Cada resposta guarda seus tokens e custo (`ai_messages`), e cada conversa tem o total.
- **Nos logs do Worker:** uma linha `{"msg":"ai turn", model, calls, tools, input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost_usd, ms}` por mensagem — sem conteúdo.
- **Na OpenAI:** o valor oficial está em [platform.openai.com/usage](https://platform.openai.com/usage).

O custo é calculado com os tokens que a própria API informa em cada resposta e os preços configurados. Referência medida em testes reais com `gpt-6-luna`: **~US$ 0,0002 a 0,0004 por mensagem** (6 a 10 mil tokens de entrada, a maior parte em cache; 90 a 200 de saída). Com US$ 5, são milhares de mensagens. O orçamento diário padrão (US$ 0,50) é checado antes de cada mensagem e entre as chamadas ao modelo, e pode ser ultrapassado por no máximo uma chamada.

## Testes

```bash
npm test                                   # inclui test/assistant.test.ts (API, OpenAI simulada) e web/test/assistant.test.tsx
npm run test:e2e                           # inclui e2e/tests/assistant.spec.ts e o caso de celular (respostas da IA simuladas no navegador)
npm run test:ai-live -w @mynotes/api       # OPCIONAL: 3 turnos reais contra a OpenAI (≈ US$ 0,001), usa a chave do .dev.vars
```

A suíte normal nunca chama a OpenAI: a chave dos testes é falsa (`vitest.config.ts`) e o `fetch` é simulado. O E2E sobrescreve `OPENAI_API_KEY` com um valor inválido (`e2e/start-api.mjs`).

## Adicionar uma ferramenta

1. Escreva a definição com `defineTool` em `apps/api/src/modules/assistant/tools/` (`read.ts`, `graph.ts` ou `write.ts`): `name`, `kind` (`read`/`write`/`sensitive`), `description` (curta, em inglês), `parameters` com os construtores `S.*` (modo estrito: todo campo obrigatório, opcionais como `null`), `args` (Zod, a validação que vale), `label` (texto da atividade, em português) e `run`.
2. Toda consulta filtra por `ctx.userId`. Use `ctx.db`, mantenha a ferramenta abaixo de 50 instruções D1 (o limite da invocação em que ela roda) e registre os itens retornados em `ctx.sources`.
3. Escritas: crie `plan…`/`execute…` em `actions.ts` (validação + prévia, depois a gravação pelos serviços existentes) e chame `apply(ctx, plan, mode)` — ele decide entre executar e propor.
4. Adicione ao array exportado do arquivo (já incluído em `TOOLS`) e um rótulo em `TOOL_NAMES` (`service.ts`). Mantenha menos de ~20 ferramentas: cada definição custa tokens em toda chamada.
5. Teste com respostas simuladas em `apps/api/test/assistant.test.ts` (`callTools(...)`).

## Limites e decisões ligados ao plano gratuito

- **50 consultas D1 por invocação (Workers Free).** Cada ferramenta roda numa invocação própria do Worker (`AssistantTools` em `entrypoint.ts`), então uma mensagem pode ler quantos assuntos e notas suas chamadas de ferramenta pedirem; a invocação do chat só gasta as consultas de autenticação, histórico e gravação. O teto passa a ser o de **32 invocações por requisição**: o chat mais até 30 ferramentas (`AI_MAX_TOOL_CALLS`). Mesmo assim, confirmar uma estrutura roda numa requisição própria, sem nova chamada ao modelo, e as criações em lote usam uma instrução `INSERT … SELECT FROM json_each(?)`.
- **10 ms de CPU por requisição.** O cliente da OpenAI é um `fetch` enxuto (sem o SDK), e esperar a OpenAI não consome CPU. Montar o grafo (`find_connection_path`, mapa de assunto) é o passo mais pesado e já é o mesmo do grafo do app.
- O D1 limita `SELECT`s compostos: a busca roda em dois grupos de tipos dentro de um batch.

## Limitações conhecidas

- Sem *streaming*: a resposta aparece inteira (um indicador mostra que ele está consultando).
- PDFs: sem leitura do texto (veja acima). EPUB e DOCX idem.
- Sem busca semântica (veja acima).
- Mapas: links para mapas mentais aparecem nas fontes, mas não como referência “/” dentro de notas (o editor só referencia assunto, nota, livro, documento e conceito).
- A detecção de “pedido explícito de alteração” é por palavras em português: uma ordem escrita de forma incomum vira proposta (você confirma no cartão). Esse é o lado seguro.
- Tabelas em Markdown não são usadas (o editor de notas não tem tabelas).
- O histórico enviado ao modelo é limitado (12 mensagens); fatos de conversas muito longas podem ser esquecidos. Comece uma nova conversa por assunto.
- Notas editadas pelo assistente enquanto você edita a mesma nota em outro lugar geram o aviso de conflito normal do app (nada é sobrescrito em silêncio).

## Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| “O assistente de IA não está configurado: falta a chave…” | `OPENAI_API_KEY` ausente: `npx wrangler secret put OPENAI_API_KEY` (produção) ou `.dev.vars` (local), e reinicie o `wrangler dev`. |
| “A OpenAI recusou a chave configurada” | Chave inválida, revogada ou expirada. Gere outra e rode `npm run ai:check -w @mynotes/api`. |
| “O modelo … não está disponível para esta chave” | `OPENAI_MODEL` errado ou sem acesso no projeto da chave. `ai:check -- --model <id>`. |
| “A conta da OpenAI está sem crédito ou atingiu o limite de gastos” | Crédito acabou ou limite da conta atingido (*Billing / Limits*). |
| “O orçamento diário do assistente … foi atingido” | `AI_DAILY_BUDGET_USD` do app. Renova às 00h UTC (21h de Brasília). |
| “Muitas mensagens em pouco tempo” | `AI_MAX_REQUESTS_PER_MINUTE`. |
| “O orçamento diário da IA exige os preços do modelo” | Faltam `AI_PRICE_INPUT_PER_MTOK`/`AI_PRICE_OUTPUT_PER_MTOK`. |
| “A resposta excedeu o limite de tamanho” | Aumente `AI_MAX_OUTPUT_TOKENS` ou reduza `AI_REASONING_EFFORT`. |
| Atividade mostra “limite de ferramentas” | A mensagem usou as `AI_MAX_TOOL_CALLS` chamadas (até 30); divida o pedido. |
| `no such table: ai_messages` | Migração não aplicada: `npm run db:migrate:local` / `db:migrate:remote`. |
| Detalhes de uma falha | Logs do Worker (`wrangler tail` ou painel): `openai request failed` traz status e código, nunca a chave. |
