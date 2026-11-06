#!/usr/bin/env bash
set -euo pipefail
# Disposable database only. Never accept a remote DB or existing Postgres container.
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo 'CI_ONLY_STAGING_AUTH_SMOKE'; exit 1; }
container="orulo-v9-scram-${GITHUB_RUN_ID:-local}"
password='synthetic-ci-password-only'
tls_dir=$(mktemp -d)
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || :; rm -rf -- "$tls_dir"; }
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
# Real TLS, with disposable CA, verified certificate chain and hostname. These
# private keys are synthetic test files, never artifacts or production secrets.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=V9 disposable CI CA' \
  -keyout "$tls_dir/ca.key" -out "$tls_dir/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
  -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr" >/dev/null 2>&1
printf '%s\n' 'subjectAltName=DNS:localhost,IP:127.0.0.1' 'extendedKeyUsage=serverAuth' >"$tls_dir/server.ext"
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial \
  -days 1 -extfile "$tls_dir/server.ext" -out "$tls_dir/server.crt" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=V9 wrong test CA' \
  -keyout "$tls_dir/wrong.key" -out "$tls_dir/wrong.crt" >/dev/null 2>&1
for name in ca.crt server.crt server.key wrong.crt; do docker cp "$tls_dir/$name" "$container:/tmp/v9-$name"; done
docker exec -u 0 "$container" bash -ceu 'chown postgres:postgres /tmp/v9-server.key; chmod 600 /tmp/v9-server.key'
psql_local -c "alter system set ssl_cert_file='/tmp/v9-server.crt'" >/dev/null
psql_local -c "alter system set ssl_key_file='/tmp/v9-server.key'" >/dev/null
psql_local -c "alter system set ssl='on'" >/dev/null
docker exec "$container" bash -ceu 'conf="$(psql -X -At -U postgres -d orulo_v9_auth_test -c "show hba_file")"; sed -i "1i hostnossl all all 127.0.0.1/32 reject\nhostssl all all 127.0.0.1/32 scram-sha-256" "$conf"; psql -X -U postgres -d orulo_v9_auth_test -c "select pg_reload_conf()" >/dev/null'
for i in $(seq 1 20); do
  [[ "$(psql_local -At -c 'show ssl')" == 'on' ]] && break
  sleep 0.2
