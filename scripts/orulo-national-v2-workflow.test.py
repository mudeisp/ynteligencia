import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

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

    def runner(self, changes=None, fail=False):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            self.assertIn('service=orulo_v2_readonly', args)
            self.assertIn('-X', args)
            self.assertIn('-w', args)
            self.assertTrue(kwargs['input'].startswith('BEGIN READ ONLY;'))
            self.assertNotIn('orulo_audit', kwargs['input'])
            self.assertIn('PGSERVICEFILE', kwargs['env'])
            data = dict(transactionReadOnly=True, propertiesSelect=True, requiredColumns=True, rowSecurityActive=False)
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
            self.assertEqual(len(calls), 1)
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

    def test_dependency_sql_executes_in_local_postgres_without_production_access(self):
        script = """
        import {createRequire} from 'node:module';
        import {readFileSync} from 'node:fs';
        const {PGlite}=createRequire(process.cwd()+'/test-support/orulo-cas/package.json')('@electric-sql/pglite');
        const db=new PGlite();
        await db.exec('create table public.properties(id uuid,source text,external_id text,raw_data jsonb)');
        const result=await db.exec(readFileSync(0,'utf8'));
        console.log(JSON.stringify(result.find(r=>r.rows[0]?.json_build_object).rows[0].json_build_object));
        await db.close();
        """
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                input=pg.SQL, text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        proof = json.loads(result.stdout)
        self.assertTrue(proof['transactionReadOnly'])
        self.assertTrue(proof['propertiesSelect'])
        self.assertTrue(proof['requiredColumns'])
        self.assertFalse(proof['rowSecurityActive'])

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
