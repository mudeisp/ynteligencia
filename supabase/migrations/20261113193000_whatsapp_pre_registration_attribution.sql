create function public.register_whatsapp_pre_registration_v2(
 contact_id uuid, contact_phone text, property_context jsonb, page_url text,
 attribution_context jsonb, first_touch_context jsonb, contact_ref text
) returns table(lead_id uuid, notify boolean, created boolean)
language plpgsql set search_path to pg_catalog, public as $$
declare saved record; canonical jsonb; refs jsonb;
begin
 if contact_ref !~ '^[A-F0-9]{12}$' then raise exception 'invalid_ref'; end if;
 select * into strict saved from public.register_whatsapp_pre_registration(contact_id,contact_phone,property_context,page_url);
 select coalesce(l.metadata,'{}'::jsonb) into canonical from public.leads l where l.id=saved.lead_id for update;
 refs := coalesce(canonical->'whatsapp_click_refs','{}'::jsonb) ||
   jsonb_build_object(contact_ref,jsonb_build_object('attribution',attribution_context,'first_touch',first_touch_context,
     'property',property_context,'page',page_url,'at',clock_timestamp()));
 update public.leads l set phone='+'||regexp_replace(contact_phone,'[^0-9]','','g'),updated_at=clock_timestamp(),
 metadata=canonical || jsonb_build_object(
   'attribution',coalesce(canonical->'attribution','{}'::jsonb)||attribution_context,
   'first_touch',first_touch_context||coalesce(canonical->'first_touch','{}'::jsonb),
   'whatsapp_click_ref',contact_ref,'whatsapp_click_refs',refs,'whatsapp_property',property_context,
   'whatsapp_contact_consent_at',clock_timestamp())
 where l.id=saved.lead_id;
 return query select saved.lead_id,saved.notify,saved.lead_id=contact_id;
end $$;
revoke all on function public.register_whatsapp_pre_registration_v2(uuid,text,jsonb,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.register_whatsapp_pre_registration_v2(uuid,text,jsonb,text,jsonb,jsonb,text) to service_role;

create function public.record_whatsapp_contact_stage(target_lead uuid,target_stage text)
returns void language plpgsql set search_path to pg_catalog,public as $$
begin
 if target_stage not in ('attended','visit_scheduled','visit_completed') then raise exception 'invalid_stage'; end if;
 update public.leads set metadata=coalesce(metadata,'{}') || jsonb_build_object('whatsapp_manual_stages',
   jsonb_build_object(target_stage,clock_timestamp()) || coalesce(metadata->'whatsapp_manual_stages','{}'))
 where id=target_lead and metadata->>'source' in ('whatsapp','whatsapp_pre_registration');
 if not found then raise exception 'lead_not_found'; end if;
end $$;
revoke all on function public.record_whatsapp_contact_stage(uuid,text) from public,anon,authenticated;
grant execute on function public.record_whatsapp_contact_stage(uuid,text) to service_role;
