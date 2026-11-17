/* SoundCloud audio adapter. Credentials are handled by the local server. */
(() => {
  const audio = document.getElementById('telefy-audio');
  const original = { sync: syncRealAudio, timer: startTimer, progress: updateProgressUI, render: renderPlayerUI };
  const events = new AbortController();
  let enabled = true, request = 0, activeId = null;
  let progressFrame = null;
  let hls = null, streamController = null;
  let sourceReady = false, switchingSource = false;
  let pausePoint = null, resumePoint = null;
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
          if(engine!==hls || !enabled || !error.fatal)return;
          if(error.type===Hls.ErrorTypes.MEDIA_ERROR && !recovered){recovered=true;engine.recoverMediaError();return;}
          const status=error.response?.code;
          const message=`Не удалось загрузить поток (${error.details || 'HLS'}${status ? ', HTTP '+status : ''})`;
          if(!settled)finish(new Error(message));
          else {activeId=null;sourceReady=false;fail(message);}
          engine.destroy();if(hls===engine)hls=null;
        });
        engine.on(Hls.Events.MEDIA_ATTACHED,()=>{
          if(engine===hls && !signal.aborted)engine.loadSource(url);
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
      state.progressSec = audio.paused && pausePoint?.id === activeId ? pausePoint.time : audio.currentTime;
      updateProgressUI(); syncMediaPosition();
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
    if (!state.isPlaying) {
      if (!audio.paused && sourceReady && activeId === state.currentTrackId) {
        pausePoint={id:activeId,time:audio.currentTime};
      }
      audio.pause();
      return;
    }
    const track = getTrack(state.currentTrackId);
    if (!track?.id) { fail('Дождись загрузки каталога'); return; }
    if(reset || (pausePoint && pausePoint.id!==track.id)){pausePoint=null;resumePoint=null;}
    const restoreAt=pausePoint?.id===track.id ? pausePoint.time : null;
    try {
      const hasSource=Boolean(hls || audio.srcObject || audio.currentSrc || audio.getAttribute('src'));
      if (reset || activeId !== track.id || !hasSource || !sourceReady) {
        sourceReady=false; switchingSource=true;
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
          if(data.error==='listening_limit'){state.isPlaying=false;audio.pause();renderPlayerUI();window.TelefyUsage?.showLimit();return;}
          if(response.status===401 && data.error==='bridge_unauthorized') {
            location.replace('/');return;
          }
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
          const code=/^[a-z_]+$/.test(data.error || '') ? data.error : 'unknown';
          throw new Error(messages[data.error] || `Не удалось подключить поток (HTTP ${response.status}, ${code})`);
        }
        if (typeof data.url !== 'string' || !data.url.startsWith('https://')) throw new Error('Некорректный адрес потока');
        track.soundcloudUrn=data.track.soundcloudUrn;
        track.soundcloudUrl=data.track.soundcloudUrl;
        if(data.track.duration)track.duration=data.track.duration;
        if(data.track.coverImg)track.coverImg=data.track.coverImg;
        window.dispatchEvent(new CustomEvent('telefy:track-resolved')); 
        track.uploader=data.track.uploader; track.uploaderUrl=data.track.uploaderUrl;
        activeId=track.id;
        await prepareSource(data.url,streamController.signal,currentRequest);

      }
      if (currentRequest !== request) return;
      if(restoreAt!==null){
        resumePoint={id:track.id,time:restoreAt};
        audio.currentTime=restoreAt;state.progressSec=restoreAt;updateProgressUI();
        pausePoint=null;
      }
      await audio.play(); if (currentRequest === request) { switchingSource=false; renderPlayerUI(); }
    } catch (error) {
      if (currentRequest !== request || error.name === 'AbortError') return;
      switchingSource=false;
      if(!sourceReady){activeId=null;if(hls){hls.destroy();hls=null;}}
      fail(error.name === 'NotAllowedError' ? 'Нажми ▶ ещё раз для запуска звука' : (error.message || 'Не удалось загрузить аудио'));
    }
  };
  const on = (name, handler) => audio.addEventListener(name, handler, { signal: events.signal });
  on('timeupdate', syncProgress);
  on('seeked', syncProgress);
  on('pause', () => {
    stopProgressFrames();
    // Source replacement also emits pause; it must not cancel a new track load.
    if (enabled && sourceReady && !switchingSource && activeId === state.currentTrackId && audio.paused && !audio.ended) {
      pausePoint={id:activeId,time:audio.currentTime}; resumePoint=null;
      state.isPlaying=false; renderPlayerUI();
    }
    syncProgress();
  });
  on('ended', stopProgressFrames);
  on('error', stopProgressFrames);
  on('playing', startProgressFrames);
  document.addEventListener('visibilitychange', () => {
    syncProgress(); startProgressFrames();
  }, { signal:events.signal });
  reducedMotion.addEventListener('change', startProgressFrames, { signal:events.signal });
  on('loadedmetadata', updateProgressUI);
  on('playing', () => {
    if (activeId === state.currentTrackId) {
      if(resumePoint?.id===activeId){
        if(Math.abs(audio.currentTime-resumePoint.time)>.25)audio.currentTime=resumePoint.time;
        resumePoint=null;
      }
      pausePoint=null; state.isPlaying = true; bindMediaActions(); renderPlayerUI();
    }
  });
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
      if(audio.paused)pausePoint={id:activeId,time:target};
      resumePoint=null;
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
  // Headphones and lock-screen controls share the app's existing playback queue.
  const mediaSession = window.navigator?.mediaSession;
  const originalDocumentTitle = document.title;
  let metadataKey = null;
  const mediaActions = {
    play: () => {
      if (!enabled || (!audio.paused && state.isPlaying)) return;
      state.isPlaying=true; syncRealAudio(false); renderPlayerUI();
    },
    pause: () => {
      if (!enabled) return;
      state.isPlaying=false; syncRealAudio(false); renderPlayerUI();
    },
    nexttrack: () => { if (enabled) playNext(false); },
    previoustrack: () => { if (enabled) playPrev(); },
    seekto: details => {
      if (!enabled || !sourceReady || activeId !== state.currentTrackId || !Number.isFinite(details.seekTime)) return;
      const target=Math.max(0,Math.min(duration(),details.seekTime));
      if (audio.paused) pausePoint={id:activeId,time:target};
      resumePoint=null; audio.currentTime=target; state.progressSec=target;
      updateProgressUI(); syncMediaPosition();
    }
  };
  function bindMediaActions() {
    if (!enabled || !mediaSession) return;
    // Keep track navigation available instead of advertising +/-10s buttons.
    for (const action of ['seekbackward','seekforward']) {
      try { mediaSession.setActionHandler(action,null); } catch (_) {}
    }
    for (const [action,handler] of Object.entries(mediaActions)) {
      try { mediaSession.setActionHandler(action,handler); } catch (_) {}
    }
  }
  function syncMediaPosition() {
    if (!enabled || !mediaSession?.setPositionState || !sourceReady || activeId !== state.currentTrackId) return;
    const length=duration();
    if (!Number.isFinite(length) || length<=0) return;
    const position=audio.paused && pausePoint?.id===activeId ? pausePoint.time : audio.currentTime;
    try { mediaSession.setPositionState({duration:length,playbackRate:audio.playbackRate||1,position:Math.max(0,Math.min(length,position||0))}); } catch (_) {}
  }
  function syncMediaSession() {
    if (!enabled) return;
    const track=getTrack(state.currentTrackId);
    // Embedded browsers sometimes use the page title as Now Playing fallback.
    if (track?.id && track.title) document.title=[track.title,track.artist,'Telefy'].filter(Boolean).join(' — ');
    if (!mediaSession) return;
    if (track?.id && window.MediaMetadata) {
      const artwork=/^https:\/\//.test(track.coverImg||'') ? [{src:track.coverImg}] : [];
      const data={title:track.title||'Telefy',artist:track.artist||'',album:track.album||'',artwork};
      const key=JSON.stringify([track.id,data]);
      if (key!==metadataKey) {
        try { mediaSession.metadata=new window.MediaMetadata(data); metadataKey=key; } catch (_) {}
      }
    }
    try { mediaSession.playbackState=!audio.paused && !audio.ended ? 'playing' : 'paused'; } catch (_) {}
    syncMediaPosition();
  }
  function releaseMediaSession() {
    document.title=originalDocumentTitle;
    if (!mediaSession) return;
    for (const action of Object.keys(mediaActions)) {
      try { mediaSession.setActionHandler(action,null); } catch (_) {}
    }
    try { mediaSession.playbackState='none'; mediaSession.metadata=null; mediaSession.setPositionState?.(); } catch (_) {}
  }
  renderPlayerUI = function(...args) {
    const result=original.render(...args); syncMediaSession(); return result;
  };
  function restoreSystemPlayer() {
    if (enabled && !document.hidden && sourceReady && !switchingSource && activeId===state.currentTrackId && !audio.ended) {
      state.isPlaying=!audio.paused;
      if(audio.paused)pausePoint={id:activeId,time:audio.currentTime};
      bindMediaActions(); renderPlayerUI();
    }
  }
  document.addEventListener('visibilitychange',restoreSystemPlayer,{signal:events.signal});
  window.addEventListener('pageshow',restoreSystemPlayer,{signal:events.signal});
  on('loadedmetadata',syncMediaSession);
  on('durationchange',syncMediaPosition);
  on('ratechange',syncMediaPosition);
  bindMediaActions();

  window.TelefyAudio = { restart() {
    if(!enabled||!sourceReady||activeId!==state.currentTrackId)return false;
    scrubbing=false;scrubTarget=null;resumePoint=null;
    if(pausePoint?.id===activeId)pausePoint.time=0;
    audio.currentTime=0;state.progressSec=0;updateProgressUI();syncMediaPosition();return true;
  }, disable() {
    releaseMediaSession();
    enabled = false; scrubbing = false; scrubTarget = null; scrubPointer = null;
    pausePoint=null;resumePoint=null;
    request++; streamController?.abort(); if (hls) { hls.destroy(); hls=null; } stopProgressFrames(); audio.pause(); audio.removeAttribute('src'); audio.load(); events.abort();
    state.isPlaying = false; syncRealAudio = original.sync; startTimer = original.timer;
    updateProgressUI = original.progress; renderPlayerUI = original.render; renderAll();
  }};
})();
