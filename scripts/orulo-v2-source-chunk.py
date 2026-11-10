#!/usr/bin/env python3
"""V2 source queue partitioning. No production writes. Frozen manifest unchanged."""
import argparse, hashlib, json
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--queue',required=True)
p.add_argument('--index',required=True,type=int)
p.add_argument('--size',type=int,default=500)
p.add_argument('--output',required=True)
a=p.parse_args()
if not (0<=a.index<6 and a.size==500): raise SystemExit('INVALID_CHUNK')
q=json.loads(Path(a.queue).read_bytes())
if q.get('writeAuthorized') is not False or len(q['buildings'])!=2667: raise SystemExit('FROZEN_V2_QUEUE_MISMATCH')
ids=[str(b['buildingId']) for b in q['buildings']]
if len(ids)!=len(set(ids)): raise SystemExit('DUPLICATE_BUILDING_ID')
chunk=q.copy()
chunk['buildings']=q['buildings'][a.index*a.size:(a.index+1)*a.size]
if not chunk['buildings']: raise SystemExit('EMPTY_CHUNK')
out=Path(a.output)
out.parent.mkdir(parents=True,exist_ok=True)
raw=(json.dumps(chunk,ensure_ascii=False,separators=(',',':'))+'\n').encode()
out.write_bytes(raw)
print('QUEUE_SHA256='+hashlib.sha256(raw).hexdigest())
print('CHUNK_BUILDINGS='+str(len(chunk['buildings'])))
