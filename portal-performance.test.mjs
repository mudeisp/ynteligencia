import test from 'node:test';
import assert from 'node:assert/strict';
import {readInventory} from './portal/inventory.js';
import {createPortalHandler} from './portal/router.js';
import {groupDevelopments} from './portal/model.js';

const row=(id='100',more={})=>({id:`00000000-0000-4000-8000-${id.padStart(12,'0')}`,building_id:id,external_id:`orulo:${id}:1`,source:'novos',active:true,state:'ES',city:'Vitória',neighborhood:'Centro',development_name:`Projeto ${id}`,price:400000,area:50,bedrooms:2,parking_spaces:1,...more});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(body){this.body=body;},end(){}});
const path='/es/vitoria/empreendimento/projeto-100--orulo-100';
test('simultaneous cold listing reads coalesce; expiry and errors do not poison snapshots',async()=>{
 let calls=0,clock=0,fail=false;
 const request=async()=>{calls++;await new Promise(r=>setTimeout(r,4));if(fail)throw new Error('offline');return {ok:true,data:[row()]};};
 const read=()=>readInventory('ES',{request,configured:()=>true,cacheable:true,now:()=>clock,mode:'listing'});
 const results=await Promise.all([read(),read(),read()]);assert.equal(calls,1);assert.equal(results[0],results[1]);
 await read();assert.equal(calls,1);clock=60001;fail=true;await assert.rejects(read());fail=false;await read();assert.equal(calls,3);
});
test('cache is scoped to transport and mode; details are always fresh',async()=>{
 const calls=[];const request=async p=>{calls.push(p);return {ok:true,data:[row()]};};
 const options={request,configured:()=>true,cacheable:true};
 await readInventory('ES',{...options,mode:'listing'});
 await readInventory('ES',{...options,mode:'project-index',buildingIds:['100']});
 await readInventory('ES',{...options,mode:'project',ids:[row().id]});await readInventory('ES',{...options,mode:'project',ids:[row().id]});
 assert.equal(calls.length,4);assert.match(calls[1],/building_id=in/);assert.match(calls[2],/^properties\?/);
 await assert.rejects(readInventory('ES',{...options,mode:'project-index',buildingIds:['100),active.eq.false']}),/invalid_building_ids/);
});
test('point resolver retains SSR, attribution redirect, unit routes, related order and state/city boundaries',async()=>{
 const rows=[row(),row('101',{price:410000}),row('102',{price:500000}),row('103',{neighborhood:'Praia',price:400001}),row('104',{city:'Serra'})];
 const calls=[];
 const inventory=async(state,o)=>{calls.push(o);if(o.mode==='project-index')return rows.filter(r=>o.buildingIds.includes(r.building_id));if(o.mode==='city-summary')return rows.filter(r=>r.city===o.city);if(o.mode==='project')return rows.filter(r=>o.ids.includes(r.id));return rows;};
 const handler=createPortalHandler({inventory,p0:true,preview:true,pointLookupStates:['ES']});
 const res=response();await handler({method:'GET',url:path},res);assert.equal(res.statusCode,200);assert.equal(calls[0].mode,'project-index');assert.ok(!calls.some(c=>c.mode==='listing'));assert.match(res.body,/rel="canonical" href="https:\/\/www.yincorp.com.br/);assert.match(res.body,/BreadcrumbList/);assert.equal(res.headers['X-Robots-Tag'],'noindex, follow');
 assert.deepEqual(calls.at(-1).buildingIds,['101','102','103']);
 calls.length=0;const redirect=response();await handler({method:'GET',url:path.replace('projeto-100','antigo')+'?gclid=test'},redirect);assert.equal(redirect.statusCode,308);assert.equal(redirect.headers.Location,path+'?gclid=test');assert.ok(!calls.some(c=>c.mode==='city-summary'));
 const wrong=response();await handler({method:'GET',url:path.replace('/vitoria/','/serra/')},wrong);assert.equal(wrong.statusCode,404);
 const unit=response();await handler({method:'GET',url:path+'/tipologia/'+row().id},unit);assert.equal(unit.statusCode,200);
 const missing=response();await handler({method:'GET',url:path+'/tipologia/00000000-0000-4000-8000-999999999999'},missing);assert.equal(missing.statusCode,404);
 const head=response();await handler({method:'HEAD',url:path},head);assert.equal(head.statusCode,200);assert.equal(head.body,undefined);
});
test('rollback and hashed legacy tokens retain original listing resolver; absent index fails closed',async()=>{
 const calls=[];const inventory=async(s,o)=>{calls.push(o);return [row()];};
 const res=response();await createPortalHandler({inventory,p0:false})({method:'GET',url:path},res);assert.equal(calls[0].mode,'listing');assert.equal(res.statusCode,200);
 const legacy=row('1',{building_id:null,external_id:'legacy:one'}),g=groupDevelopments([legacy])[0];calls.length=0;
 const old=response();await createPortalHandler({inventory:async(s,o)=>{calls.push(o);return [legacy];},p0:true})({method:'GET',url:g.path},old);assert.equal(calls[0].mode,'listing');assert.equal(old.statusCode,200);
 const missing=response();await createPortalHandler({inventory:async()=>[],p0:true})({method:'GET',url:path},missing);assert.equal(missing.statusCode,404);
 const failed=response();await createPortalHandler({inventory:async()=>{throw new Error('offline');},p0:true})({method:'GET',url:path},failed);assert.equal(failed.statusCode,503);assert.equal(failed.headers['Cache-Control'],'no-store');
});
test('small markets keep one listing request; anomalous price summaries use facet ranking',async()=>{
 const calls=[];const rows=[row(),row('101',{price:0,unit_facets:[{id:row('101').id,external_id:'orulo:101:1',price:420000,area:50,bedrooms:2,parking_spaces:1}]})];
 const inventory=async(s,o)=>{calls.push(o.mode);if(o.mode==='project-index')return rows.filter(r=>o.buildingIds.includes(r.building_id));if(o.mode==='project')return rows.filter(r=>o.ids.includes(r.id));return rows;};
 const es=response();await createPortalHandler({inventory,p0:true})({method:'GET',url:path},es);assert.equal(es.statusCode,200);assert.deepEqual(calls,['listing','project']);
 calls.length=0;const opted=response();await createPortalHandler({inventory,p0:true,pointLookupStates:['ES']})({method:'GET',url:path},opted);assert.equal(opted.statusCode,200);assert.ok(calls.includes('listing'));assert.equal(es.body,opted.body);
});
