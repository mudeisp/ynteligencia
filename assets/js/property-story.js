// Art-direction interactions only. No business APIs, forms, tracking, storage or writes.
const options=[...document.querySelectorAll('[data-art-plan]')],select=document.getElementById('art-plan-select');
function choose(index){
  const option=options.find(button=>Number(button.dataset.artPlan)===index),zoom=document.querySelector('.art-plan-zoom');if(!option || !zoom)return;
  options.forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.artPlan)===index)));
  if(select)select.value=String(index);
  document.querySelectorAll('[data-art-plan-group]').forEach(group=>{group.open=group.contains(option);});
  zoom.dataset.planImage=option.dataset.artPlanImage;zoom.dataset.planTitle=option.dataset.artPlanTitle;
  const img=zoom.querySelector('img');img.src=option.dataset.artPlanImage;img.alt=option.dataset.artPlanTitle;
  document.querySelector('[data-art-selected-plan-title]').textContent=option.dataset.artPlanTitle;
  document.querySelector('[data-art-plan-counter]').textContent=`${String(index+1).padStart(2,'0')} / ${options.length}`;
  document.querySelector('[data-art-plan-metrics-text]').textContent=option.dataset.artPlanMetrics;
}
options.forEach(button=>button.addEventListener('click',()=>choose(Number(button.dataset.artPlan))));select?.addEventListener('change',()=>choose(Number(select.value)));
const dialog=document.getElementById('art-image-dialog');let origin=null;
document.querySelectorAll('[data-art-image]').forEach(button=>button.addEventListener('click',()=>{
  if(!dialog)return;origin=button;const img=document.getElementById('art-image-full');img.src=button.dataset.artImage;img.alt=button.dataset.artCaption;
  document.getElementById('art-image-caption').textContent=button.dataset.artCaption;dialog.showModal();
}));
document.querySelector('[data-art-close]')?.addEventListener('click',()=>dialog.close());dialog?.addEventListener('close',()=>origin?.focus());
document.querySelectorAll('[data-art-video]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.artVideoEmbed!=='true'){window.open(button.dataset.artVideo,'_blank','noopener,noreferrer');return;}
  const container=document.querySelector('[data-art-player]');if(!container)return;
  const frame=document.createElement('iframe');frame.src=button.dataset.artVideo;frame.title=button.dataset.artVideoTitle;frame.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
  container.replaceChildren(frame);frame.focus();
}));
const availability=document.querySelector('[data-contact-start]');
if(availability){let queued=false;const update=()=>{document.body.classList.toggle('art-contact-visible',availability.getBoundingClientRect().top<innerHeight*.7);queued=false;};window.addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update);}},{passive:true});update();}

// Intrinsic dimensions are used only when the source has no reviewed orientation metadata.
const cover=document.querySelector('[data-cover-orientation="auto"]'),coverImage=cover?.querySelector('.art-cover-image img');
function fitCover(){if(!coverImage?.naturalWidth)return;const ratio=coverImage.naturalWidth/coverImage.naturalHeight;cover.style.setProperty('--photo-ratio',String(ratio));cover.classList.remove('art-cover--auto');cover.classList.add(ratio>1.25?'art-cover--landscape':'art-cover--portrait');cover.dataset.coverOrientation=ratio>1.25?'landscape':'portrait';}
if(coverImage){coverImage.addEventListener('load',fitCover,{once:true});if(coverImage.complete)fitCover();}
