// Real local PostgreSQL RPCs + a read-only REST-query adapter, never Production.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const {options,reconcile}=require("./scripts/projection-reconciliation.js");
const {toApplyPayload}=require("./buyer-profile.js");
const bin=process.env.RECONCILE_TEST_PSQL||"psql",host=process.env.RECONCILE_TEST_HOST||"127.0.0.1",port=process.env.RECONCILE_TEST_PORT||"55433";
const user=process.env.RECONCILE_TEST_USER||"postgres";
if(!["127.0.0.1","localhost","::1"].includes(host))throw new Error("Disposable local PostgreSQL required");
const db=`projection_reconciliation_test_${process.pid}`;
const ids=["a3f4e185-c0fe-41cf-aed3-d1bf06a82b1c","1dfe4c51-058d-4189-ba89-3819eb1ac560","ba669591-46cb-46af-a5e4-9bf07a379370"];
const visitors=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
let created=false,writes=0,facts;
function psql(sql,database=db){
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k)||k==="PGPASSWORD")),PGCLIENTENCODING:"UTF8"};
 return execFileSync(bin,["-X","-w","-h",host,"-p",port,"-U",user,"-d",database,"-v","ON_ERROR_STOP=1","-qAt","-f","-"],
 {input:sql,encoding:"utf8",env,maxBuffer:20*1024*1024,stdio:["pipe","pipe","pipe"]}).trim();
}
function quote(v){return "'"+String(v).replace(/'/g,"''")+"'";}
function snapshot(){return psql("select coalesce(jsonb_agg(to_jsonb(e) order by event_id),'[]') from ads_events e");}
async function request(table,params={},body){
 if(body!==undefined){
  writes++;
  if(table==="rpc/apply_buyer_profile_event")return JSON.parse(psql(`select apply_buyer_profile_event(${quote(JSON.stringify(body.p_event))}::jsonb)`));
  if(table==="rpc/recompute_buyer_quality_score")return JSON.parse(psql(`select recompute_buyer_quality_score(${quote(body.p_visitor_id)})`));
  throw Error("Unexpected mutation");
 }
 assert.ok(["ads_events","buyer_profile_events","buyer_quality_scores"].includes(table));
 const conditions=[];
 for(const [k,v]of Object.entries(params)){
  if(["select","order","limit","offset"].includes(k))continue;
  assert.ok(["event_id","visitor_id","event_name","created_at"].includes(k));
  if(v.startsWith("in.("))conditions.push(k+" in ("+JSON.parse("["+v.slice(4,-1)+"]").map(quote).join(",")+")");
  else if(v.startsWith("eq."))conditions.push(k+"="+quote(v.slice(3)));
  else if(v.startsWith("lte."))conditions.push(k+"<="+quote(v.slice(4)));
  else throw Error("Unexpected predicate");
 }
 const select=params.select.replace("test:metadata->test","metadata->'test' as test");
 assert.match(select,/^[a-z_*,>' :\-]+$/);
 const order=params.order.split(",").map(s=>{assert.match(s,/^[a-z_]+\.(asc|desc)$/);return s.replace("."," ");}).join(",");
 assert.match(params.limit,/^[0-9]+$/);assert.match(params.offset,/^[0-9]+$/);
 return JSON.parse(psql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select ${select} from ${table}
 ${conditions.length?"where "+conditions.join(" and "):""} order by ${order} limit ${params.limit} offset ${params.offset}) t`));
}
function insert(id,name,visitor,at){
 psql(`insert into ads_events(event_id,event_name,event_time,product,visitor_id,session_id,property_id,property_name,metadata)
 values(${quote(id)},${quote(name)},${quote(at)},'ynteligencia',${quote(visitor)},'session-one','p-one','Example','{}')`);
}
test.before(()=>{
 if(!["127.0.0.1","localhost","::1"].includes(host))throw Error("Local PostgreSQL required");
 assert.match(port,/^\d+$/);
 psql(`create database ${db}`,"postgres");created=true;
 for(const f of ["ads_events","buyer_profiles","google_ads_conversion_exports","ads_lead_identity","buyer_quality_scores"])
  psql(fs.readFileSync(path.join(__dirname,"supabase",f+".sql"),"utf8"));
 visitors.forEach((v,i)=>{
  insert("seed-"+i,"property_view",v,"2026-10-08T10:00:00Z");
  const row=JSON.parse(psql(`select to_jsonb(e) from ads_events e where event_id='seed-${i}'`));
  psql(`select apply_buyer_profile_event(${quote(JSON.stringify(toApplyPayload(row)))}::jsonb)`);
  insert(ids[i],"property_view_multiple",v,"2026-10-08T12:00:00Z");
  psql(`select recompute_buyer_quality_score(${quote(v)})`);
 });
 facts=snapshot();
});
test.after(()=>{if(created)psql(`drop database ${db}`,"postgres");});
const env={BUYER_PROFILE_RECONCILE:"1",BUYER_QUALITY_RECONCILE:"1"};
test("real PostgreSQL: exactly the three missing derived events, profiles and scores already exist",async()=>{
 const r=await reconcile("profile",options([],env),request);
 assert.equal(r.total_candidates,3);assert.equal(r.by_event_name.property_view_multiple,3);assert.equal(writes,0);
 const q=await reconcile("quality",options([],env),request);assert.equal(q.total_candidates,0);
 assert.equal(psql("select count(*) from buyer_profiles"),"3");assert.equal(psql("select count(*) from buyer_quality_scores"),"3");
 assert.equal(snapshot(),facts);
});
test("real PostgreSQL: bounded apply, second batch, idempotent rerun, immutable facts",async()=>{
 const first=await reconcile("profile",options(["--apply","--batch-size=1","--max-items=2"],env),request);assert.equal(first.processed,2);
 const second=await reconcile("profile",options(["--apply"],env),request);assert.equal(second.processed,1);
 const third=await reconcile("profile",options(["--apply"],env),request);assert.equal(third.total_candidates,0);
 assert.equal(writes,3);assert.equal(psql("select count(*) from buyer_profile_events"),"6");
 assert.equal(psql("select count(*) from buyer_profiles where stage='engaged'"),"3");assert.equal(snapshot(),facts);
});
test("real PostgreSQL: missing and stale quality scores recompute, but ad_entry alone does not",async()=>{
 const a="44444444-4444-4444-8444-444444444444",b="55555555-5555-4555-8555-555555555555",c="66666666-6666-4666-8666-666666666666";
 insert("organic","ad_entry",a,"2026-10-09T10:00:00Z");
 insert("new-view","property_view",b,"2026-10-09T10:00:00Z");
 insert("specialist","specialist_cta_opened",c,"2026-10-09T10:00:00Z");
 insert("newer-view","property_view",visitors[0],"2026-10-10T10:00:00Z");
 const before=snapshot(),calls=writes;
 const dry=await reconcile("quality",options([],env),request);
 assert.equal(dry.total_candidates,3);assert.equal(dry.by_reason.missing_score,2);assert.equal(dry.by_reason.stale_score,1);assert.equal(writes,calls);
 const applied=await reconcile("quality",options(["--apply","--batch-size=2"],env),request);assert.equal(applied.results.recomputed,3);
 assert.equal((await reconcile("quality",options(["--apply"],env),request)).total_candidates,0);
 assert.equal(psql(`select count(*) from buyer_quality_scores where visitor_id=${quote(a)}`),"0");
 assert.equal(snapshot(),before);
});
