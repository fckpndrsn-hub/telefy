/* Telegram safe areas and fullscreen gesture policy. */
(() => {
  let initialized=false;
  function initialize(){
    if(initialized)return;
    const tg=window.Telegram?.WebApp;
    if(!tg)return;
    initialized=true;
    if(!tg.initData && !['ios','android','tdesktop','macos','web','weba','webk'].includes(tg.platform))return;
    const root=document.documentElement;
    root.classList.add('in-telegram');
    const px=value=>Math.max(0,Math.min(200,Number(value)||0))+'px';
    let exitingFullscreen=false;
    function sync(){
      const android=tg.platform==='android';
      root.classList.toggle('telefy-android',android);
      root.classList.toggle('telefy-fullscreen',!android && tg.isFullscreen===true);
      // Android uses Telegram's ordinary expanded viewport, not fullscreen.
      if(android && tg.isFullscreen && !exitingFullscreen){
        try{if(tg.exitFullscreen && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0'))){exitingFullscreen=true;tg.exitFullscreen();}}catch(_){exitingFullscreen=false;}
      }
      if(!tg.isFullscreen)exitingFullscreen=false;
      // Native content scrolling stays available. Telegram retains its own
      // header close/minimize gestures; only competing content swipes stop.
      try{
        if(tg.disableVerticalSwipes && (!tg.isVersionAtLeast || tg.isVersionAtLeast('7.7')) && tg.isVerticalSwipesEnabled!==false)tg.disableVerticalSwipes();
      }catch(_){}

      for(const side of ['top','bottom','left','right']){
        root.style.setProperty('--telefy-device-'+side,px(tg.safeAreaInset?.[side]));
        root.style.setProperty('--telefy-controls-'+side,px(tg.contentSafeAreaInset?.[side]));
      }
      if(tg.viewportStableHeight>0)root.style.setProperty('--telefy-viewport',tg.viewportStableHeight+'px');
      try{
        const color=getComputedStyle(document.body).getPropertyValue('--bg-app').trim();
        if(/^#[\da-f]{6}$/i.test(color)){tg.setHeaderColor?.(color);tg.setBackgroundColor?.(color);}
      }catch(_){}
    }
    for(const event of ['safeAreaChanged','contentSafeAreaChanged','viewportChanged','fullscreenChanged'])tg.onEvent?.(event,sync);
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
    tg.ready?.();sync();
    // Keyboard launches may start compact; expand every supported client.
    try{tg.expand?.();}catch(_){}
    if(tg.platform==='ios'&&tg.requestFullscreen&&(!tg.isVersionAtLeast||tg.isVersionAtLeast('8.0'))){try{tg.requestFullscreen();}catch(_){}}

  }
  if(window.Telegram?.WebApp){initialize();return;}
  const existing=document.querySelector('script[src^="https://telegram.org/js/telegram-web-app.js"]');
  if(existing){existing.addEventListener('load',initialize,{once:true});return;}
  const sdk=document.createElement('script');sdk.src='https://telegram.org/js/telegram-web-app.js';sdk.onload=initialize;
  document.head.append(sdk);
})();
