// Progressive enhancement: every photo remains present in SSR HTML.
const config=JSON.parse(document.getElementById('portal-data')?.textContent || '{}');
const photos=config.project?.photos || [],dialog=document.getElementById('gallery-dialog');
const rail=document.querySelector('[data-gallery-scroll]');
const progress=document.querySelector('[data-gallery-progress]');
const autoplayToggle=document.querySelector('[data-gallery-autoplay-toggle]');
let current=0,trigger=null,touchStartX=null,autoplayTimer=null,autoplayPaused=false;
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
  const atEnd=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-8;
  if(direction>0 && atEnd)rail.scrollTo({left:0,behavior:'smooth'});
  else rail.scrollBy({left:direction*Math.max(rail.clientWidth*.72,320),behavior:'smooth'});
}
function setAutoplayPaused(value){
  autoplayPaused=value;
  if(autoplayToggle){autoplayToggle.textContent=value?'Reproduzir':'Pausar';autoplayToggle.setAttribute('aria-pressed',String(value));}
}
function startAutoplay(){
  if(!rail || photos.length<2 || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  clearInterval(autoplayTimer);
  autoplayTimer=setInterval(()=>{if(!autoplayPaused && !document.hidden)scrollRail(1);},3600);
}
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',event=>{
  if(!dialog || typeof dialog.showModal!=='function')return;
  event.preventDefault();trigger=button;show(Number(button.dataset.gallery));dialog.showModal();setAutoplayPaused(true);
}));
document.querySelector('[data-gallery-scroll-prev]')?.addEventListener('click',()=>{scrollRail(-1);setAutoplayPaused(true);});
document.querySelector('[data-gallery-scroll-next]')?.addEventListener('click',()=>{scrollRail(1);setAutoplayPaused(true);});
autoplayToggle?.addEventListener('click',()=>setAutoplayPaused(!autoplayPaused));
rail?.addEventListener('scroll',updateRailProgress,{passive:true});
rail?.addEventListener('mouseenter',()=>setAutoplayPaused(true));
rail?.addEventListener('mouseleave',()=>setAutoplayPaused(false));
rail?.addEventListener('pointerdown',()=>setAutoplayPaused(true),{passive:true});
rail?.addEventListener('focusin',()=>setAutoplayPaused(true));
rail?.addEventListener('focusout',()=>setAutoplayPaused(false));
rail?.addEventListener('keydown',event=>{
  if(event.key==='ArrowRight' || event.key==='ArrowLeft'){event.preventDefault();scrollRail(event.key==='ArrowRight'?1:-1);setAutoplayPaused(true);}
});
requestAnimationFrame(()=>{updateRailProgress();startAutoplay();});
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
dialog?.addEventListener('close',()=>{trigger?.focus();setAutoplayPaused(false);});
const planDialog=document.getElementById('plan-dialog'),planImage=document.getElementById('plan-dialog-image'),planTitle=document.getElementById('plan-dialog-title');
document.querySelectorAll('[data-plan-image]').forEach(button=>button.addEventListener('click',()=>{
  if(!planDialog || !planImage)return;
  planImage.src=button.dataset.planImage;planImage.alt=button.dataset.planTitle || 'Planta do empreendimento';if(planTitle)planTitle.textContent=button.dataset.planTitle || 'Planta do empreendimento';planDialog.showModal();
}));
planDialog?.querySelector('[data-plan-close]')?.addEventListener('click',()=>planDialog.close());
document.querySelectorAll('[data-map]').forEach(button=>button.addEventListener('click',()=>{
  const frame=document.createElement('iframe');frame.src=button.dataset.map;frame.title='Localização do empreendimento';
  frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';frame.allowFullscreen=true;
  button.closest('.map-placeholder').replaceChildren(frame);
}));
