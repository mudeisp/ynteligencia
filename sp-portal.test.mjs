import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDevelopments,parseRoute} from './portal/model.js';
import {createPortalHandler,sitemap} from './portal/router.js';

const sp=(overrides={})=>({
  id:'10000000-0000-4000-8000-000000000001',
  external_id:'orulo:900:1',building_id:'900',development_name:'Casa Perdizes',
  city:'São Paulo',state:'SP',neighborhood:'Perdizes',price:950000,area:72,
  bedrooms:2,parking_spaces:1,image_url:'https://example.com/sp.jpg',active:true,
  updated_at:'2026-10-28T10:00:00Z',developer:'Construtora SP',typology_type:'Apartamento',
  ...overrides
});
const es=(overrides={})=>({
  id:'20000000-0000-4000-8000-000000000001',
  external_id:'orulo:901:1',building_id:'901',development_name:'Projeto Vitória',
  city:'Vitória',state:'ES',neighborhood:'Praia do Canto',price:800000,area:60,
  bedrooms:2,parking_spaces:1,image_url:'https://example.com/es.jpg',active:true,
  updated_at:'2026-10-28T10:00:00Z',developer:'Construtora ES',typology_type:'Apartamento',
  ...overrides
});
const spRows=[
  sp(),
  sp({id:'10000000-0000-4000-8000-000000000002',external_id:'orulo:902:1',building_id:'902',development_name:'Brooklin House',neighborhood:'Brooklin',price:1200000}),
  sp({id:'10000000-0000-4000-8000-000000000003',external_id:'orulo:903:1',building_id:'903',development_name:'Pinheiros Living',neighborhood:'Pinheiros',price:1100000}),
  sp({id:'10000000-0000-4000-8000-000000000004',external_id:'orulo:904:1',building_id:'904',development_name:'Campo Belo Residences',neighborhood:'Campo Belo',price:1500000})
];
function mockResponse(){return {statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},send(s){this.body=s;return this;},end(){return this;}};}
async function page(path,rows=spRows){const res=mockResponse();await createPortalHandler({inventory:async state=>rows.filter(r=>r.state===state),preview:true,canonicalOrigin:'https://www.yincorp.com.br'})({method:'GET',url:path,query:{}},res);return res;}

test('São Paulo routes use the same state-city-neighborhood hierarchy',()=>{
  assert.deepEqual(parseRoute('/sp'),{kind:'state',state:'SP'});
  assert.deepEqual(parseRoute('/sp/sao-paulo'),{kind:'city',state:'SP',city:'sao-paulo'});
  assert.deepEqual(parseRoute('/sp/sao-paulo/perdizes'),{kind:'neighborhood',state:'SP',city:'sao-paulo',neighborhood:'perdizes'});
});

test('SP state home prioritizes neighborhoods and never inherits Espírito Santo chrome',async()=>{
  const res=await page('/sp');
  assert.equal(res.statusCode,200);
  assert.match(res.body,/São Paulo,<br>bairro a bairro\./);
  assert.match(res.body,/href="\/sp\/sao-paulo\/perdizes"/);
  assert.match(res.body,/href="\/sp\/sao-paulo\/brooklin"/);
  assert.match(res.body,/href="\/sp" aria-label="Yincorp — início"/);
  assert.match(res.body,/Catálogo de São Paulo/);
  assert.doesNotMatch(res.body,/Encontre o seu próximo capítulo no Espírito Santo/);
  assert.match(res.body,/noindex,follow/);
});

test('SP neighborhood listing has canonical geography and real development links',async()=>{
  const res=await page('/sp/sao-paulo/perdizes');
  assert.equal(res.statusCode,200);
  assert.match(res.body,/rel="canonical" href="https:\/\/www.yincorp.com.br\/sp\/sao-paulo\/perdizes"/);
  assert.match(res.body,/Casa Perdizes/);
  assert.match(res.body,/\/sp\/sao-paulo\/empreendimento\/casa-perdizes--orulo-900/);
  assert.match(res.body,/O catálogo reúne 1 empreendimento em Perdizes, São Paulo\/SP/);
});

test('SP development reuses approved modular property renderer with state-aware shell',async()=>{
  const project=groupDevelopments(spRows)[0];
  const res=await page(project.path);
  assert.equal(res.statusCode,200);
  assert.match(res.body,/"@type":"ApartmentComplex"/);
  assert.match(res.body,/href="\/sp" aria-label="Yincorp — início"/);
  assert.match(res.body,/placeholder="\(11\) 99999-9999"/);
  assert.ok(res.body.includes(`rel="canonical" href="https://www.yincorp.com.br${project.path}"`));
});

test('portal sitemap can carry ES and SP canonical geography together',()=>{
  const groups=groupDevelopments([...spRows,es()]);
  const xml=sitemap(groups,'https://www.yincorp.com.br');
  assert.match(xml,/<loc>https:\/\/www.yincorp.com.br\/sp<\/loc>/);
  assert.match(xml,/<loc>https:\/\/www.yincorp.com.br\/sp\/sao-paulo\/perdizes<\/loc>/);
  assert.match(xml,/<loc>https:\/\/www.yincorp.com.br\/es\/vitoria<\/loc>/);
});
