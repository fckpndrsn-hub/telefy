/* SoundCloud discovery adapters, separated from playback. */
(() => {
 const memberships=new Map(),pending=new Map();
 const english={energy:['Energy','High tempo and drive'],night:['Chill vibe','Soft sound and mellow rhythms'],uncensored:['Super beat','Heavy trap and distorted bass'],underground:['Trends','Fresh popular Russian tracks']};
 for(const [id,[label,desc]]of Object.entries(english))MOOD_I18N.en[id]={label,streamTitle:label,shortDesc:desc};
 async function fetchBatch(kind,offset=0){const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:discovery:'+kind,offset,limit:50}),{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('discovery');return r.json();}
 function importBatch(items){mergeParsedTracksIntoCatalog(items);}
 ensureCollectionTracksLoaded=async function(col){
  if(!col?.curated||pending.has(col.id))return;
  const task=(async()=>{
   try{
    let offset=0,more=true;const urns=new Set(memberships.get(col.id)||[]);
    while(more){
     const data=await fetchBatch(col.id,offset);data.tracks.forEach(t=>urns.add(t.soundcloudUrn));importBatch(data.tracks);
     memberships.set(col.id,urns);let selected=tracks.filter(t=>urns.has(t.soundcloudUrn));
     if(col.id==='hits'){selected.sort((a,b)=>(b.playbackCount||0)-(a.playbackCount||0));const seen=new Set();selected=selected.filter(t=>{const k=getTrackUniqueKey(t);if(seen.has(k))return false;seen.add(k);return true;});}
     col.trackIds=selected.slice(0,100).map(t=>t.id);
     col.coverImg=tracks.find(t=>col.trackIds.includes(t.id)&&t.coverImg)?.coverImg||null;renderCollections();
     if(state.activeCollectionId===col.id){const box=document.getElementById('col-modal-tracks');box.innerHTML=col.trackIds.length?col.trackIds.map(id=>createTrackRowHTML(getTrack(id))).join(''):'<p class="px-4 py-7 text-muted text-sm">Подходящих треков пока не найдено</p>';bindTrackRowEvents(box,col.title);}
     more=data.hasMore;offset=data.nextOffset;
    }
   }catch(_){if(state.activeCollectionId===col.id){const box=document.getElementById('col-modal-tracks');if(!col.trackIds.length)box.textContent=state.lang==='en'?'Could not load collection. Open it again to retry.':'Не удалось загрузить подборку. Открой её ещё раз для повтора.';}}
  })();pending.set(col.id,task);try{await task;}finally{pending.delete(col.id);}
 };
 const catalog=window.TelefySoundCloud;const original=catalog.refill;
 catalog.refill=async function(autoPlay=false){
  const mood=state.activeMood;if(!mood||mood==='all')return original(autoPlay);
  const key='mode:'+mood;if(pending.has(key))return;
  const task=(async()=>{try{
   const data=await fetchBatch(mood);importBatch(data.tracks);if(state.activeMood!==mood)return;
   const old=new Set(state.queueIds);const candidates=tracks.filter(t=>doesTrackMatchMood(t,mood)&&isFlowTrackUnplayed(t)&&!old.has(t.id));
   state.queueIds.push(...candidates.map(t=>t.id));if(autoPlay&&state.queueIds.length)playTrack(state.queueIds.shift(),getMoodText(mood).streamTitle);else renderAll();
   if(!candidates.length&&!state.queueIds.length)showToast(state.lang==='en'?'No matching tracks yet':'Подходящих треков пока нет');
  }catch(_){showToast(state.lang==='en'?'Could not load this mode':'Не удалось загрузить режим');}})();
  pending.set(key,task);try{await task;}finally{pending.delete(key);}
 };
 renderMoodChips();renderCollections();renderFlowMode();
})();
