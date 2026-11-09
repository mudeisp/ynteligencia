#!/usr/bin/env python3
"""Operational-only read export using an EXISTING secure libpq service profile.

No URL/password arguments, no schema changes, no CAS, no journal writes.
The Work environment must only test this script with synthetic runners.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ZERO = '00000000-0000-0000-0000-000000000000'
UUID = re.compile(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    raw = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)
    path.chmod(0o600)
    return digest(raw)


def query(service, sql):
    # No shell, credential values or user-supplied SQL. Errors are not echoed:
    # a libpq diagnostic can contain connection information.
    result = subprocess.run(
        ['psql', f'service={service}', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, timeout=180, check=False,
    )
    if result.returncode:
        raise ValueError('READ_ONLY_QUERY_FAILED_INSPECT_PRIVATELY')
    try:
        return json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError('READ_ONLY_QUERY_RESULT_INVALID') from error


def export(service, output, page_size=100, runner=query):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', service):
        raise ValueError('EXPLICIT_LIBPQ_SERVICE_REQUIRED')
    if not 1 <= page_size <= 500:
        raise ValueError('PAGE_SIZE_INVALID')
    if output.exists():
        raise ValueError('OUTPUT_MUST_NOT_EXIST')
    output.mkdir(parents=True, mode=0o700)
    sql_path = ROOT / 'orulo-national-v2/sql/operational-dry-run-rows.sql'
    recheck_path = ROOT / 'orulo-national-v2/sql/operational-recheck.sql'
    template = sql_path.read_text()
    index = {'version': 1, 'projectId': 'wzaegidwtdjuhqchpdpd',
             'connectionIdentity': 'CALLER_MUST_VERIFY_EXISTING_SERVICE_PROFILE',
             'productionWrites': 0, 'realCASCalls': 0,
             'exportSqlSha256': digest(sql_path.read_bytes()),
             'recheckSqlSha256': digest(recheck_path.read_bytes()), 'pages': []}
    cursor = ZERO
    records = []
    try:
        while True:
            sql = template.replace('__AFTER__', cursor).replace('__LIMIT__', str(page_size))
            page = runner(service, sql)
            if not isinstance(page, list) or len(page) > page_size:
                raise ValueError('PAGE_INVALID')
            previous = cursor
            for record in page:
                if not UUID.fullmatch(record['id']) or record['id'] <= previous:
                    raise ValueError('PAGE_ORDER_OR_MEMBERSHIP_INVALID')
                if digest(record['recordCanonical'].encode()) != record['recordSha256']:
                    raise ValueError('EXPORTED_RECORD_HASH_MISMATCH')
                if json.loads(record['recordCanonical'])['id'] != record['id']:
                    raise ValueError('EXPORTED_RECORD_ID_MISMATCH')
                previous = record['id']
            name = f'page-{len(index["pages"])+1:06d}.json'
            page_hash = save(output / name, page)
            index['pages'].append({'file': name, 'sha256': page_hash, 'records': len(page)})
            records.extend({'id': r['id'], 'recordSha256': r['recordSha256']} for r in page)
            if len(page) < page_size:
                break
            cursor = page[-1]['id']
        recheck = runner(service, recheck_path.read_text())
        save(output / 'recheck.json', recheck)
        fingerprint = digest('\n'.join(r['id']+':'+r['recordSha256'] for r in records).encode())
        stable = len(records) == recheck['properties'] and fingerprint == recheck['inventory_sha256']
        index.update(properties=len(records), inventoryFingerprint=fingerprint,
                     result='PASS' if stable else 'BLOCKED',
                     classification='NON_BLOCKER' if stable else 'BLOCKER',
                     reason='READ_EXPORT_VERIFIED' if stable else 'CONCURRENT_EXPORT_DRIFT')
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else 'LOCAL_EXPORT_FAILURE'
        # Only fixed local error codes reach the summary.
        if not re.fullmatch(r'[A-Z_]+', code):
            code = 'LOCAL_EXPORT_FAILURE'
        index.update(result='BLOCKED', classification='BLOCKER', reason=code)
    save(output / 'snapshot-index.json', index)
    save(output / 'snapshot-index-checksum.json', {'sha256': digest((output / 'snapshot-index.json').read_bytes())})
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--page-size', type=int, default=100)
    args = parser.parse_args()
    try:
        result = export(args.service, args.output_dir, args.page_size)
        print(json.dumps({k: result.get(k) for k in ['result', 'classification', 'reason', 'properties', 'productionWrites']}))
        raise SystemExit(0 if result['result'] == 'PASS' else 2)
    except ValueError:
        print('LOCAL_EXPORT_ARGUMENT_ERROR')
        raise SystemExit(1)
