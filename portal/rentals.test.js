import test from 'node:test';
import assert from 'node:assert/strict';
import {createRentalHandler,rentalResults} from './rentals.js';
const rows=Array.from({length:15},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,active:true,rent_price:1000+i*100,condo_fee:200,property_tax:500,city:'São Paulo',state:'SP',neighborhood:i<8?'Perdizes':'Pinheiros',bedrooms:i%3+1,development_name:'Casa <segura>',image_url:'javascript:alert(1)'}));
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(body){this.body=body;return this;},end(){return this;}});
test('rental filters combine on each property, paginate and exclude inactive rows',()=>{
  const data=[...rows,{...rows[0],active:false,rent_price:1}];
  assert.equal(rentalResults(data,new URLSearchParams()).count,15);
  assert.equal(rentalResults(data,new URLSearchParams('pagina=2')).items.length,3);
  const result=rentalResults(data,new URLSearchParams('bairro=Perdizes&preco=1500&quartos=3'));
  assert.equal(result.count,2);assert.ok(result.items.every(r=>r.rent_price<=1500 && r.bedrooms>=3));
  assert.equal(rentalResults(data,new URLSearchParams('pagina=-1')),null);
  assert.equal(rentalResults(data,new URLSearchParams('pagina=99')),null);
});
test('SSR reads only rental table and escapes supplier text and unsafe images',async()=>{
  const calls=[],res=response();
  await createRentalHandler({request:async p=>{calls.push(p);return {ok:true,data:rows};}})({method:'GET',url:'/alugar?bairro=Perdizes'},res);
  assert.equal(res.code,200);assert.ok(calls.every(p=>p.startsWith('rental_properties?')));
  assert.match(res.body,/8 imóveis para alugar/);assert.match(res.body,/Casa &lt;segura&gt;/);assert.doesNotMatch(res.body,/javascript:|<segura>/);
  assert.match(res.body,/periodicidade a confirmar/);assert.match(res.body,/\/alugar\/imovel\//);
});
test('detail is looked up by id, missing stock and unavailable database have explicit states',async()=>{
  const detail=response();let query;
  await createRentalHandler({request:async p=>{query=p;return {ok:true,data:[rows[0]]};}})({method:'GET',url:'/alugar/imovel/'+rows[0].id},detail);
  assert.equal(detail.code,200);assert.match(query,/id=eq\./);assert.match(detail.body,/id="rental-lead"/);
  const missing=response();await createRentalHandler({request:async()=>({ok:true,data:[]})})({method:'GET',url:'/alugar/imovel/'+rows[0].id},missing);assert.equal(missing.code,404);
  const failed=response();await createRentalHandler({request:async()=>({ok:false})})({method:'GET',url:'/alugar'},failed);assert.equal(failed.code,503);
});
test('reader does not silently truncate stock at Supabase page limit',async()=>{
  const res=response(),calls=[];
  await createRentalHandler({request:async p=>{calls.push(p);return {ok:true,data:calls.length===1?Array.from({length:1000},()=>rows[0]):[rows[1]]};}})({method:'GET',url:'/alugar'},res);
  assert.equal(res.code,200);assert.equal(calls.length,2);assert.match(calls[1],/offset=1000/);assert.match(res.body,/1001 imóveis para alugar/);
});
