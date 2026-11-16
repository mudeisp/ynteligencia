from pathlib import Path
import re

migration = Path("supabase/migrations/20261111004340_orulo_national_v2_once.sql").read_text(encoding="utf-8")
names = ("national_control", "national_authorize", "national_cas", "national_replace")
print("CREATE TABLE public.properties(id uuid PRIMARY KEY, raw_data jsonb, source text, external_id text);")
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
print("SET check_function_bodies = true;")
