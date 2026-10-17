// Real PostgreSQL, disposable local database only. No project/database network defaults.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const db = `permission_hardening_test_${process.pid}`;
const host = process.env.PERMISSION_TEST_HOST || "127.0.0.1";
const port = process.env.PERMISSION_TEST_PORT || "55432";
const bin = process.env.PERMISSION_TEST_PSQL || "psql";
const root = __dirname;
const migration = path.join(root,"supabase/migrations/20261017101030_database_permission_hardening.sql");
const tables = ["ads_events","ads_visitors","ads_handoffs","buyer_profiles","buyer_profile_events",
 "buyer_profile_properties","buyer_profile_sessions","buyer_quality_scores",
 "google_ads_conversion_exports","leads","events","behavior_events","properties"];
const allowed = [
 ["SELECT","INSERT"],["SELECT","INSERT","UPDATE"],["SELECT","INSERT","UPDATE"],
 ["SELECT","INSERT","UPDATE"],["SELECT","INSERT"],["SELECT","INSERT","UPDATE"],
 ["SELECT","INSERT"],["SELECT","INSERT","UPDATE"],["SELECT","INSERT","UPDATE"],
 ["SELECT","INSERT"],["SELECT","INSERT"],["SELECT","INSERT"],["SELECT","INSERT","UPDATE"]
];
let created = false, beforeRows, beforeStructure, beforeLegacy;
function psql(sql, database=db) {
 return execFileSync(bin,["-X","-w","-h",host,"-p",port,"-U","postgres","-d",database,
  "-v","ON_ERROR_STOP=1","-qAt","-f","-"],{input:sql,encoding:"utf8",maxBuffer:20*1024*1024,
  env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)||key==='PGPASSWORD')),PGCLIENTENCODING:'UTF8'},
  stdio:["pipe","pipe","pipe"]}).trim();
}
function file(name) { return psql(fs.readFileSync(path.join(root,name),"utf8")); }
function rows() {
 return tables.map(t=>psql(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${t} t`));
}
function structure() {
 return psql(`select jsonb_build_object(
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from information_schema.columns c where table_schema='public'),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'rls',(select jsonb_agg(jsonb_build_array(relname,relrowsecurity,relforcerowsecurity) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),
 'indexes',(select jsonb_agg(to_jsonb(i) order by indexname) from pg_indexes i where schemaname='public'),
 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) from pg_constraint where connamespace='public'::regnamespace),
 'functions',(select jsonb_agg(jsonb_build_array(proname,pg_get_functiondef(oid),proacl::text,proconfig) order by oid) from pg_proc where pronamespace='public'::regnamespace),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where not tgisinternal),
 'default_acl',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d))`);
}
function legacyDml() {
 return ["anon","authenticated"].flatMap(role=>tables.slice(9).map(t=>
  ["SELECT","INSERT","UPDATE","DELETE"].map(p=>psql(`select has_table_privilege('${role}','public.${t}','${p}')`))));
}
function denied(sql) {
 assert.throws(()=>psql(sql),e=>String(e.stderr).includes("permission denied"));
}
test.before(()=>{
 if (!["127.0.0.1","localhost","::1"].includes(host)) throw Error("Local PostgreSQL required");
 assert.match(port,/^\d+$/);
 psql(`create database ${db}`,"postgres"); created=true;
 psql(`do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 if not exists(select 1 from pg_roles where rolname='permission_public_probe') then create role permission_public_probe nologin; end if;
 end $$;
 grant usage on schema public to public;
 create table public.properties(id uuid primary key default gen_random_uuid(),external_id text unique,source text,title text,neighborhood text,city text default 'São Paulo',state text default 'SP',price numeric,bedrooms integer,active boolean default true,raw_data jsonb);
 create table public.leads(id uuid primary key default gen_random_uuid(),payload jsonb);
 create table public.events(id uuid primary key default gen_random_uuid(),payload jsonb);
 create table public.behavior_events(id uuid primary key default gen_random_uuid(),payload jsonb);
 alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;`);
 for(const f of ["ads_events","ads_visitors_declared_split","ads_handoffs","buyer_profiles",
  "google_ads_conversion_exports","ads_lead_identity","buyer_quality_scores","inventory_summary"]) file(`supabase/${f}.sql`);
 for(const t of tables) psql(`alter table public.${t} enable row level security; grant all on public.${t} to anon,authenticated,service_role`);
 psql(`grant all on public.ads_handoffs to public;
 create policy permission_fixture_events_insert on public.events for insert to anon with check(true);
 create policy permission_fixture_properties_read on public.properties for select to anon using(active=true);
 insert into public.properties(external_id,source,title,neighborhood,price,bedrooms) values ('fixture:one','usados','Fixture','Pinheiros',400000,2);
 insert into public.leads(payload) values ('{"fixture":true}');
 insert into public.events(payload) values ('{"fixture":true}');
 insert into public.behavior_events(payload) values ('{"fixture":true}');
 insert into public.ads_events(event_id,event_name,event_time,product,visitor_id,session_id,property_id) values ('fixture-view','property_view','2026-10-17T10:00:00Z','ynteligencia','11111111-1111-4111-8111-111111111111','fixture-session','fixture:one');
 insert into public.ads_visitors(visitor_id,first_seen,last_seen) values('11111111-1111-4111-8111-111111111111',now(),now());
 insert into public.ads_handoffs(handoff_id,visitor_id,session_id,source_product,target_product,context,expires_at) values('fixture-token','11111111-1111-4111-8111-111111111111','fixture-session','ynteligencia','agente_yincorp','{}',now()+interval '15 minutes');
 select public.apply_buyer_profile_event('{"event_id":"fixture-view","event_name":"property_view","event_time":"2026-10-17T10:00:00Z","visitor_id":"11111111-1111-4111-8111-111111111111","session_id":"fixture-session","property_id":"fixture:one"}');
 select public.recompute_buyer_quality_score('11111111-1111-4111-8111-111111111111');
 insert into public.google_ads_conversion_exports(event_id,conversion_name) values('fixture-export','Fixture');`);
 beforeRows=rows(); beforeStructure=structure(); beforeLegacy=legacyDml();
});
test.after(()=>{if(created) psql(`drop database ${db}`,"postgres");});

test("regression: excessive initial TRUNCATE exists and permission migration removes it",()=>{
 for(const role of ["anon","authenticated"]) assert.equal(psql(`select has_table_privilege('${role}','public.ads_events','TRUNCATE')`),"t");
 assert.match(file("scripts/database-permissions-preflight.sql"),/TRUNCATE/);
 file("supabase/migrations/20261017101030_database_permission_hardening.sql");
});
test("anon and authenticated cannot actually TRUNCATE any audited table",()=>{
 for(const role of ["anon","authenticated"]) for(const t of tables) denied(`set role ${role}; truncate public.${t}`);
});
test("PUBLIC has no table ACL and an unrelated role gains no access",()=>{
 assert.equal(psql(`select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a where c.relnamespace='public'::regnamespace and c.relname in (${tables.map(t=>"'"+t+"'").join(",")}) and a.grantee=0`),"0");
 for(const t of tables) for(const p of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"])
  assert.equal(psql(`select has_table_privilege('permission_public_probe','public.${t}','${p}')`),"f");
});
test("internal client privileges are absent, legacy DML and policies are preserved",()=>{
 for(const role of ["anon","authenticated"]) for(const t of tables.slice(0,9))
  for(const p of ["SELECT","INSERT","UPDATE","DELETE"]) assert.equal(psql(`select has_table_privilege('${role}','public.${t}','${p}')`),"f");
 assert.deepEqual(legacyDml(),beforeLegacy);
});
test("service_role has exactly runtime allowlisted DML and no administrative privileges",()=>{
 tables.forEach((t,i)=>{for(const p of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"])
  assert.equal(psql(`select has_table_privilege('service_role','public.${t}','${p}')`),allowed[i].includes(p)?"t":"f",t+" "+p);
 });
 for(const t of tables) denied(`set role service_role; truncate public.${t}`);
});
test("migration preserves every row and all columns/indexes/policies/triggers/RPC definitions/default ACLs",()=>{
 assert.deepEqual(rows(),beforeRows); assert.equal(structure(),beforeStructure);
 assert.equal(psql(`select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`),"0");
});
test("reapplying migration is idempotent without adding grants or changing data/schema",()=>{
 const acl=psql("select jsonb_agg(jsonb_build_array(relname,relacl::text) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'");
 file("supabase/migrations/20261017101030_database_permission_hardening.sql");
 assert.equal(psql("select jsonb_agg(jsonb_build_array(relname,relacl::text) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'"),acl);
 assert.deepEqual(rows(),beforeRows); assert.equal(structure(),beforeStructure);
});
test("all eight production RPC implementations still work as service_role",()=>{
 // Synthetic changes in a rollback-only local transaction; zero persistent fixture changes.
 const payload=JSON.stringify({event_id:"rpc-lead",event_name:"lead_created",event_time:"2026-10-17T11:00:00Z",product:"ynteligencia",visitor_id:"22222222-2222-4222-8222-222222222222",session_id:"rpc-session",property_id:"fixture:one",gclid:"fixture-click",conversion_gclid:"fixture-click",conversion_click_source:"current_session"});
 const out=psql(`begin; set local role service_role;
 select public.record_ads_lead('${payload}'::jsonb);
 select public.apply_buyer_profile_event('${payload}'::jsonb);
 select public.get_buyer_profile('22222222-2222-4222-8222-222222222222');
 select public.recompute_buyer_quality_score('22222222-2222-4222-8222-222222222222');
 select * from public.claim_google_lead_conversions(10,interval '15 minutes');
 select public.fail_google_lead_conversions(array['rpc-lead'],'fixture');
 select * from public.claim_google_lead_conversions(10,interval '15 minutes');
 select public.confirm_google_lead_conversions(array['rpc-lead']);
 select public.mia_inventory_summary_v1();
 rollback;`);
 assert.match(out,/rpc-lead/); assert.match(out,/"stage": "lead"/);
 assert.match(out,/"buyer_class": "lead"/); assert.match(out,/"complete": true/);
 assert.deepEqual(rows(),beforeRows);
});
test("verification query lists grantee/table_name/privilege_type including PUBLIC ACLs",()=>{
 const sql=fs.readFileSync(path.join(root,"scripts/database-permissions-report.sql"),"utf8");
 const output=psql(sql); assert.match(output,/service_role\|ads_events\|SELECT/);
 assert.doesNotMatch(output,/\|(TRUNCATE|TRIGGER|REFERENCES|MAINTAIN)(\r?\n|$)/);
});
test("inherited unsafe grant fails atomically instead of silently claiming success",()=>{
 psql("create role permission_unsafe_parent nologin; grant permission_unsafe_parent to anon; grant truncate on public.ads_events to permission_unsafe_parent");
 try {
  assert.throws(()=>file("supabase/migrations/20261017101030_database_permission_hardening.sql"),e=>String(e.stderr).includes("Administrative privilege remains"));
  assert.deepEqual(rows(),beforeRows);
 } finally {
  psql("revoke permission_unsafe_parent from anon; revoke truncate on public.ads_events from permission_unsafe_parent; drop role permission_unsafe_parent");
 }
});
test("missing required service_role privilege fails without compensating GRANT",()=>{
 psql("revoke select on public.properties from service_role; grant truncate on public.ads_events to anon");
 try {
  assert.throws(()=>file("supabase/migrations/20261017101030_database_permission_hardening.sql"),e=>String(e.stderr).includes("service_role differs from allowlist"));
  assert.equal(psql("select has_table_privilege('anon','public.ads_events','TRUNCATE')"),"t","earlier REVOKEs must roll back");
  assert.equal(psql("select has_table_privilege('service_role','public.properties','SELECT')"),"f","no compensating GRANT");
 }
 finally {psql("grant select on public.properties to service_role; revoke truncate on public.ads_events from anon");}
 assert.deepEqual(rows(),beforeRows);
});