done
[[ "$(psql_local -At -c 'show ssl')" == 'on' ]] || { echo 'TLS_CONFIG_NOT_ACTIVE'; exit 1; }
tls_sql(){
  docker exec -i -e PGPASSWORD="$2" "$container" psql -X -v ON_ERROR_STOP=1 -At \
    "host=${5:-localhost} hostaddr=127.0.0.1 user=$1 dbname=orulo_v9_auth_test sslmode=${6:-verify-full} sslrootcert=${4:-/tmp/v9-ca.crt} connect_timeout=5" -c "$3"
}
expect_failure(){
  local label=$1 pattern=$2; shift 2
  if "$@" >"$tls_dir/rejection.log" 2>&1; then echo "${label}_UNEXPECTED_SUCCESS"; exit 1; fi
  grep -Eiq "$pattern" "$tls_dir/rejection.log" || { echo "${label}_UNEXPECTED_FAILURE_CAUSE"; exit 1; }
  echo "${label}_DENIED"
}
identity=$(tls_sql orulo_webhook_writer writer-only-ci-password "select session_user::text||':'||current_user::text||':'||(select ssl::text from pg_stat_ssl where pid=pg_backend_pid())")
[[ "$identity" == 'orulo_webhook_writer:orulo_webhook_writer:true' ]] || { echo 'TLS_WRITER_IDENTITY_OR_ENCRYPTION_FAILED'; exit 1; }
identity=$(tls_sql orulo_provenance_reader reader-only-ci-password "select session_user::text||':'||current_user::text||':'||(select ssl::text from pg_stat_ssl where pid=pg_backend_pid())")
[[ "$identity" == 'orulo_provenance_reader:orulo_provenance_reader:true' ]] || { echo 'TLS_READER_IDENTITY_OR_ENCRYPTION_FAILED'; exit 1; }
verifiers=$(psql_local -At -c "select count(*) from pg_authid where rolname in ('orulo_webhook_writer','orulo_provenance_reader') and starts_with(rolpassword,'SCRAM-SHA-256')")
[[ "$verifiers" == '2' ]] || { echo 'SCRAM_VERIFIER_REQUIRED'; exit 1; }
expect_failure SCRAM_BAD_PASSWORD 'password authentication failed' tls_sql orulo_webhook_writer wrong-test-password 'select 1'
expect_failure TLS_WRONG_CA 'certificate verify failed|certificate verification failed' tls_sql orulo_webhook_writer writer-only-ci-password 'select 1' /tmp/v9-wrong.crt
expect_failure TLS_WRONG_HOST 'does not match host name|does not match.*host' tls_sql orulo_webhook_writer writer-only-ci-password 'select 1' /tmp/v9-ca.crt wrong.invalid
expect_failure TLS_DISABLED 'pg_hba.conf rejects connection|no pg_hba.conf entry' tls_sql orulo_webhook_writer writer-only-ci-password 'select 1' /tmp/v9-ca.crt localhost disable
expect_failure TLS_CROSS_ROLE 'permission denied' tls_sql orulo_webhook_writer writer-only-ci-password 'set role orulo_provenance_reader'
# Reconnect is real; this is deliberately not called pool validation.
pid1=$(tls_sql orulo_webhook_writer writer-only-ci-password 'select pg_backend_pid()')
pid2=$(tls_sql orulo_webhook_writer writer-only-ci-password 'select pg_backend_pid()')
[[ "$pid1" != "$pid2" ]] || { echo 'RECONNECT_NOT_DISTINCT'; exit 1; }
tls_sql orulo_webhook_writer writer-only-ci-password "select set_config('orulo.synthetic_leak','previous_connection',false)" >/dev/null
leak=$(tls_sql orulo_webhook_writer writer-only-ci-password "select coalesce(current_setting('orulo.synthetic_leak',true),'clean')")
[[ "$leak" == 'clean' ]] || { echo 'RECONNECT_SESSION_STATE_LEAK'; exit 1; }
operation="select orulo_audit.apply_webhook('7000001','[{\"external_id\":\"orulo:7000001:1\",\"source\":\"novos\",\"active\":true,\"price\":1,\"raw_data\":{\"building_id\":\"7000001\"},\"updated_at\":\"2026-01-01T00:00:00Z\"}]',false,now())"
applied=$(tls_sql orulo_webhook_writer writer-only-ci-password "select ($operation)->>'status'")
[[ "$applied" == 'APPLIED' ]] || { echo 'TLS_APPLY_NOT_ACKNOWLEDGED'; exit 1; }
before=$(psql_local -At -c "select count(*) from orulo_audit.property_transitions where authenticated_webhook")
tls_sql orulo_webhook_writer writer-only-ci-password "$operation" >/dev/null
[[ "$(psql_local -At -c 'select count(*) from orulo_audit.property_transitions where authenticated_webhook')" == "$before" ]] || { echo 'DUPLICATE_EFFECT'; exit 1; }
rollback_op=${operation/\"price\":1/\"price\":2}
tls_sql orulo_webhook_writer writer-only-ci-password "begin; $rollback_op; rollback" >/dev/null
[[ "$(psql_local -At -c "select price from properties where external_id='orulo:7000001:1'")" == '1' ]] || { echo 'TLS_ROLLBACK_ROW_FAILED'; exit 1; }
[[ "$(psql_local -At -c 'select count(*) from orulo_audit.property_transitions where authenticated_webhook')" == "$before" ]] || { echo 'TLS_ROLLBACK_RECEIPT_FAILED'; exit 1; }
# COMMIT then lose the connection: read back evidence, never repeat the write.
expect_failure COMMIT_RESPONSE_LOSS 'terminating connection|server closed|connection has been closed|connection to server was lost' \
  tls_sql orulo_webhook_writer writer-only-ci-password "begin; $rollback_op; commit; select pg_terminate_backend(pg_backend_pid())"
[[ "$(psql_local -At -c "select price from properties where external_id='orulo:7000001:1'")" == '2' ]] || { echo 'COMMIT_READBACK_FAILED'; exit 1; }
[[ "$(psql_local -At -c 'select count(*) from orulo_audit.property_transitions where authenticated_webhook')" == "$((before+1))" ]] || { echo 'COMMIT_RECEIPT_COUNT_FAILED'; exit 1; }
echo 'V9_DISPOSABLE_CI_AUTH_PASS scram=yes tls_verify_full=yes bad_password_denied=yes wrong_ca_denied=yes wrong_host_denied=yes plaintext_denied=yes reconnect=yes STAGING_VALIDATED=no'
