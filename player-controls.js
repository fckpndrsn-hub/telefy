/* Reflect the actual player flags without changing playback or toggle handlers. */
(() => {
  const entries=[
    ['btn-full-repeat',()=>isRepeat,{ru:'Повтор',en:'Repeat'}],
    ['btn-full-lyrics',()=>lyricsOpen,{ru:'Текст',en:'Lyrics'}],
    ['btn-full-shuffle',()=>isShuffle,{ru:'Вперемешку',en:'Shuffle'}]
  ];
  function sync(){
    const english=state.lang==='en';
    for(const [id,getValue,names] of entries){
      const button=document.getElementById(id);if(!button)continue;
      const active=Boolean(getValue());
      button.setAttribute('aria-pressed',String(active));
      const label=(english?names.en:names.ru)+': '+(english?(active?'on':'off'):(active?'включено':'выключено'));
      button.setAttribute('aria-label',label);button.title=label;
    }
  }
  for(const [id] of entries){
    const button=document.getElementById(id);if(!button)continue;
    // Core click handlers were registered first and update the flags before sync.
    button.addEventListener('click',sync);
    new MutationObserver(sync).observe(button,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  }
  sync();
})();
