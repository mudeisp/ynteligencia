-- Disposable PostgreSQL ledger harness for V5; NOT a production audit substitute.
begin;
create table if not exists orulo_audit.v5_fixture_intents(
 operation_uuid uuid primary key,
 run_uuid uuid not null,
 manifest_hash text not null references orulo_audit.v5_manifests(manifest_hash),
 property_id uuid not null,
 expected jsonb not null,
 desired_plans jsonb not null,
 created_xid xid8 not null default pg_current_xact_id(),
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists orulo_audit.v5_fixture_receipts(
 operation_uuid uuid primary key references orulo_audit.v5_fixture_intents(operation_uuid),
 run_uuid uuid not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
revoke all on orulo_audit.v5_fixture_intents,orulo_audit.v5_fixture_receipts from public;
create or replace function orulo_audit.v5_fixture_audited_cas(p_run uuid,p_operation uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare i orulo_audit.v5_fixture_intents%rowtype; r jsonb;
begin
 select * into i from orulo_audit.v5_fixture_intents
 where operation_uuid=p_operation and run_uuid=p_run for update;
 if not found then raise exception 'V5_DURABLE_INTENT_REQUIRED'; end if;
 if i.created_xid=pg_current_xact_id() then
   raise exception 'V5_INTENT_MUST_BE_PREVIOUSLY_COMMITTED'; end if;
 if exists(select 1 from orulo_audit.v5_fixture_receipts where operation_uuid=p_operation) then
   raise exception 'V5_DUPLICATE_OPERATION'; end if;
 r:=orulo_audit.v5_fixture_cas(i.manifest_hash,i.run_uuid,i.property_id,i.expected,i.desired_plans);
 insert into orulo_audit.v5_fixture_receipts(operation_uuid,run_uuid,result)
 values(p_operation,p_run,r);
 return r || jsonb_build_object('fixtureReceipt',p_operation);
end;
$$;
revoke all on function orulo_audit.v5_fixture_audited_cas(uuid,uuid) from public;
comment on function orulo_audit.v5_fixture_audited_cas(uuid,uuid) is
 'Staging harness only: proves durable intent and receipt atomicity; not hash-chain production ledger';
commit;
