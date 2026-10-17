import ads from "./ads-intelligence.js";
import propertyHandoff from "./agent-property-handoff.js";

const NATIVE_KEY="property_handoff_v1";
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
export function isNativePropertyRequest(body){
  return own(body,"version")||own(body,"kind");
}

// Adapt only the transport. Token TTL, tracking, attribution and event projection
// continue through the existing Ads implementation, without a second writer.
export async function createPropertyHandoff(body,rest,now,options){
  const envelope=propertyHandoff.parseEnvelope(body);
  if(!envelope)return {status:400,body:{success:false,error:"handoff_malformed"}};
  const p=envelope.context.currentProperty;
  const tracking=body.tracking&&typeof body.tracking==="object"?body.tracking:{};
  const property={...p,property_id:p.external_id||"",inventory_source:p.inventory_source||p.source||"",
    development:tracking.property?.development||""};
  const legacy={visitor_id:envelope.visitorId,session_id:envelope.sessionId,source_product:"ynteligencia",
    return_origin:new URL(envelope.returnUrl).origin,property,current_property:property,
    declared_intent:tracking.declared_intent,current_touch:tracking.current_touch,attribution:tracking.attribution};
  const tokenStore=(path,request={})=>{
    if(path==="ads_handoffs"&&request.method==="POST"){
      return rest(path,{...request,body:{...request.body,context:{...request.body.context,[NATIVE_KEY]:envelope}}});
    }
    return rest(path,request);
  };
  return ads.createHandoff(legacy,tokenStore,now,options);
}

export function deliverPropertyHandoff(result){
  if(result.status!==200||!own(result.body?.context,NATIVE_KEY))return result;
  const envelope=propertyHandoff.parseEnvelope(result.body.context[NATIVE_KEY]);
  if(!envelope||envelope.visitorId!==result.body.visitor_id||envelope.sessionId!==result.body.session_id)
    return {status:400,body:{success:false,error:"handoff_malformed"}};
  // Root v1 is intentional: AGENTE recognizes it before its legacy parser.
  // Tracking/conversion attribution stays in the existing store/event path.
  return {status:200,body:{success:true,...envelope}};
}
