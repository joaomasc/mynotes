# Arquitetura

```
 Navegador (notebook / celular)                         Cloudflare
┌──────────────────────────────────────┐   HTTPS    ┌───────────────────────────────┐
│ SPA React (GitHub Pages, PWA)        │  Bearer    │ Worker (Hono)  /api/v1        │
│  ├ TanStack Query (cache IndexedDB)  │ ─────────► │  ├ middleware: CORS, auth,    │
│  ├ notes-sync (rascunhos IndexedDB)  │            │  │  idempotência, erros       │
│  ├ Argon2id em Web Worker            │ ◄───────── │  ├ módulos de domínio         │
│  └ chave ECDSA não extraível         │   JSON     │  ├ D1 (SQLite)  ── dados      │
└──────────────────────────────────────┘            │  ├ R2           ── arquivos   │
                                                    │  └ Cron diário  ── limpeza    │
                                                    └───────────────────────────────┘
```

## Pacotes

| Pacote | Conteúdo |
|---|---|
| `packages/shared` | Contrato: schemas Zod de entrada e saída, tipos, constantes (limites, tipos de arquivo), análise de texto rico, busca, ordenação fracionária, UUID v7 e formato de backup. Usado pelos dois lados. |
| `apps/api` | `src/app.ts` monta middlewares e rotas; `src/modules/<domínio>/routes.ts` (HTTP + OpenAPI) e `service.ts` (regras e SQL); `src/lib/` (crypto, db, erros, paginação, entidades); `migrations/`; `scripts/` (conta, verificação de migrações). |
| `apps/web` | `src/features/<área>/` (páginas e componentes de cada domínio), `src/lib/` (cliente HTTP, autenticação, sincronização, backup, uploads), `src/components/` (UI e layout). |

## Módulos da API (`/api/v1`)

| Módulo | Rotas principais |
|---|---|
| auth | `prelogin`, `login`, `challenge`, `refresh`, `logout`, `me`, `sessions`, `password` |
| topics | árvore, CRUD, `move`, exclusão com modo |
| notes | lista paginada (filtros por assunto, papel, livro e `tag`), CRUD, `move`, `revisions`, `backlinks/{tipo}/{id}`, `tags` |
| references | `references/suggest` (menu “/” do editor), `references/resolve` (título atual / referência quebrada), `topics/{id}/context`, `layouts/{chave}` |
| documents | metadados, `PUT content` (streaming), `GET content` (Range), `link` assinado, `files/{id}` |
| readings, plans, study-sessions | CRUD, filtros, etapas, estatísticas |
| concepts, relations, mind-maps, graph | conhecimento e visualização |
| search, dashboard, favorites, activity, settings, trash | transversais |
| backup | `manifest`, `export/{tabela}`, `imports` (+ `chunks`, `commit`) |

Documentação viva: `GET /api/v1/docs` (Scalar) e `GET /api/v1/openapi.json`.

Formato das respostas: `{ "data": … }`; listas paginadas `{ "data": [...], "meta": { "nextCursor": "…" | null } }` (paginação por *keyset*); erros `{ "error": { "code", "message", "details?", "requestId" } }`.

## Modelo de dados (D1)

| Tabela | Observações |
|---|---|
| `users`, `sessions`, `access_tokens`, `auth_nonces`, `login_attempts` | Autenticação (só hashes). |
| `topics` | Hierarquia por `parent_id` (profundidade ilimitada, consultas recursivas), `sort_key` fracionária. |
| `notes`, `note_revisions`, `note_links`, `note_tags` | Conteúdo em JSON do editor + texto plano e texto de busca derivados; referências internas e #tags extraídas a cada salvamento. `role` diz se é nota, **resenha** (`review`) ou **anotação de página** (`annotation`, com `reading_id`, `page`, `annotation_type` e `quote`). |
| `documents` | Metadados; `storage_key` aleatória no R2; estado `pending/ready/failed`. |
| `readings`, `reading_plans`, `reading_plan_items` | Livros/leituras (com PDF opcional via `document_id` e página atual) e planos com etapas ordenáveis. |
| `study_sessions`, `study_session_notes`, `study_session_documents` | Diário com referências (chaves estrangeiras reais). |
| `concepts`, `relations` | Relações tipadas entre assunto, nota, documento, leitura e conceito (generaliza `topic_relations`). |
| `mind_maps` | Mapa inteiro em JSON validado (nós, conexões, viewport). |
| `favorites`, `activity_events`, `settings` | Transversais. |
| `view_layouts` | Disposição visual de visualizações geradas (posições e ramos recolhidos do mapa mental de um assunto). Nunca é lida para inferir hierarquia ou relações. |
| `idempotency_keys`, `import_jobs`, `import_chunks`, `import_guard` | Infraestrutura de sincronização e backup. |

