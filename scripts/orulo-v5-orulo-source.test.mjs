import test from 'node:test';
import assert from 'node:assert/strict';
import {createOruloSource,createImageChecker} from './orulo-v5-orulo-source.mjs';
test('fetches matching building from configured HTTPS endpoint',async()=>{
 let called='';
 const source=createOruloSource({baseUrl:'https://api.example.test/v1',token:'secret',
 fetchImpl:async(url,opts)=>{called=url;assert.equal(opts.headers.Authorization,'Bearer secret');return {ok:true,json:async()=>({building:{id:51496,floor_plans:[{id:7,image_url:'https://cdn.example.test/a.jpg'}]}})};}});
 const result=await source('51496');assert.equal(result.floor_plans.length,1);assert.equal(called,'https://api.example.test/v1/buildings/51496');
});
test('rejects unexpected source building',async()=>{
 const source=createOruloSource({baseUrl:'https://api.example.test/v1',token:'secret',fetchImpl:async()=>({ok:true,json:async()=>({building:{id:999,floor_plans:[]}})})});
 await assert.rejects(source('51496'),/ORULO_SOURCE_SCHEMA_MISMATCH/);
});
test('rejects non HTTPS configuration',()=>assert.throws(()=>createOruloSource({baseUrl:'http://example.test',token:'x'}),/ORULO_HTTPS_REQUIRED/));
test('checks image content type',async()=>{
 const check=createImageChecker({fetchImpl:async()=>({ok:true,headers:{get:()=> 'image/jpeg'}})});
 assert.equal(await check('https://cdn.example.test/a.jpg'),true);
 assert.equal(await check('http://cdn.example.test/a.jpg'),false);
});
