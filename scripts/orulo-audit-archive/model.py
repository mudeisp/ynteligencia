"""Pinned typed archive contract. No production writes."""
TABLES = {
    'runs': [('run_uuid','uuid'),('github_run_id','text'),('metadata','jsonb'),('created_at','timestamp with time zone')],
    'entries': [('run_uuid','uuid'),('sequence','bigint'),('event_uuid','uuid'),('operation_uuid','uuid'),('kind','text'),('event','jsonb'),('previous_hash','text'),('canonical','text'),('hash','text'),('created_xid','xid8'),('created_at','timestamp with time zone')],
    'snapshot_sets': [('run_uuid','uuid'),('kind','text'),('keys','uuid[]'),('columns','jsonb'),('begin_sequence','bigint')],
    'snapshot_records': [('run_uuid','uuid'),('kind','text'),('id','uuid'),('record','jsonb'),('page_sequence','bigint')],
}
ORDER = {'runs':'run_uuid','entries':'sequence','snapshot_sets':'kind','snapshot_records':'kind,id'}
CONSTRAINTS = {
 'runs':['PRIMARY KEY (run_uuid)','UNIQUE (github_run_id)'],
 'entries':['PRIMARY KEY (run_uuid,sequence)','UNIQUE (event_uuid)','FOREIGN KEY (run_uuid) REFERENCES orulo_audit.runs(run_uuid)',"CHECK (sequence>0)","CHECK (hash=encode(sha256(convert_to(canonical,'UTF8')),'hex'))"],
 'snapshot_sets':['PRIMARY KEY (run_uuid,kind)','FOREIGN KEY (run_uuid) REFERENCES orulo_audit.runs(run_uuid)'],
 'snapshot_records':['PRIMARY KEY (run_uuid,kind,id)','FOREIGN KEY (run_uuid,kind) REFERENCES orulo_audit.snapshot_sets(run_uuid,kind)','FOREIGN KEY (run_uuid,page_sequence) REFERENCES orulo_audit.entries(run_uuid,sequence)']}

def ddl():
    statements=['CREATE SCHEMA orulo_audit']
    for table,cols in TABLES.items():
        fields=[f'"{n}" {t}'+('' if n=='operation_uuid' else ' NOT NULL') for n,t in cols]
        statements.append(f'CREATE TABLE orulo_audit.{table} ('+', '.join(fields+CONSTRAINTS[table])+')')
    return ';\n'.join(statements)+';\n'