Regras de integridade:

- Todas as tabelas têm datas de criação/atualização em ISO-8601 UTC e `version` para controle otimista.
- **Exclusão lógica** (lixeira) em assuntos, notas e documentos, com `delete_batch` para restaurar juntos os itens excluídos juntos; os demais itens são excluídos fisicamente após confirmação.
- Chaves estrangeiras com `ON DELETE CASCADE`/`SET NULL` conforme o caso; referências polimórficas (relações, favoritos, links) são limpas por *triggers* ao excluir definitivamente.
- Excluir um assunto oferece mover o conteúdo para o assunto pai ou enviar tudo à lixeira; leituras, planos, sessões, conceitos e mapas nunca são apagados junto — apenas desvinculados ao purgar.

## Modelo de conhecimento (migração 0002)

O **assunto** é a entidade central: “caderno” (raiz), “matéria” (filho) e “subassunto” (demais níveis) são só nomes de apresentação da mesma tabela `topics`, sem limite de profundidade.

- **Uma única fonte de verdade por conteúdo.** A resenha de um livro (“Minha resenha”) e as anotações por página **são notas** (`notes.role`), ligadas ao livro por `reading_id`. Herdam o editor, o salvamento local-first, o histórico de versões, as referências, os backlinks e a busca; não há uma segunda tabela de texto. Excluir o livro mantém essas notas (`reading_id` vira `NULL`).
- **Referências com “/”.** O editor insere um nó `reference` com `href = mynotes:<tipo>/<id>` (ou `mynotes:reading/<id>/p/<página>`) e um rótulo. O identificador é a fonte de verdade; o rótulo é só um retrato para busca e fallback. Ao exibir, o app consulta `references/resolve` e mostra o **título atual** (renomear não quebra nada) ou marca a referência como **quebrada**, com opções de reparar (escolher outro item, manter como texto ou remover). Os links ficam em `note_links`, o mesmo índice dos links internos antigos, o que alimenta backlinks e o grafo.
- **Tags com “#”.** Texto comum (`#critica`), destacado no editor e indexado em `note_tags` em forma normalizada (minúsculas, sem acento). Código é ignorado; `C#`, `#1` e fragmentos de URL não são tags. Notas salvas antes da migração são indexadas aos poucos (`notes.index_version`), nas consultas de tags e na manutenção diária.
- **Livros e assuntos.** Um livro tem um assunto principal (`topic_id`) e pode se relacionar a outros por `relations`. A página do assunto (`topics/{id}/context`) mostra os livros do assunto e os relacionados, as anotações que citam o assunto, as notas que o mencionam, as tags e o tempo de estudo — tudo calculado dos dados reais.
- **Grafo e mapa mental são derivados.** O grafo vem da hierarquia, das relações, das referências (`links_to`) e das anotações (`annotates`). O mapa mental de um assunto usa os subassuntos como ramos. Arrastar nós não altera nada semântico: no grafo é só visual; no mapa, as posições vão para `view_layouts`. Mudar a hierarquia exige a ação explícita “Mover na hierarquia…”; relações conceituais criadas no grafo/mapa vão para `relations`.
- **Estudos** saiu da navegação principal, mas sessões, cronômetro e metas continuam (`/study`, link no painel de cada assunto e em Configurações).

## Busca

`search_text` guarda o texto sem acentos e em minúsculas, **alinhado caractere a caractere** com o original. A busca usa `instr()` (o D1 limita padrões `LIKE` a 50 bytes) para cada termo, prioriza títulos e recorta o trecho do texto original diretamente no SQL.

## Decisões motivadas pelos limites do plano gratuito

- Argon2id no cliente (10 ms de CPU por requisição no Worker).
- Upload em streaming direto para o R2 (`FixedLengthStream`), sem carregar o arquivo na memória do Worker.
- ZIP de backup montado/lido no navegador; exportação paginada por tabela; importação aplicada com uma instrução por tabela (limite de 50 consultas por invocação).
- Limpeza (tokens expirados, uploads abandonados, importações antigas) num único cron diário.
