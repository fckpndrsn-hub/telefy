/* Promo redemption is authenticated and granted only by the server. */
(()=>{
 function bindPromoDismiss(root,dismiss){
  const panel=root.querySelector('.promo-panel'),grip=panel.querySelector('.telefy-sheet-grip');let drag=null,suppressClick=0;
  grip.onclick=()=>{if(performance.now()>suppressClick)dismiss();};
  root.onclick=e=>{if(e.target===root&&performance.now()>suppressClick)dismiss();};
  const settle=()=>{panel.style.transition='transform .28s cubic-bezier(.22,1,.36,1)';panel.style.transform='translateY(0)';setTimeout(()=>{if(panel.isConnected&&!root._dismissMotion)panel.style.transition='';},300);};
  panel.addEventListener('pointerdown',e=>{
   if(!e.isPrimary||e.button!==0||root._dismissMotion||drag||e.target.closest('.promo-rotator,input,a,select,textarea')||(e.target.closest('button')&&!grip.contains(e.target)))return;
   if(!e.target.closest('.telefy-sheet-grip,.promo-hero,h2,.promo-help'))return;
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

 let sheet=null,pending=false;
 const english=()=>state.lang==='en';
 const errors={promo_format:'Введите промокод в формате XXXX-XXXX.',promo_not_found:'Промокод не найден. Проверьте написание.',promo_disabled:'Этот промокод больше не действует.',promo_expired:'Срок действия промокода истёк.',promo_already_used:'Вы уже активировали этот промокод.',promo_exhausted:'Все активации этого промокода уже использованы.',promo_rate_limited:'Слишком много попыток. Попробуйте через 10 минут.',login_required:'Откройте Telefy в своём аккаунте Telegram.',promo_unavailable:'Не удалось активировать промокод. Попробуйте позже.'};
 const enErrors={promo_format:'Enter a code in XXXX-XXXX format.',promo_not_found:'Code not found. Check the spelling.',promo_disabled:'This code is no longer available.',promo_expired:'This code has expired.',promo_already_used:'You have already used this code.',promo_exhausted:'This code has no redemptions left.',promo_rate_limited:'Too many attempts. Try again in 10 minutes.',login_required:'Open Telefy using your Telegram account.',promo_unavailable:'Could not redeem the code. Please try again later.'};
 const errorText=code=>(english()?enErrors:errors)[code]||(english()?enErrors:errors).promo_unavailable;
 const format=value=>{const raw=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);return raw.length>4?raw.slice(0,4)+'-'+raw.slice(4):raw;};
 const valid=value=>/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value);
 const days=n=>{const a=n%10,b=n%100;return n+' '+(english()?(n===1?'day':'days'):(b>=11&&b<=14?'дней':a===1?'день':a>=2&&a<=4?'дня':'дней'));};
 const cross='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
 function hero(compact=false){return '<div class="promo-hero'+(compact?' promo-hero-compact':'')+'"><div class="promo-sparkles" aria-hidden="true">'+Array.from({length:7},(_,i)=>'<i style="--i:'+i+'">✦</i>').join('')+'</div><div class="promo-rotator" role="img" tabindex="0" aria-label="'+(english()?'Rotate promo ticket':'Вращать промокод')+'"><img src="assets/promo-ticket.svg" alt="" class="promo-ticket-fallback"></div>'+(compact?'':'<h2 class="font-rounded">'+(english()?'Enter your promo code':'Введите промокод')+'</h2><p>'+(english()?'Gifts and bonuses from Telefy.':'Получайте подарки и бонусы от Telefy.')+'</p>')+'</div>';}
 function close(){if(!sheet)return;const root=sheet;sheet=null;root._promoKeyCleanup?.();closeSheetModal(root,()=>{root.querySelector('.promo-rotator')?._promoDispose?.();root.remove();});}
 async function show(){
  if(sheet)return;
  document.querySelector('#max-stars-sheet .telefy-sheet-grip')?.click();
  const root=document.createElement('div');sheet=root;root.id='promo-modal';root.className='tg-sheet-modal promo-modal fixed inset-0 flex items-end justify-center hidden';
  root.innerHTML='<section class="col-sheet-panel promo-panel" role="dialog" aria-modal="true" aria-label="'+(english()?'Promo code':'Промокод')+'"><button class="telefy-sheet-grip" type="button" aria-label="Закрыть"></button>'+hero()+'<form class="promo-form"><div class="promo-input-card"><label for="promo-code">'+(english()?'Promo code':'Промокод')+'</label><p class="promo-error" role="status" aria-live="polite" hidden></p><input id="promo-code" type="text" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="promo-error-message" /></div><button class="promo-submit font-rounded" type="submit" disabled>'+(english()?'Activate':'Активировать')+'</button><p class="promo-help">'+(english()?'Your gift becomes available after you activate the code.':'Действие подарка начнётся после активации промокода.')+'</p></form></section>';
  root.querySelector('.promo-error').id='promo-error-message';document.body.append(root);bindPromoDismiss(root,close);openSheetModal(root,'light');window.TelefyPromo3D?.mount(root.querySelector('.promo-rotator'));
  const input=root.querySelector('input'),button=root.querySelector('.promo-submit'),error=root.querySelector('.promo-error');
  input.oninput=()=>{input.value=format(input.value);error.hidden=true;input.removeAttribute('aria-invalid');button.disabled=pending||!valid(input.value);};
  const escape=e=>{if(e.key==='Escape'){close();document.removeEventListener('keydown',escape);}};document.addEventListener('keydown',escape);root._promoKeyCleanup=()=>document.removeEventListener('keydown',escape);
  root.querySelector('form').onsubmit=async e=>{
   e.preventDefault();if(pending||!valid(input.value))return;
   pending=true;button.disabled=true;input.disabled=true;error.hidden=true;button.textContent=english()?'Activating…':'Активируем…';
   const owner=window.TelefyProfile?.user?.telegram_id;
   try{
    const response=await fetch('/api/max/promos/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:input.value}),signal:AbortSignal.timeout(20000)}),data=await response.json();
    if(owner!==window.TelefyProfile?.user?.telegram_id){close();return;}
    if(!response.ok)throw Error(data.error||'promo_unavailable');
    if(data.kind==='discount'&&Number.isInteger(data.percent)&&data.percent>=1&&data.percent<=99){await window.TelefyMax?.refresh();close();success(null,data.percent);return;}
    if(!Number.isInteger(data.days)||data.days<1||data.days>365)throw Error('promo_unavailable');
    await window.TelefyMax?.refresh();close();success(data.days);
   }catch(e){if(sheet===root){error.textContent=errorText(e.message);error.hidden=false;input.setAttribute('aria-invalid','true');}}
   finally{pending=false;input.disabled=false;button.disabled=!valid(input.value);button.textContent=english()?'Activate':'Активировать';}
  };
 }
 function success(n,percent=0){
  const root=document.createElement('div');root.className='promo-success-overlay';root.innerHTML='<section class="promo-success-window" role="dialog" aria-modal="true" aria-labelledby="promo-gift-title">'+hero(true)+'<button class="promo-success-close" aria-label="'+(english()?'Close':'Закрыть')+'">'+cross+'</button><h2 id="promo-gift-title" class="font-rounded"></h2><p>'+(english()?'Here is your gift — it’s free!':'Вот ваш подарок, берите, это бесплатно!')+'</p><button class="promo-success-continue font-rounded" type="button">'+(english()?'Continue':'Продолжить')+'</button></section>';
  root.querySelector('h2').textContent=english()?'Gift: Telefy Max for '+days(n):'Подарок: подписка на '+days(n);document.body.append(root);
  if(percent){root.querySelector('h2').textContent=english()?'Telefy Max: '+percent+'% off':'Скидка '+percent+'% на Telefy Max';root.querySelector('section > p').textContent=english()?'The discount applies to one subscription payment.':'Скидка применится к одной оплате подписки. Активация засчитается после оплаты.';root.querySelector('.promo-success-continue').textContent=english()?'Continue to payment':'Перейти к оплате';}
  window.TelefyPromo3D?.mount(root.querySelector('.promo-rotator'));requestAnimationFrame(()=>root.classList.add('is-visible'));
  const dismiss=()=>{root.classList.remove('is-visible');document.removeEventListener('keydown',keys);setTimeout(()=>{root.querySelector('.promo-rotator')?._promoDispose?.();root.remove();},220);};
  const keys=e=>{if(e.key==='Escape')dismiss();if(e.key==='Tab'){e.preventDefault();const buttons=[...root.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}};
  root.querySelector('.promo-success-close').onclick=dismiss;root.querySelector('.promo-success-continue').onclick=()=>{dismiss();if(percent)setTimeout(()=>window.TelefyMax?.purchase(),230);};root.onclick=e=>{if(e.target===root)dismiss();};document.addEventListener('keydown',keys);root.querySelector('.promo-success-continue').focus();
 }
 function entry(label,location){const b=document.createElement('button');b.type='button';b.className='promo-entry promo-entry-'+location;b.innerHTML='<span class="promo-entry-icon"><img src="assets/promo-icon.svg" alt=""></span><span class="profile-action-label"></span><svg class="profile-action-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';b.children[1].textContent=label;b.onclick=show;return b;}
 let queued=false;
 function install(){
  queued=false;
  document.querySelectorAll('.gift-entry').forEach(gift=>{if(gift.nextElementSibling?.classList.contains('promo-entry-profile'))return;gift.after(entry(english()?'Promo code':'Промокод','profile'));});
  const offer=document.getElementById('btn-modal-subscribe-max');if(offer&&!offer.parentElement.querySelector('.promo-entry-offer'))offer.after(entry(english()?'I have a promo code':'У меня есть промокод','offer'));
  const group=document.querySelector('#max-stars-sheet .max-stars-group');if(group&&!group.parentElement.querySelector('.promo-entry-checkout'))group.after(entry(english()?'I have a promo code':'У меня есть промокод','checkout'));
 }
 new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(install);}}).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('telefy:profile-ready',install);install();window.TelefyPromos={open:show,format};
})();
