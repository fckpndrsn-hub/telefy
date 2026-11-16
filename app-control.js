/* Persistent admin maintenance and one-time remote page refresh. */
(() => {
 const boot=window.TELEFY_APP_CONTROL;let busy=false,moving=false,baseline=boot?.generation;
 const isRu=()=>typeof state==='undefined'||state.lang!=='en';
 async function move(maintenance){
  if(moving)return;moving=true;
  document.getElementById('telefy-audio')?.pause();
  const overlay=document.createElement('div');overlay.id='telefy-app-control';overlay.setAttribute('role','status');
  Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',display:'grid',placeItems:'center',background:'var(--tg-theme-bg-color, #f2f2f7)',color:'var(--tg-theme-text-color, #17212b)',padding:'32px',textAlign:'center',fontFamily:'system-ui,-apple-system,sans-serif'});
  const title=document.createElement('h2');title.textContent=maintenance?(isRu()?'Telefy на технических работах':'Telefy is under maintenance'):(isRu()?'Обновляем Telefy…':'Updating Telefy…');overlay.append(title);document.body.append(overlay);
  try{
   // The overlay blocks new edits while the existing library save queue drains.
   const saved=await window.TelefyLibrary?.save?.();
   if(saved===false&&!maintenance){overlay.remove();moving=false;return;}
  }catch(_){if(!maintenance){overlay.remove();moving=false;return;}}
  location.reload();
 }
 async function check(){
  if(busy||moving)return;busy=true;
  try{
   const r=await fetch('/api/app/status',{cache:'no-store'});if(!r.ok)return;
   const s=await r.json();if(typeof s.maintenance!=='boolean'||!Number.isSafeInteger(s.generation))return;
   if(s.maintenance){await move(true);return;}
   if(baseline===undefined)baseline=s.generation;
   else if(s.generation!==baseline)await move(false);
  }catch(_){}finally{busy=false;}
 }
 check();setInterval(check,15000);window.addEventListener('pageshow',check);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
})();
