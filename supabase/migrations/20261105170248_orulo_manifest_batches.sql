-- Align SQL with the reviewed client extension casing; no new origins/paths/fields.
begin;
CREATE OR REPLACE FUNCTION orulo_audit.batch_merge(raw jsonb, patches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare x jsonb; k text; v jsonb; pattern constant text:='^https://static[.]orulo[.]com[.]br/images/properties/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]([jJ][pP][eE]?[gG]|[pP][nN][gG]|[wW][eE][bB][pP])$';
begin
 if jsonb_typeof(patches) is distinct from 'array' or jsonb_array_length(patches)>1000 or jsonb_typeof(raw->'building'->'floor_plans') is distinct from 'array' then raise exception 'BATCH_PATCH_INVALID'; end if;
 if (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(patches)p) then raise exception 'BATCH_DUPLICATE_PLAN_ID'; end if;
 if (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(raw->'building'->'floor_plans')p) then raise exception 'BATCH_EXISTING_PLAN_IDS_INVALID'; end if;
 for x in select * from jsonb_array_elements(patches) loop
  if x->>'id' is null or x->>'image_url' is null or not(x->>'image_url'~pattern) or not exists(select 1 from jsonb_array_elements(raw->'building'->'floor_plans')p where p->>'id'=x->>'id') then raise exception 'BATCH_PATCH_PLAN_MISMATCH'; end if;
  for k,v in select * from jsonb_each(x) loop
   if k='id' then continue; end if;
   if k='images' then
    if jsonb_typeof(v) is distinct from 'array' or exists(select 1 from jsonb_array_elements(v)u where jsonb_typeof(u)<>'string' or not(u#>>'{}'~pattern)) then raise exception 'BATCH_IMAGE_URL_INVALID'; end if;
   elsif k not in ('image_url','url','2280x1800','1024x1024','520x280') or jsonb_typeof(v)<>'string' or not(v#>>'{}'~pattern) then raise exception 'BATCH_IMAGE_FIELDS_ONLY'; end if;
  end loop;
 end loop;
 return (select coalesce(jsonb_agg(case when orulo_audit.batch_has_image(p) then p else p||coalesce((select z-'id' from jsonb_array_elements(patches)z where z->>'id'=p->>'id'),'{}'::jsonb) end order by n),'[]'::jsonb) from jsonb_array_elements(raw->'building'->'floor_plans') with ordinality a(p,n));
end$function$;
-- CREATE OR REPLACE preserves the existing owner, ACL and IMMUTABLE behavior.
commit;
