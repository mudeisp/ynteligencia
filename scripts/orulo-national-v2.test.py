import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('national', Path(__file__).with_name('orulo-national-v2.py'))
national = importlib.util.module_from_spec(spec)
spec.loader.exec_module(national)


class InventorySafety(unittest.TestCase):
    def setUp(self):
        self.rows = [{'id': 'a', 'recordSha256': '0' * 64, 'plans': [['p', False]]}]
        self.recheck = {'properties': 1, 'inventory_sha256': national.fingerprint(self.rows)}

    def test_change_without_timestamp_still_blocks(self):
        self.rows[0]['recordSha256'] = '1' * 64
        with self.assertRaisesRegex(ValueError, 'INVENTORY_DRIFT'):
            national.validate_inventory(self.rows, self.recheck)

    def test_duplicate_or_missing_membership_blocks(self):
        with self.assertRaisesRegex(ValueError, 'MEMBERSHIP'):
            national.validate_inventory(self.rows * 2, self.recheck)
        with self.assertRaisesRegex(ValueError, 'MEMBERSHIP'):
            national.validate_inventory([], self.recheck)

    def test_non_boolean_plan_presence_blocks(self):
        self.rows[0]['plans'][0][1] = 'false'
        with self.assertRaisesRegex(ValueError, 'PROJECTION'):
            national.validate_inventory(self.rows, self.recheck)

    def make_pack(self, root, candidate=None):
        files = {
            'audit/inputs/inventory.json': self.rows,
            'audit/inputs/recheck.json': [self.recheck],
            'manifest/national-v2.json': {'writeAuthorized': False, 'operations': [],
                'eligiblePropertyIds': [], 'candidates': [candidate] if candidate else []}}
        sums = []
        for name, data in files.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(national.encode(data))
            sums.append(national.sha(p.read_bytes()) + '  ' + name + '\n')
        (root / 'SHA256SUMS').write_text(''.join(sums))

    def test_tampering_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_pack(root)
            national.verify(root)
            (root / 'manifest/national-v2.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
                national.verify(root)

    def test_resealed_unverified_patch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_pack(root, {'eligibility': 'RECOVERABLE', 'proposedPatch': {'image_url': 'invented'}, 'candidateImage': 'invented'})
            with self.assertRaisesRegex(ValueError, 'UNVERIFIED_CANDIDATE_PROMOTION'):
                national.verify(root)

    def test_checksum_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'SHA256SUMS').write_text('0' * 64 + '  ../escape\n')
            with self.assertRaisesRegex(ValueError, 'PATH_ESCAPE'):
                national.verify(root)


if __name__ == '__main__':
    unittest.main()
