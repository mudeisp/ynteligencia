-- Durable receipt and stable payload for retries, restricted to the server role.
grant update (metadata) on public.leads to service_role;
create or replace function public.whatsapp_email_state(contact_lead_id uuid, receipt_id text default null)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare l public.leads; state jsonb;
begin
 select * into strict l from public.leads where id=contact_lead_id for update;
 if l.metadata->>'source' is distinct from 'whatsapp' then raise exception 'not_whatsapp'; end if;
 state := coalesce(l.metadata->'whatsapp_notification','{}'::jsonb);
 if receipt_id is not null then
   if length(receipt_id)=0 then raise exception 'invalid_receipt'; end if;
   if state->>'email_id' is not null and state->>'email_id' <> receipt_id then raise exception 'receipt_conflict'; end if;
   state := state || jsonb_build_object('email_id',receipt_id,'accepted_at',clock_timestamp());
 elsif state->>'first_attempt_at' is null then
   state := state || jsonb_build_object('first_attempt_at',clock_timestamp());
 end if;
 update public.leads set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('whatsapp_notification',state) where id=contact_lead_id;
 return state || jsonb_build_object('phone',l.phone,'first_message_at',l.metadata->>'first_message_at');
end; $$;
revoke all on function public.whatsapp_email_state(uuid,text) from public, anon, authenticated;
grant execute on function public.whatsapp_email_state(uuid,text) to service_role;
