/* Progressive verified freshmen discovery. */
(() => {
 let ids=new Set(),busy=false,failed=false;
 let cached=[];
 try{const saved=JSON.parse(localStorage.getItem('telefy_freshmen_v2')||'null');if(saved&&Date.now()-saved.at<6*3600000)cached=saved.tracks||[];}catch(_){}
 const valid=t=>Number.isInteger(t.freshmanFollowers)&&t.freshmanFollowers>=5000&&t.freshmanFollowers<=10000;
 renderHomeTracks=function(){
  const box=document.getElementById('home-tracks-list');if(!box)return;
  const pool=tracks.filter(t=>ids.has(t.soundcloudUrn));
  document.getElementById('home-uncut-total').textContent=state.lang==='en'?'New names':'Новые имена';
  if(pool.length){box.innerHTML=pool.slice(0,24).map(createTrackRowHTML).join('');bindTrackRowEvents(box);return;}
  box.innerHTML='<div class="px-4 py-7 text-center text-muted text-sm"></div>';
  box.firstChild.textContent=busy?(state.lang==='en'?'Finding new artists…':'Ищем новых артистов…'):(failed?(state.lang==='en'?'Could not load recommendations':'Не удалось загрузить рекомендации'):(state.lang==='en'?'No matching artists yet':'Подходящих артистов пока не найдено'));
  if(!busy){const b=document.createElement('button');b.className='w-full pb-5 text-sm text-[#2AABEE]';b.textContent=state.lang==='en'?'Refresh':'Обновить';b.onclick=load;box.append(b);}
 };
 function add(list){
  list=list.filter(valid);if(!list.length)return;
  mergeParsedTracksIntoCatalog(list);list.forEach(t=>ids.add(t.soundcloudUrn));
  const saved=new Map(cached.map(t=>[t.soundcloudUrn,t]));list.forEach(t=>saved.set(t.soundcloudUrn,t));cached=[...saved.values()].slice(0,48);
  try{localStorage.setItem('telefy_freshmen_v2',JSON.stringify({at:Date.now(),tracks:cached}));}catch(_){}
  renderHomeTracks();
 }
 async function load(){
  if(busy)return;busy=true;failed=false;renderHomeTracks();let completed=false;
  try{
   for(let offset=0;offset<6;offset++){
    const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:freshmen',offset,limit:25}),{signal:AbortSignal.timeout(90000)});
    if(!r.ok)throw Error('unavailable');const d=await r.json();completed=true;add(d.tracks||[]);
    if(!d.hasMore||ids.size>=24)break;
   }
  }catch(_){failed=!completed;}finally{busy=false;renderHomeTracks();}
 }
 I18N.ru.recommendedFreshmen='Рекомендуем послушать';I18N.en.recommendedFreshmen='Recommended listening';
 applyTranslations();add(cached);load();
})();
