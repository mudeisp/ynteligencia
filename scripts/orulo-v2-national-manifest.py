#!/usr/bin/env python3
"""Freeze the original reconciled universe. Read-only DB; never authorize writes."""
import importlib.util
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
from orulo_v2_image_validation import sha, url_status, validate_plan, VALID

spec = importlib.util.spec_from_file_location('national', Path(__file__).with_name('orulo-v2-national-dry-run.py'))
national = importlib.util.module_from_spec(spec)
spec.loader.exec_module(national)


def require(condition, code):
    if not condition:
        raise ValueError(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def build(source_path, report_path, directory):
    source = national.verified_json(source_path, national.SOURCE_HASH)
    report = national.verified_json(report_path, national.REPORT_HASH)
    require(source['writesAuthorized'] is False and report['casWritesAuthorized'] is False
            and report['databaseWrites'] == 0 and report['sourceManifestSha256'] == national.SOURCE_HASH,
            'INPUT_METADATA_MISMATCH')
    builder_spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('orulo-v2-build-recovery-manifest.py'))
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    rebuilt = builder.build([directory / str(n) / 'source.tgz' for n in range(6)])
    require(sha(builder.canonical(rebuilt)) == national.SOURCE_HASH, 'CHECKPOINT_MANIFEST_MISMATCH')
    indexed = {(p['buildingId'], p['planId']): p for p in source['plans']}
    require(len(indexed) == len(source['plans']), 'DUPLICATE_SOURCE_PLAN')
    candidates = [((g['buildingId'], g['planId']), t) for g in report['matchedTargets'] for t in g['targets']
                  if t['status'] == 'RECONCILED_PENDING_IMAGE_VALIDATION']
    evidence = national.load_evidence(directory, indexed, list(dict.fromkeys(k for k, _ in candidates)))
    proven = {}
    for key in dict.fromkeys(k for k, _ in candidates):
        plan = indexed[key]
        normalized = plan.get('normalizedPlan') or {}
        require(plan['status'] == 'RECOVERABLE' and str(normalized.get('id')) == key[1], 'SOURCE_IDENTITY_INVALID')
        urls = normalized.get('images', [])
        require(isinstance(urls, list), 'SOURCE_IMAGES_INVALID')
        urls = list(dict.fromkeys([*urls, *(normalized[f] for f in
                     ('image_url', 'url', '2280x1800', '1024x1024', '520x280') if normalized.get(f) not in (None, ''))]))
        require(bool(urls), 'SOURCE_URLS_MISSING')
        checks = []
        for url in urls:
            require(url_status(url) is None, 'SOURCE_URL_INVALID')
            matches = [c for c in plan['imageChecks'] if c['url'] == url]
            require(len(matches) == 1, 'SOURCE_CHECK_DUPLICATE')
            check = matches[0]
            raw = evidence[plan['sourceChunk']].get(check['evidence'])
            require(raw is not None and sha(raw) == check['sha256'], 'SOURCE_CHECK_HASH_MISMATCH')
            proof = json.loads(raw)
            require(proof.get('url') == url and proof.get('status') == 'VALIDATED_PREFIX'
                    and proof.get('format') in ('jpeg', 'png', 'webp')
                    and type(proof.get('prefixBytes')) is int and 1 <= proof['prefixBytes'] <= 4096
                    and len(proof.get('prefixSha256', '')) == 64, 'SOURCE_PREFIX_PROOF_INVALID')
            checks.append({'url': url, 'evidenceSha256': check['sha256'], 'evidence': {k: proof[k] for k in ('url', 'status', 'format', 'prefixBytes', 'prefixSha256')}})
        proven[key] = {'id': key[1], 'images': urls, 'checks': checks,
                       'sourceResultSha256': plan['sourceResultSha256'], 'sourceChunk': plan['sourceChunk']}
    # One server-side hash per property, not one full-row transfer per occurrence.
    rows = {}
    with psycopg.connect(os.environ['ORULO_V2_DB_URL'], connect_timeout=20,
                         options='-c default_transaction_read_only=on -c statement_timeout=1800000') as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        columns = conn.execute("SELECT orulo_audit.columns_v2()").fetchone()[0]
        with conn.cursor(name='national_v2_freeze') as cursor:
            cursor.execute("SELECT id::text,external_id,raw_data->>'building_id',raw_data#>>'{building,id}',"
                           "raw_data#>'{building,floor_plans}',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') "
                           "FROM public.properties p WHERE source='novos' AND external_id LIKE 'orulo:%' ORDER BY id")
            for pid, external, building, nested, plans, digest in cursor:
                rows[pid] = (external, building, nested, plans, digest)
    targets, blocked, seen = {}, Counter(), set()
    for (building, plan_id), previous in candidates:
        pid = previous['propertyId']
        require((pid, building, plan_id) not in seen, 'DUPLICATE_TARGET_OCCURRENCE')
        seen.add((pid, building, plan_id))
        row = rows.get(pid)
        if row is None or row[1] != building or row[2] not in (None, building) or not row[0].startswith('orulo:' + building + ':'):
            blocked['IDENTITY_CONFLICT'] += 1
            continue
        plans = row[3]
        if not isinstance(plans, list) or any(not isinstance(p, dict) or p.get('id') is None for p in plans) or len({str(p['id']) for p in plans}) != len(plans):
            blocked['PLAN_ID_CONFLICT'] += 1
            continue
        state = national.occurrence_status(({'raw_data': {'building': {'floor_plans': plans}}}, row[4]), plan_id,
                                           previous['recordSha256'], 'SOURCE_IMAGE_VALID')
        if state != 'ELIGIBLE':
            blocked[state] += 1
            continue
        target = targets.setdefault(pid, {'id': pid, 'buildingId': building, 'baselineSha256': row[4], 'patches': []})
        require(target['baselineSha256'] == row[4], 'BASELINE_INCONSISTENT')
        target['patches'].append(proven[(building, plan_id)])
    # Consolidation validates each distinct original source pair once, not eleven
    # repeated national batches. No new source IDs enter the frozen universe.
    selected_keys = list({(t['buildingId'], p['id']) for t in targets.values() for p in t['patches']})
    def validate(key):
        source_plan = indexed[key]
        return validate_plan(source_plan, key[1], evidence[source_plan['sourceChunk']])
    with ThreadPoolExecutor(max_workers=8) as pool:
        source_status = dict(zip(selected_keys, pool.map(validate, selected_keys)))
    ordered = []
    for target in sorted(targets.values(), key=lambda t: t['id']):
        valid = []
        for patch in target['patches']:
            status = source_status[(target['buildingId'], patch['id'])]
            if status == VALID:
                valid.append({**patch, 'validation': VALID})
            else:
                blocked[status] += 1
        if valid:
            ordered.append({**target, 'patches': valid})
    for target in ordered:
        target['patches'].sort(key=lambda p: int(p['id']))
    require(bool(ordered), 'EMPTY_NATIONAL_MANIFEST')
    urls = {u for t in ordered for p in t['patches'] for u in p['images']}
    count = sum(len(t['patches']) for t in ordered)
    stats = {'candidateOccurrences': len(candidates), 'eligibleOccurrences': count,
             'properties': len(ordered), 'buildings': len({t['buildingId'] for t in ordered}),
             'distinctUrls': len(urls), 'imageUrlOccurrences': sum(len(p['images']) for t in ordered for p in t['patches']),
             'blockedOccurrences': sum(blocked.values()), 'blockedReasons': dict(blocked)}
    manifest = {'schemaVersion': 1, 'id': 'national-v2-once', 'operationUuid': str(uuid4()),
                'sourceManifestSha256': national.SOURCE_HASH, 'reconciliationSha256': national.REPORT_HASH,
                'preparedCodeSha': os.environ['GITHUB_SHA'], 'columns': columns, 'stats': stats, 'targets': ordered}
    payload = canonical(manifest)
    (directory / 'national-manifest.json').write_bytes(payload)
    summary = {'manifestSha256': sha(payload), 'operationUuid': manifest['operationUuid'], 'stats': stats,
               'sourceManifestSha256': national.SOURCE_HASH, 'reconciliationSha256': national.REPORT_HASH,
               'databaseWrites': 0, 'writesAuthorized': False,
               'urlValidation': 'FULL_BINARY_AND_CHECKPOINT_PROVENANCE_VERIFIED; REVALIDATE_BEFORE_CAS'}
    (directory / 'national-summary.json').write_bytes(canonical(summary))
    print(json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    try:
        build(sys.argv[1], sys.argv[2], Path(sys.argv[3]))
    except Exception:
        sys.exit('NATIONAL_MANIFEST_PREPARATION_FAILED')
