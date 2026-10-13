/*
  Relatório analítico do Quality Scoring V1.

  Somente leitura. Não faz backfill, não grava score e não foi executado
  em Production. Um visitante pode aparecer em mais de um bairro quando
  a consulta conta eventos; a linha de buyer_quality_scores continua uma
  por visitor_id.
*/

-- Distribuição dos scores
select
  width_bucket(buyer_intent_score, 0, 100, 10) as faixa,
  count(*) as visitantes,
  round(avg(buyer_intent_score), 1) as buyer_medio,
  round(avg(commercial_intent_score), 1) as commercial_medio,
  round(avg(recurrence_score), 1) as recurrence_medio,
  round(avg(broker_tester_score), 1) as broker_medio,
  round(avg(data_confidence_score), 1) as confidence_medio
from public.buyer_quality_scores
group by 1
order by 1;

-- Distribuição das classes
select buyer_class, traffic_quality_class, count(*) as visitantes
from public.buyer_quality_scores
group by 1, 2
order by 1, 2;

-- Likely buyers com confiança mínima da V1
select
  visitor_id,
  buyer_intent_score,
  commercial_intent_score,
  recurrence_score,
  broker_tester_score,
  data_confidence_score,
  distinct_days,
  session_count
from public.buyer_quality_scores
where traffic_quality_class = 'likely_buyer'
order by buyer_intent_score desc, data_confidence_score desc
limit 50;

-- Suspeitos de broker/tester. Não é classificação profissional.
select
  visitor_id,
  broker_tester_score,
  buyer_intent_score,
  data_confidence_score,
  event_count,
  neighborhood_count,
  distinct_days,
  score_breakdown->'broker_tester'->'signals' as sinais
from public.buyer_quality_scores
where traffic_quality_class = 'likely_broker_or_tester'
order by broker_tester_score desc, data_confidence_score desc
limit 50;

-- Leads contra quem não chegou a lead
select
  case when buyer_class = 'lead' then 'lead' else 'nao_lead' end as grupo,
  count(*) as visitantes,
  round(avg(buyer_intent_score), 1) as buyer_medio,
  round(avg(commercial_intent_score), 1) as commercial_medio,
  round(avg(recurrence_score), 1) as recurrence_medio,
  round(avg(broker_tester_score), 1) as broker_medio,
  round(avg(data_confidence_score), 1) as confidence_medio
from public.buyer_quality_scores
group by 1
order by 1;

-- Recorrentes contra visita de um dia
select
  case when distinct_days >= 2 then 'recorrente' else 'um_dia' end as grupo,
  count(*) as visitantes,
  round(avg(buyer_intent_score), 1) as buyer_medio,
  round(avg(broker_tester_score), 1) as broker_medio,
  round(avg(recurrence_score), 1) as recurrence_medio
from public.buyer_quality_scores
group by 1
order by 1;

-- Por campanha, source e medium. campaign_id só quando o metadata trouxer.
with ultimo as (
  select distinct on (visitor_id)
    visitor_id,
    utm_source,
    utm_medium,
    utm_campaign,
    nullif(metadata->>'campaign_id', '') as campaign_id
  from public.ads_events
  where btrim(utm_campaign) <> ''
     or btrim(utm_source) <> ''
     or coalesce(metadata->>'campaign_id', '') <> ''
  order by visitor_id, event_time desc, event_id desc
)
select
  coalesce(nullif(ultimo.utm_campaign, ''), '(sem campanha)') as campanha,
  coalesce(nullif(ultimo.utm_source, ''), '(sem source)') as source,
  coalesce(nullif(ultimo.utm_medium, ''), '(sem medium)') as medium,
  coalesce(ultimo.campaign_id, '') as campaign_id,
  count(*) as visitantes,
  count(*) filter (where score.buyer_class = 'lead') as leads,
  count(*) filter (where score.traffic_quality_class = 'likely_buyer') as likely_buyers,
  count(*) filter (where score.traffic_quality_class = 'likely_broker_or_tester') as suspected_testers,
  round(avg(score.buyer_intent_score), 1) as buyer_medio,
  round(avg(score.broker_tester_score), 1) as broker_medio
from public.buyer_quality_scores as score
left join ultimo on ultimo.visitor_id = score.visitor_id
group by 1, 2, 3, 4
order by visitantes desc, campanha;

-- Por bairro observado no evento. O visitante entra uma vez por bairro em que houve evento.
with bairros as (
  select distinct
    visitor_id,
    nullif(btrim(property_neighborhood), '') as bairro
  from public.ads_events
  where btrim(property_neighborhood) <> ''
)
select
  bairros.bairro,
  count(*) as visitantes,
  count(*) filter (where score.buyer_class = 'lead') as leads,
  round(avg(score.buyer_intent_score), 1) as buyer_medio,
  round(avg(score.broker_tester_score), 1) as broker_medio
from bairros
join public.buyer_quality_scores as score on score.visitor_id = bairros.visitor_id
group by 1
order by visitantes desc, bairro
limit 100;

-- Por dormitórios vistos
with dorms as (
  select distinct visitor_id, property_bedrooms as dormitorios
  from public.ads_events
  where property_bedrooms is not null
)
select
  dorms.dormitorios,
  count(*) as visitantes,
  count(*) filter (where score.buyer_class = 'lead') as leads,
  round(avg(score.buyer_intent_score), 1) as buyer_medio
from dorms
join public.buyer_quality_scores as score on score.visitor_id = dorms.visitor_id
group by 1
order by 1;

-- Por faixa de preço do imóvel visto
with faixas as (
  select distinct
    visitor_id,
    case
      when property_price < 500000 then 'ate_500'
      when property_price < 1000000 then '500_a_1m'
      when property_price < 2000000 then '1m_a_2m'
      when property_price < 4000000 then '2m_a_4m'
      else 'acima_4m'
    end as faixa
  from public.ads_events
  where property_price > 0
)
select
  faixas.faixa,
  count(*) as visitantes,
  count(*) filter (where score.buyer_class = 'lead') as leads,
  round(avg(score.buyer_intent_score), 1) as buyer_medio,
  round(avg(score.broker_tester_score), 1) as broker_medio
from faixas
join public.buyer_quality_scores as score on score.visitor_id = faixas.visitor_id
group by 1
order by 1;
