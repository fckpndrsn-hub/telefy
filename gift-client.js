(()=>{
 function bindGiftDismiss(root,dismiss){
  const panel=root.querySelector('.gift-panel'),grip=panel.querySelector('.gift-grip');let drag=null,suppressClick=0;
  grip.onclick=()=>{if(performance.now()>suppressClick)dismiss();};
  root.onclick=e=>{if(e.target===root&&performance.now()>suppressClick)dismiss();};
  const settle=()=>{panel.style.transition='transform .28s cubic-bezier(.22,1,.36,1)';panel.style.transform='translateY(0)';setTimeout(()=>{if(panel.isConnected&&!root._dismissMotion)panel.style.transition='';},300);};
  panel.addEventListener('pointerdown',e=>{
   if(!e.isPrimary||e.button!==0||root._dismissMotion||drag||e.target.closest('.gift-do-not-drag,input,a,select,textarea')||(e.target.closest('button')&&!grip.contains(e.target)))return;
   if(!e.target.closest('.gift-grip,.gift-art,h2,.gift-subtitle'))return;
   drag={id:e.pointerId,x:e.clientX,y:e.clientY,dy:0,at:performance.now(),moved:false,onGrip:grip.contains(e.target),onArt:Boolean(e.target.closest("#gift-animation"))};panel.setPointerCapture(e.pointerId);
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
   if(!g.moved){if(!cancelled&&g.onGrip)dismiss();else if(!cancelled&&g.onArt)animation?.goToAndPlay(0,true);return;}suppressClick=performance.now()+400;
   const speed=g.dy/Math.max(1,performance.now()-g.at);
   if(!cancelled&&(g.dy>80||(g.dy>28&&speed>.55)))dismiss();else settle();
  };
  panel.addEventListener('pointerup',e=>finish(e));panel.addEventListener('pointercancel',e=>finish(e,true));panel.addEventListener('lostpointercapture',e=>finish(e,true));
 }

 let sheet=null,animation=null,order=null,invoiceKey=null,poll=0;
 const api=async(path,body)=>{const r=await fetch('/api/max/gifts/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'gift_unavailable');return d;};
 const errors={gift_already_claimed:'Этот подарок уже активирован.',gift_for_someone_else:'Отправь этот подарок другу — он предназначен другому пользователю.',gift_not_available:'Подарок недоступен или оплата ещё не подтверждена.',payments_disabled_beta:'Во время бесплатной беты продажа подарков отключена.',price_changed:'Стоимость изменилась. Открой подарок заново.'};
 function close(){if(sheet)closeSheetModal(sheet);animation?.pause();clearTimeout(poll);}
 function build(){
  if(sheet)return;sheet=document.createElement('div');sheet.id='gift-modal';sheet.className='tg-sheet-modal fixed inset-0 z-[95] flex items-end justify-center hidden';
  sheet.innerHTML=`<div class="gift-panel col-sheet-panel"><button class="gift-grip" aria-label="Закрыть"></button><div class="gift-art"><div class="gift-pattern"></div><div id="gift-animation"></div></div><h2 class="font-rounded">Подарить Telefy Max</h2><p class="gift-subtitle">Музыка, которую приятно дарить</p><div class="gift-details"><div>Срок доступа <b>30 дней</b></div><div>Получатель <b id="gift-recipient">По подарочной ссылке</b></div><div id="gift-cost-row">Стоимость <b id="gift-price">—</b></div><div id="gift-comment" class="gift-comment" hidden></div></div><label class="gift-message">Сообщение к подарку<textarea maxlength="300" placeholder="Этот месяц музыки — для тебя 💙"></textarea></label><p id="gift-help">Отправь ссылку другу. Подписка начнётся после активации подарка.</p><label id="gift-terms"><input type="checkbox"> Принимаю условия доступа и оплаты Telefy Max</label><button id="gift-action" class="gift-primary" disabled>Загрузка…</button><p id="gift-result" role="status"></p><p class="gift-footer">Без автопродления</p></div>`;
  document.body.append(sheet);
  const topup=document.createElement('button');topup.id='gift-topup';topup.type='button';topup.className='max-stars-topup';topup.innerHTML='<span>Купить</span><svg viewBox="0 0 52 50" width="18" height="18" aria-hidden="true"><path fill="currentColor"></path></svg><span>звёзды</span>';topup.querySelector('path').setAttribute('d',"M28.1123 4.40853C27.1797 2.53559 24.5117 2.52795 23.5714 4.40088L18.1055 15.2716C17.7386 15.9978 17.0276 16.4947 16.2249 16.5941L5.50715 17.9319C2.99971 18.2453 2.10529 21.4178 4.08525 22.985L6.99786 25.2937C9.45943 27.2431 12.6167 28.0993 15.728 27.6559L26.5987 26.1193C27.2256 26.0276 27.4931 26.8914 26.9274 27.1742L18.2355 31.4935C14.9712 33.1141 12.6702 36.1949 12.0433 39.7879L11.4012 43.4955C10.996 45.8272 13.4423 47.616 15.5369 46.5075L24.5652 41.7296C25.2762 41.355 26.1247 41.355 26.8357 41.7296L36.2156 46.6681C38.2491 47.7383 40.6572 46.0718 40.3667 43.7937L38.9677 32.6784C38.876 31.9216 39.1283 31.1647 39.671 30.6296L48.0801 22.3887C49.6549 20.8445 48.7528 18.1612 46.5665 17.8784L35.5429 16.4718C34.6026 16.3494 33.777 15.7685 33.3566 14.9199L28.1123 4.40853Z");
  topup.onclick=()=>{const url='https://t.me/PremiumBot';if(window.Telegram?.WebApp?.openTelegramLink)Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener');};
  document.getElementById('gift-action').after(topup);
  const hint=document.createElement('p');hint.id='gift-topup-hint';hint.className='max-stars-topup-hint';hint.textContent='В @PremiumBot отправь /stars. Если бот недоступен на iPhone, открой Telegram Web или Desktop.';topup.after(hint);
  bindGiftDismiss(sheet,close);
  const pattern=sheet.querySelector('.gift-pattern');
  const spots=[[5,8,26,-24],[27,3,14,18],[62,10,20,-15],[85,5,31,22],[11,41,15,24],[78,39,24,-28],[3,77,29,12],[31,75,18,-12],[59,85,14,32],[87,73,30,-17],[42,21,12,16],[69,62,13,-30]];
  spots.forEach(([x,y,size,rotation],i)=>{const img=document.createElement('img');img.src='assets/gift-logo.svg?v=06f04135f805';img.alt='';img.style.cssText=`left:${x}%;top:${y}%;width:${size}px;height:${size}px;--gift-angle:${rotation}deg;--gift-drift:${i%2?7:-9}px;animation-duration:${7+i%5*1.4}s;animation-delay:${-i*1.3}s`;pattern.append(img);});
  animation=lottie.loadAnimation({container:document.getElementById('gift-animation'),renderer:'svg',loop:false,autoplay:false,path:'assets/gift-animation.json?v=529a25195842'});
  const art=document.getElementById('gift-animation');art.setAttribute('role','button');art.tabIndex=0;art.setAttribute('aria-label','Повторить анимацию подарка');art.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();animation?.goToAndPlay(0,true);}});
 }
 function result(text){document.getElementById('gift-result').textContent=text;}
 async function show(token=null){
  build();openSheetModal(sheet,'light');animation?.goToAndPlay(0,true);order=null;invoiceKey=null;
  const button=document.getElementById('gift-action'),terms=document.getElementById('gift-terms'),message=sheet.querySelector('.gift-message');button.disabled=true;terms.hidden=!!token;message.hidden=!!token;result('');
  sheet.querySelector('.gift-details').classList.toggle('is-recipient',!!token);
  const recipient=document.getElementById('gift-recipient');recipient.replaceChildren();if(token){const username=window.TelefyProfile?.user?.username;recipient.append(document.createTextNode(username?'Вы: ':'Вы'));if(username){const handle=document.createElement('span');handle.className='gift-recipient-username';handle.textContent='@'+String(username).replace(/^@/,'');recipient.append(handle);}}else recipient.textContent='По подарочной ссылке';
  document.getElementById('gift-cost-row').hidden=!!token;
  const comment=document.getElementById('gift-comment');comment.textContent='';comment.hidden=true;
  document.getElementById('gift-topup').hidden=!!token;document.getElementById('gift-topup-hint').hidden=!!token;
  try{
   if(token){const d=await api('info?token='+encodeURIComponent(token));sheet.querySelector('h2').textContent=d.mine?'Твой подарок активирован':'Тебе подарили Telefy Max';const giftText=typeof d.message==='string'?d.message:'';const caption=document.createElement('span');caption.className='gift-comment-label';caption.textContent='Сообщение к подарку';const content=document.createElement('p');content.className='gift-comment-text';content.textContent=giftText;comment.replaceChildren(caption,content);comment.hidden=!giftText.trim();document.getElementById('gift-help').textContent='30 дней твоей любимой музыки.';button.textContent=d.mine?'Открыть Telefy':'Активировать подарок';button.disabled=d.claimed&&!d.mine;button.onclick=async()=>{if(d.mine){close();return;}button.disabled=true;try{await api('claim',{token});result('🎁 Подарок активирован. 30 дней Max добавлены к твоей подписке.');button.textContent='Готово';button.disabled=false;button.onclick=()=>{location.reload();};}catch(e){result(errors[e.message]||'Не удалось активировать подарок. Повтори позже.');button.disabled=false;}};return;}
   sheet.querySelector('h2').textContent='Подарить Telefy Max';document.getElementById('gift-help').textContent='Отправь ссылку другу. Подписка начнётся после активации подарка.';
   const status=await(await fetch('/api/max/status')).json();if(status.regular_amount)status.amount=status.regular_amount;
   const icon=()=>{const img=document.createElement('img');img.src='assets/star.svg';img.alt='';img.className='gift-stars-icon';return img;};
   document.getElementById('gift-price').replaceChildren(icon(),document.createTextNode(status.amount+' '+word(status.amount)));
   button.textContent='Оплатить '+status.amount+' '+word(status.amount,true);button.disabled=status.beta||!status.payments_configured;
   if(status.beta){result('Сейчас Telefy Max бесплатен для всех. Покупка подарков будет доступна после беты.');return;}
   terms.querySelector('input').checked=false;button.disabled=true;terms.onchange=()=>button.disabled=!terms.querySelector('input').checked;
   button.onclick=async()=>{button.disabled=true;try{invoiceKey||=crypto.randomUUID();const d=await api('invoice',{request_key:invoiceKey,expected_amount:status.amount,terms_accepted:terms.querySelector('input').checked,message:sheet.querySelector('textarea').value});order=d.order_id;const tg=window.Telegram?.WebApp;if(!tg?.openInvoice)throw Error('telegram_required');tg.openInvoice(d.url,()=>check());}catch(e){result(errors[e.message]||'Открой подарок в Telegram и попробуй ещё раз.');button.disabled=false;}};
  }catch(e){result(errors[e.message]||'Не удалось загрузить подарок. Попробуй позже.');}
 }
 function word(n,acc=false){const a=n%10,b=n%100;return b>=11&&b<=14?'звёзд':a===1?(acc?'звезду':'звезда'):a>=2&&a<=4?'звезды':'звёзд';}
 async function check(attempt=0){try{const d=await api('order?id='+encodeURIComponent(order));if(d.status==='paid'&&d.url){const b=document.getElementById('gift-action');b.textContent='Отправить подарок';b.disabled=false;b.onclick=async()=>{const tg=window.Telegram?.WebApp;if(!tg?.shareMessage){result('Для отправки подарка с медиа обнови Telegram. Пока можно отправить ссылку.');tg?.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(d.url));return;}b.disabled=true;try{const prepared=await api('share',{id:order});tg.shareMessage(prepared.id,sent=>result(sent?'Подарок отправлен!':'Отправка отменена. Подарок остаётся доступным.'));}catch(e){result('Не удалось подготовить подарок. Попробуй ещё раз.');}finally{b.disabled=false;}};result('Подарок готов! Ссылка также доступна в сообщении бота.');return;}if(d.status==='refunded'){result('Платёж возвращён.');return;}if(attempt<20)poll=setTimeout(()=>check(attempt+1),1500);else{result('Оплата пока не подтверждена. Проверить ещё раз?');const b=document.getElementById('gift-action');b.textContent='Проверить оплату';b.disabled=false;b.onclick=()=>check();}}catch(_){result('Не удалось проверить оплату. Открой приложение повторно или напиши в поддержку.');}}
 function install(){for(const [cardId,id]of [['max-beta-hero-card','gift-open'],['max-hero-card','gift-open-free']]){const card=document.getElementById(cardId);if(!card||document.getElementById(id))continue;const b=document.createElement('button');b.id=id;b.className='gift-entry';b.innerHTML='<span class="tg-ico gift-entry-icon" aria-hidden="true">&#xF230;</span><span class="profile-action-label">Подарить Telefy Max</span><svg class="profile-action-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';b.onclick=()=>show();card.after(b);}}
 let startHandled=false;function launch(){install();const token=window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('tgWebAppStartParam')||'';if(token.startsWith('gift_')&&!startHandled){startHandled=true;show(token.slice(5));}}
 install();window.addEventListener('telefy:profile-ready',launch);if(window.TelefyProfile?.user)launch();
 window.TelefyGifts={open:show};
})();
