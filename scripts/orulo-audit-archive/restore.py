#!/usr/bin/env python3
"""Restore evidence ONLY into a disposable local PostgreSQL container."""
import argparse, hashlib, json, subprocess
from pathlib import Path
from model import TABLES, ORDER, ddl
from verify import verify, sha_file

def restore(directory, container):
    import psycopg2
    # No remote URI/DSN is accepted. Only a local docker container bearing our label.
    meta=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
    if meta['Config'].get('Labels',{}).get('orulo.archive.isolated')!='true':raise ValueError('NOT_ISOLATED')
    ports=meta['NetworkSettings']['Ports']['5432/tcp']
    if not ports or any(x['HostIp']!='127.0.0.1' for x in ports):raise ValueError('NOT_LOOPBACK')
    verified=verify(directory);root=Path(directory)
    with psycopg2.connect(host='127.0.0.1',port=ports[0]['HostPort'],user='postgres',dbname='postgres',connect_timeout=10) as conn:
        with conn.cursor() as c:
            c.execute("SELECT count(*) FROM pg_namespace WHERE nspname='orulo_audit'")
            if c.fetchone()[0]:raise ValueError('TARGET_NOT_EMPTY')
            c.execute("SET LOCAL timezone='UTC'");c.execute(ddl())
            for t in TABLES:
                with (root/(t+'.jsonl')).open() as f:
                    for raw in f:c.execute(f'INSERT INTO orulo_audit.{t} SELECT * FROM json_populate_record(NULL::orulo_audit.{t},%s::json)',(raw,))
            for t in TABLES:
                scan=conn.cursor(name='restored_'+t)
                scan.execute(f'SELECT row_to_json(t)::text FROM orulo_audit.{t} t ORDER BY {ORDER[t]}')
                h=hashlib.sha256();n=0
                # Server-side cursor not needed for local fixture? Still fetch bounded batches.
                while True:
                    rows=scan.fetchmany(100)
                    if not rows:break
                    for (raw,) in rows:h.update(raw.encode()+b'\n');n+=1
                scan.close()
                expected=next(x for x in json.loads((root/'manifest.json').read_text())['files'] if x['file']==t+'.jsonl')
                if h.hexdigest()!=expected['sha256'] or n!=expected['rows']:raise ValueError('RESTORE_MISMATCH')
    if sha_file(root/'manifest.json')!=verified['manifestSha256']:raise ValueError('RESTORE_MANIFEST_CHANGED')
    return {'restoreVerified':True,'manifestSha256':sha_file(root/'manifest.json'),'run_uuid':verified['run_uuid'],'target':'isolated-local-docker','productionTouched':False}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('--container',required=True);a=p.parse_args()
    try:print(json.dumps(restore(a.directory,a.container)))
    except Exception:print('BLOCKED_RESTORE (details withheld)');raise SystemExit(1)
