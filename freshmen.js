/* Isolated freshmen recommendations; never fills this section with the main catalog. */
(() => {
 let ids=new Set(),busy=false,failed=false;
 renderHomeTracks=function(){
  const box=document.getElementById('home-tracks-list');if(!box)return;
  const pool=tracks.filter(t=>ids.has(t.soundcloudUrn));
  document.getElementById('home-uncut-total').textContent=state.lang==='en'?'New names':'Новые имена';
  if(pool.length){box.innerHTML=pool.slice(0,12).map(createTrackRowHTML).join('');bindTrackRowEvents(box);return;}
  box.innerHTML='<div class="px-4 py-7 text-center text-muted text-sm"></div>';
  box.firstChild.textContent=busy?(state.lang==='en'?'Finding new artists…':'Ищем новых артистов…'):(failed?(state.lang==='en'?'Could not load recommendations':'Не удалось загрузить рекомендации'):(state.lang==='en'?'No matching artists yet':'Подходящих артистов пока не найдено'));
  if(!busy){const b=document.createElement('button');b.className='w-full pb-5 text-sm text-[#2AABEE]';b.textContent=state.lang==='en'?'Refresh':'Обновить';b.onclick=load;box.append(b);}
 };
 async function load(){
  if(busy)return;busy=true;failed=false;renderHomeTracks();
  try{
   const r=await fetch('/api/soundcloud/search?q=telefy%3Afreshmen&limit=25',{signal:AbortSignal.timeout(90000)});
   if(!r.ok)throw Error('unavailable');const d=await r.json();
   const list=(d.tracks||[]).filter(t=>Number.isInteger(t.freshmanFollowers)&&t.freshmanFollowers>=5000&&t.freshmanFollowers<=10000);
   mergeParsedTracksIntoCatalog(list);ids=new Set(list.map(t=>t.soundcloudUrn));
  }catch(_){failed=true;}finally{busy=false;renderHomeTracks();}
 }
 I18N.ru.recommendedFreshmen='Рекомендуем послушать';I18N.en.recommendedFreshmen='Recommended listening';
 applyTranslations();load();
})();
