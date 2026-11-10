import importlib.util, json, hashlib, os, subprocess, tempfile, unittest, uuid
from pathlib import Path
from unittest.mock import patch
import psycopg2
from model import ddl
from verify import verify
from restore import restore
from cleanup import plan
spec=importlib.util.spec_from_file_location('archive_export',Path(__file__).with_name('export.py'));ex=importlib.util.module_from_spec(spec);spec.loader.exec_module(ex)
RUN='11111111-1111-4111-8111-111111111111'; ID='22222222-2222-4222-8222-222222222222'
CONTAINER=os.environ.get('ORULO_TEST_CONTAINER','orulo-archive-isolated')

def connect():
    meta=json.loads(subprocess.check_output(['docker','inspect',CONTAINER],text=True))[0]
    assert meta['Config']['Labels'].get('orulo.archive.isolated')=='true'
    port=meta['NetworkSettings']['Ports']['5432/tcp'][0];assert port['HostIp']=='127.0.0.1'
    return psycopg2.connect(host='127.0.0.1',port=port['HostPort'],user='postgres',dbname='postgres')
def reset():
    with connect() as conn:
        with conn.cursor() as c:c.execute('DROP SCHEMA IF EXISTS orulo_audit CASCADE')
def fixture(active=False,reference=None):
    reset()
    with connect() as conn:
        with conn.cursor() as c:
            c.execute(ddl());c.execute("INSERT INTO orulo_audit.runs VALUES (%s,'20','{}',now())",(RUN,))
            prev='';rec=[ID,'sample','5971','2026-11-09','full','content'];columns=[['id','uuid']]
            events=[{'type':'SNAPSHOT_BEGIN','kind':'BASELINE_V2','keys':[ID],'columns':columns},{'type':'SNAPSHOT_PAGE','kind':'BASELINE_V2','count':1,'offset':0,'records':[rec]},{'type':'BASELINE_V2','snapshot':{'format':'paged-v2'}}]
            if reference:events[0]['sourceRunUuid']=reference
            if not active:events.append({'type':'FINISHED'})
            for n,event in enumerate(events,1):
                event['eventUuid']=str(uuid.uuid4())
                c.execute("SELECT jsonb_build_object('runUuid',%s::uuid,'sequence',%s,'previousHash',%s,'event',%s::jsonb)::text",(RUN,n,prev,json.dumps(event)))
                canonical=c.fetchone()[0];h=hashlib.sha256(canonical.encode()).hexdigest()
                c.execute('INSERT INTO orulo_audit.entries VALUES (%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,now())',(RUN,n,event['eventUuid'],event['type'],json.dumps(event),prev,canonical,h,'123'))
                prev=h
            c.execute('INSERT INTO orulo_audit.snapshot_sets VALUES (%s,%s,%s::uuid[],%s,1)',(RUN,'BASELINE_V2',[ID],json.dumps(columns)))
            c.execute('INSERT INTO orulo_audit.snapshot_records VALUES (%s,%s,%s,%s,2)',(RUN,'BASELINE_V2',ID,json.dumps(rec)))

