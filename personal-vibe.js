/* Twenty distinct qualified tracks unlock taste-based discovery. */
(() => {
 const storageKey=()=> 'telefy_recent20_v1_'+(window.TelefyProfile?.user?.telegram_id||'local');
 let history=[],busy=null,timer=null,sessionKeys=[],lastRefill=0,cloudUser=null;
 const unique=list=>{const map=new Map();list.sort((a,b)=>(a.at||0)-(b.at||0)).forEach(h=>{if(h.key){map.delete(h.key);map.set(h.key,h);}});return [...map.values()].slice(-20);};
 function restore(){try{history=unique(JSON.parse(localStorage.getItem(storageKey())||'[]'));}catch(_){history=[];}}
 function save(){try{localStorage.setItem(storageKey(),JSON.stringify(history));}catch(_){}}
 restore();
 const ready=()=>history.length>=20;
 const allowed=t=>t&&!t.disliked&&!window.TelefyPromotionExcluded?.(t)&&(!window.TelefyRapCandidate||window.TelefyRapCandidate(t));
 const artistKey=s=>normalizeArtistToken(findRosterConfig(s)?.name||getPrimaryArtistName(s));
 function score(tr){let n=window.TelefyAI?.score(tr)||0;const artist=artistKey(tr.primaryArtist||tr.artist);history.forEach((h,i)=>{const w=(i+1)/20;if(artistKey(h.artist)===artist)n+=3*w;n+=(tr.modes||[]).filter(m=>(h.modes||[]).includes(m)).length*.55*w;if(h.genre&&tr.genre&&h.genre.toLowerCase()===tr.genre.toLowerCase())n+=.25*w;});return n/Math.max(1,history.length/3)+(window.TelefySmartSelection?.score(tr)||0);}
 const shuffle=list=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 function pool(){
  let candidates=tracks.filter(allowed),heard=new Set(history.map(h=>h.key));
  const recent=new Set([...sessionKeys.slice(-30),...(typeof recentFlowHistoryIds!=='undefined'?recentFlowHistoryIds.slice(-10).map(id=>tracks.find(t=>t.id===id)).filter(Boolean).map(getTrackUniqueKey):[])]);
  const unseenRecent=candidates.filter(t=>!recent.has(getTrackUniqueKey(t)));
  if(unseenRecent.length)candidates=unseenRecent;
  if(!ready())return window.TelefySmartSelection.diverse(shuffle(candidates),60);
  const rank=list=>list.map(tr=>({tr,n:score(tr)})).filter(x=>x.n>=.6).sort((a,b)=>b.n-a.n).slice(0,100).map(x=>x.tr);
  const fresh=rank(candidates.filter(t=>!heard.has(getTrackUniqueKey(t)))),familiar=rank(candidates.filter(t=>heard.has(getTrackUniqueKey(t))));
  // New discoveries lead, familiar tracks remain a minority when available.
  const result=[];while(fresh.length||familiar.length){result.push(...fresh.splice(0,3));if(familiar.length)result.push(familiar.shift());}
  return window.TelefySmartSelection.diverse(result.length?result:shuffle(candidates),60);
 }
 getMyVibeTracksPool=pool;
 function updatePlaylist(){
  if(!window.TelefyLibrary?.ready)return;
  if(typeof USER_PLAYLISTS==='undefined')return;
  const old=USER_PLAYLISTS.find(p=>p.personal);
  const keep=USER_PLAYLISTS.filter(p=>!p.personal);const changed=keep.length!==USER_PLAYLISTS.length;
  if(!state.isMaxSubscribed)return;
  if(!ready()){if(window.TelefyTaste?.restored&&changed){USER_PLAYLISTS.splice(0,USER_PLAYLISTS.length,...keep);saveUserPlaylists();}return;}
  const heard=new Set(history.map(h=>h.key));
  const candidates=tracks.filter(allowed).map(tr=>({tr,n:score(tr)})).filter(x=>x.n>=.6||heard.has(getTrackUniqueKey(x.tr))).sort((a,b)=>b.n-a.n).map(x=>x.tr);
  const selected=[...candidates.filter(t=>!heard.has(getTrackUniqueKey(t))).slice(0,12),...candidates.filter(t=>heard.has(getTrackUniqueKey(t))).slice(0,8)];
  for(const t of candidates)if(selected.length<20&&!selected.some(x=>getTrackUniqueKey(x)===getTrackUniqueKey(t)))selected.push(t);
  // Never publish a tiny automatic playlist while discovery is still loading.
  const varied=window.TelefySmartSelection.diverse(candidates,20);if(varied.length<20)return;selected.splice(0,selected.length,...varied);
  const pl={...(old||{}),id:old?.id||'personal_vibe_1',title:'Мой вайб #1',subtitle:'Музыка в твоём вкусе',cover:'#2AABEE',coverImg:old?.coverImg||selected[0]?.coverImg||null,trackIds:selected.map(t=>t.id),trackKeys:selected.map(getTrackUniqueKey),personal:true};
  USER_PLAYLISTS.splice(0,USER_PLAYLISTS.length,...keep,pl);saveUserPlaylists();
 }
 async function cloudRestore(){const account=storageKey();cloudUser=null;restore();try{const r=await fetch('/api/me/taste',{cache:'no-store'});if(r.ok){const data=await r.json();if(storageKey()!==account)return;history=unique([...(data.history||[]),...history]);save();}}catch(_){}if(storageKey()!==account)return;cloudUser=account;updatePlaylist();if(ready())scheduleRefill();}
 window.addEventListener('telefy:profile-ready',cloudRestore);
 window.addEventListener('telefy:library-ready',updatePlaylist);
 if(window.TelefyProfile?.user)cloudRestore();
 function record(tr){
  const eventId=globalThis.crypto?.randomUUID?.()||('play_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const event={eventId,at:Date.now(),key:getTrackUniqueKey(tr),artist:tr.primaryArtist||tr.artist,modes:tr.modes||[],genre:tr.genre||'',urn:tr.soundcloudUrn};
  history=unique([...history,event]);save();updatePlaylist();if(ready()&&(isMyVibeStreamActive()||typeof USER_PLAYLISTS!=='undefined'&&!USER_PLAYLISTS.some(p=>p.personal)))scheduleRefill();
  if(window.TelefyProfile?.user)fetch('/api/me/taste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)}).catch(()=>{});
 }
 function scheduleRefill(){clearTimeout(timer);timer=setTimeout(()=>refill(),300);}
 async function refill(){
  if(busy)return busy;if(Date.now()-lastRefill<180000)return;lastRefill=Date.now();
  busy=(async()=>{
   const weights=new Map();if(ready())history.forEach((h,i)=>weights.set(h.artist,(weights.get(h.artist)||0)+i+1));
   const favorite=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
   const modes=new Map();if(ready())history.forEach(h=>(h.modes||[]).forEach(m=>modes.set(m,(modes.get(m)||0)+1)));
   const mode=[...modes].sort((a,b)=>b[1]-a[1])[0]?.[0];
   const seeds=shuffle(['PHARAOH','9mice','Kai Angel','madk1d','FORTUNA 812','OG Buda','SODA LUV','Boulevard Depo','Big Baby Tape','ЛСП','Markul']);
   const queries=[...favorite,...seeds.filter(a=>!favorite.includes(a)).slice(0,2)];
   await Promise.allSettled(queries.map(async q=>{const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q,limit:50}),{signal:AbortSignal.timeout(25000)});if(r.ok){const data=await r.json();mergeParsedTracksIntoCatalog(data.tracks||[]);}}));
   await window.TelefySmartSelection.rank(pool(),'vibe');updatePlaylist();if(typeof renderMaxBetaView==='function')renderMaxBetaView();
  })().finally(()=>{busy=null;});return busy;
 }
 async function start(){
  window.TelefyFirstRun?.cancel();
  triggerHaptic('medium');state.activeMood='all';if(typeof flowModeIndex!=='undefined')flowModeIndex=0;state.sourceLabel=state.lang==='en'?'My Vibe':'Мой вайб';
  const label=state.sourceLabel,desc=state.lang==='en'?'Music that fits you':'Музыка в твоём вкусе';
  for(const id of ['home-stream-title','flow-stream-name']){const e=document.getElementById(id);if(e)e.textContent=label;}
  const subtitle=document.getElementById('home-stream-desc');if(subtitle)subtitle.textContent=desc;
  if(typeof renderMoodChips==='function')renderMoodChips();
  let candidates=pool().filter(t=>t.id!==state.currentTrackId);
  if(candidates.length<20||new Set(candidates.map(window.TelefySmartSelection.artist)).size<4){await refill();if(!isMyVibeStreamActive())return;candidates=pool().filter(t=>t.id!==state.currentTrackId);}
  candidates=await window.TelefySmartSelection.rank(candidates,'vibe');if(!isMyVibeStreamActive())return;
  if(candidates.length){state.queueIds=candidates.slice(1,41).map(t=>t.id);sessionKeys.push(getTrackUniqueKey(candidates[0]));playTrack(candidates[0].id,label);}
  else{state.isPlaying=false;syncRealAudio();}
  if(ready())scheduleRefill();
 }
 const originalPlay=playTrack;
 playTrack=function(id,...args){const t=tracks.find(t=>t.id===id);if(t&&isMyVibeStreamActive()){sessionKeys.push(getTrackUniqueKey(t));sessionKeys=sessionKeys.slice(-40);}return originalPlay(id,...args);};
 window.TelefyTaste={record,score,start,refill,updatePlaylist,get restored(){return !window.TelefyProfile?.user||cloudUser===storageKey();},get ready(){return ready();},get history(){return history.slice();}};
 updatePlaylist();
})();
