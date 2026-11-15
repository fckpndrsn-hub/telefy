/* SoundCloud audio adapter. Credentials are handled by the local server. */
(() => {
  const audio = document.getElementById('telefy-audio');
  const original = { sync: syncRealAudio, timer: startTimer, progress: updateProgressUI, render: renderPlayerUI };
  const events = new AbortController();
  let enabled = true, request = 0, activeId = null;
  let progressFrame = null;
  let hls = null, streamController = null;
  let sourceReady = false;
  function prepareSource(url, signal, requestId) {
    return new Promise((resolve,reject) => {
      let settled=false, timer=null, engine=null;
      const cleanup=()=>{
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata',ready);
        audio.removeEventListener('error',mediaError);
        signal.removeEventListener('abort',abort);
      };
      const finish=error=>{
        if(settled)return; settled=true;cleanup();
        if(error)reject(error);else{sourceReady=true;resolve();}
      };
      const ready=()=>finish();
      const mediaError=()=>finish(new Error('Браузер не смог открыть аудиопоток'));
      const abort=()=>{const error=new Error('Cancelled');error.name='AbortError';finish(error);};
      audio.addEventListener('loadedmetadata',ready);
      audio.addEventListener('error',mediaError);
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(new Error('Поток не загрузился за 30 секунд. Проверь доступ к аудио')),30000);
      if(signal.aborted){abort();return;}
      // Prefer the explicit MSE adapter over a browser's unreliable HLS "maybe".
      if(window.Hls?.isSupported()) {
        engine=new Hls({enableWorker:true,lowLatencyMode:false,maxBufferLength:30,backBufferLength:30});
        hls=engine;
        let recovered=false;
        engine.on(Hls.Events.ERROR,(_,error)=>{
          if(requestId!==request || !error.fatal)return;
          if(error.type===Hls.ErrorTypes.MEDIA_ERROR && !recovered){recovered=true;engine.recoverMediaError();return;}
          const status=error.response?.code;
          const message=`Не удалось загрузить поток (${error.details || 'HLS'}${status ? ', HTTP '+status : ''})`;
          if(!settled)finish(new Error(message));
          else {activeId=null;sourceReady=false;fail(message);}
          engine.destroy();if(hls===engine)hls=null;
        });
        engine.on(Hls.Events.MEDIA_ATTACHED,()=>{
          if(requestId===request && !signal.aborted)engine.loadSource(url);
        });
        engine.attachMedia(audio);
      } else if(audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src=url; audio.load();
      } else finish(new Error('Этот браузер не поддерживает воспроизведение HLS'));
    });
  }
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
  const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (getTrack(state.currentTrackId)?.duration || 180);
  function fail(message) { state.isPlaying = false; audio.pause(); renderAll(); showToast(message); }
  updateProgressUI = function() {
    const track = getTrack(state.currentTrackId);
    if (enabled && activeId === track.id) {
      const saved = track.duration; track.duration = duration();
      try { original.progress(); } finally { track.duration = saved; }
    } else original.progress();
  };
  startTimer = function() { if (playbackTimer) clearInterval(playbackTimer); };
  syncRealAudio = async function(reset = false) {
    const currentRequest = ++request;
    if (!enabled) return original.sync(reset);
    if (!state.isPlaying) { audio.pause(); return; }
    const track = getTrack(state.currentTrackId);
    if (!track?.id) { fail('Дождись загрузки каталога'); return; }
    try {
      if (reset || activeId !== track.id || !audio.getAttribute('src') || !sourceReady) {
        sourceReady=false;
        scrubbing = false; scrubTarget = null; scrubPointer = null;
        audio.pause();
        if (hls) { hls.destroy(); hls=null; }
        audio.removeAttribute('src'); audio.load(); activeId = null;
        streamController?.abort();
        streamController = new AbortController();
        const response = await fetch('/api/soundcloud/stream', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({soundcloudUrn:track.soundcloudUrn,title:track.title,artist:track.artist,duration:track.duration}),
          signal:streamController.signal
        });
        const data = await response.json();
        if (currentRequest !== request || !state.isPlaying) return;
        if (!response.ok) {
          const messages = {
            soundcloud_not_configured:'Подключи ключи через страницу настройки SoundCloud',
            matching_track_not_found:'Подходящая запись не найдена. Попробуй найти её через поиск',
            soundcloud_auth_failed:'Не удалось подтвердить доступ к музыкальному сервису',
            track_not_playable:'Эта запись недоступна для воспроизведения',
            full_stream_unavailable:'Для этой записи недоступен полный поток',
            soundcloud_rate_limited:'Сервис временно ограничил запросы. Попробуй позже'
            ,soundcloud_forbidden:'Музыка недоступна из текущей сети'
            ,soundcloud_geo_blocked:'Музыка недоступна из текущей сети'
          };
          throw new Error(messages[data.error] || 'Не удалось подключить поток. Попробуй ещё раз');
        }
        if (typeof data.url !== 'string' || !data.url.startsWith('https://')) throw new Error('Некорректный адрес потока');
        track.soundcloudUrn=data.track.soundcloudUrn;
        track.soundcloudUrl=data.track.soundcloudUrl;
        track.uploader=data.track.uploader; track.uploaderUrl=data.track.uploaderUrl;
        activeId=track.id;
        await prepareSource(data.url,streamController.signal,currentRequest);

      }
      if (currentRequest !== request) return;
      await audio.play(); if (currentRequest === request) renderPlayerUI();
    } catch (error) {
      if (currentRequest !== request || error.name === 'AbortError') return;
      if(!sourceReady){activeId=null;if(hls){hls.destroy();hls=null;}}
      fail(error.name === 'NotAllowedError' ? 'Нажми ▶ ещё раз для запуска звука' : (error.message || 'Не удалось загрузить аудио'));
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
  on('error', () => { if (sourceReady && audio.getAttribute('src') && activeId === state.currentTrackId) { fail('Не удалось загрузить аудио'); activeId=null;sourceReady=false; } });
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
  window.TelefyAudio = { disable() {
    enabled = false; scrubbing = false; scrubTarget = null; scrubPointer = null;
    request++; streamController?.abort(); if (hls) { hls.destroy(); hls=null; } stopProgressFrames(); audio.pause(); audio.removeAttribute('src'); audio.load(); events.abort();
    state.isPlaying = false; syncRealAudio = original.sync; startTimer = original.timer;
    updateProgressUI = original.progress; renderPlayerUI = original.render; renderAll();
  }};
})();
