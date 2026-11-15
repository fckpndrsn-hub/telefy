/* TEMPORARY: remove this script's HTML tag to disconnect Deezer preview audio. */
(() => {
  const audio = document.getElementById('telefy-audio');
  const original = { sync: syncRealAudio, timer: startTimer, progress: updateProgressUI, render: renderPlayerUI };
  const events = new AbortController();
  let enabled = true, request = 0, activeId = null;
  let progressFrame = null;
  let scrubbing = false, scrubTarget = null, scrubPointer = null;
  const seekSlider = document.getElementById('full-seek-slider');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function syncProgress() {
    if (enabled && activeId === state.currentTrackId && !scrubbing && !audio.seeking) {
      state.progressSec = audio.currentTime;
      updateProgressUI();
    }
  }
  function stopProgressFrames() {
    if (progressFrame !== null) cancelAnimationFrame(progressFrame);
    progressFrame = null;
  }
  function startProgressFrames() {
    stopProgressFrames();
    if (!enabled || audio.paused || audio.ended || document.hidden || reducedMotion.matches) return;
    const frame = () => {
      progressFrame = null;
      if (!enabled || audio.paused || audio.ended || document.hidden) return;
      syncProgress();
      progressFrame = requestAnimationFrame(frame);
    };
    progressFrame = requestAnimationFrame(frame);
  }
  const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30;
  function fail(message) { state.isPlaying = false; audio.pause(); renderAll(); showToast(message); }
  updateProgressUI = function() {
    const track = getTrack(state.currentTrackId);
    if (enabled && activeId === track.id) {
      const saved = track.duration; track.duration = duration();
      try { original.progress(); } finally { track.duration = saved; }
    } else original.progress();
  };
  renderPlayerUI = function() {
    original.render();
    if (enabled && activeId === state.currentTrackId) document.getElementById('mini-artist').textContent += state.lang === 'en' ? ' · Preview' : ' · Превью';
  };
  startTimer = function() { if (playbackTimer) clearInterval(playbackTimer); };
  syncRealAudio = async function(reset = false) {
    const currentRequest = ++request;
    if (!enabled) return original.sync(reset);
    if (!state.isPlaying) { audio.pause(); return; }
    const track = getTrack(state.currentTrackId);
    if (!track?.id) { fail('Дождись загрузки каталога'); return; }
    try {
      if (reset || activeId !== track.id || !audio.getAttribute('src')) {
        scrubbing = false; scrubTarget = null; scrubPointer = null;
        audio.pause(); audio.removeAttribute('src'); audio.load(); activeId = null;
        let url = track.previewUrl;
        if (!url && track.deezerTrackId) {
          const data = await fetchJsonpOnly(`https://api.deezer.com/track/${encodeURIComponent(track.deezerTrackId)}?output=jsonp`, 6000);
          url = data?.preview; if (url) track.previewUrl = url;
        }
        if (currentRequest !== request || !state.isPlaying) return;
        if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Для этого трека Deezer не выдал превью');
        activeId = track.id; audio.src = url; audio.currentTime = 0;
        showToast(state.lang === 'en' ? 'Test playback · Deezer preview' : 'Тестовое воспроизведение · превью Deezer');
      }
      if (currentRequest !== request) return;
      await audio.play(); if (currentRequest === request) renderPlayerUI();
    } catch (error) {
      if (currentRequest !== request || error.name === 'AbortError') return;
      fail(error.name === 'NotAllowedError' ? 'Нажми ▶ ещё раз для запуска звука' : (error.message || 'Не удалось загрузить превью'));
    }
  };
  const on = (name, handler) => audio.addEventListener(name, handler, { signal: events.signal });
  on('timeupdate', syncProgress);
  on('seeked', syncProgress);
  on('pause', () => { stopProgressFrames(); syncProgress(); });
  on('ended', stopProgressFrames);
  on('error', stopProgressFrames);
  on('playing', startProgressFrames);
  document.addEventListener('visibilitychange', () => {
    syncProgress(); startProgressFrames();
  }, { signal:events.signal });
  reducedMotion.addEventListener('change', startProgressFrames, { signal:events.signal });
  on('loadedmetadata', updateProgressUI);
  on('playing', () => { if (activeId === state.currentTrackId) { state.isPlaying = true; renderPlayerUI(); } });
  on('ended', () => { if (!scrubbing && activeId === state.currentTrackId) playNext(true); });
  on('error', () => { if (audio.getAttribute('src') && activeId === state.currentTrackId) fail('Не удалось загрузить превью Deezer'); });
  seekSlider.addEventListener('pointerdown', event => {
    if (!enabled || activeId !== state.currentTrackId || !event.isPrimary || event.button !== 0) return;
    scrubbing = true; scrubTarget = null; scrubPointer = event.pointerId;
  }, { signal:events.signal });
  seekSlider.addEventListener('input', event => {
    if (!enabled || activeId !== state.currentTrackId) return;
    event.stopImmediatePropagation();
    scrubbing = true;
    scrubTarget = Number(event.target.value) / 100 * duration();
    // Preview the finger's exact position without repeatedly seeking the audio.
    state.progressSec = scrubTarget; updateProgressUI();
  }, { capture: true, signal: events.signal });
  function commitScrub() {
    if (!scrubbing) return;
    const target = scrubTarget;
    scrubbing = false; scrubTarget = null; scrubPointer = null;
    if (target !== null && enabled && activeId === state.currentTrackId) {
      audio.currentTime = target;
      state.progressSec = target; updateProgressUI();
      if (audio.paused && state.isPlaying) audio.play().catch(() => fail('Нажми ▶ для продолжения'));
    } else syncProgress();
    startProgressFrames();
  }
  function cancelScrub() {
    scrubbing = false; scrubTarget = null; scrubPointer = null;
    syncProgress(); startProgressFrames();
  }
  seekSlider.addEventListener('change', commitScrub, { signal:events.signal });
  window.addEventListener('pointerup', event => {
    if (event.pointerId === scrubPointer) queueMicrotask(commitScrub);
  }, { signal:events.signal });
  window.addEventListener('pointercancel', event => {
    if (event.pointerId === scrubPointer) cancelScrub();
  }, { signal:events.signal });
  seekSlider.addEventListener('blur', commitScrub, { signal:events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelScrub(); }, { signal:events.signal });
  window.TelefyDeezerPreview = { disable() {
    enabled = false; scrubbing = false; scrubTarget = null; scrubPointer = null;
    request++; stopProgressFrames(); audio.pause(); audio.removeAttribute('src'); audio.load(); events.abort();
    state.isPlaying = false; syncRealAudio = original.sync; startTimer = original.timer;
    updateProgressUI = original.progress; renderPlayerUI = original.render; renderAll();
  }};
})();
