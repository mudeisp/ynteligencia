// Uses the existing app API; no new destination or lead storage is introduced.
export async function submitInterest(payload,{request=fetch}={}) {
  const response=await request('/api/portal/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok || result?.success!==true || result?.supabase!==true)throw new Error('Não foi possível confirmar o registro. Tente novamente; seus dados continuam no formulário.');
  return result;
}
