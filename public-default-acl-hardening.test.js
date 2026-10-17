// Dedicated local PostgreSQL cluster only. Connections select identities via -U, never role switching.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const host=process.env.DEFAULT_ACL_TEST_HOST||"127.0.0.1";
const port=process.env.DEFAULT_ACL_TEST_PORT||"55433";
const bin=process.env.DEFAULT_ACL_TEST_PSQL||"psql";
const bootstrap=process.env.DEFAULT_ACL_BOOTSTRAP_USER||"local_fixture_admin";
const db=`default_acl_operations_test_${process.pid}`;
const migration="supabase/migrations/20261017113121_public_table_default_acl_hardening.sql";
const admin="supabase_admin",apps=["anon","authenticated","service_role","acl_public_probe"];
let created=false,objects,sf,platform,roles,externalDefaults;
function run(sql,user="postgres",database=db){
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k)||k==="PGPASSWORD")),PGCLIENTENCODING:"UTF8"};
 return execFileSync(bin,["-X","-w","-h",host,"-p",port,"-U",user,"-d",database,
  "-v","ON_ERROR_STOP=1","-qAt","-f","-"],{input:sql,encoding:"utf8",env,maxBuffer:20*1024*1024,
  stdio:["pipe","pipe","pipe"]});
}
function psql(sql,user="postgres",database=db){return run(sql,user,database).toString().trim();}
function capture(sql,user="postgres"){
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k)||k==="PGPASSWORD")),PGCLIENTENCODING:"UTF8"};
 const out=require("node:child_process").spawnSync(bin,["-X","-w","-h",host,"-p",port,"-U",user,"-d",db,
 "-v","ON_ERROR_STOP=1","-qAt","-f","-"],{input:sql,encoding:"utf8",env,maxBuffer:20*1024*1024});
 assert.equal(out.status,0,out.stderr);return out;
}
function source(f){return fs.readFileSync(path.join(__dirname,f),"utf8");}
function file(f,user="postgres"){return psql(source(f),user);}
function defaults(where="true"){return psql(`select coalesce(jsonb_agg(jsonb_build_array(defaclrole,defaclnamespace,defaclobjtype,defaclacl::text) order by defaclrole,defaclnamespace,defaclobjtype),'[]') from pg_default_acl where ${where}`);}
function roleSnapshot(){return psql(`select jsonb_build_object(
 'roles',(select jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolbypassrls,rolcanlogin) order by rolname) from pg_roles),
 'members',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m))`);}
function objectSnapshot(){return psql(`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','acl_other') and c.relname not like 'future_%'),
 'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n where n.nspname in ('public','acl_other')),
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from information_schema.columns c where table_schema='public' and table_name not like 'future_%'),
 'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl::text,p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'indexes',(select jsonb_agg(to_jsonb(i) order by indexname) from pg_indexes i where schemaname='public' and tablename not like 'future_%'),
 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by oid) from pg_constraint where connamespace='public'::regnamespace and conrelid not in(select oid from pg_class where relname like 'future_%')),
 'data',(select jsonb_agg(to_jsonb(t) order by id) from existing_table t))`);}
