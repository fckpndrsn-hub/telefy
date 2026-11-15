/* Progressive verified freshmen discovery. */
(() => {
 let ids=new Set(),order=[],busy=false,failed=false;const period=()=>Math.floor(Date.now()/21600000);let snapshot=period();
 let cached=[],cachePeriod=0;
 try{const saved=JSON.parse(localStorage.getItem('telefy_freshmen_v2')||'null');if(saved){cached=saved.tracks||[];cachePeriod=saved.period||0;}}catch(_){}
 const valid=t=>t.editorialPick===true||(Number.isInteger(t.freshmanFollowers)&&t.freshmanFollowers>=5000&&t.freshmanFollowers<=10000);
 renderHomeTracks=function(){
  const box=document.getElementById('home-tracks-list');if(!box)return;
  const pool=order.map(urn=>tracks.find(t=>t.soundcloudUrn===urn)).filter(Boolean);
  document.getElementById('home-uncut-total').textContent=state.lang==='en'?'New names':'Новые имена';
  if(pool.length){box.innerHTML=pool.slice(0,24).map(createTrackRowHTML).join('');bindTrackRowEvents(box);return;}
  box.innerHTML='<div class="px-4 py-7 text-center text-muted text-sm"></div>';
  box.firstChild.textContent=busy?(state.lang==='en'?'Finding new artists…':'Ищем новых артистов…'):(failed?(state.lang==='en'?'Could not load recommendations':'Не удалось загрузить рекомендации'):(state.lang==='en'?'No matching artists yet':'Подходящих артистов пока не найдено'));
  if(!busy){const b=document.createElement('button');b.className='w-full pb-5 text-sm text-[#2AABEE]';b.textContent=state.lang==='en'?'Refresh':'Обновить';b.onclick=load;box.append(b);}
 };
 function add(list,fromCache=false){
  list=list.filter(valid);if(!list.length)return;if(!fromCache&&cachePeriod!==snapshot){ids=new Set();order=[];cached=[];}if(!fromCache)cachePeriod=snapshot;
  mergeParsedTracksIntoCatalog(list);list.forEach(t=>ids.add(t.soundcloudUrn));order=interleaveByArtist(tracks.filter(t=>ids.has(t.soundcloudUrn))).map(t=>t.soundcloudUrn);
  const saved=new Map(cached.map(t=>[t.soundcloudUrn,t]));list.forEach(t=>saved.set(t.soundcloudUrn,t));cached=[...saved.values()].slice(-48);
  try{localStorage.setItem('telefy_freshmen_v2',JSON.stringify({at:Date.now(),period:cachePeriod,tracks:cached}));}catch(_){}
  renderHomeTracks();
 }
 async function load(){
  if(busy)return;if(period()!==snapshot){snapshot=period();}busy=true;failed=false;renderHomeTracks();let completed=false;
  try{
   for(let offset=0;offset<1;offset++){
    const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:freshmen',offset,limit:25}),{signal:AbortSignal.timeout(90000)});
    const d=await r.json();if(!r.ok)throw Error(d.error||'unavailable');completed=true;add(d.tracks||[]);
    if(!d.hasMore||ids.size>=24)break;
   }
  }catch(_){failed=true;}finally{busy=false;renderHomeTracks();}
 }
 I18N.ru.recommendedFreshmen='Рекомендуем послушать';I18N.en.recommendedFreshmen='Recommended listening';
 applyTranslations();add(cached,true);function startWhenReady(){if(window.TelefyFirstRun?.pending){setTimeout(startWhenReady,500);return;}if(!cached.length||cachePeriod!==snapshot)load();}startWhenReady();
 setInterval(()=>{if(period()!==snapshot)load();},30000);
})();
