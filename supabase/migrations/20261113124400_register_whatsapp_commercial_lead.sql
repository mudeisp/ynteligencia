create or replace function public.register_whatsapp_commercial_lead(inbox_lead_id uuid, contact_phone text, received_at timestamptz)
returns table(lead_id uuid, notify boolean)
language plpgsql
set search_path = pg_catalog, public
as $$
declare existing_id uuid; normalized text; matches integer;
begin
  normalized := regexp_replace(contact_phone, '[^0-9]', '', 'g');
  if inbox_lead_id is null or normalized is null or normalized !~ '^[1-9][0-9]{7,14}$' or received_at is null then
    raise exception 'invalid_whatsapp_lead';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized, 0));
  if exists (select 1 from public.leads l where l.id = inbox_lead_id and l.metadata->>'source' = 'whatsapp') then
    return query select inbox_lead_id, true;
    return;
  end if;
  select count(*), (array_agg(l.id))[1] into matches, existing_id
    from public.leads l
    where regexp_replace(l.phone, '[^0-9]', '', 'g') = normalized
       or (normalized ~ '^55[0-9]{10,11}$' and regexp_replace(l.phone, '[^0-9]', '', 'g') = substring(normalized from 3));
  if matches = 1 then
    return query select existing_id, false;
    return;
  end if;
  insert into public.leads (id, phone, status, destination, metadata)
    values (inbox_lead_id, '+' || normalized, 'novo', 'yincorp',
      jsonb_build_object('source','whatsapp','first_message_at',received_at,'phone_match_count',matches));
  return query select inbox_lead_id, true;
end;
$$;
revoke all on function public.register_whatsapp_commercial_lead(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.register_whatsapp_commercial_lead(uuid,text,timestamptz) to service_role;
