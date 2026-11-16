/* Max entitlement is read from the authenticated backend, never granted by a button. */
(() => {
 let verified=null,syncedAt=0,serverAt=0,loading=null,wasActive=false,verifiedUser=null;
 const userKey=()=>String(window.TelefyProfile?.user?.telegram_id||'local');
 const clock=()=>serverAt+(performance.now()-syncedAt)/1000;
 const active=()=>Boolean(verifiedUser===userKey()&&verified?.active&&verified.expires_at>clock());
 Object.defineProperty(state,'isMaxSubscribed',{configurable:false,enumerable:true,get:active,set(){}});
 function paint(){
  const yes=active(),date=verified?.expires_at?new Date(verified.expires_at*1000).toLocaleDateString(state.lang==='en'?'en-GB':'ru-RU'):'';
  const text=state.lang==='en'?(yes?'Active until '+date:'Max is not active'):(yes?'Подписка активна до '+date:'Подписка не активна');
  const status=document.getElementById('max-status-text');if(status)status.textContent=yes?text:(state.lang==='en'?'99 ₽ for one month. No automatic charges.':'99 ₽ за месяц. Без автосписаний.');
  const pill=document.getElementById('max-active-until-pill');if(pill)pill.textContent=text;
  document.querySelector('[data-i18n="maxRowExpireDate"]')?.replaceChildren(document.createTextNode(date||'—'));
  const label=document.querySelector('[data-i18n="maxRowExpireTitle"]');if(label)label.textContent=state.lang==='en'?'Access expires':'Срок действия подписки';
 }
 const oldRender=renderMaxBetaView;renderMaxBetaView=function(...args){const r=oldRender(...args);paint();return r;};
 const oldTranslations=applyTranslations;applyTranslations=function(...args){const r=oldTranslations(...args);paint();return r;};
 async function refresh(){
  if(loading)return loading;
  const user=userKey();loading=(async()=>{try{const r=await fetch('/api/max/status',{cache:'no-store'});if(!r.ok){if(r.status===401)verified=null;throw Error('max_status');}const data=await r.json();if(userKey()!==user)return;verified=data;verifiedUser=user;serverAt=Number(data.server_time)||0;syncedAt=performance.now();if(active()&&!wasActive){buildPersonalPlaylists();closeUpsellModal();}wasActive=active();renderAll();}catch(_){if(!active()){verified=null;wasActive=false;}renderMaxBetaView();}finally{loading=null;if(userKey()!==user)refresh();}})();return loading;
 }
 let buying=false,poll=null;
 async function purchase(){
  if(buying)return;buying=true;triggerHaptic('light');
  try{const r=await fetch('/api/max/checkout-link?theme='+encodeURIComponent(state.theme==='dark'?'dark':'light'),{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error==='payments_not_configured'?'Приём оплаты пока не подключён.':d.error==='login_required'?'Открой приложение через Telegram.':'Не удалось открыть оплату. Попробуй ещё раз.');
   const url=new URL(d.url);if(url.protocol!=='https:'||url.origin!==location.origin)throw Error('Не удалось открыть оплату.');
   if(window.Telegram?.WebApp?.openLink)Telegram.WebApp.openLink(url.href);else window.open(url.href,'_blank','noopener,noreferrer');
   clearInterval(poll);let n=0;poll=setInterval(()=>{refresh();if(++n>=12||active())clearInterval(poll);},5000);
  }catch(e){showToast(e.message);}finally{buying=false;}
 }
 window.TelefyMax={refresh,purchase,get active(){return active();}};
 window.addEventListener('telefy:profile-ready',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&window.TelefyProfile?.user)refresh();});
 setInterval(()=>{if(verified&&wasActive&&!active()){wasActive=false;for(const [id,close]of [['library-modal',closeLibraryModal],['create-playlist-modal',closeCreatePlaylistModal]]){if(!document.getElementById(id)?.classList.contains('hidden'))close();}if(USER_PLAYLISTS.some(p=>p.id===state.activeCollectionId))closeCollectionModal();if(state.searchFilter==='liked')state.searchFilter='all';renderAll();}},1000);
 if(window.TelefyProfile?.user)refresh();paint();
})();
