/* Audio export in Telegram; optional AI reranking never blocks playback. */
(() => {
 const exporting=new Set();
 const openBot=()=>{const url='https://t.me/TelefyApp_Bot';if(window.Telegram?.WebApp?.openTelegramLink)Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener');};
 function ready(){
  if(exporting.size>1){showToast(state.lang==='en'?'Track sent to the bot':'Трек отправлен в бота');return;}
  const title=state.lang==='en'?'Track sent':'Трек отправлен';
  const message=state.lang==='en'?'Open the audio in Telegram to listen offline or choose Add to Profile.':'Открой аудио в боте для офлайн-прослушивания. Под треком есть зелёная кнопка с подсказкой, как добавить его в профиль.';
  if(window.Telegram?.WebApp?.showPopup){Telegram.WebApp.showPopup({title,message,buttons:[{id:'open',type:'default',text:state.lang==='en'?'Open bot':'Открыть бота'},{type:'cancel'}]},id=>{if(id==='open')openBot();});}
  else{
   const dialog=document.createElement('dialog');Object.assign(dialog.style,{border:'none',borderRadius:'20px',padding:'24px',maxWidth:'340px',background:'var(--tg-theme-bg-color,#fff)',color:'var(--tg-theme-text-color,#17212b)'});
   const heading=document.createElement('h3');heading.textContent=title;const text=document.createElement('p');text.textContent=message;
   const button=document.createElement('button');button.textContent=state.lang==='en'?'Open bot':'Открыть бота';Object.assign(button.style,{background:'#2aabee',color:'white',border:'none',padding:'12px 18px',borderRadius:'12px'});button.onclick=()=>{openBot();window.TelefyDismissTransient(dialog);};
   const close=document.createElement('button');close.textContent=state.lang==='en'?'Close':'Закрыть';close.onclick=()=>{window.TelefyDismissTransient(dialog);};dialog.append(heading,text,button,close);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();window.TelefyDismissTransient(dialog);});
  }
 }
 notifyTrackOfflineExport=async function(){
  window.TelefyAnalytics?.event('export_request');
  const track=getTrack(state.currentTrackId);if(!track?.soundcloudUrn){showToast('Сначала выбери трек.');return;}
  if(exporting.has(track.soundcloudUrn)){showToast('Этот трек уже в очереди на отправку.');return;}
  const exportUrn=track.soundcloudUrn;exporting.add(exportUrn);triggerHaptic('medium');showToast('Готовим трек для отправки в Telegram…');
  try{
   const r=await fetch('/api/music/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({soundcloudUrn:track.soundcloudUrn})});const data=await r.json();
   if(!r.ok){if(data.error==='export_limit'){window.TelefyUsage?.showLimit('export');return;}if(data.error==='bot_start_required'){showToast('Открой бота и нажми Start, затем повтори выгрузку.');openBot();return;}if(['export_in_progress','export_cooldown','queue_busy'].includes(data.error)){showToast('Выгрузка уже выполняется или очередь занята. Попробуй немного позже.');return;}throw Error();}
   let job=data;
   for(let i=0;i<180;i++){
    if(job.status==='sent'){ready();return;}
    if(job.status==='uncertain'){showToast('Проверь чат бота: результат отправки не подтверждён.');return;}
    if(job.status==='failed'){showToast(job.error==='track_too_long'?'Для выгрузки доступны треки до 20 минут.':'Не удалось подготовить трек. Попробуй позже.');return;}
    await new Promise(resolve=>setTimeout(resolve,2500));const response=await fetch('/api/music/export?id='+encodeURIComponent(data.id),{cache:'no-store'});if(!response.ok)throw Error();job=await response.json();
   }
   showToast('Задание принято. Проверь чат бота немного позже.');
  }catch(_){showToast('Не удалось проверить выгрузку. Проверь чат бота перед повторной попыткой.');}
  finally{exporting.delete(exportUrn);}
 };
 window.TelefyExport={start:notifyTrackOfflineExport};
 let scores=new Map(),account='',lastAttempt=0,busy=false,token=0;
 const owner=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 function reset(){if(owner()!==account){account=owner();scores.clear();lastAttempt=0;token++;}}
 window.TelefyAI={score:track=>scores.get(track.soundcloudUrn)||0};
 async function rank(){
  reset();if(!account||busy||!window.TelefyTaste?.ready||Date.now()-lastAttempt<1800000)return;
  const candidates=tracks.filter(t=>t.soundcloudUrn&&!t.disliked&&!window.telefySongBlocked?.(t)&&!window.TelefyPromotionExcluded?.(t)&&(!window.TelefyRapCandidate||TelefyRapCandidate(t))).slice(-60);
  if(candidates.length<2)return;
  busy=true;lastAttempt=Date.now();const generation=token;
  try{
   const r=await fetch('/api/ai/rank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidates:candidates.map(t=>({soundcloudUrn:t.soundcloudUrn,title:t.title,artist:t.artist,genre:t.genre,tag_list:t.tag_list}))}),signal:AbortSignal.timeout(25000)});
   if(!r.ok)return;const result=await r.json();if(token!==generation||owner()!==account||!result.personalized)return;
   scores=new Map();result.order.forEach((index,place)=>{if(Number.isInteger(index)&&candidates[index])scores.set(candidates[index].soundcloudUrn,4*(1-place/Math.max(1,result.order.length)));});
   window.TelefyTaste.updatePlaylist();renderHomeTracks();
  }catch(_){}finally{busy=false;}
 }
 window.addEventListener('telefy:profile-ready',reset); /* Ranking is owned by SmartSelection; no duplicate timer. */
})();
