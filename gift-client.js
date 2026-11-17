(()=>{
 let sheet=null,animation=null,order=null,invoiceKey=null,poll=0;
 const api=async(path,body)=>{const r=await fetch('/api/max/gifts/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'gift_unavailable');return d;};
 const errors={gift_already_claimed:'Этот подарок уже активирован.',gift_for_someone_else:'Отправь этот подарок другу — он предназначен другому пользователю.',gift_not_available:'Подарок недоступен или оплата ещё не подтверждена.',payments_disabled_beta:'Во время бесплатной беты продажа подарков отключена.',price_changed:'Стоимость изменилась. Открой подарок заново.'};
 function close(){if(sheet)closeSheetModal(sheet);animation?.pause();clearTimeout(poll);}
 function build(){
  if(sheet)return;sheet=document.createElement('div');sheet.id='gift-modal';sheet.className='fixed inset-0 z-[95] hidden';
  sheet.innerHTML=`<div class="gift-panel col-sheet-panel"><button class="gift-grip" aria-label="Закрыть"></button><div class="gift-art"><div class="gift-pattern"></div><div id="gift-animation"></div></div><h2 class="font-rounded">Подарить Telefy Max</h2><p class="gift-subtitle">Музыка, которую приятно дарить</p><div class="gift-details"><div>Срок доступа <b>30 дней</b></div><div>Получатель <b>По подарочной ссылке</b></div><div>Стоимость <b id="gift-price">—</b></div></div><label class="gift-message">Сообщение к подарку<textarea maxlength="300" placeholder="Этот месяц музыки — для тебя 💙"></textarea></label><p id="gift-help">Отправь ссылку другу. Подписка начнётся после активации подарка.</p><label id="gift-terms"><input type="checkbox"> Принимаю условия доступа и оплаты Telefy Max</label><button id="gift-action" class="gift-primary" disabled>Загрузка…</button><p id="gift-result" role="status"></p><p class="gift-footer">Без автопродления</p></div>`;
  document.body.append(sheet);
  const topup=document.createElement('button');topup.id='gift-topup';topup.type='button';topup.className='max-stars-topup';topup.innerHTML='<span>Купить</span><span class="gift-topup-star" aria-hidden="true"></span><span>звёзды</span>';
  topup.onclick=()=>{const url='https://t.me/PremiumBot';if(window.Telegram?.WebApp?.openTelegramLink)Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener');};
  document.getElementById('gift-action').after(topup);
  const hint=document.createElement('p');hint.id='gift-topup-hint';hint.className='max-stars-topup-hint';hint.textContent='В @PremiumBot отправь /stars. Если бот недоступен на iPhone, открой Telegram Web или Desktop.';topup.after(hint);
  sheet.addEventListener('click',e=>{if(e.target===sheet||e.target.closest('.gift-grip'))close();});
  let y=null;const panel=sheet.firstElementChild;panel.addEventListener('pointerdown',e=>{if(e.target.closest('.gift-grip')){y=e.clientY;panel.setPointerCapture(e.pointerId);}});panel.addEventListener('pointerup',e=>{if(y!==null&&(e.clientY-y>60||Math.abs(e.clientY-y)<8))close();y=null;});panel.addEventListener('pointercancel',()=>y=null);
  const pattern=sheet.querySelector('.gift-pattern');
  const spots=[[5,8,26,-24],[27,3,14,18],[62,10,20,-15],[85,5,31,22],[11,41,15,24],[78,39,24,-28],[3,77,29,12],[31,75,18,-12],[59,85,14,32],[87,73,30,-17],[42,21,12,16],[69,62,13,-30]];
  spots.forEach(([x,y,size,rotation],i)=>{const img=document.createElement('img');img.src='assets/gift-logo.svg?v=06f04135f805';img.alt='';img.style.cssText=`left:${x}%;top:${y}%;width:${size}px;height:${size}px;--gift-angle:${rotation}deg;--gift-drift:${i%2?7:-9}px;animation-duration:${7+i%5*1.4}s;animation-delay:${-i*1.3}s`;pattern.append(img);});
  animation=lottie.loadAnimation({container:document.getElementById('gift-animation'),renderer:'svg',loop:false,autoplay:false,path:'assets/gift-animation.json?v=529a25195842'});
 }
 function result(text){document.getElementById('gift-result').textContent=text;}
 async function show(token=null){
  build();openSheetModal(sheet,'light');animation?.goToAndPlay(0,true);order=null;invoiceKey=null;
  const button=document.getElementById('gift-action'),terms=document.getElementById('gift-terms'),message=sheet.querySelector('.gift-message');button.disabled=true;terms.hidden=!!token;message.hidden=!!token;result('');
  document.getElementById('gift-topup').hidden=!!token;document.getElementById('gift-topup-hint').hidden=!!token;
  try{
   if(token){const d=await api('info?token='+encodeURIComponent(token));sheet.querySelector('h2').textContent=d.mine?'Твой подарок активирован':'Тебе подарили Telefy Max';document.getElementById('gift-help').textContent=d.message||'30 дней твоей любимой музыки.';button.textContent=d.mine?'Открыть Telefy':'Активировать подарок';button.disabled=d.claimed&&!d.mine;button.onclick=async()=>{if(d.mine){close();return;}button.disabled=true;try{await api('claim',{token});result('🎁 Подарок активирован. 30 дней Max добавлены к твоей подписке.');button.textContent='Готово';button.disabled=false;button.onclick=()=>{location.reload();};}catch(e){result(errors[e.message]||'Не удалось активировать подарок. Повтори позже.');button.disabled=false;}};return;}
   sheet.querySelector('h2').textContent='Подарить Telefy Max';document.getElementById('gift-help').textContent='Отправь ссылку другу. Подписка начнётся после активации подарка.';
   const status=await(await fetch('/api/max/status')).json();if(status.beta)status.amount=status.regular_amount||100;
   const icon=()=>{const img=document.createElement('img');img.src='assets/star.svg';img.alt='';img.className='gift-stars-icon';return img;};
   document.getElementById('gift-price').replaceChildren(icon(),document.createTextNode(status.amount+' '+word(status.amount)));
   button.textContent='Оплатить '+status.amount+' '+word(status.amount,true);button.disabled=status.beta||!status.payments_configured;
   if(status.beta){result('Сейчас Max бесплатен для всех. Покупка подарков будет доступна после беты.');return;}
   terms.querySelector('input').checked=false;button.disabled=true;terms.onchange=()=>button.disabled=!terms.querySelector('input').checked;
   button.onclick=async()=>{button.disabled=true;try{invoiceKey||=crypto.randomUUID();const d=await api('invoice',{request_key:invoiceKey,expected_amount:status.amount,terms_accepted:terms.querySelector('input').checked,message:sheet.querySelector('textarea').value});order=d.order_id;const tg=window.Telegram?.WebApp;if(!tg?.openInvoice)throw Error('telegram_required');tg.openInvoice(d.url,()=>check());}catch(e){result(errors[e.message]||'Открой подарок в Telegram и попробуй ещё раз.');button.disabled=false;}};
  }catch(e){result(errors[e.message]||'Не удалось загрузить подарок. Попробуй позже.');}
 }
 function word(n,acc=false){const a=n%10,b=n%100;return b>=11&&b<=14?'звёзд':a===1?(acc?'звезду':'звезда'):a>=2&&a<=4?'звезды':'звёзд';}
 async function check(attempt=0){try{const d=await api('order?id='+encodeURIComponent(order));if(d.status==='paid'&&d.url){const b=document.getElementById('gift-action');b.textContent='Отправить подарок';b.disabled=false;b.onclick=()=>window.Telegram.WebApp.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(d.url)+'&text='+encodeURIComponent('🎁 Для тебя — Telefy Max!'));result('Подарок готов! Ссылка также доступна в сообщении бота.');return;}if(d.status==='refunded'){result('Платёж возвращён.');return;}if(attempt<20)poll=setTimeout(()=>check(attempt+1),1500);else{result('Оплата пока не подтверждена. Проверить ещё раз?');const b=document.getElementById('gift-action');b.textContent='Проверить оплату';b.disabled=false;b.onclick=()=>check();}}catch(_){result('Не удалось проверить оплату. Открой приложение повторно или напиши в поддержку.');}}
 function install(){for(const [cardId,id]of [['max-beta-hero-card','gift-open'],['max-hero-card','gift-open-free']]){const card=document.getElementById(cardId);if(!card||document.getElementById(id))continue;const b=document.createElement('button');b.id=id;b.className='gift-entry';b.innerHTML='<span>🎁</span> Подарить Telefy Max <span>›</span>';b.onclick=()=>show();card.after(b);}}
 let startHandled=false;function launch(){install();const token=window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('tgWebAppStartParam')||'';if(token.startsWith('gift_')&&!startHandled){startHandled=true;show(token.slice(5));}}
 install();window.addEventListener('telefy:profile-ready',launch);if(window.TelefyProfile?.user)launch();
 window.TelefyGifts={open:show};
})();
