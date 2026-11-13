create or replace function public.register_whatsapp_contact(contact_id uuid, phone text, received_at timestamptz, click_ref text)
returns table(lead_id uuid, notify boolean)
language plpgsql
set search_path = pg_catalog, public
as $$
declare registration record; click public.ads_events;
begin
  select * into strict registration from public.register_whatsapp_commercial_lead(contact_id, phone, received_at);
  select * into click from public.ads_events e
    where e.event_id = click_ref and e.event_name = 'whatsapp_cta_clicked'
      and e.event_time between received_at - interval '30 days' and received_at
    order by e.event_time desc limit 1;
  if registration.notify then
    if click.id is not null then
      update public.leads l set metadata = l.metadata || jsonb_build_object(
        'whatsapp_click_ref', click_ref,
        'attribution', jsonb_build_object('gclid',click.gclid,'gbraid',click.gbraid,'wbraid',click.wbraid,
          'utm_source',click.utm_source,'utm_medium',click.utm_medium,'utm_campaign',click.utm_campaign,
          'utm_content',click.utm_content,'utm_term',click.utm_term,'landing_page',click.metadata->>'page'),
        'property',jsonb_build_object('id',click.property_id,'name',click.property_name))
      where l.id = registration.lead_id and not (l.metadata ? 'whatsapp_click_ref');
    end if;
    insert into public.ads_events (event_id,event_name,event_time,product,visitor_id,session_id,metadata)
    values ('whatsapp-lead/' || registration.lead_id,'lead_created',received_at,'ynteligencia',
      coalesce(click.visitor_id,''),coalesce(click.session_id,''),
      jsonb_build_object('source','whatsapp','lead_id',registration.lead_id,'click_ref',click.event_id))
    on conflict do nothing;
  end if;
  return query select registration.lead_id,registration.notify;
end;
$$;
revoke all on function public.register_whatsapp_contact(uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.register_whatsapp_contact(uuid,text,timestamptz,text) to service_role;
