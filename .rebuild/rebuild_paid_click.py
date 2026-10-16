from pathlib import Path
import base64
import hashlib
import runpy
import zlib

chunks_dir = Path('.rebuild/chunks')
parts = sorted(chunks_dir.glob('*.txt'))
encoded = ''.join(part.read_text(encoding='utf-8').strip() for part in parts)

EXPECTED_ENCODED_LENGTH = 31840
EXPECTED_PAYLOAD_SHA256 = 'fa22df19b1c12f37f9aa458d54c53c5465627bc1d24e0066eb7a3895740ece8b'

if len(encoded) != EXPECTED_ENCODED_LENGTH:
    raise RuntimeError(f'payload length mismatch: {len(encoded)} != {EXPECTED_ENCODED_LENGTH}')

payload = zlib.decompress(base64.b64decode(encoded, validate=True))
actual_sha256 = hashlib.sha256(payload).hexdigest()
if actual_sha256 != EXPECTED_PAYLOAD_SHA256:
    raise RuntimeError(f'payload sha256 mismatch: {actual_sha256}')

payload_path = Path('.rebuild/_payload.py')
payload_path.write_bytes(payload)
runpy.run_path(str(payload_path), run_name='__main__')
