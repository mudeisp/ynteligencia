import test from 'node:test';
import assert from 'node:assert/strict';
import {createOruloSource,createImageChecker} from './orulo-v5-orulo-source.mjs';
test('OAuth authenticates and fetches actual Órulo floor_plans endpoint',async()=>{
 const calls=[];
 const source=createOruloSource({clientId:'client',clientSecret:'secret',fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/oauth/token'))return {ok:true,json:async()=>({access_token:'token'})};
  return {ok:true,json:async()=>({floor_plans:[{id:7,'1024x1024':'https://static.orulo.com.br/images/properties/a.jpg'}]})};
 }});
 const result=await source('51496');
 assert.equal(result.floor_plans[0].image_url,'https://static.orulo.com.br/images/properties/a.jpg');
 assert.equal(calls[0].url,'https://www.orulo.com.br/oauth/token');
 assert.match(calls[1].url,/\/api\/v2\/buildings\/51496\/floor_plans\?/);
 assert.equal(calls[1].opts.headers.Authorization,'Bearer token');
});
test('rejects malformed source plan IDs',async()=>{
 const source=createOruloSource({clientId:'a',clientSecret:'b',fetchImpl:async url=>url.endsWith('/oauth/token')?{ok:true,json:async()=>({access_token:'x'})}:{ok:true,json:async()=>({floor_plans:[{id:7},{id:7}]})}});
 await assert.rejects(source('51496'),/ORULO_SOURCE_SCHEMA_MISMATCH/);
});
test('requires credentials',()=>assert.throws(()=>createOruloSource({}),/ORULO_CONFIG_REQUIRED/));
test('checks image content type and trusted host',async()=>{
 const check=createImageChecker({fetchImpl:async()=>({ok:true,headers:{get:()=> 'image/jpeg'}})});
 assert.equal(await check('https://static.orulo.com.br/images/properties/a.jpg'),true);
 assert.equal(await check('https://other.example.test/a.jpg'),false);
});
