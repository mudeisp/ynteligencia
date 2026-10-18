// Extracted unchanged from outputs/index-home-agent-fix-test.html; original deferred SDK queue.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


  window.OneSignalDeferred = window.OneSignalDeferred || [];


// Keep SDK work off the parser path; preserve its queue and original init callbacks.
(()=>{
 let started=false;
 function start(){if(started)return;started=true;
  const script=document.createElement('script');
  script.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';script.async=true;document.head.appendChild(script);
 }
 function schedule(){
  if('requestIdleCallback' in window)window.requestIdleCallback(start,{timeout:1500});
  else setTimeout(start,0);
 }
 if(document.readyState==='complete')schedule();
 else window.addEventListener('load',schedule,{once:true});
})();
