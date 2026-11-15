/* This script loads before app.js; the boot hook is called after the app exists. */
(() => {
 const key='telefy_first_track_v1';let started=false;
 let pending=false;try{pending=!localStorage.getItem(key)&&!JSON.parse(localStorage.getItem('telefy_qualified_listens_v1')||'[]').length;}catch(_){pending=true;}
 function setLoading(loading){document.querySelectorAll('#btn-hero-play,#mini-play-btn,#btn-full-play').forEach(b=>b.disabled=loading);}
 function finish(){pending=false;try{localStorage.setItem(key,'1');}catch(_){}setLoading(false);}
 window.TelefyFirstRun={get pending(){return pending;},async boot(){
  if(started||!pending)return;started=true;setLoading(true);
  const original=playTrack;playTrack=function(id,...args){if(tracks.some(t=>t.id===id))finish();return original(id,...args);};
  try{
   const response=await fetch('/api/soundcloud/search?q=telefy%3Awelcome',{signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error('welcome');const data=await response.json();mergeParsedTracksIntoCatalog(data.tracks||[]);
   const found=tracks.find(t=>t.soundcloudUrn===data.tracks?.[0]?.soundcloudUrn);
   if(!found)throw Error('empty_welcome');
   if(pending&&found){state.currentTrackId=found.id;state.progressSec=0;state.isPlaying=false;finish();renderAll();}
  }catch(_){if(pending){
   const candidates=tracks.filter(t=>!window.TelefyPromotionExcluded?.(t)&&!window.telefySongBlocked?.(t)&&/rap|hip.?hop|trap|plugg|drill|rage|рэп|трэп/i.test(t.genre||''));
   if(candidates.length){state.currentTrackId=candidates[Math.floor(Math.random()*candidates.length)].id;state.isPlaying=false;state.progressSec=0;finish();}
   else {pending=false;setLoading(false);state.isCatalogParsing=false;state.catalogError=tracks.length?null:'network';}
   renderAll();
  }}
 }};
})();
