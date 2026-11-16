#!/usr/bin/env python3
"""Build a disposable PostgreSQL replica of ONE frozen Órulo audit run.

Never connects to production, accepts only an offline read-only SQL export and
the SHA-pinned historical manifest. No source data is printed or uploaded.
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

RUN = '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'
MANIFEST_SHA = 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288'
HEAD_SHA = 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
EXPECTED_DEFS = {
    'append': '8dd906e953df5cb09f7cf8e234763a18c5190c65f07bcd6664d46f5ece0f55d1',
    'columns_v2': '3aa4d73c7a7100a523c23507c836299bd90dee4dacfcf772f6084469b713cea3',
    'lock_run': '4bd74b5fafc13b0ba0ae57d7cf25e229e5865a0767db95c84334f4532e85297c',
    'require_service': '114a0f8c0d58c70969a7bf5f78e2dff2ab5d685e75ddca4fc9be1a3c1a081f29',
}
COL_TYPES = {
    'uuid', 'text', 'numeric', 'integer', 'boolean', 'jsonb',
    'timestamp with time zone', 'double precision', 'bigint', 'timestamp without time zone'
}

def require(condition, code):
    if not condition:
        raise ValueError(code)

def sha(s):
    return hashlib.sha256(s.encode('utf8')).hexdigest()

def quote(s):
    return "'" + s.replace("'", "''") + "'"

def prepare(snapshot_path, manifest_path, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_bytes = manifest_path.read_bytes()
    require(hashlib.sha256(manifest_bytes).hexdigest() == MANIFEST_SHA,
            'SNAPSHOT_MANIFEST_BYTES_DIVERGED')
    doc = json.loads(manifest_bytes)
    require(doc['operationUuid'] == RUN and doc['id'] == 'national-v2-once'
            and len(doc['targets']) == 5684, 'SNAPSHOT_DOCUMENT_IDENTITY_INVALID')
    cols = doc.get('columns')
    require(isinstance(cols, list) and len(cols) == 24, 'SNAPSHOT_COLUMN_SCOPE_INVALID')
    require(len({name for name, _ in cols}) == len(cols), 'SNAPSHOT_DUPLICATE_COLUMNS')
    for name, typ in cols:
        require(isinstance(name, str) and name.isidentifier()
                and typ in COL_TYPES, 'SNAPSHOT_COLUMN_TYPE_NOT_ALLOWED')

    run = None
    defs = {}
    previous = ''
    count = 0
    parts = 0
    targets = 0
    column_list = ('run_uuid','sequence','event_uuid','operation_uuid',
                   'kind','event','previous_hash','canonical','hash')
    csv_path = output_dir/'frozen-ledger.csv'
    with csv_path.open('w', newline='', encoding='utf8') as dest:
        writer = csv.writer(dest, lineterminator='\n')
        for line in snapshot_path.open('r', encoding='utf8'):
            if not line.strip():
                continue
            record = json.loads(line)
            kind = record['kind']
            item = record['row']
            if kind == 'run':
                require(run is None, 'SNAPSHOT_DUPLICATE_RUN')
                run = item
                continue
            if kind == 'definition':
                name = item['name']
                definition = item['definition']
                require(name in EXPECTED_DEFS and name not in defs,
                        'SNAPSHOT_UNKNOWN_DEFINITION')
                require(sha(definition) == EXPECTED_DEFS[name],
                        'SNAPSHOT_FUNCTION_ABI_DIVERGED')
                defs[name] = definition
                continue
            require(kind == 'entry', 'SNAPSHOT_UNKNOWN_ROW')
            count += 1
            require(item['run_uuid'] == RUN and item['sequence'] == count,
                    'SNAPSHOT_LEDGER_GAP')
            require(item['previous_hash'] == previous,
                    'SNAPSHOT_LEDGER_CHAIN_BROKEN')
            canonical = item['canonical']
            require(sha(canonical) == item['hash'],
                    'SNAPSHOT_CANONICAL_SHA_DIVERGED')
            parsed = json.loads(canonical)
            require(parsed['runUuid'] == RUN and parsed['sequence'] == count
                    and parsed['previousHash'] == previous
                    and parsed['event'] == item['event'], 'SNAPSHOT_CANONICAL_DRIFT')
            require(item['event_uuid'] == item['event']['eventUuid'],
                    'SNAPSHOT_EVENT_UUID_DIVERGED')
            if count == 1:
                require(item['kind'] == 'START' and
                        item['event']['manifestHash'] == MANIFEST_SHA,
                        'SNAPSHOT_START_DIVERGED')
            elif count <= 556:
                require(item['kind'] == 'NATIONAL_MANIFEST_PART'
                        and item['event']['part'] == count-2,
                        'SNAPSHOT_PART_DIVERGED')
                parts += 1
            else:
                require(item['kind'] == 'NATIONAL_TARGET',
                        'SNAPSHOT_TARGET_DIVERGED')
                targets += 1
            previous = item['hash']
            writer.writerow([
                json.dumps(item[c], ensure_ascii=False, separators=(',', ':'))
                if c == 'event' else ('' if item.get(c) is None else item[c])
                for c in column_list
            ])
    require(run is not None and run['run_uuid'] == RUN
            and run['github_run_id'] == '43003536521'
            and run['metadata']['manifestHash'] == MANIFEST_SHA
            and run['metadata']['workflowSha'] == 'e660a30cd78a56b1fea4beff3daa0b8c4a032a35',
            'SNAPSHOT_RUN_METADATA_DIVERGED')
    require(count == 6240 and parts == 555 and targets == 5684
            and previous == HEAD_SHA, 'SNAPSHOT_HEAD_DIVERGED')
    require(set(defs) == set(EXPECTED_DEFS), 'SNAPSHOT_FUNCTION_DEFINITION_MISSING')
    schema = [
        'CREATE ROLE anon NOLOGIN;',
        'CREATE ROLE authenticated NOLOGIN;',
        'CREATE ROLE service_role NOLOGIN;',
        'CREATE ROLE orulo_audit_owner NOLOGIN;',
        'CREATE SCHEMA orulo_audit AUTHORIZATION orulo_audit_owner;',
        'GRANT USAGE ON SCHEMA orulo_audit TO service_role;',
        'CREATE TABLE orulo_audit.runs (run_uuid uuid PRIMARY KEY,'
            ' github_run_id text NOT NULL,metadata jsonb NOT NULL);',
        'CREATE TABLE orulo_audit.entries ('
          'run_uuid uuid NOT NULL REFERENCES orulo_audit.runs(run_uuid),'
          'sequence bigint NOT NULL,event_uuid uuid NOT NULL,operation_uuid uuid,'
          'kind text NOT NULL,event jsonb NOT NULL,previous_hash text NOT NULL,'
          'canonical text NOT NULL,hash text NOT NULL,'
          'PRIMARY KEY(run_uuid,sequence));',
        'ALTER TABLE orulo_audit.runs OWNER TO orulo_audit_owner;',
        'ALTER TABLE orulo_audit.entries OWNER TO orulo_audit_owner;',
        'GRANT SELECT ON orulo_audit.entries TO service_role;',
        'CREATE TABLE public.properties (' + ', '.join(
           '"' + name + '" ' + typ for name,typ in cols) + ');',
        'GRANT SELECT ON public.properties TO orulo_audit_owner;',
        'INSERT INTO orulo_audit.runs(run_uuid,github_run_id,metadata) VALUES('
           + quote(RUN) + ',' + quote(run['github_run_id']) + ','
           + quote(json.dumps(run['metadata'], ensure_ascii=False)) + '::jsonb);'
    ]
    (output_dir/'setup.sql').write_text('\n'.join(schema)+'\n',encoding='utf8')
    (output_dir/'historical-definitions.sql').write_text(
       '\n'.join(defs[n].rstrip(';')+';' for n in EXPECTED_DEFS)+'\n',encoding='utf8')
    (output_dir/'load-ledger.sql').write_text(
        r"\copy orulo_audit.entries(run_uuid,sequence,event_uuid,operation_uuid,kind,event,previous_hash,canonical,hash) FROM '" +
        str(csv_path).replace("'", "''") + "' WITH (FORMAT CSV, NULL '', FORCE_NOT_NULL (previous_hash));\n",
        encoding='utf8'
    )
    # One short receipt; never print the original evidence, URLs, or private metadata.
    print(json.dumps({'status':'REAL_SNAPSHOT_INPUT_VERIFIED',
       'originalManifestSha256': MANIFEST_SHA,'head':6240,
       'fragments':parts,'targets':targets,'historicalFunctionDefinitions':len(defs)}))

if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('SNAPSHOT_USAGE')
        prepare(Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]))
    except Exception as exc:
        # Do not expose original data in exception messages.
        code = str(exc)
        print(json.dumps({'status':'REAL_SNAPSHOT_REJECTED',
            'reason':code if code.startswith('SNAPSHOT_') else 'SNAPSHOT_INVALID_DATA'}),
            file=sys.stderr)
        sys.exit(1)
