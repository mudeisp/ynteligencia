// Extracted unchanged from outputs/index-home-agent-fix-test.html; original GA4 then Meta initialization.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


  window.dataLayer = window.dataLayer || [];

  function gtag(){
    dataLayer.push(arguments);
  }

  gtag('js', new Date());
  gtag('config', 'G-Y2W11SX5VV');


  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;
    n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
    t=b.createElement(e);t.async=!0;t.src=v;
    s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', '1552958819302786');
  fbq('track', 'PageView');