def rehash(root,table):
    m=json.loads((root/'manifest.json').read_text());path=root/(table+'.jsonl');data=path.read_bytes()
    item=next(x for x in m['files'] if x['file']==path.name);item.update(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),rows=len(data.splitlines()))
    raw=(json.dumps(m,sort_keys=True,ensure_ascii=False)+'\n').encode();(root/'manifest.json').write_bytes(raw);(root/'manifest.sha256').write_text(hashlib.sha256(raw).hexdigest()+'\n')

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        fixture();self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'archive'
    def tearDown(self):self.tmp.cleanup()
    def export(self):
        conn=connect()
        try:return ex.export_run(conn,RUN,self.root)
        finally:conn.close()
    def test_stream_export_and_real_postgresql_restore(self):
        self.export();v=verify(self.root);self.assertTrue(v['contentVerified']);reset()
        result=restore(self.root,CONTAINER);self.assertTrue(result['restoreVerified'])
    def test_exact_numeric_jsonb_and_xid8_survive_restore(self):
        with connect() as conn:
            with conn.cursor() as c:
                c.execute("UPDATE orulo_audit.runs SET metadata='{"+'"precise":123456789012345678901234567890.12345678901234567890'+"}'::jsonb")
                c.execute("UPDATE orulo_audit.entries SET created_xid='18446744073709551615'::xid8")
        self.export();verify(self.root);reset();self.assertTrue(restore(self.root,CONTAINER)['restoreVerified'])
    def test_incomplete_file(self):
        self.export();p=self.root/'entries.jsonl';p.write_bytes(p.read_bytes()[:-1])
        with self.assertRaises(ValueError):verify(self.root)
    def test_hash_divergence(self):
        self.export();p=self.root/'entries.jsonl';p.write_bytes(p.read_bytes().replace(b'5971',b'5972'))
        with self.assertRaises(ValueError):verify(self.root)
    def test_manifest_hash_divergence(self):
        self.export();p=self.root/'manifest.json';p.write_text(p.read_text()+' ')
        with self.assertRaises(ValueError):verify(self.root)
    def test_chain_even_after_file_hash_recomputed(self):
        self.export();p=self.root/'entries.jsonl';rows=p.read_text().splitlines();x=json.loads(rows[1]);x['previous_hash']='bad';rows[1]=json.dumps(x);p.write_text('\n'.join(rows)+'\n');rehash(self.root,'entries')
        with self.assertRaisesRegex(ValueError,'CHAIN_SEQUENCE'):verify(self.root)
    def test_active_run_blocked(self):
        fixture(active=True)
        with self.assertRaisesRegex(ValueError,'RUN_ACTIVE'):self.export()
        self.assertFalse((self.root/'manifest.json').exists())
    def test_snapshot_missing(self):
        self.export();(self.root/'snapshot_records.jsonl').write_bytes(b'');rehash(self.root,'snapshot_records')
        with self.assertRaisesRegex(ValueError,'SNAPSHOT_MISSING'):verify(self.root)
    def test_snapshot_content_mismatch(self):
        self.export();p=self.root/'snapshot_records.jsonl';p.write_text(p.read_text().replace('content','changed'));rehash(self.root,'snapshot_records')
        with self.assertRaisesRegex(ValueError,'SNAPSHOT_RECORD_OR_PAGE_MISMATCH'):verify(self.root)
    def test_pending_cas_dependency_never_eligible(self):
        other='33333333-3333-4333-8333-333333333333';fixture(reference=other);self.export()
        v=verify(self.root);self.assertIn(other,v['referencedRuns']);self.assertFalse(v['removalEligible'])
    def test_interruption_resume(self):
        original=ex.stream_file
        def fail(path,rows):
            if path.name=='entries.jsonl':
                def interrupted():
                    for i,row in enumerate(rows):
                        if i==1:raise RuntimeError('interrupted')
                        yield row
                return original(path,interrupted())
            return original(path,rows)
        with patch.object(ex,'stream_file',fail):
            with self.assertRaises(RuntimeError):self.export()
        self.assertFalse((self.root/'manifest.json').exists());self.assertFalse((self.root/'entries.jsonl.partial').exists())
        self.export();self.assertTrue(verify(self.root)['contentVerified'])
    def test_immutable_resume_rejects_source_change(self):
        self.export()
        with connect() as conn:
            with conn.cursor() as c:c.execute("UPDATE orulo_audit.runs SET metadata='{"+'"changed":true'+"}' WHERE run_uuid=%s",(RUN,))
        with self.assertRaisesRegex(ValueError,'SOURCE_OR_ARCHIVE_CHANGED'):self.export()
    def test_concurrent_local_export_blocked(self):
        import fcntl
        self.root.mkdir()
        with (self.root/'.lock').open('a') as f:
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):self.export()
    def test_consistent_snapshot_under_concurrent_change(self):
        original=ex.stream_file;changed=False
        def mutate(path,rows):
            nonlocal changed
            if not changed:
                changed=True
                with connect() as conn:
                    with conn.cursor() as c:c.execute("UPDATE orulo_audit.runs SET metadata='{"+'"concurrent":true'+"}' WHERE run_uuid=%s",(RUN,))
            return original(path,rows)
        with patch.object(ex,'stream_file',mutate):self.export()
        self.assertEqual(json.loads((self.root/'runs.jsonl').read_text())['metadata'],{})
        self.assertFalse(verify(self.root)['removalEligible'])
    def test_no_approval_and_even_claimed_approval_cannot_enable_deletion(self):
        run={'run_uuid':RUN,'finished':True,'archiveStatus':'VERIFIED_DURABLE_READBACK','restoreStatus':'VERIFIED_EXACT_RESTORE','dependencyReview':'VERIFIED_NO_PENDING_DEPENDENCY'}
        self.assertIn('NO_EXPLICIT_APPROVAL',plan({'runs':[run]})['runs'][0]['blockers'])
        self.assertFalse(plan({'runs':[run]},[RUN])['runs'][0]['eligible'])
    def test_deletion_attempt_rejected_without_connection(self):
        result=subprocess.run(['python3',str(Path(__file__).with_name('cleanup.py')),'missing','--execute'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0);self.assertIn('BLOCKED_CLEANUP',result.stdout)
    def test_restore_rejects_inconsistent_result(self):
        self.export();reset()
        with patch('restore.sha_file',return_value='wrong'):
            # Receipt must remain bound to the manifest validated by the independent verifier.
            from restore import restore as invoke
            with self.assertRaises(ValueError):invoke(self.root,CONTAINER)
    def test_restore_refuses_nonempty_target(self):
        self.export()
        with self.assertRaisesRegex(ValueError,'TARGET_NOT_EMPTY'):restore(self.root,CONTAINER)
    def test_real_restore_detects_changed_postgresql_value(self):
        self.export();reset()
        corrupt=ddl()+"CREATE FUNCTION orulo_audit.corrupt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.github_run_id='21'; RETURN NEW; END$$;CREATE TRIGGER corrupt BEFORE INSERT ON orulo_audit.runs FOR EACH ROW EXECUTE FUNCTION orulo_audit.corrupt();"
        with patch('restore.ddl',return_value=corrupt):
            with self.assertRaisesRegex(ValueError,'RESTORE_MISMATCH'):restore(self.root,CONTAINER)
    def test_missing_snapshot_set_rejected_after_rehash(self):
        self.export();(self.root/'snapshot_sets.jsonl').write_bytes(b'');rehash(self.root,'snapshot_sets')
        with self.assertRaises(ValueError):verify(self.root)
    def test_symlink_file_rejected(self):
        self.export();p=self.root/'runs.jsonl';p.rename(self.root/'alternate');p.symlink_to(self.root/'alternate')
        with self.assertRaises(ValueError):verify(self.root)
    def test_durable_adapter_reads_locked_versions_and_reverifies(self):
        from durable import preserve
        import datetime
        self.export()
        class Body:
            def __init__(self,data):self.data=data
            def iter_chunks(self,chunk_size):yield self.data
            def close(self):pass
        class Client:
            def __init__(self):self.objects={};self.retention={}
            def get_public_access_block(self,**kw):return {'PublicAccessBlockConfiguration':{k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}}
            def get_bucket_policy_status(self,**kw):return {'PolicyStatus':{'IsPublic':False}}
            def get_bucket_versioning(self,**kw):return {'Status':'Enabled'}
            def get_object_lock_configuration(self,**kw):return {'ObjectLockConfiguration':{'ObjectLockEnabled':'Enabled'}}
            def put_object(self,**kw):
                assert kw['IfNoneMatch']=='*' and kw['ObjectLockMode']=='COMPLIANCE'
                self.objects[kw['Key']]=kw['Body'].read();self.retention[kw['Key']]=kw['ObjectLockRetainUntilDate'];return {'VersionId':'version'}
            def get_object(self,**kw):return {'Body':Body(self.objects[kw['Key']])}
            def get_object_retention(self,**kw):return {'Retention':{'Mode':'COMPLIANCE','RetainUntilDate':self.retention[kw['Key']]}}
        client=Client();receipt=preserve(self.root,'unused','isolated-fixture',client)
        self.assertTrue(receipt['durableReadbackVerified']);self.assertTrue(receipt['restoreStillRequired']);self.assertFalse(receipt['removalEligible'])
    def test_durable_adapter_rejects_corrupt_remote_bytes(self):
        from durable import preserve
        self.export()
        class Body:
            def iter_chunks(self,chunk_size):yield b'corrupt'
            def close(self):pass
        class Client:
            def get_public_access_block(self,**kw):return {'PublicAccessBlockConfiguration':{k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}}
            def get_bucket_policy_status(self,**kw):return {'PolicyStatus':{'IsPublic':False}}
            def get_bucket_versioning(self,**kw):return {'Status':'Enabled'}
            def get_object_lock_configuration(self,**kw):return {'ObjectLockConfiguration':{'ObjectLockEnabled':'Enabled'}}
            def put_object(self,**kw):return {'VersionId':'v'}
            def get_object(self,**kw):return {'Body':Body()}
        with self.assertRaisesRegex(ValueError,'DURABLE_READBACK_MISMATCH'):preserve(self.root,'unused','unused',Client())
    def test_durable_adapter_rejects_public_storage(self):
        from durable import preserve
        self.export()
        class Client:
            def get_public_access_block(self,**kw):return {'PublicAccessBlockConfiguration':{}}
        with self.assertRaisesRegex(ValueError,'BUCKET_PRIVACY_NOT_PROVEN'):preserve(self.root,'unused','unused',Client())

if __name__=='__main__':unittest.main()
