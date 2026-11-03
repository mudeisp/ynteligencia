// Read-only, Preview-only diagnostic. Never exposes credentials or provider contacts.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(process.env.VERCEL_ENV!=='preview')return res.status(404).end();
  if(req.method!=='GET')return res.status(405).end();
  const offset=Math.max(0,parseInt(req.query?.offset||'0',10)||0);
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  try{
    const response=await fetch(`${process.env.SUPABASE_URL}/rest/v1/rental_properties?select=id,property_url,image_url&order=id.asc&limit=5&offset=${offset}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('inventory');
    const rows=await response.json();
    const results=await Promise.all(rows.map(async row=>{
      const code=new URL(row.property_url).pathname.split('/').pop();
      if(!/^[A-Z0-9]+$/i.test(code))return {id:row.id,error:'code'};
      const r=await fetch(`https://www.usenonstop.com/api/unstable/imoveis/${code}`,{headers:{Authorization:`Bearer ${process.env.NONSTOP_API_TOKEN}`},signal:AbortSignal.timeout(20000)});
      if(!r.ok)return {id:row.id,status:r.status};
      const p=await r.json();
      return {id:row.id,code,provider_id:p.id,keys:Object.keys(p),media:p.media,images:p.images,description:p.description,parkingLots:Array.isArray(p.parkingLots)?p.parkingLots.length:p.parkingLots};
    }));
    return res.status(200).json({offset,results});
  }catch{return res.status(502).json({error:'Media audit unavailable'});}
}