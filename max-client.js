/* Official Telegram invoice; client callbacks never grant access. */
(()=>{
 let verified=null,account='',synced=0,clockAt=0,loading=null,buying=false,sheet=null,hadMax=false;
 const user=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const active=()=>Boolean(verified&&account===user()&&verified.active&&verified.expires_at>clockAt+(performance.now()-synced)/1000);
 Object.defineProperty(state,'isMaxSubscribed',{enumerable:true,get:active,set(){}});
 function paint(){
  document.documentElement.dataset.maxMode='paid';const yes=active(),english=state.lang==='en';
  const date=yes?new Date(verified.expires_at*1000).toLocaleDateString(english?'en-GB':'ru-RU'):'';
  for(const id of ['max-status-text','max-active-until-pill']){const el=document.getElementById(id);if(el)el.textContent=yes?(english?'Active until '+date:'Подписка активна до '+date):(english?'100 Stars · 30 days':'100 звёзд · 30 дней');}
  for(const id of ['btn-subscribe-max-label','btn-renew-max','btn-modal-subscribe-max']){const el=document.getElementById(id);if(el){el.hidden=false;el.disabled=false;el.textContent=english?(yes?'Extend for 100 Stars':'Get Max for 100 Stars'):(yes?'Продлить за 100 звёзд':'Подключить за 100 звёзд');}}
  const subscribe=document.getElementById('btn-modal-subscribe-max');
  if(subscribe){
   const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 52 50');icon.setAttribute('width','19');icon.setAttribute('height','19');icon.setAttribute('aria-hidden','true');icon.style.flexShrink='0';
   const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',"M28.1123 4.40853C27.1797 2.53559 24.5117 2.52795 23.5714 4.40088L18.1055 15.2716C17.7386 15.9978 17.0276 16.4947 16.2249 16.5941L5.50715 17.9319C2.99971 18.2453 2.10529 21.4178 4.08525 22.985L6.99786 25.2937C9.45943 27.2431 12.6167 28.0993 15.728 27.6559L26.5987 26.1193C27.2256 26.0276 27.4931 26.8914 26.9274 27.1742L18.2355 31.4935C14.9712 33.1141 12.6702 36.1949 12.0433 39.7879L11.4012 43.4955C10.996 45.8272 13.4423 47.616 15.5369 46.5075L24.5652 41.7296C25.2762 41.355 26.1247 41.355 26.8357 41.7296L36.2156 46.6681C38.2491 47.7383 40.6572 46.0718 40.3667 43.7937L38.9677 32.6784C38.876 31.9216 39.1283 31.1647 39.671 30.6296L48.0801 22.3887C49.6549 20.8445 48.7528 18.1612 46.5665 17.8784L35.5429 16.4718C34.6026 16.3494 33.777 15.7685 33.3566 14.9199L28.1123 4.40853Z");shape.setAttribute('fill','#fff');icon.append(shape);
   const label=document.createElement('span');label.className='max-cta-label';
   const prefix=document.createElement('span');prefix.textContent=english?(yes?'Extend for':'Get Max for'):(yes?'Продлить за':'Подключить за');
   const price=document.createElement('span');price.className='max-cta-price';const amount=document.createElement('span');amount.textContent=english?'100 Stars':'100 звёзд';price.append(icon,amount);label.append(prefix,price);subscribe.replaceChildren(label);
  }
  document.querySelectorAll('.max-beta-price strong').forEach(el=>el.textContent=english?'100 Stars':'100 звёзд');
  document.querySelectorAll('[data-max-beta-caption]').forEach(el=>el.textContent=english?'30 days · no auto-renewal':'30 дней · без автопродления');
  document.querySelector('[data-i18n="maxRowExpireTitle"]')?.replaceChildren(document.createTextNode(english?'Access expires':'Срок действия подписки'));
  document.querySelector('[data-i18n="maxRowExpireDate"]')?.replaceChildren(document.createTextNode(date||'—'));
 }
 const render=renderMaxBetaView;renderMaxBetaView=function(...args){const r=render(...args);paint();return r;};
 const translate=applyTranslations;applyTranslations=function(...args){const r=translate(...args);paint();return r;};
 async function refresh(){if(loading)return loading;const owner=user();loading=(async()=>{try{const r=await fetch('/api/max/status',{cache:'no-store'});if(!r.ok)throw Error('status');const data=await r.json();if(user()!==owner)return;verified=data;account=owner;clockAt=data.server_time;synced=performance.now();renderAll();}catch(_){if(!active())verified=null;paint();}finally{loading=null;if(user()&&user()!==owner)refresh();}})();return loading;}
 function close(){if(sheet){const current=sheet;sheet=null;closeSheetModal(current,()=>{current.querySelector('.max-stars-rotator')?._starsDispose?.();current.remove();});}}
 function purchase(reason){
  if(sheet){if(reason==='listening'||reason==='export'){sheet.querySelector('h2').textContent=reason==='export'?'Лимит выгрузок на день исчерпан':'Лимит прослушивания на день исчерпан';sheet.querySelector('.max-stars-subtitle').textContent='Продолжай с Telefy Max — без дневных ограничений.';}openSheetModal(sheet);return;}
  sheet=document.createElement('div');sheet.id='max-stars-sheet';sheet.className='tg-sheet-modal fixed inset-0 z-[90] bg-black/45 flex items-end justify-center';
  sheet.innerHTML=`<section class="col-sheet-panel app-surface max-stars-panel"><button type="button" class="telefy-sheet-grip" aria-label="Закрыть"></button><div class="max-stars-scene"><div class="max-stars-pattern" aria-hidden="true"><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""></div><div class="max-stars-rotator" role="button" tabindex="0" aria-label="Вращать звезду пальцем или клавишами стрелок"><img src="assets/star.svg" class="max-stars-fallback" alt="Золотая звезда"></div></div><h2>Telefy Max</h2><p class="max-stars-subtitle">Максимум возможностей музыки в Telegram</p><div class="max-stars-group"><div><span>Срок доступа</span><strong>30 дней</strong></div><div><span>Стоимость</span><strong class="max-stars-price"><img src="assets/star.svg" alt="">${state.lang==='en'?'100 Stars':'100 звёзд'}</strong></div><div><span>Автопродление</span><strong>Отключено</strong></div></div><p class="max-stars-terms">Разовая оплата ${state.lang==='en'?'100 Stars':'100 звёзд'} за 30 дней Telefy Max. При продлении 30 дней добавляются к оставшемуся сроку. Оплата проходит в Telegram. По вопросам оплаты и возврата: @telefy_support.</p><label class="max-stars-consent"><input type="checkbox">Принимаю эти условия доступа и оплаты</label><button type="button" class="max-stars-pay" disabled>${state.lang==='en'?'Pay 100 Stars':'Оплатить 100 звёзд'}</button><p role="status" class="max-stars-message"></p></section>`;
  document.body.append(sheet);window.TelefyStars3D?.mount(sheet.querySelector('.max-stars-rotator'));const root=sheet,button=root.querySelector('.max-stars-pay');root.querySelector('input').onchange=e=>button.disabled=!e.target.checked||buying;
  root.querySelectorAll('[aria-label="Закрыть"]').forEach(b=>b.onclick=close);root.onclick=e=>{if(e.target===root)close();};
  button.onclick=async()=>{
   if(buying||!root.querySelector('input').checked)return;buying=true;button.disabled=true;
   const status=root.querySelector('[role="status"]');status.textContent='Открываем оплату Telegram…';
   try{
    const key=crypto.randomUUID().replaceAll('-','');
    const r=await fetch('/api/max/stars/invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_key:key,terms_accepted:true}),signal:AbortSignal.timeout(20000)});const data=await r.json();
    if(!r.ok)throw Error(r.status===429?'Слишком много попыток. Попробуй позднее.':'Не удалось создать счёт. Попробуй ещё раз.');
    const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='t.me'||!url.pathname.startsWith('/$'))throw Error('Некорректный счёт');
    const completed=async result=>{if(result==='paid'){status.textContent='Подтверждаем оплату…';for(let i=0;i<15;i++){const r=await fetch('/api/max/stars/orders/'+encodeURIComponent(data.order_id),{cache:'no-store'});const order=r.ok?await r.json():{};await refresh();if(order.status==='paid'&&active()){close();showToast('Telefy Max подключён');return;}if(order.status==='refunded'){status.textContent='Платёж возвращён.';return;}await new Promise(r=>setTimeout(r,2000));}status.textContent='Подтверждение ещё обрабатывается. Доступ обновится после подтверждения Telegram.';}else status.textContent=result==='cancelled'?'Оплата отменена.':'Заверши оплату в Telegram.';};
    if(typeof window.Telegram?.WebApp?.openInvoice==='function')Telegram.WebApp.openInvoice(url.href,completed);
    else{window.open(url.href,'_blank','noopener');status.textContent='Счёт открыт в Telegram. После оплаты вернись сюда.';}
   }catch(e){status.textContent=e.message;}finally{buying=false;button.disabled=!root.querySelector('input').checked;}
  };
  if(reason==='listening'||reason==='export'){root.querySelector('h2').textContent=reason==='export'?'Лимит выгрузок на день исчерпан':'Лимит прослушивания на день исчерпан';root.querySelector('.max-stars-subtitle').textContent=reason==='export'?'10 бесплатных выгрузок уже использованы. Продолжай с Telefy Max.':'60 бесплатных минут уже использованы. Продолжай слушать с Telefy Max.';}
  openSheetModal(sheet);
 }
 window.TelefyMax={refresh,purchase,get active(){return active();},get beta(){return false;}};
 window.addEventListener('telefy:profile-ready',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user())refresh();});
 setInterval(()=>{if(active()){hadMax=true;return;}if(hadMax){hadMax=false;closeLibraryModal();closeCreatePlaylistModal();if(USER_PLAYLISTS.some(p=>p.id===state.activeCollectionId))closeCollectionModal();if(state.searchFilter==='liked')state.searchFilter='all';renderAll();}},1000);
 if(user())refresh();paint();
})();
