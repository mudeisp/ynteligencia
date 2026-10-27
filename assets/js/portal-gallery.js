// Progressive enhancement: every photo remains present in SSR HTML.
const config=JSON.parse(document.getElementById('portal-data')?.textContent || '{}');
const photos=config.project?.photos || [],dialog=document.getElementById('gallery-dialog');
const rail=document.querySelector('[data-gallery-scroll]');
const progress=document.querySelector('[data-gallery-progress]');
let current=0,trigger=null,touchStartX=null;
function show(index) {
  if(!photos.length || !dialog)return;
  current=(index+photos.length)%photos.length;
  const image=document.getElementById('gallery-image');
  image.src=photos[current];image.alt=`${config.project.name} — foto ${current+1} de ${photos.length}`;
  document.getElementById('gallery-counter').textContent=`${current+1} / ${photos.length}`;
}
function updateRailProgress(){
  if(!rail || !progress)return;
  const max=Math.max(1,rail.scrollWidth-rail.clientWidth);
  progress.style.width=`${Math.min(100,Math.max(0,(rail.scrollLeft/max)*100))}%`;
}
function scrollRail(direction){
  if(!rail)return;
  rail.scrollBy({left:direction*Math.max(rail.clientWidth*.72,320),behavior:'smooth'});
}
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',event=>{
  if(!dialog || typeof dialog.showModal!=='function')return;
  event.preventDefault();trigger=button;show(Number(button.dataset.gallery));dialog.showModal();
}));
document.querySelector('[data-gallery-scroll-prev]')?.addEventListener('click',()=>scrollRail(-1));
document.querySelector('[data-gallery-scroll-next]')?.addEventListener('click',()=>scrollRail(1));
rail?.addEventListener('scroll',updateRailProgress,{passive:true});
rail?.addEventListener('keydown',event=>{
  if(event.key==='ArrowRight' || event.key==='ArrowLeft'){event.preventDefault();scrollRail(event.key==='ArrowRight'?1:-1);}
});
requestAnimationFrame(updateRailProgress);
dialog?.querySelector('[data-gallery-close]')?.addEventListener('click',()=>dialog.close());
dialog?.querySelector('[data-gallery-prev]')?.addEventListener('click',()=>show(current-1));
dialog?.querySelector('[data-gallery-next]')?.addEventListener('click',()=>show(current+1));
dialog?.addEventListener('keydown',event=>{
  if(event.key==='ArrowRight' || event.key==='ArrowLeft'){event.preventDefault();show(current+(event.key==='ArrowRight'?1:-1));}
});
dialog?.addEventListener('touchstart',event=>{touchStartX=event.changedTouches?.[0]?.clientX ?? null;},{passive:true});
dialog?.addEventListener('touchend',event=>{
  if(touchStartX===null)return;
  const end=event.changedTouches?.[0]?.clientX ?? touchStartX,diff=end-touchStartX;touchStartX=null;
  if(Math.abs(diff)>45)show(current+(diff<0?1:-1));
},{passive:true});
dialog?.addEventListener('close',()=>trigger?.focus());
document.querySelectorAll('[data-map]').forEach(button=>button.addEventListener('click',()=>{
  const frame=document.createElement('iframe');frame.src=button.dataset.map;frame.title='Localização do empreendimento';
  frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';frame.allowFullscreen=true;
  button.closest('.map-placeholder').replaceChildren(frame);
}));
