const preview=document.body.dataset.preview==='true';
if(!preview){window.dataLayer=window.dataLayer || [];window.gtag=window.gtag || function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());window.gtag('config','G-Y2W11SX5VV');const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id=G-Y2W11SX5VV';document.head.append(script);}
const form=document.getElementById('rental-lead');
function track(name,details={}){if(!preview && typeof window.gtag==='function')window.gtag('event',name,{operation:'LOCACAO',...details});}
track('rental_page_view',{property_id:form?.dataset.id || '',page_path:location.pathname});
document.querySelectorAll('.card a').forEach(a=>a.addEventListener('click',()=>track('rental_property_click',{property_path:a.getAttribute('href')})));
form?.addEventListener('submit',async event=>{
  event.preventDefault();const feedback=document.getElementById('rental-feedback'),button=form.querySelector('button');
  if(preview){feedback.textContent='Prévia: envio desativado. Nenhum contato foi registrado.';return;}
  if(button.disabled)return;
  const phone=form.elements.telefone.value.replace(/\D/g,'');if(phone.length<10 || phone.length>15){feedback.textContent='Informe um WhatsApp válido com DDD.';return;}
  button.disabled=true;feedback.textContent='Registrando seu interesse…';
  const params=new URLSearchParams(location.search),attribution={};for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'])if(params.has(key))attribution[key]=params.get(key);
  const message=`Interesse em LOCAÇÃO | ${form.dataset.name} | ${form.dataset.neighborhood} | Aluguel mensal R$ ${form.dataset.price} | Imóvel ${form.dataset.id}`;
  const payload={nome:form.elements.nome.value.trim(),telefone:phone,email:form.elements.email.value.trim(),origem:'portal_locacao',perfil:'Locação',pagina:location.href,empreendimento:form.dataset.name,property_id:form.dataset.id,property_value:Number(form.dataset.price),neighborhood:form.dataset.neighborhood,inventory_source:'nonstop',mensagem:message,...attribution};
  try{
    const response=await fetch('/api/portal/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)}),data=await response.json();
    if(!response.ok || data.success!==true || data.supabase!==true)throw Error('not_saved');
    feedback.textContent='Interesse registrado. ';const link=document.createElement('a');link.textContent='Continuar no WhatsApp →';link.href='https://wa.me/5511992976368?text='+encodeURIComponent(`Olá, meu nome é ${payload.nome}. ${message}`);link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',()=>track('rental_whatsapp_click',{property_id:form.dataset.id}));feedback.append(link);track('rental_lead_created',{property_id:form.dataset.id});button.textContent='Interesse enviado';
  }catch{feedback.textContent='Não foi possível registrar. Tente novamente.';button.disabled=false;}
});
