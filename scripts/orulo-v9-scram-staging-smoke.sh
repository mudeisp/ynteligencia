#!/usr/bin/env bash
set -euo pipefail
# Disposable database only. Never accept a remote DB or existing Postgres container.
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo 'CI_ONLY_STAGING_AUTH_SMOKE'; exit 1; }
container="orulo-v9-scram-${GITHUB_RUN_ID:-local}"
password='synthetic-ci-password-only'
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || :; }
trap cleanup EXIT
docker run -d --name "$container" --pull=always \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=orulo_v9_auth_test \
  -e POSTGRES_HOST_AUTH_METHOD=scram-sha-256 \
  postgres:17.6 >/dev/null
for i in $(seq 1 50); do
  if docker exec "$container" pg_isready -U postgres -d orulo_v9_auth_test >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_local(){ docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d orulo_v9_auth_test "$@"; }
# The official image allows local-loopback trust by default. Force the tested TCP
# endpoint to SCRAM, otherwise a wrong-password test can pass without auth.
docker exec "$container" bash -ceu 'conf="$(psql -X -At -U postgres -d orulo_v9_auth_test -c "show hba_file")"; sed -i "1i host all all 127.0.0.1/32 scram-sha-256" "$conf"; psql -X -U postgres -d orulo_v9_auth_test -c "select pg_reload_conf()" >/dev/null'
rule=$(docker exec "$container" psql -X -At -U postgres -d orulo_v9_auth_test -c "select auth_method from pg_hba_file_rules where type='host' and address='127.0.0.1' order by rule_number limit 1")
[[ "$rule" == 'scram-sha-256' ]] || { echo 'SCRAM_HBA_NOT_ACTIVE'; exit 1; }
psql_tcp(){ docker exec -i -e PGPASSWORD="$2" "$container" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$1" -d orulo_v9_auth_test -At -c "$3"; }
psql_local <<'SQL'
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create table public.properties(
 id uuid primary key default gen_random_uuid(),
 external_id text unique,source text,title text,development_name text,
 neighborhood text,city text,state text,latitude numeric,longitude numeric,
 price numeric,bedrooms numeric,bathrooms numeric,parking_spaces numeric,
 area numeric,image_url text,property_url text,active boolean,raw_data jsonb,
 created_at timestamptz default now(),updated_at timestamptz
);
alter table public.properties enable row level security;
grant usage on schema public to service_role,anon,authenticated;
grant select,insert,update on public.properties to service_role;
create policy legacy_service on public.properties to service_role using(true) with check(true);
SQL
for f in \
  supabase/migrations/20261104093722_orulo_postgres_audit.sql \
  supabase/migrations/20261104102956_orulo_paged_snapshots.sql \
  supabase/migrations/20261106114525_orulo_webhook_provenance.sql; do
  docker cp "$f" "$container:/tmp/$(basename "$f")"
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d orulo_v9_auth_test \
    -f "/tmp/$(basename "$f")" >/dev/null
done
initial=$(psql_local -At -c "select string_agg(rolname||':'||rolcanlogin,',' order by rolname) from pg_roles where rolname in ('orulo_webhook_writer','orulo_provenance_reader')")
[[ "$initial" == 'orulo_provenance_reader:false,orulo_webhook_writer:false' || "$initial" == 'orulo_provenance_reader:f,orulo_webhook_writer:f' ]] || { echo "ROLE_DEFAULT_MISMATCH"; exit 1; }
# ONLY activate test logins inside the disposable container.
psql_local >/dev/null <<'SQL'
alter role orulo_webhook_writer login password 'writer-only-ci-password';
alter role orulo_provenance_reader login password 'reader-only-ci-password';
SQL
auth=$(psql_tcp orulo_webhook_writer writer-only-ci-password "select session_user::text||':'||current_user::text")
[[ "$auth" == 'orulo_webhook_writer:orulo_webhook_writer' ]] || { echo 'WRITER_AUTH_IDENTITY_MISMATCH'; exit 1; }
auth=$(psql_tcp orulo_provenance_reader reader-only-ci-password "select session_user::text||':'||current_user::text")
[[ "$auth" == 'orulo_provenance_reader:orulo_provenance_reader' ]] || { echo 'READER_AUTH_IDENTITY_MISMATCH'; exit 1; }
if psql_tcp orulo_webhook_writer 'wrong-test-password' 'select 1' >/dev/null 2>&1; then
  echo 'SCRAM_WRONG_PASSWORD_ACCEPTED'; exit 1
fi
if psql_tcp orulo_webhook_writer writer-only-ci-password 'select * from orulo_audit.property_transitions' >/dev/null 2>&1; then
  echo 'WRITER_DIRECT_TABLE_ACCESS'; exit 1
fi
if psql_tcp orulo_provenance_reader reader-only-ci-password "select orulo_audit.apply_webhook('1','[]'::jsonb,true,now())" >/dev/null 2>&1; then
  echo 'READER_CAN_APPLY_WEBHOOK'; exit 1
fi
if psql_tcp orulo_webhook_writer writer-only-ci-password "select orulo_audit.read_webhook_provenance(gen_random_uuid(),gen_random_uuid())" >/dev/null 2>&1; then
  echo 'WRITER_CAN_READ_PROVENANCE'; exit 1
fi
# Verify no membership path from legacy service_role to either dedicated identity.
membership=$(psql_local -At -c "select count(*) from pg_auth_members m join pg_roles child on child.oid=m.roleid join pg_roles parent on parent.oid=m.member where parent.rolname='service_role' and child.rolname in ('orulo_webhook_writer','orulo_provenance_reader')")
[[ "$membership" == '0' ]] || { echo 'LEGACY_ROLE_MEMBERSHIP_LEAK'; exit 1; }
echo 'V9_SCRAM_STAGING_AUTH_PASS migration=yes dedicated_sessions=yes wrong_password_denied=yes direct_dml_denied=yes cross_role_denied=yes'
