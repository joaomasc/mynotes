# MyNotes

Ambiente pessoal de conhecimento e estudos: assuntos hierárquicos, notas, biblioteca de PDFs, leituras, planos, diário de estudos, mapas mentais e grafo de conhecimento — com conta única, sincronização entre notebook e celular e backup completo.

- **Frontend:** React 19 + TypeScript + Vite + Tailwind, publicado no **GitHub Pages** (PWA instalável).
- **Backend:** API REST em **Cloudflare Workers** (Hono + Zod/OpenAPI), banco **D1**, arquivos no **R2**.
- **Fonte oficial dos dados:** o servidor. O navegador mantém apenas cache de leitura e rascunhos de notas ainda não enviados.

> Documentação detalhada: [arquitetura](docs/architecture.md) · [segurança](docs/security.md) · [sincronização e conflitos](docs/sync.md) · [backup e recuperação](docs/backup.md) · [publicação](docs/deploy.md)

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
| **Assuntos** | Árvore com profundidade ilimitada; criar, editar, cor, mover (arrastar e soltar no desktop ou “Mover para…”), reordenar, expandir/recolher (lembrado por dispositivo), excluir mantendo o conteúdo ou enviando tudo à lixeira. |
| **Notas** | Editor rico (títulos, listas, tarefas, citações, código, links), links internos para notas/assuntos/documentos/leituras/conceitos, salvamento automático com indicador, rascunho local resistente a recarregamento e queda de conexão, histórico de versões com restauração, “mencionada em” (backlinks), relações, favoritos, mover entre assuntos. |
| **Biblioteca** | Upload com progresso (PDF, PNG, JPEG, WebP, EPUB, DOCX, TXT, Markdown — até 95 MB), validação de tipo pela assinatura do arquivo, nomes internos aleatórios no R2, download autenticado, links assinados de 5 minutos, leitor de PDF no app (zoom, páginas, texto selecionável), busca e filtros. EPUB e DOCX: apenas download. |
| **Leituras e planos** | Status, progresso por páginas ou %, datas, prazo, prioridade, vínculo com assunto e documento; filtros (em andamento, atrasadas…); planos com etapas ordenáveis, prazos e progresso. |
| **Diário de estudos** | Cronômetro (iniciar/pausar/retomar/finalizar) sincronizado entre dispositivos, registro manual, avaliação de progresso, referências a notas e documentos, histórico, calendário mensal e estatísticas (total, dias ativos, média por dia ativo, tempo por dia e por assunto), meta semanal. |
| **Conhecimento** | Relações tipadas entre assuntos, notas, documentos, leituras e conceitos; mapas mentais (nós, subnós, conexões, cores, vínculos a itens, organização automática, exportar/importar JSON); grafo com filtros, busca, foco na vizinhança e legenda. |
| **Painel e busca** | Continuar de onde parou, notas recentes, leituras em andamento e atrasadas, próximas metas, resumo de estudos, favoritos, assuntos. Busca global sem acentos (Ctrl/⌘+K) com trechos do texto. |
| **Backup** | Exportação ZIP (JSON por tabela + arquivos) e importação validada e atômica, em modo mesclar ou substituir. |
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
```

Cobertura principal: criação de conta, login/logout/expiração/renovação/replay, proteção de **todas** as rotas privadas (gerada a partir do OpenAPI), CORS, validação e erros, CRUD e hierarquia profunda de assuntos, notas com conflito de versão e idempotência, upload/download/Range/links assinados/purga no R2, leituras, planos, sessões, relações, mapas, grafo, busca, configurações, backup (ida e volta, mesclagem, substituição, rejeição atômica de dados inconsistentes) e, no navegador, salvamento automático, recarregar imediatamente após digitar, edição offline, conflito entre dispositivos, PDF, backup e layout móvel.

## Publicação (resumo)

O passo a passo completo está em [docs/deploy.md](docs/deploy.md).

1. **Cloudflare:** `npx wrangler login` → `npx wrangler d1 create mynotes` (copie o `database_id` para `apps/api/wrangler.jsonc`) → `npx wrangler r2 bucket create mynotes-files` → ajuste `ALLOWED_ORIGINS` em `wrangler.jsonc` → `npx wrangler secret put AUTH_SECRET` → `npm run db:migrate:remote -w @mynotes/api` → `npm run deploy -w @mynotes/api` → crie a conta com `--remote`.
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
- Segredos: apenas `AUTH_SECRET` (Wrangler secret). Nada sensível em arquivos versionados ou em variáveis `VITE_*` — tudo que vai para o frontend é público.

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
| R2 | 10 GB/mês; 1 milhão de operações classe A e 10 milhões de classe B por mês; sem custo de saída | Uploads limitados a 95 MB pelo corpo máximo de requisição do Worker (100 MB). |
| Cron | 5 gatilhos por conta | O MyNotes usa 1 (limpeza diária). |

## Limitações conhecidas

Coisas que **não** foram feitas (ou foram feitas de forma simplificada) nesta primeira versão:

- **Offline:** só a edição de notas funciona completamente offline (rascunho local + fila de envio). Os dados já visitados ficam legíveis offline pelo cache; as outras alterações (criar leitura, mover assunto etc.) exigem conexão e mostram erro se ela faltar — nada é simulado como salvo.
- **Busca:** por substrings, sem acentos e com todas as palavras; não há ranking por relevância além de “título primeiro” nem radicalização (*stemming*).
- **PDF:** o leitor baixa o arquivo inteiro antes de exibir (com progresso). Arquivos muito grandes consomem memória no celular; “Abrir em nova aba” usa o leitor do navegador com carregamento por partes.
- **Formatos:** EPUB e DOCX são guardados e baixados, mas não visualizados no app.
- **Mapas mentais:** conflito entre dispositivos é resolvido no mapa inteiro (manter o meu ou carregar o do servidor), sem mescla automática.
- **Excluir assunto mantendo conteúdo:** os subassuntos movidos para cima mantêm suas chaves de ordenação e podem ficar intercalados com os irmãos existentes (reordene arrastando).
- **Histórico de notas:** uma versão a cada 10 minutos de edição, até 50 por nota.
- **Lixeira:** não é esvaziada automaticamente.
- **Proteção contra abuso:** a API limita tentativas de login; para proteção extra contra volume, configure uma regra de *rate limiting* da Cloudflare (WAF) para a rota do Worker.

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| Login falha com “Não foi possível conectar ao servidor” | `VITE_API_URL` errada, Worker fora do ar ou origem ausente em `ALLOWED_ORIGINS` (veja o console: erro de CORS). |
| “AUTH_SECRET is not configured” nos logs do Worker | Rode `npx wrangler secret put AUTH_SECRET` (mínimo de 32 caracteres). |
| Telas em branco após publicar | `BASE_PATH` diferente do caminho real do Pages; ajuste `MYNOTES_BASE_PATH`. |
| “Uma nova versão do MyNotes foi publicada” | Recarregue: os arquivos antigos foram substituídos pelo novo deploy. |
| Sessão some ao abrir em outro navegador | Esperado: cada navegador tem sua própria chave e precisa entrar uma vez. |
| Esqueci a senha | `npm run create-user -w @mynotes/api -- --username <usuário> --reset-password --remote`. |
