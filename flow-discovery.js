/* Personal stream: actual queue, cover carousel and bounded AI notes. */
(()=>{
 const view=document.getElementById('view-flow'),art=document.getElementById('flow-discovery-art'),title=document.getElementById('flow-discovery-title'),artist=document.getElementById('flow-discovery-artist'),note=document.getElementById('flow-discovery-description');
 const left=document.getElementById('flow-cover-prev'),right=document.getElementById('flow-cover-next'),play=document.getElementById('flow-cover-play');
 let key='',token=0,provider=null,drag=null,direction=1;const cache=new Map(),inflight=new Map();
 function upcoming(){return [...new Set(getUpcomingPlaybackIds())].filter(id=>id!==state.currentTrackId&&tracks.some(t=>t.id===id));}
 function cover(el,t){const url=/^https:\/\//.test(t?.coverImg||'')?t.coverImg:'';el.style.backgroundImage=url?'url('+JSON.stringify(url)+')':'';el.classList.toggle('no-cover',!url);}
 function personal(){if(state.activeMood!=='all'||state.playbackContext||window.TelefyOrderedQueue?.snapshot())applyStreamMode('all',false);}
 function next(){direction=1;personal();triggerHaptic('light');playNext();}
 function previous(){direction=-1;personal();triggerHaptic('light');playPrev();}
 async function render(){
  const track=getTrack(state.currentTrackId),en=state.lang==='en';
  document.getElementById('flow-stream-name').textContent=en?'My flow':'Мой поток';document.getElementById('flow-stream-subtitle').textContent=en?'Everything that fits your music taste':'Всё, что похоже на твой музыкальный вкус';
  view.classList.toggle('is-playing',Boolean(state.isPlaying));play.setAttribute('aria-label',en?(state.isPlaying?'Pause':'Play'):(state.isPlaying?'Пауза':'Слушать'));play.innerHTML=state.isPlaying?'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z"/></svg>';
  play.disabled=!track?.id;left.disabled=!track?.id;
  const ids=upcoming();cover(right,tracks.find(t=>t.id===ids[0]));right.disabled=!ids.length;
  const h=playbackHistory.entries.slice(0,playbackHistory.index);const last=h.map(x=>typeof x==='object'?x.id:x).filter(id=>id!==track?.id).pop();cover(left,tracks.find(t=>t.id===last));
  if(!track?.id){key='';token++;cover(art,null);cover(document.getElementById('flow-discovery-backdrop'),null);title.textContent=en?'Your music will appear here':'Здесь появится твоя музыка';artist.textContent='';note.textContent='';return;}
  const nextKey=JSON.stringify([track.id,track.coverImg,track.title,track.artist,state.lang,state.activeTab]);if(key===nextKey)return;key=nextKey;const generation=++token;
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)art.animate([{opacity:.35,transform:`translateX(${direction*36}px) rotate(${direction*5}deg) scale(.97)`},{opacity:1,transform:'translateX(0) scale(1)'}],{duration:320,easing:'cubic-bezier(.22,1,.36,1)'});
  title.textContent=track.title;artist.textContent=track.artist;cover(art,track);cover(document.getElementById('flow-discovery-backdrop'),track);
  note.classList.remove('has-note');note.textContent='';
  if(state.activeTab!=='flow'||!provider)return;
  const cacheKey=track.id+':'+state.lang;
  try{let text=cache.get(cacheKey);if(!text){let job=inflight.get(cacheKey);if(!job){job=Promise.resolve().then(()=>provider({...track,language:state.lang}));inflight.set(cacheKey,job);}try{text=await job;}finally{if(inflight.get(cacheKey)===job)inflight.delete(cacheKey);}if(typeof text!=='string'||!text.trim())return;text=text.trim().slice(0,320);cache.set(cacheKey,text);if(cache.size>100)cache.delete(cache.keys().next().value);}
   if(generation!==token)return;note.textContent='Telefy AI: '+text;requestAnimationFrame(()=>note.classList.add('has-note'));
  }catch(_){/* No invented description or permanent loading label. */}
 }
 window.TelefyFlowDescriptions={setProvider(fn){provider=typeof fn==='function'?fn:null;key='';render();}};
 const before=renderPlayerUI;renderPlayerUI=function(...args){const r=before(...args);render();return r;};
 const oldSwitch=switchTab;switchTab=function(tab,...args){const r=oldSwitch(tab,...args);if(tab==='flow'){personal();render();}return r;};
 const beforeFlow=renderFlowView;renderFlowView=function(...args){const r=beforeFlow(...args);render();return r;};
 play.onclick=()=>{personal();togglePlay();triggerHaptic('light');};left.onclick=previous;right.onclick=next;
 let suppressClickUntil=0;const scene=document.getElementById('flow-cover-scene');scene.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);scene.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,id:e.pointerId};});scene.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.5){art.style.transform=`translateX(${Math.max(-65,Math.min(65,dx*.35))}px) rotate(${dx*.025}deg)`;}});scene.addEventListener('pointerup',e=>{art.style.transform='';if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5){e.preventDefault();suppressClickUntil=Date.now()+400;if(dx<0)next();else previous();}});scene.addEventListener('pointercancel',()=>{drag=null;art.style.transform='';});
 fetch('/api/ai/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{if(s.configured)window.TelefyFlowDescriptions.setProvider(async track=>{const r=await fetch('/api/ai/description',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:track.id,soundcloudUrn:track.soundcloudUrn,title:track.title,artist:track.artist,album:track.album,genre:track.genre,lang:track.language}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('description');return(await r.json()).description;});}).catch(()=>{});
 render();
})();
