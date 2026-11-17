/* Personal data lives on the authenticated server; catalog cache is not a library. */
(() => {
 let uid=null,ready=false,revision=0,epoch=0,pending=0,tail=Promise.resolve(),committed=null,desired='',loading=false;
 let migrationTimer=null,migrationAttempts=0,migrationWarning=false;
 const account=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const snapshot=t=>({key:getTrackUniqueKey(t),title:t.title||'',artist:t.artist||t.primaryArtist||'',primaryArtist:t.primaryArtist||'',album:t.album||'',soundcloudUrn:t.soundcloudUrn||'',coverImg:t.coverImg?.startsWith('https://')?t.coverImg:'',duration:Number(t.duration)||0});
 const empty=()=>({likes:[],playlists:[]});
 function pack(){const byId=new Map(tracks.map(t=>[t.id,t])),byKey=new Map(tracks.map(t=>[getTrackUniqueKey(t),t]));return {likes:[...userLikedTrackKeys].map(key=>byKey.get(key)).filter(Boolean).map(snapshot),playlists:USER_PLAYLISTS.map(p=>({id:p.id,title:p.title,subtitle:p.subtitle||'',cover:p.cover||'#2AABEE',coverImg:p.coverImg||'',personal:p.personal===true,tracks:(p.trackIds||[]).map(id=>byId.get(id)).filter(Boolean).map(snapshot)}))};}
 function paint(){renderMaxBetaView();renderPlayerUI();if(state.activeTab==='search')renderSearchView();if(!document.getElementById('library-modal')?.classList.contains('hidden'))renderLibraryModalTracks();}
 function apply(data){
  const byKey=new Map(tracks.map(t=>[getTrackUniqueKey(t),t]));let next=Math.max(0,...tracks.map(t=>Number(t.id)||0))+1;
  function materialize(row){let tr=byKey.get(row.key);if(!tr){tr={...row,id:next++,liked:false,disliked:false,cover:'#2AABEE',mood:'all',modes:[],uncensored:true,coverStatus:'loaded'};tracks.push(tr);byKey.set(row.key,tr);}if(!tr.soundcloudUrn&&row.soundcloudUrn)tr.soundcloudUrn=row.soundcloudUrn;if(!tr.duration&&row.duration)tr.duration=row.duration;if(!tr.coverImg&&row.coverImg)tr.coverImg=row.coverImg;return tr.id;}
  userLikedTrackKeys.clear();data.likes.forEach(t=>{materialize(t);userLikedTrackKeys.add(t.key);});
  tracks.forEach(t=>{t.liked=userLikedTrackKeys.has(getTrackUniqueKey(t));});
  USER_PLAYLISTS.splice(0,USER_PLAYLISTS.length,...data.playlists.map(p=>({...p,trackKeys:p.tracks.map(t=>t.key),trackIds:p.tracks.map(materialize)})));
  desired=JSON.stringify(pack());paint();
 }
 async function request(data,path='/api/me/library'){const r=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok){const error=new Error('library_'+r.status);error.status=r.status;throw error;}return r.json();}
 function message(error){showToast(error?.status===409?'Библиотека изменилась на другом устройстве. Повтори действие.':error?.status===403?'Для изменения плейлистов нужен Telefy Max.':'Не удалось сохранить в профиль. Проверь подключение и повтори.');}
 async function restore(force=false){
  const current=account();if(!current||loading||pending)return;
  if(uid!==current){uid=current;ready=false;epoch++;committed=null;apply(empty());}
  claimLegacy(current);
  if(ready&&!force)return;
  loading=true;const generation=epoch;
  try{
   const data=await request();if(generation!==epoch||current!==account()||pending||(ready&&data.revision<revision))return;
   revision=data.revision;committed=data.library;ready=false;apply(committed);
   await migrateLegacy(generation,current);
   if(generation!==epoch||current!==account())return;
   ready=true;apply(committed);window.dispatchEvent(new Event('telefy:library-ready'));
  }
  catch(_){if(!ready)showToast('Библиотека пока недоступна. Открой профиль повторно после подключения.');}
  finally{loading=false;if(current!==account())queueMicrotask(()=>restore());}
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
   const resolve=k=>byKey.get(k)||(()=>{const [artist,title]=k.split('::');return artist&&title?{artist,title}:null;})();
   const unique=list=>[...new Map(list.filter(Boolean).map(t=>{const row=snapshot(t);return [row.key,row];})).values()];
   const likes=unique([...liked].map(resolve));
   const list=playlists.filter(p=>!['upl_night','upl_bass','upl_chill','upl_uncut'].includes(p.id)).map(p=>({...p,coverImg:p.coverImg||'',tracks:unique(p.trackKeys?p.trackKeys.map(resolve):(p.trackIds||[]).map(id=>catalog.find(t=>t.id===id)))}));
   let personal=false;const filtered=list.filter(p=>{if(!p.personal)return true;if(personal)return false;personal=true;return true;});
   return {likes,playlists:filtered};
  }catch(_){return null;}
 }
 function claimLegacy(current){
  const captured=window.TelefyLegacyLibrary;
  if(!captured)return null;
  const value=legacy();if(!value||(!value.likes.length&&!value.playlists.length))return null;
  // Bind previously unowned browser data once, to the first verified account.
  // A later account on this device must not inherit a failed pending import.
  try{
   const stored=JSON.parse(localStorage.getItem('telefy_legacy_library_pending_v1')||'null');
   const claim=JSON.parse(localStorage.getItem('telefy_legacy_library_owner_v1')||'null');
   if(claim?.owner&&String(claim.owner)!==current)return null;
   if(claim?.done){window.TelefyLegacyLibrary=null;return null;}
   if(stored?.owner&&String(stored.owner)!==current)return null;
   if(captured.owner&&String(captured.owner)!==current)return null;
   captured.owner=current;captured.importId=claim?.importId||stored?.importId||captured.importId||globalThis.crypto?.randomUUID?.()||('legacy_'+Date.now()+'_'+Math.random().toString(36).slice(2));
   localStorage.setItem('telefy_legacy_library_owner_v1',JSON.stringify({owner:current,importId:captured.importId,done:false}));
   localStorage.setItem('telefy_legacy_library_pending_v1',JSON.stringify(captured));
  }catch(_){return null;}
  return {captured,value};
 }
 async function migrateLegacy(generation,current){
  const migration=claimLegacy(current);if(!migration)return;
  const {captured,value}=migration;
  clearTimeout(migrationTimer);
  try{
   const data=await request({import_id:captured.importId,library:value},'/api/me/library/import');
   if(generation!==epoch||current!==account())return;
   revision=data.revision;committed=data.library;migrationAttempts=0;
   const stored=JSON.parse(localStorage.getItem('telefy_legacy_library_pending_v1')||'null');
   if(stored?.importId===captured.importId&&String(stored.owner)===current){
    localStorage.setItem('telefy_legacy_library_owner_v1',JSON.stringify({owner:current,importId:captured.importId,done:true}));
    localStorage.removeItem('telefy_user_liked_keys_v8');localStorage.removeItem('telefy_user_playlists_v6');localStorage.removeItem('telefy_legacy_library_pending_v1');
   }
   window.TelefyLegacyLibrary=null;saveParsedCatalogCache();
  }catch(error){
   if(generation!==epoch||current!==account())return;
   if(!migrationWarning){migrationWarning=true;showToast('Синхронизация старой библиотеки задерживается. Данные сохранены.');}
   if((!error.status||error.status>=500||error.status===429)&&++migrationAttempts<=4){
    const retry=()=>{if(current!==account())return;if(loading||pending){migrationTimer=setTimeout(retry,1000);return;}restore(true);};
    migrationTimer=setTimeout(retry,[2000,8000,30000,60000][migrationAttempts-1]);
   }
  }
 }
 window.TelefyLibrary={save,get ready(){return ready&&uid===account();},restore};
 window.addEventListener('telefy:profile-ready',()=>{
  if(uid!==account()){uid=account();epoch++;ready=false;committed=null;apply(empty());clearTimeout(migrationTimer);migrationAttempts=0;migrationWarning=false;}
  restore();
 });
 window.addEventListener('telefy:track-resolved',()=>{if(ready)saveUserLikedKeys();});
 window.addEventListener('focus',()=>restore(true));
 window.addEventListener('online',()=>restore(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)restore(true);});
 if(window.TelefyProfile?.user)restore();
})();
