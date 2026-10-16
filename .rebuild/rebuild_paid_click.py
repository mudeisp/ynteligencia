from pathlib import Path
import base64
import hashlib
import runpy
import zlib

chunks_dir = Path('.rebuild/chunks')
parts = sorted(chunks_dir.glob('*.txt'))
encoded = ''.join(part.read_text(encoding='utf-8').strip() for part in parts)

EXPECTED_ENCODED_LENGTH = 31840
EXPECTED_ORIGINAL_SHA256 = 'fa22df19b1c12f37f9aa458d54c53c5465627bc1d24e0066eb7a3895740ece8b'
EXPECTED_PATCHED_SHA256 = 'f9245f8ea2ed871aa1e55ff4dee6206f5fc92ff7978235c840ffeafae924b0f3'

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

payload = text.replace(old, new, 1).encode('utf-8')
patched_sha256 = hashlib.sha256(payload).hexdigest()
if patched_sha256 != EXPECTED_PATCHED_SHA256:
    raise RuntimeError(f'patched payload sha256 mismatch: {patched_sha256}')

payload_path = Path('.rebuild/_payload.py')
payload_path.write_bytes(payload)
runpy.run_path(str(payload_path), run_name='__main__')
