/* Personal data lives on the authenticated server; catalog cache is not a library. */
(() => {
 let uid=null,ready=false,revision=0,epoch=0,pending=0,tail=Promise.resolve(),committed=null,desired='',loading=false;
 const clone=x=>JSON.parse(JSON.stringify(x));
 const account=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const snapshot=t=>({key:getTrackUniqueKey(t),title:t.title||'',artist:t.artist||t.primaryArtist||'',primaryArtist:t.primaryArtist||'',album:t.album||'',soundcloudUrn:t.soundcloudUrn||'',coverImg:t.coverImg?.startsWith('https://')?t.coverImg:'',duration:Number(t.duration)||0});
 const empty=()=>({likes:[],playlists:[]});
 function pack(){const byId=new Map(tracks.map(t=>[t.id,t])),byKey=new Map(tracks.map(t=>[getTrackUniqueKey(t),t]));return {likes:[...userLikedTrackKeys].map(key=>byKey.get(key)).filter(Boolean).map(snapshot),playlists:USER_PLAYLISTS.map(p=>({id:p.id,title:p.title,subtitle:p.subtitle||'',cover:p.cover||'#2AABEE',coverImg:p.coverImg||'',personal:p.personal===true,tracks:(p.trackIds||[]).map(id=>byId.get(id)).filter(Boolean).map(snapshot)}))};}
 function paint(){renderMaxBetaView();renderPlayerUI();if(state.activeTab==='search')renderSearchView();if(!document.getElementById('library-modal')?.classList.contains('hidden'))renderLibraryModalTracks();}
 function apply(data){
  const byKey=new Map(tracks.map(t=>[getTrackUniqueKey(t),t]));let next=Math.max(0,...tracks.map(t=>Number(t.id)||0))+1;
  function materialize(row){let tr=byKey.get(row.key);if(!tr){tr={...row,id:next++,liked:false,disliked:false,cover:'#2AABEE',mood:'all',modes:[],uncensored:true,coverStatus:'loaded'};tracks.push(tr);byKey.set(row.key,tr);}return tr.id;}
  userLikedTrackKeys.clear();data.likes.forEach(t=>{materialize(t);userLikedTrackKeys.add(t.key);});
  tracks.forEach(t=>{t.liked=userLikedTrackKeys.has(getTrackUniqueKey(t));});
  USER_PLAYLISTS.splice(0,USER_PLAYLISTS.length,...data.playlists.map(p=>({...p,trackKeys:p.tracks.map(t=>t.key),trackIds:p.tracks.map(materialize)})));
  desired=JSON.stringify(pack());paint();
 }
 async function request(data){const r=await fetch('/api/me/library',{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok){const error=new Error('library_'+r.status);error.status=r.status;throw error;}return r.json();}
 function message(error){showToast(error?.status===409?'Библиотека изменилась на другом устройстве. Повтори действие.':error?.status===403?'Для изменения плейлистов нужен Telefy Max.':'Не удалось сохранить в профиль. Проверь подключение и повтори.');}
 async function restore(force=false){
  const current=account();if(!current||loading||pending)return;
  if(uid!==current){uid=current;ready=false;epoch++;committed=null;apply(empty());}
  if(ready&&!force)return;
  loading=true;const generation=epoch;
  try{const data=await request();if(generation!==epoch||current!==account()||pending||(ready&&data.revision<revision))return;revision=data.revision;committed=data.library;ready=true;apply(committed);window.dispatchEvent(new Event('telefy:library-ready'));offerMigration();}
  catch(_){if(!ready)showToast('Библиотека пока недоступна. Открой профиль повторно после подключения.');}
  finally{loading=false;}
 }
 function save(){
  if(!ready||uid!==account()){if(committed)apply(committed);message();return Promise.resolve(false);}
  const value=pack(),encoded=JSON.stringify(value);if(encoded===desired)return tail.then(result=>result!==false);
  desired=encoded;const generation=epoch,current=uid;pending++;
  const task=tail.then(async()=>{
   if(epoch!==generation||account()!==current)return false;
   try{const data=await request({revision,library:value});if(epoch!==generation||account()!==current)return false;revision=data.revision;committed=data.library;return true;}
   catch(error){if(epoch===generation&&account()===current){epoch++;ready=false;apply(committed||empty());message(error);}return false;}
  }).finally(()=>{pending--;if(!pending){if(ready&&committed)apply(committed);else restore(true);}});
  tail=task.catch(()=>false);return task;
 }
 function legacy(){
  try{
   const captured=window.TelefyLegacyLibrary||{};
   const keys=JSON.parse(captured.keys||'[]');
   const catalog=JSON.parse(captured.catalog||'[]');
   const playlists=JSON.parse(captured.playlists||'[]');
   if(!Array.isArray(keys)||!Array.isArray(catalog)||!Array.isArray(playlists))return null;
   const liked=new Set(keys);catalog.forEach(t=>{if(t.liked)liked.add(getTrackUniqueKey(t));});
   const byKey=new Map(catalog.map(t=>[getTrackUniqueKey(t),t]));
   const likes=[...liked].map(k=>byKey.get(k)||(()=>{const [artist,title]=k.split('::');return artist&&title?{artist,title}:null;})()).filter(Boolean).map(snapshot);
   const list=playlists.filter(p=>!['upl_night','upl_bass','upl_chill','upl_uncut'].includes(p.id)&&!p.personal).map(p=>({...p,tracks:(p.trackKeys?p.trackKeys.map(k=>byKey.get(k)):(p.trackIds||[]).map(id=>catalog.find(t=>t.id===id))).filter(Boolean).map(snapshot)}));
   return {likes,playlists:list};
  }catch(_){return null;}
 }
 let migrationOffered=false;
 function offerMigration(){
  if(migrationOffered)return;const data=legacy();if(!data||(!data.likes.length&&!data.playlists.length))return;migrationOffered=true;
  // Legacy browser data has no owner: obtain an explicit account choice once.
  const button=document.createElement('button');button.type='button';button.className='library-import';button.textContent='Перенести музыку из этого браузера в профиль';
  document.getElementById('view-mytelefy')?.prepend(button);
  button.onclick=async()=>{
   if(!ready||pending)return;
   const name=window.TelefyProfile.user.username?'@'+window.TelefyProfile.user.username:window.TelefyProfile.user.first_name;
   if(!confirm(`Сохранить ${data.likes.length} любимых треков и ${data.playlists.length} плейлистов в профиль ${name}?`))return;
   if(data.playlists.length&&!state.isMaxSubscribed){showToast('Для переноса плейлистов нужен Telefy Max. Данные браузера сохранены.');return;}
   const target=clone(committed),known=new Set(target.likes.map(t=>t.key));data.likes.forEach(t=>{if(!known.has(t.key)){target.likes.push(t);known.add(t.key);}});
   const ids=new Set(target.playlists.map(p=>p.id));data.playlists.forEach(p=>{if(!ids.has(p.id)){target.playlists.push(p);ids.add(p.id);}});
   apply(target);desired=JSON.stringify(committed);button.disabled=true;
   if(await save()){localStorage.removeItem('telefy_user_liked_keys_v8');localStorage.removeItem('telefy_user_playlists_v6');localStorage.removeItem('telefy_legacy_library_pending_v1');window.TelefyLegacyLibrary=null;saveParsedCatalogCache();button.remove();showToast('Музыка сохранена в профиле.');}else button.disabled=false;
  };
 }
 window.TelefyLibrary={save,get ready(){return ready&&uid===account();},restore};
 window.addEventListener('telefy:profile-ready',()=>{
  if(uid!==account()){uid=account();epoch++;ready=false;committed=null;apply(empty());document.querySelector('.library-import')?.remove();migrationOffered=false;}
  restore();
 });
 window.addEventListener('focus',()=>restore(true));
 window.addEventListener('online',()=>restore(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)restore(true);});
 if(window.TelefyProfile?.user)restore();
})();
