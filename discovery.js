/* SoundCloud discovery adapters, separated from playback. */
(() => {
 const coverKey='telefy_collection_art_v1';let coverCache={};
 try{coverCache=JSON.parse(localStorage.getItem(coverKey)||'{}');}catch(_){}
 for(const col of COLLECTIONS){const c=coverCache[col.id];if(c&&c.url?.startsWith('https://'))col.coverImg=c.url;}
 async function warmCollectionArt(col){
  if(col.coverImg)return;
  try{const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:cover:'+col.id}),{signal:AbortSignal.timeout(30000)});if(!r.ok)return;const data=await r.json();if(!data.coverImg?.startsWith('https://'))return;
   const image=new Image();image.src=data.coverImg;await Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);
   if(col.coverImg)return;
   coverCache[col.id]={url:data.coverImg,at:Date.now()};try{localStorage.setItem(coverKey,JSON.stringify(coverCache));}catch(_){}
   if(!col.coverImg){col.coverImg=data.coverImg;renderCollections();if(state.activeCollectionId===col.id)updateCollectionPresentation();}
  }catch(_){}
 }
 // Fetch lightweight artwork at startup; full playlists still load only on demand.
 async function warmAllArt(){if(window.TelefyFirstRun?.pending){setTimeout(warmAllArt,500);return;}for(const col of COLLECTIONS)await warmCollectionArt(col);}
 const memberships=new Map(),pending=new Map(),modeOffsets=new Map();
 const english={energy:['Energy','High tempo and drive'],night:['Chill vibe','Soft sound and mellow rhythms'],uncensored:['Super beat','Heavy trap and distorted bass'],underground:['Trends','Fresh popular Russian tracks']};
 for(const [id,[label,desc]]of Object.entries(english))MOOD_I18N.en[id]={label,streamTitle:label,shortDesc:desc};
 async function fetchBatch(kind,offset=0){const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:discovery:'+kind,offset,limit:50}),{signal:AbortSignal.timeout(90000)});const data=await r.json();if(!r.ok){const e=Error(data.error||'discovery');e.code=data.error;e.status=r.status;throw e;}return data;}
 function importBatch(items){mergeParsedTracksIntoCatalog(items);}
 const positions=new Map(),finished=new Set(),loadedAt=new Map();
 function paintCollection(col,error){
  if(state.activeCollectionId!==col.id)return;
  updateCollectionPresentation();const box=document.getElementById('col-modal-tracks');
  box.innerHTML=col.trackIds.length?col.trackIds.map(id=>createTrackRowHTML(getTrack(id))).join(''):'';
  if(col.trackIds.length)bindTrackRowEvents(box,col.title);
  if(error){const p=document.createElement('p');p.className='px-4 py-5 text-center text-muted text-sm';p.textContent=error.status===429?'Музыкальный сервис временно ограничил запросы. Загруженные треки сохранены.':'Не удалось обновить подборку. Загруженные треки сохранены.';box.append(p);}
  else if(!col.trackIds.length){const p=document.createElement('p');p.className='px-4 py-5 text-center text-muted text-sm';p.textContent='В этой порции подходящих треков нет';box.append(p);}
  if(!finished.has(col.id)||error){const b=document.createElement('button');b.type='button';b.className='w-full py-4 text-sm text-[#2AABEE]';b.textContent=error?'Повторить загрузку':'Загрузить ещё';b.onclick=()=>ensureCollectionTracksLoaded(col,true);box.append(b);}
 }
 // Reopening a sheet does not restart all artist searches from page zero.
 ensureCollectionTracksLoaded=async function(col,more=false){
  if(!col?.curated)return;
  if(pending.has(col.id))return pending.get(col.id);
  if(!more&&loadedAt.has(col.id)&&Date.now()-loadedAt.get(col.id)<21600000){paintCollection(col);return;}
  if(more&&finished.has(col.id))return;
  const task=(async()=>{
   try{
    const offset=positions.get(col.id)||0,data=await fetchBatch(col.id,offset);
    const urns=memberships.get(col.id)||new Set();(data.tracks||[]).forEach(t=>urns.add(t.soundcloudUrn));importBatch(data.tracks||[]);memberships.set(col.id,urns);
    const unique=new Set(),selected=tracks.filter(t=>urns.has(t.soundcloudUrn)).filter(t=>{const key=getTrackUniqueKey(t);if(unique.has(key))return false;unique.add(key);return true;});
    col.trackIds=interleaveByArtist(selected).slice(0,250).map(t=>t.id);
    positions.set(col.id,data.nextOffset);loadedAt.set(col.id,Date.now());if(!data.hasMore||col.trackIds.length>=250)finished.add(col.id);
    if(!col.coverImg){col.coverImg=selected.find(t=>t.coverImg)?.coverImg||null;if(col.coverImg){coverCache[col.id]={url:col.coverImg,at:Date.now()};try{localStorage.setItem(coverKey,JSON.stringify(coverCache));}catch(_){}}}
    renderCollections();paintCollection(col);
   }catch(error){paintCollection(col,error);}
  })();pending.set(col.id,task);try{await task;}finally{pending.delete(col.id);}
 };

 const catalog=window.TelefySoundCloud;const original=catalog.refill;
 catalog.refill=async function(autoPlay=false){
  const mood=state.activeMood;if(!mood||mood==='all')return original(autoPlay);
  const key='mode:'+mood;if(pending.has(key)){await pending.get(key);if(autoPlay&&state.activeMood===mood&&!doesTrackMatchMood(getTrack(state.currentTrackId),mood)&&state.queueIds.length)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);return;}
  const task=(async()=>{try{
   let offset=modeOffsets.get(mood)||0,data;for(let attempt=0;attempt<2;attempt++){data=await fetchBatch(mood,offset);if(state.activeMood!==mood)return;if(data.tracks.some(t=>t.classificationVersion===4&&t.modes?.includes(mood))||!data.hasMore)break;offset=data.nextOffset;}modeOffsets.set(mood,data.hasMore?data.nextOffset:0);importBatch(data.tracks);if(state.activeMood!==mood)return;
   const old=new Set(state.queueIds);
   state.queueIds=(state.queueIds||[]).filter(id=>{const t=tracks.find(t=>t.id===id);return t&&doesTrackMatchMood(t,mood);});const candidates=interleaveByArtist(tracks.filter(t=>doesTrackMatchMood(t,mood)&&isFlowTrackUnplayed(t)&&!old.has(t.id)));
   state.queueIds.push(...candidates.map(t=>t.id));if(autoPlay&&state.queueIds.length)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);else renderAll();
   if(autoPlay&&!doesTrackMatchMood(getTrack(state.currentTrackId),mood)&&!candidates.length&&!state.queueIds.length)showToast(state.lang==='en'?'No matching tracks yet':'Подходящих треков пока нет');
  }catch(e){if(autoPlay&&state.activeMood===mood)showToast(e.status===429?(state.lang==='en'?'Music service is busy. Loaded tracks remain available.':'Музыкальный сервис ограничил запросы. Загруженные треки сохранены.'):(state.lang==='en'?'Could not load this mode':'Не удалось загрузить режим'));}})();
  pending.set(key,task);try{await task;}finally{pending.delete(key);}
 };
 async function warmScene(){
  for(let offset=0;offset<7;offset++){
   try{const data=await fetchBatch('scene',offset);importBatch(data.tracks);
    if(state.activeMood==='all'&&!isMyVibeStreamActive()&&!window.TelefyFirstRun?.pending){
     const old=new Set(state.queueIds||[]);const extra=tracks.filter(t=>data.tracks.some(x=>x.soundcloudUrn===t.soundcloudUrn)&&!old.has(t.id)&&isFlowTrackUnplayed(t));
     state.queueIds=interleaveByArtist([...(state.queueIds||[]).map(getTrack),...extra]).map(t=>t.id);renderAll();
    }
    if(!data.hasMore)break;
   }catch(_){break;}
  }
 }
 // Scene candidates load when requested, rather than scanning on startup.
 renderMoodChips();renderCollections();renderFlowMode();warmAllArt();
})();

