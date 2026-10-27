// Presentation only. No changes to lead, visitor, session or attribution logic.
const config=JSON.parse(document.getElementById('portal-data')?.textContent || '{}');
const photos=config.project?.photos || [],dialog=document.getElementById('gallery-dialog');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let current=0,trigger=null,touchX=null;
function show(index){
  if(!photos.length || !dialog)return;
  current=(index+photos.length)%photos.length;
  const img=document.getElementById('gallery-image');img.src=photos[current];img.alt=`${config.project.name} — foto ${current+1} de ${photos.length}`;
  document.getElementById('gallery-counter').textContent=`${current+1} / ${photos.length}`;
}
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',()=>{if(!dialog)return;trigger=button;show(Number(button.dataset.gallery));dialog.showModal();}));
dialog?.querySelector('[data-gallery-close]')?.addEventListener('click',()=>dialog.close());
dialog?.querySelector('[data-gallery-prev]')?.addEventListener('click',()=>show(current-1));
dialog?.querySelector('[data-gallery-next]')?.addEventListener('click',()=>show(current+1));
dialog?.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();show(current+(e.key==='ArrowRight'?1:-1));}});
dialog?.addEventListener('close',()=>trigger?.focus());
dialog?.addEventListener('touchstart',e=>{touchX=e.changedTouches?.[0]?.clientX??null;},{passive:true});
dialog?.addEventListener('touchend',e=>{if(touchX===null)return;const delta=(e.changedTouches?.[0]?.clientX??touchX)-touchX;touchX=null;if(Math.abs(delta)>45)show(current+(delta<0?1:-1));},{passive:true});
function railControls(rail,prev,next){
  if(!rail)return;
  const move=direction=>rail.scrollBy({left:direction*rail.clientWidth*.8,behavior:reduced?'instant':'smooth'});
  document.querySelector(prev)?.addEventListener('click',()=>move(-1));document.querySelector(next)?.addEventListener('click',()=>move(1));
  rail.addEventListener('keydown',e=>{if(e.target===rail && ['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(e.key==='ArrowRight'?1:-1);}});
}
railControls(document.querySelector('[data-gallery-scroll]'),'[data-gallery-scroll-prev]','[data-gallery-scroll-next]');
railControls(document.getElementById('plant-rail'),'[data-plan-prev]','[data-plan-next]');
const planDialog=document.getElementById('plan-dialog');let planTrigger=null;
document.querySelectorAll('[data-plan-image]').forEach(button=>button.addEventListener('click',()=>{
  if(!planDialog)return;planTrigger=button;const img=document.getElementById('plan-dialog-image');img.src=button.dataset.planImage;img.alt=button.dataset.planTitle;
  document.getElementById('plan-dialog-title').textContent=button.dataset.planTitle;planDialog.showModal();
}));
planDialog?.querySelector('[data-plan-close]')?.addEventListener('click',()=>planDialog.close());planDialog?.addEventListener('close',()=>planTrigger?.focus());
document.querySelectorAll('[data-map]').forEach(button=>button.addEventListener('click',()=>{
  const frame=document.createElement('iframe');frame.src=button.dataset.map;frame.title='Localização do empreendimento';frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';frame.allowFullscreen=true;
  button.closest('.map-placeholder').replaceChildren(frame);
}));
