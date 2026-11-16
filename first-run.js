/* Every app opening starts in Trends; old cached songs never become the hero. */
(() => {
 let started=false,pending=true,loading=false,failed=false;
 const controls=()=>['btn-hero-play','mini-play-btn','btn-full-play'].map(id=>document.getElementById(id)).filter(Boolean);
 function unlock(){pending=false;loading=false;failed=false;controls().forEach(b=>b.disabled=false);}
 async function boot(retry=false){
  if((started&&!retry)||loading)return;started=true;loading=true;failed=false;
  state.activeMood='underground';flowModeIndex=MOODS.findIndex(m=>m.id==='underground');
  state.sourceLabel=getMoodText('underground').streamTitle;state.currentTrackId=0;state.queueIds=[];state.progressSec=0;state.isPlaying=false;
  document.getElementById('home-stream-title').textContent=state.sourceLabel;
  document.getElementById('home-stream-desc').textContent=getMoodText('underground').shortDesc;
  controls().forEach(b=>b.disabled=true);renderMoodChips();renderFlowMode();renderAll();
  try{
   await window.TelefySoundCloud.refill(false);
   if(!pending||state.activeMood!=='underground')return;
   const candidates=[...new Set(state.queueIds)].map(id=>tracks.find(t=>t.id===id)).filter(t=>t&&doesTrackMatchMood(t,'underground'));
   const first=candidates[0];if(!first)throw Error('trends_unavailable');
   state.currentTrackId=first.id;state.queueIds=candidates.slice(1).map(t=>t.id);state.progressSec=0;state.isPlaying=false;
   unlock();try{localStorage.setItem('telefy_first_track_v1','1');}catch(_){}
  }catch(_){if(pending&&state.activeMood==='underground'){failed=true;state.currentTrackId=0;state.queueIds=[];state.isPlaying=false;}}
  finally{loading=false;controls().forEach(b=>b.disabled=false);if(state.activeMood!=='underground')unlock();renderAll();}
 }
 window.TelefyFirstRun={boot,cancel:unlock,get pending(){return pending;},get failed(){return failed;},get loading(){return loading;}};
 document.addEventListener('DOMContentLoaded',()=>{
  const original=playTrack;
  playTrack=function(id,...args){if(tracks.some(t=>t.id===id))unlock();return original(id,...args);};
  controls().forEach(button=>button.addEventListener('click',event=>{
   if(!pending)return;event.preventDefault();event.stopImmediatePropagation();boot(true);
  },true));
 });
})();