function future(name,user="postgres"){psql(`create table public.future_${name}(id integer primary key,note text);insert into public.future_${name} values(1,'fixture')`,user);}
function assertSecure(name){
 assert.equal(psql(`select count(*) from pg_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p where r.rolname in ('anon','authenticated','service_role','acl_public_probe') and has_table_privilege(r.oid,'public.future_${name}',p)`),"0");
 for(const role of apps)assert.throws(()=>psql(`select * from public.future_${name}`,role),e=>String(e.stderr).includes("permission denied"));
}
test.before(()=>{
 if(!["127.0.0.1","localhost","::1"].includes(host))throw Error("Local PostgreSQL required");
 assert.match(port,/^\d+$/);assert.notEqual(bootstrap,"postgres","Dedicated fixture superuser required");
 psql(`do $$ begin
 if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres login nosuperuser inherit createrole createdb bypassrls;end if;
 if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin login superuser inherit createrole createdb bypassrls;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon login;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated login;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role login bypassrls;end if;
 if not exists(select 1 from pg_roles where rolname='acl_public_probe') then create role acl_public_probe login;end if;
 end $$;`,bootstrap,"postgres");
 assert.equal(psql("select rolsuper from pg_roles where rolname='postgres'",bootstrap,"postgres"),"f","Fixture postgres must be non-superuser; do not alter a shared cluster");
 psql(`create database ${db} owner postgres`,bootstrap,"postgres");created=true;
 assert.ok(Number(psql("show server_version_num"))>=170000);
 psql("create schema acl_other; create table public.properties(id uuid primary key default gen_random_uuid(),external_id text unique,source text,title text,neighborhood text,city text,state text,price numeric,bedrooms integer,active boolean,raw_data jsonb)");
 for(const f of ["ads_events","ads_visitors_declared_split","ads_handoffs","buyer_profiles","google_ads_conversion_exports","ads_lead_identity","buyer_quality_scores","inventory_summary"])file(`supabase/${f}.sql`);
 for(const creator of ["postgres",admin])psql(`
 alter default privileges for role ${creator} in schema public grant select,insert,update,delete,truncate,references,trigger,maintain on tables to anon,authenticated,service_role;
 alter default privileges for role ${creator} in schema public grant select on tables to public;
 alter default privileges for role ${creator} in schema public grant usage,select on sequences to service_role;
 alter default privileges for role ${creator} in schema public grant execute on functions to service_role;`,creator);
 psql("alter default privileges for role postgres in schema acl_other grant select,truncate on tables to anon");
 psql("create table existing_table(id integer primary key,note text);insert into existing_table values(1,'sentinel');alter table existing_table enable row level security;create policy fixture_read on existing_table for select to anon using(true)");
 objects=objectSnapshot();sf=defaults("defaclobjtype in ('S','f')");platform=defaults("defaclrole='supabase_admin'::regrole");roles=roleSnapshot();
 externalDefaults=defaults("defaclnamespace='acl_other'::regnamespace or defaclnamespace=0");
});
test.after(()=>{if(created)psql(`drop database ${db}`,bootstrap,"postgres");});
test("read-only preflight proves scenario B under a real non-superuser connection",()=>{
 const data=JSON.parse(psql("select jsonb_build_object('current',current_user,'session',session_user,'role',current_role,'super',(select rolsuper from pg_roles where rolname=current_user),'usage',pg_has_role(current_user,'supabase_admin','USAGE'),'set',pg_has_role(current_user,'supabase_admin','SET'))"));
 assert.deepEqual(data,{current:"postgres",session:"postgres",role:"postgres",super:false,usage:false,set:false});
 const out=file("scripts/public-default-acl-preflight.sql");assert.match(out,/supabase_admin\|t\|f\|f\|f/);
});
test("original two-creator design reproduces permission denied and rolls back postgres changes",()=>{
 const before=defaults();
 assert.throws(()=>psql(`begin;alter default privileges for role postgres in schema public revoke select,insert,update,delete,truncate,references,trigger,maintain on tables from public,anon,authenticated,service_role;
 alter default privileges for role supabase_admin in schema public revoke select on tables from anon;commit;`),
 e=>String(e.stderr).includes("permission denied to change default privileges"));
 assert.equal(defaults(),before);
});
test("corrected project migration succeeds without admin authority and reports platform dependency",()=>{
 const result=capture(source(migration));
 assert.match(result.stderr,/supabase_admin_not_manageable/);
 assert.equal(defaults("defaclrole='supabase_admin'::regrole"),platform);
 assert.equal(objectSnapshot(),objects);assert.equal(roleSnapshot(),roles);
});
test("postgres future table is hardened for all application roles and PUBLIC",()=>{
 future("postgres");assertSecure("postgres");
 assert.equal(psql("select count(*) from pg_class c cross join lateral aclexplode(c.relacl)a where c.oid='future_postgres'::regclass and a.grantee=0"),"0");
});
test("supabase_admin future tables remain visibly unsafe until external platform action",()=>{
 future("admin",admin);
 assert.equal(psql("select has_table_privilege('anon','future_admin','TRUNCATE')"),"t");
 assert.equal(psql("select count(*) from future_admin","anon"),"1");
 const result=file("scripts/public-default-acl-verify.sql");
 assert.match(result,/supabase_admin_not_manageable/);assert.match(result,/PARTIAL_PLATFORM_ACTION_REQUIRED/);
 assert.doesNotMatch(result,/\|COMPLETE/);
 assert.equal(result.split(/\r?\n/).filter(l=>l.includes("|postgres|")&&l.includes("|project_hardened|")).length,4);
});
test("idempotency preserves both role hierarchies and the external creator ACLs",()=>{
 const before=defaults();capture(source(migration));assert.equal(defaults(),before);
 future("postgres_repeat");assertSecure("postgres_repeat");
 assert.equal(defaults("defaclrole='supabase_admin'::regrole"),platform);
 assert.equal(roleSnapshot(),roles);
});
test("sequence/function defaults, existing objects/data and other schemas remain identical",()=>{
 assert.equal(defaults("defaclobjtype in ('S','f')"),sf);
 assert.equal(defaults("defaclnamespace='acl_other'::regnamespace or defaclnamespace=0"),externalDefaults);
 assert.equal(objectSnapshot(),objects);
});
test("postgres unsafe global grant remains fail-closed and never edits global ACLs",()=>{
 psql("alter default privileges for role postgres grant select on tables to anon");
 const before=defaults();
 try{assert.throws(()=>file(migration),e=>String(e.stderr).includes("Unsafe global TABLE defaults"));assert.equal(defaults(),before);}
 finally{psql("alter default privileges for role postgres revoke select on tables from anon");}
});
test("unsafe supabase_admin globals are reported, not mutated or used to block project hardening",()=>{
 psql("alter default privileges for role supabase_admin grant select on tables to anon",admin);
 const before=defaults("defaclrole='supabase_admin'::regrole");
 try{capture(source(migration));assert.equal(defaults("defaclrole='supabase_admin'::regrole"),before);
 assert.match(file("scripts/public-default-acl-verify.sql"),/PARTIAL_PLATFORM_ACTION_REQUIRED/);}
 finally{psql("alter default privileges for role supabase_admin revoke select on tables from anon",admin);}
});
test("identity without postgres authority aborts with zero ACL or data changes",()=>{
 const before=defaults();
 assert.throws(()=>file(migration,"acl_public_probe"),e=>String(e.stderr).includes("postgres_not_manageable"));
 assert.equal(defaults(),before);assert.equal(objectSnapshot(),objects);
});
test("automatic SQL contains no admin mutation, role switching, privilege grants or escalation",()=>{
 const sql=source(migration).replace(/--[^\n]*/g,"");
 assert.doesNotMatch(sql,/\bGRANT\b|\bSET\s+ROLE\b|\bALTER\s+ROLE\b|SECURITY\s+DEFINER/i);
 assert.doesNotMatch(sql,/FOR\s+ROLE\s+supabase_admin/i);
 assert.doesNotMatch(sql,/ARRAY\['postgres','supabase_admin'\]\s+LOOP/);
 assert.equal(roleSnapshot(),roles);
});
test("authorized platform identity is still never used for automatic admin hardening",()=>{
 capture(source(migration),admin);
 assert.equal(defaults("defaclrole='supabase_admin'::regrole"),platform);
 assert.match(file("scripts/public-default-acl-verify.sql",admin),/supabase_admin_external_action_required/);
});
test("completion is only reported after catalog proves external defaults are already safe",()=>{
 // Explicit LOCAL fixture emulates a separately approved platform action.
 // This statement is never part of the automatic migration.
 psql("alter default privileges for role supabase_admin in schema public revoke select,insert,update,delete,truncate,references,trigger,maintain on tables from public,anon,authenticated,service_role",admin);
 const out=file("scripts/public-default-acl-verify.sql");
 assert.match(out,/platform_hardening_verified/);
 assert.equal(out.split(/\r?\n/).filter(l=>l.endsWith("|COMPLETE")).length,8);
 assert.doesNotMatch(out,/PARTIAL_PLATFORM_ACTION_REQUIRED/);
 assert.equal(objectSnapshot(),objects);assert.equal(roleSnapshot(),roles);
 assert.equal(defaults("defaclobjtype in ('S','f')"),sf);
});
