-- Durable receipt and stable payload for retries, restricted to the server role.
grant update (metadata) on public.leads to service_role;
create or replace function public.whatsapp_email_state(contact_lead_id uuid, receipt_id text default null)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare l public.leads; state jsonb;
begin
 select * into strict l from public.leads where id=contact_lead_id for update;
 if coalesce(l.metadata->>'source','') not in ('whatsapp','whatsapp_pre_registration') then raise exception 'not_whatsapp'; end if;
 state := coalesce(l.metadata->'whatsapp_notification','{}'::jsonb);
 if receipt_id is not null then
   if length(receipt_id)=0 then raise exception 'invalid_receipt'; end if;
   if state->>'email_id' is not null and state->>'email_id' <> receipt_id then raise exception 'receipt_conflict'; end if;
   state := state || jsonb_build_object('email_id',receipt_id,'accepted_at',clock_timestamp());
 elsif state->>'first_attempt_at' is null then
   state := state || jsonb_build_object('first_attempt_at',clock_timestamp());
 end if;
 update public.leads set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('whatsapp_notification',state) where id=contact_lead_id;
 return state || jsonb_build_object('phone',l.phone,'source',l.metadata->>'source','first_message_at',coalesce(l.metadata->>'first_message_at',l.metadata->>'pre_registered_at'));
end; $$;
revoke all on function public.whatsapp_email_state(uuid,text) from public, anon, authenticated;
grant execute on function public.whatsapp_email_state(uuid,text) to service_role;

create or replace function public.register_whatsapp_pre_registration(
 contact_id uuid, contact_phone text, property_context jsonb, page_url text
) returns table(lead_id uuid, notify boolean)
language plpgsql set search_path = pg_catalog, public as $$
declare existing_id uuid; normalized text; existing_source text; registered_at timestamptz := clock_timestamp();
begin
 normalized := regexp_replace(contact_phone,'[^0-9]','','g');
 if normalized is null or normalized !~ '^55[1-9][0-9]{9,10}$' or contact_id is null then raise exception 'invalid_phone'; end if;
 perform pg_advisory_xact_lock(hashtextextended(normalized,0));
 select l.id,l.metadata->>'source' into existing_id,existing_source from public.leads l
 where regexp_replace(l.phone,'[^0-9]','','g') in (normalized,substring(normalized from 3))
 order by l.created_at,l.id limit 1;
 if existing_id is not null then
   return query select existing_id,coalesce(existing_source='whatsapp_pre_registration',false);
   return;
 end if;
 insert into public.leads(id,phone,status,destination,metadata)
 values(contact_id,'+'||normalized,'novo','yincorp',jsonb_build_object(
   'source','whatsapp_pre_registration','pre_registered_at',registered_at,
   'phone_confirmation','self_declared','property',property_context,'page',page_url));
 insert into public.ads_events(event_id,event_name,event_time,product,visitor_id,session_id,metadata)
 values('whatsapp-preregistration/'||contact_id,'lead_created',registered_at,'ynteligencia','','',
   jsonb_build_object('source','whatsapp_pre_registration','lead_id',contact_id,'property',property_context))
 on conflict do nothing;
 return query select contact_id,true;
end; $$;
revoke all on function public.register_whatsapp_pre_registration(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.register_whatsapp_pre_registration(uuid,text,jsonb,text) to service_role;
