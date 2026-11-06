import {createServer} from 'node:http';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createWebhookHandler} from '../../lib/orulo-webhook-core.js';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6JpEAAAAASUVORK5CYII=','base64');
const digest=b=>createHash('sha256').update(b).digest('hex');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
export async function syntheticWebhook({writer,buildingId}){
 const state={price:100,foreignBuilding:false,badMedia:false},secret=randomBytes(32),sourceImageHash=digest(image);
 let sourceOrigin;const source=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/plant-900001.png'){res.setHeader('Content-Type','image/png');return res.end(image);}
  if(req.url==='/oauth/token'&&req.method==='POST')return res.end(JSON.stringify({access_token:'synthetic-source-only'}));
  if(req.headers.authorization!=='Bearer synthetic-source-only'){res.statusCode=401;return res.end('{}');}
  if(req.url.includes('/images?'))return res.end(JSON.stringify({images:[]}));
  if(req.url.endsWith('/typologies'))return res.end(JSON.stringify({typologies:[{id:1,stock:2,private_area:40,original_price:state.price}]}));
  res.end(JSON.stringify({id:state.foreignBuilding?String(Number(buildingId)+1):buildingId,name:'V9 synthetic building',finality:'residencial',address:{state:'SP',city:'Synthetic City'},videos:['synthetic-video'],virtual_tour:'synthetic-tour',floor_plans:[{id:'900001',image_url:sourceOrigin+(state.badMedia?'/wrong-plant.png':'/plant-900001.png')}]}));
 });
 sourceOrigin=await listen(source);
 const sourceRequest=async(input,options)=>{
  const u=new URL(input);if(u.origin!=='https://www.orulo.com.br')throw Error('V9_SYNTHETIC_SOURCE_ONLY');
  const response=await fetch(sourceOrigin+u.pathname+u.search,{...options,signal:AbortSignal.timeout(5000)});
  if(/^\/api\/v2\/buildings\/\d+$/.test(u.pathname)&&response.ok){
   const b=await response.clone().json();
   if(String(b.id)!==buildingId||b.floor_plans.some(p=>p.id!=='900001'||p.image_url!==sourceOrigin+'/plant-900001.png'))throw Error('V9_SYNTHETIC_MEDIA_BINDING_MISMATCH');
  }
  return response;
 };
 const handler=createWebhookHandler({writer,sourceRequest});
 const ingress=createServer(async(req,res)=>{
  const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>16384){res.statusCode=413;res.end();return;}chunks.push(b);}
  const body=Buffer.concat(chunks),actual=Buffer.from(req.headers['x-v9-signature']||'','hex'),expected=createHmac('sha256',secret).update(body).digest();
  if(req.method!=='POST'||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.statusCode=403;return res.end('{}');}
  let payload;try{payload=JSON.parse(body);}catch{res.statusCode=400;return res.end('{}');}
  if(String(payload.properties?.building_id)!==buildingId){res.statusCode=403;return res.end('{}');}
  // Native HTTP bridge around the existing handler; no separate recovery engine.
  const bridge={setHeader:(k,v)=>res.setHeader(k,v),status(code){res.statusCode=code;return this;},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}};
  try{await handler({method:'POST',headers:{},body:payload},bridge);}catch{res.statusCode=500;res.end('{}');}
 });
 const origin=await listen(ingress);
 return{state,sourceOrigin,sourceImageHash,
  async post({authorized=true,status='active'}={}){const body=JSON.stringify({name:'BUILDING_UPDATE',properties:{building_id:buildingId,status}});return fetch(origin,{method:'POST',headers:{'Content-Type':'application/json','x-v9-signature':authorized?createHmac('sha256',secret).update(body).digest('hex'):'00'},body,signal:AbortSignal.timeout(15000)});},
  async verifyMedia(url){if(url!==sourceOrigin+'/plant-900001.png')throw Error('V9_MEDIA_URL_MISMATCH');const response=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!response.ok||digest(Buffer.from(await response.arrayBuffer()))!==sourceImageHash)throw Error('V9_MEDIA_BYTES_MISMATCH');return sourceImageHash;},
  async close(){await Promise.all([source,ingress].map(server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})));}
 };
}
