/*
  Relatório somente leitura dos últimos 30 e 60 dias de ads_events.
  Não grava, não exporta e não decide quais sinais vão ao Google.

  Rodar manualmente no SQL editor, como service role.
  Não faz parte do caminho de conversão.
*/

-- Volume por evento, 30 dias
select
  event_name,
  count(*) as events,
  count(distinct visitor_id) as visitors,
  count(distinct session_id) as sessions,
  count(*) filter (
    where btrim(gclid) <> '' or btrim(gbraid) <> '' or btrim(wbraid) <> ''
  ) as events_with_click,
  count(distinct visitor_id) filter (
    where btrim(gclid) <> '' or btrim(gbraid) <> '' or btrim(wbraid) <> ''
  ) as visitors_with_click
from public.ads_events
where event_time >= now() - interval '30 days'
group by event_name
order by events desc;

-- Volume por evento, 60 dias
select
  event_name,
  count(*) as events,
  count(distinct visitor_id) as visitors,
  count(distinct session_id) as sessions,
  count(*) filter (
    where btrim(gclid) <> '' or btrim(gbraid) <> '' or btrim(wbraid) <> ''
  ) as events_with_click,
  count(distinct visitor_id) filter (
    where btrim(gclid) <> '' or btrim(gbraid) <> '' or btrim(wbraid) <> ''
  ) as visitors_with_click
from public.ads_events
where event_time >= now() - interval '60 days'
group by event_name
order by events desc;

-- Campanha entre eventos com clique, 60 dias
select
  event_name,
  coalesce(nullif(btrim(utm_campaign), ''), '(sem campanha)') as utm_campaign,
  count(*) as events,
  count(distinct visitor_id) as visitors
from public.ads_events
where event_time >= now() - interval '60 days'
  and (btrim(gclid) <> '' or btrim(gbraid) <> '' or btrim(wbraid) <> '')
group by event_name, coalesce(nullif(btrim(utm_campaign), ''), '(sem campanha)')
order by events desc, event_name;

-- Progressão: visitante que fez o passo A e, depois, o passo B. 60 dias.
with steps(step_name, step_order) as (
  values
    ('property_view', 1),
    ('property_view_multiple', 2),
    ('ai_search', 3),
    ('agent_handoff_created', 4),
    ('agent_opened', 5),
    ('specialist_cta_opened', 6),
    ('high_intent_buyer', 7),
    ('lead_created', 8)
),
first_step as (
  select
    event.visitor_id,
    event.event_name,
    min(event.event_time) as first_at
  from public.ads_events as event
  join steps on steps.step_name = event.event_name
  where event.event_time >= now() - interval '60 days'
  group by event.visitor_id, event.event_name
)
select
  earlier.event_name as from_event,
  later.event_name as to_event,
  count(*) as visitors
from first_step as earlier
join first_step as later
  on later.visitor_id = earlier.visitor_id
 and later.first_at > earlier.first_at
join steps as from_step on from_step.step_name = earlier.event_name
join steps as to_step on to_step.step_name = later.event_name
where to_step.step_order > from_step.step_order
group by earlier.event_name, later.event_name, from_step.step_order, to_step.step_order
order by from_step.step_order, to_step.step_order;
