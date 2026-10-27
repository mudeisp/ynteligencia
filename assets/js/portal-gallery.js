// Small progressive enhancement: all photos and descriptions remain in SSR HTML.
const config=JSON.parse(document.getElementById('portal-data')?.textContent || '{}');
const photos=config.project?.photos || [],dialog=document.getElementById('gallery-dialog');
let current=0,trigger=null;
function show(index) {
  if(!photos.length || !dialog)return;
  current=(index+photos.length)%photos.length;
  const image=document.getElementById('gallery-image');
  image.src=photos[current];image.alt=`${config.project.name} — foto ${current+1} de ${photos.length}`;
  document.getElementById('gallery-counter').textContent=`${current+1} / ${photos.length}`;
}
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',event=>{
  if(!dialog || typeof dialog.showModal!=='function')return;
  event.preventDefault();trigger=button;show(Number(button.dataset.gallery));dialog.showModal();
}));
dialog?.querySelector('[data-gallery-close]')?.addEventListener('click',()=>dialog.close());
dialog?.querySelector('[data-gallery-prev]')?.addEventListener('click',()=>show(current-1));
dialog?.querySelector('[data-gallery-next]')?.addEventListener('click',()=>show(current+1));
dialog?.addEventListener('keydown',event=>{
  if(event.key==='ArrowRight' || event.key==='ArrowLeft'){event.preventDefault();show(current+(event.key==='ArrowRight'?1:-1));}
});
dialog?.addEventListener('close',()=>trigger?.focus());
document.querySelectorAll('[data-map]').forEach(button=>button.addEventListener('click',()=>{
  const frame=document.createElement('iframe');frame.src=button.dataset.map;frame.title='Localização do empreendimento';
  frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';frame.allowFullscreen=true;
  button.closest('.map-placeholder').replaceChildren(frame);
}));
