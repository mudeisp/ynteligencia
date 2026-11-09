#!/usr/bin/env python3
"""Workflow dependency check only; never a replacement exporter or recovery flow.

Uses the existing libpq profile secret contract. No service-role HTTP key, OAuth
request, property mutation, migration, audit RPC or national scan is performed.
All errors have fixed codes: libpq stderr, profile and password are not printed.
"""
import configparser
import json
import os
from pathlib import Path
import subprocess

PROJECT = 'wzaegidwtdjuhqchpdpd'
SERVICE = 'orulo_v2_readonly'
SQL = """BEGIN READ ONLY;
SELECT json_build_object(
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'propertiesSelect',has_table_privilege(current_user,'public.properties','SELECT'),
 'rowSecurityActive',row_security_active('public.properties'::regclass),
 'requiredColumns',(SELECT count(*)=4 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='properties'
   AND column_name IN ('id','source','external_id','raw_data')));
COMMIT;"""


def blocked(code):
    raise ValueError(code)


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
    try:
        reply = runner(['psql', 'service='+SERVICE, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                       input=SQL, text=True, capture_output=True, timeout=45, check=False, env=dict(env))
        if reply.returncode:
            blocked('BLOCKER_READONLY_PG_CONNECTION')
        proof = json.loads(reply.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        blocked('BLOCKER_READONLY_PG_CONNECTION')
    if not isinstance(proof, dict) or not all(proof.get(k) is True for k in ('transactionReadOnly', 'propertiesSelect', 'requiredColumns')):
        blocked('BLOCKER_READONLY_PG_CONTRACT')
    if proof.get('rowSecurityActive') is not False:
        blocked('BLOCKER_READONLY_PG_FULL_SCOPE_UNPROVEN')
    report = {'readOnlyConnectionPreflight': 'PASS', 'projectProfileIdentity': 'MATCH',
              'nationalDryRunStarted': False, 'productionWrites': 0}
    (Path(env['RUNNER_TEMP'])/'orulo-national-v2-dependency-status.json').write_text(json.dumps(report)+'\n')
    return report


if __name__ == '__main__':
    try:
        preflight(os.environ)
    except (ValueError, KeyError, OSError) as error:
        code = str(error)
        if not code.startswith('BLOCKER_') or not all(c.isupper() or c=='_' for c in code):
            code = 'BLOCKER_READONLY_PG_LOCAL_CONFIGURATION'
        print('::error::'+code)
        raise SystemExit(1)
