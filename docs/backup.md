# Backup e recuperação

Há duas camadas complementares. A exportação pelo app **não substitui** as medidas de infraestrutura, e vice-versa.

| Camada | Cobre | Não cobre |
|---|---|---|
| **Exportação pelo app** (ZIP) | Todos os dados e, opcionalmente, todos os arquivos; portável; guardável fora da Cloudflare | Alterações feitas depois da exportação |
| **D1 Time Travel** (automático) | Estado do banco em qualquer minuto dos últimos 7 dias (gratuito) ou 30 dias (pago) | Arquivos no R2; perdas mais antigas que a janela |
| **R2** | Durabilidade do armazenamento | Exclusões feitas por você (purga da lixeira) — não há versionamento de objetos configurado |

## Rotina recomendada

1. Exportar um backup **com arquivos** pelo menos uma vez por semana (e antes de qualquer migração ou importação no modo “Substituir”).
2. Guardar a cópia fora da Cloudflare (disco externo ou nuvem pessoal), de preferência cifrada.
3. Manter pelo menos as últimas 4 cópias.
4. Testar uma restauração ocasionalmente num ambiente local (`npm run dev:api` + importação).

## Formato do arquivo (versão 1)

```
mynotes-backup-AAAA-MM-DD.zip
├── manifest.json
├── data/
│   ├── topics.json            notes.json            note_revisions.json
│   ├── note_links.json        documents.json        concepts.json
│   ├── readings.json          reading_plans.json    reading_plan_items.json
│   ├── study_sessions.json    study_session_notes.json  study_session_documents.json
│   ├── relations.json         mind_maps.json        favorites.json
│   ├── activity_events.json   settings.json
└── files/
    └── <id-do-documento>      (binário original, quando incluído)
```

`manifest.json`:

```json
{
  "format": "mynotes-backup",
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-10-13T22:00:00.000Z",
  "counts": { "topics": 12, "notes": 48 },
  "files": ["<id>", "..."]
}
```

- Cada `data/<tabela>.json` é um array de linhas com os nomes de coluna do banco (snake_case), sem `user_id`. Os campos aceitos estão definidos em `packages/shared/src/backup.ts` (o mesmo schema valida a importação no navegador e no servidor).
- Colunas JSON (`notes.content`, `note_revisions.content`, `mind_maps.data`, `settings.value`) vêm como **strings** JSON.
- Datas e horários em ISO-8601 UTC; datas de calendário como `AAAA-MM-DD`.
- Dados de autenticação (usuário, hashes, sessões, tokens) **nunca** são exportados, nem as chaves internas do R2.

**Ligações sugeridas:** entram no backup (inclusive as dispensadas, que assim não voltam depois de restaurar).

**Revisar:** os cartões (com a agenda do FSRS), as respostas, as sessões e as recordações livres entram no backup; as perguntas da IA que ainda esperam aprovação não (são um cache, apagadas depois de 30 dias).

**Oratória:** as falas, a trilha (práticas, progresso, habilidades) e os discursos entram no backup; as **gravações de áudio não** (ficam só no R2 e são apagadas com a fala), nem o cache de exercícios gerados pela IA e as inscrições de notificação, que são do aparelho.

## Importação

1. O arquivo é lido e validado **no navegador** (estrutura, versão do formato, cada linha, ciclos e referências ausentes na hierarquia). Problemas são listados antes de qualquer envio.
2. As linhas são enviadas em partes para uma área temporária (`import_chunks`), cada parte revalidada pelo servidor.
3. O *commit* aplica tudo numa **única transação D1**: tabelas em ordem de dependência, uma instrução `INSERT … SELECT FROM json_each(…)` por tabela. Chave estrangeira inválida ou ciclo na hierarquia abortam a transação inteira — **nada muda**.
4. Os arquivos dos documentos que ficaram pendentes são enviados a partir do ZIP.

| Modo | Comportamento |
|---|---|
| **Mesclar** (padrão) | Insere o que não existe; atualiza um item existente só se a cópia do backup for mais recente (`updated_at`). Nada é apagado. Reimportar o mesmo arquivo não duplica nem altera nada. |
| **Substituir** | O estado final fica igual ao backup: itens ausentes do arquivo são apagados (inclusive seus arquivos no R2). Exige digitar `SUBSTITUIR`. |

Documentos importados sem arquivo ficam como “arquivo pendente”; é possível enviar o arquivo depois na página do documento. Se um documento já existia com o mesmo tamanho, o arquivo atual é mantido.

## Restauração com o D1 Time Travel

Para desfazer um erro grave no banco (ex.: importação “Substituir” indesejada):

```bash
cd apps/api
npx wrangler d1 time-travel info DB                                  # bookmark atual (guarde-o!)
npx wrangler d1 time-travel restore DB --timestamp=2026-10-13T21:00:00Z
```

O comando restaura **todo** o banco para aquele instante — alterações posteriores são perdidas (o bookmark anterior permite voltar). Arquivos no R2 não são afetados: se documentos foram purgados, restaure-os a partir de um backup com arquivos (modo Mesclar).

## Exportação bruta do D1 (opcional)

```bash
npx wrangler d1 export mynotes --remote --output mynotes.sql
```

Gera um dump SQL completo (inclui tabelas de autenticação — trate como sensível). Útil como cópia adicional; para restaurar dados no app, prefira o ZIP.

## Recuperação de acesso

- **Senha esquecida:** `npm run create-user -w @mynotes/api -- --username <usuário> --reset-password --remote`.
- **Aparelho perdido:** entre em outro aparelho e revogue a sessão em *Configurações › Sessões ativas*, ou troque a senha (revoga todas as outras sessões).
