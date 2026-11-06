-- V9: same private audit architecture; transactional observations, NOT authorization.
-- Prepared only. Both dedicated identities remain NOLOGIN until a separate rollout.
begin;
do $$begin
 if exists(select 1 from pg_roles where rolname in ('orulo_webhook_writer','orulo_provenance_reader','orulo_webhook_owner')) then
  raise exception 'V9_ROLES_ALREADY_EXIST_REVIEW_REQUIRED';
 end if;
 create role orulo_webhook_writer nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
 create role orulo_provenance_reader nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
 create role orulo_webhook_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
end$$;
grant orulo_webhook_owner to postgres;
grant usage,create on schema orulo_audit to orulo_webhook_owner;
grant usage on schema public to orulo_webhook_owner;
grant select,insert,update on public.properties to orulo_webhook_owner;
create policy orulo_webhook_select on public.properties for select to orulo_webhook_owner using(source='novos' and external_id like 'orulo:%');
create policy orulo_webhook_insert on public.properties for insert to orulo_webhook_owner with check(source='novos' and external_id like 'orulo:%');
create policy orulo_webhook_update on public.properties for update to orulo_webhook_owner using(source='novos' and external_id like 'orulo:%') with check(source='novos' and external_id like 'orulo:%');

create table orulo_audit.property_transitions(
 transition_id bigint generated always as identity primary key,
 event_uuid uuid not null unique, id uuid not null, transaction_id xid8 not null,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')),
 writer_session name not null, authenticated_webhook boolean not null,
 before_full_hash text, after_full_hash text, before_content_hash text, after_content_hash text,
 changed_fields jsonb not null check(jsonb_typeof(changed_fields)='array'),
 recorded_at timestamptz not null, canonical text not null,
 evidence_hash text not null check(evidence_hash=encode(sha256(convert_to(canonical,'UTF8')),'hex'))
);
alter table orulo_audit.property_transitions owner to orulo_audit_owner;
alter table orulo_audit.property_transitions enable row level security;
alter table orulo_audit.property_transitions force row level security;
create policy owner_only on orulo_audit.property_transitions to orulo_audit_owner using(true) with check(true);
create index property_transition_lookup on orulo_audit.property_transitions(id,transition_id);
create trigger immutable_rows before update or delete on orulo_audit.property_transitions for each row execute function orulo_audit.immutable();
create trigger immutable_table before truncate on orulo_audit.property_transitions for each statement execute function orulo_audit.immutable();
revoke all on orulo_audit.property_transitions from public,anon,authenticated,service_role,orulo_webhook_writer,orulo_provenance_reader,orulo_webhook_owner;

-- JSON pointers; arrays are indexed, missing differs from JSON null. Values are not logged.
create function orulo_audit.changed_paths(b jsonb,a jsonb,p text default '') returns jsonb
 language plpgsql immutable set search_path='' as $$
declare k text; i integer; result jsonb:='[]';
begin
 if b is not distinct from a then return result; end if;
 if jsonb_typeof(b)='object' and jsonb_typeof(a)='object' then
  for k in select key from (select jsonb_object_keys(b) key union select jsonb_object_keys(a)) s order by key loop
   result:=result||orulo_audit.changed_paths(b->k,a->k,p||'/'||replace(replace(k,'~','~0'),'/','~1'));
  end loop;
 elsif jsonb_typeof(b)='array' and jsonb_typeof(a)='array' then
  for i in 0..greatest(jsonb_array_length(b),jsonb_array_length(a))-1 loop
   result:=result||orulo_audit.changed_paths(b->i,a->i,p||'/'||i);
  end loop;
 else result:=jsonb_build_array(p); end if;
 return result;
end$$;
create function orulo_audit.observe_property_transition() returns trigger language plpgsql security definer
 set search_path='' set timezone='UTC' as $$
declare b jsonb; a jsonb; e jsonb; eid uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
begin
 if TG_OP<>'INSERT' then b:=to_jsonb(OLD)||jsonb_build_object('created_at',OLD.created_at at time zone 'UTC','updated_at',OLD.updated_at at time zone 'UTC'); end if;
 if TG_OP<>'DELETE' then a:=to_jsonb(NEW)||jsonb_build_object('created_at',NEW.created_at at time zone 'UTC','updated_at',NEW.updated_at at time zone 'UTC'); end if;
 -- Observe legacy/CAS writers too, but never attest them as the webhook.
 if coalesce(b->>'external_id','') not like 'orulo:%' and coalesce(a->>'external_id','') not like 'orulo:%' then return null; end if;
 e:=jsonb_build_object('version',1,'eventId',eid,'uuid',coalesce(NEW.id,OLD.id),'transactionId',pg_current_xact_id()::text,
  'operation',TG_OP,'writerSession',session_user,'authenticatedWebhook',session_user='orulo_webhook_writer',
  'beforeFullHash',md5(b::text),'afterFullHash',md5(a::text),
  'beforeContentHash',md5((b-'updated_at')::text),'afterContentHash',md5((a-'updated_at')::text),
  'changedFields',orulo_audit.changed_paths(b,a),'recordedAt',t);
 insert into orulo_audit.property_transitions(event_uuid,id,transaction_id,operation,writer_session,authenticated_webhook,
  before_full_hash,after_full_hash,before_content_hash,after_content_hash,changed_fields,recorded_at,canonical,evidence_hash)
 values(eid,coalesce(NEW.id,OLD.id),pg_current_xact_id(),TG_OP,session_user,session_user='orulo_webhook_writer',
  e->>'beforeFullHash',e->>'afterFullHash',e->>'beforeContentHash',e->>'afterContentHash',e->'changedFields',t,e::text,encode(sha256(convert_to(e::text,'UTF8')),'hex'));
 return null;
