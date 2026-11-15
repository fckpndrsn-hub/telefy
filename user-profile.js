/* Render only a server-verified Telegram identity. No lookup by a typed @username. */
(() => {
 function render(user){
  const name=document.getElementById('max-profile-name');
  if(name)name.textContent=[user.first_name,user.last_name].filter(Boolean).join(' ')||'Профиль';
  const username=document.querySelector('#tg-profile-header .profile-username');
  if(username){username.textContent=user.username?'@'+user.username:'';username.hidden=!user.username;}
  const online=document.querySelector('#tg-profile-header .profile-online');
  if(online)online.textContent=state.lang==='en'?' · in Telefy':' · в Telefy';
  const avatar=document.querySelector('#tg-profile-header .profile-avatar');
  if(avatar){
   avatar.replaceChildren();const initial=document.createElement('span');
   initial.className='font-rounded text-[28px] text-white tracking-tight';initial.textContent=Array.from(user.first_name||'T')[0].toLocaleUpperCase();avatar.append(initial);
   if(user.photo_url?.startsWith('https://')){const img=document.createElement('img');img.alt='';img.referrerPolicy='no-referrer';img.className='w-full h-full object-cover';img.src=user.photo_url;img.onerror=()=>{img.remove();initial.hidden=false;};initial.hidden=true;avatar.append(img);}
  }
  window.TelefyProfile={user};
 }
 async function load(){
  const tg=window.Telegram?.WebApp;
  try{
   let response;
   if(tg?.initData){response=await fetch('/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});}
   else response=await fetch('/api/me',{cache:'no-store'});
   if(!response.ok)return;const data=await response.json();if(data.user)render(data.user);
  }catch(_){}
 }
 let attempts=0;
 function start(){if(window.Telegram?.WebApp||++attempts>=30){load();return;}setTimeout(start,100);}
 start();
})();
