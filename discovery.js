/* SoundCloud discovery adapters, separated from playback. */
(() => {
 const coverKey='telefy_collection_art_v2_first_track';let coverCache={},legacyCoverCache={};
 try{coverCache=JSON.parse(localStorage.getItem(coverKey)||'{}');legacyCoverCache=JSON.parse(localStorage.getItem('telefy_collection_art_v1')||'{}');}catch(_){}
 for(const col of COLLECTIONS){const c=col.id==='premiere'?legacyCoverCache[col.id]||coverCache[col.id]:coverCache[col.id];if(c&&c.url?.startsWith('https://')){col.coverImg=c.url;col.coverFirstUrn=c.urn||null;}}
 function rememberCover(col,url,urn){
  col.coverImg=url||null;col.coverFirstUrn=urn||null;coverCache[col.id]={url:url||'',urn:urn||null,at:Date.now()};
  try{localStorage.setItem(coverKey,JSON.stringify(coverCache));}catch(_){}
 }
 async function warmCollectionArt(col,attempt=0){
  if(col.id==='premiere'&&col.coverImg)return;
  try{const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:cover:'+col.id}),{signal:AbortSignal.timeout(30000)});if(!r.ok)return;const data=await r.json();
   if(!data.coverImg?.startsWith('https://')){if(data.pending&&attempt<3)setTimeout(()=>warmCollectionArt(col,attempt+1),5000);return;}
   // A playlist loaded during prefetch has the authoritative displayed order.
   if(col.id!=='premiere'&&col.trackIds.length){const first=tracks.find(t=>t.id===col.trackIds[0]);if(first){rememberCover(col,first.coverImg,first.soundcloudUrn);return;}}
   rememberCover(col,data.coverImg,data.firstTrackUrn);renderCollections();if(state.activeCollectionId===col.id)updateCollectionPresentation();
  }catch(_){}
 }
 // Artwork does not wait for Trends or import all songs in each playlist.
 async function warmAllArt(){for(let i=0;i<COLLECTIONS.length;i+=2)await Promise.allSettled(COLLECTIONS.slice(i,i+2).map(col=>warmCollectionArt(col)));}
 window.TelefyTrendMembership=new Set();
 const memberships=new Map(),pending=new Map(),modeOffsets=new Map(),editorialOrder=new Map(),importTimers=new Map();
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
  else if(col.importPending){const skeleton=document.createElement('div');skeleton.innerHTML=window.TelefySkeleton.html('tracks',col.trackIds.length?3:6);box.append(skeleton);}
  else if(!col.trackIds.length){const p=document.createElement('p');p.className='px-4 py-5 text-center text-muted text-sm';p.textContent=col.importError?'Не удалось подключить источник. Повтори загрузку.':col.importPending?'Подготавливаем треки подборки…':'Треки пока не найдены';box.append(p);}
  if(!finished.has(col.id)||error){const b=document.createElement('button');b.type='button';b.className='w-full py-4 text-sm text-[#2AABEE]';b.textContent=error?'Повторить загрузку':'Загрузить ещё';b.onclick=()=>ensureCollectionTracksLoaded(col,true);box.append(b);}
 }
 // Reopening a sheet does not restart all artist searches from page zero.
 ensureCollectionTracksLoaded=async function(col,more=false){
  if(col?.id==='recommendations')return window.TelefyRecommendations?.load();
  if(!col?.curated)return;
  if(pending.has(col.id))return pending.get(col.id);
  if(!more&&loadedAt.has(col.id)&&Date.now()-loadedAt.get(col.id)<21600000){paintCollection(col);return;}
  if(more&&finished.has(col.id))return;
  const task=(async()=>{
   try{
    const box=document.getElementById('col-modal-tracks');let placeholder;if(state.activeCollectionId===col.id){placeholder=document.createElement('div');placeholder.innerHTML=window.TelefySkeleton.html('tracks',col.trackIds.length?3:6);if(!col.trackIds.length)box.replaceChildren(placeholder);else box.append(placeholder);}
    const offset=positions.get(col.id)||0,data=await fetchBatch(col.id,offset);
    col.importPending=data.importPending||0;col.importError=data.importError||null;const editorial=editorialOrder.get(col.id)||new Map();for(const row of data.tracks||[])editorial.set(row.soundcloudUrn,{year:Number(row.editorialYear)||0,order:Number(row.editorialOrder)||0});editorialOrder.set(col.id,editorial);
    const urns=memberships.get(col.id)||new Set();(data.tracks||[]).forEach(t=>urns.add(t.soundcloudUrn));importBatch(data.tracks||[]);memberships.set(col.id,urns);
    const unique=new Set(),selected=tracks.filter(t=>urns.has(t.soundcloudUrn)).filter(t=>{const key=getTrackUniqueKey(t);if(unique.has(key))return false;unique.add(key);return true;});
    col.trackIds=(['hits','legends'].includes(col.id)?selected.sort((a,b)=>{const x=editorial.get(a.soundcloudUrn)||{},y=editorial.get(b.soundcloudUrn)||{};return (col.id==='hits'?(y.year||0)-(x.year||0):0)||((x.order||0)-(y.order||0));}):interleaveByArtist(selected)).slice(0,500).map(t=>t.id);
    positions.set(col.id,data.nextOffset);loadedAt.set(col.id,Date.now());if(!data.hasMore)finished.add(col.id);
    if(col.id!=='premiere'){const first=tracks.find(t=>t.id===col.trackIds[0]);if(first)rememberCover(col,first.coverImg,first.soundcloudUrn);}else if(!col.coverImg){const first=selected.find(t=>t.coverImg);if(first)rememberCover(col,first.coverImg,first.soundcloudUrn);}
    renderCollections();paintCollection(col);
   }catch(error){paintCollection(col,error);}
  })();pending.set(col.id,task);try{await task;}finally{pending.delete(col.id);clearTimeout(importTimers.get(col.id));if(col.importPending&&!col.importError)importTimers.set(col.id,setTimeout(()=>{if(state.activeCollectionId===col.id&&!document.getElementById('collection-modal').classList.contains('hidden'))ensureCollectionTracksLoaded(col,true);},5000));}
 };

 const catalog=window.TelefySoundCloud;const original=catalog.refill;
 catalog.refill=async function(autoPlay=false){
  if(state.playbackContext==='favorites'||window.TelefyOrderedQueue?.active)return;
  const mood=state.activeMood;if(!mood||mood==='all')return original(autoPlay);
  if(mood==='underground'){const ready=(state.queueIds||[]).filter(id=>{const t=tracks.find(t=>t.id===id);return t&&doesTrackMatchMood(t,mood)&&isFlowTrackUnplayed(t);});if(ready.length>=16){state.queueIds=ready;if(autoPlay)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);return;}}
  const key='mode:'+mood;if(pending.has(key)){await pending.get(key);if(autoPlay&&state.activeMood===mood&&!doesTrackMatchMood(getTrack(state.currentTrackId),mood)&&state.queueIds.length)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);return;}
  const task=(async()=>{try{
   let offset=modeOffsets.get(mood)||0,data;for(let attempt=0;attempt<2;attempt++){data=await fetchBatch(mood,offset);if(state.activeMood!==mood)return;if(data.tracks.some(t=>t.classificationVersion===4&&t.modes?.includes(mood)&&isFlowTrackUnplayed(t))||!data.hasMore)break;offset=data.nextOffset;}modeOffsets.set(mood,data.hasMore?data.nextOffset:0);if(mood==='underground')data.tracks.filter(t=>t.trendsEligible===true).forEach(t=>window.TelefyTrendMembership.add(t.soundcloudUrn));importBatch(data.tracks);if(state.activeMood!==mood)return;
   const pageUrns=new Set(data.tracks.map(t=>t.soundcloudUrn));
   const old=new Set(state.queueIds);
   state.queueIds=(state.queueIds||[]).filter(id=>{const t=tracks.find(t=>t.id===id);return t&&doesTrackMatchMood(t,mood)&&isFlowTrackUnplayed(t);});const candidates=interleaveByArtist(tracks.filter(t=>(mood!=='underground'||pageUrns.has(t.soundcloudUrn))&&doesTrackMatchMood(t,mood)&&isFlowTrackUnplayed(t)&&!old.has(t.id)));
   const ranked=window.TelefySmartSelection.diverse(candidates,60);
   const capturedSource=state.sourceLabel;
   // AI refines upcoming choices in the background; playback never waits on it.
   window.TelefySmartSelection.rank(candidates,mood==='underground'?'trends':mood==='night'?'night':'energy').then(ordered=>{
    if(state.activeMood!==mood||window.TelefyOrderedQueue?.active||state.playbackContext==='favorites'||state.sourceLabel!==capturedSource)return;
    const eligible=new Set((state.queueIds||[]));const order=ordered.filter(t=>eligible.has(t.id)&&t.id!==state.currentTrackId).map(t=>t.id);
    state.queueIds=[...order,...state.queueIds.filter(id=>!order.includes(id)&&id!==state.currentTrackId)];
   }).catch(()=>{});
   if(state.activeMood!==mood||state.playbackContext==='favorites')return;
   state.queueIds.push(...ranked.map(t=>t.id));if(autoPlay&&state.queueIds.length)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);else renderAll();
   if(mood==='underground'&&state.queueIds.length<=8){
    const needsContinuation=autoPlay&&!state.queueIds.length;
    const prepared=window.TelefyTrendContinuation?.prepare();
    if(needsContinuation){await prepared;if(state.activeMood!==mood||window.TelefyOrderedQueue?.active)return;if(window.TelefyTrendContinuation?.activate())return;}
   }
   if(autoPlay&&!doesTrackMatchMood(getTrack(state.currentTrackId),mood)&&!candidates.length&&!state.queueIds.length)showToast(state.lang==='en'?'No matching tracks yet':'Подходящих треков пока нет');
  }catch(e){if(autoPlay&&mood==='underground'&&window.TelefyTrendContinuation?.activate())return;if(autoPlay&&state.activeMood===mood)showToast(e.status===429?(state.lang==='en'?'Music service is busy. Loaded tracks remain available.':'Музыкальный сервис ограничил запросы. Загруженные треки сохранены.'):(state.lang==='en'?'Could not load this mode':'Не удалось загрузить режим'));}})();
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
 add('search-scroll-top',document.getElementById('app-shell'),window,()=>['search','favorites'].includes(state.activeTab)&&!document.documentElement.classList.contains('telefy-sheet-open'),true);
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

