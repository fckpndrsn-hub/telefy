/* Independent discovery presentation. AI text can be supplied by a server provider. */
(() => {
  const card = document.getElementById('flow-discovery');
  const backdrop = document.getElementById('flow-discovery-backdrop');
  const art = document.getElementById('flow-discovery-art');
  const title = document.getElementById('flow-discovery-title');
  const description = document.getElementById('flow-discovery-description');
  const artist = document.getElementById('flow-discovery-artist');
  const source = document.getElementById('flow-description-source');
  const palettes = new Map(), descriptions = new Map();
  let key = '', generation = 0, provider = null, animation = null;
  function setLight(light) { card.classList.toggle('cover-is-light', light); }
  function sampleCover(url, token) {
    setLight(false); // Safe dark scrim while a cover is loading or CORS is unavailable.
    if (!url) return;
    if (palettes.has(url)) { setLight(palettes.get(url)); return; }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently:true });
        ctx.drawImage(image, 0, 0, 16, 16);
        const pixels = ctx.getImageData(0, 0, 16, 16).data;
        let luminance = 0;
        for (let i=0;i<pixels.length;i+=4) luminance += .2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
        const light = luminance / 256 > 155;
        palettes.set(url, light);
        if (token === generation) setLight(light);
      } catch (_) { /* Keep the contrast-safe dark treatment. */ }
    };
    image.src = url;
  }
  async function render() {
    const track = getTrack(state.currentTrackId);
    if (!track) return;
    const nextButton=document.getElementById('flow-discovery-next');
    nextButton.disabled=!track.id;
    if (!track.id) {
      title.textContent=state.isCatalogParsing ? (state.lang==='en'?'Loading music…':'Загружаем музыку…') : (state.lang==='en'?'Catalog unavailable':'Каталог недоступен');
      artist.textContent=''; source.textContent=state.lang==='en'?'Your stream':'Мой поток';
      description.textContent=state.isCatalogParsing ? '' : getCatalogErrorText();
      backdrop.style.backgroundImage=art.style.backgroundImage='none'; art.classList.add('no-cover');
      return;
    }
    const nextKey = JSON.stringify([track.id, track.title, track.artist, track.album, track.coverImg, state.lang, state.activeTab]);
    if (key === nextKey) return;
    const changedTrack = Boolean(key); key = nextKey;
    const token = ++generation, english = state.lang === 'en';
    title.textContent = track.title;
    artist.textContent = track.artist;
    description.textContent = english ? `A short note about “${track.title}” will appear here.` : `Короткая заметка о «${track.title}» скоро появится здесь.`;
    source.textContent = english ? 'In your stream' : 'В твоём потоке';
    document.getElementById('flow-discovery-next-label').textContent = english ? 'Next' : 'Дальше';
    const url = /^https:\/\//.test(track.coverImg || '') ? track.coverImg : '';
    backdrop.style.backgroundImage = art.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : 'none';
    art.classList.toggle('no-cover', !url);
    sampleCover(url, token);
    animation?.cancel();
    if (changedTrack && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation = card.animate([{opacity:.65},{opacity:1}],{duration:220,easing:'ease-out'});
    }
    if (!provider || state.activeTab !== 'flow') return;
    description.textContent = english ? 'Preparing a note about this track…' : 'Готовим заметку об этом треке…';
    try {
      const cacheKey = `${track.id}:${state.lang}`;
      let text = descriptions.get(cacheKey);
      if (!text) {
        text = await provider({ id:track.id, title:track.title, artist:track.artist, album:track.album, language:state.lang });
        if (typeof text !== 'string' || !text.trim()) return;
        text = text.trim().slice(0, 260); descriptions.set(cacheKey,text);
      }
      if (token !== generation) return;
      description.textContent = text;
      source.textContent = 'Telefy AI';
    } catch (_) {
      if (token === generation) description.textContent = english ? `A short note about “${track.title}” will appear here.` : `Короткая заметка о «${track.title}» скоро появится здесь.`;
    }
  }
  window.TelefyFlowDescriptions = {
    setProvider(fn) { provider = typeof fn === 'function' ? fn : null; descriptions.clear(); key=''; render(); }
  };
  const originalRender = renderPlayerUI;
  renderPlayerUI = function() { originalRender(); render(); };
  const originalSwitchTab = switchTab;
  switchTab = function(tab) { originalSwitchTab(tab); if (tab === 'flow') render(); };
  async function connectAI() {
    try {
      const status = await fetch('/api/ai/status', { cache:'no-store' }).then(r => r.json());
      if (!status.configured) return;
      window.TelefyFlowDescriptions.setProvider(async track => {
        const response = await fetch('/api/ai/description', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...track,lang:state.lang}), signal:AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error('Description unavailable');
        return (await response.json()).description;
      });
    } catch (_) { /* Standalone HTML still works without the optional AI server. */ }
  }
  const next = () => { triggerHaptic('light'); playNext(); };
  document.getElementById('flow-discovery-next').addEventListener('click', next);
  let start = null;
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    start = { x:e.clientX, y:e.clientY, id:e.pointerId };
  });
  card.addEventListener('pointerup', e => {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX-start.x, dy = e.clientY-start.y; start=null;
    if (dx < -45 && Math.abs(dx) > Math.abs(dy)*1.5) next();
  });
  card.addEventListener('pointercancel', () => { start=null; });
  render();
  connectAI();
})();
