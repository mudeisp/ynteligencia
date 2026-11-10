#!/usr/bin/env python3
"""Offline regression test: V2 2,667-building partition into 500-building checkpoints."""
import json, pathlib, subprocess, sys, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
    d=pathlib.Path(td)
    q=d/'queue.json'
    q.write_text(json.dumps({'version':1,'logicalBatchId':'orulo-national-v2','writeAuthorized':False,
      'buildings':[{'buildingId':str(i)} for i in range(1,2668)]}))
    observed=[]
    for i in range(6):
        out=d/f'chunk-{i}.json'
        p=subprocess.run([sys.executable,str(ROOT/'scripts/orulo-v2-source-chunk.py'),
           '--queue',str(q),'--index',str(i),'--size','500','--output',str(out)],
           capture_output=True,text=True)
        assert p.returncode==0,(i,p.stderr,p.stdout)
        c=json.loads(out.read_text())
        ids=[x['buildingId'] for x in c['buildings']]
        assert len(ids)==(167 if i==5 else 500)
        assert c['writeAuthorized'] is False
        observed.extend(ids)
    assert observed==[str(i) for i in range(1,2668)]
    assert len(set(observed))==2667
    for invalid in ['6','-1']:
        p=subprocess.run([sys.executable,str(ROOT/'scripts/orulo-v2-source-chunk.py'),
          '--queue',str(q),'--index',invalid,'--size','500','--output',str(d/'invalid.json')],
          capture_output=True,text=True)
        assert p.returncode!=0
print('V2_CHUNK_PARTITION_TEST=PASS; CHUNKS=6; BUILDINGS=2667; PRODUCTION_WRITES=0')
