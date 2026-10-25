# Publicação

O frontend (GitHub Pages) e a API (Cloudflare Worker) são publicados separadamente. Primeiro a API, depois o frontend apontando para ela.

## 1. Cloudflare — API, D1 e R2

Pré-requisitos: conta na Cloudflare (o plano gratuito basta para começar; o R2 pode pedir um meio de pagamento cadastrado mesmo no uso gratuito) e o repositório clonado com `npm install` feito.

```bash
cd apps/api
npx wrangler login

# Banco de dados
npx wrangler d1 create mynotes
#  → copie o "database_id" impresso para d1_databases[0].database_id em wrangler.jsonc

# Bucket privado para os arquivos (não habilite acesso público nem domínio r2.dev)
npx wrangler r2 bucket create mynotes-files
```

Edite `apps/api/wrangler.jsonc`:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "ALLOWED_ORIGINS": "https://SEU_USUARIO.github.io",   // origem exata do frontend
  "SESSION_MAX_DAYS": "60",                             // duração máxima de uma sessão
  "SESSION_IDLE_DAYS": "14"                             // expira se o dispositivo não for usado
}
```

Segredo (fica cifrado na Cloudflare; nunca vai para o repositório):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put AUTH_SECRET
```

Assistente de IA (opcional; sem ele o resto do app funciona normalmente). A chave é pedida no terminal e fica cifrada na Cloudflare:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Modelo, limites e orçamento ficam em `vars` no `wrangler.jsonc` (veja [ai.md](ai.md#variáveis)). A migração `0003_ai_assistant.sql` só cria tabelas novas e passa pela verificação de migrações destrutivas.

`AUTH_SECRET` assina os desafios de renovação, os links de arquivo e os parâmetros falsos de login. Trocá-lo invalida links e desafios em andamento, mas **não** encerra sessões nem altera senhas.

Migrações, deploy e conta:

```bash
npm run db:migrate:remote        # aplica migrations/*.sql no D1 de produção
npm run deploy                   # publica o Worker → https://mynotes-api.<subdomínio>.workers.dev
cd ../..
npm run create-user -w @mynotes/api -- --username SEU_USUARIO --remote
curl https://mynotes-api.<subdomínio>.workers.dev/api/v1/health
```

A documentação interativa da API fica em `/api/v1/docs` (OpenAPI em `/api/v1/openapi.json`).

### Ligações sugeridas: migração 0011

A migração `0011_link_suggestions.sql` só cria a tabela, dois gatilhos e a coluna `knowledge_index.links_hash`: aplique-a antes de publicar o Worker. O limite de semelhança exibido pode ser ajustado com a variável `LINKS_MIN_SCORE` (padrão 0,62).

### Revisar: migração 0010

A migração `0010_review.sql` cria as tabelas da Revisão e **recria `study_sessions`** para aceitar sessões de origem "revisão" (o SQLite não altera uma restrição `CHECK`): as linhas e os vínculos com notas e documentos são copiados e devolvidos na mesma migração. Por ter `DROP TABLE` e `ALTER TABLE … RENAME`, o workflow a trata como destrutiva. Antes de aplicar: exporte um backup pelo app e anote o horário (para um eventual *Time Travel*). Depois, como sempre, `npm run db:migrate:remote -w @mynotes/api` e só então `npm run deploy -w @mynotes/api` e o frontend. O lembrete da Revisão usa as mesmas chaves VAPID da Oratória.

### Oratória: gravações, avaliação completa e lembretes

As migrações `0005` a `0008` (oratória) só criam tabelas e colunas: aplique-as com `npm run db:migrate:remote` **antes** de publicar o Worker, como sempre. As gravações guardadas usam o mesmo bucket R2 dos documentos (prefixo `speech/`). A avaliação completa usa a mesma `OPENAI_API_KEY` (modelo em `AI_AUDIO_MODEL`, veja [ai.md](ai.md#configuração)).

O lembrete diário (Web Push) precisa de um par de chaves VAPID, gerado uma vez:

```bash
npm run vapid -w @mynotes/api                 # imprime VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_PRIVATE_KEY     # cole a chave privada
```

e, em `apps/api/wrangler.jsonc`, nas `vars`: `"VAPID_PUBLIC_KEY": "<a chave pública>"` e `"VAPID_SUBJECT": "mailto:seu-email@exemplo.com"`. Sem as chaves, o resto da oratória funciona e a página de progresso avisa que os lembretes não estão configurados. Trocar as chaves invalida as inscrições: cada navegador precisa ativar o lembrete de novo.

### Pelo GitHub Actions (opcional)

O workflow **Publicar API** (`.github/workflows/deploy-worker.yml`) é **manual**:

1. Crie um token em *Cloudflare › My Profile › API Tokens* com as permissões *Account › Workers Scripts: Edit* e *Account › D1: Edit* (e *Workers R2 Storage: Read* se quiser que o deploy valide o bucket). O ditado usa o binding `AI` (Workers AI), cobrado da cota gratuita da conta; se o deploy reclamar de permissão para ele, acrescente *Account › Workers AI: Read*.
2. No GitHub: *Settings › Secrets and variables › Actions › Secrets*: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
3. Em *Settings › Environments*, crie `production` e, se quiser uma aprovação manual a cada deploy, adicione você como *required reviewer*.
4. Em *Actions › Publicar API › Run workflow*, marque “Aplicar migrações” quando houver migrações novas.

O workflow roda os testes, lista as migrações pendentes no D1 remoto e **recusa** migrações com `DROP`, `DELETE FROM`, `ALTER TABLE … DROP/RENAME` ou `UPDATE … SET` fora de triggers, a menos que “Permitir migrações destrutivas” seja marcado. Antes de marcar, exporte um backup e anote o horário para um eventual *Time Travel*.

**Migração `0002_knowledge_links.sql`** (aditiva, sem `UPDATE`/`DELETE`): novas colunas em `notes` (`role`, `reading_id`, `page`, `annotation_type`, `quote`, `index_version`) e as tabelas `note_tags` e `view_layouts`. Aplique-a **antes** de publicar o Worker novo: `npm run db:migrate:remote -w @mynotes/api`, depois `npm run deploy -w @mynotes/api`. O frontend publicado pelo GitHub Pages depende da API nova (referências, tags, livros); publique a API primeiro. Para reverter, exporte um backup e remova as tabelas novas; as colunas novas são ignoradas por versões anteriores da API.

Ordem segura para mudanças de esquema: migrações **aditivas** primeiro (novas tabelas/colunas com valor padrão), depois o código que as usa; remoções só numa migração posterior, quando nenhum código depender da estrutura antiga.

## 2. Frontend na Cloudflare (`mynotes-web`) — usado hoje

O app publicado em `https://mynotes-web.joaomasc-dev.workers.dev` é um Worker só de arquivos estáticos (`apps/web/wrangler.jsonc`, com fallback de SPA para links diretos). Ele **não** é publicado pelo push: depois de `npx wrangler login`, rode

```bash
npm run deploy -w @mynotes/web   # build apontando para a API de produção + wrangler deploy
```

Publique a API antes quando o frontend depender de rotas novas (ex.: ditado → `/transcriptions`). Para outra URL de API: `MYNOTES_API_URL=https://… npm run deploy -w @mynotes/web`.

## 2b. GitHub Pages — frontend (alternativa)

1. *Settings › Pages › Build and deployment › Source*: **GitHub Actions**.
2. *Settings › Secrets and variables › Actions › Variables* (variáveis públicas, não secrets):
   - `MYNOTES_API_URL` = `https://mynotes-api.<subdomínio>.workers.dev` (sem `/api/v1`, sem barra final).
   - `MYNOTES_BASE_PATH` (opcional) = `/` se usar domínio próprio ou um repositório `<usuário>.github.io`. O padrão é `/<nome-do-repositório>/`.
3. Faça push em `main`. O workflow **Publicar frontend** verifica as variáveis, roda typecheck e testes do app e publica `apps/web/dist`.

O build copia `index.html` para `404.html`, então links diretos (`/notes/<id>`) funcionam no Pages. O app é uma PWA: no celular, use “Adicionar à tela inicial”.

### Domínio próprio (opcional)

Com um domínio próprio para o Pages (ex.: `notas.seudominio.com`), atualize `ALLOWED_ORIGINS` para essa origem e defina `MYNOTES_BASE_PATH=/`. Para a API, você pode usar uma rota/domínio próprio no Worker (ex.: `api.seudominio.com`) e apontar `MYNOTES_API_URL` para ele.

## 3. Checklist pós-publicação

- [ ] `GET /api/v1/health` responde `ok`.
- [ ] Login funciona no notebook e no celular (cada dispositivo entra uma vez).
- [ ] *Configurações › Sessões ativas* lista os dois aparelhos.
- [ ] Criar uma nota no celular e vê-la no notebook (ao focar a janela ou recarregar).
- [ ] Enviar um PDF e abri-lo nos dois aparelhos.
- [ ] Exportar o primeiro backup e guardá-lo fora da Cloudflare.
- [ ] Ativar 2FA nas contas da Cloudflare e do GitHub.
