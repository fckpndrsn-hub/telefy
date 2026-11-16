/* Visible app use resets inactivity; unrelated background API calls do not. */
(() => {
 let uid=null,enabled=true,chatStarted=false,loaded=false,lastTouch=0,busy=false;
 const account=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const active=()=>!document.hidden||document.getElementById('telefy-audio')?.paused===false;
 const toggle=document.getElementById('toggle-reminders');
 function paint(){
  if(!toggle)return;toggle.checked=enabled;toggle.disabled=!loaded||busy;
  const english=state.lang==='en';document.getElementById('settings-reminders-title').textContent=english?'Bot reminders':'Напоминания в боте';
  document.getElementById('settings-reminders-sub').textContent=!loaded?(english?'Connecting…':'Подключаем…'):!chatStarted?(english?'Open @TelefyApp_Bot and press Start':'Открой @TelefyApp_Bot и нажми Start'):(english?'When you have not opened Telefy for a while':'Когда давно не открываешь Telefy');
 }
 async function touch(){
  if(!account()||uid!==account()||!active()||Date.now()-lastTouch<60000)return;
  lastTouch=Date.now();try{const r=await fetch('/api/me/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)lastTouch=0;}catch(_){lastTouch=0;}
 }
 async function load(){
  const current=account();if(!current)return;
  if(uid!==current){uid=current;loaded=false;lastTouch=0;paint();}
  touch();
  try{const r=await fetch('/api/me/reminders',{cache:'no-store'});if(!r.ok)return;const data=await r.json();if(account()!==current)return;enabled=data.enabled;chatStarted=data.chat_started;loaded=true;paint();}catch(_){}
 }
 toggle?.addEventListener('change',async()=>{
  const current=account(),before=enabled,wanted=toggle.checked;busy=true;paint();
  try{const r=await fetch('/api/me/reminders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:wanted})});if(!r.ok)throw Error();const data=await r.json();if(account()===current){enabled=data.enabled;chatStarted=data.chat_started;}}
  catch(_){if(account()===current){enabled=before;showToast(state.lang==='en'?'Could not save reminders':'Не удалось сохранить настройку напоминаний');}}
  finally{busy=false;paint();}
 });
 const original=applyTranslations;applyTranslations=function(...args){const r=original(...args);paint();return r;};
 window.addEventListener('telefy:profile-ready',load);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){touch();load();}});
 window.addEventListener('pageshow',touch);setInterval(touch,60000);
 if(window.TelefyProfile?.user)load();paint();
})();
