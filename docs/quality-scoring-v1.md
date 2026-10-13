# Quality Scoring V1

Camada derivada para ler o comportamento de um `visitor_id`. Ela responde, com scores separados, se o visitante parece comprador, se há intenção comercial, se ele volta de verdade, se o padrão parece tester/QA e quão confiável é essa leitura.

Não é um score único. Não prova profissão. Não decide lance, público nem criativo.

## Fonte e arquitetura

`ads_events` continua sendo o fato. O Buyer Profile continua sendo a projeção do usuário, com `first_touch` e `current_touch`. Quality Scoring não reescreve nenhum dos dois e não apaga evento.

`public.recompute_buyer_quality_score(visitor_id)` lê só os eventos daquele visitante, calcula os cinco scores e faz upsert em `public.buyer_quality_scores`. `public.get_buyer_quality_score` só lê a linha gravada.

Os pesos nomeados estão em `quality-scoring.js`:

- `BUYER_SIGNAL_WEIGHTS`
- `BUYER_COHERENCE_WEIGHTS`
- `COMMERCIAL_SIGNAL_WEIGHTS`
- `RECURRENCE_RULES`
- `BROKER_TESTER_RULES`
- `DATA_CONFIDENCE_RULES`
- `CLASS_THRESHOLDS`

A função SQL repete esses números. O score de um visitante depende só dos eventos dele. Não há mediana ao vivo: volume “muito acima do usual” é um limiar fixo, para o resultado não mudar quando outro visitante entra.

Depois de um `ads_event` aceito entre `property_view`, `property_interest`, `ai_assistant_message`, `agent_opened`, `specialist_cta_opened`, `property_whatsapp_click`, `ai_lead_submitted` e `lead_created`, a aplicação chama o recálculo. Se o scoring falha ou passa de 400 ms, o evento já gravado permanece. Não há backfill nesta V1.

Sinais como `ai_lead_success` e `floorplan_view` entram na conta quando já existem em `ads_events`. Esta fase não passa a gravá-los por um caminho novo.

## Scores

Todos são inteiros de 0 a 100. O `score_breakdown` lista o sinal, a contagem, o peso e os pontos.

`buyer_intent_score` junta ação comercial, uso do imóvel e coerência entre dias. Um `property_view` vale 2, com teto 12. Mensagens de IA têm teto 12. Sozinhas, não chegam a `high_intent`. `lead_created` vale 55, com teto 70.

`commercial_intent_score` olha só a progressão comercial. WhatsApp, interesse, telefone, CTA, formulário e lead pesam mais do que planta, agente ou mensagem.

`recurrence_score` olha dias distintos, sessões em dias diferentes, retorno ao mesmo bairro, dormitório ou imóvel, e a distância entre a primeira e a última atividade. Volume no mesmo dia quase não pontua: o teto de sessão extra num único dia é 6.

`broker_tester_score` sobe quando vários sinais anormais aparecem juntos: dezenas de views num dia ou em duas horas, muitos bairros, dormitórios ou faixas de preço em janela curta, muitas construtoras, muitos filtros, repetição mecânica, navegação larga sem CTA, `metadata.test = true`, ou `TEST` em id de evento, visitante, sessão, imóvel ou clique. Um sinal isolado não chega na classe. Recorrência, por si, não soma aqui.

`data_confidence_score` sobe com mais eventos, sessões, dias, `visitor_id` válido, sessão presente, imóvel, intenção declarada ou observada e toque. Marcador sintético tira 30 pontos.

## Classes

Limiares da V1, configuráveis em `CLASS_THRESHOLDS`. Não são verdade de mercado.

`buyer_class`:

- `lead` se existe `lead_created` ou `ai_lead_success`
- `high_intent` se buyer é pelo menos 70 e commercial pelo menos 45
- `engaged` se buyer é pelo menos 50
- `exploring` se buyer é pelo menos 25
- `low_intent` se buyer é maior que 0
- `unknown` sem evidência

`traffic_quality_class`:

- `mixed` se buyer e broker são pelo menos 50
- `likely_broker_or_tester` se broker é pelo menos 70 e a confiança é pelo menos 40
- `likely_buyer` se buyer é pelo menos 50, broker fica abaixo de 50 e a confiança é pelo menos 40
- `unknown` no restante

`mixed` vem antes. Um lead com varredura de tester continua `lead` e pode ficar `mixed`.

## Como ler

`buyer_intent_score` alto diz que o comportamento parece o de quem escolhe imóvel. `broker_tester_score` alto diz que o padrão parece anormal para um comprador acompanhado ao longo de dias: varredura curta, segmentos incompatíveis ou marcador de teste. Os dois podem ser altos ao mesmo tempo. A classe, nesse caso, é `mixed`, não uma sentença.

`likely_broker_or_tester` significa suspected broker/tester. Não significa corretor. Não autoriza tratar a pessoa como profissional, excluí-la de mídia ou alterar o atendimento.

Renda não entra. Percentil de renda, `renda` e faixa do Google são features ignoradas. Renda alta não é proxy de corretor e não pode ser usada para discriminar.

Um clique ou id que contenha a sequência `test` soma pontos de tester, mas não classifica sozinho. Um GCLID real que por acaso tenha essas letras pode ganhar pontos sem cruzar o limiar da classe.

## O que esta V1 não faz

Não publica campanha. Não chama a API de escrita do Google Ads. Não envia conversão. Não altera GA4, Meta, MATCH, inventário, `/api/lead`, PWA nem o Agent. Não roda backfill. Não cria Media Agent nem motor de criação de campanha.

O relatório `scripts/buyer-quality-report.sql` só descreve consultas. Não foi executado.

## SQL

`supabase/buyer_quality_scores.sql` é incremental. RLS ligado, sem policy. `SECURITY INVOKER` e `search_path = pg_catalog`. Execute e DML da tabela só para `service_role`, quando o role existe. A função lê `ads_events` e grava só `buyer_quality_scores`.
