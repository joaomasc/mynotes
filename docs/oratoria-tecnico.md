# Oratória: como construímos

Planta técnica do professor de oratória dentro do MyNotes. O **quê** está em [oratoria.md](oratoria.md) (a régua) e [oratoria-trilha.md](oratoria-trilha.md) (a trilha); aqui está o **como**: de onde vem cada medida, onde ficam os dados, quais rotas e telas existem e em que ordem tudo é construído.

Princípio geral: **o navegador mede, o Worker só guarda e encaminha.** Toda análise de áudio roda no aparelho (o Worker tem 10 ms de CPU por requisição no plano gratuito e nunca decodifica áudio), a transcrição usa o Whisper do Workers AI que o ditado já usa, e a IA da OpenAI entra só para o que exige julgamento.

## Sumário

1. [Visão geral](#visão-geral)
2. [Captura e análise do áudio](#captura-e-análise-do-áudio)
3. [Transcrição](#transcrição)
4. [Métricas](#métricas)
5. [Avaliação](#avaliação)
6. [Conteúdo da trilha](#conteúdo-da-trilha)
7. [Dados](#dados)
8. [API](#api)
9. [Interface](#interface)
10. [Integração com o resto do MyNotes](#integração-com-o-resto-do-mynotes)
11. [Privacidade, limites e custos](#privacidade-limites-e-custos)
12. [Testes](#testes)
13. [Etapas](#etapas)
14. [Riscos e pontos a confirmar](#riscos-e-pontos-a-confirmar)

## Visão geral

```
 Navegador                                                 Cloudflare / OpenAI
┌───────────────────────────────────────────────┐        ┌────────────────────────────────┐
│ Microfone ─► AudioWorklet (captura)           │        │ Worker /api/v1                 │
│               │ 16 kHz                        │  WAV   │  ├ transcriptions ─► Whisper   │
│               ├► Segmenter ─► trechos WAV ────┼──────► │  │   (texto + tempos + conf.)  │
│               │   (fila em IndexedDB)         │ ◄───── │  │                             │
│               └► Analisador (Web Worker)      │        │  ├ speech/attempts ─► D1       │
│                   volume, tom, voz/silêncio   │        │  ├ speech/evaluate ─► OpenAI   │
│                                               │métricas│  │   (texto: estrutura,       │
│ Métricas (packages/shared, funções puras) ────┼──────► │  │    linguagem, reescritas)   │
│ Régua: estados determinísticos                │        │  └ speech/full-evaluation      │
│ Tela de resultado, trilha, progresso          │ ◄───── │      ─► OpenAI (áudio)         │
└───────────────────────────────────────────────┘        └────────────────────────────────┘
```

Fluxo de uma fala:

1. O gravador captura o áudio. O **Segmenter** do ditado corta trechos nas pausas e os envia ao Whisper; ao mesmo tempo, o **Analisador** mede volume, tom e voz/silêncio em todo o áudio, quadro a quadro.
2. Ao terminar, o app junta a linha do tempo acústica com as palavras e tempos do Whisper e calcula as **métricas** (funções puras em `packages/shared`).
3. A **régua** transforma as métricas em estados (bom / atenção / a melhorar) sem custo.
4. O app salva a tentativa e pede à IA a **avaliação de texto** (estrutura, linguagem, frases reescritas, 3 pontos a melhorar).
5. Opcionalmente, a **avaliação completa** envia o áudio comprimido a um modelo que ouve.

## Captura e análise do áudio

### Reaproveitado do ditado

[`apps/web/src/lib/dictation/`](../apps/web/src/lib/dictation/) já tem a captura num AudioWorklet, a reamostragem para 16 kHz, o **Segmenter** (corta nas pausas, com piso de ruído adaptativo) e a codificação WAV. O treino de oratória usa esse mesmo pipeline, com três mudanças:

| Mudança | Por quê |
|---|---|
| `startRecorder` aceita opções de captura; a oratória pede `autoGainControl: false` | O controle automático de ganho do navegador “achata” o volume: com ele ligado, a medida de volume e de queda no fim das frases não significa nada. `echoCancellation` também desligado; `noiseSuppression` fica ligado |
| O Segmenter informa o **instante de início** de cada trecho (índice do quadro) | Os tempos de palavra do Whisper são relativos ao trecho; com o início, viram tempos absolutos na fala |
| Os trechos WAV ficam numa **fila em IndexedDB** até a transcrição confirmar | Uma fala de 5 minutos não pode se perder por internet fraca (queixa recorrente em apps parecidos). O ditado guarda só em memória; a oratória persiste |

### Analisador acústico (novo)

Um Web Worker recebe o mesmo fluxo de 16 kHz que vai ao Segmenter, **incluindo os silêncios** (que o Segmenter descarta), e produz uma linha do tempo com um ponto a cada 20 ms:

| Campo | Como |
|---|---|
| `db` | RMS do quadro em dBFS. É relativo ao microfone, nunca absoluto |
| `voiced` | Fala ou silêncio, com o mesmo critério de piso de ruído do Segmenter |
| `f0` | Frequência fundamental (tom) pelo algoritmo **YIN** numa janela de 40 ms, faixa de 70 a 400 Hz; `null` quando não há voz sonora. Um filtro de mediana de 5 quadros remove saltos de oitava |

Uma fala de 5 minutos tem 15 mil pontos; para guardar, a linha do tempo é reduzida a 100 ms (3 mil pontos, inteiros) e cabe com folga numa linha do D1.

Rodar num Web Worker evita travar a interface em celulares mais fracos durante a fala.

### Gravação para ouvir depois (opcional)

Quando “guardar o áudio” estiver ligado, ou para a avaliação completa, um `MediaRecorder` grava em paralelo em Opus (cerca de 0,25 a 0,5 MB por minuto, contra quase 2 MB por minuto do WAV de 16 kHz). Os tipos `audio/webm` e `audio/ogg` precisam entrar em `ALLOWED_FILE_TYPES` (`packages/shared/src/constants.ts`).

## Transcrição

`POST /api/v1/transcriptions` ganha a opção `detail: "words"`. Com ela, a resposta inclui, além do texto:

- **trechos** (`segments`): início, fim, texto e `avg_logprob` (confiança média do trecho);
- **palavras** (`words`): palavra, início e fim.

Conferido nos tipos do Worker (`Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output`): o Whisper do Workers AI **não** devolve confiança por palavra, só por trecho. Por isso:

- a articulação é avaliada **por trecho** nas falas livres;
- nos exercícios de leitura, em que o texto esperado é conhecido, um alinhamento palavra a palavra (distância de edição sobre palavras normalizadas, sem acento) aponta as palavras omitidas ou trocadas.

Ajustes de transcrição para oratória:

- **`initial_prompt` com hesitações** (ex.: “Então, é… tipo, né, hum, eu acho que…”) para que o Whisper mantenha os vícios em vez de “limpar” a fala. A limpeza de alucinações (`cleanTranscript`) continua.
- Nos exercícios de leitura, o texto esperado **não** é passado como `initial_prompt`: com ele, o Whisper tenderia a “acertar” palavras que você não pronunciou bem, e a comparação perderia o sentido.

## Métricas

Funções puras em `packages/shared/src/speech/metrics.ts`, testadas sem navegador. A entrada é a linha do tempo acústica e as palavras com tempos; a saída é um objeto `SpeechMetrics` que vai junto com a tentativa.

| Métrica | Cálculo |
|---|---|
| **Duração e tempo de fala** | Do primeiro ao último quadro com voz; soma dos quadros com voz |
| **Ritmo** | Palavras ÷ minutos (total) e **taxa de articulação** (palavras ÷ minutos falando, sem pausas); também por janela de 30 s, para achar trechos acelerados |
| **Pausas** | Silêncios de 250 ms ou mais entre palavras. Classificação: *entre frases* quando a palavra anterior termina com `.`, `?` ou `!`; *hesitação* quando cai no meio da frase; *branco* quando passa de 3 s |
| **Vícios** | Palavras normalizadas (com a normalização de texto que a busca já usa) comparadas a uma lista configurável, com regras de contexto: “né” sempre; “tipo” só quando não seguido de “de”; “então”, “aí”, “assim” só no início de frase ou antes de uma pausa (para não contar o uso legítimo). Expressões de duas palavras (“tipo assim”, “na verdade”) entram na lista |
| **Palavras fracas** | Mesma técnica, com a lista de atenuadores |
| **Repetição** | Mesma palavra de conteúdo (fora de uma lista de palavras comuns) 3 vezes ou mais em 30 s |
| **Frases** | Palavras por frase, pela pontuação do Whisper (aproximada) |
| **Volume** | Média e desvio de `db` nos quadros com voz; **queda no final**: média dos últimos 300 ms de voz de cada frase menos a média da frase; conta as frases com queda acima do limite |
| **Entonação** | **Quociente de variação do tom** = desvio-padrão ÷ média de `f0` nos quadros sonoros; na fala inteira e em janelas de 10 s. O desvio em semitons é guardado junto, como segunda leitura |
| **Final das afirmações** | Inclinação de `f0` (em semitons por segundo, regressão linear) nos últimos ~400 ms de voz antes de cada `.`; descendente, plana ou ascendente. Frases com `?` são ignoradas |
| **Articulação** | Fração de trechos com `avg_logprob` abaixo do limite; nos exercícios de leitura, palavras omitidas ou trocadas no alinhamento |
| **Tempo** | Duração ÷ meta definida |

A **estabilidade da voz** (tremor) não entra nas primeiras etapas: medições como *jitter* exigem gravação limpa e são pouco confiáveis em microfone de celular. Por enquanto fica só na avaliação completa.

## Avaliação

### A régua como dados

`packages/shared/src/speech/rubric.ts` descreve cada critério da régua como dado:

```ts
interface Criterion {
  id: 'pace' | 'pauses' | 'fillers' | 'weakWords' | 'pitchVariation' | 'finalContour' | /* … */ string;
  dimension: 'content' | 'language' | 'voice' | 'presence';
  source: 'measured' | 'textAi' | 'audioAi';
  /** Lê a métrica e devolve o estado; só para source = 'measured'. */
  evaluate?: (m: SpeechMetrics, limits: SpeechLimits) => { state: State; value: number; evidence: Evidence[] };
}
```

- Os **limites** (`SpeechLimits`: faixa de ritmo, limite de monotonia, queda de volume…) têm valores padrão no código e podem ser sobrescritos pela **calibração** do usuário, guardada nas configurações.
- Os **pesos por tipo de fala** também são dados no mesmo arquivo.
- A mesma função roda no app (resultado imediato) e na API (que confere o que foi salvo).

### Avaliação de texto (IA)

`POST /api/v1/speech/attempts/{id}/evaluate` chama a OpenAI pela [Responses API](ai.md), com o cliente que o assistente já usa, e pede **saída estruturada** (JSON validado por um schema Zod), com:

- estado e evidência (citação do trecho) para cada critério de **conteúdo** e **linguagem** que depende de IA;
- **frase original → frase reescrita** para cada problema apontado;
- no máximo **3 pontos a melhorar**, ordenados, e **1 exercício** para a próxima vez;
- conferência das partes do **método de estrutura** da lição (PREP, SCQA…), quando houver.

O prompt recebe a transcrição com marcas de tempo, um resumo das métricas já calculadas (para a IA não contradizer os números), o foco da lição e, no modo “explicar um assunto”, os trechos das notas encontrados pela busca híbrida que o assistente já faz (palavras + sentido).

O custo entra no mesmo `ai_usage_daily` e respeita `AI_DAILY_BUDGET_USD`. Estimativa: uma fala de 5 minutos tem cerca de 750 palavras; com as notas e o prompt, algo como 6 mil tokens de entrada e 1,5 mil de saída, ou seja, frações de centavo com os preços configurados hoje.

### Avaliação completa (IA ouvindo)

`POST /api/v1/speech/attempts/{id}/full-evaluation` envia o áudio comprimido a um modelo da OpenAI que aceita áudio como entrada, junto com as métricas e a avaliação de texto, e recebe os critérios de **presença** (segurança, naturalidade, ênfase, energia) e comentários sobre a voz.

- **A confirmar antes de implementar:** qual modelo com entrada de áudio a chave acessa, por qual endpoint, em quais formatos de áudio, com que limite de tamanho e a que preço. O custo por áudio entra numa nova variável (`AI_PRICE_AUDIO_INPUT_PER_MTOK` ou equivalente) e no mesmo orçamento diário.
- O Worker apenas repassa os bytes, sem decodificar.
- Esse julgamento é subjetivo e **não entra nos gráficos de evolução** ([régua › Presença](oratoria.md#4-presença)).

### Nota

Soma ponderada dos estados (bom = 100, atenção = 60, a melhorar = 20) pelos pesos do tipo de fala; sem avaliação completa, o peso de Presença é redistribuído. Cada nota guarda a versão da régua usada, para que mudanças futuras nos limites não falsifiquem o histórico.

## Conteúdo da trilha

`packages/shared/src/speech/curriculum.ts`, escrito em português, à mão:

```ts
interface Level { id: string; title: string; units: Unit[]; challenge: ChallengeSpec }
interface Unit { id: string; title: string; track: 'E' | 'C' | 'E+C'; skills: SkillId[]; lessons: Lesson[]; challenge: ChallengeSpec }
interface Lesson { id: string; title: string; skills: SkillId[]; exercises: Exercise[]; goal: LessonGoal }

type Exercise =
  | { type: 'concept'; body: string; good: string; bad: string }
  | { type: 'recognize'; prompt: string; options: string[]; answer: number; explanation: string }
  | { type: 'fix'; sentence: string; focus: SkillId }
  | { type: 'readAloud'; text: string; marks: ReadMark[] }        // pausa, ênfase, final descendo
  | { type: 'articulation'; text: string }
  | { type: 'shortTalk'; topic: TopicSource; seconds: number; focus: SkillId[]; method?: MethodId }
  | { type: 'build'; part: SpeechPart; guidance: string }
  | { type: 'variant'; template: VariantTemplateId; count: number }; // gerado pela IA e guardado
```

- **Metas** (`LessonGoal`) são expressas sobre as métricas e estados da régua, por exemplo `{ skill: 'fillers', maxPerMinute: 3 }`, e avaliadas pela mesma função da régua.
- **Variações** geradas pela IA (`variant`) são pedidas uma vez por modelo e guardadas em `speech_exercise_variants`; uma lição usa variações ainda não vistas antes de pedir novas.
- **Temas das notas** (`TopicSource = 'general' | 'notes'`): o app escolhe uma nota com texto suficiente, de preferência estudada há mais tempo, e a IA formula o tema a partir dela.
- O conteúdo tem **versão**; o progresso aponta para ids estáveis de lição, então reescrever uma lição não apaga o progresso.

## Dados

Migração `apps/api/migrations/0005_speech.sql`. Todas as tabelas têm `user_id` e entram no backup (`BACKUP_TABLES` em `packages/shared/src/backup.ts`), exceto o cache de variações, que é regenerável.

| Tabela | Conteúdo |
|---|---|
| `speech_attempts` | Uma fala gravada: `kind` (`lesson`, `challenge`, `daily`, `free`, `project`), `lesson_id`, `topic_id`/`note_id` (explicar um assunto), `project_id`, `speech_type`, `method`, meta e duração, `transcript`, `words_json` (palavras com tempos), `timeline_json` (linha do tempo reduzida), `metrics_json`, `evaluation_json` (estados e textos da IA), `full_evaluation_json`, `score`, `rubric_version`, `audio_document_id` (opcional), `local_day` (data no fuso do usuário), `created_at` |
| `speech_progress` | Por lição, desafio de unidade ou desafio de nível (`item_id`): `attempts`, `best_score`, `completed_at` |
| `speech_skills` | Por habilidade: `level` (0–5), `xp`, `last_practiced_on`, `next_review_on` |
| `speech_practice` | Cada prática (lição, desafio, revisão, aquecimento, Discurso do Dia, treino livre): `kind`, `ref_id`, `local_day`, `seconds`, `xp`, `passed`, `attempt_id` |
| `speech_projects` | Discursos do nível 4: `speech_type`, `title`, `audience`, `goal`, `method`, `step`, `note_id` (o discurso é uma nota), datas |
| `speech_exercise_variants` | Cache das variações geradas: `template_id`, `content_json`, `used_count`. Fora do backup |

Configurações (na tabela `settings` que já existe): meta diária, horário do lembrete, listas de vícios e de palavras fracas, guardar áudio (sim/não) e os limites calibrados.

**XP, meta diária e sequência de dias** são calculados a partir de `speech_practice` (exercícios sem gravação, como conceitos e múltipla escolha, também contam). O XP é calculado pela API a partir do conteúdo da trilha, e as metas dos desafios são conferidas na fala salva: o app nunca informa o próprio XP. A folga semanal é uma regra do cálculo (um dia sem prática por semana ISO não quebra a sequência). O dia é o **local**, enviado pelo app, porque “hoje” às 22h em Brasília já é amanhã em UTC.

## API

Novo módulo `apps/api/src/modules/speech/` (`routes.ts` + `service.ts`), registrado em `modules/index.ts`, com schemas em `packages/shared/src/schemas/speech.ts`.

| Rota | O que faz |
|---|---|
| `GET speech/path?today=` | Lições e desafios concluídos, habilidades, XP total e do dia, minutos do dia, sequência, XP da semana, tema do Discurso do Dia e uma nota para explicar (o aquecimento e as revisões são montados no app a partir do conteúdo compartilhado) |
| `POST speech/practice` | Registra uma prática; responde com o XP, se passou e o novo estado |
| `POST speech/attempts` | Salva uma fala (transcrição, palavras, linha do tempo, métricas); recalcula os estados medidos; atualiza progresso e habilidades |
| `GET speech/attempts`, `GET speech/attempts/{id}`, `DELETE speech/attempts/{id}` | Histórico e detalhe |
| `POST speech/attempts/{id}/evaluate` | Avaliação de texto pela IA |
| `POST speech/attempts/{id}/full-evaluation` | Avaliação completa com áudio |
| `POST speech/feedback` | Corrige um exercício escrito (“Consertar” e “Construir”) |
| `POST speech/attempts/{id}/questions` | A banca: três perguntas da IA sobre a fala (guardadas com ela) |
| `GET speech/variants?skill=` | Até 3 exercícios extras para a revisão de uma habilidade, escritos pela IA em lotes de 6 e entregues uma vez cada |
| `GET/POST/PATCH speech/projects`, `GET speech/projects/{id}` | Discursos do nível 4 |
| `POST transcriptions` (existente) | Ganha `detail: "words"` |

Todas as rotas seguem o padrão do app: autenticação, idempotência nas escritas, validação Zod e entrada automática no OpenAPI (e, com isso, no teste que confere que toda rota privada exige login).

## Interface

Pasta `apps/web/src/features/speaking/`, rotas sob `/speaking`, item **Oratória** na navegação e na paleta de comandos. Pensada primeiro para o celular, porque é onde se treina.

| Tela | Conteúdo |
|---|---|
| `/speaking` | A trilha: níveis e unidades como um caminho vertical, a unidade atual em destaque, sequência de dias, XP do dia e meta, botão “Começar a sessão de hoje” |
| `/speaking/lessons/:id` | O player da lição: um exercício por vez, barra de progresso, retorno imediato a cada exercício |
| `/speaking/attempts/:id` | O resultado de uma fala (abaixo) |
| `/speaking/progress` | Nível de cada habilidade, gráficos dos critérios medidos, histórico de falas |
| `/speaking/projects/:id` | O assistente de construção do discurso (nível 4), etapa por etapa, ao lado da nota do discurso |
| `/speaking/free` | Fala livre ou “explicar um assunto”, fora da trilha |

Durante a gravação: cronômetro com a meta, medidor de volume (já existe no ditado), indicador do ritmo atual e, quando a lição pede, **contador de vícios ao vivo** (atualizado a cada trecho transcrito). A tela pede para manter a tela acesa, como o ditado.

Tela de resultado:

```
┌──────────────────────────────────────────────────────────┐
│ Explicar um assunto · Mercantilismo · 2:07 (meta 2:00)    │
│ Nota 74   ▲ +6 desde a última                             │
├──────────────────────────────────────────────────────────┤
│ 3 coisas para a próxima vez                               │
│ 1. Vícios: 4,2/min (meta ≤ 2) — troque “né” por pausa     │
│ 2. Final das afirmações: 6 de 11 subiram o tom            │
│ 3. Conclusão: não retomou a ideia central                 │
│    “é isso, acho que é isso” → “Ou seja: o mercantilismo  │
│     media a riqueza de um país pelo ouro que acumulava.”  │
├──────────────────────────────────────────────────────────┤
│ Voz       ritmo 148 ppm ✓ · pausas ⚠ · tom 0,19 ✓ · …    │
│ Linguagem vícios ✗ · palavras fracas ✓ · frases ✓          │
│ Conteúdo  abertura ✓ · ideia central ✓ · correção ✓ · …   │
├──────────────────────────────────────────────────────────┤
│ ▁▃▅▇▅▃▂▃▅▆▇▆▄▂  (tom e volume ao longo da fala)           │
│ Transcrição marcada; tocar numa marca toca o trecho        │
└──────────────────────────────────────────────────────────┘
```

Cada linha abre o detalhe: número medido, faixa de referência, origem (medição, IA lendo, IA ouvindo) e os trechos.

No **painel inicial**, um cartão “Oratória” mostra a sequência de dias e o atalho para a sessão de hoje.

## Integração com o resto do MyNotes

- **Explicar um assunto conta como estudo:** a fala cria uma sessão de estudo (`study_sessions`) naquele assunto, com a duração da fala. A coluna `source` hoje só aceita `manual` e `timer` (restrição `CHECK`); incluir `speech` exige recriar a tabela na migração, como o SQLite pede para mudar restrições.
- **O discurso do nível 4 é uma nota** e pode citar notas e livros com referências “/”.
- **Temas das notas:** o Discurso do Dia e as falas curtas usam a busca e o índice semântico que o assistente já mantém.
- **Assistente:** pode abrir um treino (“quero treinar a apresentação de amanhã”) e ler os resultados das falas, mas não altera progresso nem notas sem confirmação, como hoje.
- **Lembrete (Web Push):** depende de assinatura de push no PWA e do cron do Worker; vem numa etapa posterior.

## Privacidade, limites e custos

| Tema | Como fica |
|---|---|
| Áudio | Fica no aparelho por padrão; os trechos vão ao Whisper (Cloudflare) para transcrição, como no ditado. Só é guardado no R2 se você ligar “guardar o áudio”. Só vai à OpenAI na avaliação completa, com aviso na primeira vez |
| Texto | A transcrição e as métricas vão à OpenAI na avaliação de texto, como as notas já vão no assistente |
| Workers (10 ms de CPU) | Nenhuma análise de áudio no Worker; ele valida, grava e encaminha |
| D1 | Linha do tempo reduzida a 100 ms e palavras compactadas: uma fala de 5 minutos fica bem abaixo do limite de 2 MB por linha |
| Whisper | Mesma cota diária gratuita do ditado (cerca de 3,5 h por dia); esgotada, a fila em IndexedDB espera a renovação |
| OpenAI | Avaliação de texto: frações de centavo por fala. Avaliação completa: mais cara, preço a confirmar. Tudo dentro de `AI_DAILY_BUDGET_USD` |

## Testes

- **Métricas (unitários):** sinais sintéticos com resposta conhecida: senoide de 150 Hz (quociente de variação ≈ 0), varredura de tom (variação conhecida), silêncios inseridos (pausas exatas), queda de amplitude no fim (queda de volume). Transcrições de exemplo para vícios, palavras fracas, repetição e alinhamento da leitura, incluindo os casos legítimos de “então” e “tipo de”.
- **Régua e metas (unitários):** estados e notas para métricas de exemplo; troca de limites pela calibração.
- **API:** rotas com D1 local, o mock da OpenAI que o assistente já usa e respostas falsas do Whisper com tempos de palavra.
- **Ponta a ponta (Playwright):** o Chromium aceita um microfone falso com arquivo (`--use-fake-device-for-media-stream` e `--use-file-for-fake-audio-capture=fala.wav`), o que permite gravar uma fala real de teste e conferir a tela de resultado.
- **Calibração com gravações reais:** antes de fixar os limites, gravar falas com problemas conhecidos (monótona, acelerada, cheia de vícios) e conferir se cada métrica aponta o problema certo.

## Etapas

| Etapa | Entrega | Pronto quando |
|---|---|---|
| **1. Motor de análise** ✓ | Gravador com opções de captura e fila em IndexedDB; Analisador acústico; transcrição com `detail: "words"`; métricas; régua como dados; tela de resultado; fala livre e “explicar um assunto”; avaliação de texto pela IA; histórico | Uma fala de 2 minutos gera resultado completo e explicado; as gravações de calibração apontam os problemas certos |
| **2. Calibração e nível 1** ✓ | Linha de base (unidade 1) e ajuste dos limites; conteúdo do nível 1; player de lições com todos os tipos de exercício; XP, meta diária e sequência de dias; aquecimento e Discurso do Dia; cartão no painel | Dá para fazer a sessão diária completa do nível 1 no celular |
| **3. Níveis 2 e 3** ✓ | Conteúdo; biblioteca de métodos; banca de perguntas; níveis de habilidade e lições de revisão; variações geradas pela IA; desafios de nível | A trilha até a unidade 16 funciona com revisões automáticas |
| **4. Discurso próprio** ✓ | Nível 4 com projetos ligados a notas; ensaios comparados; avaliação completa com áudio; guardar áudio; lembrete por Web Push | Um discurso vai da ideia à apresentação final dentro do app |

A etapa 1 já é útil sozinha (treino livre com retorno detalhado) e valida a parte mais arriscada, as medições, antes de escrever o conteúdo da trilha.

**Etapa 1 entregue** (página `/speaking`), com estas diferenças em relação à planta:

- A fala de “explicar um assunto” **ainda não cria sessão de estudo**: depende de mudar a restrição de `study_sessions.source` (ver [Integração](#integração-com-o-resto-do-mynotes)).
- As listas de vícios e de palavras fracas são fixas (`packages/shared/src/speech/lexicon.ts`); “bem” ficou de fora por ser ambíguo demais.
- Os limites ainda não são calibráveis pela interface: usam os padrões de `packages/shared/src/speech/limits.ts`.
- Presença e estabilidade da voz aparecem como “próxima etapa” (dependem da IA ouvindo).
- O gasto da IA (registro e orçamento diário) passou para `apps/api/src/modules/assistant/usage.ts`, usado pelo assistente e pela avaliação de falas.

## Riscos e pontos a confirmar

| Risco | Como tratar |
|---|---|
| O Whisper omite “éé” e “hmm” | `initial_prompt` com hesitações; pausas de hesitação medidas pelo áudio complementam; a contagem é apresentada como aproximada |
| Os tempos de palavra com `vad_filter: true` podem não corresponder ao áudio original | Testar na etapa 1; se divergirem, desligar o `vad_filter` na oratória (o Segmenter já descarta silêncio longo) |
| Tom impreciso em microfone de celular, com ruído ou voz muito grave/aguda | Filtro de mediana, faixa de 70 a 400 Hz, só quadros com voz clara; resultados de tom com poucos quadros válidos são marcados como inconclusivos |
| Supressão de ruído do navegador alterando o volume | Medir com e sem `noiseSuppression` na calibração e escolher |
| Safari (iPhone) com restrições de áudio e de tela bloqueada | O ditado já trata o gesto do usuário e a tela acesa; testar o Analisador e o `MediaRecorder` no Safari na etapa 1 |
| Modelo de áudio da OpenAI: disponibilidade, formato e preço | Confirmar antes da etapa 4; a avaliação completa é opcional e o resto não depende dela |
| Limites genéricos não servirem para a sua voz | Calibração na unidade 1 e limites editáveis; a evolução compara você com você mesmo |

**Etapa 2 entregue** (`/speaking` virou a trilha; `/speaking/lesson/:id`, `/speaking/free`, `/speaking/progress`):

- Conteúdo do nível 1 em `packages/shared/src/speech/content/level1.ts`, com metas por lição e desafio; o motor de progresso (sequência com folga semanal, XP, revisões espaçadas) em `speech/path.ts`.
- A calibração é manual com sugestão: a página de progresso propõe limites a partir da mediana das suas falas (ritmo ±15 palavras/min, monotonia a 85% da sua variação de tom) e você confirma. Não há ajuste automático.
- O Discurso do Dia alterna, dia sim dia não, entre um tema geral e uma nota sua (com assunto, a fala é avaliada contra as notas).
- Correção encontrada no caminho: o backup recusava a configuração `notes` (nota diária); a lista de chaves passou a vir das configurações do app.

**Etapa 3 entregue:**

- Conteúdo dos níveis 2 e 3 (`content/level2.ts`, `content/level3.ts`): 11 unidades, cada uma com três lições e um desafio, e os desafios dos níveis 2 e 3. A trilha tem 16 unidades, 48 lições e 19 desafios.
- **Banca:** novo tipo de exercício (`qa`), usado na unidade 16 com perguntas escritas à mão, e o botão “Treinar a banca” no resultado de qualquer fala, com perguntas da IA (`/speaking/attempts/:id/banca`). Cada resposta é salva como fala (`speech_type = 'qa'`, `parent_id` apontando a fala original) e avaliada como resposta à pergunta.
- **Variações da IA nas revisões:** a lição de revisão espera até 3 exercícios extras da habilidade antes de começar; sem IA, segue só com os exercícios da trilha. Itens inválidos do modelo são descartados (`toVariants`).
- **Biblioteca de métodos** em `/speaking/methods`, mostrando quais já foram aprendidos.
- Migração `0007_speech_board.sql`: colunas `parent_id` e `questions_json` em `speech_attempts` e a tabela `speech_exercise_variants` (fora do backup, por ser regenerável).

**Etapa 4 entregue** (`/speaking/projects/:id`, `/speaking/compare`):

- **Seu discurso:** projetos (`speech_projects`) com as 11 etapas de `speech/project.ts`. As etapas escritas salvam sozinhas (com a versão vista, como as notas) e pedem o comentário do professor; os ensaios e a apresentação final são falas com `project_id`, sempre com a gravação guardada; a revisão mostra os pontos do primeiro ensaio; a banca abre sobre o segundo ensaio. O roteiro vira uma nota (Markdown → editor) no assunto do projeto, criada ou atualizada pelo botão “Salvar como nota”.
- **Comparação lado a lado** de duas falas quaisquer: nota, medidas e todos os critérios, com setas de melhora e piora.
- **Guardar a gravação:** configuração “Guardar a gravação das falas” (e sempre nos ensaios). O navegador reduz o áudio para 8 kHz durante a fala e, depois de salvá-la, envia um WAV mono de 16 bits (cerca de 1 MB por minuto) em streaming para o R2 (`PUT speech/attempts/{id}/audio`). A gravação toca no resultado, e tocar numa palavra da transcrição pula para aquele momento. Não entra no backup e é apagada com a fala.
- **Avaliação completa:** a Responses API não aceita áudio; o modelo `gpt-audio` (US$ 32 por milhão de tokens de áudio, conferido em 2026-10-20) é chamado por Chat Completions (`createChatCompletion`), com `input_audio` em WAV. Ele ouve os primeiros e os últimos 45 s (até 90 s no total, cerca de 1,4 MB) e julga estabilidade, segurança, naturalidade, ênfase e energia. O custo entra no orçamento diário pelos preços de áudio (`AI_PRICE_AUDIO_*`). Na apresentação final do discurso, a avaliação completa é pedida sozinha.
- **Lembrete diário por Web Push**, sem serviço de terceiros: criptografia aes128gcm (RFC 8291) e assinatura VAPID (RFC 8292) feitas com WebCrypto no Worker (`push.ts`), assinaturas em `speech_push_subscriptions`, envio pelo cron de 10 minutos após o horário escolhido, só nos dias sem prática e uma vez por dia por navegador. O service worker recebe com `public/push-sw.js`. Exige as chaves VAPID (veja [deploy.md](deploy.md#oratória-gravações-avaliação-completa-e-lembretes)).
- Migração `0008_speech_projects_audio.sql`.
