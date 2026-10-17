const test=require("node:test"),assert=require("node:assert/strict");
const buyer=require("./buyer-profile.js"),quality=require("./quality-scoring.js");
const {options,reconcile,cli,client,Failure,compare,inList}=require("./scripts/projection-reconciliation.js");
const IDs=["a3f4e185-c0fe-41cf-aed3-d1bf06a82b1c","1dfe4c51-058d-4189-ba89-3819eb1ac560","ba669591-46cb-46af-a5e4-9bf07a379370"];
const v="11111111-1111-4111-8111-111111111111",v2="22222222-2222-4222-8222-222222222222",v3="33333333-3333-4333-8333-333333333333";
function row(id,name="property_view_multiple",visitor=v,at="2026-10-08T12:00:00.000Z"){
 return {event_id:id,event_name:name,visitor_id:visitor,event_time:at,created_at:"2026-10-08T12:00:00Z",session_id:"s-one",product:"ynteligencia",property_id:"p-one",property_name:"Property",declared_neighborhood:"",metadata:{}};
}
function filterValues(value){return JSON.parse("["+value.slice(4,-1)+"]");}
function store(events=[],ledger=[],scores=[]){
 const state={ads_events:events,buyer_profile_events:ledger,buyer_quality_scores:scores,writes:[],reads:[],fail:null,payloads:[]};
 state.request=async(table,params={},body)=>{
  if(body!==undefined){
   state.writes.push(table);
   if(table==="rpc/apply_buyer_profile_event"){
    const p=body.p_event;state.payloads.push(p);const found=state.buyer_profile_events.some(e=>e.event_id===p.event_id);
    if(!found)state.buyer_profile_events.push({event_id:p.event_id,visitor_id:p.visitor_id});
    if(state.fail){const f=state.fail;state.fail=null;throw f;}
    return {status:found?"already_applied":"applied"};
   }
   if(table==="rpc/recompute_buyer_quality_score"){
    const es=state.ads_events.filter(e=>e.visitor_id===body.p_visitor_id).sort(compare);
    const score={visitor_id:body.p_visitor_id,last_event_at:es.at(-1).event_time};
    state.buyer_quality_scores=state.buyer_quality_scores.filter(s=>s.visitor_id!==score.visitor_id).concat(score);
    if(state.fail){const f=state.fail;state.fail=null;throw f;}
    return {status:"ok",score};
   }
   throw Error("Unexpected write");
  }
  state.reads.push({table,params});
  let rows=[...state[table]];
  for(const [key,value]of Object.entries(params)){
   if(value.startsWith?.("in.(")){const list=filterValues(value);rows=rows.filter(e=>list.includes(e[key]));}
   if(value.startsWith?.("eq."))rows=rows.filter(e=>e[key]===value.slice(3));
   if(value.startsWith?.("lte."))rows=rows.filter(e=>Date.parse(e[key])<=Date.parse(value.slice(4)));
  }
  if(table==="ads_events")rows.sort(compare);
  else rows.sort((a,b)=>String(a.event_id||a.visitor_id).localeCompare(String(b.event_id||b.visitor_id)));
  if(params.order?.includes(".desc"))rows.reverse();
  // Simulate a server-side cap smaller than requested: pagination must continue to empty.
  rows=rows.slice(Number(params.offset||0),Number(params.offset||0)+Math.min(Number(params.limit||100),2));
  return rows.map(e=>({...e,test:e.metadata?.test}));
 };
 return state;
}
function opts(args=[],env={}){return options(args,env);}
const write={BUYER_PROFILE_RECONCILE:"1",BUYER_QUALITY_RECONCILE:"1"};
test("profile: the three real event IDs are missing-ledger fixtures, not a full backfill",async()=>{
 const s=store([...IDs.map(id=>row(id)),row("already","property_view"),row("ignored","high_intent_buyer")],[{event_id:"already",visitor_id:v}]);
 const r=await reconcile("profile",opts(),s.request);
 assert.equal(r.total_candidates,3);assert.deepEqual(r.by_event_name,{property_view_multiple:3});
 assert.equal(r.affected_visitors,1);assert.equal(r.planned,3);assert.equal(s.writes.length,0);
 assert.ok(s.reads.some(r=>r.params.event_name===inList([...buyer.PROFILE_EVENTS])));
});
test("profile: dry-run stays read-only with the write flag present",async()=>{
 const s=store([row(IDs[0])]);await reconcile("profile",opts([],write),s.request);assert.equal(s.writes.length,0);
});
test("profile: apply uses exact canonical payload, once; rerun has no candidates",async()=>{
 const event=row(IDs[0]);event.metadata={canonical_preference:{city:"São Paulo",state:"SP",purpose:"morar"},email:"secret@example.com",transcript:"secret"};
 const s=store([event]);const r=await reconcile("profile",opts(["--apply"],write),s.request);
 assert.equal(r.results.applied,1);assert.deepEqual(s.payloads,[buyer.toApplyPayload(event)]);
 const again=await reconcile("profile",opts(["--apply"],write),s.request);
 assert.equal(again.total_candidates,0);assert.equal(s.writes.length,1);
});
test("profile: deterministic time/id order, microseconds, timezone and bounded batches",async()=>{
 const es=[row("z","property_view",v,"2026-10-08T12:00:00.000002Z"),row("b","property_view",v,"2026-10-08T09:00:00.000001-03:00"),row("a","property_view",v,"2026-10-08T12:00:00.000001Z")];
 const s=store(es);const r=await reconcile("profile",opts(["--apply","--batch-size=1","--max-items=2"],write),s.request);
 assert.equal(r.total_candidates,3);assert.equal(r.processed,2);assert.deepEqual(s.payloads.map(p=>p.event_id),["a","b"]);
 assert.equal(r.first_batch_count,1);
});
test("profile: committed-but-timed-out RPC resumes safely without duplicate projection",async()=>{
 const s=store(IDs.map(id=>row(id)));s.fail=new Failure("timeout");
 const first=await reconcile("profile",opts(["--apply"],write),s.request);
 assert.equal(first.ok,false);assert.equal(first.failures[0].code,"timeout");assert.equal(s.writes.length,1);
 const second=await reconcile("profile",opts(["--apply"],write),s.request);
 assert.equal(second.total_candidates,2);assert.equal(s.buyer_profile_events.length,3);assert.equal(s.writes.length,3);
});
test("profile: item failure is non-success and cannot leak source values",async()=>{
 const s=store([row(IDs[0])]);const request=async(t,p,b)=>{if(b)throw Error("secret@example.com +5511999999999 transcript");return s.request(t,p,b);};
 const r=await reconcile("profile",opts(["--apply"],write),request);
 assert.equal(r.ok,false);assert.equal(r.failures[0].code,"unexpected_error");
 assert.doesNotMatch(JSON.stringify(r),/secret|5511|transcript|11111111-1111/);
});
test("profile: ledger conflict and unrepresentable source IDs fail closed",async()=>{
 const s=store([row("event")],[{event_id:"event",visitor_id:v2}]);
 await assert.rejects(reconcile("profile",opts(),s.request),e=>e.code==="ledger_identity_conflict");
 const long=store([row("x".repeat(81))]);const r=await reconcile("profile",opts(["--apply"],write),long.request);
 assert.equal(r.ok,false);assert.equal(long.writes.length,0);
});
test("quality: only central triggering events create candidates; no score for ad_entry alone",async()=>{
 const s=store([row("organic","ad_entry"),row("multiple","property_view_multiple"),row("handoff","agent_handoff_created"),
  row("view","property_view",v2),row("cta","specialist_cta_opened",v3)]);
 const r=await reconcile("quality",opts(),s.request);
 assert.equal(r.total_candidates,2);assert.equal(r.unmarked_candidates,2);assert.equal(s.writes.length,0);
 assert.ok(s.reads.some(r=>r.params.event_name===inList([...quality.QUALITY_RECOMPUTE_EVENTS])));
 assert.equal(r.visitors.every(v=>v.reason==="missing_score"),true);
});
test("quality: equal/newer score is current, old/null timestamps are stale",async()=>{
 const events=[row("one","property_view"),row("two","property_view",v2),row("three","specialist_cta_opened",v3)];
 for(const last of ["2026-10-08T12:00:00Z","2026-10-09T12:00:00Z"]){
  const s=store(events,[],[{visitor_id:v,last_event_at:last},{visitor_id:v2,last_event_at:"2026-10-07T00:00:00Z"},{visitor_id:v3,last_event_at:null}]);
  const r=await reconcile("quality",opts(),s.request);assert.equal(r.total_candidates,2);assert.equal(r.by_reason.stale_score,2);
 }
});
test("quality: dedup visitor, dry-run no writes, apply once, second run idempotent",async()=>{
 const s=store([row("one","property_view"),row("two","specialist_cta_opened")]);
 await reconcile("quality",opts([],write),s.request);assert.equal(s.writes.length,0);
 const r=await reconcile("quality",opts(["--apply"],write),s.request);assert.equal(r.results.recomputed,1);
 assert.equal(r.visitors[0].eligible_events,2);
 assert.equal((await reconcile("quality",opts(["--apply"],write),s.request)).total_candidates,0);
 assert.equal(s.writes.length,1);
});
test("quality: deterministic visitor order and max-items",async()=>{
 const s=store([row("two","property_view",v2),row("one","property_view")]);
 const r=await reconcile("quality",opts(["--apply","--batch-size=1","--max-items=1"],write),s.request);
 assert.equal(r.processed,1);assert.equal(s.buyer_quality_scores[0].visitor_id,v);
});
test("quality: test cohorts are separate, including older non-triggering identifiers",async()=>{
 const s=store([row("TEST-arrival","ad_entry"),row("one","property_view"),{...row("two","property_view",v2),metadata:{test:true}}]);
 const dry=await reconcile("quality",opts(),s.request);assert.equal(dry.total_candidates,2);assert.equal(dry.test_candidates,2);assert.equal(dry.planned,0);
 await reconcile("quality",opts(["--apply"],write),s.request);assert.equal(s.writes.length,0);
 const applied=await reconcile("quality",opts(["--apply","--include-test-data"],write),s.request);
 assert.equal(applied.results.recomputed,2);assert.equal(applied.test_data_policy,"include-explicitly");
});
test("quality: timeout after commit is detected as current on safe resume",async()=>{
 const s=store([row("one","property_view")]);s.fail=new Failure("timeout");
 assert.equal((await reconcile("quality",opts(["--apply"],write),s.request)).ok,false);
 assert.equal((await reconcile("quality",opts(["--apply"],write),s.request)).total_candidates,0);
 assert.equal(s.writes.length,1);
});
test("write gates, limits and read-only report fail closed before any storage write",async()=>{
 for(const kind of ["profile","quality"])await assert.rejects(reconcile(kind,opts(["--apply"]),()=>{throw Error("must not call");}),e=>e.code==="write_gate_closed");
 for(const arg of ["--max-items=0","--batch-size=999","--scan-limit=100001","--unknown","--timeout-ms=0"])assert.throws(()=>opts([arg]));
 const logs=[];assert.equal(await cli("report",["--apply"],write,x=>logs.push(x)),1);assert.match(logs[0],/read_only_report/);
});
test("scan limit aborts before writes, even with a server cap smaller than requested",async()=>{
 const s=store(IDs.map(id=>row(id)));await assert.rejects(reconcile("profile",opts(["--apply","--scan-limit=2"],write),s.request),e=>e.code==="scan_limit_exceeded");
 assert.equal(s.writes.length,0);
});
test("live ledger/score recheck avoids work another process completed after discovery",async()=>{
 const s=store([row("one","property_view")]);let reads=0;
 const request=async(t,p,b)=>{if(t==="buyer_profile_events"&&++reads===2)s.buyer_profile_events.push({event_id:"one",visitor_id:v});return s.request(t,p,b);};
 // Directly simulate a new ledger observation when apply rechecks.
 const q=store([row("one","property_view")]);let qualityReads=0;
 const qr=async(t,p,b)=>{if(t==="buyer_quality_scores"&&++qualityReads===2)q.buyer_quality_scores.push({visitor_id:v,last_event_at:"2026-10-09T00:00:00Z"});return q.request(t,p,b);};
 const result=await reconcile("quality",opts(["--apply"],write),qr);assert.equal(result.results.already_current,1);assert.equal(q.writes.length,0);
 // An empty discovery lookup terminates immediately; the second is the apply recheck.
 const pr=await reconcile("profile",opts(["--apply"],write),request);assert.equal(pr.results.already_current,1);assert.equal(s.writes.length,0);
});
test("HTTP errors never expose response body, query, credentials or upstream exception text",async()=>{
 const prior=global.fetch;const secret="secret@example.com";
 try{
  global.fetch=async()=>({ok:false,status:503,json:async()=>({error:secret})});
  const req=client({SUPABASE_URL:"https://example.test",SUPABASE_SERVICE_ROLE_KEY:secret},100);
  await assert.rejects(req("ads_events"),e=>e.code==="http_error"&&e.status===503&&!e.message.includes(secret));
  global.fetch=async()=>{const e=Error(secret);e.name="TimeoutError";throw e;};
  await assert.rejects(req("ads_events"),e=>e.code==="timeout"&&!e.message.includes(secret));
 }finally{global.fetch=prior;}
});
test("read-only report CLI uses the same selectors and never calls a mutation",async()=>{
 const prior=global.fetch,s=store([row("one","property_view"),{...row("two","specialist_cta_opened",v2),metadata:{test:true,email:"secret@example.com"}}]);
 const logs=[];
 try{
  global.fetch=async(url,init)=>{
   const parsed=new URL(url),table=parsed.pathname.replace("/rest/v1/","");
   const data=await s.request(table,Object.fromEntries(parsed.searchParams),init.body?JSON.parse(init.body):undefined);
   return {ok:true,status:200,json:async()=>data};
  };
  const code=await cli("report",[],{SUPABASE_URL:"https://unit.invalid",SUPABASE_SERVICE_ROLE_KEY:"secret@example.com"},x=>logs.push(x));
  assert.equal(code,0);assert.equal(logs.length,2);assert.equal(s.writes.length,0);
  assert.doesNotMatch(logs.join("\n"),/secret@example|transcript|lead_summary|11111111-1111/);
  const reports=logs.map(JSON.parse);assert.equal(reports[1].test_candidates,1);
 }finally{global.fetch=prior;}
});
test("a successful HTTP response carrying a rejected scoring RPC is still a failed run",async()=>{
 const s=store([row("one","property_view")]);
 const request=async(t,p,b)=>b?{status:"rejected",error:"secret@example.com"}:s.request(t,p,b);
 const r=await reconcile("quality",opts(["--apply"],write),request);
 assert.equal(r.ok,false);assert.equal(r.failures[0].code,"quality_rpc_rejected_or_stale");
 assert.doesNotMatch(JSON.stringify(r),/secret@example/);
});