(()=>{const previous=window.TelefySoundCloud.refill;let order=[],pool=[],pending=null,importPending=0,importTimer=null,importRounds=0;
const shuffle=list=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
window.TelefySoundCloud.refill=async function(autoPlay=false){
 if(state.activeMood!=='underground')return previous(autoPlay);
 if(window.TelefyOrderedQueue?.active||state.playbackContext==='favorites')return;
 if(pending){await pending;return;}
 state.queueIds=(state.queueIds||[]).filter(id=>tracks.some(t=>t.id===id&&pool.includes(t.soundcloudUrn)));
 pending=(async()=>{try{
  if(!pool.length||importPending){const r=await fetch('/api/soundcloud/search?q=telefy%3Adiscovery%3Aunderground&offset=0&limit=50',{signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok)throw Error('curated');const before=new Set(pool);mergeParsedTracksIntoCatalog(d.tracks||[]);pool=(d.tracks||[]).map(t=>t.soundcloudUrn);importPending=d.importPending||0;if(order.length)order.push(...shuffle(tracks.filter(t=>pool.includes(t.soundcloudUrn)&&!before.has(t.soundcloudUrn)).map(t=>t.id)));}
  if(state.activeMood!=='underground'||window.TelefyOrderedQueue?.active)return;
  pool.forEach(urn=>window.TelefyTrendMembership.add(urn));
  const valid=tracks.filter(t=>pool.includes(t.soundcloudUrn)&&!t.disliked);
  if(!order.length)order=shuffle(valid.map(t=>t.id));
  order=order.filter(id=>valid.some(t=>t.id===id)&&id!==state.currentTrackId);
  if(!order.length)order=shuffle(valid.filter(t=>t.id!==state.currentTrackId).map(t=>t.id));
  state.queueIds=order.slice();
  if(autoPlay&&state.queueIds.length){const id=state.queueIds.shift();order=order.filter(x=>x!==id);playTrack(id,getMoodText('underground').streamTitle);}else renderAll();
 }catch(_){if(autoPlay)showToast('Не удалось загрузить утверждённые треки');}finally{pending=null;if(importPending&&importRounds++<25&&!importTimer)importTimer=setTimeout(()=>{importTimer=null;if(state.activeMood==='underground')window.TelefySoundCloud.refill(false);},15000);}})();await pending;
};
const play=playTrack;playTrack=function(id,...args){if(state.activeMood==='underground')order=order.filter(x=>x!==id);return play(id,...args);};
const next=playNext;playNext=function(ended=false){if(state.activeMood!=='underground'||window.TelefyOrderedQueue?.active)return next(ended);if(ended&&isRepeat){playTrack(state.currentTrackId,state.sourceLabel,{fromHistory:true});return;}const valid=(state.queueIds||[]).filter(id=>tracks.some(t=>t.id===id&&pool.includes(t.soundcloudUrn)&&!t.disliked));state.queueIds=valid;if(valid.length){playTrack(state.queueIds.shift(),getMoodText('underground').streamTitle);return;}window.TelefySoundCloud.refill(true);};
})();

window.TelefyChillMembership=new Set();
(()=>{const previous=window.TelefySoundCloud.refill;let order=[],pool=[],pending=null,importPending=0,importTimer=null,importRounds=0;
const shuffle=list=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
window.TelefySoundCloud.refill=async function(autoPlay=false){
 if(state.activeMood!=='night')return previous(autoPlay);
 if(window.TelefyOrderedQueue?.active||state.playbackContext==='favorites')return;
 if(pending){await pending;return;}
 state.queueIds=(state.queueIds||[]).filter(id=>tracks.some(t=>t.id===id&&pool.includes(t.soundcloudUrn)));
 pending=(async()=>{try{
  if(!pool.length||importPending){const r=await fetch('/api/soundcloud/search?q=telefy%3Adiscovery%3Anight&offset=0&limit=50',{signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok)throw Error('curated');const before=new Set(pool);mergeParsedTracksIntoCatalog(d.tracks||[]);pool=(d.tracks||[]).map(t=>t.soundcloudUrn);importPending=d.importPending||0;if(order.length)order.push(...shuffle(tracks.filter(t=>pool.includes(t.soundcloudUrn)&&!before.has(t.soundcloudUrn)).map(t=>t.id)));}
  if(state.activeMood!=='night'||window.TelefyOrderedQueue?.active)return;
  pool.forEach(urn=>window.TelefyChillMembership.add(urn));
  const valid=tracks.filter(t=>pool.includes(t.soundcloudUrn)&&!t.disliked);
  if(!order.length)order=shuffle(valid.map(t=>t.id));
  order=order.filter(id=>valid.some(t=>t.id===id)&&id!==state.currentTrackId);
  if(!order.length)order=shuffle(valid.filter(t=>t.id!==state.currentTrackId).map(t=>t.id));
  state.queueIds=order.slice();
  if(autoPlay&&state.queueIds.length){const id=state.queueIds.shift();order=order.filter(x=>x!==id);playTrack(id,getMoodText('night').streamTitle);}else renderAll();
 }catch(_){if(autoPlay)showToast('Не удалось загрузить утверждённые треки');}finally{pending=null;if(importPending&&importRounds++<25&&!importTimer)importTimer=setTimeout(()=>{importTimer=null;if(state.activeMood==='night')window.TelefySoundCloud.refill(false);},15000);}})();await pending;
};
const play=playTrack;playTrack=function(id,...args){if(state.activeMood==='night')order=order.filter(x=>x!==id);return play(id,...args);};
const next=playNext;playNext=function(ended=false){if(state.activeMood!=='night'||window.TelefyOrderedQueue?.active)return next(ended);if(ended&&isRepeat){playTrack(state.currentTrackId,state.sourceLabel,{fromHistory:true});return;}const valid=(state.queueIds||[]).filter(id=>tracks.some(t=>t.id===id&&pool.includes(t.soundcloudUrn)&&!t.disliked));state.queueIds=valid;if(valid.length){playTrack(state.queueIds.shift(),getMoodText('night').streamTitle);return;}window.TelefySoundCloud.refill(true);};
})();
