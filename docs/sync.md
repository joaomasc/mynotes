# Sincronização e conflitos

## Princípios

1. **O servidor (D1/R2) é a fonte oficial.** Nada é mostrado como “Salvo/Sincronizado” antes da confirmação do servidor.
2. **IDs estáveis gerados no cliente** (UUID v7). Criar com um id já existente devolve o item existente: repetir uma criação nunca duplica.
3. **Controle de versão otimista.** Todo item tem `version`; cada alteração envia a `baseVersion` em que se baseou. Se o item mudou nesse meio-tempo, a API responde `409 version_conflict` com a cópia atual em `details.current`.
4. **Idempotência.** Toda mutação do app envia `Idempotency-Key`. Uma repetição (ex.: a resposta se perdeu na rede) devolve a resposta original em vez de aplicar de novo; a mesma chave com outro conteúdo é rejeitada (422). As chaves ficam guardadas por 24 h.
5. **Repetição segura.** Falhas de rede e 502/503/504 são repetidas até 2 vezes, com espera crescente, sempre com a mesma chave de idempotência.

## Notas (local-first)

```
digitação ──350 ms──► rascunho no IndexedDB (status: pending)
                      └─1,2 s─► PATCH /notes/:id {baseVersion, title, content}
                                 ├─ 200 → apaga o rascunho (se não houve novas edições) → "Salvo"
                                 │        └─ houve edições durante o envio → reenvia sobre a nova versão
                                 ├─ rede → mantém o rascunho → "Offline — salvo neste aparelho"
                                 └─ 409 → rascunho vira "conflict" e guarda a cópia do servidor
```

- Ao fechar/ocultar a página com edições ainda não gravadas, uma cópia de emergência é escrita de forma **síncrona** (`localStorage`) e migrada para o IndexedDB na próxima abertura — assim nem os últimos caracteres se perdem num recarregamento imediato.
- Rascunhos pendentes são reenviados ao iniciar o app, quando a conexão volta, quando a aba volta a ficar visível e a cada 20 s enquanto houver pendências — inclusive de notas que não estão abertas.
- Ao abrir uma nota com rascunho local:
  - rascunho baseado na versão atual do servidor → é restaurado e enviado;
  - rascunho baseado numa versão antiga → conflito.
- O editor só inicia a partir de uma cópia **recém-buscada** do servidor (ou do cache, se estiver offline), para nunca editar sobre conteúdo desatualizado.

### Resolução de conflitos

A nota mostra um aviso com três opções:

| Opção | Efeito |
|---|---|
| **Manter a minha versão** | Minha versão é salva por cima da do servidor (a anterior continua no histórico de versões). |
| **Usar a do servidor** | Descarta o rascunho local e carrega a versão do servidor. |
| **Salvar a minha como nova nota** | Cria uma cópia com o meu texto e carrega a versão do servidor nesta nota. |

Nada é mesclado automaticamente: em texto livre, uma mescla silenciosa pode produzir resultados sem sentido. O histórico de versões (snapshot a cada 10 minutos de edição) permite recuperar estados anteriores.

## Demais itens

Assuntos, leituras, planos, sessões, documentos, relações, mapas e configurações usam a mesma API versionada, mas **exigem conexão** para alterar. Em caso de conflito (409), o app recarrega os dados e avisa; em mapas mentais, há a escolha entre manter o seu mapa ou carregar o do servidor. O cronômetro de estudos fica nas configurações do servidor, então pode ser iniciado no notebook e finalizado no celular.

## Cache e atualização

- As consultas usam TanStack Query com cache persistido no IndexedDB (até 7 dias) — os dados já vistos abrem instantaneamente e continuam legíveis offline.
- Os dados são revalidados ao focar a janela e após cada alteração confirmada.
- O cache, os rascunhos e a chave do dispositivo são apagados no logout (o app pede confirmação se houver notas não sincronizadas).

## Indicador de sincronização

| Estado | Significado |
|---|---|
| Sincronizado | Nenhuma alteração aguardando o servidor. |
| Salvando… | Requisições em andamento ou rascunhos sendo enviados. |
| Offline · N pendentes | Sem conexão; N notas com alterações guardadas no aparelho. |
| N conflitos | Notas alteradas em outro dispositivo aguardando sua decisão. |
| Falha ao salvar | Erro do servidor; passe o mouse/toque para ver a mensagem. |
