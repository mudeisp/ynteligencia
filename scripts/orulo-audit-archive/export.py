#!/usr/bin/env python3
"""Run-scoped streaming export; every SQL statement is executed READ ONLY."""
import argparse, hashlib, json, os, uuid
from pathlib import Path
from model import TABLES, ORDER

CATALOG = """SELECT json_build_object(
 'knownRunUuids',(SELECT json_agg(run_uuid ORDER BY run_uuid) FROM orulo_audit.runs),
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='orulo_audit'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',conrelid::regclass::text,'definition',pg_get_constraintdef(oid))) FROM pg_constraint WHERE connamespace='orulo_audit'::regnamespace OR confrelid IN(SELECT oid FROM pg_class WHERE relnamespace='orulo_audit'::regnamespace)),
 'triggers',(SELECT json_agg(json_build_object('table',tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid),'enabled',tgenabled)) FROM pg_trigger t JOIN pg_class c ON c.oid=tgrelid WHERE c.relnamespace='orulo_audit'::regnamespace AND NOT tgisinternal),
 'functions',(SELECT json_agg(json_build_object('name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.pronamespace='orulo_audit'::regnamespace),
 'policies',(SELECT json_agg(row_to_json(p)) FROM pg_policies p WHERE schemaname='orulo_audit'))::text"""

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def atomic(path, data):
    tmp=path.with_name(path.name+'.partial')
    with tmp.open('wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,path)

def stream_file(path, rows):
    """Interrupted files restart; complete files must match a fresh DB stream."""
    tmp=path.with_name(path.name+'.partial'); h=hashlib.sha256(); count=0
    try:
        with tmp.open('wb') as f:
            for (raw,) in rows:
                b=raw.encode('utf-8')+b'\n'; f.write(b); h.update(b); count+=1
            f.flush(); os.fsync(f.fileno())
        if path.exists():
            if digest(path)!=h.hexdigest(): raise ValueError('SOURCE_OR_ARCHIVE_CHANGED')
            tmp.unlink()
        else: os.replace(tmp,path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return {'file':path.name,'rows':count,'bytes':path.stat().st_size,'sha256':h.hexdigest()}

def export_run(conn, run, out):
    run=str(uuid.UUID(run)); out=Path(out)
    if out.is_symlink():raise ValueError('UNSAFE_OUTPUT_DIRECTORY')
    out.mkdir(mode=0o700,parents=True,exist_ok=True)
    for name in ['.lock','catalog.json','manifest.json','manifest.sha256']+[t+'.jsonl' for t in TABLES]:
        if (out/name).is_symlink() or (out/(name+'.partial')).is_symlink():raise ValueError('UNSAFE_OUTPUT_FILE')
    # Serialize local exporters; do not take production advisory locks.
    import fcntl
    with (out/'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        conn.set_session(isolation_level='REPEATABLE READ',readonly=True,autocommit=False)
        try:
            with conn.cursor() as c:
                c.execute("SET LOCAL row_security=off"); c.execute("SET LOCAL timezone='UTC'"); c.execute("SET LOCAL statement_timeout='120s'")
                c.execute("SELECT current_setting('transaction_read_only')"); assert c.fetchone()[0]=='on'
                c.execute(CATALOG); catalog=json.loads(c.fetchone()[0])
                actual={t:[(x['name'],x['type']) for x in catalog['columns'] if x['table']==t] for t in TABLES}
                if actual!=TABLES or {x['table'] for x in catalog['columns']}!=set(TABLES): raise ValueError('SCHEMA_DRIFT')
                c.execute('SELECT count(*) FROM orulo_audit.runs WHERE run_uuid=%s',(run,))
                if c.fetchone()[0]!=1:raise ValueError('RUN_NOT_FOUND_OR_HIDDEN')
                c.execute('SELECT kind,sequence,hash FROM orulo_audit.entries WHERE run_uuid=%s ORDER BY sequence DESC LIMIT 1',(run,))
                head=c.fetchone()
                if not head or head[0] not in ('FINISHED','ABORTED'):raise ValueError('RUN_ACTIVE')
            catalog_bytes=(json.dumps(catalog,sort_keys=True,ensure_ascii=False)+'\n').encode()
            if (out/'catalog.json').exists() and (out/'catalog.json').read_bytes()!=catalog_bytes:raise ValueError('SCHEMA_CHANGED_ON_RESUME')
            atomic(out/'catalog.json',catalog_bytes)
            files=[]
            for table in TABLES:
                with conn.cursor(name='archive_'+table) as c:
                    c.itersize=100
                    # Table and order come exclusively from this reviewed constant contract.
                    c.execute(f'SELECT row_to_json(t)::text FROM orulo_audit.{table} t WHERE run_uuid=%s ORDER BY {ORDER[table]}',(run,))
                    files.append(stream_file(out/(table+'.jsonl'),c))
            with conn.cursor() as c:
                c.execute('SELECT kind,sequence,hash FROM orulo_audit.entries WHERE run_uuid=%s ORDER BY sequence DESC LIMIT 1',(run,))
                if c.fetchone()!=head:raise ValueError('SOURCE_CHANGED')
            conn.commit()
            m={'format':'orulo-audit-archive-v1','run_uuid':run,'head':{'kind':head[0],'sequence':head[1],'hash':head[2]},'columns':TABLES,'catalogSha256':digest(out/'catalog.json'),'files':files,'durableStatus':'NOT_PROVEN','restoreStatus':'NOT_PROVEN','removalEligible':False}
            data=(json.dumps(m,sort_keys=True,ensure_ascii=False)+'\n').encode()
            if (out/'manifest.json').exists() and (out/'manifest.json').read_bytes()!=data:raise ValueError('IMMUTABLE_MANIFEST_MISMATCH')
            atomic(out/'manifest.json',data);atomic(out/'manifest.sha256',(hashlib.sha256(data).hexdigest()+'\n').encode())
            return m
        except BaseException:
            conn.rollback();raise

def main():
    p=argparse.ArgumentParser();p.add_argument('--service',required=True);p.add_argument('--run',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    import psycopg2
    os.umask(0o077)
    # A libpq service resolves credentials without argv/log exposure.
    with psycopg2.connect(service=a.service,connect_timeout=15) as conn: export_run(conn,a.run,a.output)
    print('EXPORT_COMPLETE_LOCAL_ONLY; durable archive and restore still required')
if __name__=='__main__':
    try:main()
    except Exception:print('BLOCKED_EXPORT (details withheld)');raise SystemExit(1)
