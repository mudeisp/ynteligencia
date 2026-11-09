import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).with_name('orulo-national-export-readonly.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportSafety(unittest.TestCase):
    def record(self):
        value = {'id': '11111111-1111-1111-1111-111111111111', 'source': 'novos', 'external_id': 'orulo:1:1'}
        canonical = json.dumps(value)
        return {'id': value['id'], 'recordCanonical': canonical, 'recordSha256': module.digest(canonical.encode())}

    def test_only_read_only_templates_and_verified_export(self):
        record = self.record()
        calls = []
        def runner(service, sql):
            calls.append(sql)
            self.assertEqual(service, 'fixture')
            self.assertIn('BEGIN READ ONLY;', sql)
            self.assertNotIn('__AFTER__', sql)
            if 'recordCanonical' in sql:
                return [record]
            return {'properties': 1, 'inventory_sha256': module.digest((record['id']+':'+record['recordSha256']).encode())}
        with tempfile.TemporaryDirectory() as temp:
            report = module.export('fixture', Path(temp)/'out', runner=runner)
            self.assertEqual(report['result'], 'PASS')
            self.assertEqual(report['productionWrites'], 0)
            self.assertEqual(len(calls), 2)

    def test_export_drift_preserves_files_and_blocks(self):
        record = self.record()
        def runner(service, sql):
            return [record] if 'recordCanonical' in sql else {'properties': 2, 'inventory_sha256': '0'*64}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/'out'
            report = module.export('fixture', output, runner=runner)
            self.assertEqual(report['classification'], 'BLOCKER')
            self.assertTrue((output/'page-000001.json').exists())

    def test_bad_page_hash_is_not_accepted(self):
        record = self.record()
        record['recordSha256'] = 'f'*64
        with tempfile.TemporaryDirectory() as temp:
            report = module.export('fixture', Path(temp)/'out', runner=lambda *_: [record])
            self.assertEqual(report['reason'], 'EXPORTED_RECORD_HASH_MISMATCH')

    def test_service_injection_and_existing_outputs_refused_before_query(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'SERVICE'):
                module.export('host=forbidden password=secret', Path(temp)/'out')
            with self.assertRaisesRegex(ValueError, 'OUTPUT'):
                module.export('fixture', Path(temp))


if __name__ == '__main__':
    unittest.main()
