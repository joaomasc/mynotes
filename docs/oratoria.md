# Oratória: o que é uma boa fala

Esta é a referência que o professor de oratória do MyNotes usa para avaliar uma fala. Para cada aspecto, ela define **o que é o correto**, os **sinais de problema**, **como o app mede** e uma **faixa de referência**. É a base da implementação: cada critério deste documento vira uma regra de avaliação.

A ordem em que essas habilidades são ensinadas está em [oratoria-trilha.md](oratoria-trilha.md); como tudo isso é construído no MyNotes, em [oratoria-tecnico.md](oratoria-tecnico.md).

> Os números são **pontos de partida**, não leis. Vêm da prática comum de oratória e devem ser ajustados com as suas próprias gravações (veja [Calibração](#calibração)). O professor também compara você com você mesmo: a evolução pesa mais que a régua.

## Sumário

1. [As quatro dimensões](#as-quatro-dimensões)
2. [Conteúdo e estrutura](#1-conteúdo-e-estrutura)
3. [Linguagem](#2-linguagem)
4. [Voz](#3-voz)
5. [Presença](#4-presença)
6. [Pesos por tipo de fala](#pesos-por-tipo-de-fala)
7. [Como o resultado aparece](#como-o-resultado-aparece)
8. [Calibração](#calibração)
9. [Decisões em aberto](#decisões-em-aberto)

## As quatro dimensões

| Dimensão | Pergunta que responde | Como é avaliada |
|---|---|---|
| **Conteúdo e estrutura** | O que você disse, em que ordem e se estava certo | IA lendo a transcrição (e as suas notas, no modo “explicar um assunto”) |
| **Linguagem** | Como você formulou o que disse | Contagens na transcrição + IA |
| **Voz** | Como soou: ritmo, pausas, volume, entonação, dicção | Medição do áudio no navegador + confiança do Whisper por trecho |
| **Presença** | A impressão geral de quem ouve: segurança, naturalidade | IA ouvindo o áudio (só na avaliação completa) |

Na coluna **Medição** das tabelas abaixo:

- **Medido:** número objetivo calculado pelo app, sem custo e estável entre execuções. É o que alimenta os gráficos de evolução.
- **IA (texto):** o modelo lê a transcrição.
- **IA (áudio):** o modelo ouve a gravação. É opcional e custa mais.

Corpo, gestos e olhar ficam **fora do escopo**, porque exigiriam câmera.

## 1. Conteúdo e estrutura

| Critério | O correto | Sinais de problema | Medição |
|---|---|---|---|
| **Abertura** | Nos primeiros ~10% do tempo: chama a atenção (pergunta, fato, caso), apresenta o tema e diz o caminho que a fala vai seguir | Começa se desculpando (“não sou muito bom nisso”), vai direto a um detalhe, demora para dizer do que se trata | IA (texto) |
| **Ideia central** | Cabe em uma frase e é dita explicitamente | Ao final, não dá para dizer qual era a ideia principal | IA (texto) |
| **Desenvolvimento** | De 2 a 4 pontos principais; cada um segue *afirmação → explicação → exemplo ou evidência* | Lista de fatos sem hierarquia; pontos que só afirmam, sem exemplo | IA (texto) |
| **Transições** | Avisa quando passa de um ponto a outro (“primeiro…”, “agora que vimos X…”, “por isso…”) | Saltos de assunto; “e aí… e aí…” como única ligação | IA (texto) |
| **Conclusão** | Retoma a ideia central, resume os pontos e fecha com uma frase final clara | Termina com “é isso”, “acho que é só” ou para de repente; traz informação nova no fim | IA (texto) |
| **Correção** (modo “explicar um assunto”) | Nada contradiz as suas notas; os conceitos-chave do assunto aparecem | Erro de fato; conceito central ausente | IA (texto), consultando as notas |
| **Tempo** | Dentro de ±10% do tempo definido, sem cortar a conclusão | Estoura o tempo ou sobra muito | Medido |

## 2. Linguagem

| Critério | O correto | Sinais de problema | Medição | Referência inicial |
|---|---|---|---|---|
| **Frases** | Curtas ou médias, com uma ideia por frase (a fala não é um texto escrito) | Frases que se arrastam, com vários “que” encadeados | Medido (palavras por frase) + IA | Média até ~20 palavras; alerta acima de ~35. A pontuação é estimada pelo Whisper, então a medida é aproximada |
| **Vícios de linguagem** | Raros, a ponto de não serem percebidos | “né”, “tipo”, “então”, “aí”, “assim”, “basicamente”, “enfim”, “éé” repetidos | Medido (por minuto, com marcação no texto) | Bom: até 2/min · atenção: 2 a 5/min · a melhorar: mais de 5/min. O Whisper tende a omitir “éé” e “hmm”, então esses ficam subcontados |
| **Linguagem firme** (palavras fracas e atenuadores) | Afirma o que sabe e só atenua quando a incerteza é real | Excesso de “acho que”, “talvez”, “meio que”, “um pouquinho”, “só queria falar”, “não sei se ficou claro”, “bem”, “realmente”, “super” | Medido (lista de palavras fracas) + IA | Bom: até 1/min |
| **Repetição** | Repete de propósito, para fixar uma ideia | A mesma palavra comum várias vezes em sequência, por falta de alternativa | Medido + IA | — |
| **Precisão** | Termos técnicos definidos na primeira vez em que aparecem | Jargão sem explicação; “coisa” ou “negócio” no lugar do conceito | IA (texto) | — |

## 3. Voz

| Critério | O correto | Sinais de problema | Medição | Referência inicial |
|---|---|---|---|---|
| **Ritmo** | Em exposição, ritmo de conversa calma; desacelera nos pontos importantes | Acelera com o nervosismo, atropela as palavras ou se arrasta | Medido: palavras por minuto no total e por trecho | 130 a 160 por minuto; alerta abaixo de 110 ou acima de 180. Alguma variação entre os trechos é desejável |
| **Pausas** | Pausas curtas entre ideias, antes e depois de uma frase importante | Pausa no meio da frase (hesitação), silêncio longo (branco) ou fala sem pausa nenhuma | Medido: posição e duração de cada pausa | Entre ideias: 0,5 a 2 s · mais de 3 s: branco · pausa no meio da frase: conta como hesitação |
| **Volume** | Audível e estável; sobe ou desce com intenção | Voz baixa, queda no fim das frases (“engolir o final”), oscilação sem motivo | Medido: nível médio, variação e queda nas últimas palavras de cada frase | Queda no final acima de ~6 dB: alerta. O volume é **relativo** ao microfone e à distância dele, então só se compara dentro da mesma fala ou na mesma configuração |
| **Entonação** | O tom varia para marcar ênfase, contraste e pergunta | Tom quase constante (monotonia), que soa lido ou desinteressado | Medido: **quociente de variação do tom** (desvio-padrão ÷ média do tom da voz) na fala inteira e em janelas de 10 s, para mostrar onde a fala ficou plana | Abaixo de **0,16**: monótono. É o limite de um estudo de avaliação automática de apresentações, que errou cerca de 19% das vezes; serve de ponto de partida e é ajustado na calibração |
| **Final das afirmações** | O tom desce no fim de uma afirmação | Afirmações que terminam com o tom subindo, como se fossem perguntas, soam inseguras | Medido: contorno do tom nas últimas sílabas | Bom: a maioria das afirmações termina descendo |
| **Articulação** | Palavras completas, com as sílabas finais pronunciadas | Sílabas engolidas, palavras emboladas, murmúrio | Medido: confiança do Whisper em cada trecho de fala; nos exercícios de leitura, comparação palavra a palavra entre o texto esperado e o transcrito | Trechos com confiança baixa são marcados; na leitura, palavras omitidas ou trocadas são marcadas. Ruído e nomes próprios também derrubam a confiança, então é um indício, não um veredito |
| **Estabilidade** | Voz firme do começo ao fim | Voz trêmula ou falhando, fôlego curto | Medido (aproximado) + IA (áudio) | — |

## 4. Presença

Avaliada apenas na **avaliação completa**, com a IA ouvindo o áudio e recebendo as medições acima para fundamentar o que diz.

| Critério | O correto | Sinais de problema |
|---|---|---|
| **Segurança** | Soa convicto do que está dizendo | Soa hesitante, como quem pede desculpas |
| **Naturalidade** | Soa como conversa, mesmo seguindo um roteiro | Soa lido ou decorado |
| **Ênfase** | Destaca as palavras que carregam a ideia | Ênfase em palavras sem importância, ou nenhuma ênfase |
| **Energia** | Coerente com o tema e com o público | Apático ou exagerado |

O julgamento da IA é subjetivo e pode variar um pouco entre execuções. Por isso ele aparece como comentário e **não entra nos gráficos de evolução**.

## Pesos por tipo de fala

Os critérios são os mesmos para todos os tipos de fala; o que muda é o peso de cada dimensão na nota.

| Tipo de fala | Conteúdo | Linguagem | Voz | Presença | O que mais importa |
|---|---|---|---|---|---|
| **Explicar um assunto** (seminário, aula) | 40% | 20% | 30% | 10% | Correção, estrutura, clareza |
| **Discurso persuasivo** | 30% | 25% | 25% | 20% | Ideia central, linguagem firme, ênfase |
| **Improviso** | 30% | 30% | 30% | 10% | Estrutura mínima (*ponto → razão → exemplo → ponto*), vícios, pausas |
| **Banca / arguição** | 50% | 25% | 20% | 5% | Responder à pergunta feita, ir direto ao ponto e admitir com firmeza o que não sabe |

Sem a avaliação completa, o peso de Presença é redistribuído proporcionalmente entre as outras dimensões.

## Como o resultado aparece

- Cada critério recebe um estado: **bom**, **atenção** ou **a melhorar**, com o trecho (minuto e segundo) e o exemplo que o justificam.
- **Nada de nota sem explicação:** todo estado mostra o número medido, a faixa de referência usada e de onde veio (medição, IA lendo ou IA ouvindo). Notas sem explicação são a principal reclamação nas avaliações de apps parecidos.
- **A frase reescrita junto da crítica:** para cada problema de linguagem ou de estrutura, o professor mostra o trecho original e uma versão melhorada, não apenas o defeito.
- **A transcrição marcada:** o texto da fala aparece com vícios, palavras fracas, pausas de hesitação, trechos pouco claros e finais de frase subindo destacados; tocar numa marca leva ao momento da gravação.
- Uma **nota geral de 0 a 100** é calculada como soma ponderada pelos pesos do tipo de fala.
- O professor aponta **no máximo 3 coisas a melhorar por vez**, a mais importante primeiro, e sugere um exercício para a próxima fala. Corrigir tudo de uma vez não funciona.
- Os critérios medidos aparecem também como gráficos de evolução: ritmo, vícios por minuto, variação do tom, pausas de hesitação e articulação.

## Calibração

As faixas de referência acima são genéricas. Para que façam sentido para você:

1. **Linha de base:** grave 3 falas em condições normais, sempre com o mesmo microfone e à mesma distância. Os valores delas definem o seu ponto de partida.
2. **Referências (opcional):** analise trechos de oradores que você admira, enviando o áudio ao app, para ver em que faixa eles ficam.
3. **Ajuste:** com isso, defina os limites de monotonia, de queda de volume e de ritmo.

Os limites ficarão num único arquivo compartilhado entre a API e o app, para serem ajustados sem mexer na lógica.

## Decisões em aberto

- As listas de vícios de linguagem e de atenuadores serão fixas ou personalizáveis nas Configurações?
- Os pesos por tipo de fala estão bons?
- ~~Qual o limite de monotonia?~~ Começa em 0,16 (quociente de variação do tom) e é ajustado na calibração.
- Queremos uma nota de 0 a 100, ou só os estados por critério? Uma nota única motiva, mas esconde os detalhes.
