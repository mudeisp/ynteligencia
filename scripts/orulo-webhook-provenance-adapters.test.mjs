import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransactionalWebhookWriter} from '../lib/orulo-webhook-provenance.js';
import {createWebhookHandler} from '../lib/orulo-webhook-core.js';
import {createProvenanceReader} from './orulo-webhook-provenance-reader.mjs';

test('writer uses one parameterized operation, no retries or REST fallback on uncertain result',async()=>{
 let calls=0;const parameters=[];
 const writer=createTransactionalWebhookWriter({query:async(sql,args)=>{calls++;parameters.push({sql,args});throw Error('secret database connection information');}});
 await assert.rejects(writer.syncBuilding('64515',[]),e=>e.message==='V9_TRANSACTION_FAILED_OR_UNCERTAIN_NO_RETRY');assert.equal(calls,1);
 assert.match(parameters[0].sql,/apply_webhook\(\$1/);assert.equal(parameters[0].args[0],'64515');
 const invalid=createTransactionalWebhookWriter({query:async()=>({rows:[]})});await assert.rejects(invalid.removeBuilding('64515'),/UNCERTAIN_NO_RETRY/);
});
test('default handler retains the existing REST removal behavior without an injected writer',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='synthetic';let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/\/rest\/v1\/properties/);assert.equal(options.method,'PATCH');assert.equal(JSON.parse(options.body).active,false);assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),['active','updated_at']);return Response.json([{active:false}]);};
 let result;const res={setHeader(){},status(){return this;},json(v){result=v;}};
 try{await createWebhookHandler()({method:'POST',body:{name:'BUILDING_UPDATE',properties:{building_id:64515,status:'removed'}}},res);assert.equal(calls,1);assert.equal(result.processed,true);assert.equal(result.affected,1);}
 finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});
test('reader uses private server snapshots; no caller proof, mismatched run/hash or missing result accepted',async()=>{
 let calls=0;const change={uuid:'00000000-0000-4000-8000-000000000001',scope:'OUT_OF_SCOPE',before:{fullHash:'a'.repeat(32)},after:{fullHash:'b'.repeat(32)}};
 const reader=createProvenanceReader({query:async(sql,args)=>{calls++;assert.match(sql,/read_webhook_provenance\(\$1/);assert.equal(args.length,2);return {rows:[{proof:{kind:'INDEPENDENT_WRITER_ATTESTATION_V1',runUuid:'other',uuid:change.uuid,beforeFullHash:change.before.fullHash,afterFullHash:change.after.fullHash,policy:'STRICT_GLOBAL_V1'}}]};}});
 const lookup=await reader({runUuid:'run',changes:[change,{...change,scope:'IN_SCOPE'}]});assert.equal(calls,1);assert.equal(lookup(change),null);
 await assert.rejects(createProvenanceReader({query:async()=>{throw Error('unavailable');}})({runUuid:'run',changes:[change]}),/unavailable/);
});
test('explicit handler adapter preserves payload, summaries and media without REST mutations',async()=>{
 const previous=globalThis.fetch,oldEnv={id:process.env.ORULO_CLIENT_ID,secret:process.env.ORULO_CLIENT_SECRET,key:process.env.SUPABASE_SECRET_KEY};
 process.env.ORULO_CLIENT_ID='synthetic';process.env.ORULO_CLIENT_SECRET='synthetic';delete process.env.SUPABASE_SECRET_KEY;
 let writes=0,removed=0;
 globalThis.fetch=async url=>{
  assert.ok(!String(url).includes('supabase.co'));
  if(String(url).endsWith('/oauth/token'))return Response.json({access_token:'synthetic'});
  if(String(url).includes('/images?'))return Response.json({images:[{'1024x1024':'https://example.invalid/photo.jpg'}]});
  if(String(url).endsWith('/typologies'))return Response.json({typologies:[{id:1,stock:2,private_area:40,original_price:100}]});
  return Response.json({id:64515,name:'Synthetic',finality:'residencial',videos:['video'],virtual_tour:'tour',floor_plans:[{id:'p',image_url:'https://example.invalid/plan.jpg'}]});
 };
 const writer={syncBuilding:async(id,rows)=>{writes++;assert.equal(String(id),'64515');assert.equal(rows[0].price,100);assert.deepEqual(rows[0].raw_data.building.videos,['video']);assert.equal(rows[0].raw_data.building.virtual_tour,'tour');assert.equal(rows[0].raw_data.building.floor_plans[0].image_url,'https://example.invalid/plan.jpg');return {existingRows:[{external_id:'orulo:64515:2'}],savedRows:rows,deactivatedRows:[{active:false}]};},removeBuilding:async()=>{removed++;return [{active:false}];}};
 const handler=createWebhookHandler({writer});let response;
 const res={setHeader(){},status(code){assert.equal(code,200);return this;},json(data){response=data;return data;}};
 try{
  await handler({method:'POST',body:{name:'BUILDING_UPDATE',properties:{building_id:64515,status:'active'}}},res);
  assert.equal(response.action,'building_upserted');assert.equal(response.properties_saved,1);assert.equal(response.stale_typologies_deactivated,1);assert.equal(writes,1);
  await handler({method:'POST',body:{name:'BUILDING_UPDATE',properties:{building_id:64515,status:'removed'}}},res);assert.equal(response.action,'soft_delete');assert.equal(removed,1);
  writer.syncBuilding=async()=>{throw Error('V9_TRANSACTION_FAILED_OR_UNCERTAIN_NO_RETRY');};
  await handler({method:'POST',body:{name:'BUILDING_UPDATE',properties:{building_id:64515,status:'active'}}},res);assert.equal(response.processed,false);assert.equal(response.error,'V9_TRANSACTION_FAILED_OR_UNCERTAIN_NO_RETRY');
 }finally{
  globalThis.fetch=previous;for(const [key,value] of [['ORULO_CLIENT_ID',oldEnv.id],['ORULO_CLIENT_SECRET',oldEnv.secret],['SUPABASE_SECRET_KEY',oldEnv.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
