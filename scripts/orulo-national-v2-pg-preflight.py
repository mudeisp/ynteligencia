#!/usr/bin/env python3
"""Workflow dependency check only; never a replacement exporter or recovery flow.

Uses the existing libpq profile secret contract. No service-role HTTP key, OAuth
request, property mutation, migration, audit RPC or image recovery is performed.
Catalog privileges are checked before any read-only aggregate inventory query.
All errors have fixed codes: libpq stderr, profile and password are not printed.
"""
import configparser
import hashlib
import json
import os
from pathlib import Path
import subprocess

PROJECT = 'wzaegidwtdjuhqchpdpd'
SERVICE = 'orulo_v2_readonly'
MANIFEST = Path(__file__).resolve().parents[1]/'orulo-national-v2/manifest/national-v2.json'
MANIFEST_SHA256 = 'f94cf3139fa2516d55b98c0e242c64193107f0f65be924f36c936dc7952ab070'
SQL = """BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
WITH reachable_roles AS (
 SELECT r.oid,r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls
 FROM pg_roles r WHERE r.rolname IN (current_user,session_user)
 OR pg_has_role(session_user,r.oid,'MEMBER')
), user_relations AS (
 SELECT c.oid,c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_(toast_)?temp_'
 AND NOT (n.nspname='pg_catalog' AND c.relname='pg_settings')
), select_policies AS (
 SELECT p.polpermissive,coalesce(pg_get_expr(p.polqual,p.polrelid),'true') AS expression
 FROM pg_policy p WHERE p.polrelid='public.properties'::regclass AND p.polcmd IN ('r','*')
 AND (0=ANY(p.polroles) OR EXISTS(SELECT 1 FROM pg_roles r
 WHERE r.oid=ANY(p.polroles) AND pg_has_role(current_user,r.oid,'USAGE')))
)
SELECT json_build_object(
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'propertiesSelect',has_table_privilege(current_user,'public.properties','SELECT'),
 'rowSecurityActive',row_security_active('public.properties'::regclass),
 'unrestrictedSelectPolicy',
   EXISTS(SELECT 1 FROM select_policies WHERE polpermissive AND expression='true')
   AND NOT EXISTS(SELECT 1 FROM select_policies WHERE NOT polpermissive AND expression<>'true'),
 'dedicatedIdentity',current_user=session_user AND current_user NOT IN
   ('postgres','supabase_admin','service_role','authenticator','anon','authenticated','dashboard_user'),
 'noSuperuser',NOT EXISTS(SELECT 1 FROM reachable_roles WHERE rolsuper),
 'noBypassRls',NOT EXISTS(SELECT 1 FROM reachable_roles WHERE rolbypassrls),
 'noAdministrativeRoles',NOT EXISTS(SELECT 1 FROM reachable_roles WHERE
   rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
   OR rolname IN ('pg_database_owner','pg_read_all_data','pg_write_all_data','pg_monitor',
   'pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables','pg_read_server_files',
   'pg_write_server_files','pg_execute_server_program','pg_signal_backend','pg_checkpoint',
   'pg_maintain','pg_create_subscription','pg_use_reserved_connections')),
 'noInsert',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN user_relations t
   WHERE has_table_privilege(r.oid,t.oid,'INSERT') OR has_any_column_privilege(r.oid,t.oid,'INSERT')),
 'noUpdate',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN user_relations t
   WHERE has_table_privilege(r.oid,t.oid,'UPDATE') OR has_any_column_privilege(r.oid,t.oid,'UPDATE')),
 'noDelete',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN user_relations t
   WHERE has_table_privilege(r.oid,t.oid,'DELETE')),
 'noTruncate',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN user_relations t
   WHERE has_table_privilege(r.oid,t.oid,'TRUNCATE')),
 'noSequenceMutation',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN pg_class s
   JOIN pg_namespace n ON n.oid=s.relnamespace WHERE s.relkind='S'
   AND n.nspname !~ '^pg_(toast_)?temp_' AND has_sequence_privilege(r.oid,s.oid,'USAGE,UPDATE')),
 'noAdministrativeParameters',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN
   (SELECT name,context FROM pg_settings UNION SELECT parname,NULL::text FROM pg_parameter_acl) p
   WHERE has_parameter_privilege(r.oid,p.name,'ALTER SYSTEM')
   OR (p.context IN ('superuser','superuser-backend') AND has_parameter_privilege(r.oid,p.name,'SET'))),
 'noOwnershipOrCreate',NOT EXISTS(SELECT 1 FROM reachable_roles r WHERE
   EXISTS(SELECT 1 FROM user_relations t WHERE t.relowner=r.oid)
   OR has_database_privilege(r.oid,current_database(),'CREATE')
   OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_(toast_)?temp_'
     AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE')))),
 'noUnreviewedDefinerExecution',NOT EXISTS(SELECT 1 FROM reachable_roles r CROSS JOIN pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef
   AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
   AND has_function_privilege(r.oid,p.oid,'EXECUTE')),
 'requiredColumns',(SELECT count(*)=4 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='properties'
   AND column_name IN ('id','source','external_id','raw_data')));
COMMIT;"""
INVENTORY_SQL = """BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL TIME ZONE 'UTC';
SELECT json_build_object('transactionReadOnly',current_setting('transaction_read_only')='on',
 'properties',count(*),'inventory_sha256',
 encode(sha256(convert_to(string_agg(id::text||':'||encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),
 E'\\n' ORDER BY id),'UTF8')),'hex'))
 FROM public.properties p WHERE source='novos' AND external_id LIKE 'orulo:%';
COMMIT;"""
PRIVILEGE_PROOFS = ('dedicatedIdentity','noSuperuser','noBypassRls','noAdministrativeRoles','noInsert','noUpdate',
                    'noDelete','noTruncate','noSequenceMutation','noAdministrativeParameters',
                    'noOwnershipOrCreate','noUnreviewedDefinerExecution')
