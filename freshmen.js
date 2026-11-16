/* Account-scoped, six-hour recommendations with incremental discovery. */
(() => {
 const id='recommendations',period=()=>Math.floor(Date.now()/21600000),uid=()=>String(window.TelefyProfile?.user?.telegram_id||'local');
 const key=()=> 'telefy_recommendations_v4_'+uid();let generation=0,snapshot=null,busy=null,failed=false,retryAt=0;
 const title=()=>state.lang==='en'?'Recommended for you':'Рекомендуем послушать';
 const collection={id,title:title(),tag:'Обновляется каждые 6 часов',shortDesc:'Новые треки и артисты в твоём вкусе',trackIds:[],cover:'#197D91',coverImg:null,icon:'<span class="tg-ico">&#xF0BA;</span>'};
 function restore(){generation++;busy=null;failed=false;collection.coverImg=null;try{snapshot=JSON.parse(localStorage.getItem(key())||'null');if(!snapshot){const old=JSON.parse(localStorage.getItem('telefy_freshmen_v2')||'null');if(old)snapshot={period:old.period,tracks:old.tracks||[]};}}catch(_){snapshot=null;}snapshot={period:period(),tracks:[],played:[],cursor:0,plan:null,...snapshot};mergeParsedTracksIntoCatalog(snapshot.tracks||[]);sync();}
 function save(){try{localStorage.setItem(key(),JSON.stringify(snapshot));}catch(_){}}
 const allowed=t=>!window.telefySongBlocked?.(t)&&!window.TelefyPromotionExcluded?.(t)&&(!window.TelefyRapCandidate||window.TelefyRapCandidate(t));
 function plan(){
  const history=window.TelefyTaste?.history||[],weights=new Map(),moods=new Map();
  history.forEach((h,i)=>{weights.set(h.artist,(weights.get(h.artist)||0)+i+1);(h.modes||[]).forEach(m=>moods.set(m,(moods.get(m)||0)+i+1));});
  const favorite=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  const dominant=[...moods].sort((a,b)=>b[1]-a[1])[0]?.[0];
  let sources=RUSSIAN_RAP_ROSTER.filter(c=>!window.TelefyPromotionExcluded?.({artist:c.name})&&!favorite.some(a=>normalizeArtistToken(a)===normalizeArtistToken(c.name)));
  sources.sort((a,b)=>Number(b.mood===dominant)-Number(a.mood===dominant));
  // Stable rotation of similarly classified artists within the six-hour snapshot.
  const rotate=list=>{if(!list.length)return [];const n=period()%list.length;return [...list.slice(n),...list.slice(0,n)];};
  const similar=rotate(sources.filter(c=>c.mood===dominant)),others=rotate(sources.filter(c=>c.mood!==dominant));
  const artists=[];const seen=new Set();for(const a of [...similar.slice(0,4).map(c=>c.query||c.name),...favorite,...similar.slice(4).map(c=>c.query||c.name),...others.map(c=>c.query||c.name)]){const k=normalizeArtistToken(a);if(!seen.has(k)){seen.add(k);artists.push(a);}}
  return {personal:history.length>0,artists,heard:history.map(h=>h.key),history};
 }
 function sync(){
  collection.title=title();const urns=new Set((snapshot?.tracks||[]).map(t=>t.soundcloudUrn));collection.trackIds=tracks.filter(t=>urns.has(t.soundcloudUrn)&&allowed(t)).map(t=>t.id);
  collection.coverImg=snapshot?.coverImg||collection.coverImg;
 }
 function pool(){const heard=new Set(snapshot.plan?.heard||[]),played=new Set(snapshot.played||[]);return collection.trackIds.map(id=>tracks.find(t=>t.id===id)).filter(t=>t&&!t.disliked&&!heard.has(getTrackUniqueKey(t))&&!played.has(getTrackUniqueKey(t)));}
 function paint(){
  sync();const box=document.getElementById('home-tracks-list'),items=collection.trackIds.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);
  const button=document.getElementById('home-uncut-total');if(button){button.innerHTML='<span class="tg-ico" aria-hidden="true">&#xF0BA;</span><span>'+(state.lang==='en'?'More recommendations':'Больше рекомендаций')+'</span>';button.onclick=open;}
  const preview=items.filter(t=>!(snapshot.played||[]).includes(getTrackUniqueKey(t)));
  if(box){if(preview.length){box.innerHTML=preview.slice(0,12).map(createTrackRowHTML).join('');bindTrackRowEvents(box,title());}else{box.innerHTML='';const p=document.createElement('p');p.className='px-4 py-6 text-center text-muted text-sm';p.textContent=busy?'Подбираем музыку…':failed?'Не удалось обновить рекомендации. Попробуй ещё раз.':'Новые рекомендации появятся здесь';box.append(p);if(!busy){const b=document.createElement('button');b.className='w-full py-3 text-[#2AABEE]';b.textContent='Обновить';b.onclick=()=>load(true);box.append(b);}}}
  if(state.activeCollectionId===id){document.getElementById('col-modal-title').textContent=title();document.getElementById('col-modal-tag').textContent=collection.tag;updateCollectionPresentation();const list=document.getElementById('col-modal-tracks');list.innerHTML=items.map(createTrackRowHTML).join('');bindTrackRowEvents(list,title());const b=document.createElement('button');b.type='button';b.className='w-full py-4 text-[#2AABEE] text-sm';b.disabled=Boolean(busy);b.textContent=busy?'Подбираем ещё…':failed?'Повторить загрузку':'Ещё рекомендации';b.onclick=()=>load(true);list.append(b);}
 }
 async function load(force=false){
  if(busy)return busy;
  if(!force&&Date.now()<retryAt)return;
  const token=generation,account=uid();failed=false;
  if(!snapshot.plan)snapshot.plan=plan();
  const pending=(async()=>{
   try{
    const freshPeriod=period()!==snapshot.period,working=freshPeriod?{period:period(),tracks:[],played:snapshot.played||[],cursor:0,plan:plan(),coverImg:snapshot.coverImg}:snapshot;
    const cursor=working.cursor;let candidates=[];
    const request=async(q,offset=0)=>{const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q,offset,limit:50}),{signal:AbortSignal.timeout(90000)});const d=await r.json();if(!r.ok)throw Error(d.error||'recommendations');return d;};
    if(cursor===0&&!working.plan.personal)candidates=(await request('telefy:freshmen')).tracks||[];
    else{
     const artists=working.plan.artists,n=Math.max(1,artists.length),base=Math.max(0,cursor-(working.plan.personal?0:1))*2;
     for(let i=0;i<Math.min(2,n);i++){const pos=base+i,artist=artists[pos%n];if(!artist)continue;const data=await request(artist,Math.floor(pos/n)*50);candidates.push(...(data.tracks||[]));}
    }
    if(token!==generation||account!==uid())return;
    const heard=new Set(working.plan.heard),played=new Set(working.played),existing=new Set(working.tracks.map(getTrackUniqueKey));
    candidates=candidates.filter(t=>allowed(t)&&!heard.has(getTrackUniqueKey(t))&&!played.has(getTrackUniqueKey(t))&&!existing.has(getTrackUniqueKey(t)));
    mergeParsedTracksIntoCatalog(candidates);const incoming=new Set(candidates.map(t=>t.soundcloudUrn));const mixed=interleaveByArtist(tracks.filter(t=>incoming.has(t.soundcloudUrn)));working.tracks.push(...mixed);working.tracks=working.tracks.slice(-300);working.cursor=cursor+1;
    if(freshPeriod&&!working.tracks.length)working.tracks=snapshot.tracks.slice();
    if(!working.coverImg)working.coverImg=mixed.find(t=>t.coverImg)?.coverImg||null;snapshot=working;retryAt=0;save();sync();
   }catch(_){if(token===generation){failed=true;retryAt=Date.now()+300000;}}
  })();busy=pending;paint();try{await pending;}finally{if(token===generation){busy=null;paint();}}
 }
 function open(){collection.title=title();openCollectionModal(id);paint();if(snapshot.tracks.length<24)load();}
 const active=()=>state.sourceLabel===title()||state.sourceLabel==='Рекомендуем послушать'||state.sourceLabel==='Recommended for you';
 async function next(ended=false){
  if(ended&&isRepeat){playTrack(state.currentTrackId,title(),{fromHistory:true});return;}
  let choices=pool();if(!choices.length){await load();if(!active())return;choices=pool();}
  if(choices.length){state.queueIds=choices.slice(1).map(t=>t.id);playTrack(choices[0].id,title());}else{state.isPlaying=false;syncRealAudio();renderPlayerUI();}
 }
 const previousPlay=playTrack;playTrack=function(trackId,label,...args){const result=previousPlay(trackId,label,...args);if(label===title()||active()){const t=tracks.find(t=>t.id===trackId);if(t){snapshot.played=[...new Set([...(snapshot.played||[]),getTrackUniqueKey(t)])].slice(-500);save();state.queueIds=pool().map(t=>t.id);if(state.queueIds.length<4)load();}}return result;};
 window.TelefyRecommendations={collection,load,open,next,active};renderHomeTracks=paint;
 window.addEventListener('telefy:profile-ready',()=>{restore();start();});
 function start(){if(window.TelefyFirstRun?.pending||!window.TelefyTaste||!window.TelefyTaste.restored){setTimeout(start,500);return;}paint();if(!snapshot.tracks.length||snapshot.period!==period())load();}
 restore();I18N.ru.recommendedFreshmen='Рекомендуем послушать';I18N.en.recommendedFreshmen='Recommended listening';applyTranslations();start();
 setInterval(()=>{if(snapshot.period!==period()&&!document.hidden)load();},30000);
})();
