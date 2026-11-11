// Full frozen manifest registration/seal benchmark on local disposable PostgreSQL.
// No WRITE_AUTHORIZED is issued, even in this isolated database.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {executeNational,loadNationalManifest} from './orulo-media-recovery-national.mjs';
import {digest} from './orulo-media-recovery-postgres.mjs';
if(process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='orulo_national_manifest_test')throw Error('DISPOSABLE_MANIFEST_DATABASE_REQUIRED');
const bytes=readFileSync(process.argv[2]),manifest=loadNationalManifest(bytes,process.env.ORULO_NATIONAL_MANIFEST_SHA||digest(bytes));
const types=new Set(['uuid','text','numeric','integer','boolean','jsonb','timestamp with time zone','double precision']);
if(manifest.columns.some(([name,type])=>!/^[a-z_]+$/.test(name)||!types.has(type)))throw Error('UNSUPPORTED_CAPTURED_COLUMN');
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql','20261104114348_orulo_pilot_authorization.sql','20261104135027_orulo_pilot_indexed_targets.sql','20261104151850_orulo_manifest_batches.sql'];
const contract=JSON.parse(readFileSync(new URL('../test-support/orulo-cas/production-contract.json',import.meta.url),'utf8'));
const bootstrap=["do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;",
 'create table public.properties('+manifest.columns.map(([name,type])=>'"'+name+'" '+type+(name==='id'?' primary key':'')).join(',')+');',
 'alter table public.properties enable row level security;grant usage on schema public to service_role,anon,authenticated;',
 ...files.map(f=>readFileSync(new URL(f,dir),'utf8')),
 ...contract.functions.flatMap(f=>[f.definition+';','alter function '+f.signature+' owner to orulo_audit_owner;',...(f.schema==='orulo_audit'?['revoke all on function '+f.signature+' from public,anon,authenticated,service_role;']:[])]),
 readFileSync(new URL(readdirSync(dir).find(f=>f.endsWith('_orulo_national_v2_once.sql')),dir),'utf8')].join('\n');
execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:bootstrap,stdio:['pipe','pipe','pipe']});
const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
const pending=[];let errors='',calls=0;
child.stderr.on('data',b=>{errors=(errors+b).slice(-8000);});
createInterface({input:child.stdout}).on('line',line=>{
 const promise=pending.shift();if(!promise)return;
 try{promise.resolve(JSON.parse(line));}catch{promise.reject(Error('LOCAL_MANIFEST_RESPONSE_INVALID'));}
});
child.on('exit',code=>{for(const p of pending)p.reject(Error('LOCAL_MANIFEST_SQL_FAILED'));if(code)process.exitCode=1;});
const literal=value=>value==null?'null':"'"+String(value).replaceAll("'","''")+"'";
const control=(action,args={})=>new Promise((resolve,reject)=>{
 calls++;pending.push({resolve,reject});
 child.stdin.write("set role service_role; select public.orulo_audit_control("+[action,args.p_run,args.p_sequence,args.p_previous_hash,JSON.stringify(args.p_event||{})].map(literal).join(',')+"); reset role;\n");
});
let clock=0;const started=performance.now();
try{
 const result=await executeNational({env:{GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
 GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:process.env.GITHUB_RUN_ID||'1',
 GITHUB_WORKFLOW_SHA:process.env.GITHUB_SHA||'a'.repeat(40),ORULO_POSTGRES_AUDIT_READY:'true',ORULO_NATIONAL_READY:'true',
 ORULO_NATIONAL_APPROVED_SHA:process.env.GITHUB_SHA||'a'.repeat(40),ORULO_NATIONAL_MANIFEST_SHA:digest(bytes)},bytes,transport:{control},now:()=>clock,wait:async()=>{clock=600001;},verifyImages:()=>{throw Error('NO_LOCAL_CAS_ALLOWED');}});
 if(result.status!=='ADMIN_AUTHORIZATION_PENDING')throw Error('UNEXPECTED_MANIFEST_STAGE_RESULT');
 child.stdin.end();
 const query=statement=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8'}).trim();
 const report={status:'REAL_MANIFEST_REGISTERED_AND_SEALED_LOCALLY',manifestSha256:digest(bytes),manifestBytes:bytes.length,
  targets:manifest.targets.length,occurrences:manifest.stats.eligibleOccurrences,controlRpcCalls:calls,
  elapsedSeconds:Math.round((performance.now()-started)/100)/10,
  localLedgerBytes:Number(query("select pg_total_relation_size('orulo_audit.entries');")),
  writeAuthorized:Number(query("select count(*) from orulo_audit.entries where kind='WRITE_AUTHORIZED';")),
  propertyRows:Number(query('select count(*) from public.properties;')),productionWrites:0,
  note:'Local simulated manual-dispatch metadata; real frozen manifest; no property mutation or authorization.'};
 if(report.writeAuthorized!==0||report.propertyRows!==0)throw Error('LOCAL_STAGE_MUTATION_FORBIDDEN');
 writeFileSync(process.argv[3],JSON.stringify(report));console.log(JSON.stringify(report));
}catch(error){child.kill();throw Error('NATIONAL_MANIFEST_STAGE_FAILED');}
