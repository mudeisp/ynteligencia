import test from 'node:test';import assert from 'node:assert/strict';
import{syntheticWebhook}from'../test-support/orulo-v9-staging/http-fixture.mjs';
test('controlled HTTP reuses the real handler and rejects unsigned/foreign-source media without external API calls',async()=>{
 const oldId=process.env.ORULO_CLIENT_ID,oldSecret=process.env.ORULO_CLIENT_SECRET;process.env.ORULO_CLIENT_ID='synthetic';process.env.ORULO_CLIENT_SECRET='synthetic';let writes=0;
 const f=await syntheticWebhook({buildingId:'8100001',writer:{syncBuilding:async(id,rows)=>{writes++;assert.equal(String(id),'8100001');return{existingRows:[],savedRows:rows,deactivatedRows:[]};}}});
 try{assert.equal((await f.post({authorized:false})).status,403);assert.equal(writes,0);assert.equal((await(await f.post()).json()).processed,true);assert.equal(writes,1);assert.match(await f.verifyMedia(f.sourceOrigin+'/plant-900001.png'),/^[a-f0-9]{64}$/);
 for(const k of ['foreignBuilding','badMedia']){f.state[k]=true;try{assert.equal((await(await f.post()).json()).processed,false);}finally{f.state[k]=false;}}assert.equal(writes,1);
 }finally{await f.close();for(const[k,v]of[['ORULO_CLIENT_ID',oldId],['ORULO_CLIENT_SECRET',oldSecret]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
