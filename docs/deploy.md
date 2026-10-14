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

### Pelo GitHub Actions (opcional)

O workflow **Publicar API** (`.github/workflows/deploy-worker.yml`) é **manual**:

1. Crie um token em *Cloudflare › My Profile › API Tokens* com as permissões *Account › Workers Scripts: Edit* e *Account › D1: Edit* (e *Workers R2 Storage: Read* se quiser que o deploy valide o bucket).
2. No GitHub: *Settings › Secrets and variables › Actions › Secrets*: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
3. Em *Settings › Environments*, crie `production` e, se quiser uma aprovação manual a cada deploy, adicione você como *required reviewer*.
4. Em *Actions › Publicar API › Run workflow*, marque “Aplicar migrações” quando houver migrações novas.

O workflow roda os testes, lista as migrações pendentes no D1 remoto e **recusa** migrações com `DROP`, `DELETE FROM`, `ALTER TABLE … DROP/RENAME` ou `UPDATE … SET` fora de triggers, a menos que “Permitir migrações destrutivas” seja marcado. Antes de marcar, exporte um backup e anote o horário para um eventual *Time Travel*.

**Migração `0002_knowledge_links.sql`** (aditiva, sem `UPDATE`/`DELETE`): novas colunas em `notes` (`role`, `reading_id`, `page`, `annotation_type`, `quote`, `index_version`) e as tabelas `note_tags` e `view_layouts`. Aplique-a **antes** de publicar o Worker novo: `npm run db:migrate:remote -w @mynotes/api`, depois `npm run deploy -w @mynotes/api`. O frontend publicado pelo GitHub Pages depende da API nova (referências, tags, livros); publique a API primeiro. Para reverter, exporte um backup e remova as tabelas novas; as colunas novas são ignoradas por versões anteriores da API.

Ordem segura para mudanças de esquema: migrações **aditivas** primeiro (novas tabelas/colunas com valor padrão), depois o código que as usa; remoções só numa migração posterior, quando nenhum código depender da estrutura antiga.

## 2. GitHub Pages — frontend

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
