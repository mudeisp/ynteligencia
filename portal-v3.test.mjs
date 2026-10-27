import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierDate,number,featureNames } from './portal/details.js';
import { groupDevelopments } from './portal/model.js';
import { createPortalHandler } from './portal/router.js';
import { readInventory } from './portal/inventory.js';
const base={id:'00000000-0000-4000-8000-000000000001',external_id:'orulo:123:1',building_id:'123',active:true,state:'ES',city:'Vitória',neighborhood:'Praia do Canto',development_name:'Mar & Sol',price:900000,area:70,bedrooms:2,parking_spaces:1,typology_type:'Apartamento',typology_reference:'301',typology_stock:2,suites:1,bathrooms:2,original_price:1000000,opening_date:'30/12/2028',features:[{name:'Piscina'},{name:'Academia'}],building_features:[{name:'Piscina'}],floor_plans:[{id:'999',type:'Área condominial',description:'Planta do lazer'}],address:{street_type:'Rua',street:'Do Sol',number:12,latitude:-20.3,longitude:-40.3,zip_code:'29000-000'},building_stock:0,total_units:60,number_of_towers:null};
async function page(path,rows=[base]) {const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(body){this.body=body;},end(){}};await createPortalHandler({inventory:async()=>rows,preview:true,canonicalOrigin:'https://www.yincorp.com.br'})({method:'GET',url:path},res);return res;}
test('nullable numbers and supplier dates retain factual zeros and reject invalid dates',()=>{
  for(const v of [null,undefined,'',false,' ',{},'abc'])assert.equal(number(v),null);
  assert.equal(number(0),0);assert.equal(supplierDate('30/12/2028').iso,'2028-12-30');
  for(const v of ['31/02/2028','12/30/2028','2028-12-30',null])assert.equal(supplierDate(v),null);
  assert.equal(supplierDate('29/02/2028').label,'29/02/2028');
});
test('feature objects are deduplicated without object-to-string corruption',()=>assert.deepEqual(featureNames([{name:'Academia'},{name:''},null],['academia','Piscina']),['academia','Piscina']));
test('missing numeric fields do not turn into zero-room inventory',()=>{
  const g=groupDevelopments([{...base,bedrooms:undefined,parking_spaces:undefined,suites:null,area:null}])[0];
  assert.equal(g.bedrooms,'Sob consulta');assert.equal(g.parking,'Sob consulta');assert.equal(g.suites,'Sob consulta');
});
test('SSR delivers complete gallery, factual sheets and richer typologies without browser fetch',async()=>{
  const images=Array.from({length:31},(_,i)=>`https://example.com/${i}.jpg`),rows=[{...base,building_images:images}];
  const g=groupDevelopments(rows)[0],res=await page(g.path,rows);
  assert.equal(res.code,200);assert.equal(g.photos.length,31);assert.match(res.body,/Ver todas as fotos \(31\)/);
  assert.match(res.body,/https:\/\/example.com\/30.jpg/);assert.match(res.body,/loading="lazy"/);
  for(const text of ['Ficha técnica','Piscina','Planta do lazer','30/12/2028','Apartamento · ref. 301','Estoque informado: 2','<del>','Carregar mapa'])assert.ok(res.body.includes(text),text);
  assert.doesNotMatch(res.body,/portal-project-data|\[object Object\]|Opção 1|images\/properties\/large\/999|<iframe|<dt>Torres<\/dt>/);
  assert.match(res.body,/<dt>Estoque informado<\/dt><dd>0<\/dd>/);
  assert.match(res.body,/noindex,follow/);assert.equal((res.body.match(/<h1/g)||[]).length,1);
});
test('original price appears only for an actual reduction and missing plants omit the section',async()=>{
  const rows=[{...base,original_price:800000,floor_plans:[]}],res=await page(groupDevelopments(rows)[0].path,rows);
  assert.doesNotMatch(res.body,/<del>|id="plantas"/);
});
test('supplier content is escaped in every rich section and invalid media schemes are refused',async()=>{
  const rows=[{...base,description:'<script>alert(1)</script>',features:[{name:'<svg onload=alert(1)>'}],floor_plans:[{description:'<img onerror=bad>',url:'javascript:alert(1)'}],address:{street:'<script>bad</script>'}}],res=await page(groupDevelopments(rows)[0].path,rows);
  assert.doesNotMatch(res.body,/<svg onload|<img onerror|<script>alert|javascript:alert/);assert.match(res.body,/&lt;script&gt;/);
});
test('Vitória editorial and stocked neighborhood links render server-side with dynamic counts',async()=>{
  const res=await page('/es/vitoria',[base,{...base,id:'2',building_id:'124',external_id:'orulo:124:1',neighborhood:'Jardim da Penha'}]);
  assert.match(res.body,/Imóveis e lançamentos em Vitória, Espírito Santo/);assert.match(res.body,/VIVER EM VITÓRIA/);
  assert.match(res.body,/<strong>2<\/strong><span>empreendimentos no catálogo ativo/);assert.match(res.body,/href="\/es\/vitoria\/jardim-da-penha"/);assert.doesNotMatch(res.body,/href="\/es\/vitoria\/jardim-camburi"/);
});
test('related projects are real, exclude self, and prioritize matching neighborhood',async()=>{
  const others=[{...base,id:'2',building_id:'124',development_name:'Vizinho'},{...base,id:'3',building_id:'125',development_name:'Outra cidade',city:'Serra'}];
  const res=await page(groupDevelopments([base])[0].path,[base,...others]);
  assert.match(res.body,/Mais empreendimentos em Vitória/);assert.match(res.body,/Vizinho/);assert.doesNotMatch(res.body,/Outra cidade/);
});
test('inventory reads an explicit public projection and never supplier private contacts',async()=>{
  await readInventory('ES',{configured:()=>true,request:async path=>{const select=new URLSearchParams(path.split('?')[1]).get('select');for(const field of ['suites:raw_data->typology->suites','address:raw_data->building->address','building_images:raw_data->building->images'])assert.ok(select.includes(field));assert.doesNotMatch(select,/developer_data|publisher|payment_conditions|files|\*/);return {ok:true,data:[]};}});
});
