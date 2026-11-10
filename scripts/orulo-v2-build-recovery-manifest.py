#!/usr/bin/env python3
"""Build a provenance-preserving recovery manifest from six verified Órulo checkpoints.
Input: verified decrypted source.tgz paths, one per chunk, in order.
No network access, Supabase access, or writes to property records.
"""
import hashlib,json,sys,tarfile
from pathlib import Path

def canonical(obj):
    return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()

def build(paths):
    seen_buildings=set()
    manifest={}
    classifications={}
    for chunk,path in enumerate(paths):
        with tarfile.open(path,'r:gz') as tar:
            members={m.name:m for m in tar.getmembers()}
            assert all(m.isfile() or m.isdir() for m in members.values()),'UNSAFE_MEMBER'
            assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in members),'UNSAFE_PATH'
            index=json.load(tar.extractfile(members['v2-source-chunk/index.json']))
            for entry in index['results']:
                building=str(entry['buildingId'])
                assert building not in seen_buildings,'DUPLICATE_BUILDING'
                seen_buildings.add(building)
                member=members[f'v2-source-chunk/buildings/{building}/result.json']
                payload=tar.extractfile(member).read()
                assert hashlib.sha256(payload).hexdigest()==entry['sha256'],'SOURCE_HASH_MISMATCH'
                result=json.loads(payload)
                assert str(result['buildingId'])==building,'SOURCE_ID_MISMATCH'
                assert result.get('writeAuthorized') is False,'SOURCE_UNEXPECTED_WRITE'
                for plan in result.get('plans',[]):
                    pid=str(plan['planId'])
                    assert building.isdecimal() and pid.isdecimal(),'INVALID_SOURCE_IDS'
                    key=(building,pid)
                    assert key not in manifest,'DUPLICATE_SOURCE_PLAN'
                    status=plan.get('status','UNKNOWN')
                    classifications[status]=classifications.get(status,0)+1
                    normalized=plan.get('normalizedPlan')
                    checks=plan.get('imageChecks') or []
                    # Source classification is retained; no unverified promotion to eligible.
                    if status=='RECOVERABLE':
                        assert isinstance(normalized,dict) and checks,'RECOVERABLE_WITHOUT_EVIDENCE'
                    manifest[key]={
                        'buildingId':building,'planId':pid,
                        'sourceChunk':chunk,'sourceResultSha256':entry['sha256'],
                        'status':status,'normalizedPlan':normalized,
                        'imageChecks':checks,
                        'targetPropertyIds':[],
                        'casBaselineSha256':None,
                        'casEligible':False,
                        'blockedReason':'TARGET_RECONCILIATION_AND_BASELINE_PENDING'
                    }
    ordered=[manifest[k] for k in sorted(manifest,key=lambda k:(int(k[0]),int(k[1])))]
    return {'schemaVersion':1,'source':'orulo-v2-six-immutable-checkpoints',
            'sourceBuildings':len(seen_buildings),'classifications':classifications,
            'plans':ordered,'writesAuthorized':False}

if __name__=='__main__':
    if len(sys.argv)!=8:raise SystemExit('usage: build_manifest.py OUTPUT CHUNK0.tgz ... CHUNK5.tgz')
    result=build(sys.argv[2:])
    payload=canonical(result)
    Path(sys.argv[1]).write_bytes(payload)
    print(json.dumps({'status':'SOURCE_MANIFEST_BUILT','buildings':result['sourceBuildings'],
        'plans':len(result['plans']),'classifications':result['classifications'],
        'sha256':hashlib.sha256(payload).hexdigest(),'casEligible':0,'writes':0},sort_keys=True))
