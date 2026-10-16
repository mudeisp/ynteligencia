from pathlib import Path
import base64
import hashlib
import re
import runpy
import zlib

chunks_dir = Path('.rebuild/chunks')
parts = sorted(chunks_dir.glob('*.txt'))
encoded = ''.join(part.read_text(encoding='utf-8').strip() for part in parts)

EXPECTED_ENCODED_LENGTH = 31840
EXPECTED_ORIGINAL_SHA256 = 'fa22df19b1c12f37f9aa458d54c53c5465627bc1d24e0066eb7a3895740ece8b'
EXPECTED_FINAL_SHA256 = 'a0a2a860b93649307e130dc35ee581bb906d1c42cdbfcd33f0776101961b7061'

if len(encoded) != EXPECTED_ENCODED_LENGTH:
    raise RuntimeError(f'payload length mismatch: {len(encoded)} != {EXPECTED_ENCODED_LENGTH}')

payload = zlib.decompress(base64.b64decode(encoded, validate=True))
original_sha256 = hashlib.sha256(payload).hexdigest()
if original_sha256 != EXPECTED_ORIGINAL_SHA256:
    raise RuntimeError(f'original payload sha256 mismatch: {original_sha256}')

text = payload.decode('utf-8')
old = '''# Keep supported text intent on OneSignal tags as well.\ns=replace_once(s,\n\'\'\'    ynt_source:\\n      String(\\n        profile.source ||\\n        "todos"\\n      ) || "todos",\'\'\',\n\'\'\'    ynt_source:\\n      String(\\n        profile.source ||\\n        "todos"\\n      ) || "todos",\\n\\n    ynt_search:\\n      String(profile.search || ""),\\n\\n    ynt_development:\\n      String(profile.development || ""),\'\'\',\'extra push tags\')\n'''
new = '''# Keep supported text intent on OneSignal tags as well.\ns=replace_once(s,\n\'\'\'    ynt_source:\\n      String(\\n        profile.source ||\\n        "todos"\\n      ),\\n\\n    ynt_bedrooms:\'\'\',\n\'\'\'    ynt_source:\\n      String(\\n        profile.source ||\\n        "todos"\\n      ),\\n\\n    ynt_search:\\n      String(profile.search || ""),\\n\\n    ynt_development:\\n      String(profile.development || ""),\\n\\n    ynt_bedrooms:\'\'\',\'extra push tags\')\n'''
if text.count(old) != 1:
    raise RuntimeError(f'tag-shape patch occurrence mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

final_test_b64 = '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'
text, n = re.subn(r"FINAL_TEST_B64='[^']*'", "FINAL_TEST_B64='" + final_test_b64 + "'", text, count=1)
if n != 1:
    raise RuntimeError(f'final test payload replacement mismatch: {n}')

payload = text.encode('utf-8')
final_sha256 = hashlib.sha256(payload).hexdigest()
if final_sha256 != EXPECTED_FINAL_SHA256:
    raise RuntimeError(f'final payload sha256 mismatch: {final_sha256}')

payload_path = Path('.rebuild/_payload.py')
payload_path.write_bytes(payload)
runpy.run_path(str(payload_path), run_name='__main__')
