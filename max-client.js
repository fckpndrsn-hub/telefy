/* Official Telegram invoice; client callbacks never grant access. */
(()=>{
 let verified=null,account='',synced=0,clockAt=0,loading=null,buying=false,sheet=null,hadMax=false;
 const price=()=>Number.isSafeInteger(verified?.amount)&&verified.amount>0?verified.amount:100;
 const priceLabel=(english=state.lang==='en',accusative=true)=>{const n=price(),last=n%10,teen=n%100;return n+' '+(english?(n===1?'Star':'Stars'):(teen>=11&&teen<=14?'звёзд':last===1?(accusative?'звезду':'звезда'):last>=2&&last<=4?'звезды':'звёзд'));};
 const user=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const beta=()=>Boolean(verified&&account===user()&&verified.beta===true);
 const active=()=>Boolean(verified&&account===user()&&verified.active&&(beta()||verified.expires_at>clockAt+(performance.now()-synced)/1000));
 Object.defineProperty(state,'isMaxSubscribed',{enumerable:true,get:active,set(){}});
 function remainingLabel(){
  const english=state.lang==='en';if(beta())return english?'Beta test':'Бета-тест';if(!verified||account!==user())return '—';
  const n=Math.max(0,Math.ceil(((verified.expires_at||0)-clockAt-(performance.now()-synced)/1000)/86400)),last=n%10,teen=n%100;
  return n+' '+(english?(n===1?'day':'days'):(teen>=11&&teen<=14?'дней':last===1?'день':last>=2&&last<=4?'дня':'дней'));
 }
 function paintRemaining(){const row=document.querySelector('[data-i18n="maxRowExpireDate"]');if(row)row.textContent=remainingLabel();}
 function paint(){
  document.documentElement.dataset.maxMode=beta()?'beta':'paid';const yes=active(),english=state.lang==='en',free=beta();
  const known=verified&&account===user();
  const date=yes&&!free?new Date(verified.expires_at*1000).toLocaleDateString(english?'en-GB':'ru-RU'):'';
  for(const id of ['max-status-text','max-active-until-pill']){const el=document.getElementById(id);if(el)el.textContent=free?(english?'Beta version, test and enjoy':'Бета-версия, тестируйте и наслаждайтесь'):yes?(english?'Active until '+date:'Подписка активна до '+date):(!known?(english?'Checking subscription…':'Проверяем подписку…'):(english?'Get more from your music in Telegram.':'Максимум возможностей твоей музыки в Telegram.'));}
  for(const id of ['btn-subscribe-max-label','btn-renew-max','btn-modal-subscribe-max']){const el=document.getElementById(id);if(el){el.hidden=free;el.disabled=free||!known;el.textContent=(english?(yes?'Extend for ':'Get Max for '):(yes?'Продлить за ':'Подключить за '))+priceLabel(english);}}
  const subscribe=document.getElementById('btn-modal-subscribe-max');
  if(subscribe){
   const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 52 50');icon.setAttribute('width','19');icon.setAttribute('height','19');icon.setAttribute('aria-hidden','true');icon.style.flexShrink='0';
   const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',"M28.1123 4.40853C27.1797 2.53559 24.5117 2.52795 23.5714 4.40088L18.1055 15.2716C17.7386 15.9978 17.0276 16.4947 16.2249 16.5941L5.50715 17.9319C2.99971 18.2453 2.10529 21.4178 4.08525 22.985L6.99786 25.2937C9.45943 27.2431 12.6167 28.0993 15.728 27.6559L26.5987 26.1193C27.2256 26.0276 27.4931 26.8914 26.9274 27.1742L18.2355 31.4935C14.9712 33.1141 12.6702 36.1949 12.0433 39.7879L11.4012 43.4955C10.996 45.8272 13.4423 47.616 15.5369 46.5075L24.5652 41.7296C25.2762 41.355 26.1247 41.355 26.8357 41.7296L36.2156 46.6681C38.2491 47.7383 40.6572 46.0718 40.3667 43.7937L38.9677 32.6784C38.876 31.9216 39.1283 31.1647 39.671 30.6296L48.0801 22.3887C49.6549 20.8445 48.7528 18.1612 46.5665 17.8784L35.5429 16.4718C34.6026 16.3494 33.777 15.7685 33.3566 14.9199L28.1123 4.40853Z");shape.setAttribute('fill','#fff');icon.append(shape);
   const label=document.createElement('span');label.className='max-cta-label';
   const prefix=document.createElement('span');prefix.textContent=english?(yes?'Extend for':'Get Max for'):(yes?'Продлить за':'Подключить за');
   const price=document.createElement('span');price.className='max-cta-price';const amount=document.createElement('span');amount.textContent=priceLabel(english);price.append(icon,amount);label.append(prefix,price);subscribe.replaceChildren(label);
  }
  document.querySelectorAll('.max-beta-price').forEach(el=>el.hidden=free);
  document.querySelectorAll('.max-beta-price strong').forEach(el=>el.textContent=priceLabel(english,false));
  document.querySelectorAll('[data-max-beta-caption]').forEach(el=>el.textContent=free?(english?'Free during beta':'Бесплатно во время беты'):(english?'30 days · no auto-renewal':'30 дней · без автопродления'));
  document.querySelector('[data-i18n="maxRowExpireTitle"]')?.replaceChildren(document.createTextNode(free?(english?'Free access':'Бесплатный доступ'):(english?'Access expires':'Срок действия подписки')));
  paintRemaining();
 }
 const render=renderMaxBetaView;renderMaxBetaView=function(...args){const r=render(...args);paint();return r;};
 const translate=applyTranslations;applyTranslations=function(...args){const r=translate(...args);paint();return r;};
 async function refresh(){if(loading)return loading;const owner=user();loading=(async()=>{try{const r=await fetch('/api/max/status',{cache:'no-store'});if(!r.ok){if(r.status===401){verified=null;account='';}throw Error('status');}const data=await r.json();if(user()!==owner)return;if(typeof data.active!=='boolean'||!Number.isFinite(data.server_time)||(data.active&&data.beta!==true&&!Number.isFinite(data.expires_at))||(data.telegram_id!==undefined&&String(data.telegram_id)!==owner))throw Error('invalid_status');verified=data;account=owner;clockAt=data.server_time;synced=performance.now();if(beta()&&sheet)close();renderAll();}catch(_){if(!active())verified=null;paint();}finally{loading=null;if(user()&&user()!==owner)refresh();}})();return loading;}
 function bindDismiss(root,dismiss){
  const panel=root.querySelector('.max-stars-panel'),grip=panel.querySelector('.telefy-sheet-grip');let drag=null,suppressClick=0;
  grip.onclick=()=>{if(performance.now()>suppressClick)dismiss();};
  root.onclick=e=>{if(e.target===root&&performance.now()>suppressClick)dismiss();};
  const settle=()=>{panel.style.transition='transform .28s cubic-bezier(.22,1,.36,1)';panel.style.transform='translateY(0)';setTimeout(()=>{if(panel.isConnected&&!root._dismissMotion)panel.style.transition='';},300);};
  panel.addEventListener('pointerdown',e=>{
   if(!e.isPrimary||e.button!==0||root._dismissMotion||drag||e.target.closest('.max-stars-rotator,input,a,select,textarea')||(e.target.closest('button')&&!grip.contains(e.target)))return;
   if(!e.target.closest('.telefy-sheet-grip,.max-stars-scene,h2,.max-stars-subtitle'))return;
   drag={id:e.pointerId,x:e.clientX,y:e.clientY,dy:0,at:performance.now(),moved:false,onGrip:grip.contains(e.target)};panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove',e=>{
   if(!drag||drag.id!==e.pointerId)return;
   const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
   if(!drag.moved&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){finish(e,true);return;}
   if(dy>6||drag.moved){e.preventDefault();drag.moved=true;drag.dy=Math.max(0,dy);panel.style.animation='none';panel.style.transition='none';panel.style.transform=`translateY(${drag.dy}px)`;}
  });
  const finish=(e,cancelled=false)=>{
   if(!drag||drag.id!==e.pointerId)return;const g=drag;drag=null;
   if(panel.hasPointerCapture(e.pointerId))panel.releasePointerCapture(e.pointerId);
   if(!g.moved){if(!cancelled&&g.onGrip)dismiss();return;}suppressClick=performance.now()+400;
   const speed=g.dy/Math.max(1,performance.now()-g.at);
   if(!cancelled&&(g.dy>80||(g.dy>28&&speed>.55)))dismiss();else settle();
  };
  panel.addEventListener('pointerup',e=>finish(e));panel.addEventListener('pointercancel',e=>finish(e,true));panel.addEventListener('lostpointercapture',e=>finish(e,true));
 }
 function close(){if(sheet){const current=sheet;sheet=null;closeSheetModal(current,()=>{current.querySelector('.max-stars-rotator')?._starsDispose?.();current.remove();});}}
 async function purchase(reason){
  if(!verified||account!==user()){await refresh();if(!verified||account!==user()){showToast(state.lang==='en'?'Unable to verify access. Try again.':'Не удалось проверить доступ. Попробуй ещё раз.');return;}}
  if(beta()){if(sheet)close();showToast(state.lang==='en'?'Max is free during beta':'Max бесплатен во время бета-теста');return;}
  if(sheet){if(reason==='listening'||reason==='export'){sheet.querySelector('h2').textContent=reason==='export'?'Лимит выгрузок на день исчерпан':'Лимит прослушивания на день исчерпан';sheet.querySelector('.max-stars-subtitle').textContent='Продолжай с Telefy Max — без дневных ограничений.';}openSheetModal(sheet);return;}
  sheet=document.createElement('div');sheet.id='max-stars-sheet';sheet.className='tg-sheet-modal fixed inset-0 z-[90] bg-black/45 flex items-end justify-center';
  sheet.innerHTML=`<section class="col-sheet-panel app-surface max-stars-panel"><button type="button" class="telefy-sheet-grip" aria-label="Закрыть"></button><div class="max-stars-scene"><div class="max-stars-pattern" aria-hidden="true"><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""><img src="assets/star.svg" alt=""></div><div class="max-stars-rotator" role="button" tabindex="0" aria-label="Вращать звезду пальцем или клавишами стрелок"><img src="assets/star.svg" class="max-stars-fallback" alt="Золотая звезда"></div></div><h2>Telefy Max</h2><p class="max-stars-subtitle">Максимум возможностей твоей музыки в Telegram.</p><div class="max-stars-group"><div><span>Срок доступа</span><strong>30 дней</strong></div><div><span>Стоимость</span><strong class="max-stars-price"><img src="assets/star.svg" alt="">${priceLabel(state.lang==='en',false)}</strong></div><div><span>Автопродление</span><strong>Отключено</strong></div></div><p class="max-stars-terms">Доступ к Telefy Max на 30 дней за ${priceLabel()}. При продлении 30 дней добавляются к оставшемуся сроку. Оплата проходит в Telegram. По вопросам оплаты и возврата: @telefy_support.</p><label class="max-stars-consent"><input type="checkbox">Принимаю эти условия доступа и оплаты</label><button type="button" class="max-stars-pay" disabled>${state.lang==='en'?'Pay':'Оплатить'} ${priceLabel()}</button><button type="button" class="max-stars-topup"><span>${state.lang==='en'?'Buy':'Купить'}</span><svg viewBox="0 0 52 50" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${"M28.1123 4.40853C27.1797 2.53559 24.5117 2.52795 23.5714 4.40088L18.1055 15.2716C17.7386 15.9978 17.0276 16.4947 16.2249 16.5941L5.50715 17.9319C2.99971 18.2453 2.10529 21.4178 4.08525 22.985L6.99786 25.2937C9.45943 27.2431 12.6167 28.0993 15.728 27.6559L26.5987 26.1193C27.2256 26.0276 27.4931 26.8914 26.9274 27.1742L18.2355 31.4935C14.9712 33.1141 12.6702 36.1949 12.0433 39.7879L11.4012 43.4955C10.996 45.8272 13.4423 47.616 15.5369 46.5075L24.5652 41.7296C25.2762 41.355 26.1247 41.355 26.8357 41.7296L36.2156 46.6681C38.2491 47.7383 40.6572 46.0718 40.3667 43.7937L38.9677 32.6784C38.876 31.9216 39.1283 31.1647 39.671 30.6296L48.0801 22.3887C49.6549 20.8445 48.7528 18.1612 46.5665 17.8784L35.5429 16.4718C34.6026 16.3494 33.777 15.7685 33.3566 14.9199L28.1123 4.40853Z"}"/></svg><span>${state.lang==='en'?'Stars':'звёзды'}</span></button><p class="max-stars-topup-hint">${state.lang==='en'?'In @PremiumBot, send /stars. If unavailable on iPhone, use Telegram Web or Desktop.':'В @PremiumBot отправь /stars. Если бот недоступен на iPhone, открой Telegram Web или Desktop.'}</p><p role="status" class="max-stars-message"></p></section>`;
  document.body.append(sheet);window.TelefyStars3D?.mount(sheet.querySelector('.max-stars-rotator'));const root=sheet,button=root.querySelector('.max-stars-pay');root.querySelector('input').onchange=e=>button.disabled=!e.target.checked||buying;
  bindDismiss(root,close);
  root.querySelector('.max-stars-topup').onclick=()=>{const url='https://t.me/PremiumBot';if(window.Telegram?.WebApp?.openTelegramLink)Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener');};
  button.onclick=async()=>{
   if(buying||!root.querySelector('input').checked)return;buying=true;button.disabled=true;
   const status=root.querySelector('[role="status"]');status.textContent='Открываем оплату Telegram…';
   try{
    const key=crypto.randomUUID().replaceAll('-','');
    const r=await fetch('/api/max/stars/invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_key:key,terms_accepted:true,expected_amount:price()}),signal:AbortSignal.timeout(20000)});const data=await r.json();
    if(data.error==='payments_disabled_beta'){await refresh();close();showToast('Бета-режим: Max доступен бесплатно.');return;}
    if(data.error==='price_changed'){await refresh();status.textContent='Цена изменилась. Закрой окно и проверь новую стоимость.';return;}
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
 window.TelefyMax={refresh,purchase,get active(){return active();},get beta(){return beta();}};
 window.addEventListener('telefy:profile-ready',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user())refresh();});
 setInterval(()=>{if(active()){hadMax=true;return;}if(hadMax){hadMax=false;closeLibraryModal();closeCreatePlaylistModal();if(USER_PLAYLISTS.some(p=>p.id===state.activeCollectionId))closeCollectionModal();if(state.searchFilter==='liked')state.searchFilter='all';renderAll();}},1000);
 setInterval(paintRemaining,60000);
 if(user())refresh();paint();
})();
