#!/usr/bin/env python3
"""Offline, fail-closed national inventory packager. No DB/HTTP/write executor.

Only packages measured inventory and explicitly untrusted proxy samples. This
version cannot promote any source observation to RECOVERABLE or emit a patch.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def encode(value):
    # Fixed UTF-8 encoding, deterministic insertion order, no clock/randomness.
    if isinstance(value, dict) and 'properties' in value and 'candidates' in value and isinstance(value['properties'], list):
        # One normalized entity per line keeps the large national manifest inspectable.
        parts = []
        for key, item in value.items():
            if key in ['properties', 'candidates']:
                body = ',\n'.join(json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in item)
                parts.append(json.dumps(key) + ':[\n' + body + '\n]')
            else:
                parts.append(json.dumps(key) + ':' + json.dumps(item, ensure_ascii=False, separators=(',', ':')))
        return ('{\n' + ',\n'.join(parts) + '\n}\n').encode()
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def fingerprint(rows):
    return sha('\n'.join(r['id'] + ':' + r['recordSha256'] for r in rows).encode())


def validate_inventory(rows, recheck):
    ids = [r['id'] for r in rows]
    if ids != sorted(set(ids)) or len(rows) != recheck['properties']:
        raise ValueError('INVENTORY_MEMBERSHIP_INVALID')
    for r in rows:
        if not re.fullmatch(r'[0-9a-f]{64}', r['recordSha256']):
            raise ValueError('RECORD_HASH_INVALID')
        if not isinstance(r['plans'], list) or any(
            not isinstance(p, list) or len(p) != 2 or type(p[1]) is not bool
            for p in r['plans']
        ):
            raise ValueError('PLAN_PROJECTION_INVALID')
    if fingerprint(rows) != recheck['inventory_sha256']:
        raise ValueError('INVENTORY_DRIFT')


def build(inputs, output):
    rows = load(inputs / 'inventory.json')
    recheck = load(inputs / 'recheck.json')[0]
    validate_inventory(rows, recheck)
    if output.exists() and any(output.iterdir()):
        raise ValueError('OUTPUT_MUST_BE_NEW_EMPTY_DIRECTORY')
    output.mkdir(parents=True, exist_ok=True)
    written = {}

    def emit(name, value):
        data = value.encode() if isinstance(value, str) else encode(value)
        p = output / name
        p.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive create: never overwrite a frozen artifact.
        with p.open('xb') as stream:
            stream.write(data)
        written[name] = sha(data)

    catalog_path = ROOT / 'scripts/orulo-media-recovery-batches/catalog.json'
    catalog = load(catalog_path)
    national_path = ROOT / 'scripts/orulo-national-dry-run-manifest.json'
    national = load(national_path)
    historical_buildings = {b['buildingId'] for b in national['baseline']}
    history = defaultdict(list)
    previous = []
    for bid, entry in sorted(catalog['batches'].items()):
        path = catalog_path.parent / entry['file']
        doc = load(path)
        # Existing batch hashes use compact JSON.stringify serialization.
        actual = sha(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode())
        if actual != entry['hash']:
            raise ValueError('PREVIOUS_MANIFEST_HASH_MISMATCH:' + bid)
        historical_buildings.update(doc['buildingIds'])
        for target in doc['targets']:
            history[target['id']].append(bid)
        previous.append({'batchId': bid, 'sha256': actual, 'targets': len(doc['targets']),
                         'buildings': len(doc['buildingIds']), 'releasedInOldCatalog': entry['released']})
    historical_buildings.update(str(x) for x in load(ROOT / 'scripts/orulo-media-recovery-lote1.ids.json'))
    # Protected history is evidence, never national eligibility.
    for field in ['protectedBuildingIds', 'priorSourceSampleIds', 'pendingReconciliationBuildingIds']:
        historical_buildings.update(national[field])
    pilot = load(catalog_path.parent / 'pilot-5971-v6-proposal.json')
    for target_id in pilot.get('targetIds', []):
        history[target_id].append('pilot-5971-images')

    samples = [load(p) for p in sorted(inputs.glob('proxy-*.json'))
               if not p.name.startswith('proxy-image-')]
    sampled = {str(s['url'].split('id=')[-1]) for s in samples}
    anomalies = load(inputs / 'url-anomalies.json')
    anomaly_ids = {x['id'] for x in anomalies}
    grouped = {}
    properties = []
    counts = Counter()
    buildings = defaultdict(Counter)
    exclusions = []
    for row in rows:
        bid = row['buildingId']
        plan_ids = [p[0] for p in row['plans']]
        missing = [p[0] for p in row['plans'] if not p[1]]
        malformed = (row['plansType'] != 'array' or any(not p for p in plan_ids)
                     or len(plan_ids) != len(set(plan_ids))
                     or not re.fullmatch(r'[1-9]\d*', str(bid))
                     or not row['externalId'].startswith('orulo:' + str(bid) + ':'))
        state = ('INVALID' if malformed else 'NO_PLANS' if not plan_ids else
                 'COMPLETE' if not missing else 'MISSING_ALL' if len(missing) == len(plan_ids) else 'PARTIAL')
        counts[state] += 1
        counts['planOccurrences'] += len(plan_ids)
        counts['missingOccurrences'] += len(missing)
        buildings[bid]['properties'] += 1
        buildings[bid]['missingOccurrences'] += len(missing)
        known = bid in historical_buildings
        counts['propertiesOutsideKnownBuildingManifests'] += not known
        if not missing:
            exclusions.append({'propertyId': row['id'], 'buildingId': bid,
                               'status': 'ALREADY_COMPLETE' if state == 'COMPLETE' else 'REQUIRES_REVIEW',
                               'reason': 'CURRENT_IMAGES_PRESENT' if state == 'COMPLETE' else state,
                               'previousBatches': history[row['id']]})
        refs = []
        for pid in missing:
            key = str(bid) + ':' + str(pid)
            refs.append(key)
            if key not in grouped:
                grouped[key] = {'key': key, 'buildingId': bid, 'planId': pid,
                                'currentImageState': 'MISSING', 'candidateImage': None,
                                'imageOrEvidenceSha256': None, 'proposedPatch': None,
                                'eligibility': 'AMBIGUOUS' if bid in sampled else 'REQUIRES_REVIEW',
                                'exclusionReason': 'PROXY_PROVENANCE_UNRELIABLE' if bid in sampled else 'AUTHENTICATED_SOURCE_NOT_QUERIED',
                                'propertyIds': []}
            grouped[key]['propertyIds'].append(row['id'])
        properties.append({**row, 'classification': state, 'malformed': malformed,
                           'hasInvalidStoredUrls': row['id'] in anomaly_ids,
                           'previousBatches': history[row['id']], 'knownBuildingManifest': known,
                           'candidateKeys': refs, 'writeAuthorized': False})
    candidates = [grouped[k] for k in sorted(grouped)]
    for c in candidates:
        if c['buildingId'] in sampled:
            index = next(i for i, s in enumerate(samples) if s['url'].endswith('id=' + c['buildingId']))
            c['sourceEvidence'] = ['discovery/source-validation.json#/proxySamples/' + str(index)]
            c['imageOrEvidenceSha256'] = sha(encode(next(s for s in samples if s['url'].endswith('id=' + c['buildingId']))))
        else:
            c['sourceEvidence'] = []
    source_checks = load(inputs / 'proxy-image-checks-curl.json')
    ledger = load(inputs / 'ledger.json')[0]
    image_audit = load(inputs / 'images.json')[0]
    baseline = {**load(inputs / 'baseline.json')[0], 'inventoryRecheck': recheck,
                'inventoryFingerprintVerified': True, 'classification': dict(sorted(counts.items())),
                'candidateProperties': sum(bool(r['candidateKeys']) for r in properties),
                'candidateBuildings': len({c['buildingId'] for c in candidates}),
                'candidatePropertiesOutsideExactPriorTargets': sum(bool(r['candidateKeys']) and not r['previousBatches'] for r in properties),
                'candidateBuildingsOutsideExactPriorTargets': len({r['buildingId'] for r in properties if r['candidateKeys'] and not r['previousBatches']}),
                'candidatePropertiesInsideExactPriorTargets': sum(bool(r['candidateKeys']) and bool(r['previousBatches']) for r in properties),
                'missingDistinctBuildingPlans': len(candidates),
                'buildingsOutsideKnownManifests': len(set(buildings) - historical_buildings),
                'urlAudit': image_audit,
                'hashAlgorithm': 'SHA256(PostgreSQL to_jsonb(whole_property)::text, UTF-8, UTC)',
                'publicRestVisibleCount': 15635,
                'coverage': 'ALL source=novos AND external_id LIKE orulo:%; includes inactive and all states'}
    # Preserve original observations as deterministic build inputs, no credentials.
    for path in sorted(inputs.glob('*.json')):
        if path.name != 'baseline-response.json':
            emit('audit/inputs/' + path.name, load(path))
    functions = load(inputs / 'functions.json')
    emit('audit/function-catalog.json', [
        {'schema': f['schema'], 'name': f['proname'], 'securityDefiner': f['prosecdef'],
         'acl': f['proacl'], 'definitionSha256': sha(f['definition'].encode())} for f in functions])
    emit('audit/baseline.json', baseline)
    emit('audit/ledger-integrity.json', ledger)
    # Run heads preserve immutable event references; omit metadata and event bodies.
    emit('audit/previous-runs.json', [{k: r[k] for k in ['run_uuid', 'github_run_id', 'created_at']} |
         {'head': {k: r['head'][k] for k in ['sequence', 'kind', 'hash']}} for r in load(inputs / 'runs.json')])
    emit('audit/previous-batches.json', {'batches': previous, 'historicalBuildingIds': sorted(historical_buildings),
         'nationalV4ManifestSha256': sha(national_path.read_bytes()),
         'scopeMeaning': 'Building membership and exact UUID batch membership are reported separately; neither proves completed recovery.'})
    emit('audit/url-anomalies.json', anomalies)
    emit('discovery/candidates.json', {'count': len(candidates), 'manifestReference': 'manifest/national-v2.json#/candidates',
         'byEligibility': dict(Counter(c['eligibility'] for c in candidates))})
    emit('discovery/exclusions.json', exclusions)
    emit('discovery/source-validation.json', {'status': 'INCOMPLETE', 'authenticatedSourceRequests': 0,
         'proxySamples': samples, 'cdnChecks': source_checks,
         'priorUserAgentDependent403Checks': load(inputs / 'proxy-image-checks.json'),
         'cdnValidSignatures': sum(bool(c.get('signature')) for c in source_checks),
         'warning': 'Prefix hashes prove sampled file signatures only, not full image hashes or authoritative source provenance.',
         'blocker': 'Existing Vercel ORULO and MIA credentials are Secret/sensitive, metadata readable but decrypted=false and no value. No configured runtime secrets.',
         'sourceErrors': None, 'unqueriedCandidateBuildings': len({c['buildingId'] for c in candidates})})
    emit('manifest/national-v2.json', {'version': 2, 'id': 'orulo-national-v2', 'status': 'BLOCKED_SOURCE_VALIDATION',
         'writeAuthorized': False, 'logicalBatchCount': 1, 'sourceCommit': '673f6f98898e5486cba08892ea49a0727e7aa718',
         'inventoryFingerprint': fingerprint(rows), 'properties': properties, 'candidates': candidates,
         'eligiblePropertyIds': [], 'operations': [],
         'hashWarning': 'Record SHA256 is distinct from legacy V2 MD5 and cannot be passed as its CAS hash. Full expected rows are not persisted in this manifest.'})
    emit('manifest/manifest.sha256', written['manifest/national-v2.json'] + '  national-v2.json\n')
    emit('manifest/batch-plan.json', {'logicalBatches': 1, 'logicalBatchId': 'orulo-national-v2',
         'physicalSegments': None, 'proposedCASOperations': 0, 'eligibleProperties': 0,
         'recoverableImages': None, 'writeAuthorized': False, 'estimatedExecutionSeconds': None,
         'candidatePropertiesUpperBound': baseline['candidateProperties'], 'candidateBuildings': baseline['candidateBuildings'],
         'reason': 'No source-validated patches. Physical sizing must follow measured source/CDN latency and authorized CAS throughput. Existing server catalog does not contain a national batch.',
         'futureExecution': 'Retain one master; sequential per-property transactions and durable operation checkpoints, no national long transaction; never resume ambiguous CAS automatically.'})
    emit('dry-run/cas-preflight.json', {'status': 'BLOCKED', 'inventoryHashes': 'PASS',
         'concurrentChangesDetectedByGlobalRecheck': 0, 'wholeInventoryFingerprint': fingerprint(rows),
         'observationValidAt': recheck['observed_at'], 'realCASCalls': 0,
         'fullExpectedRowsAvailable': False, 'sourceEligibility': 'UNKNOWN',
         'serverCatalogNationalScope': False, 'administrativeAuthorization': False,
         'legacyUnauditedRPC': 'raises AUDITED_CAS_REQUIRED; not invoked'})
    emit('dry-run/simulation.json', {'result': 'UNKNOWN', 'productionWrites': 0, 'realCASCalls': 0,
         'inventoryConsistency': 'PASS', 'manifestDeterminism': 'CHECK_WITH_REBUILD',
         'eligibility': 'BLOCKED', 'imageCorrespondence': 'UNKNOWN', 'sourceCoverage': 'INCOMPLETE',
         'idempotency': 'UNKNOWN_NO_ELIGIBLE_PATCHES', 'concurrency': 'GLOBAL_HASH_RECHECK_PASS_ONLY',
         'rollback': 'UNKNOWN_NO_PROPOSED_PATCHES', 'casExecution': 'NOT_EXECUTED',
         'warning': 'A zero-operation dry run is not an end-to-end PASS. Local executor regression tests are separate evidence.'})
    emit('dry-run/errors.json', [
         {'code': 'SOURCE_SECRET_UNAVAILABLE', 'blocks': ['source-validation', 'patches', 'complete-dry-run']},
         {'code': 'PROXY_PROVENANCE_UNRELIABLE', 'blocks': ['proxy-based-eligibility']},
         {'code': 'NATIONAL_SCOPE_NOT_IN_SERVER_CATALOG', 'blocks': ['future-execution']},
         {'code': 'FULL_CAS_EXPECTED_ROWS_NOT_CAPTURED', 'blocks': ['future-execution']}])
    emit('reports/building-failure-concentration.json', [dict(buildingId=b, **c) for b, c in
         sorted(buildings.items(), key=lambda item: (-item[1]['missingOccurrences'], str(item[0])))])
    emit('audit/artifact-inputs.sha256', ''.join(f'{sha(encode(load(p)))}  {p.name}\n' for p in sorted(inputs.glob('*.json'))
         if p.name not in ['baseline-response.json']))
    emit('SHA256SUMS', ''.join(f'{h}  {name}\n' for name, h in sorted(written.items())))
    return baseline


def verify(root):
    sums = (root / 'SHA256SUMS').read_text().splitlines()
    for line in sums:
        expected, name = line.split('  ', 1)
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
            raise ValueError('ARTIFACT_PATH_ESCAPE')
        if sha(path.read_bytes()) != expected:
            raise ValueError('ARTIFACT_HASH_MISMATCH:' + name)
    m = load(root / 'manifest/national-v2.json')
    validate_inventory(load(root / 'audit/inputs/inventory.json'), load(root / 'audit/inputs/recheck.json')[0])
    if m['writeAuthorized'] or m['operations'] or m['eligiblePropertyIds']:
        raise ValueError('THIS_BUILDER_CANNOT_AUTHORIZE_OPERATIONS')
    for c in m['candidates']:
        if c['eligibility'] not in ['AMBIGUOUS', 'REQUIRES_REVIEW'] or c['proposedPatch'] is not None or c['candidateImage'] is not None:
            raise ValueError('UNVERIFIED_CANDIDATE_PROMOTION')
    return {'verifiedArtifacts': len(sums), 'manifestSha256': sha((root / 'manifest/national-v2.json').read_bytes()),
            'result': 'HASHES_PASS_FULL_DRY_RUN_UNKNOWN'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('--input-dir', type=Path, required=True)
    b.add_argument('--output-dir', type=Path, required=True)
    v = sub.add_parser('verify')
    v.add_argument('directory', type=Path)
    args = parser.parse_args()
    result = build(args.input_dir, args.output_dir) if args.command == 'build' else verify(args.directory)
    print(json.dumps(result, ensure_ascii=False))
