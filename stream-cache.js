/* Account-scoped, bounded cache of HLS audio fragments, not authentication or signed URLs. */
(()=>{
 const MAX=128,MAX_BYTES=512*1024,TTL=86400000;let opened;
 const db=()=>opened??=(new Promise(resolve=>{if(!window.indexedDB){resolve(null);return;}try{const r=indexedDB.open('telefy-audio-fragments-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('fragments',{keyPath:'key'}).createIndex('used','used');r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=r.onblocked=()=>resolve(null);}catch(_){resolve(null);}}));
 async function read(key){const d=await db();if(!d)return null;return new Promise(resolve=>{try{const r=d.transaction('fragments').objectStore('fragments').get(key);r.onsuccess=()=>resolve(r.result&&Date.now()-r.result.used<TTL?r.result.data:null);r.onerror=()=>resolve(null);}catch(_){resolve(null);}});}
 async function write(key,data){if(!(data instanceof ArrayBuffer)||!data.byteLength||data.byteLength>MAX_BYTES)return;const d=await db();if(!d)return;try{const t=d.transaction('fragments','readwrite'),s=t.objectStore('fragments');s.put({key,data,used:Date.now()});const count=s.count();count.onsuccess=()=>{let remove=count.result-MAX;if(remove<=0)return;const c=s.index('used').openCursor();c.onsuccess=()=>{const row=c.result;if(row&&remove-->0){row.delete();row.continue();}};};t.onerror=()=>{};}catch(_){} }
 function loader(Hls,urn){const Base=Hls?.DefaultConfig?.loader,owner=window.TelefyProfile?.user?.telegram_id;if(!Base||!owner||!/^soundcloud:tracks:\d+$/.test(urn||''))return undefined;
  return class CachedFragmentLoader extends Base{
   load(context,config,callbacks){this.context=context;this.cancelled=false;const u=new URL(context.url,location.href);for(const k of ['Policy','Signature','Key-Pair-Id','Expires','oauth_token','token','client_id'])u.searchParams.delete(k);const key=JSON.stringify([String(owner),urn,u.origin+u.pathname+u.search,context.rangeStart,context.rangeEnd]);
    const begin=performance.now();
    Promise.race([read(key),new Promise(r=>setTimeout(()=>r(null),60))]).then(data=>{
     if(this.cancelled)return;
     if(data){const stats=this.stats;Object.assign(stats,{loaded:data.byteLength,total:data.byteLength});Object.assign(stats.loading,{start:begin,first:performance.now(),end:performance.now()});callbacks.onSuccess({url:context.url,data},stats,context,null);return;}
     super.load(context,config,{...callbacks,onSuccess:(response,...args)=>{if(!this.cancelled)write(key,response.data);callbacks.onSuccess(response,...args);}});
    }).catch(()=>{if(!this.cancelled)super.load(context,config,callbacks);});
   }
   abort(){this.cancelled=true;super.abort();}
   destroy(){this.cancelled=true;super.destroy();}
  };
 }
 window.TelefyAudioCache={loader,limits:{maxBytes:MAX*MAX_BYTES,ttl:TTL},read,write};
})();
