import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pg_preflight', Path(__file__).with_name('orulo-national-v2-pg-preflight.py'))
pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg)


class WorkflowDependencies(unittest.TestCase):
    def env(self, root, extra='', host=None, user='readonly_fixture'):
        return {'RUNNER_TEMP': str(root), 'PGSERVICEFILE': str(root/'pg/service.conf'),
                'PGPASSFILE': str(root/'pg/pass'), 'PGCONNECT_TIMEOUT': '15',
                'ORULO_V2_PG_SERVICE_CONF': '[orulo_v2_readonly]\nhost='+str(host or 'db.'+pg.PROJECT+'.supabase.co')+
                '\nuser='+user+'\ndbname=postgres\nsslmode=require\n'+extra,
                'ORULO_V2_PGPASS': 'synthetic-secret-not-for-printing'}

    def runner(self, changes=None, fail=False, inventory_changes=None):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            self.assertIn('service=orulo_v2_readonly', args)
            self.assertIn('-X', args)
            self.assertIn('-w', args)
            self.assertTrue(kwargs['input'].startswith('BEGIN READ ONLY;'))
            self.assertNotIn('orulo_audit', kwargs['input'])
            self.assertIn('PGSERVICEFILE', kwargs['env'])
            if kwargs['input']==pg.INVENTORY_SQL:
                data = dict(transactionReadOnly=True,properties=17922,
                            inventory_sha256='ae6084ff766fb45b8cbd5e6c12d9225db37d3908a1cade8043d79b3341649c42')
                data.update(inventory_changes or {})
            else:
                data = dict(transactionReadOnly=True, propertiesSelect=True, requiredColumns=True,
                            rowSecurityActive=False,unrestrictedSelectPolicy=False)
                data.update({key:True for key in pg.PRIVILEGE_PROOFS})
                data.update(changes or {})
            return SimpleNamespace(returncode=1 if fail else 0, stdout=json.dumps(data), stderr='synthetic-secret-not-for-printing')
        return run, calls

    def test_valid_profile_runs_only_read_metadata_and_stores_no_credential_in_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run, calls = self.runner()
            result = pg.preflight(self.env(root), run)
            self.assertEqual(result['readOnlyConnectionPreflight'], 'PASS')
            self.assertFalse(result['nationalDryRunStarted'])
            self.assertEqual(len(calls), 2)
            self.assertEqual(stat.S_IMODE((root/'pg/pass').stat().st_mode), 0o600)
            self.assertNotIn('synthetic-secret', (root/'orulo-national-v2-dependency-status.json').read_text())

    def test_missing_profile_or_wrong_project_blocks_before_connection(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, calls = self.runner()
            env = self.env(Path(tmp), host='db.other-project.supabase.co')
            with self.assertRaisesRegex(ValueError, 'PROJECT_IDENTITY'):
                pg.preflight(env, run)
            env['ORULO_V2_PG_SERVICE_CONF'] = ''
            with self.assertRaisesRegex(ValueError, 'PG_PROFILE'):
                pg.preflight(env, run)
            self.assertEqual(calls, [])

    def test_http_key_is_not_an_equivalent_libpq_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = self.env(Path(tmp))
            del env['ORULO_V2_PG_SERVICE_CONF']
            env['SUPABASE_SECRET_KEY'] = 'synthetic-http-key'
            run, calls = self.runner()
            with self.assertRaisesRegex(ValueError, 'PG_PROFILE'):
                pg.preflight(env, run)
            self.assertEqual(calls, [])

    def test_wrong_pooler_project_and_connection_alias_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, calls = self.runner()
            with self.assertRaisesRegex(ValueError, 'PROJECT_IDENTITY'):
                pg.preflight(self.env(Path(tmp), host='aws-0-test.pooler.supabase.com', user='readonly_fixture.other'), run)
            with self.assertRaisesRegex(ValueError, 'ALIAS_UNVERIFIED'):
                pg.preflight(self.env(Path(tmp), extra='hostaddr=127.0.0.1\n'), run)
            self.assertEqual(calls, [])

    def test_pooler_with_project_identity_is_supported_without_http_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, _ = self.runner()
            result = pg.preflight(self.env(Path(tmp), host='aws-0-test.pooler.supabase.com', user='readonly_fixture.'+pg.PROJECT), run)
            self.assertEqual(result['projectProfileIdentity'], 'MATCH')

    def test_insecure_tls_is_not_silently_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = self.env(Path(tmp))
            env['ORULO_V2_PG_SERVICE_CONF'] = env['ORULO_V2_PG_SERVICE_CONF'].replace('sslmode=require', 'sslmode=disable')
            run, calls = self.runner()
            with self.assertRaisesRegex(ValueError, 'PG_TLS'):
                pg.preflight(env, run)
            self.assertEqual(calls, [])

    def test_connection_error_does_not_expose_stderr_or_create_success_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run, _ = self.runner(fail=True)
            with self.assertRaisesRegex(ValueError, '^BLOCKER_READONLY_PG_CONNECTION$'):
                pg.preflight(self.env(root), run)
            self.assertFalse((root/'orulo-national-v2-dependency-status.json').exists())

    def test_non_readonly_or_missing_select_is_a_blocker(self):
        for change in [dict(transactionReadOnly=False), dict(propertiesSelect=False), dict(requiredColumns=False)]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                run, _ = self.runner(change)
                with self.assertRaisesRegex(ValueError, 'PG_CONTRACT'):
                    pg.preflight(self.env(Path(tmp)), run)

    def test_rls_limited_visibility_needs_scope_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, _ = self.runner(dict(rowSecurityActive=True))
            with self.assertRaisesRegex(ValueError, 'FULL_SCOPE_UNPROVEN'):
                pg.preflight(self.env(Path(tmp)), run)

    def test_postgres_identity_is_refused_before_any_connection(self):
        for host,user in [(None,'postgres'),('aws-0-test.pooler.supabase.com','postgres.'+pg.PROJECT)]:
            with self.subTest(user=user), tempfile.TemporaryDirectory() as tmp:
                run,calls=self.runner()
                with self.assertRaisesRegex(ValueError,'PRIVILEGED_IDENTITY'):
                    pg.preflight(self.env(Path(tmp),host=host,user=user),run)
                self.assertEqual(calls,[])

    def test_write_admin_ownership_and_definer_privileges_block_before_inventory(self):
        for key in pg.PRIVILEGE_PROOFS:
            with self.subTest(proof=key), tempfile.TemporaryDirectory() as tmp:
                run,calls=self.runner({key:False})
                with self.assertRaisesRegex(ValueError,'EXCESSIVE_OR_UNPROVEN_PRIVILEGES'):
                    pg.preflight(self.env(Path(tmp)),run)
                self.assertEqual(len(calls),1)

    def test_unknown_privilege_proof_is_not_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            run,_=self.runner({'noDelete':None})
            with self.assertRaisesRegex(ValueError,'EXCESSIVE_OR_UNPROVEN_PRIVILEGES'):
                pg.preflight(self.env(Path(tmp)),run)

    def test_failure_artifact_and_console_never_echo_unexpected_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            error=ValueError('BLOCKER_READONLY_PG_EXCESSIVE_OR_UNPROVEN_PRIVILEGES')
            error.safe_checks={'noUpdate':False,'noSuperuser':'synthetic-secret-not-for-printing',
                               'unexpected':'synthetic-secret-not-for-printing'}
            console=io.StringIO()
            with patch.dict(os.environ,{'RUNNER_TEMP':tmp},clear=True),patch.object(pg,'preflight',side_effect=error),contextlib.redirect_stdout(console):
                self.assertEqual(pg.main(),1)
            raw=(Path(tmp)/'orulo-national-v2-dependency-status.json').read_text()
            report=json.loads(raw)
            self.assertFalse(report['checks']['noUpdate'])
            self.assertEqual(report['checks']['noSuperuser'],'UNKNOWN')
            self.assertNotIn('unexpected',report['checks'])
            self.assertNotIn('synthetic-secret',raw+console.getvalue())

    def test_production_queries_do_not_contain_mutating_statements(self):
        forbidden=r'(?im)^\s*(CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b'
        self.assertIsNone(re.search(forbidden,pg.SQL))
        self.assertIsNone(re.search(forbidden,pg.INVENTORY_SQL))
        self.assertTrue(pg.SQL.startswith('BEGIN READ ONLY;'))
        self.assertTrue(pg.INVENTORY_SQL.startswith('BEGIN READ ONLY;'))

    def test_inventory_drift_or_incomplete_coverage_cannot_start_national_read(self):
        for change in [dict(properties=17921),dict(inventory_sha256='0'*64),dict(transactionReadOnly=False)]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                run,calls=self.runner(inventory_changes=change)
                with self.assertRaisesRegex(ValueError,'INVENTORY_DRIFT_OR_INCOMPLETE'):
                    pg.preflight(self.env(Path(tmp)),run)
                self.assertEqual(len(calls),2)
                self.assertFalse((Path(tmp)/'orulo-national-v2-dependency-status.json').exists())

    def test_rls_full_select_policy_is_evidence_instead_of_a_bypass_role(self):
        with tempfile.TemporaryDirectory() as tmp:
            run,_=self.runner(dict(rowSecurityActive=True,unrestrictedSelectPolicy=True))
            result=pg.preflight(self.env(Path(tmp)),run)
            self.assertEqual(result['dedicatedRolePrivileges'],'PASS')
            self.assertEqual(result['inventoryProperties'],17922)

    def test_dependency_sql_executes_in_local_postgres_without_production_access(self):
        script = """
        import {createRequire} from 'node:module';
        import {readFileSync} from 'node:fs';
        import {createHash} from 'node:crypto';
        const {PGlite}=createRequire(process.cwd()+'/test-support/orulo-cas/package.json')('@electric-sql/pglite');
        const db=new PGlite();
        await db.exec('create table public.properties(id uuid,source text,external_id text,raw_data jsonb)');
        await db.exec(`insert into public.properties values
          ('11111111-1111-1111-1111-111111111111','novos','orulo:1:1','{}'),
          ('22222222-2222-2222-2222-222222222222','novos','orulo:1:2','{}')`);
        const input=JSON.parse(readFileSync(0,'utf8'));
        const result=await db.exec(input.metadata),inventoryResult=await db.exec(input.inventory);
        const rows=(await db.query("select id,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') h from public.properties p order by id")).rows;
        const expected=createHash('sha256').update(rows.map(r=>r.id+':'+r.h).join('\\n')).digest('hex');
        console.log(JSON.stringify({metadata:result.find(r=>r.rows[0]?.json_build_object).rows[0].json_build_object,
          inventory:inventoryResult.find(r=>r.rows[0]?.json_build_object).rows[0].json_build_object,expected}));
        await db.close();
        """
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                input=json.dumps({'metadata':pg.SQL,'inventory':pg.INVENTORY_SQL}), text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        data=json.loads(result.stdout)
        self.assertEqual(data['inventory']['properties'],2)
        self.assertTrue(data['inventory']['transactionReadOnly'])
        self.assertEqual(data['inventory']['inventory_sha256'],data['expected'])
        proof = data['metadata']
        self.assertTrue(proof['transactionReadOnly'])
        self.assertTrue(proof['propertiesSelect'])
        self.assertTrue(proof['requiredColumns'])
        self.assertFalse(proof['rowSecurityActive'])
        self.assertFalse(proof['dedicatedIdentity'])
        self.assertFalse(proof['noAdministrativeRoles'])
        self.assertFalse(proof['noUpdate'])

    def test_real_local_role_membership_column_grants_and_rls_policies(self):
        script = """
        import {createRequire} from 'node:module';
        import {readFileSync} from 'node:fs';
        const {PGlite}=createRequire(process.cwd()+'/test-support/orulo-cas/package.json')('@electric-sql/pglite');
        const sql=readFileSync(0,'utf8'),out={};
        // Every case owns a fresh in-memory database; no libpq or remote endpoint.
        for(const scenario of ['safe','limited','membership','bypass','superuser','inherited_bypass','sequence','parameter','catalog_write','pgprefix_schema']){
          const db=new PGlite();
          await db.exec(`create table public.properties(id uuid,source text,external_id text,raw_data jsonb);
            create role readonly_fixture login;
            revoke create on schema public from public;
            grant usage on schema public to readonly_fixture;
            grant select on public.properties to readonly_fixture;
            alter table public.properties enable row level security;
            create policy full_read on public.properties for select to readonly_fixture using(true);`);
          if(scenario==='limited')await db.exec(`create policy restricted_read on public.properties as restrictive for select to readonly_fixture using(source='novos');`);
          if(scenario==='membership')await db.exec(`create role writer_fixture;
            grant update(raw_data) on public.properties to writer_fixture;
            grant writer_fixture to readonly_fixture;
            alter role readonly_fixture noinherit;`);
          if(scenario==='bypass')await db.exec('alter role readonly_fixture bypassrls');
          if(scenario==='superuser')await db.exec('alter role readonly_fixture superuser');
          if(scenario==='inherited_bypass')await db.exec(`create role bypass_fixture bypassrls;
            grant bypass_fixture to readonly_fixture; alter role readonly_fixture noinherit;`);
          if(scenario==='sequence')await db.exec('create sequence public.fixture_counter; grant usage on sequence public.fixture_counter to readonly_fixture');
          if(scenario==='parameter')await db.exec('grant set on parameter session_replication_role to readonly_fixture');
          if(scenario==='catalog_write')await db.exec('grant update on pg_catalog.pg_description to readonly_fixture');
          if(scenario==='pgprefix_schema')await db.exec(`create schema pgsafe;create table pgsafe.other_data(id int);
            grant usage on schema pgsafe to readonly_fixture;grant update(id) on pgsafe.other_data to readonly_fixture;`);
          await db.exec('set session authorization readonly_fixture');
          const result=await db.exec(sql);out[scenario]=result.find(r=>r.rows[0]?.json_build_object).rows[0].json_build_object;
          await db.close();
        }
        console.log(JSON.stringify(out));
        """
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,input=pg.SQL,text=True,capture_output=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)
        proof=json.loads(result.stdout)
        for key in pg.PRIVILEGE_PROOFS:
            self.assertTrue(proof['safe'][key],key)
        self.assertTrue(proof['safe']['rowSecurityActive'])
        self.assertTrue(proof['safe']['unrestrictedSelectPolicy'])
        self.assertFalse(proof['limited']['unrestrictedSelectPolicy'])
        self.assertFalse(proof['membership']['noUpdate'])
        self.assertFalse(proof['bypass']['noAdministrativeRoles'])
        self.assertFalse(proof['bypass']['noBypassRls'])
        self.assertFalse(proof['superuser']['noAdministrativeRoles'])
        self.assertFalse(proof['superuser']['noSuperuser'])
        self.assertFalse(proof['inherited_bypass']['noAdministrativeRoles'])
        self.assertFalse(proof['sequence']['noSequenceMutation'])
        self.assertFalse(proof['parameter']['noAdministrativeParameters'])
        # PostgreSQL masks direct catalog-write ACLs without administrative
        # capability; a GRANT entry alone is not proof of effective access.
        self.assertTrue(proof['catalog_write']['noUpdate'])
        self.assertTrue(proof['catalog_write']['noAdministrativeParameters'])
        self.assertFalse(proof['pgprefix_schema']['noUpdate'])

    def test_workflow_preserves_owner_main_environment_and_exact_original_runner(self):
        content = (ROOT/'.github/workflows/orulo-national-v2-readonly.yml').read_text()
        operational = content.split('  national-readonly:', 1)[1]
        for required in ["github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", "github.actor == 'mudeisp'",
                         "github.actor_id == '323805541'", "github.triggering_actor == 'mudeisp'", "github.run_attempt == '1'",
                         'github.sha == github.workflow_sha', 'needs: verify-package', 'environment: orulo-lote1']:
            self.assertIn(required, operational)
        self.assertNotIn('SUPABASE_SECRET_KEY', content)
        self.assertIn('ORULO_CLIENT_ID: ${{ secrets.ORULO_CLIENT_ID }}', operational)
        self.assertIn('ORULO_CLIENT_SECRET: ${{ secrets.ORULO_CLIENT_SECRET }}', operational)
        self.assertLess(operational.index('python3 scripts/orulo-national-v2-pg-preflight.py'),
                        operational.index('bash scripts/orulo-national-operational-readonly.sh'))
        self.assertIn('bash scripts/orulo-national-operational-readonly.sh --service orulo_v2_readonly --output-dir "$RUNNER_TEMP/orulo-national-v2-output"', operational)
        self.assertNotIn('pull_request_target:', content)
        self.assertNotIn('workflow_run:', content)
        self.assertNotIn('${{ runner.temp }}/orulo-national-v2-output/\n', content)
        self.assertNotIn('actions/checkout@v4', content)
        for block in re.finditer(r'(?m)^        run: \|\n((?:(?:          .*|)\n)+)', content):
            script = '\n'.join(line[10:] if line.startswith('          ') else '' for line in block.group(1).splitlines())
            result = subprocess.run(['bash', '-n'], input=script, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
