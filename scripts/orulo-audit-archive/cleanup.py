#!/usr/bin/env python3
"""Default-deny cleanup planner. This release contains NO production DML path."""
import argparse, json, os
from pathlib import Path

def plan(inventory, approved=()):
    rows=[]
    for r in inventory['runs']:
        reasons=[]
        if not (r.get('finished') or r.get('aborted')):reasons.append('ACTIVE_OR_UNKNOWN')
        if r['run_uuid'] not in approved:reasons.append('NO_EXPLICIT_APPROVAL')
        if r.get('dependencyReview')!='VERIFIED_NO_PENDING_DEPENDENCY':reasons.append('CAS_RECONCILIATION_OR_DEPENDENCY_REVIEW_REQUIRED')
        if r.get('archiveStatus')!='VERIFIED_DURABLE_READBACK':reasons.append('NO_VERIFIED_DURABLE_ARCHIVE')
        if r.get('restoreStatus')!='VERIFIED_EXACT_RESTORE':reasons.append('NO_RUN_SPECIFIC_RESTORE')
        # Always enforced, even if an input file claims every other gate passed.
        reasons.extend(['APPEND_ONLY_TRIGGERS_PROHIBIT_REMOVAL','EXECUTOR_DISABLED_PENDING_SEPARATE_AUTHORIZATION_AND_PROTOCOL_REVIEW','LIVE_REVALIDATION_REQUIRED'])
        rows.append({'run_uuid':r['run_uuid'],'entries':r.get('entries',0),'snapshotRecords':r.get('snapshot_records',0),'datumBytesEstimate':r.get('datum_bytes',0),'operationalStatus':r.get('operationalStatus','UNKNOWN'),'archiveStatus':r.get('archiveStatus','UNKNOWN'),'restoreStatus':r.get('restoreStatus','UNKNOWN'),'dependencies':{'review':r.get('dependencyReview','UNKNOWN'),'functionsReferencingRun':r.get('functionsReferencingRun',[]),'authorizations':r.get('authorizations','UNKNOWN'),'intentsWithoutResult':r.get('intentsWithoutResult','UNKNOWN')},'eligible':False,'blockers':reasons,'physicalBytesGuaranteed':0})
    return {'dryRun':True,'executionEnabled':False,'runs':rows,'datumBytesEstimate':sum(x['datumBytesEstimate'] for x in rows),'guaranteedPhysicalReclaimBytes':0,'futureBatchPolicy':{'maxRowsPerTransaction':100,'lockOrder':['global recovery lock','run lock'],'revalidateBeforeEveryBatch':True,'abortOnDrift':True,'mustRecordExternalImmutableJournal':True,'protectedTables':['public.properties','public.events'],'requiresApprovedRunAllowlist':True},'note':'Datum sizes are not a promise of filesystem or billing reduction. Indexes, TOAST, free pages and rewrite overhead differ.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('inventory');p.add_argument('--execute',action='store_true');p.add_argument('--approved-run',action='append',default=[]);a=p.parse_args()
    if a.execute or os.environ.get('DRY_RUN','true').lower()!='true':raise ValueError('CLEANUP_EXECUTOR_DISABLED')
    print(json.dumps(plan(json.loads(Path(a.inventory).read_text()),a.approved_run),indent=2))
if __name__=='__main__':
    try:main()
    except Exception:print('BLOCKED_CLEANUP');raise SystemExit(1)
