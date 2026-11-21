/* Count actual playback time, never track positions, seeks or paused time. */
(()=>{
 const audio=document.getElementById('telefy-audio');
 let session=crypto.randomUUID().replaceAll('-',''),owner='',total=0,pending=0,budget=null,last=performance.now(),inflight=null,generation=0,blocked=false,announced=false,lastReport=0,lastSuccess=performance.now(),audible=false;
 const uid=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 function reset(){if(owner===uid())return;owner=uid();session=crypto.randomUUID().replaceAll('-','');total=0;pending=0;budget=null;audible=false;blocked=false;announced=false;generation++;last=performance.now();}
 function showLimit(kind='listening'){window.TelefyMax?.purchase(kind);}
 function stop(show=true){audible=false;state.isPlaying=false;audio.pause();renderPlayerUI();blocked=true;if(show&&!announced){announced=true;showLimit();}}
 function remaining(){return budget?Math.max(0,budget.remaining_ms-pending):0;}
 function measure(){
  const now=performance.now(),dt=Math.max(0,now-last);last=now;
  if(owner!==uid()){reset();return;}
  if(budget&&audible&&!audio.seeking){total+=dt;if(!budget.unlimited){pending+=dt;if(remaining()<=0)stop();}}
 }
 function verifiedBudget(){return budget&&owner===uid()&&performance.now()-lastSuccess<120000&&budget.server_time+(performance.now()-lastSuccess)/1000<budget.resets_at&&(!budget.unlimited||budget.access_expires_at==null||budget.server_time+(performance.now()-lastSuccess)/1000<budget.access_expires_at);}
 async function usageRequest(body){
  for(let n=0;n<2;n++){
   try{const r=await fetch('/api/me/usage',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(8000)});
    if(r.status===401||r.status===403){budget=null;throw Object.assign(Error('login'),{terminal:true});}
    if(!r.ok){if(r.status<500)throw Object.assign(Error('usage'),{terminal:true});throw Error('usage');}return await r.json();
   }catch(e){if(e.terminal||n===1)throw e;await new Promise(resolve=>setTimeout(resolve,700));}
  }
 }
 async function report(){
  reset();if(!owner)return false;if(inflight)return inflight;
  const version=generation,sent=total,unreported=pending;lastReport=performance.now();
  inflight=(async()=>{try{
   const data=await usageRequest(JSON.stringify({session,total_ms:Math.floor(sent)}));if(version!==generation)return false;
   if(typeof data.unlimited!=='boolean'||!Number.isFinite(data.remaining_ms)||data.remaining_ms<0||!Number.isFinite(data.server_time)||!Number.isFinite(data.resets_at))throw Error('invalid_usage');
   lastSuccess=performance.now();budget=data;pending=Math.max(0,pending-unreported);blocked=!data.unlimited&&remaining()<=0;
   if(!blocked)announced=false;else if(!audio.paused)stop();
   return true;
  }catch(_){return false;}finally{inflight=null;}})();return inflight;
 }
 async function allowed(){
  measure();const ok=verifiedBudget()&&performance.now()-lastSuccess<10000?true:await report();
  if(!ok&&!verifiedBudget()){state.isPlaying=false;audio.pause();renderPlayerUI();showToast('Не удалось проверить дневной лимит. Проверь подключение.');return false;}
  if(blocked){announced=true;stop(false);showLimit();return false;}return true;
 }
 const sync=syncRealAudio;let attempt=0;
 syncRealAudio=async function(...args){const current=++attempt;if(!state.isPlaying){measure();report();return sync(...args);}if(!await allowed()||current!==attempt||!state.isPlaying)return;return sync(...args);};
 audio.addEventListener('play',()=>{reset();if(!budget||blocked){stop(false);if(blocked)showLimit();}last=performance.now();});
 audio.addEventListener('playing',()=>{audible=true;last=performance.now();});
 for(const event of ['pause','waiting','seeking','ended'])audio.addEventListener(event,()=>{measure();audible=false;report();});
 audio.addEventListener('seeked',()=>{audible=!audio.paused&&!audio.ended&&audio.readyState>=3;last=performance.now();});
 audio.addEventListener('timeupdate',measure);
 setInterval(()=>{measure();if(owner&&(performance.now()-lastReport>10000)&&(!audio.paused||!budget||Date.now()/1000>=budget.resets_at))report();if(!audio.paused&&!verifiedBudget()){audio.pause();state.isPlaying=false;renderPlayerUI();}},500);
 document.addEventListener('visibilitychange',()=>{measure();report();});
 window.addEventListener('pagehide',()=>{measure();if(owner)navigator.sendBeacon('/api/me/usage',new Blob([JSON.stringify({session,total_ms:Math.floor(total)})],{type:'application/json'}));});
 window.addEventListener('online',()=>report());
 window.addEventListener('telefy:profile-ready',()=>{reset();report();});
 window.TelefyUsage={report,allowed,showLimit,get remainingMs(){return remaining();}};
 if(uid())report();
})();
