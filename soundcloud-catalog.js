/* SoundCloud search/catalog integration, separate from Deezer metadata helpers. */
(() => {
  const seeds = ['PHARAOH','9mice','Kai Angel','madk1d','fortune 812','темный принц','ЛСП','Big Baby Tape'];
  const pages = new Map();
  let refillBusy = false, seedIndex = 0, queryRevision = 0;
  async function request(query, offset=0, limit=25) {
    const response = await fetch(`/api/soundcloud/search?${new URLSearchParams({q:query,offset,limit})}`, {
      signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(22000):undefined
    });
    const data = await response.json();
    if (!response.ok) {
      const error=new Error(data.error || 'soundcloud_unavailable'); error.code=data.error; throw error;
    }
    return data;
  }
  function importTracks(items, mood=null) {
    return mergeParsedTracksIntoCatalog(items.map(item => {
      const cfg = findRosterConfig(item.artist);
      return { ...item, mood:mood || cfg?.mood || 'all', coverStatus:'loaded' };
    }));
  }
  async function search(query, more=false) {
    query=query.trim(); if (query.length<2) return;
    if (more && searchPagination.loading) return;
    const revision=++queryRevision;
    const offset=more && searchPagination.query===query ? searchPagination.nextIndex : 0;
    searchPagination.query=query; searchPagination.loading=true;
    if (!more) { searchPagination.nextIndex=0; searchPagination.hasMore=true; }
    state.isSearchParsing=true; renderSearchView();
    try {
      const data=await request(query,offset);
      if (revision!==queryRevision) return;
      importTracks(data.tracks);
      state.catalogError=null;
      searchPagination.nextIndex=data.nextOffset; searchPagination.hasMore=data.hasMore;
      if (more) searchDisplayLimit+=data.tracks.length;
    } catch (error) {
      if (revision===queryRevision) {
        state.catalogError=error.code || 'network';
        showToast(getCatalogErrorText());
      }
    } finally {
      if (revision===queryRevision) {
        searchPagination.loading=false; state.isSearchParsing=false;
        if (state.activeTab==='search') renderSearchView();
      }
    }
  }
  async function refill(autoPlay=false) {
    if (refillBusy) return;
    refillBusy=true;
    const mood=state.activeMood || 'all';
    try {
      const cfgs=RUSSIAN_RAP_ROSTER.filter(cfg=>mood==='all' || mood==='uncensored' || cfg.mood===mood);
      const seed=cfgs.length ? cfgs[seedIndex++ % cfgs.length].query : seeds[seedIndex++ % seeds.length];
      const offset=pages.get(seed)||0;
      const data=await request(seed,offset,20);
      pages.set(seed,data.hasMore?data.nextOffset:0);
      importTracks(data.tracks,mood==='uncensored'?'all':mood);
      if (state.activeMood!==mood) return;
      const queued=new Set(state.queueIds || []);
      const additions=tracks.filter(track=>track.soundcloudUrn && isFlowTrackUnplayed(track) && !queued.has(track.id) && doesTrackMatchMood(track,mood)).slice(0,15);
      state.queueIds.push(...additions.map(track=>track.id));
      if (autoPlay && state.queueIds.length) playTrack(state.queueIds.shift(),state.sourceLabel);
      else renderAll();
    } catch (_) { /* Existing queue remains playable when discovery is unavailable. */ }
    finally { refillBusy=false; }
  }
  async function initialize() {
    state.catalogError=null;
    try {
      const status=await fetch('/api/soundcloud/status',{cache:'no-store'}).then(r=>r.json());
      if (!status.configured) { await hydrateAllTrackCovers(); return; }
      window.TelefySoundCloud.ready=true;
      state.isCatalogParsing=true; renderAll();
      let received=0;
      for (let i=0;i<seeds.length;i+=3) {
        const batch=await Promise.allSettled(seeds.slice(i,i+3).map(seed=>request(seed,0,10)));
        let failure=null;
        for (const result of batch) {
          if (result.status==='fulfilled') { importTracks(result.value.tracks); received+=result.value.tracks.length; }
          else failure=result.reason;
        }
        state.isCatalogParsing=false; renderAll();
        if (!received && failure) throw failure;
      }
    } catch (error) {
      state.catalogError=error.code || 'network';
    } finally {
      state.isCatalogParsing=false; renderAll();
    }
  }
  window.TelefySoundCloud={ready:false,initialize,search,refill};
})();
