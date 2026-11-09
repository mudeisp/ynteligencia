// Read-only OAuth / floor-plan probe for five known Órulo building IDs.
// Requires ORULO_CLIENT_ID and ORULO_CLIENT_SECRET; never writes to Supabase.
import {createOruloSource,createImageChecker} from './orulo-v5-orulo-source.mjs';
const ids=['51496','41230','40580','5422','73923'];
const source=createOruloSource({clientId:process.env.ORULO_CLIENT_ID,clientSecret:process.env.ORULO_CLIENT_SECRET});
const check=createImageChecker();
let errors=0;
for(const buildingId of ids){
 try{
  const {floor_plans}=await source(buildingId);
  const candidates=floor_plans.filter(p=>p.image_url);
  const first=candidates[0];
  const verified=first?await check(first.image_url):false;
  const result={buildingId,plans:floor_plans.length,withImages:candidates.length,firstImageVerified:verified};
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!verified)errors++;
 }catch(error){
  process.stdout.write(JSON.stringify({buildingId,error:String(error?.message||'SOURCE_ERROR')})+'\n');
  errors++;
 }
}
if(errors)process.exitCode=1;
