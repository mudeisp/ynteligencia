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
function selectedPlanIndex(){const current=options.find(button=>button.getAttribute('aria-pressed')==='true');return current?Number(current.dataset.artPlan):0;}
document.querySelector('[data-plan-prev]')?.addEventListener('click',()=>{if(!options.length)return;const current=selectedPlanIndex(),ordered=options.map(button=>Number(button.dataset.artPlan)).sort((a,b)=>a-b),at=ordered.indexOf(current);choose(ordered[(at-1+ordered.length)%ordered.length]);});
document.querySelector('[data-plan-next]')?.addEventListener('click',()=>{if(!options.length)return;const current=selectedPlanIndex(),ordered=options.map(button=>Number(button.dataset.artPlan)).sort((a,b)=>a-b),at=ordered.indexOf(current);choose(ordered[(at+1)%ordered.length]);});
const planStyles=document.createElement('style');planStyles.textContent=`
.art-plan-families{max-width:1180px;margin:-25px auto 48px;padding:24px 0;border-top:1px solid #cbd0c6;border-bottom:1px solid #cbd0c6}.art-plan-families>p:last-child{margin-top:10px;font:400 20px/1.45 var(--art-serif);letter-spacing:-.02em}.art-plan-actions{display:flex;justify-content:space-between;gap:20px;margin:22px 0 24px}.art-plan-canvas>.button.secondary{margin-top:8px}.art-availability-details>summary{font-family:var(--art-serif);font-size:clamp(24px,2.4vw,38px);letter-spacing:-.025em}.art-location-context{margin-top:18px;font:400 22px/1.3 var(--art-serif);letter-spacing:-.02em;color:#334842}@media(max-width:760px){.art-plan-families{margin:-20px 20px 30px;padding:18px 0}.art-plan-families>p:last-child{font-size:17px}.art-plan-actions{position:sticky;bottom:76px;background:#e7e8e1;padding:10px 0;z-index:2}.art-plan-actions .editorial-link{font-size:9px}.art-plan-canvas>.button.secondary{width:100%;margin-top:8px}.art-availability-details>summary{font-size:27px;line-height:1.08}}
`;document.head.append(planStyles);
const availabilityDetails=document.querySelector('.art-availability-details');
if(availabilityDetails){const summary=availabilityDetails.querySelector('summary'),count=summary?.querySelector('span')?.textContent?.trim();if(summary)summary.innerHTML=`Escolha sua configuração${count?` <span>${count}</span>`:''}`;}
const locationLeft=document.querySelector('.art-location-layout>div:first-child'),crumbs=[...document.querySelectorAll('.breadcrumbs li a')];
if(locationLeft && crumbs.length>1){const neighborhood=crumbs.at(-1),city=crumbs.at(-2);if(neighborhood && city && neighborhood.textContent.trim()!==city.textContent.trim()){const context=document.createElement('p');context.className='art-location-context';context.textContent=`Mais possibilidades em ${neighborhood.textContent.trim()}.`;const link=document.createElement('a');link.href=neighborhood.getAttribute('href');link.textContent=`Explorar ${neighborhood.textContent.trim()} ↗`;locationLeft.append(context,link);}}
const dialog=document.getElementById('art-image-dialog');let origin=null;
document.querySelectorAll('[data-art-image]').forEach(button=>button.addEventListener('click',()=>{
  if(!dialog)return;origin=button;const img=document.getElementById('art-image-full');img.src=button.dataset.artImage;img.alt=button.dataset.artCaption;
  document.getElementById('art-image-caption').textContent=button.dataset.artCaption;dialog.showModal();
}));
document.querySelector('[data-art-close]')?.addEventListener('click',()=>dialog.close());dialog?.addEventListener('close',()=>origin?.focus());
function configuredEmbed(raw,{autoplay=false,muted=false,jsapi=false}={}){
  try{
    const url=new URL(raw,location.href),host=url.hostname.replace(/^www\./,'');
    if(host==='youtube.com' && url.pathname.startsWith('/embed/')){
      url.searchParams.set('playsinline','1');url.searchParams.set('rel','0');
      if(autoplay)url.searchParams.set('autoplay','1');
      if(muted)url.searchParams.set('mute','1');
      if(jsapi){url.searchParams.set('enablejsapi','1');url.searchParams.set('origin',location.origin);url.searchParams.set('widget_referrer',location.href);}
      return url.href;
    }
    if(host==='player.vimeo.com' && url.pathname.startsWith('/video/')){
      url.searchParams.set('playsinline','1');if(autoplay)url.searchParams.set('autoplay','1');if(muted)url.searchParams.set('muted','1');return url.href;
    }
    return url.href;
  }catch{return raw;}
}
function youtubeWatchUrl(raw){
  try{const url=new URL(raw),id=url.hostname.replace(/^www\./,'')==='youtube.com' && url.pathname.startsWith('/embed/')?url.pathname.split('/').filter(Boolean)[1]:'';return id?`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`:'';}catch{return '';}
}
document.querySelectorAll('[data-art-video]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.artVideoEmbed!=='true'){window.open(button.dataset.artVideo,'_blank','noopener,noreferrer');return;}
  const container=document.querySelector('[data-art-player]');if(!container)return;
  const src=configuredEmbed(button.dataset.artVideo,{autoplay:true}),frame=document.createElement('iframe');frame.src=src;frame.title=button.dataset.artVideoTitle;frame.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='origin-when-cross-origin';
  const fallback=youtubeWatchUrl(button.dataset.artVideo),wrap=document.createElement('div');wrap.className='art-video-runtime';wrap.append(frame);
  if(fallback){const link=document.createElement('a');link.href=fallback;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir no YouTube ↗';link.style.cssText='display:block;margin-top:10px;text-align:right;font:500 10px/1.2 var(--sans);letter-spacing:.1em';wrap.append(link);}
  container.replaceChildren(wrap);frame.focus();
}));
const sound=document.querySelector('[data-art-sound]'),heroVideo=document.querySelector('[data-hero-video]');
if(heroVideo){const frame=heroVideo.querySelector('iframe');if(frame)frame.src=configuredEmbed(frame.src,{autoplay:true,muted:true,jsapi:true});}
if(sound && heroVideo){
  sound.addEventListener('click',()=>{
    const frame=heroVideo.querySelector('iframe'),provider=heroVideo.dataset.videoProvider,enabled=sound.getAttribute('aria-pressed')==='true';
    if(!frame?.contentWindow)return;
    if(provider==='youtube'){
      const command=(func,args=[])=>frame.contentWindow.postMessage(JSON.stringify({event:'command',func,args}),'*');
      command(enabled?'mute':'unMute');if(!enabled){command('setVolume',[100]);command('playVideo');}
    }else if(provider==='vimeo'){
      frame.contentWindow.postMessage({method:'setMuted',value:enabled},'*');
      if(!enabled){frame.contentWindow.postMessage({method:'setVolume',value:1},'*');frame.contentWindow.postMessage({method:'play'},'*');}
    }
    sound.setAttribute('aria-pressed',String(!enabled));sound.textContent=enabled?'ATIVAR SOM':'DESATIVAR SOM';
  });
}
const availability=document.querySelector('[data-contact-start]');
if(availability){let queued=false;const update=()=>{document.body.classList.toggle('art-contact-visible',availability.getBoundingClientRect().top<innerHeight*.7);queued=false;};window.addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update);}},{passive:true});update();}

// Intrinsic dimensions are used only when the source has no reviewed orientation metadata.
const cover=document.querySelector('[data-cover-orientation="auto"]'),coverImage=cover?.querySelector('.art-cover-image img');
function fitCover(){if(!coverImage?.naturalWidth)return;const ratio=coverImage.naturalWidth/coverImage.naturalHeight;cover.style.setProperty('--photo-ratio',String(ratio));cover.classList.remove('art-cover--auto');cover.classList.add(ratio>1.25?'art-cover--landscape':'art-cover--portrait');cover.dataset.coverOrientation=ratio>1.25?'landscape':'portrait';}
if(coverImage){coverImage.addEventListener('load',fitCover,{once:true});if(coverImage.complete)fitCover();}