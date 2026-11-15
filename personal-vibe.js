/* Local, user-scoped recent taste window. Audio accounting remains in app.js. */
(() => {
 window.TelefyPromotionExcluded=tr=>/(^|[^a-zа-яё])(?:баста|basta|ноггано|noggano|1.?клас|1.?kla[$sс]+|смоки[ ]*мо|smoky[ ]*mo|smokey[ ]*mo)(?=$|[^a-zа-яё])/i.test([tr?.artist,tr?.title].join(' '));
 const storageKey=()=> 'telefy_recent20_v1_'+(window.TelefyProfile?.user?.telegram_id||'local');
 let history=[];
 function restore(){try{const data=JSON.parse(localStorage.getItem(storageKey())||'[]');history=Array.isArray(data)?data.slice(-20):[];}catch(_){history=[];}}
 restore();
 async function cloudRestore(){restore();try{const r=await fetch('/api/me/taste',{cache:'no-store'});if(!r.ok)return;const data=await r.json();
  const merged=new Map();[...(data.history||[]),...history].forEach(h=>merged.set(h.eventId||h.key,h));history=[...merged.values()].sort((a,b)=>(a.at||0)-(b.at||0)).slice(-20);
  localStorage.setItem(storageKey(),JSON.stringify(history));
 }catch(_){}}
 window.addEventListener('telefy:profile-ready',cloudRestore);
 if(window.TelefyProfile?.user)cloudRestore();
 function record(tr){
  const eventId=globalThis.crypto?.randomUUID?.()||('play_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  history.push({eventId,at:Date.now(),key:getTrackUniqueKey(tr),artist:tr.primaryArtist||tr.artist,modes:tr.modes||[],genre:tr.genre||'',urn:tr.soundcloudUrn});history=history.slice(-20);
  try{localStorage.setItem(storageKey(),JSON.stringify(history));}catch(_){}
  if(isMyVibeStreamActive()){
   const pool=getMyVibeTracksPool().filter(t=>t.id!==state.currentTrackId);state.queueIds=interleaveByArtist(pool).slice(0,30).map(t=>t.id);
  }
  if(window.TelefyProfile?.user){const record=history[history.length-1];fetch('/api/me/taste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)}).catch(()=>{});}
  scheduleRefill();
 }
 function artistKey(s){const cfg=findRosterConfig(s);return normalizeArtistToken(cfg?.name||getPrimaryArtistName(s));}
 function score(tr){
  let n=0;const artist=artistKey(tr.primaryArtist||tr.artist),modes=tr.modes||[];
  history.forEach((h,i)=>{const w=(i+1)/Math.max(1,history.length);if(artistKey(h.artist)===artist)n+=3*w;
   n+=modes.filter(m=>(h.modes||[]).includes(m)).length*.55*w;
   if(h.genre&&tr.genre&&h.genre.toLowerCase()===tr.genre.toLowerCase())n+=.25*w;
  });return n;
 }
 getMyVibeTracksPool=function(){
  if(!history.length)return tracks.filter(t=>!t.disliked&&userListenedTrackKeys.has(getTrackUniqueKey(t)));
  const ranked=tracks.filter(t=>!t.disliked&&!window.TelefyPromotionExcluded?.(t)&&(!window.TelefyRapCandidate||window.TelefyRapCandidate(t))).map(tr=>({tr,n:score(tr)})).filter(x=>x.n>=.6).sort((a,b)=>b.n-a.n);
  return ranked.slice(0,80).map(x=>x.tr);
 };
 let busy=false,timer=null;
 function scheduleRefill(){clearTimeout(timer);timer=setTimeout(refill,300);}
 async function refill(){
  if(busy||!history.length)return;busy=true;
  const weights=new Map();history.forEach((h,i)=>weights.set(h.artist,(weights.get(h.artist)||0)+i+1));
  const artists=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  try{for(const artist of artists){
   const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:artist,limit:25}),{signal:AbortSignal.timeout(25000)});if(!r.ok)continue;const data=await r.json();mergeParsedTracksIntoCatalog(data.tracks||[]);
  }}catch(_){}finally{busy=false;}
 }
 window.TelefyTaste={record,score,get history(){return history.slice();}};
})();
