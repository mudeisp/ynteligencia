import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDevelopment,classifyInventory,NATIONAL_MARKETS} from './portal/eligibility.js';
import {groupEligibleDevelopments,parseRoute} from './portal/model.js';
import {createPortalHandler} from './portal/router.js';
import {readInventory} from './portal/inventory.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(more={})=>({id:id(1),external_id:'orulo:100:1',building_id:'100',source:'novos',active:true,state:'RS',city:'Porto Alegre',neighborhood:'Centro',development_name:'Projeto Real',status:'Em construção',stage:'Lançamento',price:9000000,area:100,typology_stock:2,building_stock:'2',image_url:'https://example.com/real.jpg',...more});
test('new construction and ready-new qualify without price bounds',()=>{
 for(const status of ['Lançamento','Em construção','Pronto novo'])assert.equal(classifyDevelopment(row({status,stage:status})).classification,'INDEXABLE');
});
test('used wins over source and contradictory stage; scope and identity fail closed',()=>{
 for(const change of [{status:'Usado'},{stage:'Usado'},{active:false},{source:'usados'},{state:'MG'},{city:''},{id:''},{building_id:'bad'},{development_name:'',title:''}])assert.equal(classifyDevelopment(row(change)).classification,'EXCLUDED');
});
test('unavailable, missing data and unknown classifications are catalog-only',()=>{
 for(const change of [{typology_stock:0},{typology_stock:null},{price:0},{price:-1},{price:'bad'},{area:null},{image_url:''},{image_url:'https://example.com/placeholder.jpg'},{building_stock:'0'},{status:'',stage:''}])assert.equal(classifyDevelopment(row(change)).classification,'CATALOG_ONLY');
});
test('price area and availability must belong to the same unit',()=>{
 const r=row({unit_facets:[{id:id(1),price:1,area:0,typology_stock:1},{id:id(2),price:0,area:1,typology_stock:1}]});
 assert.equal(classifyDevelopment(r).classification,'CATALOG_ONLY');
 r.unit_facets.push({id:id(3),price:25,area:10,typology_stock:1});
 assert.equal(classifyDevelopment(r).classification,'INDEXABLE');
 assert.equal(groupEligibleDevelopments([r])[0].units.length,1);
});
test('units group once, deduplicate by id and used conflicts exclude canonical project',()=>{
 const rows=[row(),row({id:id(2),price:500000}),row()];
 const groups=groupEligibleDevelopments(rows);assert.equal(groups.length,1);assert.equal(groups[0].units.length,2);
 assert.equal(groupEligibleDevelopments([...rows,row({id:id(3),status:'Usado'})]).length,0);
 assert.equal(classifyInventory([row(),row()])[1].reasons.at(-1),'duplicate_identity');
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(body){this.body=body;return this;},end(){return this;}});
test('eight state, city and neighborhood routes render SSR; preview blocks indexing and sensitive data',async()=>{
 for(const state of NATIONAL_MARKETS){
  const fixture=row({state,secret:'never-in-html'}),handler=createPortalHandler({nationalEligibility:true,preview:true,inventory:async()=>[fixture]});
  for(const path of [`/${state.toLowerCase()}`,`/${state.toLowerCase()}/porto-alegre`,`/${state.toLowerCase()}/porto-alegre/centro`]){
   assert.ok(parseRoute(path));const res=response();await handler({method:'GET',url:path},res);
   assert.equal(res.statusCode,200);assert.match(res.body,/<h1[ >]/);assert.match(res.body,/application\/ld\+json/);assert.match(res.body,/content="noindex,follow"/);assert.doesNotMatch(res.body,/never-in-html/);
  }
 }
});
test('catalog-only detail is noindex, used and nonexistent are 404, failures 503',async()=>{
 for(const [fixture,status] of [[row({image_url:''}),200],[row({status:'Usado'}),404]]){
  const handler=createPortalHandler({nationalEligibility:true,inventory:async()=>[fixture]});const res=response();
  await handler({method:'GET',url:'/rs/porto-alegre/empreendimento/projeto-real--orulo-100'},res);
  assert.equal(res.statusCode,status);assert.equal(res.headers['X-Robots-Tag'],'noindex, follow');
 }
 const handler=createPortalHandler({nationalEligibility:true,inventory:async()=>{throw Error('unavailable');}});const res=response();await handler({method:'GET',url:'/rs'},res);assert.equal(res.statusCode,503);
});
test('public queries prune explicit used, retain unknown, separate policy cache and read details fresh',async()=>{
 const paths=[];const request=async path=>{paths.push(new URL(path,'https://example.com'));return {ok:true,data:[]};};
 const options={request,configured:()=>true,cacheable:true};
 await readInventory('RS',{...options,mode:'listing',nationalEligibility:true});
 assert.match(paths[0].searchParams.get('and'),/status.is.null,status.neq.Usado/);
 await readInventory('RS',{...options,mode:'listing'});assert.equal(paths.length,2);assert.equal(paths[1].searchParams.get('and'),null);
 await readInventory('RS',{...options,mode:'project',ids:[id(1)],nationalEligibility:true});
 await readInventory('RS',{...options,mode:'project',ids:[id(1)],nationalEligibility:true});assert.equal(paths.length,4);
});
