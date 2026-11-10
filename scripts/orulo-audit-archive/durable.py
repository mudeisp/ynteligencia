#!/usr/bin/env python3
"""Optional private S3 Object Lock adapter. Not invoked by the workflow."""
import argparse, datetime, hashlib, json, tempfile
from pathlib import Path
from verify import verify, sha_file

def preserve(directory, bucket, prefix, client):
    verified=verify(directory);root=Path(directory)
    public=client.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
    if not all(public.get(k) is True for k in ('BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets')):raise ValueError('BUCKET_PRIVACY_NOT_PROVEN')
    if client.get_bucket_policy_status(Bucket=bucket)['PolicyStatus']['IsPublic'] is not False:raise ValueError('PUBLIC_BUCKET')
    if client.get_bucket_versioning(Bucket=bucket).get('Status')!='Enabled':raise ValueError('VERSIONING_REQUIRED')
    if client.get_object_lock_configuration(Bucket=bucket)['ObjectLockConfiguration'].get('ObjectLockEnabled')!='Enabled':raise ValueError('OBJECT_LOCK_REQUIRED')
    retained=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=365)
    objects=[]
    # A fresh unique prefix is required; never overwrite a previously archived object.
    for name in ['runs.jsonl','entries.jsonl','snapshot_sets.jsonl','snapshot_records.jsonl','catalog.json','manifest.json','manifest.sha256']:
        path=root/name;key=prefix.rstrip('/')+'/'+verified['run_uuid']+'/'+verified['manifestSha256']+'/'+name
        with path.open('rb') as body:
            result=client.put_object(Bucket=bucket,Key=key,Body=body,IfNoneMatch='*',ServerSideEncryption='AES256',ObjectLockMode='COMPLIANCE',ObjectLockRetainUntilDate=retained)
        version=result.get('VersionId')
        if not version:raise ValueError('VERSION_ID_MISSING')
        h=hashlib.sha256();size=0
        response=client.get_object(Bucket=bucket,Key=key,VersionId=version)
        try:
            for chunk in response['Body'].iter_chunks(chunk_size=1024*1024):h.update(chunk);size+=len(chunk)
        finally:response['Body'].close()
        if h.hexdigest()!=sha_file(path) or size!=path.stat().st_size:raise ValueError('DURABLE_READBACK_MISMATCH')
        lock=client.get_object_retention(Bucket=bucket,Key=key,VersionId=version)['Retention']
        if lock['Mode']!='COMPLIANCE' or lock['RetainUntilDate']<retained:raise ValueError('RETENTION_NOT_PROVEN')
        objects.append({'key':key,'version':version,'sha256':h.hexdigest(),'bytes':size})
    # Download a SECOND copy; run the independent semantic verifier on remote bytes.
    with tempfile.TemporaryDirectory(prefix='orulo-remote-verify-') as d:
        for item in objects:
            response=client.get_object(Bucket=bucket,Key=item['key'],VersionId=item['version'])
            with (Path(d)/item['key'].split('/')[-1]).open('wb') as f:
                try:
                    for b in response['Body'].iter_chunks(chunk_size=1024*1024):f.write(b)
                finally:response['Body'].close()
        reread=verify(d)
        if reread['manifestSha256']!=verified['manifestSha256']:raise ValueError('REMOTE_MANIFEST_CHANGED')
    return {'durableReadbackVerified':True,'manifestSha256':verified['manifestSha256'],'objects':objects,'retentionUntil':retained.isoformat(),'restoreStillRequired':True,'removalEligible':False}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('--bucket',required=True);p.add_argument('--prefix',required=True);a=p.parse_args()
    try:
        import boto3
        receipt=preserve(a.directory,a.bucket,a.prefix,boto3.client('s3'))
        # Locations and object IDs stay in the private receipt, never public stdout.
        (Path(a.directory)/'durable-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print('DURABLE_READBACK_VERIFIED; restoration and dependency review still required')
    except Exception:print('BLOCKED_DURABLE_STORAGE (details withheld)');raise SystemExit(1)