end$$;
alter function orulo_audit.changed_paths(jsonb,jsonb,text) owner to orulo_audit_owner;
alter function orulo_audit.observe_property_transition() owner to orulo_audit_owner;
revoke all on function orulo_audit.changed_paths(jsonb,jsonb,text),orulo_audit.observe_property_transition() from public,anon,authenticated,service_role;
create trigger orulo_v9_transaction_receipt after insert or update or delete on public.properties for each row execute function orulo_audit.observe_property_transition();

-- Entire building operation is atomic, including stale removals and receipt inserts.
-- Fixed normalizer fields only; default id/created_at on insert, preserved on conflict.
create function orulo_audit.apply_webhook(p_building text,p_rows jsonb,p_removed boolean,p_updated_at timestamptz) returns jsonb
 language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' set statement_timeout='30s' set lock_timeout='5s' as $$
declare r jsonb; cols text; vals text; updates text; saved jsonb:='[]'; deactivated jsonb:='[]';
 existing jsonb; changed jsonb; allowed text[]:=array['external_id','source','title','development_name','neighborhood','city','state','latitude','longitude','price','bedrooms','bathrooms','parking_spaces','area','image_url','property_url','active','raw_data','updated_at'];
begin
 if session_user<>'orulo_webhook_writer' then raise insufficient_privilege using message='V9_DEDICATED_LOGIN_REQUIRED'; end if;
 if p_building !~ '^[1-9][0-9]*$' or p_building is null or p_updated_at is null or p_removed is null or jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows)>1000 or (p_removed and jsonb_array_length(p_rows)<>0) or (not p_removed and jsonb_array_length(p_rows)=0) then raise exception 'V9_INVALID_BUILDING_OPERATION'; end if;
 perform pg_advisory_xact_lock(hashtextextended('orulo-webhook:'||p_building,0));
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into existing from public.properties p where source='novos' and raw_data->>'building_id'=p_building;
 if not p_removed then
  if (select count(*)<>count(distinct value->>'external_id') from jsonb_array_elements(p_rows)) then raise exception 'V9_DUPLICATE_EXTERNAL_ID'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
   if jsonb_typeof(r) is distinct from 'object' or r->>'source' is distinct from 'novos' or r->>'external_id' !~ ('^orulo:'||p_building||':[0-9]+$')
   or r->>'external_id' is null or r->'raw_data'->>'building_id' is distinct from p_building or r->'active' is distinct from 'true'::jsonb
   or not(r?'updated_at') or exists(select 1 from jsonb_object_keys(r) k where k<>all(allowed)) then raise exception 'V9_ROW_SCOPE_OR_FIELDS_DENIED'; end if;
   -- Reject collision with another source instead of silently updating it.
   if exists(select 1 from public.properties p where external_id=r->>'external_id' and (source<>'novos' or raw_data->>'building_id' is distinct from p_building)) then raise exception 'V9_EXTERNAL_ID_COLLISION'; end if;
   select string_agg(format('%I',k),',' order by k),string_agg(format('x.%I',k),',' order by k),
    string_agg(format('%I=excluded.%I',k,k),',' order by k) into cols,vals,updates from jsonb_object_keys(r) k;
   execute format('insert into public.properties(%s) select %s from jsonb_populate_record(null::public.properties,$1) x on conflict(external_id) do update set %s returning to_jsonb(properties)',cols,vals,updates) into changed using r;
   saved:=saved||jsonb_build_array(changed);
  end loop;
 end if;
 with affected as(update public.properties set active=false,updated_at=p_updated_at
  where source='novos' and raw_data->>'building_id'=p_building and (p_removed or external_id not in(select value->>'external_id' from jsonb_array_elements(p_rows))) returning *)
 select coalesce(jsonb_agg(to_jsonb(affected)),'[]') into deactivated from affected;
 return jsonb_build_object('existingRows',existing,'savedRows',saved,'deactivatedRows',deactivated);
