# MyNotes

Ambiente pessoal de conhecimento e estudos: assuntos hierárquicos, notas, biblioteca de PDFs, leituras, planos, diário de estudos, mapas mentais, grafo de conhecimento e um assistente de IA que consulta e organiza o seu conteúdo — com conta única, sincronização entre notebook e celular e backup completo.

- **Frontend:** React 19 + TypeScript + Vite + Tailwind, publicado no **GitHub Pages** (PWA instalável).
- **Backend:** API REST em **Cloudflare Workers** (Hono + Zod/OpenAPI), banco **D1**, arquivos no **R2**.
- **IA:** OpenAI Responses API chamada só pelo Worker (a chave nunca vai para o navegador). Veja [docs/ai.md](docs/ai.md).
- **Fonte oficial dos dados:** o servidor. O navegador mantém apenas cache de leitura e rascunhos de notas ainda não enviados.

> Documentação detalhada: [arquitetura](docs/architecture.md) · [assistente de IA](docs/ai.md) · [segurança](docs/security.md) · [sincronização e conflitos](docs/sync.md) · [backup e recuperação](docs/backup.md) · [publicação](docs/deploy.md)

---

## Sumário

1. [O que já funciona](#o-que-já-funciona)
2. [Estrutura do repositório](#estrutura-do-repositório)
3. [Desenvolvimento local](#desenvolvimento-local)
4. [Criar a conta](#criar-a-conta)
5. [Testes e verificações](#testes-e-verificações)
6. [Publicação](#publicação-resumo)
7. [Configuração de CORS](#configuração-de-cors)
8. [Segurança em resumo](#segurança-em-resumo)
9. [Backup e recuperação](#backup-e-recuperação)
10. [Limites do plano gratuito da Cloudflare](#limites-do-plano-gratuito-da-cloudflare)
11. [Limitações conhecidas](#limitações-conhecidas)
12. [Solução de problemas](#solução-de-problemas)

---

## O que já funciona

| Área | Recursos |
|---|---|
| **Conta e sessão** | Login, logout, troca de senha, lista e revogação de sessões, expiração (absoluta e por inatividade), limitação de tentativas. Sem cadastro público: a conta é criada por script local. |
| **Assuntos** | Entidade central: cadernos, matérias e subassuntos em profundidade ilimitada; criação rápida em linha; mover (arrastar e soltar ou “Mover para…”), reordenar, excluir mantendo o conteúdo ou enviando tudo à lixeira. A página do assunto reúne subassuntos, notas, livros (do assunto e relacionados), anotações de leitura que o citam, menções, tags, relações e tempo de estudo. |
| **Notas** | Editor rico (títulos, listas, tarefas, citações, código, links); **blocos de código como no Obsidian**: linguagem escolhida no topo do bloco (ou digitando ` ```python `), cores por linguagem nos temas claro e escuro, Tab/Shift+Tab indentando as linhas selecionadas, Enter mantendo a indentação (e acrescentando um nível depois de `{`, `(`, `[` ou `:`), botão de copiar; **referências com “/”** (`/assunto.Mercantilismo`, `/livro.O Capital#125`, `/pagina.O Capital`…) guardadas pelo id, com título sempre atual, detecção e reparo de referências quebradas; **tags com “#”** pesquisáveis e sugeridas; salvamento automático local-first, histórico de versões, backlinks, relações, favoritos, mover entre assuntos; botão “+” contextual. **Ditado** (🎤 na barra do editor, em toda nota, anotação de página e resenha): grava e transcreve em português, com o texto aparecendo no cursor a cada pausa. |
| **Biblioteca** | Upload com progresso (PDF, PNG, JPEG, WebP, EPUB, DOCX, TXT, Markdown — sem limite prático: acima de 50 MB o arquivo é enviado em partes), validação de tipo pela assinatura do arquivo, nomes internos aleatórios no R2, download autenticado, links assinados de 5 minutos, leitor de PDF no app (zoom, páginas, texto selecionável), busca e filtros. EPUB e DOCX: apenas download. |
| **Livros e leituras** | Na Biblioteca. Cada livro é um espaço de estudo: leitor de PDF integrado que lembra a página atual (com “Maximizar PDF”: o PDF ocupa a aba e as anotações abrem num painel ao lado, seguindo a página e o trecho selecionado), anotações por página (resumo, interpretação, crítica, dúvida, citação — tipo opcional), trecho selecionado no PDF como citação, “Minha resenha”, assuntos relacionados e “citado em”. Planos de leitura com etapas, prazos e progresso. |
| **Diário de estudos** | Fora da navegação principal, sem perda de dados: tempo por assunto e “Registrar sessão” na página de cada assunto; histórico completo em `/study` (link em Configurações). |
| **Conhecimento** | Grafo gerado dos dados (hierarquia, referências, anotações e relações), desenhado em canvas com simulação de forças ao vivo (cada grupo de itens ligados forma um grafo à parte, centrado no seu assunto raiz, e os itens soltos ficam num anel em volta; arrastar puxa os vizinhos, passar o mouse destaca as ligações, nós crescem com o número de ligações, rótulos aparecem com o zoom), foco num item, expansão progressiva, entradas/saídas, filtros (itens sem ligações, tags como nós), grupos de cor por busca (`#tag`, `assunto:…`, `tipo:…`), forças ajustáveis, linha do tempo e criação/remoção de relações; grafo local no painel direito; mapa mental gerado de cada assunto, com ramos recolhíveis, clique que ilumina a cadeia de conexões (caminho até a raiz, ramo abaixo e relações em sequência), “Abrir” ao lado mantendo o mapa à esquerda, disposição salva à parte e relações conceituais que não alteram a hierarquia. Mapas livres continuam disponíveis, com notas como cartões (mostram o texto) e links soltos sobre o mapa. **Canvas** (como o do Obsidian, em `/canvas`, na página de cada assunto e em cada nota): cartões de texto redimensionáveis com referências “/”, tags e código; notas mostradas por inteiro e editáveis ali mesmo (duplo clique); assuntos com seus subassuntos e notas (arraste um deles para fora para virar cartão); links da web (cole o endereço); grupos que levam junto os cartões de dentro; setas entre as bordas, com rótulo, cor e pontas; exportação para o formato `.canvas` do Obsidian. |
| **Assistente de IA** | Painel “Assistente” à direita (segue a aba aberta: nota, assunto, livro, mapa do assunto ou grafo focado) e página **/assistant** no celular (Alt+I). Responde a partir das suas notas, com links para as fontes reais, e diz quando usou só conhecimento geral. Encontra notas por palavras **e por sentido** (índice semântico no Cloudflare Vectorize, atualizado sozinho) e já pesquisa antes de chamar o modelo; a resposta aparece em tempo real. Com o **globo** ligado, também pesquisa na web e lista as páginas citadas à parte (custa ~US$ 0,01 por busca, dentro do orçamento diário). Cria notas e anotações (com blocos de código na linguagem certa), escreve nas **notas diárias** (cria a do dia com o seu modelo), **monta e altera canvas** (cartões de texto, notas e assuntos reais, links, grupos e setas), acrescenta texto, renomeia, cria assuntos e árvores de subassuntos (reaproveitando os que já existem), cria relações no grafo, encontra caminhos entre itens e propõe mapas mentais. Lotes, reescritas e mudanças de hierarquia aparecem como **prévia para confirmar**; nada é excluído. Limites por minuto, por mensagem e orçamento diário; consumo real em Configurações. |
| **Oratória** | Página **/speaking**: grave uma fala livre ou explique um assunto das suas notas, com meta de tempo. O navegador mede a voz durante a gravação (ritmo, pausas entre ideias, hesitações e brancos, variação do tom, final das frases subindo, volume caindo no fim) e a transcrição traz vícios de linguagem, palavras fracas, repetição e trechos pouco claros. A régua ([docs/oratoria.md](docs/oratoria.md)) transforma tudo em “bom / atenção / a melhorar” com o número e a referência; a IA avalia abertura, ideia central, estrutura, conclusão e (no modo assunto) a correção em relação às suas notas, com frases reescritas, até 3 pontos a melhorar e um exercício. Nada de áudio é guardado; uma fala interrompida pode ser recuperada. **Trilha estilo Duolingo** ([docs/oratoria-trilha.md](docs/oratoria-trilha.md)): unidades com lições curtas (conceito, múltipla escolha, reescrever frases com correção da IA, respiração guiada, leitura em voz alta com pausa/ênfase/entonação medidas, trava-línguas, falas com metas) e desafios; sessão do dia com aquecimento vocal, próxima lição ou revisão espaçada e Discurso do Dia; XP, meta diária, sequência de dias com uma folga por semana, nível por habilidade, gráficos de evolução e calibração da régua à sua voz. Três níveis e 16 unidades: fundamentos; clareza e firmeza; argumentar e persuadir (falácias, ethos/pathos/logos, histórias, retórica). **Banca**: a IA faz três perguntas sobre qualquer fala e você responde falando, cada resposta avaliada. Biblioteca de métodos de estrutura (PREP, SCQA, Pirâmide, AIDA, Monroe, STAR…). **Nível 4, o seu discurso**: apresentação, discurso político ou defesa de uma ideia construídos em 11 etapas com comentários do professor, dois ensaios comparados lado a lado, banca e apresentação final, com o roteiro salvo como nota. Gravações guardadas (opcional) para ouvir de novo e para a **avaliação completa**, em que a IA ouve a voz e julga segurança, naturalidade, ênfase e energia. **Lembrete diário** por notificação (Web Push). |
| **Revisar** | Página **/review** ([docs/revisar.md](docs/revisar.md)): cartões e perguntas tirados das suas notas, de volta na hora certa pelo **FSRS** (o algoritmo do Anki atual). Escolha os assuntos (cada um com todos os subassuntos; seleções salvas com nome) e o modo: revisão do dia, só cartões, perguntas e dissertações, treino livre ou **escrever tudo que lembra**. Tipos: frente e verso (e o inverso), **lacunas** `{{c1::…}}` (criadas a partir do texto selecionado numa nota), resposta digitada, pergunta aberta e **dissertação**. A **IA escreve perguntas** a partir das notas (cada uma aponta o trecho de onde saiu; as que não batem com a nota são descartadas), inclusive sobre as **ligações do grafo**, e elas só entram depois da **sua aprovação**. Respostas abertas são **corrigidas só pelas suas notas**, ponto-chave por ponto-chave, com o que contradiz a nota e a nota calculada pelo app; dá para responder falando e para discordar. Pergunta “quão certo você está?”, o item errado volta na mesma sessão, assuntos misturados, perguntas reformuladas nas revisões e ajuda da IA para cartões difíceis. Estatísticas (memória real × desejada, previsão de 30 dias, calibração da certeza, assuntos fracos), sessão registrada em Estudo, respostas sem internet enviadas depois, lembrete diário e ferramentas no assistente. |
| **Painel e busca** | Continuar de onde parou, notas recentes, leituras em andamento e atrasadas, próximas metas, favoritos, assuntos. Busca global sem acentos (Ctrl/⌘+K) em assuntos, notas, livros, anotações de página, resenhas e tags (`#tag`). |
| **Backup** | Exportação ZIP (JSON por tabela + arquivos) e importação validada e atômica, em modo mesclar ou substituir. |
| **Área de trabalho** (telas ≥ 1024 px) | Abas e painéis lado a lado ou empilhados, como no Obsidian: cada aba tem o próprio histórico (voltar/avançar, inclusive pelo botão do navegador), abas fixadas, arrastar abas entre painéis ou para a borda de um painel (divide a tela), divisores redimensionáveis, reabrir aba fechada, disposições salvas por nome. Ctrl+clique (ou botão do meio) abre um link em nova aba; Ctrl+Alt+clique, ao lado. Painel direito ligado à aba ativa: menções (vinculadas e **não vinculadas**, com “Vincular”), sumário da nota, grafo local e árvore de tags (`#pai/filho`). A disposição é guardada por aparelho. |
| **Fluidez** | Pré-visualização ao passar o mouse sobre links, referências, menções e nós do grafo (no editor, com Ctrl); paleta de comandos com todas as ações e atalhos (Ctrl+P), troca rápida por aproximação de título (Ctrl+O, Shift+Enter cria a nota), busca global (Ctrl+K); atalhos personalizáveis em Configurações; modo de leitura (Ctrl+E) e largura do texto configurável; notas diárias (Alt+Shift+D abre a de hoje; `/daily` tem o calendário do mês para abrir ou criar a nota de qualquer dia, a sequência de dias e, em cada nota diária, a anterior e a próxima) e modelos com `{{data}}`, `{{titulo}}`…; propriedades da nota (status, prazo, fonte…) pesquisáveis; referências a títulos (`/nota.Título#Seção`); favoritos na barra lateral; lista de referências quebradas (`/search?broken=1`). |
| **Interface** | Tema claro/escuro/sistema, barra lateral recolhível, navegação própria para celular, atalhos de teclado (`?` lista todos), acessível por teclado e leitores de tela, PWA. |

## Estrutura do repositório

```
apps/
  api/          Worker (Hono): src/modules/<domínio>/{routes,service}.ts, migrations/, scripts/, test/
  web/          SPA React: src/features/<área>/, src/lib/ (api, auth, sync, backup), src/components/
packages/
  shared/       Schemas Zod, tipos, constantes e utilitários usados pela API e pelo app
e2e/            Testes Playwright (API real + build de produção)
docs/           Documentação
.github/workflows/  CI, publicação do frontend, publicação manual do Worker
```

## Desenvolvimento local

Requisitos: **Node.js 22+** (testado com 24) e npm 10+. Não é preciso conta na Cloudflare para rodar localmente.

```bash
npm install

# 1) API
cp apps/api/.dev.vars.example apps/api/.dev.vars
# gere um segredo e coloque em AUTH_SECRET dentro de apps/api/.dev.vars:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm run db:migrate:local -w @mynotes/api      # cria o banco D1 local (.wrangler/)
npm run dev:api                               # http://localhost:8787  (docs: /api/v1/docs)
# ditado local: `npx wrangler login` e `npm run dev:ai -w @mynotes/api` (usa o Workers AI da sua conta)
# assistente de IA (opcional): coloque OPENAI_API_KEY=sk-... em apps/api/.dev.vars e confira sem gastar crédito:
npm run ai:check -w @mynotes/api              # valida chave e modelo (gratuito); `-- --ping` faz 1 chamada mínima

# 2) Conta (em outro terminal) — veja a seção seguinte
npm run create-user -w @mynotes/api -- --username seu_usuario

# 3) Frontend
cp apps/web/.env.example apps/web/.env.local   # VITE_API_URL=http://localhost:8787
npm run dev:web                               # http://localhost:5173
```

> O npm 11 pede aprovação para scripts de instalação. Se `esbuild` ou `workerd` não funcionarem após o `npm install`, rode `npm approve-scripts esbuild workerd` e `npm rebuild esbuild workerd`.

## Criar a conta

O MyNotes tem **uma única conta** e **nenhum endpoint de cadastro**. A conta é criada por um script executado na sua máquina:

```bash
# banco local (desenvolvimento)
npm run create-user -w @mynotes/api -- --username joao --display-name "João"

# banco de produção (requer `npx wrangler login` e o D1 já criado/migrado)
npm run create-user -w @mynotes/api -- --username joao --display-name "João" --remote

# esqueci a senha / quero trocar pelo terminal (encerra todas as sessões)
npm run create-user -w @mynotes/api -- --username joao --reset-password --remote
```

A senha é lida sem eco no terminal, derivada localmente com Argon2id e **somente hashes** vão para o D1. O script recusa criar uma segunda conta. Use pelo menos 12 caracteres — uma frase longa é o ideal.

## Testes e verificações

```bash
npm run lint          # ESLint
npm run typecheck     # tsc em shared, api e web
npm test              # unitários (shared, web) + API completa no runtime Workers (D1/R2 locais)
npm run build         # build de produção do frontend
npm run test:e2e      # Playwright: API real + build de produção (1ª vez: npx playwright install chromium)
npm run test:ai-live -w @mynotes/api   # opcional: 3 turnos REAIS do assistente contra a OpenAI (≈ US$ 0,001)
```

Cobertura principal: criação de conta, login/logout/expiração/renovação/replay, proteção de **todas** as rotas privadas (gerada a partir do OpenAPI), CORS, validação e erros, CRUD e hierarquia profunda de assuntos, notas com conflito de versão e idempotência, upload/download/Range/links assinados/purga no R2, leituras, planos, sessões, relações, mapas, grafo, busca, configurações, backup (ida e volta, mesclagem, substituição, rejeição atômica de dados inconsistentes) e, no navegador, salvamento automático, recarregar imediatamente após digitar, edição offline, conflito entre dispositivos, PDF, backup e layout móvel.

## Publicação (resumo)

O passo a passo completo está em [docs/deploy.md](docs/deploy.md).

1. **Cloudflare:** `npx wrangler login` → `npx wrangler d1 create mynotes` (copie o `database_id` para `apps/api/wrangler.jsonc`) → `npx wrangler r2 bucket create mynotes-files` → ajuste `ALLOWED_ORIGINS` em `wrangler.jsonc` → `npx wrangler secret put AUTH_SECRET` → (assistente, opcional) `npx wrangler secret put OPENAI_API_KEY` → `npm run db:migrate:remote -w @mynotes/api` → `npm run deploy -w @mynotes/api` → crie a conta com `--remote`.
2. **GitHub Pages:** em *Settings › Pages*, fonte **GitHub Actions**; em *Settings › Secrets and variables › Actions › Variables*, defina `MYNOTES_API_URL` (URL do Worker) e, se usar domínio próprio ou repositório `<usuário>.github.io`, `MYNOTES_BASE_PATH=/`. Cada push em `main` publica o frontend.
3. **Worker pelo GitHub (opcional):** secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` e o workflow manual *Publicar API*, que verifica as migrações pendentes e bloqueia migrações destrutivas sem confirmação explícita.

## Configuração de CORS

A API só responde a origens listadas **exatamente** em `ALLOWED_ORIGINS` (separadas por vírgula, sem barra final, sem curingas):

```jsonc
// apps/api/wrangler.jsonc
"vars": { "ALLOWED_ORIGINS": "https://seu-usuario.github.io" }
```

A origem é só esquema + host (+ porta): para `https://seu-usuario.github.io/mynotes/` a origem é `https://seu-usuario.github.io`. Com domínio próprio, use-o (ex.: `https://notas.seudominio.com`). Localmente, `.dev.vars` já libera `http://localhost:5173`. A autenticação usa token Bearer (não cookies), então `credentials` fica desativado.

## Segurança em resumo

- Senha: **Argon2id (64 MiB, 2 passagens) no dispositivo** + PBKDF2-SHA256 com salt próprio no servidor. A senha nunca trafega nem é armazenada; mensagens de erro de login são genéricas; tentativas são limitadas por IP e por conta.
- Sessão: token de acesso de 15 min **apenas em memória**; renovação assinada por uma **chave ECDSA não extraível** do dispositivo (IndexedDB) a partir de um desafio de uso único. Nenhum token de longa duração no navegador. Tokens no banco somente como hash SHA-256.
- Autorização verificada no servidor em todas as rotas privadas (negação por padrão); cada consulta é filtrada pelo dono.
- R2 privado: sem URLs públicas permanentes; download autenticado ou link HMAC de 5 minutos.
- CSP no frontend, cabeçalhos de segurança na API, validação Zod de todas as entradas, logs sem corpo de requisições, tokens ou conteúdo.
- Segredos: `AUTH_SECRET` e, para o assistente, `OPENAI_API_KEY` (Wrangler secrets; localmente em `apps/api/.dev.vars`, ignorado pelo git). Nada sensível em arquivos versionados ou em variáveis `VITE_*` — tudo que vai para o frontend é público.

Detalhes, modelo de ameaças e alternativas (como cookies com domínio próprio) em [docs/security.md](docs/security.md).

## Backup e recuperação

- **Exportação pelo app** (*Configurações › Backup*): ZIP com `manifest.json`, `data/<tabela>.json` e `files/<id>`. Guarde cópias fora da Cloudflare.
- **Importação:** validada no navegador e no servidor e aplicada em uma única transação. **Mesclar** nunca duplica (IDs estáveis; prevalece a cópia mais recente); **Substituir** exige digitar `SUBSTITUIR`.
- **Infraestrutura:** o D1 tem *Time Travel* (restauração para qualquer minuto dos últimos 7 dias no plano gratuito, 30 no pago) via `wrangler d1 time-travel restore`. O R2 **não** é coberto pelo Time Travel: arquivos apagados definitivamente (lixeira esvaziada) só voltam por um backup exportado com arquivos.

A exportação manual não substitui as medidas operacionais — veja [docs/backup.md](docs/backup.md) para a rotina recomendada e os procedimentos de restauração.

## Limites do plano gratuito da Cloudflare

Valores vigentes consultados durante o desenvolvimento; confira as páginas oficiais, pois mudam.

| Serviço | Limite gratuito relevante | Impacto no MyNotes |
|---|---|---|
| Workers | 100 mil requisições/dia; **10 ms de CPU** por requisição; 50 subrequisições | O hashing pesado roda no navegador. Notas perto do tamanho máximo (600 KB) ou importações grandes podem exceder a CPU; nesse caso o plano Workers Paid (US$ 5/mês) resolve. |
| D1 | 5 GB; 500 MB por banco; 5 milhões de linhas lidas e 100 mil escritas por dia; 50 consultas por invocação; 100 parâmetros e 100 KB por instrução; linha de até 2 MB | Esquema e importação foram desenhados dentro desses limites (busca com `instr`, importação em uma instrução por tabela). |
| R2 | 10 GB/mês; 1 milhão de operações classe A e 10 milhões de classe B por mês; sem custo de saída | O Worker aceita até 100 MB por requisição; arquivos maiores são enviados em partes de 50 MB (multipart do R2). O espaço usado conta na cota de 10 GB. |
| Cron | 5 gatilhos por conta | O MyNotes usa 1 (limpeza diária). |
| Workers AI | 10 mil *neurons*/dia (renova às 00h UTC = 21h de Brasília) | O ditado usa o Whisper large v3 turbo: cerca de 47 *neurons* por minuto de fala, ou seja, **~3,5 horas de ditado por dia** grátis. Silêncios não são enviados. Esgotada a cota, o app avisa e guarda o áudio para tentar de novo. |

## Limitações conhecidas

Coisas que **não** foram feitas (ou foram feitas de forma simplificada) nesta primeira versão:

- **Offline:** só a edição de notas funciona completamente offline (rascunho local + fila de envio). Os dados já visitados ficam legíveis offline pelo cache; as outras alterações (criar leitura, mover assunto etc.) exigem conexão e mostram erro se ela faltar — nada é simulado como salvo.
- **Busca:** por substrings, sem acentos e com todas as palavras; não há ranking por relevância além de “título primeiro” nem radicalização (*stemming*).
- **PDF:** o leitor baixa o arquivo inteiro antes de exibir (com progresso). Arquivos muito grandes consomem memória no celular; “Abrir em nova aba” usa o leitor do navegador com carregamento por partes.
- **Formatos:** EPUB e DOCX são guardados e baixados, mas não visualizados no app.
- **Mapas mentais:** conflito entre dispositivos é resolvido no mapa inteiro (manter o meu ou carregar o do servidor), sem mescla automática. No mapa gerado de um assunto, a disposição salva vale por assunto; se duas pessoas/dispositivos moverem nós ao mesmo tempo, vale a última gravação (é só apresentação).
- **Anotações de PDF:** associadas à **página** (e ao trecho selecionado, guardado como citação); ainda não há realce do trecho na posição exata do texto dentro da página.
- **Referências “/”:** apontam para assuntos, notas (inclusive resenhas e anotações), livros/leituras (com página opcional), documentos e conceitos. Referências quebradas são mostradas e reparáveis no editor e listadas em Busca › referências quebradas. Referências a um título (`#Seção`) seguem o texto do título: renomear o título as desliga (a nota continua abrindo).
- **Área de trabalho:** só em telas largas (no celular, a navegação continua de uma página por vez). A mesma nota pode ficar aberta em dois painéis: o editor que não está em uso acompanha as edições do outro (digitar nos dois ao mesmo tempo vale a última gravação). As abas e disposições ficam neste aparelho (não sincronizam).
- **Tags:** só em notas (incluindo resenhas e anotações). Se a formatação mudar no meio de uma tag (ex.: `#cri` em negrito + `tica`), ela é indexada inteira, mas o destaque no editor cobre só a primeira parte.
- **Excluir assunto mantendo conteúdo:** os subassuntos movidos para cima mantêm suas chaves de ordenação e podem ficar intercalados com os irmãos existentes (reordene arrastando).
- **Histórico de notas:** uma versão a cada 10 minutos de edição, até 50 por nota.
- **Lixeira:** não é esvaziada automaticamente.
- **Ditado:** precisa de conexão (sem ela, os trechos esperam na memória enquanto a página estiver aberta). O áudio não é guardado, só o texto. Fechar a nota antes de o último trecho chegar descarta esse trecho. No celular, a gravação para se a tela bloquear ou o app for para segundo plano (o app pede para manter a tela acesa durante o ditado).
- **Assistente de IA:** sem leitura do texto dos PDFs; itens recém-indexados levam até ~1 minuto para aparecer na busca por sentido; detalhes em [docs/ai.md](docs/ai.md#limitações-conhecidas).
- **Proteção contra abuso:** a API limita tentativas de login; para proteção extra contra volume, configure uma regra de *rate limiting* da Cloudflare (WAF) para a rota do Worker.

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| Login falha com “Não foi possível conectar ao servidor” | `VITE_API_URL` errada, Worker fora do ar ou origem ausente em `ALLOWED_ORIGINS` (veja o console: erro de CORS). |
| “AUTH_SECRET is not configured” nos logs do Worker | Rode `npx wrangler secret put AUTH_SECRET` (mínimo de 32 caracteres). |
| Telas em branco após publicar | `BASE_PATH` diferente do caminho real do Pages; ajuste `MYNOTES_BASE_PATH`. |
| “Uma nova versão do MyNotes foi publicada” | Recarregue: os arquivos antigos foram substituídos pelo novo deploy. |
| Sessão some ao abrir em outro navegador | Esperado: cada navegador tem sua própria chave e precisa entrar uma vez. |
| “O assistente de IA não está configurado” / outros erros da IA | Veja [docs/ai.md › Solução de problemas](docs/ai.md#solução-de-problemas) e rode `npm run ai:check -w @mynotes/api`. |
| Esqueci a senha | `npm run create-user -w @mynotes/api -- --username <usuário> --reset-password --remote`. |
