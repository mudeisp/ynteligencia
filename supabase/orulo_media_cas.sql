-- Install only after review. Does not update any property on installation.
-- Server-side scope is intentionally frozen to the approved SP batch 1 (99 IDs).
begin;
create or replace function public.orulo_media_cas(
  p_id uuid, p_expected jsonb, p_floor_plans jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set timezone = 'UTC'
set lock_timeout = '5s'
as $function$
declare
  v_row public.properties%rowtype;
  v_expected public.properties%rowtype;
  v_after public.properties%rowtype;
  v_id text;
  v_raw jsonb;
  v_before_json jsonb;
  v_after_json jsonb;
  v_image_keys constant text[] := array['image_url','images','2280x1800','1024x1024','520x280','url'];
  v_allowed constant text[] := array['43126','4969','82124','49132','65646','70542','66664','52286','85474','44524','67183','20980','65572','46652','27313','70879','78437','25147','81726','51327','1707','74610','40580','63635','64647','85486','69302','4075','80450','2920','5303','4836','82828','67082','74738','71044','76145','3349','22027','3198','3272','49267','3207','86645','86646','83026','50575','79391','74267','78018','81308','81351','81348','20283','80202','27977','20632','24562','20333','71097','29350','59964','76053','66288','82011','36776','72335','31789','86526','80096','83366','51496','40196','74315','55630','20407','39280','21449','21605','84525','38041','38427','38740','86085','75973','41663','42122','42586','43537','51452','46609','21642','73923','21786','5422','41230','75971','66668','47279'];
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'ORULO_CAS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_id is null or jsonb_typeof(p_expected) is distinct from 'object'
     or jsonb_typeof(p_floor_plans) is distinct from 'array'
     or jsonb_array_length(p_floor_plans) > 1000 then
    raise invalid_parameter_value using message = 'ORULO_CAS_INVALID_INPUT';
  end if;

  select p.* into v_row from public.properties p where p.id = p_id for update;
  if not found then return jsonb_build_object('status','NOT_FOUND','id',p_id); end if;
  v_id := coalesce(v_row.raw_data->>'building_id',v_row.raw_data->'building'->>'id');
  if v_id is null or not (v_id = any(v_allowed)) or v_row.state is distinct from 'SP'
     or v_row.source is distinct from 'novos' or v_row.active is distinct from true then
    raise insufficient_privilege using message = 'ORULO_CAS_SCOPE_DENIED';
  end if;
  if not (p_expected ?& array(select jsonb_object_keys(to_jsonb(v_row))))
     or (select count(*) from jsonb_object_keys(p_expected)) <>
        (select count(*) from jsonb_object_keys(to_jsonb(v_row))) then
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  -- Cast timestamps/numerics with table types; compare the entire expected row, not just updated_at.
  select * into v_expected from jsonb_populate_record(null::public.properties,p_expected);
  if v_expected.id is distinct from p_id or jsonb_typeof(v_expected.raw_data->'building') is distinct from 'object'
     or jsonb_typeof(v_expected.raw_data->'building'->'floor_plans') is distinct from 'array' then
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  -- Only image fields of existing floor plans may change. No new/reordered plans or typology edits.
  if (select coalesce(jsonb_agg(plan-v_image_keys order by n),'[]'::jsonb)
        from jsonb_array_elements(v_expected.raw_data->'building'->'floor_plans') with ordinality a(plan,n))
     is distinct from
     (select coalesce(jsonb_agg(plan-v_image_keys order by n),'[]'::jsonb)
        from jsonb_array_elements(p_floor_plans) with ordinality a(plan,n)) then
    raise invalid_parameter_value using message = 'ORULO_CAS_IMAGE_FIELDS_ONLY';
  end if;
  v_raw := jsonb_set(v_expected.raw_data,'{building,floor_plans}',p_floor_plans,false);
  if to_jsonb(v_row) is distinct from to_jsonb(v_expected) then
    -- Repeated identical operation is a no-op only if every non-authorized value still matches.
    if (to_jsonb(v_row)-'updated_at') =
       ((to_jsonb(v_expected)-'updated_at') || jsonb_build_object('raw_data',v_raw)) then
      return jsonb_build_object('status','UNCHANGED','id',p_id,'row',to_jsonb(v_row));
    end if;
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  if v_row.raw_data = v_raw then
    return jsonb_build_object('status','UNCHANGED','id',p_id,'row',to_jsonb(v_row));
  end if;

  update public.properties p
     set raw_data = jsonb_set(p.raw_data,'{building,floor_plans}',p_floor_plans,false),
         updated_at = clock_timestamp()
   where p.id = p_id returning p.* into v_after;
  -- Roll back even trigger-induced changes outside the two permitted paths.
  if (to_jsonb(v_after)-'updated_at'-'raw_data') is distinct from (to_jsonb(v_row)-'updated_at'-'raw_data')
     or (v_after.raw_data #- '{building,floor_plans}') is distinct from (v_row.raw_data #- '{building,floor_plans}')
     or v_after.raw_data->'building'->'floor_plans' is distinct from p_floor_plans then
    raise check_violation using message = 'ORULO_CAS_PRESERVATION_FAILED';
  end if;
  v_before_json := to_jsonb(v_row) || jsonb_build_object(
    'created_at',v_row.created_at at time zone 'UTC','updated_at',v_row.updated_at at time zone 'UTC');
  v_after_json := to_jsonb(v_after) || jsonb_build_object(
    'created_at',v_after.created_at at time zone 'UTC','updated_at',v_after.updated_at at time zone 'UTC');
  return jsonb_build_object('status','UPDATED','id',p_id,'row',to_jsonb(v_after),
    'receipt',jsonb_build_object('id',p_id,'verified',true,
      'expectedBeforeContentHash',md5((v_before_json-'updated_at')::text),
      'expectedAfterContentHash',md5((v_after_json-'updated_at')::text),
      'beforeFullHash',md5(v_before_json::text),'afterFullHash',md5(v_after_json::text),
      'allowedChangedPaths',jsonb_build_array('raw_data.building.floor_plans','updated_at')));
end;
$function$;
revoke all on function public.orulo_media_cas(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.orulo_media_cas(uuid,jsonb,jsonb) to service_role;
commit;

