/* Native bot buttons route to the real app screens; all use the same DB profile. */
(() => {
 if(!window.TelefyBotFetchPatched){
  window.TelefyBotFetchPatched=true;const original=window.fetch;let leaving=false;
  window.fetch=async function(...args){
   const response=await original.apply(this,args);
   try{
    const input=args[0],url=new URL(typeof input==='string'?input:input.url,location.href);
    if(response.status===403&&url.origin===location.origin&&url.pathname.startsWith('/api/'))response.clone().json().then(data=>{
     if(data.error!=='subscription_required'||leaving)return;leaving=true;document.getElementById('telefy-audio')?.pause();location.replace('/?access=subscription_required');
    }).catch(()=>{});
   }catch(_){}
   return response;
  };
 }
 let started=false;
 function start(){
  if(started)return;started=true;
  const screen=new URLSearchParams(location.search).get('screen')||'home';
  if(screen==='profile'||screen==='max'){
   switchTab('mytelefy');
   if(screen==='max')requestAnimationFrame(()=>document.getElementById('max-beta-hero-card')?.scrollIntoView({block:'center',behavior:'smooth'}));
  }else if(screen==='settings')openSettingsModal();
  else if(screen==='support'){
   const url='https://t.me/telefy_support';
   try{if(window.Telegram?.WebApp?.openTelegramLink){Telegram.WebApp.openTelegramLink(url);return;}}catch(_){}
   const backdrop=document.createElement('div');backdrop.className='fixed inset-0 z-[60] bg-black/50 flex items-end justify-center';
   const sheet=document.createElement('section');sheet.className='app-surface w-full max-w-md rounded-t-3xl p-6';
   const title=document.createElement('h2');title.className='font-rounded text-xl mb-4';title.textContent='Поддержка Telefy';
   const link=document.createElement('a');link.href=url;link.textContent='Написать @telefy_support';link.className='block rounded-xl p-3 text-center bg-[#2AABEE] text-white';
   const close=document.createElement('button');close.type='button';close.textContent='Закрыть';close.className='block mx-auto mt-4 text-muted';close.onclick=()=>window.TelefyDismissTransient(backdrop,sheet);
   sheet.append(title,link,close);backdrop.append(sheet);document.body.append(backdrop);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
