#!/usr/bin/env python3
"""Independent streaming verifier. Imports neither exporter nor its model."""
import argparse, decimal, hashlib, json, re, sqlite3, tempfile, uuid
from pathlib import Path

FILES=('runs','entries','snapshot_sets','snapshot_records')
# Independent versioned contract: do not trust a manifest to define its own columns.
EXPECTED_COLUMNS={
'runs':[['run_uuid','uuid'],['github_run_id','text'],['metadata','jsonb'],['created_at','timestamp with time zone']],
'entries':[['run_uuid','uuid'],['sequence','bigint'],['event_uuid','uuid'],['operation_uuid','uuid'],['kind','text'],['event','jsonb'],['previous_hash','text'],['canonical','text'],['hash','text'],['created_xid','xid8'],['created_at','timestamp with time zone']],
'snapshot_sets':[['run_uuid','uuid'],['kind','text'],['keys','uuid[]'],['columns','jsonb'],['begin_sequence','bigint']],
'snapshot_records':[['run_uuid','uuid'],['kind','text'],['id','uuid'],['record','jsonb'],['page_sequence','bigint']]}

def check(ok, reason):
    if not ok:raise ValueError(reason)
def load(raw):return json.loads(raw,parse_float=decimal.Decimal)
def normalized(value):return json.dumps(value,sort_keys=True,default=str,separators=(',',':'))
def sha_file(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def regular(path):check(path.is_file() and not path.is_symlink(),'UNSAFE_OR_MISSING_FILE')
def read_rows(path, expected):
    h=hashlib.sha256();n=0;size=0
    with path.open('rb') as f:
        for line in f:
            check(line.endswith(b'\n'),'INCOMPLETE_FILE'); h.update(line);size+=len(line);n+=1
            yield load(line)
    check(n==expected['rows'] and size==expected['bytes'],'COUNT_OR_SIZE_MISMATCH')
    check(h.hexdigest()==expected['sha256'],'FILE_HASH_MISMATCH')
def verify(directory):
    root=Path(directory);regular(root/'manifest.json');regular(root/'manifest.sha256')
    check(sha_file(root/'manifest.json')==(root/'manifest.sha256').read_text().strip(),'MANIFEST_HASH_MISMATCH')
    m=load((root/'manifest.json').read_bytes());check(m['format']=='orulo-audit-archive-v1','FORMAT')
    check(m['columns']==EXPECTED_COLUMNS,'SCHEMA_CONTRACT_MISMATCH')
    run=str(uuid.UUID(m['run_uuid']));regular(root/'catalog.json')
    check(sha_file(root/'catalog.json')==m['catalogSha256'],'CATALOG_HASH_MISMATCH')
    check([x['file'] for x in m['files']]==[t+'.jsonl' for t in FILES],'FILE_SET')
    for t in FILES:regular(root/(t+'.jsonl'))
    with tempfile.TemporaryDirectory(prefix='orulo-verify-') as d:
        db=sqlite3.connect(str(Path(d)/'verify.sqlite'))
        db.executescript('CREATE TABLE ev(seq INTEGER PRIMARY KEY,kind TEXT,event TEXT);CREATE TABLE expected(kind TEXT,id TEXT,record TEXT,page INTEGER,PRIMARY KEY(kind,id));CREATE TABLE sets(kind TEXT PRIMARY KEY);CREATE TABLE keys(kind TEXT,id TEXT,PRIMARY KEY(kind,id));CREATE TABLE seen(kind TEXT,id TEXT,PRIMARY KEY(kind,id));CREATE TABLE ids(event_uuid TEXT PRIMARY KEY);')
        counts={};prev='';seq=0;terminal=None;references=set();snapshot_kinds=set();paged_kinds=set()
        def scan(v):
            if isinstance(v,dict):
                for k,x in v.items():
                    if k.lower() in ('runuuid','run_uuid','prerequisiterunuuid','sourcerunuuid') and isinstance(x,str) and x!=run:
                        try:references.add(str(uuid.UUID(x)))
                        except ValueError:check(False,'INVALID_RUN_REFERENCE')
                    scan(x)
            elif isinstance(v,list):
                for x in v:scan(x)
        for t,info in zip(FILES,m['files']):
            count=0;last_key=None
            for row in read_rows(root/info['file'],info):
                count+=1;check(row.get('run_uuid')==run,'CROSS_RUN_ROW')
                check(set(row)=={c[0] for c in m['columns'][t]},'COLUMN_SET')
                if t=='runs':scan(row['metadata']);continue
                if t=='entries':
                    check(terminal is None,'EVENT_AFTER_TERMINAL');seq+=1
                    check(row['sequence']==seq and row['previous_hash']==prev,'CHAIN_SEQUENCE')
                    canonical=row['canonical'];event=row['event'];parsed=load(canonical)
                    check(parsed=={'runUuid':run,'sequence':seq,'previousHash':prev,'event':event},'CANONICAL_CONTENT')
                    check(hashlib.sha256(canonical.encode()).hexdigest()==row['hash'],'CHAIN_HASH')
                    check(event.get('type')==row['kind'] and event.get('eventUuid')==row['event_uuid'],'EVENT_IDENTITY')
                    check(row['operation_uuid']==event.get('operationId'),'OPERATION_IDENTITY')
                    db.execute('INSERT INTO ids VALUES (?)',(row['event_uuid'],))
                    db.execute('INSERT INTO ev VALUES (?,?,?)',(seq,row['kind'],normalized(event)))
                    if row['kind']=='SNAPSHOT_PAGE':
                        check(event.get('count')==len(event['records']),'PAGE_COUNT')
                        for rec in event['records']:
                            db.execute('INSERT INTO expected VALUES (?,?,?,?)',(event['kind'],rec[0],normalized(rec),seq))
                    if row['kind'] in ('BASELINE_V2','READBACK_V2'):
                        snapshot_kinds.add(row['kind'])
                        if event.get('snapshot',{}).get('format')=='paged-v2':paged_kinds.add(row['kind'])
                    scan(event);prev=row['hash']
                    if row['kind'] in ('FINISHED','ABORTED'):terminal=row['kind']
                elif t=='snapshot_sets':
                    key=row['kind'];check(last_key is None or key>last_key,'SET_ORDER');last_key=key
                    begin=db.execute('SELECT kind,event FROM ev WHERE seq=?',(row['begin_sequence'],)).fetchone()
                    check(begin is not None and begin[0]=='SNAPSHOT_BEGIN','SNAPSHOT_BEGIN_MISSING')
                    ev=load(begin[1]);check(ev['kind']==key and ev['keys']==row['keys'] and ev['columns']==row['columns'],'SET_CONTENT')
                    db.execute('INSERT INTO sets VALUES (?)',(key,))
                    for ident in row['keys']:db.execute('INSERT INTO keys VALUES (?,?)',(key,ident))
                    check(key in snapshot_kinds,'SNAPSHOT_NOT_SEALED')
                else:
                    key=(row['kind'],row['id']);check(last_key is None or key>last_key,'RECORD_ORDER');last_key=key
                    found=db.execute('SELECT record,page FROM expected WHERE kind=? AND id=?',key).fetchone()
                    check(found is not None and found==(normalized(row['record']),row['page_sequence']),'SNAPSHOT_RECORD_OR_PAGE_MISMATCH')
                    check(row['record'][0]==row['id'],'RECORD_IDENTITY')
                    check(db.execute('SELECT 1 FROM keys WHERE kind=? AND id=?',key).fetchone() is not None,'SNAPSHOT_KEY_MISSING')
                    db.execute('INSERT INTO seen VALUES (?,?)',key)
            counts[t]=count
        check(counts['runs']==1,'RUN_COUNT')
        check(terminal is not None and m['head']=={'kind':terminal,'sequence':seq,'hash':prev},'ACTIVE_OR_HEAD_MISMATCH')
        for kind in paged_kinds:check(db.execute('SELECT 1 FROM sets WHERE kind=?',(kind,)).fetchone() is not None,'SNAPSHOT_SET_MISSING')
        for a,b in [('keys','seen'),('expected','seen')]:
            check(db.execute(f'SELECT kind,id FROM {a} EXCEPT SELECT kind,id FROM {b}').fetchone() is None,'SNAPSHOT_MISSING')
        # Functions may contain literal prerequisite runs invisible to FK catalogs.
        catalog=load((root/'catalog.json').read_bytes())
        known_runs=set(catalog.get('knownRunUuids') or [])
        for f in catalog.get('functions') or []:
            references.update(x.lower() for x in re.findall(r'\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b',f.get('definition','')) if x.lower()!=run and x.lower() in known_runs)
        db.close()
    return {'run_uuid':run,'contentVerified':True,'counts':counts,'manifestSha256':sha_file(root/'manifest.json'),'referencedRuns':sorted(references),'dependencyStatus':'BLOCKED_REQUIRES_LIVE_REVIEW_AND_CLOSURE','archiveStatus':'NOT_PROVEN_DURABLE_OR_RESTORED','removalEligible':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();print(json.dumps(verify(a.directory),sort_keys=True))
if __name__=='__main__':
    try:main()
    except Exception:print('BLOCKED_VERIFY (details withheld)');raise SystemExit(1)