SAFE_CHECKS = PRIVILEGE_PROOFS + ('transactionReadOnly','propertiesSelect','requiredColumns',
                                'rowSecurityActive','unrestrictedSelectPolicy',
                                'inventoryCountMatch','inventoryFingerprintMatch')
BLOCKER_CODES = {
    'BLOCKER_READONLY_PG_PROFILE','BLOCKER_READONLY_PG_PROJECT_IDENTITY',
    'BLOCKER_READONLY_PG_PRIVILEGED_IDENTITY','BLOCKER_READONLY_PG_ALIAS_UNVERIFIED',
    'BLOCKER_READONLY_PG_TLS','BLOCKER_READONLY_PG_PROFILE_FORMAT','BLOCKER_READONLY_PG_CONNECTION',
    'BLOCKER_READONLY_PG_CONTRACT','BLOCKER_READONLY_PG_EXCESSIVE_OR_UNPROVEN_PRIVILEGES',
    'BLOCKER_READONLY_PG_FULL_SCOPE_UNPROVEN','BLOCKER_PRELIMINARY_MANIFEST_HASH',
    'BLOCKER_READONLY_PG_INVENTORY_DRIFT_OR_INCOMPLETE',
}


def sanitize_checks(checks):
    return {k:(v if type(v) is bool else 'UNKNOWN') for k,v in checks.items() if k in SAFE_CHECKS}