end$$;
alter function orulo_audit.apply_webhook(text,jsonb,boolean,timestamptz) owner to orulo_webhook_owner;
revoke all on function orulo_audit.apply_webhook(text,jsonb,boolean,timestamptz) from public,anon,authenticated,service_role;
grant usage on schema orulo_audit to orulo_webhook_writer,orulo_provenance_reader;
grant execute on function orulo_audit.apply_webhook(text,jsonb,boolean,timestamptz) to orulo_webhook_writer;
revoke create on schema orulo_audit from orulo_webhook_owner;

-- Derive endpoints and time bounds from sealed journal pages, never caller hashes.
create function orulo_audit.read_webhook_provenance(p_run uuid,p_id uuid) returns jsonb
 language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare b jsonb; a jsonb; bt timestamptz; at_ timestamptz; current_hash text; current_content text;
 t orulo_audit.property_transitions%rowtype; events jsonb:='[]'; fields jsonb:='[]'; n integer:=0;
begin
 if session_user<>'orulo_provenance_reader' then raise insufficient_privilege using message='V9_DEDICATED_READER_REQUIRED'; end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='INTENT' and event->>'id'=p_id::text) then return null; end if;
 if (select count(*) from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2') and event->'snapshot'->>'membershipStable'='true')<>2 then return null; end if;
 if (select b.columns=a.columns from orulo_audit.snapshot_sets b join orulo_audit.snapshot_sets a using(run_uuid) where b.run_uuid=p_run and b.kind='BASELINE_V2' and a.kind='READBACK_V2') is distinct from true then return null; end if;
 select s.record,e.created_at into b,bt from orulo_audit.snapshot_records s join orulo_audit.entries e on e.run_uuid=s.run_uuid and e.sequence=s.page_sequence where s.run_uuid=p_run and s.kind='BASELINE_V2' and s.id=p_id;
 select s.record,e.created_at into a,at_ from orulo_audit.snapshot_records s join orulo_audit.entries e on e.run_uuid=s.run_uuid and e.sequence=s.page_sequence where s.run_uuid=p_run and s.kind='READBACK_V2' and s.id=p_id;
 if b->>4 is null or a->>4 is null or b->>4=a->>4 or bt>=at_ then return null; end if;
 current_hash:=b->>4;current_content:=b->>5;
 for t in select * from orulo_audit.property_transitions where id=p_id and recorded_at>bt and recorded_at<=at_ order by transition_id loop
  n:=n+1;
  if n>100 or t.operation<>'UPDATE' or not t.authenticated_webhook or t.writer_session<>'orulo_webhook_writer'
  or t.before_full_hash is distinct from current_hash or t.before_content_hash is distinct from current_content
  or exists(select 1 from orulo_audit.entries e where e.run_uuid=p_run and e.created_xid=t.transaction_id)
  or t.evidence_hash<>encode(sha256(convert_to(t.canonical,'UTF8')),'hex')
  or t.canonical::jsonb is distinct from jsonb_build_object('version',1,'eventId',t.event_uuid,'uuid',t.id,'transactionId',t.transaction_id::text,'operation',t.operation,'writerSession',t.writer_session,'authenticatedWebhook',t.authenticated_webhook,'beforeFullHash',t.before_full_hash,'afterFullHash',t.after_full_hash,'beforeContentHash',t.before_content_hash,'afterContentHash',t.after_content_hash,'changedFields',t.changed_fields,'recordedAt',t.recorded_at)
  then return null; end if;
  events:=events||jsonb_build_array(jsonb_build_object('eventId',t.event_uuid,'transactionId',t.transaction_id::text,'beforeFullHash',t.before_full_hash,'afterFullHash',t.after_full_hash,'evidenceHash',t.evidence_hash));
  fields:=fields||t.changed_fields;current_hash:=t.after_full_hash;current_content:=t.after_content_hash;
 end loop;
 if n=0 or current_hash is distinct from a->>4 or current_content is distinct from a->>5 then return null; end if;
 select jsonb_agg(distinct value order by value) into fields from jsonb_array_elements(fields);
 return jsonb_build_object('kind','INDEPENDENT_WRITER_ATTESTATION_V1','uuid',p_id,'runUuid',p_run,'process','orulo-webhook/dedicated-postgres-login',
  'eventId',events->0->>'eventId','transactionId',events->0->>'transactionId','executorTransactionExcluded',true,
  'beforeFullHash',b->>4,'afterFullHash',a->>4,'changedFields',fields,'transitions',events,'policy','STRICT_GLOBAL_V1');
end$$;
alter function orulo_audit.read_webhook_provenance(uuid,uuid) owner to orulo_audit_owner;
revoke all on function orulo_audit.read_webhook_provenance(uuid,uuid) from public,anon,authenticated,service_role,orulo_webhook_writer;
grant execute on function orulo_audit.read_webhook_provenance(uuid,uuid) to orulo_provenance_reader;
commit;
