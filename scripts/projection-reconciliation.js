// Operational reconciliation only. No online hooks, scheduled work, DDL or source writes.
const {createHash}=require("node:crypto");
const buyer=require("../buyer-profile.js");
const {QUALITY_RECOMPUTE_EVENTS}=require("../quality-scoring.js");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKERS="event_id,event_name,event_time,visitor_id,session_id,property_id,gclid,gbraid,wbraid,utm_campaign,test:metadata->test";
const PROFILE_COLUMNS="event_id,event_name,event_time,visitor_id";
class Failure extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
function ref(value){return createHash("sha256").update(String(value)).digest("hex").slice(0,16);}
function integer(value,fallback,max){if(value===undefined)return fallback;if(!/^[1-9][0-9]*$/.test(String(value))||Number(value)>max)throw new Failure("invalid_option");return Number(value);}
function options(argv=[],env=process.env){
 const values={};let apply=false,includeTests=false;
 for(const arg of argv){if(arg==="--apply")apply=true;else if(arg==="--include-test-data")includeTests=true;
 else{const m=/^--(batch-size|max-items|scan-limit|timeout-ms)=(.+)$/.exec(arg);if(!m||values[m[1]]!==undefined)throw new Failure("invalid_option");values[m[1]]=m[2];}}
 return {apply,includeTests,batchSize:integer(values["batch-size"],100,200),maxItems:integer(values["max-items"],100,1000),
 scanLimit:integer(values["scan-limit"],10000,100000),timeoutMs:integer(values["timeout-ms"],10000,60000),env};
}
function time(value){
 const ms=Date.parse(value);if(typeof value!=="string"||!Number.isFinite(ms))throw new Failure("invalid_timestamp");
 const fraction=(/[T ]\d{2}:\d{2}:\d{2}(?:\.(\d+))?/.exec(value)||[])[1]||"";
 if(fraction.length>6)throw new Failure("invalid_timestamp");
 return BigInt(ms)*1000n+BigInt(fraction.padEnd(6,"0").slice(3));
}
function compare(a,b){const x=time(a.event_time),y=time(b.event_time);return x<y?-1:x>y?1:String(a.event_id)<String(b.event_id)?-1:String(a.event_id)>String(b.event_id)?1:0;}
function inList(values){return "in.("+values.map(v=>'"'+String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"').join(",")+")";}
function groups(values){
 const out=[];let part=[];
 for(const value of values){const next=[...part,value];if(part.length&&(next.length>40||encodeURIComponent(inList(next)).length>3000)){out.push(part);part=[];}
 part.push(value);if(encodeURIComponent(inList(part)).length>3000)throw new Failure("identifier_too_long");}
 if(part.length)out.push(part);return out;
}
function looksSyntheticUuid(value){
 if(typeof value!=="string"||!UUID.test(value))return false;
 // Ignore fixed version/variant nibbles. Fixture generators can restart a motif per group.
 const segments=value.toLowerCase().split("-").map((part,i)=>i===2||i===3?part.slice(1):part);
 const counts=Array(16).fill(0);
 for(const digit of segments.join(""))counts[parseInt(digit,16)]++;
 const [a,b]=counts.map((count,digit)=>({count,digit:digit.toString(16)})).sort((x,y)=>y.count-x.count);
 if(a.count>=28)return true;
 if(a.count+b.count<28)return false;
 let matches=0;
 for(const part of segments){
  let forward=0,reverse=0;
  for(let i=0;i<part.length;i++){
   if(part[i]===(i%2?b.digit:a.digit))forward++;
   if(part[i]===(i%2?a.digit:b.digit))reverse++;
  }
  matches+=Math.max(forward,reverse);
 }
 return matches>=28; // At most two outliers across all 30 free nibbles.
}
function synthetic(row){
 const flag=row.test??row.metadata?.test;
 return String(flag).toLowerCase()==="true"||String(flag)==="1"||
 [row.visitor_id,row.session_id,row.event_id].some(looksSyntheticUuid)||
 /test|fixture|playwright|puppeteer|selenium|automation|qa[-_:]/i.test(
 [row.event_id,row.visitor_id,row.session_id,row.property_id,row.gclid,row.gbraid,row.wbraid,row.utm_campaign].join(" "));
}
function client(env,timeoutMs){
 const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
 let base;try{base=new URL(env.SUPABASE_URL);}catch{throw new Failure("supabase_not_configured");}
 if(!key||base.username||base.password||base.search||base.hash||
 (base.protocol!=="https:"&&!(base.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(base.hostname))))
  throw new Failure("supabase_not_configured");
 const root=base.href.replace(/\/$/,"")+"/rest/v1/";
 return async(table,params={},body)=>{
  const url=new URL(table,root);url.search=new URLSearchParams(params).toString();
  try{
   const response=await fetch(url,{method:body===undefined?"GET":"POST",redirect:"error",
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok)throw new Failure("http_error",response.status);
   try{return await response.json();}catch{throw new Failure("invalid_response");}
  }catch(error){if(error instanceof Failure)throw error;
   throw new Failure(error?.name==="TimeoutError"||error?.name==="AbortError"?"timeout":"transport_error");}
 };
}
async function all(ctx,table,params={}){
 const rows=[];let offset=0;
 for(;;){
  const data=await ctx.request(table,{...params,limit:String(ctx.batchSize),offset:String(offset)});
  if(!Array.isArray(data))throw new Failure("invalid_response");
  if(data.length===0)return rows;
  ctx.readRows=(ctx.readRows||0)+data.length;
  if(ctx.readRows>ctx.scanLimit)throw new Failure("scan_limit_exceeded");
  rows.push(...data);offset+=data.length;
 }
}
async function lookup(ctx,table,column,ids,select){
 const out=[];
 for(const part of groups([...new Set(ids)]))out.push(...await all(ctx,table,{select,[column]:inList(part),order:column+".asc"}));
 return out;
}
function summary(candidates,ctx,kind){
 const times=candidates.map(c=>c.event_time).sort((a,b)=>time(a)<time(b)?-1:time(a)>time(b)?1:0);
 const byEvent={},byVisitor={};
 for(const c of candidates){byEvent[c.event_name||c.reason]=(byEvent[c.event_name||c.reason]||0)+1;const id=ref(c.visitor_id);byVisitor[id]=(byVisitor[id]||0)+1;}
 return {projection:kind,mode:ctx.apply?"apply":"dry-run",source_cutoff:ctx.cutoff,total_candidates:candidates.length,
  ...(kind==="profile"?{by_event_name:byEvent}:{by_reason:byEvent}),earliest_event_time:times[0]||null,latest_event_time:times.at(-1)||null,
  affected_visitors:Object.keys(byVisitor).length,by_visitor:byVisitor,batch_size:ctx.batchSize,max_items:ctx.maxItems,
  planned:Math.min(candidates.length,ctx.maxItems),first_batch_count:Math.min(candidates.length,ctx.maxItems,ctx.batchSize)};
}
function context(opts,request){
 return {...opts,cutoff:new Date().toISOString(),request:request||client(opts.env,opts.timeoutMs)};
}
async function profileCandidates(ctx){
 const events=await all(ctx,"ads_events",{select:PROFILE_COLUMNS,event_name:inList([...buyer.PROFILE_EVENTS]),
  created_at:"lte."+ctx.cutoff,order:"event_time.asc,event_id.asc"});
 for(const e of events){time(e.event_time);if(typeof e.event_id!=="string"||!e.event_id||!UUID.test(e.visitor_id))throw new Failure("invalid_source_identity");}
 const ledger=await lookup(ctx,"buyer_profile_events","event_id",events.map(e=>e.event_id),"event_id,visitor_id");
 const applied=new Map(ledger.map(e=>[e.event_id,e.visitor_id]));
 for(const e of events)if(applied.has(e.event_id)&&applied.get(e.event_id)!==e.visitor_id)throw new Failure("ledger_identity_conflict");
 return events.filter(e=>!applied.has(e.event_id)).sort(compare);
}
async function qualityCandidates(ctx){
 const events=await all(ctx,"ads_events",{select:MARKERS,event_name:inList([...QUALITY_RECOMPUTE_EVENTS]),
  created_at:"lte."+ctx.cutoff,order:"event_time.asc,event_id.asc"});
 const visitors=new Map();
 for(const e of events){time(e.event_time);if(!UUID.test(e.visitor_id))throw new Failure("invalid_source_identity");
  const v=visitors.get(e.visitor_id)||{visitor_id:e.visitor_id,count:0,event_time:e.event_time,event_id:e.event_id};
  v.count++;if(compare(v,e)<0){v.event_time=e.event_time;v.event_id=e.event_id;}visitors.set(e.visitor_id,v);}
 const scores=await lookup(ctx,"buyer_quality_scores","visitor_id",[...visitors.keys()],"visitor_id,last_event_at");
 const stored=new Map(scores.map(s=>[s.visitor_id,s]));
 const candidates=[...visitors.values()].filter(v=>!stored.has(v.visitor_id)||!stored.get(v.visitor_id).last_event_at||time(stored.get(v.visitor_id).last_event_at)<time(v.event_time));
 for(const v of candidates){const s=stored.get(v.visitor_id);v.reason=s?"stale_score":"missing_score";v.stored_last_event_at=s?.last_event_at||null;v.test_data=false;}
 // Classification only; does not change scoring. Include older non-triggering test markers.
 const byVisitor=new Map(candidates.map(c=>[c.visitor_id,c]));
 for(const part of groups(candidates.map(c=>c.visitor_id))){
  const history=await all(ctx,"ads_events",{select:MARKERS,visitor_id:inList(part),created_at:"lte."+ctx.cutoff,order:"event_time.asc,event_id.asc"});
  for(const e of history)if(synthetic(e)&&byVisitor.has(e.visitor_id))byVisitor.get(e.visitor_id).test_data=true;
 }
 return candidates.sort((a,b)=>time(a.event_time)<time(b.event_time)?-1:time(a.event_time)>time(b.event_time)?1:a.visitor_id<b.visitor_id?-1:a.visitor_id>b.visitor_id?1:0);
}
async function applyProfile(ctx,item){
 // Recheck ledger: another online request/reconciler may have applied it since discovery.
 const found=await lookup(ctx,"buyer_profile_events","event_id",[item.event_id],"event_id,visitor_id");
 if(found.length){if(found[0].visitor_id!==item.visitor_id)throw new Failure("ledger_identity_conflict");return "already_current";}
 const rows=await lookup(ctx,"ads_events","event_id",[item.event_id],"*");
 if(rows.length!==1)throw new Failure("source_not_found");
 const row=rows[0],payload=buyer.toApplyPayload(row);
 if(!buyer.PROFILE_EVENTS.has(row.event_name)||payload.event_id!==item.event_id||
 row.visitor_id!==item.visitor_id||payload.visitor_id!==item.visitor_id||compare(row,item)!==0)
  throw new Failure("source_changed_or_unrepresentable");
 const result=await ctx.request("rpc/apply_buyer_profile_event",{},{p_event:payload});
 if(!result||!["applied","already_applied"].includes(result.status))throw new Failure("profile_rpc_rejected");
 return result.status;
}
async function applyQuality(ctx,item){
 // Re-read source and score to avoid unnecessary work after concurrent recovery.
 const relevant=await all(ctx,"ads_events",{select:MARKERS,visitor_id:"eq."+item.visitor_id,
  event_name:inList([...QUALITY_RECOMPUTE_EVENTS]),order:"event_time.desc,event_id.desc"});
 if(!relevant.length)return "already_current";
 const latest=relevant.slice().sort(compare).at(-1);
 const scores=await lookup(ctx,"buyer_quality_scores","visitor_id",[item.visitor_id],"visitor_id,last_event_at");
 if(scores[0]?.last_event_at&&time(scores[0].last_event_at)>=time(latest.event_time))return "already_current";
 if(!ctx.includeTests){
  const history=await all(ctx,"ads_events",{select:MARKERS,visitor_id:"eq."+item.visitor_id,order:"event_time.asc,event_id.asc"});
  if(history.some(synthetic))return "test_data_skipped";
 }
 const result=await ctx.request("rpc/recompute_buyer_quality_score",{},{p_visitor_id:item.visitor_id});
 if(result?.status!=="ok"||result.score?.visitor_id!==item.visitor_id||
 !result.score.last_event_at||time(result.score.last_event_at)<time(latest.event_time))throw new Failure("quality_rpc_rejected_or_stale");
 return "recomputed";
}
async function reconcile(kind,opts,request){
 const flag=kind==="profile"?"BUYER_PROFILE_RECONCILE":"BUYER_QUALITY_RECONCILE";
 if(opts.apply&&opts.env[flag]!=="1")throw new Failure("write_gate_closed");
 const ctx=context(opts,request);
 const candidates=await(kind==="profile"?profileCandidates(ctx):qualityCandidates(ctx));
 const report=summary(candidates,ctx,kind);
 const selected=kind==="quality"&&!ctx.includeTests?candidates.filter(c=>!c.test_data):candidates;
 report.planned=Math.min(selected.length,ctx.maxItems);report.first_batch_count=Math.min(report.planned,ctx.batchSize);
 report.deferred_by_limit=Math.max(0,selected.length-report.planned);
 if(kind==="quality"){
  report.test_candidates=candidates.filter(c=>c.test_data).length;
  report.unmarked_candidates=candidates.filter(c=>!c.test_data).length;
  report.test_data_policy=ctx.includeTests?"include-explicitly":"skip";
  report.visitors=candidates.map(c=>({visitor_ref:ref(c.visitor_id),reason:c.reason,last_eligible_event_at:c.event_time,
   stored_last_event_at:c.stored_last_event_at,eligible_events:c.count,test_data:c.test_data}));
 }
 if(kind==="profile")report.gap_age_seconds=report.earliest_event_time?Math.max(0,Math.floor((Date.now()-Date.parse(report.earliest_event_time))/1000)):0;
 report.processed=0;report.results={};report.failures=[];report.ok=true;
 if(!ctx.apply){report.read_rows=ctx.readRows||0;return report;}
 for(const item of selected.slice(0,ctx.maxItems)){
  try{const outcome=await(kind==="profile"?applyProfile(ctx,item):applyQuality(ctx,item));
   report.processed++;report.results[outcome]=(report.results[outcome]||0)+1;
  }catch(error){
   report.ok=false;report.failures.push({item_ref:ref(kind==="profile"?item.event_id:item.visitor_id),
    code:error instanceof Failure?error.code:"unexpected_error",...(error instanceof Failure&&Number.isInteger(error.status)?{http_status:error.status}:{})});
   // Never blindly retry an ambiguous timeout: next run re-discovers durable state.
   break;
  }
 }
 report.resume="Run dry-run again; durable ledger/score freshness determines remaining work.";
 report.read_rows=ctx.readRows||0;
 return report;
}
async function cli(kind,argv=process.argv.slice(2),env=process.env,log=console.log){
 try{
  const opts=options(argv,env);
  if(kind==="report"){
   if(opts.apply)throw new Failure("read_only_report");
   for(const projection of ["profile","quality"])log(JSON.stringify(await reconcile(projection,opts)));
   return 0;
  }
  const report=await reconcile(kind,opts);log(JSON.stringify(report));return report.ok?0:1;
 }catch(error){log(JSON.stringify({ok:false,code:error instanceof Failure?error.code:"unexpected_error",
  ...(error instanceof Failure&&Number.isInteger(error.status)?{http_status:error.status}:{})}));return 1;}
}
module.exports={options,client,reconcile,cli,Failure,time,compare,inList,ref};