def query(env, sql, runner):
    try:
        reply = runner(['psql', 'service='+SERVICE, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, timeout=45, check=False, env=dict(env))
        if reply.returncode:
            blocked('BLOCKER_READONLY_PG_CONNECTION')
        proof = json.loads(reply.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        blocked('BLOCKER_READONLY_PG_CONNECTION')
    if not isinstance(proof, dict):
        blocked('BLOCKER_READONLY_PG_CONTRACT')
    return proof


def blocked(code, checks=None):
    error = ValueError(code)
    error.safe_checks = sanitize_checks(checks or {})
    raise error


def preflight(env, runner=subprocess.run):
    if not env.get('ORULO_V2_PG_SERVICE_CONF') or not env.get('ORULO_V2_PGPASS'):
        blocked('BLOCKER_READONLY_PG_PROFILE')
    config = configparser.ConfigParser(interpolation=None)
    try:
        config.read_string(env['ORULO_V2_PG_SERVICE_CONF'])
        profile = config[SERVICE]
        host = profile.get('host', '').strip().lower()
        user = profile.get('user', '').strip()
        direct = host == 'db.' + PROJECT + '.supabase.co'
        pooler = host.endswith('.pooler.supabase.com') and user.endswith('.' + PROJECT)
        if not (direct or pooler) or not user or not profile.get('dbname'):
            blocked('BLOCKER_READONLY_PG_PROJECT_IDENTITY')
        logical_user = user.removesuffix('.'+PROJECT) if pooler else user
        if logical_user.lower() in ('postgres','supabase_admin','service_role','authenticator','anon','authenticated','dashboard_user'):
            blocked('BLOCKER_READONLY_PG_PRIVILEGED_IDENTITY')
        if profile.get('hostaddr') or profile.get('service'):
            blocked('BLOCKER_READONLY_PG_ALIAS_UNVERIFIED')
        if profile.get('sslmode', '').lower() not in ('require', 'verify-ca', 'verify-full'):
            blocked('BLOCKER_READONLY_PG_TLS')
    except (configparser.Error, KeyError):
        blocked('BLOCKER_READONLY_PG_PROFILE_FORMAT')
    for key, secret in [('PGSERVICEFILE', 'ORULO_V2_PG_SERVICE_CONF'), ('PGPASSFILE', 'ORULO_V2_PGPASS')]:
        path = Path(env[key])
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as target:
            target.write(env[secret])
    proof = query(env, SQL, runner)
    if not all(proof.get(k) is True for k in ('transactionReadOnly', 'propertiesSelect', 'requiredColumns')):
        blocked('BLOCKER_READONLY_PG_CONTRACT',proof)
    if not all(proof.get(k) is True for k in PRIVILEGE_PROOFS):
        blocked('BLOCKER_READONLY_PG_EXCESSIVE_OR_UNPROVEN_PRIVILEGES',proof)
    if proof.get('rowSecurityActive') is not False and proof.get('unrestrictedSelectPolicy') is not True:
        blocked('BLOCKER_READONLY_PG_FULL_SCOPE_UNPROVEN',proof)
    manifest_bytes = MANIFEST.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest()!=MANIFEST_SHA256:
        blocked('BLOCKER_PRELIMINARY_MANIFEST_HASH')
    manifest = json.loads(manifest_bytes)
    inventory = query(env, INVENTORY_SQL, runner)
    if inventory.get('transactionReadOnly') is not True or inventory.get('properties')!=len(manifest['properties']) or inventory.get('inventory_sha256')!=manifest['inventoryFingerprint']:
        blocked('BLOCKER_READONLY_PG_INVENTORY_DRIFT_OR_INCOMPLETE',{
            'transactionReadOnly':inventory.get('transactionReadOnly'),
            'inventoryCountMatch':inventory.get('properties')==len(manifest['properties']),
            'inventoryFingerprintMatch':inventory.get('inventory_sha256')==manifest['inventoryFingerprint']})
    report = {'readOnlyConnectionPreflight': 'PASS', 'projectProfileIdentity': 'MATCH',
              'dedicatedRolePrivileges': 'PASS', 'manifestSha256':MANIFEST_SHA256,
              'rolePrivilegeChecks':sanitize_checks(proof),
              'inventoryProperties':inventory['properties'],'inventoryFingerprint':inventory['inventory_sha256'],
              'nationalDryRunStarted': False, 'productionWrites': 0}
    (Path(env['RUNNER_TEMP'])/'orulo-national-v2-dependency-status.json').write_text(json.dumps(report)+'\n')
    return report


def main():
    try:
        preflight(os.environ)
    except (ValueError, KeyError, OSError) as error:
        code = str(error)
        if code not in BLOCKER_CODES:
            code = 'BLOCKER_READONLY_PG_LOCAL_CONFIGURATION'
        if os.environ.get('RUNNER_TEMP'):
            report = {'status':'BLOCKED','reason':code,
                      'checks':sanitize_checks(getattr(error,'safe_checks',{})),
                      'nationalDryRunStarted':False,'productionWrites':0}
            try:
                path=Path(os.environ['RUNNER_TEMP'])/'orulo-national-v2-dependency-status.json'
                descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                with os.fdopen(descriptor,'w') as target:
                    target.write(json.dumps(report)+'\n')
            except OSError:
                pass  # Never echo a credential-bearing path/error as a fallback.
        print('::error::'+code)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
