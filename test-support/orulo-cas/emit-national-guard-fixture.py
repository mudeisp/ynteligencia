from pathlib import Path
import re

migration = Path("supabase/migrations/20261111004340_orulo_national_v2_once.sql").read_text(encoding="utf-8")
names = ("national_control", "national_authorize", "national_cas", "national_replace", "national_merge", "national_policy")
print("CREATE TABLE public.properties(id uuid PRIMARY KEY, raw_data jsonb, source text, external_id text, created_at timestamptz, updated_at timestamptz, price numeric);")
print("SET check_function_bodies = false;")
for name in names:
    command = re.search(rf"create function orulo_audit\.{name}\(.*?\nend\$\$;", migration, re.DOTALL)
    if command is None:
        raise SystemExit(f"missing legacy function: {name}")
    print(command.group())
print(Path("test-support/orulo-cas/audited-cas-core-national.sql").read_text(encoding="utf-8-sig"))
for signature in (
    "national_control(text,uuid,bigint,text,jsonb)", "national_authorize(uuid,text,text,text,text)",
    "national_cas(uuid,uuid)", "national_replace(uuid,jsonb,jsonb)", "audited_cas_core(uuid,uuid)",
):
    print(f"ALTER FUNCTION orulo_audit.{signature} OWNER TO orulo_audit_owner;")
    print(f"REVOKE ALL ON FUNCTION orulo_audit.{signature} FROM PUBLIC;")
print(Path("test-support/orulo-cas/paged-snapshot-contract.sql").read_text(encoding="utf-8-sig"))
print("ALTER FUNCTION orulo_audit.control_paged(text,uuid,bigint,text,jsonb) OWNER TO orulo_audit_owner;")
print("REVOKE ALL ON FUNCTION orulo_audit.control_paged(text,uuid,bigint,text,jsonb) FROM PUBLIC;")
print("GRANT SELECT, UPDATE(raw_data) ON public.properties TO orulo_audit_owner;")
paged = Path("supabase/migrations/20261104102956_orulo_paged_snapshots.sql").read_text(encoding="utf-8")
start = paged.index("create table orulo_audit.snapshot_sets")
end = paged.index("create trigger immutable_rows", start)
print(paged[start:end])
print("SET check_function_bodies = true;")