/* Long music lists expose a Telegram-style return-to-top control. */
(() => {
 const behavior=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
 const controls=[];
 function add(id,host,target,visible,bottom){
  if(!host||!target)return;
  const button=document.createElement('button');button.id=id;button.type='button';button.className='music-scroll-top';button.setAttribute('aria-label','Наверх');button.title='Наверх';
  button.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 14 6-6 6 6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if(bottom)button.classList.add('music-scroll-top-search');
  host.append(button);
  button.onclick=()=>{if(typeof triggerHaptic==='function')triggerHaptic('selection');target.scrollTo({top:0,behavior:behavior()});};
  controls.push({button,target,visible});
 }
 const sheet=id=>document.querySelector('#'+id+' > .col-sheet-panel');
 add('search-scroll-top',document.getElementById('app-shell'),window,()=>state.activeTab==='search'&&!document.documentElement.classList.contains('telefy-sheet-open'),true);
 for(const [modal,target,id]of [['collection-modal',sheet('collection-modal'),'collection-scroll-top'],['library-modal',document.getElementById('library-modal-tracks'),'library-scroll-top'],['create-playlist-modal',document.getElementById('playlist-editor-tracks'),'playlist-scroll-top']]){
  const host=document.getElementById(modal);add(id,host,target,()=>!host.classList.contains('hidden')&&!host.classList.contains('is-closing'));
 }
 function sync(){for(const c of controls){const y=c.target===window?window.scrollY:c.target.scrollTop;const shown=c.visible()&&y>280;c.button.classList.toggle('is-visible',shown);c.button.tabIndex=shown?0:-1;c.button.setAttribute('aria-hidden',String(!shown));}}
 let frame=0;function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;sync();});}
 document.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
 const observer=new MutationObserver(schedule);for(const id of ['view-search','collection-modal','library-modal','create-playlist-modal']){const e=document.getElementById(id);if(e)observer.observe(e,{attributes:true,attributeFilter:['class']});}
 document.querySelector('.nav-tab[data-tab="search"]')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:behavior()}));
 sync();
})();
