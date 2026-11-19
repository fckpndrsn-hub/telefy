
/* Shared content placeholders: no fake titles or clickable rows. */
window.TelefySkeleton={
 html(kind='tracks',count=6){
  const cards=kind==='cards',note=kind==='note';
  const label=typeof state!=='undefined'&&state.lang==='en'?'Loading':'Загрузка';
  return `<div class="catalog-skeleton ${cards?'skeleton-cards':note?'skeleton-note':''}" role="status" aria-label="${label}">${Array.from({length:count},()=>note?'<span class="skeleton-line" aria-hidden="true"></span>':`<div class="catalog-skeleton-row" aria-hidden="true"><span class="catalog-skeleton-art ${kind==='artists'?'is-round':''}"></span><span class="catalog-skeleton-copy"><span></span><span></span></span></div>`).join('')}</div>`;
 }
};
// Capture legacy data before startup catalog refresh changes numeric IDs.
try {
 window.TelefyLegacyLibrary = JSON.parse(localStorage.getItem('telefy_legacy_library_pending_v1')||'null') || { keys:localStorage.getItem('telefy_user_liked_keys_v8'), playlists:localStorage.getItem('telefy_user_playlists_v6'), catalog:localStorage.getItem('telefy_parsed_catalog_v8') };
 if(window.TelefyLegacyLibrary.keys||window.TelefyLegacyLibrary.playlists)localStorage.setItem('telefy_legacy_library_pending_v1',JSON.stringify(window.TelefyLegacyLibrary));
} catch (_) {}

    // Purge legacy broken cover/playlist caches from earlier versions so stale/mismatched covers never appear
    try {
      [
        'telefy_itunes_covers_v1',
        'telefy_itunes_covers_v2',
        'telefy_itunes_covers_v3',
        'telefy_itunes_covers_v6',
        'telefy_itunes_albums_v1',
        'telefy_itunes_albums_v6',
        'telefy_itunes_album_tracks_v1',
        'telefy_itunes_album_tracks_v6',
        'telefy_parsed_catalog_v6',
        'telefy_parsed_catalog_v7',
        'telefy_artist_avatars_v6',
        'telefy_user_playlists_v1'
      ].forEach(k => localStorage.removeItem(k));
    } catch (_) {}

    function pickDeezerCover(albumObj) {
      if (!albumObj || typeof albumObj !== 'object') return null;
      const raw = albumObj.cover_big || albumObj.cover_xl || albumObj.cover_medium || albumObj.cover || null;
      if (!raw || typeof raw !== 'string' || !raw.startsWith('http')) return null;
      return raw.trim();
    }

    function pickDeezerArtistAvatar(artistObj) {
      if (!artistObj || typeof artistObj !== 'object') return null;
      const raw = artistObj.picture_big || artistObj.picture_xl || artistObj.picture_medium || artistObj.picture || null;
      if (!raw || typeof raw !== 'string' || !raw.startsWith('http')) return null;
      if (raw.includes('/artist//') || raw.includes('/artist/d41d8cd98f00b204e9800998ecf8427e')) return null;
      return raw.trim();
    }

    function renderCoverImgTag(url, extraClass = '') {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) return '';
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<img src="${safeUrl}" alt="" referrerpolicy="no-referrer" decoding="async" class="cover-art-img ${extraClass}" onerror="if(this.src.includes('500x500')){this.src=this.src.replace('500x500','250x250');}else if(this.src.includes('1000x1000')){this.src=this.src.replace('1000x1000','500x500');}else{this.style.display='none';}" />`;
    }

    function applyCoverStyle(el, trackOrBg) {
      if (!el) return;
      const img = typeof trackOrBg === 'object' && trackOrBg
        ? (trackOrBg.coverImg && trackOrBg.coverImg.startsWith('http') ? trackOrBg.coverImg : null)
        : (typeof trackOrBg === 'string' && trackOrBg.startsWith('http') ? trackOrBg : null);
      const bg = typeof trackOrBg === 'object' && trackOrBg
        ? (trackOrBg.cover || '#1E3A8A')
        : (typeof trackOrBg === 'string' && !trackOrBg.startsWith('http') ? trackOrBg : '#1E3A8A');
      const isLoading = typeof trackOrBg === 'object' && trackOrBg && trackOrBg.coverStatus === 'loading' && !img;

      el.classList.toggle('cover-loading', Boolean(isLoading));
      el.style.backgroundColor = bg || '#1E3A8A';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';

      let imgEl = el.querySelector(':scope > img.cover-art-img');
      if (img) {
        el.style.backgroundImage = `url("${img}")`;
        if (!imgEl) {
          imgEl = document.createElement('img');
          imgEl.className = 'cover-art-img';
          imgEl.alt = '';
          imgEl.referrerPolicy = 'no-referrer';
          imgEl.decoding = 'async';
          imgEl.onerror = function() {
            if (this.src.includes('1000x1000')) {
              this.src = this.src.replace('1000x1000', '500x500');
            } else if (this.src.includes('500x500')) {
              this.src = this.src.replace('500x500', '250x250');
            } else {
              this.style.display = 'none';
            }
          };
          el.insertBefore(imgEl, el.firstChild);
        }
        if (imgEl.getAttribute('src') !== img) {
          imgEl.style.display = 'block';
          imgEl.setAttribute('src', img);
        }
      } else {
        el.style.backgroundImage = 'none';
        if (imgEl) imgEl.remove();
      }

      const glyph = el.querySelector('.cover-fallback-glyph');
      if (glyph) glyph.classList.toggle('hidden', Boolean(img));
    }

    // Solid flat colors (zero gradients)
    const COVER_PRESETS = [
      { id: 'c1', label: 'Telegram', bg: '#2AABEE' },
      { id: 'c2', label: 'Сапфир', bg: '#1D4ED8' },
      { id: 'c3', label: 'Индиго', bg: '#5856D6' },
      { id: 'c4', label: 'Графит', bg: '#1C1C1E' }
    ];

    const TRACK_ACCENT_COLORS = ['#1E3A8A', '#5856D6', '#0284C7', '#E11D48', '#7C3AED', '#0F766E', '#1D4ED8', '#BE123C'];

    const MOODS = [
      {id:'all',hideChip:true,label:'Мой поток'},
      {id:'energy',color:'#34C759'}, {id:'night',color:'#0284C7'},
      {id:'underground',color:'#5856D6'}
    ];
    // Roster of artists for catalog initialization
    const RUSSIAN_RAP_ROSTER = [
      {"name": "RMW", "query": "RMW", "mood": "energy", "uncensoredDefault": true, "aliases": ["rmw", "рмв"]},
      {"name": "Anonymous Ember", "query": "Anonymous Ember", "mood": "energy", "uncensoredDefault": true, "aliases": ["anonymous ember", "anonymous amber", "анонимный эмбер"]},
      {"name": "tuborosho", "query": "tuborosho", "mood": "energy", "uncensoredDefault": true, "aliases": ["tuborosho", "туборошо"]},
      {"name": "huzzy b", "query": "huzzy b", "mood": "energy", "uncensoredDefault": true, "aliases": ["huzzy b", "huzzyb", "хаззиб"]},
      {"name": "fckshiza", "query": "fckshiza", "mood": "energy", "uncensoredDefault": true, "aliases": ["fckshiza", "факшиза"]},
      {"name": "FORTUNA 812", "query": "FORTUNA 812", "mood": "energy", "uncensoredDefault": true, "aliases": ["fortuna 812", "fortune 812", "фортуна 812", "фортуна"]},
      {"name": "madk1d", "query": "madk1d", "mood": "energy", "uncensoredDefault": true, "aliases": ["madk1d", "madkid", "медкид", "мэдкид"]},
      {"name": "темный принц", "query": "темный принц", "mood": "energy", "uncensoredDefault": true, "aliases": ["темный принц", "тёмный принц"]},
      {"name": "Kai Angel", "query": "Kai Angel", "mood": "energy", "uncensoredDefault": true, "aliases": ["kai angel", "кай ангел"]},
      {"name": "9mice", "query": "9mice", "mood": "energy", "uncensoredDefault": true, "aliases": ["9mice", "9 mice"]},
      {"name": "Clout", "query": "Clout", "mood": "energy", "uncensoredDefault": true, "aliases": ["clout", "клаут", "klout"]},
      {"name": "CUPSIZE", "query": "CUPSIZE", "mood": "energy", "uncensoredDefault": true, "aliases": ["cupsize", "капсайз"]},
      {"name": "CODE10", "query": "CODE10", "mood": "energy", "uncensoredDefault": true, "aliases": ["code10", "code 10", "code80"]},
      {"name": "Королевский", "query": "Королевский", "mood": "all", "uncensoredDefault": true, "aliases": ["королевский", "королевский xvii", "королевский 17", "korolevskiy"]},
      {"name": "Nanmas", "query": "Nanmas", "mood": "energy", "uncensoredDefault": true, "aliases": ["nanmas", "нанмас"]},
      {"name": "fakemutin", "query": "fakemutin", "mood": "energy", "uncensoredDefault": true, "aliases": ["fakemutin", "фейкмутин"]},
      {"name": "Олег Кавказ", "query": "Олег Кавказ", "mood": "energy", "uncensoredDefault": true, "aliases": ["олег кавказ", "oleg kavkaz"]},
      {"name": "ivycraft", "query": "ivycraft", "mood": "energy", "uncensoredDefault": true, "aliases": ["ivycraft", "айвикрафт"]},
      {"name": "Главный герой", "query": "Главный герой", "mood": "energy", "uncensoredDefault": true, "aliases": ["главный герой", "glavniy geroy"]},
      {"name": "хулагу 3g", "query": "хулагу 3g", "mood": "energy", "uncensoredDefault": true, "aliases": ["хулагу 3g", "hulagu 3g", "hulagu3g"]},
      {"name": "3goth2002", "query": "3goth2002", "mood": "energy", "uncensoredDefault": true, "aliases": ["3goth2002"]},
      {"name": "akiko!", "query": "akiko!", "mood": "energy", "uncensoredDefault": true, "aliases": ["akiko!"]},
      {"name": "CODE80", "query": "CODE80", "mood": "energy", "uncensoredDefault": true, "aliases": ["code80", "code 80"]},
      {"name": "greyrock", "query": "greyrock", "mood": "energy", "uncensoredDefault": true, "aliases": ["greyrock", "грейрок"]},
      {"name": "tewiq", "query": "tewiq", "mood": "energy", "uncensoredDefault": true, "aliases": ["tewiq", "тевик"]},
      {"name": "3umph", "query": "3umph", "mood": "energy", "uncensoredDefault": true, "aliases": ["3umph"]},
      { name: 'Big Baby Tape', query: 'Big Baby Tape', mood: 'energy', uncensoredDefault: true, aliases: ['big baby tape', 'биг бейби тейп', 'dj tape'] },
      { name: 'KIZARU', query: 'kizaru', mood: 'uncensored', uncensoredDefault: true, aliases: ['kizaru', 'кизару'] },
      { name: 'FRIENDLY THUG 52 NGG', query: 'FRIENDLY THUG 52 NGG', mood: 'underground', uncensoredDefault: true, aliases: ['friendly thug 52 ngg', 'friendly thug 52'] },
      { name: 'ALBLAK 52', query: 'ALBLAK 52', mood: 'uncensored', uncensoredDefault: true, aliases: ['alblak 52', 'алблак 52'] },
      { name: 'Toxi$', query: 'Toxi$', mood: 'energy', uncensoredDefault: true, aliases: ['toxi$', 'токсис'] },
      { name: 'OG Buda', query: 'OG Buda', mood: 'uncensored', uncensoredDefault: true, aliases: ['og buda', 'оджи буда'] },
      { name: 'PHARAOH', query: 'PHARAOH', mood: 'uncensored', uncensoredDefault: true, aliases: ['pharaoh', 'фараон'] },
      { name: 'Скриптонит', query: 'Скриптонит', mood: 'night', uncensoredDefault: true, aliases: ['скриптонит', 'scriptonite'] },
      { name: 'SALUKI', query: 'SALUKI', mood: 'underground', uncensoredDefault: true, aliases: ['saluki', 'салуки'] },
      { name: 'OBLADAET', query: 'OBLADAET', mood: 'energy', uncensoredDefault: true, aliases: ['obladaet', 'обладает'] },
      { name: 'BUSHIDO ZHO', query: 'BUSHIDO ZHO', mood: 'energy', uncensoredDefault: true, aliases: ['bushido zho', 'бушидо жо'] },
      { name: 'Aarne', query: 'Aarne', mood: 'energy', uncensoredDefault: true, aliases: ['aarne', 'аарне'], strictGenre: true },
      { name: 'MAYOT', query: 'MAYOT', mood: 'night', uncensoredDefault: true, aliases: ['mayot', 'майот'] },
      { name: 'Платина', query: 'Платина', mood: 'uncensored', uncensoredDefault: true, aliases: ['платина'], requireCyrillicOrRap: true },
      { name: 'MACAN', query: 'MACAN', mood: 'night', uncensoredDefault: false, aliases: ['macan', 'макан'], strictGenre: true },
      { name: 'Heronwater', query: 'Heronwater', mood: 'energy', uncensoredDefault: true, aliases: ['heronwater', 'херонвотер'] },
      { name: 'SODA LUV', query: 'SODA LUV', mood: 'uncensored', uncensoredDefault: true, aliases: ['soda luv', 'сода лав'] },
      { name: 'Boulevard Depo', query: 'Boulevard Depo', mood: 'underground', uncensoredDefault: true, aliases: ['boulevard depo', 'бульвар депо'] },
      { name: 'Markul', query: 'Markul', mood: 'night', uncensoredDefault: false, aliases: ['markul', 'маркул'] },
      { name: 'ЛСП', query: 'ЛСП', mood: 'night', uncensoredDefault: true, aliases: ['лсп', 'lsp'] },
      { name: 'FEDUK', query: 'FEDUK', mood: 'energy', uncensoredDefault: false, aliases: ['feduk', 'федук'] },
      { name: 'Miyagi & Эндшпиль', query: 'Miyagi Эндшпиль', mood: 'night', uncensoredDefault: false, aliases: ['miyagi & эндшпиль', 'miyagi & andy panda', 'miyagi', 'мияги'] },
      { name: 'GONE.Fludd', query: 'GONE.Fludd', mood: 'energy', uncensoredDefault: true, aliases: ['gone.fludd', 'gone fludd'] },
      { name: 'LIL KRYSTALLL', query: 'LIL KRYSTALLL', mood: 'uncensored', uncensoredDefault: true, aliases: ['lil krystalll', 'лил кристаллл'] },
      { name: 'LOVV66', query: 'LOVV66', mood: 'night', uncensoredDefault: true, aliases: ['lovv66', 'ловв66'] },
      { name: '163ONMYNECK', query: '163ONMYNECK', mood: 'uncensored', uncensoredDefault: true, aliases: ['163onmyneck'] },
      { name: 'SEEMEE', query: 'SEEMEE', mood: 'uncensored', uncensoredDefault: true, aliases: ['seemee', 'сими'] },
      { name: 'ICEGERGERT', query: 'ICEGERGERT', mood: 'energy', uncensoredDefault: true, aliases: ['icegergert', 'айсгергерт'] },
      { name: 'Whole Lotta Swag', query: 'Whole Lotta Swag', mood: 'underground', uncensoredDefault: true, aliases: ['whole lotta swag'] },
      { name: 'масло чёрного тмина', query: 'масло чёрного тмина', mood: 'underground', uncensoredDefault: true, aliases: ['масло чёрного тмина', 'масло черного тмина'] },
      { name: 'Thomas Mraz', query: 'Thomas Mraz', mood: 'night', uncensoredDefault: false, aliases: ['thomas mraz', 'томас мраз'] },
      { name: 'T-Fest', query: 'T-Fest', mood: 'night', uncensoredDefault: true, aliases: ['t-fest', 'ти-фест'] },
      { name: 'Хаски', query: 'Хаски', mood: 'underground', uncensoredDefault: true, aliases: ['хаски'] },
      { name: 'Каста', query: 'Каста', mood: 'underground', uncensoredDefault: true, aliases: ['каста'] }
    ];

    function savedKeys(key){try{const a=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string'):[];}catch(_){return [];}}
    const userLikedTrackKeys = new Set();
    const userListenedTrackKeys = new Set(savedKeys('telefy_qualified_listens_v1'));
    const userListenedTrackIds = new Set();

    function saveUserLikedKeys() { return window.TelefyLibrary?.save() || Promise.resolve(false); }

    function saveUserListenedKeys() {
      try {
        localStorage.setItem('telefy_qualified_listens_v1', JSON.stringify(Array.from(userListenedTrackKeys).slice(-200)));
      } catch (_) {}
    }

    // Catalog tracks
    let tracks = (() => {
      try {
        const raw = localStorage.getItem('telefy_parsed_catalog_v8');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
              .filter(t => t && !window.telefySongBlocked(t) && t.title && t.artist && !/(^|[^a-zа-яё])(?:баста|basta|ноггано|noggano)(?=$|[^a-zа-яё])/i.test(t.artist) && (t.soundcloudUrn || (t.coverImg && t.coverImg.startsWith('http'))))
              .map(t => ({ ...t, liked: false }));
          }
        }
      } catch (_) {}
      return [];
    })();

    const COLLECTIONS = [{"id": "hits", "title": "Хиты русского рэпа", "tag": "2017–2026", "shortDesc": "Путешествие с 2017 по 2026 год", "artists": "", "targetArtists": [], "cover": "#2450A4", "icon": "<span class=\"tg-ico text-[22px]\" aria-hidden=\"true\">&#xF0DA;</span>", "trackIds": [], "curated": true}, {"id": "legends", "title": "Легенды русского рэпа", "tag": "Классика жанра", "shortDesc": "Артисты, которые сформировали звук", "artists": "", "targetArtists": [], "cover": "#6B4BA2", "icon": "<span class=\"tg-ico text-[22px]\" aria-hidden=\"true\">&#xF087;</span>", "trackIds": [], "curated": true}, {"id": "premiere", "title": "Премьера", "tag": "Свежие релизы", "shortDesc": "Новые релизы популярных артистов", "artists": "", "targetArtists": [], "cover": "#B84363", "icon": "<span class=\"tg-ico text-[22px]\" aria-hidden=\"true\">&#xF01B;</span>", "trackIds": [], "curated": true}, {"id": "telescope", "title": "Teleскоп", "tag": "Выбор Telefy", "shortDesc": "Редакционная подборка", "artists": "", "targetArtists": [], "cover": "#197D86", "icon": "<span class=\"tg-ico text-[22px]\" aria-hidden=\"true\">&#xF066;</span>", "trackIds": [], "curated": true}];

    const I18N = {
      ru: {
        navHome: 'Главная',
        navFlow: 'Поток',
        navSearch: 'Поиск',
        navMyTelefy: 'Мой Telefy',
        qaMyVibe: 'Мой вайб',
        qaShuffle: 'Вперемешку',
        qaLiked: 'Любимые',
        qaBotHTML: 'Офлайн-режим',
        madeForYou: 'Специально для вас',
        collectionsLabel: 'Подборки',
        uncensoredTitle: 'Без цензуры',
        tracksCount: 'Треков',
        upNext: 'Дальше',
        searchPlaceholder: 'Трек, артист или жанр...',
        searchAll: 'Все',
        searchExplicit: 'Без цензуры',
        searchLiked: 'Любимые',
        searchEmpty: 'Ничего не найдено по запросу',
        catalogSource: 'Каталог Telefy',
        myFlowTitle: 'Мой поток',
        settingsTitle: 'Настройки',
        settingsGroupAppearance: 'Оформление и язык',
        settingsDarkTheme: 'Тёмная тема',
        settingsThemeLight: 'Светлая',
        settingsThemeDark: 'Тёмная',
        settingsLanguage: 'Язык приложения',
        settingsLangName: 'Русский',
        settingsGroupPlayback: 'Воспроизведение',
        settingsHighQuality: 'Высокое качество',
        settingsQualityHigh: '320 kbps · AAC',
        settingsQualityStd: '128 kbps · Экономия',
        settingsHaptic: 'Тактильный отклик',
        profileEditBtn: 'Ред.',
        profileBgTitle: 'Оформление профиля',
        profileBgDone: 'Готово',
        profileBgSection: 'Выбрать фон',
        settingsHapticSub: 'Вибрация при нажатии',
        settingsGroupSupport: 'Помощь',
        settingsSupport: 'Поддержка',
        settingsSupportWrite: 'Написать',
        settingsFooter: 'Telefy 2026.', settingsDocuments: 'Политика и документы',
        lyricsBtn: 'Текст',
        lyricsAuthorNote: 'С уважением, Telefy',
        lyricsSoon: 'Текст скоро будет доступен',
        playCollection: 'Слушать подборку',
        popularTracks: 'Популярные треки',
        albumsTitle: 'Альбомы',
        albumLabel: 'Альбом',
        albumPlayAll: 'Слушать',
        albumShuffle: 'Микс',
        albumsLoading: 'Загружаем альбомы...',
        albumsEmpty: 'Альбомы не найдены',
        albumTracksLoading: 'Загружаем треклист альбома...',
        albumTracksEmpty: 'Треклист недоступен',
        retryLabel: 'Повторить',
        monthlyListeners: 'слушателей в месяц',
        perk1Title: 'Создание плейлистов',
        perk1Desc: 'Собирай собственные подборки под любое настроение и делись ими.',
        perk2Title: 'Выгрузка треков в офлайн',
        perk2Desc: 'Мгновенная отправка треков в диалог с ботом для прослушивания без сети.',
        perk3Title: 'Сохранение треков в любимое',
        perk3Desc: 'Безлимитная медиатека избранного с быстрой синхронизацией.',
        perk4Title: 'Выключение ограничения 60 мин/день',
        perk4Desc: 'Слушай музыку и «Мой поток» без суточного лимита.',
        perk5Title: 'Рекомендации от Telefy AI',
        perk5Desc: 'Уникальные подборки с описанием каждого трека и его вайба.',
        maxSubDefault: 'Максимум возможностей музыки в Telegram',
        maxSubActive: 'Telefy Max активен',
        maxBtnDefault: 'Оформить за 100 звёзд / 30 дней',
        maxBtnActive: 'Подписка Max активна ✓',
        maxActiveUntilPill: 'Telefy Max',
        maxStatLibrary: 'В библиотеке',
        maxStatPlaylists: 'Плейлистов',
        maxStatLiked: 'Любимое',
        maxRowProfileTitle: 'Профиль Telefy Max',
        maxRowProfileSub: 'Синхронизация с Telegram Cloud',
        maxRowLibraryTitle: 'Треков в библиотеке',
        maxRowLibrarySub: 'Безлимитное хранение и офлайн-бот',
        maxRowExpireTitle: 'Срок действия подписки',
        maxRowExpireSub: 'Без автопродления',
        maxRowExpireDate: '—',
        maxTabPlaylists: 'Плейлисты',
        maxTabLiked: 'Любимое',
        maxPlaylistsHeading: 'Мои плейлисты',
        maxCreatePlaylistBtn: 'Создать',
        maxLikedHeading: 'Любимые треки',
        maxPlayLikedBtn: 'Слушать все',
        maxRenewBtn: 'Продлить',
        inDevTitle: 'В разработке',
        inDevDesc: 'Продление подписки Telefy Max скоро появится в приложении.',
        inDevBackBtn: 'Понятно',
        upsellModalTitle: 'Любимые',
        upsellModalDesc: 'Раздел «Любимое» и создание плейлистов доступны с подпиской Telefy Max.',
        createPlModalTitle: 'Новый плейлист',
        createPlConfirmBtn: 'Создать плейлист',
        toastPlaylistCreated: 'Плейлист создан',
        toastLockedLiked: 'Раздел «Любимое» доступен в Telefy Max',
        toastMaxOn: 'Telefy Max активирован!',
        toastMaxOff: 'Подписка Telefy Max отключена',
        toastSentBot: 'Трек выгружен в @TelefyApp_Bot (офлайн-режим)',
        toastMyVibeEmpty: 'Послушайте треки или добавьте их в «Любимые» для «Моего вайба»',
        toastMyVibeOn: 'Включён «Мой вайб»',
        toastTasteReset: 'Музыкальные предпочтения перезагружены · Вперемешку',
        toastSaved: 'Сохранено',
        toastRemoved: 'Удалено из любимых',
        toastSkipped: 'Трек пропущен',
        toastRepeatOn: 'Повтор трека включён',
        toastRepeatOff: 'Повтор выключен',
        toastShuffleOn: 'Случайный порядок включён',
        toastShuffleOff: 'Обычный порядок',
        toastLangChanged: 'Язык: Русский',
        toastThemeDark: 'Включена тёмная тема',
        toastThemeLight: 'Включена светлая тема',
        toastHqOn: 'Высокое качество: 320 kbps',
        toastHqOff: 'Стандартное качество: 128 kbps',
        toastHapticOn: 'Тактильный отклик включён',
        toastHapticOff: 'Тактильный отклик выключен'
      },
      en: {
        navHome: 'Home',
        navFlow: 'Flow',
        navSearch: 'Search',
        navMyTelefy: 'My Telefy',
        qaMyVibe: 'My Vibe',
        qaShuffle: 'Shuffle',
        qaLiked: 'Liked',
        qaBotHTML: 'Offline Mode',
        madeForYou: 'Made For You',
        collectionsLabel: 'Collections',
        uncensoredTitle: 'Uncensored',
        tracksCount: 'Tracks',
        upNext: 'Up Next',
        searchPlaceholder: 'Track, artist, or genre...',
        searchAll: 'All',
        searchExplicit: 'Explicit',
        searchLiked: 'Liked',
        searchEmpty: 'Nothing found for',
        catalogSource: 'Telefy Catalog',
        myFlowTitle: 'My Flow',
        settingsTitle: 'Settings',
        settingsGroupAppearance: 'Appearance & Language',
        settingsDarkTheme: 'Dark Theme',
        settingsThemeLight: 'Light',
        settingsThemeDark: 'Dark',
        settingsLanguage: 'App Language',
        settingsLangName: 'English',
        settingsGroupPlayback: 'Playback',
        settingsHighQuality: 'High Quality',
        settingsQualityHigh: '320 kbps · AAC',
        settingsQualityStd: '128 kbps · Data Saver',
        settingsHaptic: 'Haptic Feedback',
        profileEditBtn: 'Edit',
        profileBgTitle: 'Profile Theme',
        profileBgDone: 'Done',
        profileBgSection: 'Choose Background',
        settingsHapticSub: 'Vibration on tap',
        settingsGroupSupport: 'Help',
        settingsSupport: 'Support',
        settingsSupportWrite: 'Message',
        settingsFooter: 'Telefy 2026.', settingsDocuments: 'Policies and documents',
        lyricsBtn: 'Lyrics',
        lyricsAuthorNote: 'With love, Telefy',
        lyricsSoon: 'Lyrics will be available soon',
        playCollection: 'Play Collection',
        popularTracks: 'Popular Tracks',
        albumsTitle: 'Albums',
        albumLabel: 'Album',
        albumPlayAll: 'Play',
        albumShuffle: 'Shuffle',
        albumsLoading: 'Loading albums...',
        albumsEmpty: 'No albums found',
        albumTracksLoading: 'Loading album tracklist...',
        albumTracksEmpty: 'Tracklist unavailable',
        retryLabel: 'Retry',
        monthlyListeners: 'monthly listeners',
        perk1Title: 'Create Playlists',
        perk1Desc: 'Build custom mixes for any mood and share them.',
        perk2Title: 'Offline Bot Export',
        perk2Desc: 'Instant track export to bot chat for offline listening.',
        perk3Title: 'Unlimited Favorites',
        perk3Desc: 'Unlimited favorites library with instant sync.',
        perk4Title: 'No 60 min/day Limit',
        perk4Desc: 'Listen to music and My Flow with no daily limit.',
        perk5Title: 'Telefy AI Recommendations',
        perk5Desc: 'Unique mixes with a vibe breakdown for every track.',
        maxSubDefault: 'Unlock the full power of music in Telegram.',
        maxSubActive: 'Telefy Max активен',
        maxBtnDefault: 'Subscribe for 100 Stars / 30 days',
        maxBtnActive: 'Max Subscription Active ✓',
        maxActiveUntilPill: 'Telefy Max',
        maxStatLibrary: 'In Library',
        maxStatPlaylists: 'Playlists',
        maxStatLiked: 'Favorites',
        maxRowProfileTitle: 'Telefy Max Profile',
        maxRowProfileSub: 'Synced with Telegram Cloud',
        maxRowLibraryTitle: 'Tracks in Library',
        maxRowLibrarySub: 'Unlimited storage & offline bot',
        maxRowExpireTitle: 'Subscription Valid Until',
        maxRowExpireSub: 'No auto-renewal',
        maxRowExpireDate: '—',
        maxTabPlaylists: 'Playlists',
        maxTabLiked: 'Favorites',
        maxPlaylistsHeading: 'My Playlists',
        maxCreatePlaylistBtn: 'Create',
        maxLikedHeading: 'Favorite Tracks',
        maxPlayLikedBtn: 'Play All',
        maxRenewBtn: 'Renew',
        inDevTitle: 'In Development',
        inDevDesc: 'Telefy Max subscription renewal will be available soon.',
        inDevBackBtn: 'Got it',
        upsellModalTitle: 'Favorites',
        upsellModalDesc: 'Favorites and custom playlists are unlocked with Telefy Max.',
        createPlModalTitle: 'New Playlist',
        createPlConfirmBtn: 'Create Playlist',
        toastPlaylistCreated: 'Playlist created',
        toastLockedLiked: 'Favorites require Telefy Max',
        toastMaxOn: 'Telefy Max activated!',
        toastMaxOff: 'Telefy Max subscription disabled',
        toastSentBot: 'Track uploaded to @TelefyApp_Bot (Offline mode)',
        toastMyVibeEmpty: 'Listen to tracks or add to Liked to build My Vibe',
        toastMyVibeOn: 'Playing My Vibe',
        toastTasteReset: 'Music preferences reset · Shuffle',
        toastSaved: 'Saved',
        toastRemoved: 'Removed from liked',
        toastSkipped: 'Track skipped',
        toastRepeatOn: 'Repeat track enabled',
        toastRepeatOff: 'Repeat disabled',
        toastShuffleOn: 'Shuffle enabled',
        toastShuffleOff: 'Normal order',
        toastLangChanged: 'Language: English',
        toastThemeDark: 'Dark theme enabled',
        toastThemeLight: 'Light theme enabled',
        toastHqOn: 'High quality: 320 kbps',
        toastHqOff: 'Standard quality: 128 kbps',
        toastHapticOn: 'Haptic feedback enabled',
        toastHapticOff: 'Haptic feedback disabled'
      }
    };

    const MOOD_I18N = {
      ru: {
        all: { label: 'Мой поток', streamTitle: 'Мой поток', shortDesc: 'Свежие треки по твоему вкусу' },
        uncensored: { label: 'Супер-бит', streamTitle: 'Супер-бит', shortDesc: 'Жёсткий трэп и тяжёлый бас' },
        night: { label: 'Чилл-вайб', streamTitle: 'Чилл-вайб', shortDesc: 'Мягкий звук и спокойный ритм' },
        energy: { label: 'Энерджи', streamTitle: 'Энерджи', shortDesc: 'Драйв, напор и быстрый ритм' },
        underground: { label: 'Тренды', streamTitle: 'Тренды', shortDesc: 'Свежие популярные русскоязычные треки' }
      },
      en: {
        all: { label: 'My Flow', streamTitle: 'My Flow', shortDesc: 'Fresh tracks tailored to your taste' },
        uncensored: { label: 'Uncensored', streamTitle: 'Underground Flow', shortDesc: 'Dark sound & rare releases' },
        night: { label: 'Night', streamTitle: 'Night Flow', shortDesc: 'Smooth rhythm for late hours' },
        energy: { label: 'Energy', streamTitle: 'Energy Flow', shortDesc: 'Heavy beat & fast tempo' },
        underground: { label: 'Discovery', streamTitle: 'Discovery Flow', shortDesc: 'New names & fresh genres' }
      }
    };

    const COL_I18N = {
      ru: {
        favorites_telefy: { title: 'Фавориты Telefy', tag: 'Выбор авторов Telefy', shortDesc: 'Лучшие релизы по версии редакции' },
        freshmen: { title: 'Фрешмены', tag: 'Новые имена', shortDesc: 'Громкие новички этой недели' },
        hiphop_rap: { title: 'Хип-хоп и рэп', tag: 'Жанровая подборка', shortDesc: 'Главные биты и свежие куплеты' },
        party_up: { title: 'Отрываемся!', tag: 'Энергия и драйв', shortDesc: 'Максимум драйва без пауз' },
        my_vibe: { title: 'Мой вайб', tag: 'Персональная подборка', shortDesc: 'Собрано под твоё настроение' },
        uncut: { title: 'Свежее без цензуры', tag: 'Выбор авторов Telefy', shortDesc: 'Бутлеги и треки без рамок' },
        night_drive: { title: 'Ночной драйв', tag: 'Под настроение', shortDesc: 'Глубокий бас для ночной дороги' },
        ru_rock: { title: 'Андеграунд и Концепт', tag: 'Культовый звук', shortDesc: 'Глубокие тексты и концептуальные альбомы' }
      },
      en: {
        favorites_telefy: { title: 'Telefy Favorites', tag: "Telefy Editors' Pick", shortDesc: 'Top releases picked by editors' },
        freshmen: { title: 'Freshmen', tag: 'New Names', shortDesc: 'Loudest newcomers this week' },
        hiphop_rap: { title: 'Hip-Hop & Rap', tag: 'Genre Mix', shortDesc: 'Top beats & fresh verses' },
        party_up: { title: 'Party Mode!', tag: 'Energy & Drive', shortDesc: 'Maximum drive non-stop' },
        my_vibe: { title: 'My Vibe', tag: 'Personal Mix', shortDesc: 'Curated for your mood' },
        uncut: { title: 'Fresh Uncut', tag: "Telefy Editors' Pick", shortDesc: 'Bootlegs & unfiltered tracks' },
        night_drive: { title: 'Night Drive', tag: 'Mood Mix', shortDesc: 'Deep bass for late-night drives' },
        ru_rock: { title: 'Underground & Concept', tag: 'Cult Sound', shortDesc: 'Deep lyrics & conceptual albums' }
      }
    };

    const savedPrefs = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_prefs_v2') || '{}'); } catch { return {}; }
    })();

    function savePrefs() {
      try {
        localStorage.setItem('telefy_prefs_v2', JSON.stringify({
          theme: state.theme,
          lang: state.lang,
          highQuality: state.highQuality,
          hapticEnabled: state.hapticEnabled
        }));
      } catch {}
    }

    const DEFAULT_USER_PLAYLISTS = [];
    let USER_PLAYLISTS = [];
    function saveUserPlaylists() { return window.TelefyLibrary?.save() || Promise.resolve(false); }

    let state = {
      theme: savedPrefs.theme === 'dark' ? 'dark' : 'light',
      lang: savedPrefs.lang === 'en' ? 'en' : 'ru',
      highQuality: savedPrefs.highQuality !== false,
      hapticEnabled: savedPrefs.hapticEnabled !== false,
      isMaxSubscribed: false,
      maxBetaTab: 'playlists',
      activeTab: 'home',
      activeMood: 'underground',
      searchFilter: 'all',
      searchQuery: '',
      currentTrackId: 0,
      isPlaying: false,
      progressSec: 0,
      sourceLabel: 'Тренды',
      selectedCoverPreset: COVER_PRESETS[0].bg,
      discovery: 50,
      energy: 60,
      queueIds: [],
      activeCollectionId: null,
      isCatalogParsing: tracks.length === 0
    };

    function t(key) {
      return (I18N[state.lang] && I18N[state.lang][key]) || I18N.ru[key] || key;
    }

    function getMoodText(id) {
      const langMap = MOOD_I18N[state.lang] || MOOD_I18N.ru;
      return langMap[id] || langMap.all;
    }

    function getColText(col) {
      if(col.curated)return {title:col.title,tag:col.tag,shortDesc:col.shortDesc};
      const langMap = COL_I18N[state.lang] || COL_I18N.ru;
      return langMap[col.id] || { title: col.title, tag: col.tag, shortDesc: col.shortDesc };
    }

    let playbackTimer = null;
    let toastTimer = null;

    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    const PARSING_FALLBACK_TRACK = {
      id: 0,
      title: 'Загружаем треки...',
      artist: 'Подборка треков',
      album: 'Загрузка обложек и альбомов',
      duration: 180,
      mood: 'all',
      uncensored: true,
      liked: false,
      disliked: false,
      cover: '#1E3A8A',
      coverImg: null,
      coverStatus: 'loading'
    };

    function getTrack(id) {
      if(window.TelefyFirstRun?.pending&&(id===state.currentTrackId||!id))return {...PARSING_FALLBACK_TRACK,title:window.TelefyFirstRun.failed?(state.lang==='en'?'Trends unavailable':'Тренды временно недоступны'):(state.lang==='en'?'Loading trends…':'Загружаем тренды…'),artist:window.TelefyFirstRun.failed?(state.lang==='en'?'Tap Play to retry':'Нажми Play, чтобы повторить'):'',album:''};
      if (!tracks.length) {
        if (state.isCatalogParsing) return PARSING_FALLBACK_TRACK;
        return { ...PARSING_FALLBACK_TRACK, title:state.lang==='en'?'Catalog unavailable':'Каталог недоступен',
          artist:state.lang==='en'?'Check your connection':'Проверь подключение',album:'',coverStatus:'idle',uncensored:false };
      }
      return tracks.find(t => t.id === id) || tracks[0] || PARSING_FALLBACK_TRACK;
    }

    function triggerHaptic(style = 'medium') {
      if (!state.hapticEnabled) return;
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
          const feedback=window.Telegram.WebApp.HapticFeedback;
          if(style==='selection' && typeof feedback.selectionChanged==='function')feedback.selectionChanged();
          else feedback.impactOccurred(style==='selection'?'light':style);
        } else if (navigator && typeof navigator.vibrate === 'function') {
          navigator.vibrate(style === 'heavy' ? 22 : style === 'light' ? 8 : 14);
        }
      } catch (_) {}
    }

    function showToast(msg) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.remove('opacity-0', '-translate-y-2', 'scale-95');
      el.classList.add('opacity-100', 'translate-y-0', 'scale-100');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.classList.add('opacity-0', '-translate-y-2', 'scale-95');
        el.classList.remove('opacity-100', 'translate-y-0', 'scale-100');
      }, 2400);
    }

    function animateDismiss(m, panel, onClosed) {
      if(m.classList.contains('hidden')||m._dismissMotion)return;
      const start=getComputedStyle(panel).transform;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      const originalAnimation=m.style.animation,originalBackground=m.style.backgroundColor;
      const background=getComputedStyle(m).backgroundColor;
      // A backdrop fade on the parent also fades its children. Keep the sheet opaque.
      m.style.animation='none';panel.style.animation='none';panel.style.transition='none';
      m.classList.add('is-closing');
      const finish=()=>{
        m.classList.add('hidden');m.classList.remove('is-open','is-closing');
        const active=m._dismissMotion;m._dismissMotion=null;active?.cancel();m._backdropMotion?.cancel();m._backdropMotion=null;
        m.style.animation=originalAnimation;m.style.backgroundColor=originalBackground;
        panel.style.animation='';panel.style.transition='';panel.style.transform='';panel.style.setProperty('--sheet-drag-y','0px');
        if(onClosed)onClosed();
      };
      if(typeof panel.animate!=='function'){finish();return;}
      const duration=reduced?1:360;
      if(m!==panel)m._backdropMotion=m.animate([{backgroundColor:background},{backgroundColor:'transparent'}],{duration,fill:'forwards'});
      const distance=Math.max(panel.getBoundingClientRect().height+24,innerHeight-panel.getBoundingClientRect().top+24);
      const motion=panel.animate([{transform:start==='none'?'translateY(0)':start},{transform:`translateY(${distance}px)`}],{duration,easing:'cubic-bezier(.32,.72,0,1)',fill:'forwards'});
      m._dismissMotion=motion;motion.onfinish=()=>{if(m._dismissMotion===motion)finish();};
    }
    window.TelefyDismissTransient=(element,panel=element)=>animateDismiss(element,panel,()=>{element.close?.();element.remove();});

    // Unified Bottom-Sheet Modal Controller (Telegram iOS Spring)
    function openSheetModal(modalOrId, haptic = 'light') {
      const m = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      if (!m) return;
      if(m._dismissMotion){m._dismissMotion.cancel();m._dismissMotion=null;}
      m._backdropMotion?.cancel();m._backdropMotion=null;m.style.animation='';
      if (m._closeTimer) {
        clearTimeout(m._closeTimer);
        m._closeTimer = null;
      }
      const panel = m.querySelector('.col-sheet-panel');
      if (panel) {
        panel.style.animation='';
        panel.style.setProperty('--sheet-drag-y', '0px');
        panel.style.transform = '';
        panel.style.transition = '';
      }
      m.style.opacity = '';
      m.style.transition = '';
      m.classList.remove('hidden', 'is-closing', 'is-open');
      void m.offsetWidth;
      m.classList.add('is-open');
      if (haptic) triggerHaptic(haptic);
    }

    function closeSheetModal(modalOrId, onClosed = null) {
      const m=typeof modalOrId==='string'?document.getElementById(modalOrId):modalOrId;
      if(!m)return;
      const panel=m.querySelector('.col-sheet-panel')||m.firstElementChild||m;
      if(panel)animateDismiss(m,panel,onClosed);
    }

    function updateSettingsUI() {
      const themeToggle = document.getElementById('toggle-theme');
      if (themeToggle) themeToggle.checked = state.theme === 'dark';
      const themeSub = document.getElementById('settings-theme-sub');
      if (themeSub) themeSub.textContent = state.theme === 'dark' ? t('settingsThemeDark') : t('settingsThemeLight');

      const langVal = document.getElementById('settings-lang-value');
      if (langVal) langVal.textContent = (state.lang === 'en' ? 'English' : 'Русский') + ' ›';

      const hqToggle = document.getElementById('toggle-high-quality');
      if (hqToggle) hqToggle.checked = state.highQuality;
      const hqSub = document.getElementById('settings-quality-sub');
      if (hqSub) hqSub.textContent = state.highQuality ? t('settingsQualityHigh') : t('settingsQualityStd');

      const hapticToggle = document.getElementById('toggle-haptic');
      if (hapticToggle) hapticToggle.checked = state.hapticEnabled;
    }

    function applyTranslations() {
      document.documentElement.lang = state.lang;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
      });
      const qaBotLabel = document.getElementById('qa-bot-label');
      if (qaBotLabel) qaBotLabel.innerHTML = t('qaBotHTML');
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.placeholder = t('searchPlaceholder');

      const modeText = state.playbackContext==='favorites'?{streamTitle:state.lang==='en'?'Favorites':'Любимое',shortDesc:state.lang==='en'?'Your saved tracks':'Твои сохранённые треки'}:getMoodText(state.activeMood);
      const homeTitle = document.getElementById('home-stream-title');
      if (homeTitle) homeTitle.textContent = modeText.streamTitle;
      const homeDesc = document.getElementById('home-stream-desc');
      if (homeDesc) homeDesc.textContent = modeText.shortDesc;

      const maxStatusEl = document.getElementById('max-status-text');
      const maxBtnEl = document.getElementById('btn-subscribe-max-label');
      if (maxStatusEl) maxStatusEl.textContent = state.isMaxSubscribed ? t('maxSubActive') : t('maxSubDefault');
      if (maxBtnEl) maxBtnEl.textContent = state.isMaxSubscribed ? t('maxBtnActive') : t('maxBtnDefault');

      updateSettingsUI();
    }

    function setTheme(theme) {
      if(!profileBgCustom)applyProfileGradient(theme==='light'?'white':'slate');
      state.theme = theme;
      document.body.classList.toggle('theme-light', theme === 'light');
      savePrefs();
      updateSettingsUI();
      renderMoodChips();
    }

    function setLanguage(lang) {
      state.lang = lang === 'en' ? 'en' : 'ru';
      savePrefs();
      applyTranslations();
      renderAll();
    }

    function startTimer() { if (playbackTimer) clearInterval(playbackTimer); }

    // Audio provider is intentionally disconnected while API credentials are pending.
    function syncRealAudio() {
      const audio = document.getElementById('telefy-audio');
      if (audio) audio.pause();
      if (state.isPlaying) {
        state.isPlaying = false;
        showToast(state.lang === 'en' ? 'Audio connection is pending' : 'Воспроизведение появится после подключения API');
      }
    }

    const playedFlowTrackIds = new Set();
    const playedFlowTrackKeys = new Set();
    const recentFlowHistoryIds = [];
    const flowPaginationByMood = {};
    let isSilentFlowFetching = false;

    function getMoodPagination(moodId) {
      const key = moodId || 'all';
      if (!flowPaginationByMood[key]) {
        flowPaginationByMood[key] = {
          cursor: 0,
          queryOffsets: {},
          visitedArtistIds: new Set(),
          relatedArtistPool: []
        };
      }
      return flowPaginationByMood[key];
    }

    function doesTrackMatchMood(tr, moodId) {
      const manual=['underground','night'].includes(state.activeMood)&&tr?.curatedTrend===true;
      if(!manual&&window.TelefyRapCandidate&&!window.TelefyRapCandidate(tr))return false;
      if(!manual&&window.TelefyPromotionExcluded?.(tr))return false;
      if(moodId==='underground'&&(tr?.trendsEligible!==true||!window.TelefyTrendMembership?.has(tr?.soundcloudUrn)))return false;
      if(moodId==='night')return tr?.curatedTrend===true&&Boolean(window.TelefyChillMembership?.has(tr?.soundcloudUrn));
      if(moodId==='underground'&&tr?.curatedTrend===true)return Boolean(window.TelefyTrendMembership?.has(tr?.soundcloudUrn));
      if(moodId==='energy')return tr?.classificationVersion===4&&Array.isArray(tr.modes)&&(tr.modes.includes('energy')||tr.modes.includes('uncensored'));
      if(moodId && moodId!=='all')return tr?.classificationVersion===4&&Array.isArray(tr.modes)&&tr.modes.includes(moodId);
      if (!tr) return false;
      const m = moodId || 'all';
      if (m === 'all') return true;
      if (m === 'uncensored') return Boolean(tr.uncensored) || tr.mood === 'uncensored';
      return tr.mood === m;
    }

    function getTrackUniqueKey(tr) {
      if (!tr) return '';
      return `${normalizeArtistToken(getPrimaryArtistName(tr.artist || ''))}::${normalizeTrackTitleKey(tr.title || '')}`;
    }

    function flowRecentWorkKey(tr) {
      const title=String(tr.title||'').toLowerCase().replace(/ё/g,'е').replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\s+(?:prod|feat|ft)\.?\s.*$/i,'').replace(/[^\p{L}\p{N}]/gu,'');
      const artist=window.TelefySceneArtist?.(tr.artist)?.name || getPrimaryArtistName(tr.artist||'');
      return normalizeArtistToken(artist)+'::'+title;
    }
    function flowRecentStorageKey(){return 'telefy_flow_recent_v3:'+String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||'browser');}
    function readFlowRecent(){try{return JSON.parse(localStorage.getItem(flowRecentStorageKey())||'{}')||{};}catch(_){return {};}}
    function flowWorkCoolingDown(tr){return Date.now()-(Number(readFlowRecent()[flowRecentWorkKey(tr)])||0)<24*60*60*1000;}
    function rememberFlowWork(tr){try{const recent=readFlowRecent();recent[flowRecentWorkKey(tr)]=Date.now();const entries=Object.entries(recent).filter(([,time])=>Date.now()-time<86400000).sort((a,b)=>b[1]-a[1]).slice(0,200);localStorage.setItem(flowRecentStorageKey(),JSON.stringify(Object.fromEntries(entries)));}catch(_){}}

    function isFlowTrackUnplayed(tr) {
      const manual=['underground','night'].includes(state.activeMood)&&tr?.curatedTrend===true;
      if(!manual&&window.TelefyRapCandidate&&!window.TelefyRapCandidate(tr))return false;
      if(!manual&&window.TelefyPromotionExcluded?.(tr))return false;
      if (!tr || !tr.id || tr.disliked) return false;
      if (tr.id === state.currentTrackId) return false;
      if(manual)return tr.id!==state.currentTrackId;
      if (flowWorkCoolingDown(tr)) return false;
      if (playedFlowTrackIds.has(tr.id)) return false;
      const k = getTrackUniqueKey(tr);
      if (k && playedFlowTrackKeys.has(k)) return false;
      return true;
    }

    function markFlowTrackPlayed(tr) {
      if (!tr || !tr.id) return;
      rememberFlowWork(tr);
      playedFlowTrackIds.add(tr.id);
      const k = getTrackUniqueKey(tr);
      if (k) {
        playedFlowTrackKeys.add(k);
      }
      const existingIdx = recentFlowHistoryIds.indexOf(tr.id);
      if (existingIdx !== -1) recentFlowHistoryIds.splice(existingIdx, 1);
      recentFlowHistoryIds.push(tr.id);
      if (recentFlowHistoryIds.length > 150) recentFlowHistoryIds.shift();
    }

    function getMyVibeTracksPool() {
      return tracks.filter(tr => {
        if (!tr || !tr.id || tr.disliked) return false;
        const k = getTrackUniqueKey(tr);
        return userListenedTrackIds.has(tr.id) || (k && userListenedTrackKeys.has(k));
      });
    }

    function isMyVibeStreamActive() {
      const lbl = (state.sourceLabel || '').trim();
      return lbl === 'Мой вайб' || lbl === 'My Vibe';
    }

    function interleaveByArtist(list) {
      const priority=new Set(["rmw", "anonymous ember", "tuborosho", "huzzy b", "fckshiza", "fortuna 812", "madk1d", "темный принц", "kai angel", "9mice", "clout", "cupsize", "code10", "королевский", "nanmas", "fakemutin", "олег кавказ", "ivycraft", "главный герой", "хулагу 3g", "3goth2002", "akiko!", "code80", "greyrock", "tewiq", "3umph"]);
      const key=tr=>normalizeArtistToken(findRosterConfig(tr.primaryArtist||getPrimaryArtistName(tr.artist))?.name||tr.primaryArtist||getPrimaryArtistName(tr.artist));
      const groups=new Map(),seen=new Set();
      for(const tr of list){if(!tr?.id)continue;const k=getTrackUniqueKey(tr);if(seen.has(k))continue;seen.add(k);const a=key(tr);if(!groups.has(a))groups.set(a,[]);groups.get(a).push(tr);}
      for(const bucket of groups.values())for(let i=bucket.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bucket[i],bucket[j]]=[bucket[j],bucket[i]];}
      const recent=recentFlowHistoryIds.slice(-3).map(id=>tracks.find(t=>t.id===id)).filter(Boolean).map(key);
      const out=[];
      while(groups.size){
        let choices=[...groups.keys()].filter(a=>!recent.includes(a));
        if(!choices.length)choices=[...groups.keys()].filter(a=>a!==recent.at(-1));
        if(!choices.length)choices=[...groups.keys()];
        const weights=choices.map(a=>priority.has(a)?2:1);let draw=Math.random()*weights.reduce((a,b)=>a+b,0),selected=choices[choices.length-1];
        for(let i=0;i<choices.length;i++){draw-=weights[i];if(draw<0){selected=choices[i];break;}}
        const bucket=groups.get(selected);out.push(bucket.shift());if(!bucket.length)groups.delete(selected);
        recent.push(selected);if(recent.length>3)recent.shift();
      }
      return out;
    }

    function isFlowStreamActive() {
      if(window.TelefyOrderedQueue?.active)return false;
      const lbl = (state.sourceLabel || '').trim();
      if (!lbl) return true;
      for (const langKey of Object.keys(MOOD_I18N)) {
        const map = MOOD_I18N[langKey];
        for (const mKey of Object.keys(map)) {
          if (map[mKey].streamTitle === lbl) return true;
        }
      }
      return lbl === 'Мой поток' || lbl === 'My Flow';
    }

    // Playback navigation is independent of catalog ordering and recommendation history.
    const playbackHistory = { entries: [], index: -1 };
    function recordPlaybackSelection(id, sourceLabel) {
      if (!tracks.some(track => track.id === id)) return;
      const current = playbackHistory.entries[playbackHistory.index];
      playbackHistory.entries.splice(playbackHistory.index + 1);
      if (current?.id === id) { current.sourceLabel = sourceLabel; return; }
      playbackHistory.entries.push({ id, sourceLabel });
      if (playbackHistory.entries.length > 150) playbackHistory.entries.shift();
      playbackHistory.index = playbackHistory.entries.length - 1;
    }
    function ensurePlaybackHistoryCurrent() {
      if (playbackHistory.entries[playbackHistory.index]?.id !== state.currentTrackId) {
        recordPlaybackSelection(state.currentTrackId, state.sourceLabel);
      }
    }
    function navigatePlaybackHistory(direction) {
      let index = playbackHistory.index + direction;
      while (index >= 0 && index < playbackHistory.entries.length) {
        const entry = playbackHistory.entries[index];
        if (tracks.some(track => track.id === entry.id)) {
          playbackHistory.index = index;
          playTrack(entry.id, entry.sourceLabel, { fromHistory:true });
          return true;
        }
        index += direction;
      }
      return false;
    }
    function getUpcomingPlaybackIds() {
      if(window.TelefyOrderedQueue?.active)return window.TelefyOrderedQueue.upcoming;
      const future = playbackHistory.entries.slice(playbackHistory.index + 1).map(entry => entry.id);
      return [...new Set([...future, ...(state.queueIds || [])])]
        .filter(id => id !== state.currentTrackId && tracks.some(track => track.id === id));
    }

    function playTrack(id, sourceLabel = 'Мой поток', options = {}) {
      if (!tracks.some(track => track.id === id)) return;
      if (!options.fromHistory) recordPlaybackSelection(id, sourceLabel);
      state.currentTrackId = id;
      state.progressSec = 0;
      state.isPlaying = true;
      state.sourceLabel = sourceLabel;
      if(['Библиотека','Любимые треки','Любимое','Library','Favorite tracks','Favorites'].includes(sourceLabel)){
        window.TelefyFirstRun?.cancel();state.playbackContext='favorites';state.activeMood='all';
        state.sourceLabel=state.lang==='en'?'Favorites':'Любимое';flowModeIndex=0;
        document.getElementById('home-stream-title').textContent=state.sourceLabel;
        document.getElementById('home-stream-desc').textContent=state.lang==='en'?'Your saved tracks':'Твои сохранённые треки';
        renderMoodChips();
      }else state.playbackContext=null;

      if(options.orderedSource)state.playbackContext=options.orderedSource;
      const tr = getTrack(id);
      if (tr && tr.id) {
        markFlowTrackPlayed(tr);
        if (!options.fromHistory) {
          state.queueIds = (state.queueIds || []).filter(qid => qid !== tr.id);
          if (isFlowStreamActive() && state.queueIds.length <= 8) {
            silentlyRefillFlowQueue(false);
          }
        }
      }
      if (tr && !tr.coverImg && tr.coverStatus === 'idle') ensureTrackCover(tr, false);
      syncRealAudio(true);
      startTimer();
      renderAll();
    }

    function togglePlay() {
      state.isPlaying = !state.isPlaying;
      syncRealAudio(false);
      if (state.isPlaying) {
        ensurePlaybackHistoryCurrent();
        const cur = getTrack(state.currentTrackId);
        if (cur && cur.id) markFlowTrackPlayed(cur);
        startTimer();
      }
      renderPlayerUI();
    }

    function pickLeastRecentMoodFallback(moodId) {
      const recentWindow = new Set(recentFlowHistoryIds.slice(-30));
      let pool = tracks.filter(tr =>
        tr && tr.id !== state.currentTrackId && !tr.disliked &&
        doesTrackMatchMood(tr, moodId) && !recentWindow.has(tr.id)
      );
      if (!pool.length) {
        const tinyWindow = new Set(recentFlowHistoryIds.slice(-6));
        pool = tracks.filter(tr =>
          tr && tr.id !== state.currentTrackId && !tr.disliked &&
          doesTrackMatchMood(tr, moodId) && !tinyWindow.has(tr.id)
        );
      }
      if (!pool.length && (!moodId || moodId==='all')) {
        pool = tracks.filter(tr => tr && tr.id !== state.currentTrackId && !tr.disliked);
      }
      if (!pool.length) return null;
      pool.sort((a, b) => recentFlowHistoryIds.indexOf(a.id) - recentFlowHistoryIds.indexOf(b.id));
      return pool[0];
    }

    function playNext(fromTrackEnd = false) {
      if(state.playbackContext==='favorites'){
        if(fromTrackEnd&&isRepeat){playTrack(state.currentTrackId,state.sourceLabel,{fromHistory:true});return;}
        const eligible=tracks.filter(t=>t.liked&&!t.disliked),ids=new Set(eligible.map(t=>t.id));
        state.queueIds=(state.queueIds||[]).filter(id=>ids.has(id)&&id!==state.currentTrackId);
        const next=state.queueIds.shift();
        if(next){playTrack(next,state.sourceLabel);return;}
        state.isPlaying=false;syncRealAudio();renderPlayerUI();return;
      }

      if(window.TelefyRecommendations?.active())return window.TelefyRecommendations.next(fromTrackEnd);
      if (fromTrackEnd && isRepeat) {
        playTrack(state.currentTrackId, state.sourceLabel, { fromHistory:true });
        return;
      }
      if (!tracks.length) return;

      ensurePlaybackHistoryCurrent();
      if (navigatePlaybackHistory(1)) return;

      if (isMyVibeStreamActive()) {
        const vibePool = getMyVibeTracksPool();
        const validVibeQueue = (state.queueIds || []).filter(id => vibePool.some(v => v.id === id));
        if (validVibeQueue.length > 0) {
          const nextVibeId = validVibeQueue.shift();
          state.queueIds = validVibeQueue;
          playTrack(nextVibeId, state.sourceLabel);
          return;
        }
        const otherVibe = vibePool.filter(v => v.id !== state.currentTrackId);
        const loopPool = otherVibe.length > 0 ? otherVibe : vibePool;
        if (loopPool.length > 0) {
          const shuffledVibe = [...loopPool].sort(() => Math.random() - 0.5);
          state.queueIds = shuffledVibe.slice(1).map(t => t.id);
          playTrack(shuffledVibe[0].id, state.sourceLabel);
          return;
        }
      }
      const flowActive = isFlowStreamActive();
      const moodId = state.activeMood || 'all';
      if (flowActive) {
        state.queueIds = (state.queueIds || []).filter(id => {
          const tr = tracks.find(x => x.id === id);
          return tr && isFlowTrackUnplayed(tr) && doesTrackMatchMood(tr, moodId);
        });
      }

      if (isShuffle) {
        const qPool = (state.queueIds || []).filter(id => id !== state.currentTrackId);
        const unplayedPool = tracks
          .filter(tr => isFlowTrackUnplayed(tr) && (!flowActive || doesTrackMatchMood(tr, moodId)))
          .map(tr => tr.id);
        const candidates = qPool.length > 0 ? qPool : unplayedPool;
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          state.queueIds = (state.queueIds || []).filter(id => id !== pick);
          playTrack(pick, state.sourceLabel);
          if (flowActive && state.queueIds.length <= 8) silentlyRefillFlowQueue(false);
          return;
        }
      }

      if (state.queueIds.length > 0) {
        const nextId = state.queueIds.shift();
        playTrack(nextId, state.sourceLabel);
        if (flowActive && state.queueIds.length <= 8) silentlyRefillFlowQueue(false);
        return;
      }

      const unplayedMatching = interleaveByArtist(
        tracks.filter(tr => isFlowTrackUnplayed(tr) && doesTrackMatchMood(tr, moodId))
      );
      const fallbackUnplayed = flowActive&&moodId==='underground'?unplayedMatching:unplayedMatching.length > 0
        ? unplayedMatching
        : interleaveByArtist(tracks.filter(tr => isFlowTrackUnplayed(tr)));

      if (fallbackUnplayed.length > 0) {
        const nextTrack = fallbackUnplayed[0];
        state.queueIds = fallbackUnplayed.slice(1, 14).map(t => t.id);
        playTrack(nextTrack.id, state.sourceLabel);
        if (flowActive) silentlyRefillFlowQueue(false);
      } else if (!flowActive) {
        const leastRecent = pickLeastRecentMoodFallback('all');
        if (leastRecent) playTrack(leastRecent.id, state.sourceLabel);
      } else {
        // Trigger background fetch for more mood tracks and immediately advance to least-recently-played mood track so UI never stalls
        if(moodId==='underground'){if(window.TelefyTrendContinuation?.activate())return;silentlyRefillFlowQueue(true);return;}
        silentlyRefillFlowQueue(false);
        const immediate = pickLeastRecentMoodFallback(moodId);
        if (immediate) playTrack(immediate.id, state.sourceLabel);
      }
    }

    function playPrev() {
      if (!tracks.length) return;
      ensurePlaybackHistoryCurrent();
      if (navigatePlaybackHistory(-1)) return;
      // At the beginning of history, restart the actual audio rather than the UI timer.
      playTrack(state.currentTrackId, state.sourceLabel, { fromHistory:true });
    }

    function triggerLikeAnim(el, isLiked) {
      if (!el) return;
      el.classList.remove('anim-like-pop', 'anim-like-unpop');
      void el.offsetWidth;
      el.classList.add(isLiked ? 'anim-like-pop' : 'anim-like-unpop');
    }

    async function toggleLike(id) {
      if(!window.TelefyLibrary?.ready){showToast('Подключаем библиотеку. Повтори через несколько секунд.');window.TelefyLibrary?.restore();return;}
      triggerHaptic('light');
      const tr = getTrack(id);
      tr.liked = !tr.liked;
      const k = getTrackUniqueKey(tr);
      if (k) {
        if (tr.liked) userLikedTrackKeys.add(k);
        else userLikedTrackKeys.delete(k);
        if(!await saveUserLikedKeys())return;
      }
      saveParsedCatalogCache();
      showToast(tr.liked ? `${t('toastSaved')}: ${tr.title}` : t('toastRemoved'));

      // Update all heart buttons for this track in-place across all views & open modals (zero DOM flash)
      document.querySelectorAll(`[data-like="${id}"]`).forEach(btn => {
        btn.classList.toggle('text-[#FF3B30]', tr.liked);
      btn.setAttribute('aria-pressed', String(tr.liked));
        btn.classList.toggle('text-muted', !tr.liked);
        btn.classList.toggle('opacity-40', !tr.liked);
        btn.classList.toggle('hover:opacity-80', !tr.liked);
        btn.innerHTML = `<span class="tg-ico text-[16px]">${tr.liked ? '&#xF016;' : '&#xF1D9;'}</span>`;
        triggerLikeAnim(btn, tr.liked);
      });

      if (id === state.currentTrackId) {
        renderPlayerUI();
        triggerLikeAnim(document.getElementById('full-like-btn'), tr.liked);
        triggerLikeAnim(document.getElementById('mini-like-btn'), tr.liked);
      }

      if (state.searchFilter === 'liked') {
        renderSearchView();
      }

      // If unliked while Library Modal is open, animate row removal smoothly before re-rendering
      const libModal = document.getElementById('library-modal');
      const libList = document.getElementById('library-modal-tracks');
      const rowInLib = (!tr.liked && libModal && !libModal.classList.contains('hidden') && libList)
        ? libList.querySelector(`[data-like="${id}"]`)?.closest('.tg-row')
        : null;

      if (rowInLib) {
        rowInLib.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease';
        rowInLib.style.transform = 'translateX(-16px) scale(0.96)';
        rowInLib.style.opacity = '0';
        setTimeout(() => {
          renderMaxBetaView();
        }, 210);
      } else {
        renderMaxBetaView();
      }
    }

    function switchTab(tab) {
      const prevTab = state.activeTab;
      state.activeTab = tab;
      const order = ['home', 'flow', 'search', 'mytelefy','favorites'];
      if (prevTab !== tab) {
        order.forEach(t => {
          const sec = document.getElementById(`view-${t}`);
          const isTarget = t === tab;
          sec.classList.toggle('hidden', !isTarget);
          if (isTarget) {
            sec.classList.remove('view-entering');
            void sec.offsetWidth;
            sec.classList.add('view-entering');
          }
        });
      }
      if (prevTab !== tab) triggerHaptic('selection');
      const idx = Math.max(0, order.indexOf(tab==='favorites'?'mytelefy':tab));
      const lens = document.getElementById('tab-active-lens');
      if (lens) lens.style.transform = `translateX(${idx * 100}%)`;

      document.querySelectorAll('.nav-tab').forEach(btn => {
        const active = btn.dataset.tab === (tab==='favorites'?'mytelefy':tab);
        btn.classList.toggle('active-glass', active);
        if (active) {
          btn.classList.remove('tab-bouncing');
          void btn.offsetWidth;
          btn.classList.add('tab-bouncing');
        }
      });
    }

    function applyStreamMode(moodId, autoPlay = true) {
      if(moodId!=='underground')window.TelefyFirstRun?.cancel();
      if(moodId==='uncensored')moodId='energy';
      const idx = MOODS.findIndex(m => m.id === moodId);
      const safeIdx = idx >= 0 ? idx : 0;
      const mode = MOODS[safeIdx];
      const modeText = getMoodText(mode.id);
      window.TelefyOrderedQueue?.clear();state.playbackContext=null;
      state.activeMood = mode.id;
      flowModeIndex = safeIdx;
      state.sourceLabel = modeText.streamTitle;

      // Sync Home title & short gray description
      const homeTitle = document.getElementById('home-stream-title');
      if (homeTitle) homeTitle.textContent = modeText.streamTitle;
      const homeDesc = document.getElementById('home-stream-desc');
      if (homeDesc) homeDesc.textContent = modeText.shortDesc;

      // Sync Flow title & mode card
      renderFlowMode();

      const matchingUnplayed = interleaveByArtist(
        tracks.filter(t => isFlowTrackUnplayed(t) && doesTrackMatchMood(t, mode.id))
      );
      const pool = matchingUnplayed;
      state.queueIds = pool.length > 0 ? pool.slice(1, 16).map(t => t.id) : [];
      if (pool.length > 0) {
        if (autoPlay) {
          playTrack(pool[0].id, modeText.streamTitle);
        }
      } else if (autoPlay) {
        if(mode.id!=='all'&&!doesTrackMatchMood(getTrack(state.currentTrackId),mode.id)){state.isPlaying=false;syncRealAudio();}
        const fallback = pickLeastRecentMoodFallback(mode.id);
        if (fallback) playTrack(fallback.id, modeText.streamTitle);
      }
      if (state.queueIds.length < 10) {
        silentlyRefillFlowQueue(pool.length === 0 && autoPlay);
      }
      renderMoodChips();
      renderPlayerUI();
    }

    function renderMoodChips() {
      const container = document.getElementById('home-mood-chips');
      if (!container.querySelector('.mood-active-lens')) {
        const lens = document.createElement('span');
        lens.className = 'mood-active-lens'; lens.setAttribute('aria-hidden', 'true'); container.append(lens);
        MOODS.filter(m => !m.hideChip).forEach(m => {
          const button = document.createElement('button');
          button.type = 'button'; button.dataset.mood = m.id; button.className = 'mood-chip';
          button.addEventListener('click', () => {
            triggerHaptic('light'); applyStreamMode(m.id, true);
          });
          container.append(button);
        });
        new ResizeObserver(positionMoodLens).observe(container);
      }
      container.querySelectorAll('.mood-chip').forEach(btn => {
        const codes={energy:'F053',night:'F1D3',uncensored:'F06C',underground:'F01B'};btn.innerHTML=`<span class="tg-ico" aria-hidden="true">${btn.dataset.mood==='night'?'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.9 13.4A8.7 8.7 0 0 1 10.6 3.1a.7.7 0 0 0-.9-.8A10 10 0 1 0 21.7 14.3a.7.7 0 0 0-.8-.9Z"/></svg>':String.fromCodePoint(parseInt(codes[btn.dataset.mood],16))}</span><span>${getMoodText(btn.dataset.mood).label}</span>`;
        btn.setAttribute('aria-pressed', String(state.activeMood === btn.dataset.mood));
      });
      requestAnimationFrame(positionMoodLens);
    }
    function positionMoodLens() {
      const container = document.getElementById('home-mood-chips');
      const lens = container?.querySelector('.mood-active-lens'); if (!lens) return;
      const selected = container.querySelector('[aria-pressed="true"]');
      lens.style.opacity = selected ? '1' : '0';
      if (selected) {
        lens.style.width = `${selected.offsetWidth}px`;
        lens.style.transform = `translate3d(${selected.offsetLeft - 4}px,0,0)`;
      }
    }

    function getCollectionCoverUrl(col) {
      if (col.coverImg && col.coverImg.startsWith('http')) return col.coverImg;
      for (const tid of (col.trackIds || [])) {
        const tr = tracks.find(x => x.id === tid);
        if (tr && tr.coverImg) return tr.coverImg;
      }
      return null;
    }

    function renderCollections() {
      const container = document.getElementById('collections-carousel');
      if (!container) return;
      container.innerHTML = COLLECTIONS.map(col => {
        const cText = getColText(col);
        const coverUrl = getCollectionCoverUrl(col);
        const isColLoading = !coverUrl && state.isCatalogParsing;
        return `
        <div data-col="${col.id}" class="col-card shrink-0 w-[144px] cursor-pointer active:scale-[0.98] transition">
          <div data-collection-cover="${col.id}" class="w-[144px] h-[144px] squircle-cover-md mb-2 flex flex-col justify-between p-3 shadow-sm relative overflow-hidden bg-cover bg-center bg-no-repeat ${isColLoading ? 'cover-loading' : ''}" style="background-color: ${col.cover}; ${coverUrl ? `background-image: url('${coverUrl}')` : ''}">
            ${renderCoverImgTag(coverUrl)}
            <div class="absolute inset-0 z-[5] bg-gradient-to-t from-black/80 via-black/20 to-black/25 pointer-events-none"></div>
            <span class="relative z-10 w-9 h-9 squircle rounded-xl bg-black/35 backdrop-blur-sm flex items-center justify-center text-white">
              ${col.icon}
            </span>
            <span class="relative z-10 font-rounded text-[13px] text-white leading-tight drop-shadow">${cText.title}</span>
          </div>
          <p class="text-[13px] font-semibold truncate">${cText.title}</p>
          <p class="text-[11px] text-muted line-clamp-2 leading-snug mt-0.5">${col.artists}</p>
        </div>
      `;
      }).join('');

      container.querySelectorAll('.col-card').forEach(card => {
        card.addEventListener('click', () => openCollectionModal(card.dataset.col));
      });
    }

    function escapeTrackText(value) {
      return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    }
    function createTrackRowHTML(t) {
      t = { ...t, title:escapeTrackText(t.title), artist:escapeTrackText(t.artist), album:escapeTrackText(t.album) };
      const isCurrent = t.id === state.currentTrackId;
      const isLoading = !t.coverImg && t.coverStatus === 'loading';
      const subMeta = t.album ? `${t.artist} · ${t.album}` : t.artist;
      return `
        <div class="tg-row gap-3">
          <div data-play="${t.id}" class="track-play-trigger flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
            <div data-track-cover="${t.id}" class="w-11 h-11 squircle-cover-sm shrink-0 flex items-center justify-center text-white text-xs font-bold bg-cover bg-center bg-no-repeat relative overflow-hidden ${isLoading ? 'cover-loading' : ''}" style="background-color: ${t.cover || '#1E3A8A'}; ${t.coverImg ? `background-image: url('${t.coverImg}')` : ''}">
              ${renderCoverImgTag(t.coverImg)}
              <span class="cover-fallback-glyph relative z-10 text-[13px] opacity-80 ${t.coverImg ? 'hidden' : ''}">♫</span>
              <span data-track-playback="${t.id}" class="track-playback-overlay" style="display:${isCurrent ? 'flex' : 'none'}" aria-hidden="true"><span class="tg-ico">${state.isPlaying ? '&#xF14F;' : '&#xF148;'}</span></span>
            </div>
            <div class="min-w-0 flex-1">
              <p data-track-row-title="${t.id}" class="text-[14px] font-medium ${isCurrent ? 'text-[#2AABEE]' : ''} truncate">${t.title}</p>
              <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span class="telefy-explicit" title="Может содержать ненормативную лексику" aria-label="Возможна ненормативная лексика">E</span>
                <p class="text-xs text-muted truncate">${subMeta}</p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs text-muted">${formatTime(t.duration)}</span>
            <button data-like="${t.id}" class="track-like-btn p-1 rounded-full ${t.liked ? 'text-[#FF3B30]' : 'text-muted opacity-40 hover:opacity-80'} transition"><span class="tg-ico text-[16px]">${t.liked ? '&#xF016;' : '&#xF1D9;'}</span></button>
          </div>
        </div>
      `;
    }

    function bindTrackRowEvents(container, sourceLabelOverride = null) {
      if (!container) return;
      container.querySelectorAll('.track-play-trigger').forEach(el => {
        el.addEventListener('click', () => {
          const id=Number(el.dataset.play);
          if(el.closest('#library-modal')){const ids=[...container.querySelectorAll('.track-play-trigger')].map(n=>Number(n.dataset.play));window.TelefyOrderedQueue.start(ids,id,state.lang==='en'?'Favorites':'Любимое','favorites');return;}
          if(el.closest('#collection-modal')&&state.activeCollectionId!=='recommendations'){
            const source=USER_PLAYLISTS.find(p=>p.id===state.activeCollectionId)||COLLECTIONS.find(p=>p.id===state.activeCollectionId);
            if(source){window.TelefyOrderedQueue.start(source.trackIds,id,sourceLabelOverride||source.title,'playlist');return;}
          }
          if(el.closest('#search-results-list')){
            const ids=[...document.querySelectorAll('#search-results-list .track-play-trigger')].map(n=>Number(n.dataset.play));
            window.TelefyOrderedQueue.start(ids,id,state.lang==='en'?'Search':'Поиск','search');return;
          }
          playTrack(id,sourceLabelOverride||t('catalogSource'));
        });
      });
      container.querySelectorAll('.track-like-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLike(Number(btn.dataset.like));
        });
      });
      observeTrackCovers(container);
    }

    function getCatalogErrorText() {
      if(state.catalogError==='session_expired')return state.lang==='en'?'Your session expired. Reopen the app.':'Сессия истекла. Открой приложение заново.';
      if (['soundcloud_forbidden','soundcloud_geo_blocked'].includes(state.catalogError)) {
        return state.lang==='en'?'The catalog is unavailable from this network.':'Каталог недоступен из текущей сети.';
      }
      return state.lang==='en'?'The catalog is temporarily unavailable. Try again.':'Каталог временно недоступен. Попробуй ещё раз.';
    }
    function renderHomeTracks() {
      const container = document.getElementById('home-tracks-list');
      if (!container) return;
      const uncensoredList = tracks.filter(t => t.uncensored);
      const displayPool = uncensoredList.length ? uncensoredList : tracks;
      const totalEl = document.getElementById('home-uncut-total');
      if (totalEl) {
        totalEl.textContent = tracks.length
          ? `${t('tracksCount')}: ${displayPool.length}`
          : (state.isCatalogParsing ? (state.lang === 'en' ? 'Loading...' : 'Загрузка...') : '');
      }
      if (!displayPool.length) {
        if (!state.isCatalogParsing) {
          container.innerHTML = `<div class="catalog-empty-state"><p>${state.catalogError ? getCatalogErrorText() : (state.lang==='en'?'No tracks yet':'Пока нет треков')}</p><button type="button" class="catalog-retry">${state.lang==='en'?'Try again':'Попробовать снова'}</button></div>`;
          container.querySelector('.catalog-retry').addEventListener('click',()=>window.TelefySoundCloud.initialize());
          return;
        }
        container.innerHTML = window.TelefySkeleton.html();
        return;
      }
      container.innerHTML = displayPool.slice(0, 12).map(createTrackRowHTML).join('');
      bindTrackRowEvents(container);
    }

    let flowModeIndex = MOODS.findIndex(m=>m.id==='underground');

    function renderFlowMode() {
      const mode = MOODS[flowModeIndex] || MOODS[0];
      const modeText = getMoodText(mode.id);
      document.getElementById('flow-mode-label').textContent = modeText.label;
      document.getElementById('flow-mode-subtitle').textContent = modeText.shortDesc || mode.shortDesc;
      document.getElementById('flow-mode-card').dataset.mode = mode.id;
      if (isMyVibeStreamActive()) {
        document.getElementById('flow-stream-name').textContent = state.lang === 'en' ? 'My Vibe' : 'Мой вайб';
      } else if (state.sourceLabel === 'Вперемешку' || state.sourceLabel === 'Shuffle') {
        document.getElementById('flow-stream-name').textContent = state.lang === 'en' ? 'Shuffle' : 'Вперемешку';
      } else {
        document.getElementById('flow-stream-name').textContent = modeText.streamTitle;
      }
      const iconMode = ['all','uncensored','night','energy','underground'].includes(mode.id) ? mode.id : 'all';
      const attributes={all:['F0BF','F15D','F127','F143','F01B'],energy:['F053','F26A','F06C','F284','F143'],night:['F283','F126','F0BF','F143','F15D'],uncensored:['F06C','F01B','F053','F284','F15D'],underground:['F152','F143','F114','F06C','F0BF']};
      const symbols=attributes[mode.id]||attributes.all;
      const modeIcon=document.getElementById('flow-mode-icon');if(mode.id==='night'){modeIcon.innerHTML='<svg width="25" height="25" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.9 13.4A8.7 8.7 0 0 1 10.6 3.1a.7.7 0 0 0-.9-.8A10 10 0 1 0 21.7 14.3a.7.7 0 0 0-.8-.9Z"/></svg>';}else modeIcon.textContent=String.fromCodePoint(parseInt(symbols[0],16));
      const pattern=document.querySelector('#flow-mode-card .flow-mode-pattern');
      pattern.innerHTML=symbols.map(code=>`<span class="tg-ico">${String.fromCodePoint(parseInt(code,16))}</span>`).join('');

    }

    function createSimpleQueueRowHTML(t) {
      t = { ...t, title:escapeTrackText(t.title), artist:escapeTrackText(t.artist), album:escapeTrackText(t.album) };
      const subMeta = t.album ? `${t.artist} · ${t.album}` : t.artist;
      return `
        <div data-play="${t.id}" class="tg-row track-play-trigger gap-3 cursor-pointer">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div data-track-cover="${t.id}" class="w-10 h-10 squircle-cover-sm shrink-0 flex items-center justify-center text-white text-[11px] font-bold bg-cover bg-center bg-no-repeat relative overflow-hidden" style="background-color: ${t.cover || '#1E3A8A'}; ${t.coverImg ? `background-image: url('${t.coverImg}')` : ''}">
              ${renderCoverImgTag(t.coverImg)}
              <span class="cover-fallback-glyph relative z-10 text-[11px] opacity-80 ${t.coverImg ? 'hidden' : ''}">♫</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-medium truncate">${t.title}</p>
              <p class="text-xs text-muted truncate">${subMeta}</p>
            </div>
          </div>
        </div>
      `;
    }

    function renderFlowView() {
      const current = getTrack(state.currentTrackId);
      renderFlowMode();

      const queueContainer = document.getElementById('flow-queue-list');
      const moodId = state.activeMood || 'all';
      const queueTracks = getUpcomingPlaybackIds().slice(0, 8).map(id => tracks.find(x => x.id === id)).filter(Boolean);
      const fallbackQueue = queueTracks.length
        ? queueTracks
        : (isMyVibeStreamActive()
            ? getMyVibeTracksPool().filter(x => x.id !== current.id).slice(0, 8)
            : interleaveByArtist(tracks.filter(x => x.id !== current.id && !x.disliked && doesTrackMatchMood(x, moodId))).slice(0, 8));
      queueContainer.innerHTML = fallbackQueue.map(createSimpleQueueRowHTML).join('');
      bindTrackRowEvents(queueContainer, state.sourceLabel);
    }

    let searchDebounceTimer = null;
    let searchDisplayLimit = 40;
    const searchPagination = { query: '', nextIndex: 0, hasMore: true, loading: false };
    const libraryBrowsePagination = { rosterIdx: 0, chartIndex: 0, queryIdx: 0, queryOffset: 0, loading: false, hasMore: true };

    function doesTrackMatchSearchQuery(tr, rawQuery) {
      const hint=window.TelefySearchAliases;if(hint?.query===rawQuery&&hint.artists?.some(a=>doesArtistMatch(tr.artist,a)))return true;
      if (!tr) return false;
      const q = (rawQuery || '').trim().toLowerCase().replace(/ё/g, 'е');
      if (!q) return true;
      const titleNorm = (tr.title || '').toLowerCase().replace(/ё/g, 'е');
      const artistNorm = (tr.artist || '').toLowerCase().replace(/ё/g, 'е');
      const albumNorm = (tr.album || '').toLowerCase().replace(/ё/g, 'е');
      if (titleNorm.includes(q) || artistNorm.includes(q) || albumNorm.includes(q)) return true;

      // Also match Russian <-> English artist aliases from RUSSIAN_RAP_ROSTER
      for (const cfg of RUSSIAN_RAP_ROSTER) {
        const aliases = [cfg.name, ...(cfg.aliases || [])].map(a => a.toLowerCase().replace(/ё/g, 'е'));
        if (aliases.some(a => a.includes(q) || q.includes(a))) {
          if (doesArtistMatch(tr.artist, cfg)) return true;
        }
      }
      return false;
    }

    function getFilteredSearchTracks() {
      const q = state.searchQuery.trim();
      return tracks.filter(t => {
        if (window.TelefySoundCloud?.ready && q.length>=2 && !t.soundcloudUrn) return false;
        const matchesQuery = doesTrackMatchSearchQuery(t, q);
        const matchesFilter =
          ['all','tracks','artists','albums'].includes(state.searchFilter) ||
          (state.searchFilter === 'uncensored' && t.uncensored) ||
          (state.searchFilter === 'liked' && t.liked);
        return matchesQuery && matchesFilter;
      });
    }

    function positionSearchFilterLens() {
      const container = document.getElementById('search-filter-chips');
      const lens = container.querySelector('.search-filter-lens');
      const selected = container.querySelector('[aria-pressed="true"]');
      if (!lens || !selected || !container.offsetWidth) return;
      lens.style.width = `${selected.offsetWidth}px`;
      lens.style.transform = `translate3d(${selected.offsetLeft - 4}px,0,0)`;
      if (!container.classList.contains('lens-ready')) {
        // Establish the first position before enabling travel animations.
        void lens.offsetWidth;
        container.classList.add('lens-ready');
      }
    }

    function renderSearchView() {
      if(state.searchFilter==='uncensored')state.searchFilter='all';
      if (state.searchFilter === 'liked' && !state.isMaxSubscribed) state.searchFilter = 'all';
      const filters = [
        { id: 'all', label: state.lang==='en'?'All':'Все' },
        { id: 'tracks', label: state.lang==='en'?'Tracks':'Треки' },
        { id: 'artists', label: state.lang==='en'?'Artists':'Артисты' },
        { id: 'albums', label: state.lang==='en'?'Albums':'Альбомы' }
      ];
      const filterContainer = document.getElementById('search-filter-chips');
      if (!filterContainer.querySelector('.search-filter-lens')) {
        const lens = document.createElement('span');
        lens.className = 'search-filter-lens';
        lens.setAttribute('aria-hidden', 'true');
        filterContainer.append(lens);
        filters.forEach(f => {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.dataset.sfilter = f.id;
          btn.className = 'sfilter-btn native-search-filter';
          btn.addEventListener('click', () => {
            if (btn.dataset.sfilter === 'liked' && !state.isMaxSubscribed) {
              openUpsellModal();
              return;
            }
            if (state.searchFilter === btn.dataset.sfilter) return;
            triggerHaptic('light');
            state.searchFilter = btn.dataset.sfilter;
            searchDisplayLimit = 40;
            renderSearchView();
          });
          filterContainer.append(btn);
        });
        new ResizeObserver(positionSearchFilterLens).observe(filterContainer);
      }
      filterContainer.querySelectorAll('.sfilter-btn').forEach(btn => {
        btn.textContent = filters.find(f => f.id === btn.dataset.sfilter).label;
        btn.setAttribute('aria-pressed', String(state.searchFilter === btn.dataset.sfilter));
      });
      requestAnimationFrame(positionSearchFilterLens);

      const q = state.searchQuery.trim().toLowerCase();
      const filtered = getFilteredSearchTracks();

      const resContainer = document.getElementById('search-results-list');
      resContainer.classList.toggle('search-is-empty', filtered.length === 0);
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'native-search-empty';
        if (state.isCatalogParsing || (q.length >= 2 && state.isSearchParsing)) {
          empty.className='';empty.innerHTML=window.TelefySkeleton.html();
        } else if (state.catalogError) {
          empty.textContent=getCatalogErrorText();
        } else {
          empty.textContent = state.searchFilter === 'liked' && !state.searchQuery.trim()
            ? (state.lang === 'en' ? 'Tracks you like will appear here' : 'Здесь появятся треки, которые ты добавишь в любимое')
            : (state.searchQuery.trim() ? `${t('searchEmpty')} «${state.searchQuery}»` : (state.lang === 'en' ? 'Find a track, artist or album' : 'Найди трек, исполнителя или альбом'));
        }
        resContainer.replaceChildren(empty);resContainer._searchRows=[];resContainer.classList.add('search-was-empty');
      } else {
        const slice = filtered.slice(0, searchDisplayLimit);
        const rows=slice.map(createTrackRowHTML),previous=resContainer._searchRows||[];
        if(previous.length<=rows.length&&previous.every((html,i)=>html===rows[i])&&!resContainer.classList.contains('search-was-empty')){
          const template=document.createElement('template');template.innerHTML=rows.slice(previous.length).join('');
          bindTrackRowEvents(template.content);resContainer.append(template.content);
        }else{resContainer.innerHTML=rows.join('');bindTrackRowEvents(resContainer);}
        resContainer._searchRows=rows;resContainer.classList.remove('search-was-empty');
      }
      renderSearchMoreButton();
    }

    function renderSearchMoreButton(){
      const box=document.getElementById('search-scroll-sentinel');if(!box)return;
      let button=box.querySelector('button');if(!button){button=document.createElement('button');button.type='button';button.className='w-full py-4 text-sm text-[#2AABEE]';button.id='btn-search-load-more';button.onclick=()=>loadMoreSearchResults();box.append(button);}
      const q=state.searchQuery.trim(),local=getFilteredSearchTracks().length>searchDisplayLimit;
      const remote=q.length>=2&&searchPagination.query===q&&searchPagination.hasMore&&state.searchFilter!=='liked';
      box.hidden=!(local||remote||state.isSearchParsing);button.disabled=searchPagination.loading||state.isSearchParsing;
      button.textContent=state.lang==='en'?'Show more':'Показать ещё';button.hidden=button.disabled;let placeholder=box.querySelector('.search-more-skeleton');if(button.disabled&&getFilteredSearchTracks().length){if(!placeholder){placeholder=document.createElement('div');placeholder.className='search-more-skeleton';placeholder.innerHTML=window.TelefySkeleton.html('tracks',3);box.prepend(placeholder);}}else placeholder?.remove();
    }

    async function loadMoreSearchResults() {
      if (state.activeTab !== 'search') return;
      const filtered = getFilteredSearchTracks();
      if (searchDisplayLimit < filtered.length) {
        searchDisplayLimit += 40;
        renderSearchView();
        return;
      }
      const qVal = state.searchQuery.trim();
      if (qVal.length >= 2) {
        if (!searchPagination.loading && searchPagination.hasMore) {
          await parseSearchQueryLive(qVal, true);
        }
      } else if (state.searchFilter !== 'liked') {
        await loadMoreLibraryForSearch();
      }
    }

    function updateProgressUI() {
      const current = getTrack(state.currentTrackId);
      const dur = Math.max(1, current.duration || 180);
      const pct = Math.min(100, (state.progressSec / dur) * 100);
      document.getElementById('mini-progress-bar').style.width = `${pct}%`;
      const ring = document.getElementById('hero-progress-ring');
      if (ring) {
        const circumference = 559.2;
        ring.style.strokeDashoffset = (circumference - (pct / 100) * circumference).toFixed(1);
      }
      const fullSlider = document.getElementById('full-seek-slider');
      fullSlider.value = pct;
      fullSlider.style.background = `linear-gradient(to right, #2AABEE ${pct}%, var(--bg-elevated) ${pct}%)`;
      fullSlider.style.borderRadius = '999px';
      fullSlider.style.height = '4px';
      document.getElementById('full-time-current').textContent = formatTime(state.progressSec);
      document.getElementById('full-time-total').textContent = formatTime(dur);
    }

    let heroDiscAnim = null;
    let heroDiscPlaying = false;

    function getElementRotationDeg(el) {
      const st = window.getComputedStyle(el).transform;
      if (!st || st === 'none') return 0;
      const m = new DOMMatrixReadOnly(st);
      const deg = Math.atan2(m.b, m.a) * (180 / Math.PI);
      return (deg + 360) % 360;
    }

    const ambientBars = document.getElementById('hero-ambient-bars');
    if (ambientBars) {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 37; i++) {
        const bar = document.createElement('span');
        const height = 18 + Math.abs(Math.sin(i * 1.71)) * 46 + Math.sin(i / 36 * Math.PI) * 38;
        bar.style.setProperty('--bar-height', `${height.toFixed(1)}px`);
        bar.style.setProperty('--bar-duration', `${(.8 + (i % 7) * .13).toFixed(2)}s`);
        bar.style.setProperty('--bar-delay', `${(-i * .17).toFixed(2)}s`);
        fragment.append(bar);
      }
      ambientBars.replaceChildren(fragment);
    }

    function syncHeroDiscAnimation(isPlaying) {
      document.getElementById('hero-swipe-zone')?.classList.toggle('is-playing', isPlaying);
      const el = document.getElementById('hero-cover-bg');
      if (!el || isPlaying === heroDiscPlaying) return;
      heroDiscPlaying = isPlaying;

      const currentAngle = getElementRotationDeg(el);
      if (heroDiscAnim) {
        heroDiscAnim.cancel();
        heroDiscAnim = null;
      }

      if (isPlaying) {
        el.style.willChange = 'transform';
        el.style.transform = `rotate(${currentAngle}deg)`;
        heroDiscAnim = el.animate(
          [
            { transform: `rotate(${currentAngle}deg)` },
            { transform: `rotate(${currentAngle + 360}deg)` }
          ],
          {
            duration: 14000,
            iterations: Infinity,
            easing: 'linear'
          }
        );
      } else {
        const targetAngle = currentAngle + 18;
        const stopAnim = el.animate(
          [
            { transform: `rotate(${currentAngle}deg)` },
            { transform: `rotate(${targetAngle}deg)` }
          ],
          {
            duration: 700,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards'
          }
        );
        heroDiscAnim = stopAnim;
        stopAnim.onfinish = () => {
          if (heroDiscAnim === stopAnim) {
            el.style.transform = `rotate(${targetAngle % 360}deg)`;
            el.style.willChange = 'auto';
            stopAnim.cancel();
            heroDiscAnim = null;
          }
        };
      }
    }

    function syncTrackRowPlayback() {
      document.querySelectorAll('[data-track-playback]').forEach(overlay => {
        const active = String(state.currentTrackId) === overlay.dataset.trackPlayback;
        overlay.style.display = active ? 'flex' : 'none';
        const icon = overlay.firstElementChild;
        const glyph = state.isPlaying ? '\uF14F' : '\uF148';
        if (icon.textContent !== glyph) icon.textContent = glyph;
        const trigger = overlay.closest('.track-play-trigger');
        if (trigger) {
          trigger.dataset.playbackState = active ? (state.isPlaying ? 'playing' : 'paused') : 'idle';
          if (active) trigger.setAttribute('aria-current', 'true');
          else trigger.removeAttribute('aria-current');
        }
      });
      document.querySelectorAll('[data-track-row-title]').forEach(title => {
        title.classList.toggle('text-[#2AABEE]', String(state.currentTrackId) === title.dataset.trackRowTitle);
      });
    }
    function renderPlayerUI() {
      syncPlaybackSource();
      syncTrackRowPlayback();
      const current = getTrack(state.currentTrackId);
      const artistWithAlbum = current.album ? `${current.artist} · ${current.album}` : current.artist;
      document.getElementById('mini-title').textContent = current.title;
      const pnpText = document.getElementById('profile-now-playing-text');
      if (pnpText) pnpText.textContent = `${current.title} — ${current.artist}`;
      const heroTitle = document.getElementById('hero-track-title');
      const heroArtist = document.getElementById('hero-track-artist');
      if (heroTitle) heroTitle.textContent = current.title;
      if (heroArtist) heroArtist.textContent = artistWithAlbum;
      document.getElementById('mini-artist').textContent = artistWithAlbum;
      const miniCover = document.getElementById('mini-cover');
      applyCoverStyle(miniCover, current);
      applyCoverStyle(document.getElementById('hero-cover-bg'), current);
      syncHeroDiscAnimation(state.isPlaying);
      const miniLike = document.getElementById('mini-like-btn');
      miniLike.classList.toggle('text-[#FF3B30]', current.liked);
      miniLike.setAttribute('aria-pressed', String(current.liked));
      miniLike.classList.toggle('text-muted', !current.liked);
      miniLike.innerHTML = `<span class="tg-ico text-[20px]">${current.liked ? '&#xF016;' : '&#xF1D9;'}</span>`;

      const playGlyph = '&#xF148;';
      const pauseGlyph = '&#xF14F;';
      document.getElementById('mini-play-icon').innerHTML = state.isPlaying ? pauseGlyph : playGlyph;
      document.getElementById('full-play-icon').innerHTML = state.isPlaying ? pauseGlyph : playGlyph;
      document.getElementById('hero-play-icon').innerHTML = state.isPlaying ? pauseGlyph : playGlyph;
      window.TelefyArtwork.update(current);
      const lyricsBackground = document.getElementById('lyrics-cover-background');
      const lyricsCoverUrl = /^https:\/\//.test(current.coverImg || '') ? current.coverImg : '';
      lyricsBackground.style.backgroundImage = lyricsCoverUrl ? `url(${JSON.stringify(lyricsCoverUrl)})` : 'none';
      lyricsBackground.style.backgroundColor = current.cover || '#1E293B';
      document.getElementById('full-title').textContent = current.title;
      document.getElementById('full-artist').textContent = current.artist;
      const fullAlbumSep = document.getElementById('full-album-sep');
      const fullAlbumBtn = document.getElementById('full-album-btn');
      if (fullAlbumSep && fullAlbumBtn) {
        if (current.album) {
          fullAlbumSep.classList.remove('hidden');
          fullAlbumBtn.classList.remove('hidden');
          fullAlbumBtn.textContent = current.album;
        } else {
          fullAlbumSep.classList.add('hidden');
          fullAlbumBtn.classList.add('hidden');
        }
      }
      const artistBtn = document.getElementById('btn-open-artist-card');
      if (artistBtn) {
        const artistAvatarUrl = getArtistAvatarUrl(current.artist) || current.coverImg;
        applyCoverStyle(artistBtn, { coverImg: artistAvatarUrl, cover: current.cover || '#2AABEE' });
      }
      document.getElementById('full-explicit-badge').classList.remove('hidden');
      const fullLike = document.getElementById('full-like-btn');
      fullLike.classList.toggle('text-[#FF3B30]', current.liked);
      fullLike.setAttribute('aria-pressed', String(current.liked));
      fullLike.classList.toggle('text-muted', !current.liked);
      fullLike.innerHTML = `<span class="tg-ico text-[22px]">${current.liked ? '&#xF016;' : '&#xF1D9;'}</span>`;

      updateProgressUI();
    }

    function updateCollectionPresentation(){
      const c=COLLECTIONS.find(c=>c.id===state.activeCollectionId)||USER_PLAYLISTS.find(c=>c.id===state.activeCollectionId)||(state.activeCollectionId==='recommendations'?window.TelefyRecommendations?.collection:null);
      const cover=document.getElementById('col-modal-cover');if(!c||!cover)return;
      const tr=(c.trackIds||[]).map(getTrack).find(t=>t?.coverImg);
      const url=c.coverImg||tr?.coverImg;
      cover.style.backgroundColor=c.cover||'#2450A4';cover.style.backgroundImage='';cover.replaceChildren();
      if(url){const img=document.createElement('img');img.src=url;img.alt='';img.className='w-full h-full object-cover';cover.append(img);}
      else if(c.icon){cover.innerHTML=c.icon;}
      document.getElementById('col-modal-description').textContent=c.shortDesc||c.subtitle||'';
    }
    function openCollectionModal(colId) {
      const col = COLLECTIONS.find(c => c.id === colId)||(colId==='recommendations'?window.TelefyRecommendations?.collection:null);
      if (!col) return;
      state.activeCollectionId = colId;
      const cText = getColText(col);
      document.getElementById('col-modal-tag').textContent = cText.tag;
      document.getElementById('col-modal-title').textContent = cText.title;

      document.getElementById('btn-edit-active-playlist')?.classList.add('hidden');
      document.getElementById('btn-delete-active-playlist')?.classList.add('hidden');
      const listEl = document.getElementById('col-modal-tracks');
      const colTracks = col.trackIds.map(id => tracks.find(x => x.id === id)).filter(Boolean);
      listEl.innerHTML = colTracks.length
        ? colTracks.map(createTrackRowHTML).join('')
        : window.TelefySkeleton.html();
      bindTrackRowEvents(listEl, cText.title);

      updateCollectionPresentation();
      openSheetModal('collection-modal', 'light');
      if (colTracks.length < 16) {
        ensureCollectionTracksLoaded(col);
      }
    }

    function closeCollectionModal() {
      closeSheetModal('collection-modal');
    }

    function renderMaxBetaView() {
      const promoEl = document.getElementById('mytelefy-promo-state');
      const betaEl = document.getElementById('mytelefy-beta-state');
      if (promoEl && betaEl) {
        promoEl.classList.toggle('hidden', state.isMaxSubscribed);
        betaEl.classList.toggle('hidden', !state.isMaxSubscribed);
      }

      const likedTracks = tracks.filter(tr => tr.liked);
      const libraryCount = likedTracks.length;
      const playlistsCount = USER_PLAYLISTS.length;

      const libStat = document.getElementById('max-stat-library-count');
      if (libStat) libStat.textContent = libraryCount;
      const plStat = document.getElementById('max-stat-playlists-count');
      if (plStat) plStat.textContent = playlistsCount;
      const likedStat = document.getElementById('max-stat-liked-count');
      if (likedStat) likedStat.textContent = likedTracks.length;

      const rowLibBadge = document.getElementById('max-row-library-badge');
      if (rowLibBadge) {
        rowLibBadge.textContent = state.lang === 'en' ? `${libraryCount} tracks` : `${libraryCount} треков`;
      }
      renderLibraryModalTracks();

      // Render User Playlists Grid
      const gridEl = document.getElementById('max-playlists-grid');
      if (gridEl) {
        if (window.TelefyLibrary?.loading && !USER_PLAYLISTS.length) {gridEl.innerHTML=window.TelefySkeleton.html('cards',2);}
        else if (USER_PLAYLISTS.length === 0) {
          gridEl.innerHTML = `<div class="playlist-empty-state col-span-2"><span class="playlist-empty-icon tg-ico" aria-hidden="true">&#xF0BF;</span><div><p>${state.lang === 'en' ? 'Your music, together' : 'Твоя музыка — вместе'}</p><span>${state.lang === 'en' ? 'Create a playlist and add your favourite tracks' : 'Создай плейлист и добавь любимые треки'}</span></div></div>`;
        } else {
          gridEl.innerHTML = USER_PLAYLISTS.map(pl => {
            const validTracks = (pl.trackIds || []).map(id => tracks.find(x => x.id === id)).filter(Boolean);
            const firstTrack = validTracks[0] || null;
            const coverUrl = (pl.coverImg && pl.coverImg.startsWith('http') ? pl.coverImg : null) || (firstTrack && firstTrack.coverImg) || null;
            const isUplLoading = !coverUrl && state.isCatalogParsing;
            return `
            <div data-upl="${pl.id}" class="upl-card squircle-card p-3 cursor-pointer active:scale-[0.98] transition flex flex-col justify-between relative">
              <div data-playlist-cover="${pl.id}" class="w-full aspect-square squircle-cover-md bg-cover bg-center bg-no-repeat relative overflow-hidden mb-2.5 flex items-end p-2.5 ${isUplLoading ? 'cover-loading' : ''}" style="background-color: ${pl.cover}; ${coverUrl ? `background-image: url('${coverUrl}')` : ''}">
                ${renderCoverImgTag(coverUrl)}
                <div class="absolute inset-0 z-[5] bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none"></div>
                <div class="absolute top-2 right-2 z-10 flex items-center gap-1">
                  <button type="button" data-edit-upl="${pl.id}" aria-label="Редактировать плейлист" class="upl-edit-btn w-7 h-7 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-[#2AABEE] transition">
                    <span class="tg-ico text-[12px]">&#xF01F;</span>
                  </button>
                  <button type="button" data-delete-upl="${pl.id}" aria-label="Удалить плейлист" class="upl-del-btn w-7 h-7 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-[#FF3B30] transition">
                    <span class="tg-ico text-[12px]">&#xF0B2;</span>
                  </button>
                </div>
                <span class="relative z-10 px-2.5 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-white font-rounded text-[10px]">
                  ${validTracks.length} ${state.lang === 'en' ? 'tracks' : 'треков'}
                </span>
              </div>
              <div class="min-w-0">
                <p class="font-rounded text-[14px] truncate">${pl.title}</p>
                <p class="text-[11px] text-muted truncate mt-0.5">${pl.subtitle}</p>
              </div>
            </div>
          `;
          }).join('');

          gridEl.querySelectorAll('.upl-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              openCreatePlaylistModal(btn.dataset.editUpl);
            });
          });
          gridEl.querySelectorAll('.upl-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              deleteUserPlaylist(btn.dataset.deleteUpl);
            });
          });
          gridEl.querySelectorAll('.upl-card').forEach(card => {
            card.addEventListener('click', () => {
              const pl = USER_PLAYLISTS.find(item => item.id === card.dataset.upl);
              if (!pl) return;
              triggerHaptic('light');
              document.getElementById('col-modal-tag').textContent = state.lang === 'en' ? 'My Telefy Max Playlist' : 'Плейлист Telefy Max';
              document.getElementById('col-modal-title').textContent = pl.title;
              document.getElementById('btn-edit-active-playlist')?.classList.remove('hidden');
              document.getElementById('btn-delete-active-playlist')?.classList.remove('hidden');
              const listEl = document.getElementById('col-modal-tracks');
              const plTracks = (pl.trackIds || []).map(id => tracks.find(x => x.id === id)).filter(Boolean);
              listEl.innerHTML = plTracks.length
                ? plTracks.map(createTrackRowHTML).join('')
                : `<div class="text-center py-8 text-xs text-muted">${state.lang === 'en' ? 'Playlist is empty' : 'Плейлист пуст'}</div>`;
              bindTrackRowEvents(listEl);
              state.activeCollectionId = pl.id;
              updateCollectionPresentation();
              openSheetModal('collection-modal', null);
            });
          });
        }
      }
    }

    function renderAll() {
      renderMoodChips();
      renderCollections();
      renderHomeTracks();
      renderFlowView();
      renderSearchView();
      renderPlayerUI();
      renderMaxBetaView();
    }

    // --- EVENT LISTENERS ---
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {switchTab(btn.dataset.tab);if(btn.dataset.tab==='home')requestAnimationFrame(()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));});
    });

    document.getElementById('btn-header-search').addEventListener('click', () => {
      switchTab('search');
      document.getElementById('search-input').focus();
    });

    function openSettingsModal() {
      openSheetModal('settings-modal', 'light');
    }
    function closeSettingsModal() {
      closeSheetModal('settings-modal');
    }
    document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettingsModal);
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') closeSettingsModal();
    });

    document.getElementById('toggle-theme').addEventListener('change', (e) => {
      triggerHaptic('light');
      const nextTheme = e.target.checked ? 'dark' : 'light';
      setTheme(nextTheme);
      showToast(nextTheme === 'dark' ? t('toastThemeDark') : t('toastThemeLight'));
    });

    const pnpBtn = document.getElementById('profile-now-playing-btn');
    if (pnpBtn) pnpBtn.addEventListener('click', () => { triggerHaptic('light'); openFullPlayer(); });

    document.getElementById('btn-lang-switch').addEventListener('click', () => {
      triggerHaptic('light');
      const nextLang = state.lang === 'ru' ? 'en' : 'ru';
      setLanguage(nextLang);
      showToast(t('toastLangChanged'));
    });

    document.getElementById('toggle-high-quality').addEventListener('change', (e) => {
      triggerHaptic('light');
      state.highQuality = e.target.checked;
      savePrefs();
      updateSettingsUI();
      showToast(state.highQuality ? t('toastHqOn') : t('toastHqOff'));
    });

    document.getElementById('toggle-haptic').addEventListener('change', (e) => {
      state.hapticEnabled = e.target.checked;
      savePrefs();
      if (state.hapticEnabled) triggerHaptic('medium');
      showToast(state.hapticEnabled ? t('toastHapticOn') : t('toastHapticOff'));
    });

    function notifyTrackOfflineExport() {
      if(window.TelefyExport)return window.TelefyExport.start();
      showToast('Подключаем выгрузку. Попробуй ещё раз через секунду.');
    }

    function startMyVibeMode(){window.TelefyTaste?.start();}

    function resetAndShuffleMusicalPreferences() {
      triggerHaptic('heavy');
      if (!tracks.length) {
        showToast(t('toastTasteReset'));
        return;
      }
      // Reset flow playback history, disliked flags, and mood filters
      playedFlowTrackIds.clear();
      playedFlowTrackKeys.clear();
      recentFlowHistoryIds.length = 0;
      Object.keys(flowPaginationByMood).forEach(k => delete flowPaginationByMood[k]);
      tracks.forEach(tr => { tr.disliked = false; });

      state.activeMood = 'all';
      flowModeIndex = 0;
      isShuffle = true;
      const shuffleBtn = document.getElementById('btn-full-shuffle');
      if (shuffleBtn) {
        shuffleBtn.classList.add('text-[#2AABEE]');
        shuffleBtn.classList.remove('text-muted');
      }

      // Fisher-Yates shuffle of the catalog to completely refresh recommendations
      const shuffled = [...tracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      tracks = interleaveByArtist(shuffled);
      rebuildCollectionsAndPlaylistsFromParsed();

      const candidates = tracks.filter(tr => tr.id !== state.currentTrackId);
      const pickPool = candidates.length > 0 ? candidates : tracks;
      const firstPick = pickPool[0];
      state.queueIds = pickPool.slice(1, 18).map(tr => tr.id);

      const shuffleTitle = state.lang === 'en' ? 'Shuffle' : 'Вперемешку';
      const shuffleDesc = state.lang === 'en'
        ? 'Musical preferences reset · Fresh mix'
        : 'Музыкальные предпочтения перезагружены';

      const homeTitleEl = document.getElementById('home-stream-title');
      if (homeTitleEl) homeTitleEl.textContent = shuffleTitle;
      const homeDescEl = document.getElementById('home-stream-desc');
      if (homeDescEl) homeDescEl.textContent = shuffleDesc;
      const flowTitleEl = document.getElementById('flow-stream-name');
      if (flowTitleEl) flowTitleEl.textContent = shuffleTitle;

      playTrack(firstPick.id, shuffleTitle);
      silentlyRefillFlowQueue(false);
      showToast(t('toastTasteReset'));
    }


    // Quick Action 4-tiles
    document.getElementById('qa-flow').addEventListener('click', startMyVibeMode);
    document.getElementById('qa-mytelefy').addEventListener('click', resetAndShuffleMusicalPreferences);
    document.getElementById('qa-bot').addEventListener('click', notifyTrackOfflineExport);
    function openUpsellModal() {
      if(document.documentElement.dataset.maxMode!=='paid'){window.TelefyMax?.refresh();return;}

      openSheetModal('mytelefy-upsell-modal', 'medium');
    }
    function closeUpsellModal() {
      closeSheetModal('mytelefy-upsell-modal');
    }

    function handleLikedAccess() {
      if (!state.isMaxSubscribed) {
        showToast(t('toastLockedLiked'));
        openUpsellModal();
        return;
      }
      openLibraryModal();
    }

    document.getElementById('qa-liked').addEventListener('click', handleLikedAccess);

    let heroSwipeStartX = 0;
    let heroLastX = 0;
    let heroDragging = false;
    let heroSwiped = false;
    const heroStage = document.getElementById('hero-stage');
    const heroZone = document.getElementById('hero-swipe-zone');

    function animateHeroSwipe(dir) {
      const outX = dir > 0 ? 155 : -155;
      const inX = dir > 0 ? -95 : 95;
      heroZone.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.18s ease-out';
      heroZone.style.transform = `translate3d(${outX}px, 0, 0) scale(0.88)`;
      heroZone.style.opacity = '0';

      setTimeout(() => {
        if (dir < 0) playNext();
        else playPrev();
        heroZone.style.transition = 'none';
        heroZone.style.transform = `translate3d(${inX}px, 0, 0) scale(0.86)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            heroZone.style.transition = 'transform 0.38s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.24s ease-out';
            heroZone.style.transform = 'translate3d(0px, 0, 0) scale(1)';
            heroZone.style.opacity = '1';
          });
        });
      }, 190);
    }

    heroStage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mood-chip')) return;
      heroSwipeStartX = e.clientX;
      heroLastX = e.clientX;
      heroDragging = true;
      heroSwiped = false;
      heroZone.style.transition = 'none';
    });

    heroStage.addEventListener('pointermove', (e) => {
      if (!heroDragging) return;
      heroLastX = e.clientX;
      const dx = heroLastX - heroSwipeStartX;
      if (Math.abs(dx) > 8) {
        try { if (!heroStage.hasPointerCapture(e.pointerId)) heroStage.setPointerCapture(e.pointerId); } catch (_) {}
        const uniformScale = 1 - Math.min(Math.abs(dx) / 850, 0.07);
        heroZone.style.transform = `translate3d(${(dx * 0.45).toFixed(1)}px, 0, 0) scale(${uniformScale.toFixed(3)})`;
      }
    });

    function resetHeroPosition() {
      heroZone.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
      heroZone.style.transform = 'translate3d(0px, 0, 0) scale(1)';
    }

    heroStage.addEventListener('pointerup', (e) => {
      if (!heroDragging) return;
      heroDragging = false;
      try { heroStage.releasePointerCapture(e.pointerId); } catch (_) {}
      const dx = (e.clientX ?? heroLastX) - heroSwipeStartX;
      if (Math.abs(dx) > 45) {
        heroSwiped = true;
        animateHeroSwipe(dx > 0 ? 1 : -1);
      } else {
        resetHeroPosition();
      }
    });

    heroStage.addEventListener('pointercancel', () => {
      if (!heroDragging) return;
      heroDragging = false;
      resetHeroPosition();
    });

    document.getElementById('btn-hero-play').addEventListener('click', () => {
      if (heroSwiped) {
        heroSwiped = false;
        return;
      }
      triggerHaptic('medium');
      const heroBtn = document.getElementById('btn-hero-play');
      heroBtn.classList.remove('hero-tap-pulse');
      void heroBtn.offsetWidth;
      heroBtn.classList.add('hero-tap-pulse');
      if (!state.isPlaying && state.progressSec === 0) playTrack(state.currentTrackId, t('myFlowTitle'));
      else togglePlay();
    });
    // ============================================================================
    // REAL CATALOG PARSER (Pure Deezer Public API: Artists, Avatars, Covers, Albums & Tracks)
    // ============================================================================
    const DEEZER_COVER_CACHE = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_deezer_covers_v1') || '{}'); } catch { return {}; }
    })();
    const DEEZER_ALBUMS_CACHE = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_deezer_albums_v1') || '{}'); } catch { return {}; }
    })();
    const DEEZER_ALBUM_TRACKS_CACHE = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_deezer_album_tracks_v1') || '{}'); } catch { return {}; }
    })();
    const DEEZER_ARTIST_ID_CACHE = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_deezer_artist_ids_v1') || '{}'); } catch { return {}; }
    })();
    const ARTIST_AVATAR_CACHE = (() => {
      try { return JSON.parse(localStorage.getItem('telefy_artist_avatars_v7') || '{}'); } catch { return {}; }
    })();

    function saveParsedCatalogCache() {
      try {
        if (tracks.length > 0) {
          localStorage.setItem('telefy_parsed_catalog_v8', JSON.stringify(tracks.slice(0, 320).map(t=>({...t,liked:false}))));
        }
      } catch {}
    }
    function saveDeezerCoverCache() {
      try { localStorage.setItem('telefy_deezer_covers_v1', JSON.stringify(DEEZER_COVER_CACHE)); } catch {}
    }
    function saveDeezerAlbumsCache() {
      try { localStorage.setItem('telefy_deezer_albums_v1', JSON.stringify(DEEZER_ALBUMS_CACHE)); } catch {}
    }
    function saveDeezerAlbumTracksCache() {
      try { localStorage.setItem('telefy_deezer_album_tracks_v1', JSON.stringify(DEEZER_ALBUM_TRACKS_CACHE)); } catch {}
    }
    function saveDeezerArtistIdCache() {
      try { localStorage.setItem('telefy_deezer_artist_ids_v1', JSON.stringify(DEEZER_ARTIST_ID_CACHE)); } catch {}
    }
    function saveArtistAvatarCache() {
      try { localStorage.setItem('telefy_artist_avatars_v7', JSON.stringify(ARTIST_AVATAR_CACHE)); } catch {}
    }

    function getArtistListeners(name) {
      const s = String(name || 'Artist');
      let hash = 0;
      for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
      const num = 124500 + (hash % 1850000);
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function cleanSearchTerm(str) {
      return (str || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\b(feat\.?|ft\.?|prod\.?)\b.*/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Never split on the letter 'x' inside artist names like "Toxi$" or "Oxxxymiron"!
    function splitArtistCredits(artistStr) {
      return String(artistStr || '')
        .replace(/\((?:feat\.?|ft\.?|with)\s+([^)]+)\)/gi, ', $1')
        .replace(/\[(?:feat\.?|ft\.?|with)\s+([^\]]+)\]/gi, ', $1')
        .split(/\s+(?:feat\.?|ft\.?|vs\.?|and|x|×)\s+|\s*[,&•;]\s*/i)
        .map(s => s.trim())
        .filter(Boolean);
    }

    function getPrimaryArtistName(name) {
      const parts = splitArtistCredits(name);
      return parts[0] || cleanSearchTerm(name) || String(name || '').trim();
    }

    function normalizeArtistToken(str) {
      return String(str || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9$.]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function normalizeTrackTitleKey(str) {
      return cleanSearchTerm(str)
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9$]+/gi, '')
        .trim();
    }

    function formatAlbumTitle(rawCollectionName) {
      if (!rawCollectionName) return '';
      return String(rawCollectionName)
        .replace(/\s+-\s+Single$/i, '')
        .replace(/\s+-\s+EP$/i, ' · EP')
        .trim();
    }

    function findRosterConfig(artistName) {
      const tokens = splitArtistCredits(artistName).map(normalizeArtistToken);
      const fullNorm = normalizeArtistToken(artistName);
      for (const cfg of RUSSIAN_RAP_ROSTER) {
        const aliases = (cfg.aliases || [cfg.name]).map(normalizeArtistToken);
        if (aliases.includes(fullNorm)) return cfg;
        if (tokens.some(tk => aliases.includes(tk))) return cfg;
      }
      return null;
    }

    function doesArtistMatch(resultArtistName, targetNameOrConfig, resultItem = null) {
      if (!resultArtistName || !targetNameOrConfig) return false;
      const cfg = typeof targetNameOrConfig === 'object' ? targetNameOrConfig : findRosterConfig(targetNameOrConfig);
      const targetAliases = cfg
        ? [normalizeArtistToken(cfg.name), ...(cfg.aliases || []).map(normalizeArtistToken)]
        : [normalizeArtistToken(getPrimaryArtistName(targetNameOrConfig)), normalizeArtistToken(targetNameOrConfig)];

      const creditTokens = splitArtistCredits(resultArtistName).map(normalizeArtistToken);
      const fullResultNorm = normalizeArtistToken(resultArtistName);

      const exactTokenMatch = creditTokens.some(tk => targetAliases.includes(tk)) || targetAliases.includes(fullResultNorm);
      if (!exactTokenMatch) return false;

      if (cfg && cfg.requireCyrillicOrRap && resultItem) {
        const probeText = `${resultItem.title || ''} ${resultItem.album?.title || ''} ${resultItem.artist?.name || resultItem.name || ''}`;
        const hasCyrillic = /[а-яё]/i.test(probeText);
        if (!hasCyrillic && resultItem.type !== 'artist') return false;
      }
      return true;
    }

    function getArtistAvatarUrl(artistName) {
      const primary = getPrimaryArtistName(artistName);
      const key = normalizeArtistToken(primary);
      if (ARTIST_AVATAR_CACHE[key] && ARTIST_AVATAR_CACHE[key].startsWith('http')) {
        return ARTIST_AVATAR_CACHE[key];
      }
      const cachedAlbums = DEEZER_ALBUMS_CACHE[key];
      if (Array.isArray(cachedAlbums) && cachedAlbums.length && cachedAlbums[0].img) {
        return cachedAlbums[0].img;
      }
      const match = tracks.find(tr => doesArtistMatch(tr.artist, primary) && (tr.artistImg || tr.coverImg));
      return match ? (match.artistImg || match.coverImg) : null;
    }

    // Verify image URL loads via Image() with no-referrer before trusting it
    const verifiedCoverUrls = new Map();
    function verifyCoverImage(url, timeoutMs = 4000) {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) return Promise.resolve(null);
      if (verifiedCoverUrls.has(url)) return verifiedCoverUrls.get(url);

      const p = new Promise((resolve) => {
        if (typeof Image === 'undefined') {
          resolve(url);
          return;
        }
        const img = new Image();
        let done = false;
        const finish = (val) => {
          if (done) return;
          done = true;
          resolve(val);
        };
        const timer = setTimeout(() => finish(url), timeoutMs);
        img.referrerPolicy = 'no-referrer';
        img.onload = () => {
          clearTimeout(timer);
          finish(img.src || url);
        };
        img.onerror = () => {
          clearTimeout(timer);
          if (url.includes('500x500')) {
            const fallback250 = url.replace('500x500', '250x250');
            const img2 = new Image();
            img2.referrerPolicy = 'no-referrer';
            img2.onload = () => finish(fallback250);
            img2.onerror = () => finish(null);
            img2.src = fallback250;
          } else if (url.includes('1000x1000')) {
            const fallback500 = url.replace('1000x1000', '500x500');
            const img2 = new Image();
            img2.referrerPolicy = 'no-referrer';
            img2.onload = () => finish(fallback500);
            img2.onerror = () => finish(null);
            img2.src = fallback500;
          } else {
            finish(null);
          }
        };
        img.src = url;
      });
      verifiedCoverUrls.set(url, p);
      return p;
    }

    const coverFetchQueue = [];
    let activeCoverFetches = 0;
    const MAX_CONCURRENT_COVER_FETCHES = 4;

    function runCoverQueueTask(fn) {
      return new Promise((resolve, reject) => {
        coverFetchQueue.push({ fn, resolve, reject });
        pumpCoverQueue();
      });
    }

    function pumpCoverQueue() {
      while (activeCoverFetches < MAX_CONCURRENT_COVER_FETCHES && coverFetchQueue.length > 0) {
        const item = coverFetchQueue.shift();
        activeCoverFetches++;
        Promise.resolve()
          .then(() => item.fn())
          .then(res => item.resolve(res), err => item.reject(err))
          .finally(() => {
            setTimeout(() => {
              activeCoverFetches--;
              pumpCoverQueue();
            }, 65);
          });
      }
    }

    function fetchJsonpOnly(url, timeoutMs = 4500) {
      return new Promise((resolve) => {
        if (typeof document === 'undefined' || !document.createElement) {
          resolve(null);
          return;
        }
        const cbName = '__telefyJsonp_' + Math.random().toString(36).slice(2) + '_' + Date.now();
        const script = document.createElement('script');
        let settled = false;
        const cleanup = () => {
          try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
        };
        const tId = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(null);
        }, timeoutMs);

        window[cbName] = (data) => {
          if (settled) return;
          settled = true;
          clearTimeout(tId);
          cleanup();
          resolve(data);
        };
        script.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(tId);
          cleanup();
          resolve(null);
        };
        script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
        (document.head || document.body || document.documentElement).appendChild(script);
      });
    }

    function fetchJsonWithFallback(url, timeoutMs = 4500) {
      return new Promise(async (resolve) => {
        try {
          const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
          const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
          if (timer) clearTimeout(timer);
          if (res && res.ok) {
            const data = await res.json();
            resolve(data);
            return;
          }
        } catch (_) {}
        const jsonpData = await fetchJsonpOnly(url, timeoutMs);
        resolve(jsonpData);
      });
    }

    function syncTrackCoverAcrossDOM(trackId) {
      const tr = tracks.find(x => x.id === trackId);
      if (!tr) return;

      document.querySelectorAll(`[data-track-cover="${trackId}"]`).forEach(el => {
        applyCoverStyle(el, tr);
      });

      COLLECTIONS.forEach(col => {
        if (col.trackIds && col.trackIds.includes(trackId)) {
          const colEl = document.querySelector(`[data-collection-cover="${col.id}"]`);
          const colUrl = getCollectionCoverUrl(col);
          if (colEl && colUrl) {
            applyCoverStyle(colEl, { coverImg: colUrl, cover: col.cover, coverStatus: 'loaded' });
          }
        }
      });

      USER_PLAYLISTS.forEach(pl => {
        if (pl.trackIds && pl.trackIds[0] === trackId) {
          if (tr.coverImg && !pl.coverImg) pl.coverImg = tr.coverImg;
          const plEl = document.querySelector(`[data-playlist-cover="${pl.id}"]`);
          if (plEl && tr.coverImg) {
            applyCoverStyle(plEl, { coverImg: tr.coverImg, cover: pl.cover, coverStatus: 'loaded' });
          }
        }
      });

      if (trackId === state.currentTrackId) {
        renderPlayerUI();
        renderFlowView();
      }
    }

    function observeTrackCovers(rootEl) {
      if (!rootEl) return;
      rootEl.querySelectorAll('[data-track-cover]').forEach(el => {
        const tid = Number(el.getAttribute('data-track-cover'));
        const tr = tracks.find(x => x.id === tid);
        if (tr) applyCoverStyle(el, tr);
      });
    }

    async function ensureTrackCover(track, syncImmediately = true) {
      if (!track) return null;
      if (track.coverImg && track.coverImg.startsWith('http')) {
        track.coverStatus = 'loaded';
        if (syncImmediately) syncTrackCoverAcrossDOM(track.id);
        return track.coverImg;
      }
      return null;
    }

    // Resolve Deezer Artist ID & real avatar via Deezer Public API (JSONP)
    async function resolveDeezerArtist(artistNameOrCfg) {
      const isCfg = typeof artistNameOrCfg === 'object' && artistNameOrCfg !== null;
      const primary = isCfg ? artistNameOrCfg.name : getPrimaryArtistName(artistNameOrCfg);
      const rosterCfg = isCfg ? artistNameOrCfg : findRosterConfig(primary);
      const key = normalizeArtistToken(primary);
      const q = (rosterCfg && rosterCfg.query) || primary;

      if (DEEZER_ARTIST_ID_CACHE[key]) {
        return {
          id: DEEZER_ARTIST_ID_CACHE[key],
          name: primary,
          avatar: ARTIST_AVATAR_CACHE[key] || null
        };
      }

      try {
        const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=8&output=jsonp`;
        const data = await runCoverQueueTask(() => fetchJsonpOnly(url, 4500));
        const list = (data && Array.isArray(data.data)) ? data.data : [];
        const matched = list
          .filter(a => a && a.id && a.name && doesArtistMatch(a.name, rosterCfg || primary, a))
          .sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0));

        const best = matched[0] || list[0];
        if (best && best.id && doesArtistMatch(best.name, rosterCfg || primary, best)) {
          DEEZER_ARTIST_ID_CACHE[key] = best.id;
          saveDeezerArtistIdCache();
          const avatar = pickDeezerArtistAvatar(best);
          if (avatar) {
            ARTIST_AVATAR_CACHE[key] = avatar;
            saveArtistAvatarCache();
          }
          return { id: best.id, name: best.name, avatar };
        }
      } catch (_) {}
      return null;
    }

    function mapDeezerTrackItem(d, artistCfg = null, verifiedCover = null, fallbackArtistAvatar = null, moodOverride = null) {
      const primaryName = (artistCfg && artistCfg.name) || getPrimaryArtistName(d.artist?.name || '');
      const rosterCfg = artistCfg || findRosterConfig(d.artist?.name || primaryName);
      const avatar = pickDeezerArtistAvatar(d.artist) || fallbackArtistAvatar || null;
      if (avatar) {
        const aKey = normalizeArtistToken(primaryName);
        if (!ARTIST_AVATAR_CACHE[aKey]) {
          ARTIST_AVATAR_CACHE[aKey] = avatar;
          saveArtistAvatarCache();
        }
      }
      return {
        deezerTrackId: d.id ? String(d.id) : null,
        deezerArtistId: d.artist?.id || null,
        collectionId: d.album?.id ? `dz_alb_${d.album.id}` : null,
        deezerAlbumId: d.album?.id || null,
        title: String(d.title || d.title_short || '').trim(),
        artist: String(d.artist?.name || primaryName).trim(),
        primaryArtist: primaryName,
        album: formatAlbumTitle(d.album?.title) || String(d.title || '').trim(),
        releaseYear: d.release_date ? String(d.release_date).slice(0, 4) : '2024',
        duration: d.duration ? Math.max(30, Number(d.duration)) : 165,
        mood: moodOverride || (rosterCfg && rosterCfg.mood) || 'all',
        uncensored: d.explicit_lyrics !== undefined ? Boolean(d.explicit_lyrics) : Boolean(rosterCfg && rosterCfg.uncensoredDefault),
        coverImg: verifiedCover,
        artistImg: avatar,
        previewUrl: d.preview || null
      };
    }

    // Parse tracks, albums, artist names, avatars, and covers via pure Deezer Public API
    async function parseArtistCatalogTracks(artistCfg, limit = 10) {
      const parsedItems = [];
      const seenKeys = new Set();
      let resolvedArtist = null;

      try {
        resolvedArtist = await resolveDeezerArtist(artistCfg);
      } catch (_) {}

      const processDeezerTrackList = async (dzList) => {
        const candidates = [];
        for (const d of dzList) {
          if (parsedItems.length + candidates.length >= limit) break;
          if (!d || !d.title || !d.artist || !d.artist.name || !d.album) continue;
          if (!doesArtistMatch(d.artist.name, artistCfg, d)) continue;
          const normKey = `${normalizeArtistToken(getPrimaryArtistName(d.artist.name))}::${normalizeTrackTitleKey(d.title)}`;
          if (!normKey || seenKeys.has(normKey)) continue;
          seenKeys.add(normKey);
          candidates.push(d);
        }
        const checked = await Promise.all(candidates.map(async (d) => {
          const rawCover = pickDeezerCover(d.album);
          const verifiedCover = await verifyCoverImage(rawCover);
          if (!verifiedCover) return null;
          return mapDeezerTrackItem(d, artistCfg, verifiedCover, resolvedArtist?.avatar || null);
        }));
        checked.filter(Boolean).forEach(item => {
          if (parsedItems.length < limit) parsedItems.push(item);
        });
      };

      // 1. Primary: Artist Top Tracks endpoint (/artist/{id}/top)
      if (resolvedArtist && resolvedArtist.id) {
        try {
          const topUrl = `https://api.deezer.com/artist/${resolvedArtist.id}/top?limit=${Math.max(limit * 2, 16)}&output=jsonp`;
          const topData = await runCoverQueueTask(() => fetchJsonpOnly(topUrl, 4500));
          const topList = (topData && Array.isArray(topData.data)) ? topData.data : [];
          await processDeezerTrackList(topList);
        } catch (_) {}
      }

      // 2. Supplement if needed via Deezer Track Search (/search/track)
      if (parsedItems.length < Math.min(limit, 6)) {
        try {
          const q = artistCfg.query || artistCfg.name;
          const searchUrl = `https://api.deezer.com/search/track?q=${encodeURIComponent('artist:"' + q + '"')}&limit=18&output=jsonp`;
          const dzData = await runCoverQueueTask(() => fetchJsonpOnly(searchUrl, 4500));
          const dzList = (dzData && Array.isArray(dzData.data)) ? dzData.data : [];
          await processDeezerTrackList(dzList);
        } catch (_) {}
      }

      return parsedItems;
    }

    function mergeParsedTracksIntoCatalog(newItems) {
      if (!Array.isArray(newItems) || !newItems.length) return false;
      const existingLikedKeys = new Set([
        ...userLikedTrackKeys,
        ...tracks.filter(t => t.liked).map(t => `${normalizeArtistToken(getPrimaryArtistName(t.artist))}::${normalizeTrackTitleKey(t.title)}`)
      ]);
      const existingByKey = new Map();
      tracks.forEach(t => {
        const k = `${normalizeArtistToken(getPrimaryArtistName(t.artist))}::${normalizeTrackTitleKey(t.title)}`;
        existingByKey.set(k, t);
      });

      let addedAny = false;
      let nextId = tracks.reduce((mx, x) => Math.max(mx, Number(x.id) || 0), 0) + 1;

      newItems.forEach((item, idx) => {
        if(window.telefySongBlocked(item))return;
        if (!item || !item.title || !item.artist || (!item.coverImg && !item.soundcloudUrn)) return;
        const k = `${normalizeArtistToken(getPrimaryArtistName(item.artist))}::${normalizeTrackTitleKey(item.title)}`;
        const existing = existingByKey.get(k);
        if (existing) {
          if(existing.editorialPinned&&!item.editorialPinned&&item.soundcloudUrn&&existing.soundcloudUrn!==item.soundcloudUrn)return;
          if(item.editorialPinned)existing.editorialPinned=true;
          existing.coverImg = item.coverImg || existing.coverImg;
          if(item.duration)existing.duration=item.duration;
          existing.album = item.album || existing.album;
          existing.collectionId = item.collectionId || existing.collectionId;
          existing.previewUrl = item.previewUrl || existing.previewUrl;
          if (item.soundcloudUrn) {
            existing.curatedTrend=item.curatedTrend===true;existing.editorialYear=item.editorialYear;existing.trendsEligible=item.trendsEligible===true;existing.genre=item.genre||existing.genre||'';existing.classificationVersion=item.classificationVersion||existing.classificationVersion||0;existing.modes=item.modes||existing.modes||[];existing.releaseDate=item.releaseDate||existing.releaseDate;existing.playbackCount=item.playbackCount||existing.playbackCount||0;
            existing.soundcloudUrn=item.soundcloudUrn; existing.soundcloudUrl=item.soundcloudUrl;
            existing.uploader=item.uploader; existing.uploaderUrl=item.uploaderUrl;
          }
          existing.coverStatus = 'loaded';
          return;
        }
        const accentColor = TRACK_ACCENT_COLORS[(nextId + idx) % TRACK_ACCENT_COLORS.length];
        const trObj = {
          id: nextId++,
          genre:item.genre||'', classificationVersion:item.classificationVersion||0, modes:item.modes||[], releaseDate:item.releaseDate||null, playbackCount:item.playbackCount||0,
          editorialPinned:item.editorialPinned===true,curatedTrend:item.curatedTrend===true,editorialYear:item.editorialYear,trendsEligible:item.trendsEligible===true,soundcloudUrn:item.soundcloudUrn || null,
          soundcloudUrl:item.soundcloudUrl || null,
          uploader:item.uploader || null,
          uploaderUrl:item.uploaderUrl || null,
          deezerTrackId: item.deezerTrackId || null,
          deezerArtistId: item.deezerArtistId || null,
          collectionId: item.collectionId || null,
          deezerAlbumId: item.deezerAlbumId || null,
          title: item.title,
          artist: item.artist,
          primaryArtist: item.primaryArtist || getPrimaryArtistName(item.artist),
          album: item.album || '',
          releaseYear: item.releaseYear || '2024',
          duration: item.duration || 165,
          mood: item.mood || 'all',
          uncensored: Boolean(item.uncensored),
          liked: existingLikedKeys.has(k),
          disliked: false,
          cover: accentColor,
          coverImg: item.coverImg,
          artistImg: item.artistImg || null,
          previewUrl: item.previewUrl || null,
          coverStatus: 'loaded'
        };
        DEEZER_COVER_CACHE[`${trObj.artist}::${trObj.title}`] = trObj.coverImg;
        tracks.push(trObj);
        existingByKey.set(k, trObj);
        addedAny = true;
      });

      if (!addedAny) return false;

      // Interleave tracks so the same artist does not repeat consecutively
      const byArtist = new Map();
      tracks.forEach(t => {
        const aKey = normalizeArtistToken(t.primaryArtist || getPrimaryArtistName(t.artist));
        if (!byArtist.has(aKey)) byArtist.set(aKey, []);
        byArtist.get(aKey).push(t);
      });
      const interleaved = [];
      let round = 0;
      let keepGoing = true;
      while (keepGoing) {
        keepGoing = false;
        for (const list of byArtist.values()) {
          if (round < list.length) {
            interleaved.push(list[round]);
            keepGoing = true;
          }
        }
        round++;
      }
      tracks = interleaved;

      // Default: 0 pre-added tracks in library so the user can test and add tracks manually
      tracks.forEach(t => {
        const k = `${normalizeArtistToken(getPrimaryArtistName(t.artist))}::${normalizeTrackTitleKey(t.title)}`;
        t.liked = existingLikedKeys.has(k);
        if (userListenedTrackKeys.has(k)) userListenedTrackIds.add(t.id);
      });

      rebuildCollectionsAndPlaylistsFromParsed();
      saveParsedCatalogCache();
      saveDeezerCoverCache();
      return true;
    }

    function rebuildCollectionsAndPlaylistsFromParsed() {
      if (!tracks.length) return;
      const usedCollectionCovers = new Set();

      COLLECTIONS.forEach((col, colIdx) => {
        if(col.curated)return;
        const targetList = col.targetArtists || [];
        const matched = interleaveByArtist(
          tracks.filter(tr => targetList.some(ta => doesArtistMatch(tr.artist, ta)))
        );
        const matchedIds = new Set(matched.map(t => t.id));
        let pool = matched;
        if (pool.length < 18) {
          const rest = tracks.filter(t => !matchedIds.has(t.id));
          const offset = rest.length ? (colIdx * 5) % rest.length : 0;
          const rotatedRest = [...rest.slice(offset), ...rest.slice(0, offset)];
          pool = interleaveByArtist([...matched, ...rotatedRest]);
        }
        col.trackIds = pool.slice(0, 20).map(t => t.id);

        const distinctTrack = pool.find(t => t.coverImg && !usedCollectionCovers.has(t.coverImg)) || pool[0];
        if (distinctTrack && distinctTrack.coverImg) {
          col.coverImg = distinctTrack.coverImg;
          usedCollectionCovers.add(distinctTrack.coverImg);
        }
      });

      USER_PLAYLISTS.forEach(pl=>{
        if(pl.trackKeys)pl.trackIds=pl.trackKeys.map(k=>tracks.find(tr=>getTrackUniqueKey(tr)===k)?.id).filter(id=>id!==undefined);
      });
      // IDs are browser-local; catalog hydration never writes the account library.

      if (!tracks.some(t => t.id === state.currentTrackId)) {
        state.currentTrackId = window.TelefyFirstRun?.pending ? 0 : tracks[0].id;
      }
      const validQueue = (state.queueIds || []).filter(id => {
        const tr = tracks.find(t => t.id === id);
        return tr && isFlowTrackUnplayed(tr);
      });
      if (validQueue.length < 3) {
        const extras = tracks.filter(t => isFlowTrackUnplayed(t) && !validQueue.includes(t.id)).slice(0, 10 - validQueue.length).map(t => t.id);
        state.queueIds = [...validQueue, ...extras];
      } else {
        state.queueIds = validQueue;
      }
    }

    async function hydrateAllTrackCovers() {
      if (tracks.length > 0) {
        state.isCatalogParsing = false;
        rebuildCollectionsAndPlaylistsFromParsed();
        renderAll();
      } else {
        state.isCatalogParsing = true;
        renderAll();
      }

      // Wave 1: Top 6 Russian rap headliners for fastest initial screen render
      const wave1 = RUSSIAN_RAP_ROSTER.slice(0, 6);
      const wave1Results = await Promise.all(wave1.map(cfg => parseArtistCatalogTracks(cfg, 8)));
      const flatWave1 = wave1Results.flat();
      if (flatWave1.length > 0) {
        state.isCatalogParsing = false;
        mergeParsedTracksIntoCatalog(flatWave1);
        renderAll();
      }

      // Wave 2 & 3: Remaining Russian rappers in clean batches
      const restRoster = RUSSIAN_RAP_ROSTER.slice(6);
      for (let i = 0; i < restRoster.length; i += 5) {
        const batch = restRoster.slice(i, i + 5);
        const batchRes = await Promise.all(batch.map(cfg => parseArtistCatalogTracks(cfg, 6)));
        const flatBatch = batchRes.flat();
        if (flatBatch.length > 0) {
          state.isCatalogParsing = false;
          mergeParsedTracksIntoCatalog(flatBatch);
          renderAll();
        }
      }
      state.isCatalogParsing = false;
      renderAll();
    }

    // Live search with full-library pagination
    async function parseSearchQueryLive(queryStr, isLoadMore = false) {
      if (window.TelefySoundCloud?.ready) return window.TelefySoundCloud.search(queryStr,isLoadMore);
      const cleanQ = (queryStr || '').trim();
      if (cleanQ.length < 2) return;

      if (!isLoadMore || searchPagination.query !== cleanQ) {
        searchPagination.query = cleanQ;
        searchPagination.nextIndex = 0;
        searchPagination.hasMore = true;
      }
      if (!searchPagination.hasMore || searchPagination.loading) return;

      const offset = searchPagination.nextIndex;
      searchPagination.loading = true;
      if (!isLoadMore) {
        state.isSearchParsing = true;
        renderSearchView();
      }
      try {
        const trackUrl = `https://api.deezer.com/search/track?q=${encodeURIComponent(cleanQ)}&index=${offset}&limit=25&output=jsonp`;
        const promises = [fetchJsonpOnly(trackUrl, 4000)];
        if (offset === 0) {
          const artistUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanQ)}&limit=6&output=jsonp`;
          promises.push(fetchJsonpOnly(artistUrl, 4000));
        }
        const [trackData, artistData] = await Promise.all(promises);

        if (artistData && Array.isArray(artistData.data)) {
          artistData.data.forEach(a => {
            if (!a || !a.id || !a.name) return;
            const aKey = normalizeArtistToken(a.name);
            if (aKey && !DEEZER_ARTIST_ID_CACHE[aKey]) DEEZER_ARTIST_ID_CACHE[aKey] = a.id;
            const avatar = pickDeezerArtistAvatar(a);
            if (aKey && avatar && !ARTIST_AVATAR_CACHE[aKey]) ARTIST_AVATAR_CACHE[aKey] = avatar;
          });
          saveDeezerArtistIdCache();
          saveArtistAvatarCache();
        }

        const results = (trackData && Array.isArray(trackData.data)) ? trackData.data : [];
        searchPagination.nextIndex = offset + results.length;
        if (results.length < 25 || (trackData && typeof trackData.total === 'number' && searchPagination.nextIndex >= trackData.total)) {
          searchPagination.hasMore = false;
        }

        const newItems = results.map((d) => {
          if (!d || !d.title || !d.artist || !d.artist.name || !d.album) return null;
          const rawCover = pickDeezerCover(d.album);
          if (!rawCover) return null;
          return mapDeezerTrackItem(d, null, rawCover);
        }).filter(Boolean);
        if (newItems.length > 0) {
          mergeParsedTracksIntoCatalog(newItems);
          if (isLoadMore) searchDisplayLimit += newItems.length;
        }
      } catch (_) {}
      searchPagination.loading = false;
      state.isSearchParsing = false;
      if (state.activeTab === 'search') renderSearchView();
    }

    const LIBRARY_BROWSE_QUERIES = [
      'russian rap', 'русский рэп', 'hip hop', 'trap', 'cloud rap',
      'phonk', 'underground rap', 'pop rap', 'chill rap', 'r&b'
    ];

    async function loadMoreLibraryForSearch() {
      if (window.TelefySoundCloud?.ready) return window.TelefySoundCloud.refill(false);
      if (libraryBrowsePagination.loading || !libraryBrowsePagination.hasMore) return;
      libraryBrowsePagination.loading = true;
      try {
        let fetchedItems = [];
        if (libraryBrowsePagination.rosterIdx < RUSSIAN_RAP_ROSTER.length) {
          const batch = RUSSIAN_RAP_ROSTER.slice(libraryBrowsePagination.rosterIdx, libraryBrowsePagination.rosterIdx + 4);
          libraryBrowsePagination.rosterIdx += batch.length;
          const res = await Promise.all(batch.map(cfg => parseArtistCatalogTracks(cfg, 12)));
          fetchedItems = res.flat();
        } else {
          const qIdx = libraryBrowsePagination.queryIdx % LIBRARY_BROWSE_QUERIES.length;
          const qStr = LIBRARY_BROWSE_QUERIES[qIdx];
          const offset = libraryBrowsePagination.queryOffset;
          const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(qStr)}&index=${offset}&limit=25&output=jsonp`;
          const data = await runCoverQueueTask(() => fetchJsonpOnly(url, 4500));
          const list = (data && Array.isArray(data.data)) ? data.data : [];
          if (list.length < 25) {
            libraryBrowsePagination.queryIdx += 1;
            libraryBrowsePagination.queryOffset = 0;
          } else {
            libraryBrowsePagination.queryOffset += list.length;
          }
          const checked = await Promise.all(list.map(async (d) => {
            if (!d || !d.title || !d.artist || !d.artist.name || !d.album) return null;
            const rawCover = pickDeezerCover(d.album);
            const verifiedCover = await verifyCoverImage(rawCover);
            if (!verifiedCover) return null;
            return mapDeezerTrackItem(d, null, verifiedCover);
          }));
          fetchedItems = checked.filter(Boolean);
        }

        if (fetchedItems.length > 0) {
          mergeParsedTracksIntoCatalog(fetchedItems);
          searchDisplayLimit += fetchedItems.length;
          if (state.activeTab === 'search') renderSearchView();
        }
      } catch (_) {}
      libraryBrowsePagination.loading = false;
    }

    const FLOW_DISCOVERY_QUERIES = {
      all: [
        'русский рэп', 'russian hip hop', 'russian trap', 'new rap', 'hip hop hits',
        'russian rap 2024', 'russian rap 2025', 'trap hits', 'melodic rap', 'cloud rap',
        'russian r&b', 'rap caviar', 'urban russian', 'chill hip hop', 'hip hop essentials'
      ],
      energy: [
        'russian trap', 'phonk', 'rage rap', 'hype hip hop', 'big baby tape',
        'drift phonk', 'hard trap', 'bass boosted rap', 'workout hip hop', 'obladaet',
        'bushido zho', 'heronwater', 'gone.fludd', 'trap metal', 'gym rap'
      ],
      night: [
        'скриптонит', 'miyagi эндшпиль', 'mayot', 'macan', 'лсп', 'markul',
        'thomas mraz', 't-fest', 'lovv66', 'масло черного тмина', 'баста',
        'cloud rap', 'chill rap', 'lo-fi hip hop', 'russian r&b',
        'late night rap', 'melodic rap', 'atmospheric hip hop', 'ambient rap', 'sad rap'
      ],
      underground: [
        'underground hip hop', 'boom bap', 'russian underground', 'pharaoh', 'saluki',
        'boulevard depo', 'oxxxymiron', 'хаски', 'каста', 'friendly thug 52',
        'abstract hip hop', 'experimental rap', 'alternative hip hop', 'indie rap'
      ],
      uncensored: [
        'русский рэп', 'russian trap', 'kizaru', 'og buda', 'friendly thug',
        'alblak 52', 'soda luv', 'платина', 'lil krystalll', '163onmyneck',
        'seemee', 'pharaoh', 'hardcore hip hop', 'gangsta rap', 'explicit rap'
      ]
    };

    async function ensureCollectionTracksLoaded(col) {
      if (!col || !Array.isArray(col.targetArtists) || !col.targetArtists.length) return;
      const missingCfgs = col.targetArtists
        .map(name => findRosterConfig(name) || { name, query: name, mood: 'all', uncensoredDefault: true, aliases: [name.toLowerCase()] })
        .filter(cfg => tracks.filter(tr => doesArtistMatch(tr.artist, cfg)).length < 5);

      if (!missingCfgs.length) return;
      try {
        const res = await Promise.all(missingCfgs.slice(0, 4).map(cfg => parseArtistCatalogTracks(cfg, 10)));
        const flat = res.flat();
        if (flat.length) {
          mergeParsedTracksIntoCatalog(flat);
          renderCollections();
          if (state.activeCollectionId === col.id) {
            const listEl = document.getElementById('col-modal-tracks');
            const colModal = document.getElementById('collection-modal');
            if (listEl && colModal && !colModal.classList.contains('hidden')) {
              const updatedTracks = col.trackIds.map(id => tracks.find(x => x.id === id)).filter(Boolean);
              if (updatedTracks.length) {
                listEl.innerHTML = updatedTracks.map(createTrackRowHTML).join('');
                bindTrackRowEvents(listEl, getColText(col).title);
              }
            }
          }
        }
      } catch (_) {}
    }

    async function silentlyRefillFlowQueue(autoPlayWhenReady = false) {
      if (window.TelefySoundCloud?.ready) return window.TelefySoundCloud.refill(autoPlayWhenReady);
      const moodId = state.activeMood || 'all';
      const existingQ = new Set(state.queueIds || []);

      // 1. Pull any unplayed mood-matched tracks already in catalog
      const localCandidates = interleaveByArtist(
        tracks.filter(tr =>
          isFlowTrackUnplayed(tr) &&
          !existingQ.has(tr.id) &&
          doesTrackMatchMood(tr, moodId)
        )
      );
      if (localCandidates.length > 0) {
        const toAdd = localCandidates.slice(0, 14).map(t => t.id);
        state.queueIds = [...(state.queueIds || []), ...toAdd];
        if (autoPlayWhenReady && state.queueIds.length > 0) {
          const nextId = state.queueIds.shift();
          playTrack(nextId, state.sourceLabel);
          return;
        }
        if (state.activeTab === 'flow') renderFlowView();
      }

      if ((state.queueIds || []).length >= 12 && !autoPlayWhenReady) return;
      if (isSilentFlowFetching) return;
      isSilentFlowFetching = true;

      try {
        const pag = getMoodPagination(moodId);
        const moodOverride = moodId !== 'all' ? moodId : null;
        let freshItems = [];

        // 2. Deep artist-graph traversal (related artists)
        const moodRoster = RUSSIAN_RAP_ROSTER.filter(cfg =>
          moodId === 'all' || cfg.mood === moodId || (moodId === 'uncensored' && cfg.uncensoredDefault)
        );
        const rosterPool = moodRoster.length ? moodRoster : RUSSIAN_RAP_ROSTER;

        if (pag.cursor % 2 === 0 && (pag.relatedArtistPool.length > 0 || rosterPool.length > 0)) {
          let targetArtist = null;
          while (pag.relatedArtistPool.length > 0 && !targetArtist) {
            const candidate = pag.relatedArtistPool.shift();
            if (candidate && candidate.id && !pag.visitedArtistIds.has(String(candidate.id))) {
              targetArtist = candidate;
            }
          }
          if (!targetArtist && rosterPool.length > 0) {
            const cfg = rosterPool[Math.floor(pag.cursor / 2) % rosterPool.length];
            const resolved = await resolveDeezerArtist(cfg);
            if (resolved && resolved.id) {
              if (!pag.visitedArtistIds.has(String(resolved.id))) {
                targetArtist = resolved;
              } else {
                const relatedUrl = `https://api.deezer.com/artist/${resolved.id}/related?limit=15&output=jsonp`;
                const relData = await runCoverQueueTask(() => fetchJsonpOnly(relatedUrl, 4000));
                const relList = (relData && Array.isArray(relData.data)) ? relData.data : [];
                relList.forEach(a => {
                  if (a && a.id && !pag.visitedArtistIds.has(String(a.id))) {
                    pag.relatedArtistPool.push(a);
                  }
                });
                targetArtist = pag.relatedArtistPool.shift() || resolved;
              }
            }
          }

          if (targetArtist && targetArtist.id) {
            pag.visitedArtistIds.add(String(targetArtist.id));
            const topUrl = `https://api.deezer.com/artist/${targetArtist.id}/top?limit=25&output=jsonp`;
            const relUrl = `https://api.deezer.com/artist/${targetArtist.id}/related?limit=12&output=jsonp`;
            const [topData, relData] = await Promise.all([
              runCoverQueueTask(() => fetchJsonpOnly(topUrl, 4500)),
              runCoverQueueTask(() => fetchJsonpOnly(relUrl, 4000))
            ]);
            const relList = (relData && Array.isArray(relData.data)) ? relData.data : [];
            relList.forEach(a => {
              if (a && a.id && !pag.visitedArtistIds.has(String(a.id))) {
                pag.relatedArtistPool.push(a);
              }
            });
            const rawList = (topData && Array.isArray(topData.data)) ? topData.data : [];
            const checked = await Promise.all(rawList.map(async (d) => {
              if (!d || !d.title || !d.artist || !d.artist.name || !d.album) return null;
              const rawCover = pickDeezerCover(d.album);
              const verifiedCover = await verifyCoverImage(rawCover);
              if (!verifiedCover) return null;
              return mapDeezerTrackItem(d, { name: d.artist.name, mood: moodId }, verifiedCover, null, moodOverride);
            }));
            freshItems = checked.filter(Boolean);
          }
        }

        // 3. Paginated mood-specific search queries
        if (freshItems.length < 8) {
          const qPool = FLOW_DISCOVERY_QUERIES[moodId] || FLOW_DISCOVERY_QUERIES.all;
          const qStr = qPool[pag.cursor % qPool.length];
          const offset = pag.queryOffsets[qStr] || 0;
          const searchUrl = `https://api.deezer.com/search/track?q=${encodeURIComponent(qStr)}&index=${offset}&limit=25&output=jsonp`;
          const sData = await runCoverQueueTask(() => fetchJsonpOnly(searchUrl, 4500));
          const sList = (sData && Array.isArray(sData.data)) ? sData.data : [];
          pag.queryOffsets[qStr] = offset + Math.max(sList.length, 25);
          const checked = await Promise.all(sList.map(async (d) => {
            if (!d || !d.title || !d.artist || !d.artist.name || !d.album) return null;
            const rawCover = pickDeezerCover(d.album);
            const verifiedCover = await verifyCoverImage(rawCover);
            if (!verifiedCover) return null;
            return mapDeezerTrackItem(d, null, verifiedCover, null, moodOverride);
          }));
          freshItems = [...freshItems, ...checked.filter(Boolean)];
        }

        pag.cursor += 1;

        if (freshItems.length > 0) {
          mergeParsedTracksIntoCatalog(freshItems);
          const qSet = new Set(state.queueIds || []);
          const newlyPlayable = interleaveByArtist(
            tracks.filter(tr =>
              isFlowTrackUnplayed(tr) &&
              !qSet.has(tr.id) &&
              doesTrackMatchMood(tr, moodId)
            )
          );
          if (newlyPlayable.length > 0) {
            state.queueIds = [...(state.queueIds || []), ...newlyPlayable.slice(0, 18).map(t => t.id)];
          }
          if (autoPlayWhenReady && state.queueIds.length > 0) {
            const nextId = state.queueIds.shift();
            playTrack(nextId, state.sourceLabel);
          } else if (state.activeTab === 'flow') {
            renderFlowView();
          }
        }
      } catch (_) {}
      isSilentFlowFetching = false;
    }

    function buildLocalArtistAlbums(artistName) {
      const primary = getPrimaryArtistName(artistName);
      const map = new Map();
      tracks.forEach(tr => {
        if (!doesArtistMatch(tr.artist, primary) || !tr.album || !tr.coverImg) return;
        const key = tr.collectionId ? String(tr.collectionId) : normalizeTrackTitleKey(tr.album);
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, {
            collectionId: tr.collectionId || key,
            deezerAlbumId: tr.deezerAlbumId || null,
            title: tr.album,
            artistName: primary,
            year: tr.releaseYear || '2024',
            trackCount: 1,
            img: tr.coverImg
          });
        } else {
          map.get(key).trackCount += 1;
        }
      });
      return Array.from(map.values());
    }

    async function fetchDeezerArtistAlbums(artistName) {
      const primary = getPrimaryArtistName(artistName);
      const cacheKey = normalizeArtistToken(primary);
      if (Array.isArray(DEEZER_ALBUMS_CACHE[cacheKey]) && DEEZER_ALBUMS_CACHE[cacheKey].length) {
        return DEEZER_ALBUMS_CACHE[cacheKey];
      }

      const rosterCfg = findRosterConfig(primary) || primary;
      try {
        const resolved = await resolveDeezerArtist(rosterCfg);
        if (resolved && resolved.id) {
          const url = `https://api.deezer.com/artist/${resolved.id}/albums?limit=25&output=jsonp`;
          const data = await runCoverQueueTask(() => fetchJsonpOnly(url, 4500));
          const raw = (data && Array.isArray(data.data)) ? data.data : [];
          if (raw.length) {
            const sorted = [...raw].sort((a, b) => new Date(b.release_date || 0) - new Date(a.release_date || 0));
            const seen = new Set();
            const candidates = [];
            for (const item of sorted) {
              if (!item || !item.id || !item.title) continue;
              const cleanTitle = formatAlbumTitle(item.title) || item.title;
              const normTitle = normalizeTrackTitleKey(cleanTitle);
              if (!normTitle || seen.has(item.id) || seen.has(normTitle)) continue;
              seen.add(item.id);
              seen.add(normTitle);
              candidates.push({ item, cleanTitle });
              if (candidates.length >= 16) break;
            }
            const verified = await Promise.all(candidates.map(async ({ item, cleanTitle }) => {
              const rawImg = pickDeezerCover(item);
              const verifiedImg = await verifyCoverImage(rawImg);
              if (!verifiedImg) return null;
              return {
                collectionId: `dz_alb_${item.id}`,
                deezerAlbumId: item.id,
                title: cleanTitle,
                artistName: resolved.name || primary,
                year: item.release_date ? String(item.release_date).slice(0, 4) : '2024',
                trackCount: 0,
                recordType: item.record_type || 'album',
                img: verifiedImg
              };
            }));
            const albums = verified.filter(Boolean).slice(0, 14);
            if (albums.length) {
              DEEZER_ALBUMS_CACHE[cacheKey] = albums;
              saveDeezerAlbumsCache();
              return albums;
            }
          }
        }
      } catch (_) {}

      const fallbackLocal = buildLocalArtistAlbums(primary);
      if (fallbackLocal.length) {
        DEEZER_ALBUMS_CACHE[cacheKey] = fallbackLocal;
      }
      return fallbackLocal;
    }

    async function fetchDeezerAlbumTracks(album) {
      if (!album) return [];
      const cid = String(album.collectionId || '');
      if (cid && Array.isArray(DEEZER_ALBUM_TRACKS_CACHE[cid]) && DEEZER_ALBUM_TRACKS_CACHE[cid].length) {
        return DEEZER_ALBUM_TRACKS_CACHE[cid];
      }

      const rawId = album.deezerAlbumId || (cid.startsWith('dz_alb_') ? cid.replace(/^dz_alb_/, '') : (/^\d+$/.test(cid) ? cid : null));
      if (rawId) {
        try {
          const url = `https://api.deezer.com/album/${encodeURIComponent(rawId)}?output=jsonp`;
          const data = await runCoverQueueTask(() => fetchJsonpOnly(url, 4500));
          const items = (data && data.tracks && Array.isArray(data.tracks.data)) ? data.tracks.data : [];
          if (items.length) {
            const albumCover = album.img || pickDeezerCover(data);
            const albumYear = album.year || (data.release_date ? String(data.release_date).slice(0, 4) : '2024');
            const parsed = items.map((item, idx) => ({
              deezerTrackId: item.id ? String(item.id) : null,
              deezerArtistId: item.artist?.id || data.artist?.id || null,
              collectionId: album.collectionId || `dz_alb_${rawId}`,
              deezerAlbumId: Number(rawId) || rawId,
              trackNumber: item.track_position || (idx + 1),
              title: String(item.title || item.title_short || '').trim(),
              artist: String(item.artist?.name || album.artistName).trim(),
              album: album.title || formatAlbumTitle(data.title),
              releaseYear: albumYear,
              duration: item.duration ? Math.max(30, Number(item.duration)) : 180,
              uncensored: Boolean(item.explicit_lyrics),
              coverImg: albumCover,
              previewUrl: item.preview || null
            }));
            if (cid) {
              DEEZER_ALBUM_TRACKS_CACHE[cid] = parsed;
              saveDeezerAlbumTracksCache();
            }
            return parsed;
          }
        } catch (_) {}
      }
      return [];
    }

    function ensureCatalogTrackFromAlbum(item, album) {
      const kTarget = `${normalizeArtistToken(getPrimaryArtistName(item.artist))}::${normalizeTrackTitleKey(item.title)}`;
      let existing = tracks.find(tr =>
        `${normalizeArtistToken(getPrimaryArtistName(tr.artist))}::${normalizeTrackTitleKey(tr.title)}` === kTarget
      );
      if (existing) {
        if (item.coverImg || album.img) {
          existing.coverImg = item.coverImg || album.img;
          existing.coverStatus = 'loaded';
        }
        if (album.title) existing.album = album.title;
        if (album.collectionId) existing.collectionId = album.collectionId;
        if (item.previewUrl) existing.previewUrl = item.previewUrl;
        syncTrackCoverAcrossDOM(existing.id);
        return existing;
      }
      const nextId = tracks.reduce((mx, x) => Math.max(mx, Number(x.id) || 0), 0) + 1;
      const rosterCfg = findRosterConfig(item.artist);
      const newTrack = {
        id: nextId,
        deezerTrackId: item.deezerTrackId || null,
        deezerArtistId: item.deezerArtistId || null,
        collectionId: album.collectionId || null,
        deezerAlbumId: album.deezerAlbumId || null,
        title: item.title,
        artist: item.artist,
        primaryArtist: rosterCfg ? rosterCfg.name : getPrimaryArtistName(item.artist),
        album: album.title || item.album || '',
        releaseYear: album.year || '2024',
        duration: item.duration || 180,
        mood: rosterCfg ? rosterCfg.mood : 'all',
        uncensored: Boolean(item.uncensored),
        liked: false,
        disliked: false,
        cover: TRACK_ACCENT_COLORS[nextId % TRACK_ACCENT_COLORS.length],
        coverImg: item.coverImg || album.img || null,
        previewUrl: item.previewUrl || null,
        coverStatus: 'loaded'
      };
      tracks.push(newTrack);
      saveParsedCatalogCache();
      return newTrack;
    }

    let activeAlbumModalData = null;
    let activeAlbumTracks = [];

    function renderAlbumModalTracks() {
      const listEl = document.getElementById('album-modal-tracks');
      if (!listEl || !activeAlbumModalData) return;
      if (!activeAlbumTracks.length) {
        listEl.innerHTML = `<div class="text-center py-10 text-xs text-muted">${t('albumTracksEmpty')}</div>`;
        return;
      }
      listEl.innerHTML = activeAlbumTracks.map((tr, idx) => {
        const isCurrent = tr.id === state.currentTrackId;
        return `
          <div class="tg-row gap-3">
            <div data-album-play="${tr.id}" class="album-track-trigger flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
              <span class="w-6 text-center text-xs font-semibold ${isCurrent ? 'text-[#2AABEE]' : 'text-[var(--text-muted)]'} shrink-0">
                ${isCurrent ? (state.isPlaying ? '❚❚' : '▶') : (idx + 1)}
              </span>
              <div data-track-cover="${tr.id}" class="w-9 h-9 squircle-cover-sm shrink-0 bg-cover bg-center bg-no-repeat relative overflow-hidden flex items-center justify-center text-white text-[11px] font-bold" style="background-color: ${tr.cover || '#1E3A8A'}; ${tr.coverImg ? `background-image: url('${tr.coverImg}')` : ''}">
                ${renderCoverImgTag(tr.coverImg)}
                <span class="cover-fallback-glyph relative z-10 text-[11px] opacity-80 ${tr.coverImg ? 'hidden' : ''}">♫</span>
              </div>
              <div class="min-w-0 flex-1">
                <p data-track-row-title="${t.id}" class="text-[14px] font-medium ${isCurrent ? 'text-[#2AABEE]' : ''} truncate">${tr.title}</p>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span class="telefy-explicit" title="Может содержать ненормативную лексику" aria-label="Возможна ненормативная лексика">E</span>
                  <p class="text-xs text-muted truncate">${tr.artist}</p>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs text-muted">${formatTime(tr.duration)}</span>
              <button data-like="${tr.id}" class="track-like-btn p-1 rounded-full ${tr.liked ? 'text-[#FF3B30]' : 'text-muted opacity-40 hover:opacity-80'} transition"><span class="tg-ico text-[16px]">${tr.liked ? '&#xF016;' : '&#xF1D9;'}</span></button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.album-track-trigger').forEach((el, idx) => {
        el.addEventListener('click', () => {
          const tid = Number(el.dataset.albumPlay);
          const restIds = activeAlbumTracks.slice(idx + 1).map(x => x.id);
          if (restIds.length) state.queueIds = [...restIds, ...state.queueIds.filter(id => !restIds.includes(id) && id !== tid)];
          playTrack(tid, activeAlbumModalData.title);
          renderAlbumModalTracks();
        });
      });

      listEl.querySelectorAll('.track-like-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLike(Number(btn.dataset.like));
          renderAlbumModalTracks();
        });
      });
    }

    async function openAlbumModal(album, artistDisplayName) {
      if (!album) return;
      activeAlbumModalData = album;
      activeAlbumTracks = [];

      const backLabel = document.getElementById('album-back-artist-label');
      if (backLabel) backLabel.textContent = artistDisplayName || album.artistName;

      const coverEl = document.getElementById('album-modal-cover');
      if (coverEl) {
        applyCoverStyle(coverEl, { coverImg: album.img, cover: '#1E3A8A', coverStatus: 'loaded' });
      }
      document.getElementById('album-modal-title').textContent = album.title;
      document.getElementById('album-modal-artist').textContent = artistDisplayName || album.artistName;

      // Immediately populate with matching album tracks already in catalog
      const normAlb = normalizeTrackTitleKey(album.title);
      const localAlbumTracks = tracks.filter(tr =>
        (album.collectionId && tr.collectionId && String(tr.collectionId) === String(album.collectionId)) ||
        (normAlb && normalizeTrackTitleKey(tr.album) === normAlb && doesArtistMatch(tr.artist, artistDisplayName || album.artistName))
      );
      if (localAlbumTracks.length) {
        activeAlbumTracks = localAlbumTracks;
      }

      const initialCount = album.trackCount || activeAlbumTracks.length;
      const trackCountTxt = initialCount ? ` · ${initialCount} ${state.lang === 'en' ? 'tracks' : 'треков'}` : '';
      document.getElementById('album-modal-meta').textContent = `${album.year || '2024'}${trackCountTxt}`;

      const listEl = document.getElementById('album-modal-tracks');
      if (activeAlbumTracks.length) {
        renderAlbumModalTracks();
      } else {
        listEl.innerHTML = window.TelefySkeleton.html();
      }

      openSheetModal('album-modal', 'light');

      const fetched = await fetchDeezerAlbumTracks(album);
      if (activeAlbumModalData !== album) return;

      if (fetched.length) {
        activeAlbumTracks = fetched.map(item => ensureCatalogTrackFromAlbum(item, album));
      } else if (!activeAlbumTracks.length) {
        const primary = getPrimaryArtistName(artistDisplayName || album.artistName);
        activeAlbumTracks = tracks.filter(tr => doesArtistMatch(tr.artist, primary)).slice(0, 10);
      }

      if (activeAlbumTracks.length) {
        document.getElementById('album-modal-meta').textContent = `${album.year || '2024'} · ${activeAlbumTracks.length} ${state.lang === 'en' ? 'tracks' : 'треков'}`;
      }
      renderAlbumModalTracks();
    }

    function closeAlbumModal() {
      closeSheetModal('album-modal');
    }

    function renderArtistAlbumsCarousel(albums, cleanName, albumsEl) {
      if (!albumsEl) return;
      albumsEl.innerHTML = albums.map((alb, idx) => `
        <button type="button" data-album-idx="${idx}" class="artist-album-card text-left shrink-0 w-[132px] cursor-pointer active:scale-[0.96] transition group">
          <div class="w-[132px] h-[132px] squircle-cover-md bg-cover bg-center bg-no-repeat shadow-sm mb-1.5 relative overflow-hidden flex items-center justify-center text-white text-xl font-bold" style="background-color: #1E3A8A; ${alb.img ? `background-image: url('${alb.img}')` : ''}">
            ${renderCoverImgTag(alb.img)}
            <span class="cover-fallback-glyph relative z-10 ${alb.img ? 'hidden' : ''}">♫</span>
            <div class="absolute inset-0 z-10 bg-black/0 group-hover:bg-black/20 transition flex items-end justify-end p-2">
              <span class="w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center text-[11px] opacity-90">▶</span>
            </div>
          </div>
          <p class="text-[13px] font-semibold truncate">${alb.title}</p>
          <p class="text-[11px] text-[var(--text-muted)] truncate">${alb.year}${alb.trackCount ? ` · ${alb.trackCount} ${state.lang === 'en' ? 'tracks' : 'тр.'}` : ''}</p>
        </button>
      `).join('');

      albumsEl.querySelectorAll('.artist-album-card').forEach(btn => {
        btn.addEventListener('click', () => {
          const alb = albums[Number(btn.dataset.albumIdx)];
          if (alb) openAlbumModal(alb, cleanName);
        });
      });
    }

    async function openArtistCard(artistName) {
      const cleanName = getPrimaryArtistName(artistName || getTrack(state.currentTrackId)?.artist || 'Big Baby Tape');
      let artistTracks = tracks.filter(tr => window.TelefyArtistCredits(tr.artist, cleanName));

      const avatarEl = document.getElementById('artist-modal-avatar');
      const initialAvatar = getArtistAvatarUrl(cleanName) || artistTracks[0]?.coverImg || null;
      if (avatarEl) {
        applyCoverStyle(avatarEl, { coverImg: initialAvatar, cover: artistTracks[0]?.cover || '#2AABEE', coverStatus: initialAvatar ? 'loaded' : 'loading' });
        const glyph = avatarEl.querySelector('.cover-fallback-glyph');
        if (glyph && !initialAvatar) glyph.textContent = cleanName.charAt(0).toUpperCase();
      }
      document.getElementById('artist-modal-name').textContent = cleanName;
      window.TelefyArtistNotices.render(cleanName);
      document.getElementById('artist-modal-listeners').textContent = `${getArtistListeners(cleanName)} ${t('monthlyListeners')}`;

      const tracksEl = document.getElementById('artist-modal-tracks');
      if (artistTracks.length) {
        tracksEl.innerHTML = artistTracks.slice(0, 6).map(createTrackRowHTML).join('');
        bindTrackRowEvents(tracksEl);
      } else {
        tracksEl.innerHTML = window.TelefySkeleton.html();
      }

      const albumsEl = document.getElementById('artist-modal-albums');
      const localAlbums = buildLocalArtistAlbums(cleanName);
      if (localAlbums.length) {
        renderArtistAlbumsCarousel(localAlbums, cleanName, albumsEl);
      } else {
        albumsEl.innerHTML = window.TelefySkeleton.html('cards',2);
      }

      openSheetModal('artist-modal', 'light');

      // If this artist has few tracks in catalog, parse more tracks for them live
      if (artistTracks.length < 4) {
        const cfg = findRosterConfig(cleanName) || { name: cleanName, query: cleanName, mood: 'all', uncensoredDefault: true, aliases: [cleanName.toLowerCase()] };
        const freshTracks = await parseArtistCatalogTracks(cfg, 8);
        if (freshTracks.length) {
          mergeParsedTracksIntoCatalog(freshTracks);
          artistTracks = tracks.filter(tr => doesArtistMatch(tr.artist, cleanName));
          if (document.getElementById('artist-modal-name').textContent === cleanName && artistTracks.length) {
            tracksEl.innerHTML = artistTracks.slice(0, 6).map(createTrackRowHTML).join('');
            bindTrackRowEvents(tracksEl);
          }
        }
      }

      if(document.getElementById('artist-modal-name').textContent===cleanName&&!artistTracks.length)tracksEl.innerHTML='<p class="release-empty">'+(state.lang==='en'?'No tracks found':'Треки не найдены')+'</p>';
      const albums = await fetchDeezerArtistAlbums(cleanName);
      if (document.getElementById('artist-modal-name').textContent !== cleanName) return;

      if (!albums.length) {
        if (!localAlbums.length) {
          albumsEl.innerHTML = `
            <div class="w-full py-5 px-3 tg-card flex items-center justify-between gap-3">
              <span class="text-xs text-muted">${t('albumsEmpty')}</span>
              <button id="btn-retry-artist-albums" type="button" class="px-3 py-1 rounded-full bg-elevated text-xs font-medium">${t('retryLabel')}</button>
            </div>
          `;
          document.getElementById('btn-retry-artist-albums')?.addEventListener('click', () => openArtistCard(cleanName));
        }
        return;
      }

      const bestAvatar = getArtistAvatarUrl(cleanName) || albums[0].img;
      if (bestAvatar && avatarEl) {
        applyCoverStyle(avatarEl, { coverImg: bestAvatar, cover: '#2AABEE', coverStatus: 'loaded' });
      }
      renderPlayerUI();
      renderArtistAlbumsCarousel(albums, cleanName, albumsEl);
    }

    function closeArtistModal() {
      closeSheetModal('artist-modal');
    }

    document.getElementById('btn-open-artist-card')?.addEventListener('click', () => {
      const current = getTrack(state.currentTrackId);
      openArtistCard(current?.artist);
    });
    document.getElementById('full-artist')?.addEventListener('click', () => {
      const current = getTrack(state.currentTrackId);
      openArtistCard(current?.artist);
    });
    document.getElementById('hero-track-artist')?.addEventListener('click', () => {
      const current = getTrack(state.currentTrackId);
      openArtistCard(current?.artist);
    });
    document.getElementById('full-album-btn')?.addEventListener('click', () => {
      const current = getTrack(state.currentTrackId);
      if (current && current.album) {
        openAlbumModal({
          collectionId: current.collectionId,
          title: current.album,
          artistName: getPrimaryArtistName(current.artist),
          year: current.releaseYear || '2024',
          trackCount: 0,
          img: current.coverImg
        }, getPrimaryArtistName(current.artist));
      }
    });
    document.getElementById('btn-close-artist-modal')?.addEventListener('click', closeArtistModal);
    document.getElementById('artist-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'artist-modal') closeArtistModal();
    });
    document.getElementById('btn-close-album-modal')?.addEventListener('click', closeAlbumModal);
    document.getElementById('btn-back-to-artist')?.addEventListener('click', closeAlbumModal);
    document.getElementById('album-modal-artist')?.addEventListener('click', closeAlbumModal);
    document.getElementById('album-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'album-modal') closeAlbumModal();
    });
    document.getElementById('btn-album-play-all')?.addEventListener('click', () => {
      if (!activeAlbumTracks.length || !activeAlbumModalData) return;
      const first = activeAlbumTracks[0];
      const restIds = activeAlbumTracks.slice(1).map(x => x.id);
      if (restIds.length) state.queueIds = [...restIds, ...state.queueIds.filter(id => !restIds.includes(id) && id !== first.id)];
      playTrack(first.id, activeAlbumModalData.title);
      renderAlbumModalTracks();
    });
    document.getElementById('btn-album-shuffle')?.addEventListener('click', () => {
      if (!activeAlbumTracks.length || !activeAlbumModalData) return;
      const shuffled = [...activeAlbumTracks].sort(() => Math.random() - 0.5);
      const first = shuffled[0];
      const restIds = shuffled.slice(1).map(x => x.id);
      if (restIds.length) state.queueIds = [...restIds, ...state.queueIds.filter(id => !restIds.includes(id) && id !== first.id)];
      playTrack(first.id, activeAlbumModalData.title);
      renderAlbumModalTracks();
    });

    function openFullPlayer() {
      const modal = document.getElementById('full-player-modal');
      if (!modal) return;
      if(modal._dismissMotion){modal._dismissMotion.cancel();modal._dismissMotion=null;}
      if (modal._closeTimer) {
        clearTimeout(modal._closeTimer);
        modal._closeTimer = null;
      }
      modal.style.transform = '';
      modal.style.transition = '';
      modal.classList.remove('hidden','is-closing');
      modal.classList.add('sheet-closed');
      modal.classList.remove('sheet-open');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          modal.classList.remove('sheet-closed');
          modal.classList.add('sheet-open');
        });
      });
    }
    function closeFullPlayer() {
      const modal=document.getElementById('full-player-modal');
      if(modal)animateDismiss(modal,modal,()=>{modal.classList.remove('sheet-open');modal.classList.add('sheet-closed');});
    }

    let miniDidSwipe = false;
    document.getElementById('mini-player-open').addEventListener('click', (e) => {
      if (miniDidSwipe) {
        miniDidSwipe = false;
        e.preventDefault();
        return;
      }
      openFullPlayer();
    });

    // Strictly horizontal swipe on mini-player to switch tracks (no rotation/bend)
    const miniCard = document.getElementById('mini-player-card');
    if (miniCard) {
      let startX = 0, startY = 0, currentDx = 0, isDragging = false, lockHorizontal = false;

      const onStart = (x, y, target) => {
        if (target.closest('#mini-like-btn') || target.closest('#mini-play-btn')) return;
        startX = x;
        startY = y;
        currentDx = 0;
        isDragging = true;
        lockHorizontal = false;
        miniCard.style.transition = 'none';
      };

      const onMove = (x, y) => {
        if (!isDragging) return;
        const dx = x - startX;
        const dy = y - startY;
        if (!lockHorizontal) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            lockHorizontal = true;
          } else if (Math.abs(dy) > 10) {
            isDragging = false;
            return;
          } else {
            return;
          }
        }
        currentDx = dx;
        miniCard.style.transform = `translateX(${dx.toFixed(1)}px)`;
        miniCard.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 220));
      };

      const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        if (!lockHorizontal) {
          miniCard.style.transform = '';
          miniCard.style.opacity = '';
          return;
        }
        miniDidSwipe = true;
        setTimeout(() => { miniDidSwipe = false; }, 120);

        if (currentDx < -55) {
          // Swipe Left -> Next Track
          triggerHaptic('light');
          miniCard.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
          miniCard.style.transform = 'translateX(-110%)';
          miniCard.style.opacity = '0';
          setTimeout(() => {
            playNext();
            miniCard.style.transition = 'none';
            miniCard.style.transform = 'translateX(44px)';
            void miniCard.offsetWidth;
            miniCard.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease';
            miniCard.style.transform = 'translateX(0px)';
            miniCard.style.opacity = '1';
          }, 160);
        } else if (currentDx > 55) {
          // Swipe Right -> Previous Track
          triggerHaptic('light');
          miniCard.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
          miniCard.style.transform = 'translateX(110%)';
          miniCard.style.opacity = '0';
          setTimeout(() => {
            playPrev();
            miniCard.style.transition = 'none';
            miniCard.style.transform = 'translateX(-44px)';
            void miniCard.offsetWidth;
            miniCard.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease';
            miniCard.style.transform = 'translateX(0px)';
            miniCard.style.opacity = '1';
          }, 160);
        } else {
          // Snap cleanly back
          miniCard.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease';
          miniCard.style.transform = 'translateX(0px)';
          miniCard.style.opacity = '1';
        }
      };

      miniCard.addEventListener('pointerdown', (e) => onStart(e.clientX, e.clientY, e.target));
      window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    }
    document.getElementById('btn-close-full-player').addEventListener('click', closeFullPlayer);
    document.getElementById('mini-play-btn').addEventListener('click', togglePlay);
    document.getElementById('full-play-btn').addEventListener('click', togglePlay);
    document.getElementById('full-next-btn').addEventListener('click', () => {
      triggerHaptic('light');
      animateFullSwipe(-1);
    });
    document.getElementById('full-prev-btn').addEventListener('click', () => {
      triggerHaptic('light');
      animateFullSwipe(1);
    });
    document.getElementById('mini-like-btn').addEventListener('click', () => toggleLike(state.currentTrackId));
    document.getElementById('full-like-btn').addEventListener('click', () => toggleLike(state.currentTrackId));

    // Native range keeps its seek behavior; feedback only changes the thumb scale.
    (() => {
      const slider = document.getElementById('full-seek-slider');
      let heldPointer = null;
      let heldKey = false;
      const seekKeys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
      const refresh = () => slider.classList.toggle('is-seeking', heldPointer !== null || heldKey);
      const reset = () => { heldPointer = null; heldKey = false; refresh(); };
      slider.addEventListener('pointerdown', e => {
        if (!e.isPrimary || e.button !== 0) return;
        heldPointer = e.pointerId;
        refresh();
      });
      const release = e => { if (e.pointerId === heldPointer) { heldPointer = null; refresh(); } };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      slider.addEventListener('lostpointercapture', release);
      slider.addEventListener('keydown', e => { if (seekKeys.has(e.key)) { heldKey = true; refresh(); } });
      slider.addEventListener('keyup', e => { if (seekKeys.has(e.key)) { heldKey = false; refresh(); } });
      slider.addEventListener('blur', reset);
      window.addEventListener('blur', reset);
      document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
    })();

    document.getElementById('full-seek-slider').addEventListener('input', (e) => {
      const audio = document.getElementById('telefy-audio');
      const cur = getTrack(state.currentTrackId);
      if (audio && cur) {
        const targetSec = (Number(e.target.value) / 100) * (audio.duration || cur.duration);
        audio.currentTime = targetSec;
      }
      const current = getTrack(state.currentTrackId);
      state.progressSec = (Number(e.target.value) / 100) * current.duration;
      updateProgressUI();
    });

    document.getElementById('btn-send-to-bot').addEventListener('click', notifyTrackOfflineExport);

    let lyricsOpen = false;
    let isRepeat = false;
    let isShuffle = false;
    const btnLyrics = document.getElementById('btn-full-lyrics');
    btnLyrics.addEventListener('click', () => {
      triggerHaptic('light');
      lyricsOpen = !lyricsOpen;
      const lBox = document.getElementById('full-lyrics-box');
      if (lBox) {
        lBox.classList.toggle('lyrics-visible', lyricsOpen);
        lBox.classList.toggle('lyrics-hidden', !lyricsOpen);
      }
      btnLyrics.classList.toggle('text-[#2AABEE]', lyricsOpen);
      btnLyrics.classList.toggle('text-muted', !lyricsOpen);
    });

    document.getElementById('full-dislike-btn').addEventListener('click', () => {
      triggerHaptic('light');
      showToast(t('toastSkipped'));
      animateFullSwipe(-1);
    });
    document.getElementById('btn-full-repeat').addEventListener('click', (e) => {
      triggerHaptic('light');
      isRepeat = !isRepeat;
      e.currentTarget.classList.toggle('text-[#2AABEE]', isRepeat);
      e.currentTarget.classList.toggle('text-muted', !isRepeat);
      showToast(isRepeat ? t('toastRepeatOn') : t('toastRepeatOff'));
    });
    document.getElementById('btn-full-shuffle').addEventListener('click', (e) => {
      triggerHaptic('light');
      isShuffle = !isShuffle;
      e.currentTarget.classList.toggle('text-[#2AABEE]', isShuffle);
      e.currentTarget.classList.toggle('text-muted', !isShuffle);
      showToast(isShuffle ? t('toastShuffleOn') : t('toastShuffleOff'));
    });
    document.getElementById('btn-full-queue').addEventListener('click', () => window.TelefyPlayerQueue.open());

    const fullCoverEl=document.getElementById('full-cover');
    let fullSwipe=null,fullSwipeBusy=false;
    const fullReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    async function fullCoverAnimate(frames,duration){if(fullReduced()){Object.assign(fullCoverEl.style,frames[frames.length-1]);return;}const a=fullCoverEl.animate(frames,{duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});try{await a.finished;}catch(_){}const last=frames[frames.length-1];Object.assign(fullCoverEl.style,last);a.cancel();}
    async function resetFullPos(){fullSwipeBusy=true;try{await fullCoverAnimate([{transform:fullCoverEl.style.transform||'none',opacity:1},{transform:'translateX(0px) rotate(0deg)',opacity:1}],240);}finally{fullSwipeBusy=false;}}
    async function animateFullSwipe(direction){
      if(fullSwipeBusy)return;fullSwipeBusy=true;
      try{
        await fullCoverAnimate([{transform:fullCoverEl.style.transform||'none',opacity:1},{transform:`translateX(${direction*220}px) rotate(${direction*34}deg) scale(.9)`,opacity:0}],190);
        // Preserve the existing ordered queue and previous/restart behavior.
        if(direction<0)playNext();else playPrev();
        fullCoverEl.style.transform=`translateX(${-direction*200}px) rotate(${-direction*30}deg) scale(.9)`;fullCoverEl.style.opacity='0';
        await fullCoverAnimate([{transform:fullCoverEl.style.transform,opacity:0},{transform:'translateX(0px) rotate(0deg) scale(1)',opacity:1}],340);
      }finally{fullCoverEl.style.transform='translateX(0px) rotate(0deg)';fullCoverEl.style.opacity='1';fullSwipeBusy=false;}
    }
    fullCoverEl.addEventListener('pointerdown',e=>{if(fullSwipeBusy||e.isPrimary===false||e.button>0)return;fullSwipe={x:e.clientX,y:e.clientY,id:e.pointerId,axis:null};fullCoverEl.style.transition='none';try{fullCoverEl.setPointerCapture(e.pointerId);}catch(_){}});
    fullCoverEl.addEventListener('pointermove',e=>{if(!fullSwipe||fullSwipe.id!==e.pointerId)return;const dx=e.clientX-fullSwipe.x,dy=e.clientY-fullSwipe.y;if(!fullSwipe.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)fullSwipe.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';if(fullSwipe.axis!=='x')return;const offset=Math.max(-150,Math.min(150,dx*.65));fullCoverEl.style.transform=`translateX(${offset}px) rotate(${offset*.13}deg)`;});
    function finishFullSwipe(e,cancel=false){if(!fullSwipe||fullSwipe.id!==e.pointerId)return;const swipe=fullSwipe;fullSwipe=null;try{fullCoverEl.releasePointerCapture(e.pointerId);}catch(_){}const dx=e.clientX-swipe.x;if(!cancel&&swipe.axis==='x'&&Math.abs(dx)>52)animateFullSwipe(dx>0?1:-1);else resetFullPos();}
    fullCoverEl.addEventListener('pointerup',e=>finishFullSwipe(e));fullCoverEl.addEventListener('pointercancel',e=>finishFullSwipe(e,true));

    let fModeStartX = 0;
    let fModeLastX = 0;
    let fModeDragging = false;
    const fModeStage = document.getElementById('flow-mode-stage');

    let flowModeLabelAnimation = null;
    let flowModeIconAnimation = null;
    function animateFlowModeSwipe(dir) {
      flowModeIndex = (flowModeIndex + (dir < 0 ? 1 : -1) + MOODS.length) % MOODS.length;
      applyStreamMode(MOODS[flowModeIndex].id, true);
      const label = document.getElementById('flow-mode-label');
      flowModeLabelAnimation?.cancel();
      flowModeIconAnimation?.cancel();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        flowModeLabelAnimation = label.animate([{ opacity:.35 }, { opacity:1 }], { duration:180, easing:'ease-out' });
        flowModeIconAnimation = document.getElementById('flow-mode-icon').animate(
          [{transform:`scale(.85) rotate(${dir < 0 ? -8 : 8}deg)`,opacity:.55},{transform:'scale(1) rotate(0deg)',opacity:1}],
          {duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
      }
    }

    fModeStage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      fModeStartX = e.clientX;
      fModeLastX = e.clientX;
      fModeDragging = true;
      try { fModeStage.setPointerCapture(e.pointerId); } catch (_) {}
    });

    fModeStage.addEventListener('pointermove', (e) => {
      if (!fModeDragging) return;
      fModeLastX = e.clientX;
    });

    fModeStage.addEventListener('pointerup', (e) => {
      if (!fModeDragging) return;
      fModeDragging = false;
      try { fModeStage.releasePointerCapture(e.pointerId); } catch (_) {}
      const dx = (e.clientX ?? fModeLastX) - fModeStartX;
      if (Math.abs(dx) > 40) {
        animateFlowModeSwipe(dx > 0 ? 1 : -1);
      }
    });

    fModeStage.addEventListener('pointercancel', () => {
      if (!fModeDragging) return;
      fModeDragging = false;
    });
    document.getElementById('flow-mode-prev').addEventListener('click', () => { triggerHaptic('light'); animateFlowModeSwipe(1); });
    document.getElementById('flow-mode-next').addEventListener('click', () => { triggerHaptic('light'); animateFlowModeSwipe(-1); });


    const mainSearchInputEl = document.getElementById('search-input');
    const clearMainSearchBtn = document.getElementById('btn-clear-main-search');
    mainSearchInputEl.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearMainSearchBtn) clearMainSearchBtn.classList.toggle('hidden', !state.searchQuery.length);
      searchDisplayLimit = 40;
      renderSearchView();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      const qVal = state.searchQuery.trim();
      if (qVal.length >= 2) {
        searchDebounceTimer = setTimeout(() => {
          parseSearchQueryLive(qVal, false);
        }, 260);
      }
    });
    if (clearMainSearchBtn) {
      clearMainSearchBtn.addEventListener('click', () => {
        state.searchQuery = '';
        mainSearchInputEl.value = '';
        clearMainSearchBtn.classList.add('hidden');
        searchDisplayLimit = 40;
        renderSearchView();
        mainSearchInputEl.focus();
      });
    }

    // Pagination is explicit: scrolling must never request music.
    document.getElementById('btn-close-col-modal').addEventListener('click', closeCollectionModal);
    document.getElementById('collection-modal').addEventListener('click', (e) => {
      if (e.target.id === 'collection-modal') closeCollectionModal();
    });
    document.getElementById('btn-play-collection').addEventListener('click', () => {
      const col = COLLECTIONS.find(c => c.id === state.activeCollectionId)||(state.activeCollectionId==='recommendations'?window.TelefyRecommendations?.collection:null);
      const upl = USER_PLAYLISTS.find(p => p.id === state.activeCollectionId);
      if(upl&&!state.isMaxSubscribed){openUpsellModal();return;}
      const source = col || upl;
      if (source && source.trackIds.length > 0) {
        const title = col ? getColText(col).title : upl.title;
        const shortDesc = col ? getColText(col).shortDesc : upl.subtitle;
        if(state.activeCollectionId!=='recommendations'){window.TelefyOrderedQueue.start(source.trackIds,source.trackIds[0],title,'playlist');closeCollectionModal();return;}
        state.queueIds = [...source.trackIds.slice(1)];
        const homeTitleEl = document.getElementById('home-stream-title');
        if (homeTitleEl) homeTitleEl.textContent = title;
        const homeDescEl = document.getElementById('home-stream-desc');
        if (homeDescEl && shortDesc) homeDescEl.textContent = shortDesc;
        const flowTitleEl = document.getElementById('flow-stream-name');
        if (flowTitleEl) flowTitleEl.textContent = title;
        playTrack(source.trackIds[0], title);
        closeCollectionModal();
      }
    });

    function activateMaxSubscription(){return window.TelefyMax?.purchase();}

    document.getElementById('btn-subscribe-max').addEventListener('click', () => {
      activateMaxSubscription();
    });

    document.getElementById('btn-modal-subscribe-max').addEventListener('click', () => {
      activateMaxSubscription();
    });

    document.getElementById('btn-renew-max')?.addEventListener('click', () => {
      triggerHaptic('light');
      window.TelefyMax?.purchase();
    });
    document.getElementById('btn-close-in-dev-modal')?.addEventListener('click', () => {
      closeSheetModal('in-dev-modal');
    });
    document.getElementById('btn-in-dev-back')?.addEventListener('click', () => {
      triggerHaptic('light');
      closeSheetModal('in-dev-modal');
    });
    document.getElementById('in-dev-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'in-dev-modal') closeSheetModal('in-dev-modal');
    });

    document.getElementById('btn-close-upsell-modal').addEventListener('click', closeUpsellModal);
    document.getElementById('mytelefy-upsell-modal').addEventListener('click', (e) => {
      if (e.target.id === 'mytelefy-upsell-modal') closeUpsellModal();
    });

    // Create / Edit / Delete Playlist Modal in Telefy Max Beta
    let editingPlaylistId = null;
    let editorSelectedTrackIds = new Set();
    let playlistEditorSearchQuery = '';
    let playlistEditorShowOnlySelected = false;
    let playlistEditorSearchTimer = null;
    let isPlaylistEditorSearching = false;

    function updateEditorSelectedCount() {
      const el = document.getElementById('playlist-tracks-selected-count');
      const count = editorSelectedTrackIds.size;
      if (el) {
        if (playlistEditorShowOnlySelected) {
          el.textContent = state.lang === 'en' ? `All tracks (${count})` : `Показать все (${count})`;
        } else {
          el.textContent = state.lang === 'en'
            ? `${count} selected`
            : `Выбрано: ${count}`;
        }
      }
      const confirmLabel = document.getElementById('btn-confirm-create-playlist-label');
      if (confirmLabel) {
        if (editingPlaylistId) {
          confirmLabel.textContent = state.lang === 'en'
            ? (count > 0 ? `Save (${count})` : 'Save Changes')
            : (count > 0 ? `Сохранить (${count})` : 'Сохранить');
        } else {
          confirmLabel.textContent = count > 0
            ? `${t('createPlConfirmBtn')} (${count})`
            : t('createPlConfirmBtn');
        }
      }
    }

    function getPlaylistEditorDisplayTracks() {
      const q = playlistEditorSearchQuery.trim();
      let pool = tracks;
      if (playlistEditorShowOnlySelected && !q) {
        pool = tracks.filter(tr => editorSelectedTrackIds.has(tr.id));
      } else if (q) {
        pool = tracks.filter(tr => doesTrackMatchSearchQuery(tr, q));
      } else {
        // When no search query is active, place selected tracks first so they are immediately visible
        const selected = tracks.filter(tr => editorSelectedTrackIds.has(tr.id));
        const unselected = tracks.filter(tr => !editorSelectedTrackIds.has(tr.id));
        pool = [...selected, ...unselected];
      }
      return pool.slice(0, 160);
    }

    function renderPlaylistEditorTracks() {
      const listEl = document.getElementById('playlist-editor-tracks');
      if (!listEl) return;
      const displayTracks = getPlaylistEditorDisplayTracks();

      if (displayTracks.length === 0) {
        if (isPlaylistEditorSearching || state.isCatalogParsing) {
          listEl.innerHTML = window.TelefySkeleton.html();
        } else if (playlistEditorShowOnlySelected && !playlistEditorSearchQuery.trim()) {
          listEl.innerHTML = `<div class="py-10 px-4 text-center text-xs text-muted">${state.lang === 'en' ? 'No tracks selected yet' : 'Вы пока не выбрали ни одного трека'}</div>`;
        } else {
          listEl.innerHTML = `<div class="py-10 px-4 text-center text-xs text-muted">${t('searchEmpty')} «${playlistEditorSearchQuery.trim()}»</div>`;
        }
        return;
      }

      listEl.innerHTML = displayTracks.map(tr => {
        const checked = editorSelectedTrackIds.has(tr.id);
        const subMeta = tr.album ? `${tr.artist} · ${tr.album}` : tr.artist;
        return `
          <button type="button" data-pick-track="${tr.id}" class="tg-row w-full gap-3 text-left cursor-pointer">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div data-track-cover="${tr.id}" class="w-10 h-10 squircle-cover-sm shrink-0 bg-cover bg-center bg-no-repeat flex items-center justify-center text-white text-[11px] font-bold relative overflow-hidden" style="background-color: ${tr.cover || '#1E3A8A'}; ${tr.coverImg ? `background-image: url('${tr.coverImg}')` : ''}">
                ${renderCoverImgTag(tr.coverImg)}
                <span class="cover-fallback-glyph relative z-10 opacity-80 ${tr.coverImg ? 'hidden' : ''}">♫</span>
              </div>
              <div class="min-w-0 flex-1">
                <p data-pick-title class="text-[14px] font-medium truncate ${checked ? 'text-[#2AABEE]' : ''}">${tr.title}</p>
                <p class="text-[12px] text-muted truncate mt-0.5">${subMeta}</p>
              </div>
            </div>
            <span data-pick-badge class="relative w-6 h-6 flex items-center justify-center shrink-0 transition ${checked ? 'text-[#2AABEE]' : 'text-[var(--text-muted)] opacity-40'}">
              <span data-pick-bg class="w-3 h-3 rounded-full bg-white pointer-events-none transition-opacity ${checked ? 'opacity-100' : 'opacity-0'}"></span>
              <span data-pick-ico class="tg-ico text-[23px] leading-none absolute inset-0 flex items-center justify-center">${checked ? '&#xF215;' : '&#xF0C0;'}</span>
            </span>
          </button>
        `;
      }).join('');
      observeTrackCovers(listEl);
      listEl.querySelectorAll('[data-pick-track]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tid = Number(btn.dataset.pickTrack);
          const nowChecked = !editorSelectedTrackIds.has(tid);
          if (nowChecked) editorSelectedTrackIds.add(tid);
          else editorSelectedTrackIds.delete(tid);
          triggerHaptic('light');
          const badge = btn.querySelector('[data-pick-badge]');
          const pickBg = btn.querySelector('[data-pick-bg]');
          const pickIco = btn.querySelector('[data-pick-ico]');
          const titleEl = btn.querySelector('[data-pick-title]');
          if (titleEl) titleEl.classList.toggle('text-[#2AABEE]', nowChecked);
          if (badge) {
            badge.classList.toggle('text-[#2AABEE]', nowChecked);
            badge.classList.toggle('text-[var(--text-muted)]', !nowChecked);
            badge.classList.toggle('opacity-40', !nowChecked);
            if (pickBg) {
              pickBg.classList.toggle('opacity-100', nowChecked);
              pickBg.classList.toggle('opacity-0', !nowChecked);
            }
            if (pickIco) {
              pickIco.innerHTML = nowChecked ? '&#xF215;' : '&#xF0C0;';
            }
            badge.classList.remove('anim-check-pop');
            void badge.offsetWidth;
            badge.classList.add('anim-check-pop');
          }
          updateEditorSelectedCount();
        });
      });
    }

    async function searchTracksForPlaylistEditorLive(rawQuery) {
      const cleanQ = (rawQuery || '').trim();
      if (cleanQ.length < 2) return;
      isPlaylistEditorSearching = true;
      if (getPlaylistEditorDisplayTracks().length === 0) {
        renderPlaylistEditorTracks();
      }
      try {
        const trackUrl = `https://api.deezer.com/search/track?q=${encodeURIComponent(cleanQ)}&limit=25&output=jsonp`;
        const trackData = await fetchJsonpOnly(trackUrl, 4000);
        const results = (trackData && Array.isArray(trackData.data)) ? trackData.data : [];
        const newItems = results.map(d => {
          if (!d || !d.title || !d.artist || !d.artist.name || !d.album) return null;
          const rawCover = pickDeezerCover(d.album);
          if (!rawCover) return null;
          return mapDeezerTrackItem(d, null, rawCover);
        }).filter(Boolean);
        if (newItems.length > 0) {
          mergeParsedTracksIntoCatalog(newItems);
        }
      } catch (_) {}
      isPlaylistEditorSearching = false;
      const cm = document.getElementById('create-playlist-modal');
      if (cm && !cm.classList.contains('hidden')) {
        renderPlaylistEditorTracks();
      }
    }

    const playlistSearchInputEl = document.getElementById('input-playlist-track-search');
    const clearPlaylistSearchBtn = document.getElementById('btn-clear-playlist-search');
    if (playlistSearchInputEl) {
      playlistSearchInputEl.addEventListener('input', (e) => {
        playlistEditorSearchQuery = e.target.value;
        if (clearPlaylistSearchBtn) {
          clearPlaylistSearchBtn.classList.toggle('hidden', !playlistEditorSearchQuery.length);
        }
        renderPlaylistEditorTracks();
        if (playlistEditorSearchTimer) clearTimeout(playlistEditorSearchTimer);
        const qVal = playlistEditorSearchQuery.trim();
        if (qVal.length >= 2) {
          playlistEditorSearchTimer = setTimeout(() => {
            searchTracksForPlaylistEditorLive(qVal);
          }, 260);
        }
      });
    }
    if (clearPlaylistSearchBtn && playlistSearchInputEl) {
      clearPlaylistSearchBtn.addEventListener('click', () => {
        playlistEditorSearchQuery = '';
        playlistSearchInputEl.value = '';
        clearPlaylistSearchBtn.classList.add('hidden');
        renderPlaylistEditorTracks();
        playlistSearchInputEl.focus();
      });
    }
    document.getElementById('playlist-tracks-selected-count')?.addEventListener('click', () => {
      if (editorSelectedTrackIds.size === 0 && !playlistEditorShowOnlySelected) return;
      triggerHaptic('light');
      playlistEditorShowOnlySelected = !playlistEditorShowOnlySelected;
      updateEditorSelectedCount();
      renderPlaylistEditorTracks();
    });

    function openCreatePlaylistModal(plId = null) {
      if(!state.isMaxSubscribed){openUpsellModal();return;}
      const cm = document.getElementById('create-playlist-modal');
      if (!cm) return;
      editingPlaylistId = typeof plId === 'string' ? plId : null;
      const existing = editingPlaylistId ? USER_PLAYLISTS.find(p => p.id === editingPlaylistId) : null;

      const headingEl = document.getElementById('playlist-modal-heading');
      const nameInput = document.getElementById('input-playlist-name');
      const subInput = document.getElementById('input-playlist-subtitle');
      const delBtn = document.getElementById('btn-delete-playlist-modal');

      playlistEditorSearchQuery = '';
      playlistEditorShowOnlySelected = false;
      if (playlistSearchInputEl) playlistSearchInputEl.value = '';
      if (clearPlaylistSearchBtn) clearPlaylistSearchBtn.classList.add('hidden');

      if (existing) {
        if (headingEl) headingEl.textContent = state.lang === 'en' ? 'Edit Playlist' : 'Редактировать плейлист';
        if (nameInput) nameInput.value = existing.title;
        if (subInput) subInput.value = existing.subtitle || '';
        if (delBtn) delBtn.classList.remove('hidden');
        editorSelectedTrackIds = new Set(existing.trackIds);
      } else {
        if (headingEl) headingEl.textContent = t('createPlModalTitle');
        if (nameInput) nameInput.value = '';
        if (subInput) subInput.value = '';
        if (delBtn) delBtn.classList.add('hidden');
        editorSelectedTrackIds = new Set();
      }

      updateEditorSelectedCount();
      renderPlaylistEditorTracks();
      openSheetModal(cm, 'light');
    }

    function closeCreatePlaylistModal() {
      closeSheetModal('create-playlist-modal', () => {
        editingPlaylistId = null;
      });
    }

    async function removeConfirmedPlaylist(plId) {
      const idx = USER_PLAYLISTS.findIndex(p => p.id === plId);
      if (idx === -1) return;
      const removed = USER_PLAYLISTS[idx];
      USER_PLAYLISTS.splice(idx, 1);
      if(!await saveUserPlaylists())return;
      triggerHaptic('medium');
      if (state.activeCollectionId === plId) closeCollectionModal();
      closeCreatePlaylistModal();
      renderMaxBetaView();
      showToast((state.lang === 'en' ? 'Playlist deleted: ' : 'Плейлист удалён: ') + removed.title);
    }

    document.getElementById('btn-open-create-playlist').addEventListener('click', () => openCreatePlaylistModal(null));
    document.getElementById('btn-close-create-playlist').addEventListener('click', closeCreatePlaylistModal);
    document.getElementById('create-playlist-modal').addEventListener('click', (e) => {
      if (e.target.id === 'create-playlist-modal') closeCreatePlaylistModal();
    });
    document.getElementById('btn-delete-playlist-modal')?.addEventListener('click', () => {
      if (editingPlaylistId) deleteUserPlaylist(editingPlaylistId);
    });
    document.getElementById('btn-edit-active-playlist')?.addEventListener('click', () => {
      const id = state.activeCollectionId;
      closeCollectionModal();
      if (id) openCreatePlaylistModal(id);
    });
    document.getElementById('btn-delete-active-playlist')?.addEventListener('click', () => {
      if (state.activeCollectionId) deleteUserPlaylist(state.activeCollectionId);
    });
    document.getElementById('btn-confirm-create-playlist').addEventListener('click', async () => {
      if(!window.TelefyLibrary?.ready){showToast('Подключаем библиотеку. Повтори через несколько секунд.');return;}
      const nameInput = document.getElementById('input-playlist-name');
      const subInput = document.getElementById('input-playlist-subtitle');
      const rawName = (nameInput?.value || '').trim();
      const rawSub = (subInput?.value || '').trim();
      const selectedIds = Array.from(editorSelectedTrackIds);
      const firstTrack = selectedIds.length ? getTrack(selectedIds[0]) : null;

      if (editingPlaylistId) {
        const pl = USER_PLAYLISTS.find(p => p.id === editingPlaylistId);
        if (pl) {
          pl.title = rawName || pl.title;
          pl.subtitle = rawSub || (state.lang === 'en' ? 'Personal playlist · Telefy Max' : 'Личный плейлист · Telefy Max');
          pl.trackIds = selectedIds;
          pl.trackKeys = selectedIds.map(id=>getTrackUniqueKey(getTrack(id)));
          if (firstTrack && firstTrack.coverImg) pl.coverImg = firstTrack.coverImg;
          if(!await saveUserPlaylists())return;
          closeCreatePlaylistModal();
          renderMaxBetaView();
          showToast((state.lang === 'en' ? 'Playlist updated: ' : 'Плейлист обновлён: ') + pl.title);
          return;
        }
      }

      const title = rawName || (state.lang === 'en' ? `My Mix #${USER_PLAYLISTS.length + 1}` : `Мой микс #${USER_PLAYLISTS.length + 1}`);
      USER_PLAYLISTS.unshift({
        id: 'upl_' + Date.now(),
        title,
        subtitle: rawSub || (state.lang === 'en' ? 'Personal playlist · Telefy Max' : 'Личный плейлист · Telefy Max'),
        cover: '#2AABEE',
        coverImg: (firstTrack && firstTrack.coverImg) || null,
        trackIds: selectedIds.length ? selectedIds : tracks.slice(0, 6).map(tr => tr.id)
      });
      if(!await saveUserPlaylists())return;
      if (nameInput) nameInput.value = '';
      if (subInput) subInput.value = '';
      closeCreatePlaylistModal();
      renderMaxBetaView();
      showToast(`${t('toastPlaylistCreated')}: ${title}`);
    });

    // Library Modal (Favorite Tracks Only — Telefy Max)
    function renderLibraryModalTracks() {
      const listEl = document.getElementById('library-modal-tracks');
      if (!listEl) return;
      const likedTracks = tracks.filter(tr => tr.liked);
      const playButton = document.getElementById('btn-play-library');
      playButton.hidden = likedTracks.length === 0;
      playButton.disabled = likedTracks.length === 0;
      const english = state.lang === 'en';
      document.getElementById('library-modal-title').textContent = english ? 'Favorite tracks' : 'Любимые треки';
      document.getElementById('library-modal-sub').textContent = likedTracks.length ? (english ? `${likedTracks.length} tracks` : `Треков: ${likedTracks.length}`) : '';
      listEl.classList.toggle('is-empty', likedTracks.length === 0);
      if (likedTracks.length === 0) {
        listEl.innerHTML = `<div class="native-empty-state"><div class="native-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12Z"/></svg></div><h4>${english ? 'Your favorites belong here' : 'Здесь будет любимая музыка'}</h4><p>${english ? 'Tap the heart next to a track to save it here.' : 'Нажимай на сердечко рядом с треком,<br>чтобы сохранить его здесь.'}</p><button id="library-discover" type="button">${english ? 'Find music' : 'Найти музыку'}</button></div>`;
        document.getElementById('library-discover').onclick = () => { closeLibraryModal(); switchTab('search'); document.getElementById('search-input').focus(); };
      } else {
        listEl.innerHTML = likedTracks.map(createTrackRowHTML).join('');
        bindTrackRowEvents(listEl,state.lang==='en'?'Favorites':'Любимое');
      }
    }
    function openLibraryModal() {
      if(!state.isMaxSubscribed){openUpsellModal();return;}
      window.TelefyAlbums.showFavorites();
    }
    function closeLibraryModal() {
      closeSheetModal('library-modal');
    }
    document.getElementById('btn-open-library')?.addEventListener('click', openLibraryModal);
    document.getElementById('btn-close-library-modal')?.addEventListener('click', closeLibraryModal);
    document.getElementById('library-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'library-modal') closeLibraryModal();
    });
    document.getElementById('btn-play-library')?.addEventListener('click', () => {
      const likedTracks = tracks.filter(tr => tr.liked);
      if (likedTracks.length > 0) {
        triggerHaptic('medium');
        window.TelefyOrderedQueue.start(likedTracks.map(tr=>tr.id),likedTracks[0].id,state.lang==='en'?'Favorites':'Любимое','favorites');closeLibraryModal();return;
        state.queueIds = likedTracks.slice(1).map(tr => tr.id);
        playTrack(likedTracks[0].id, state.lang === 'en' ? 'Library' : 'Библиотека');
        closeLibraryModal();
      }
    });


    // --- Profile Background Gradient Library (Telegram Gift Backdrops) ---
    const PROFILE_GRADIENTS = [
      { id: 'white', bg: 'linear-gradient(160deg, #FFFFFF 0%, #F8FAFC 55%, #EEF1F5 100%)' },
      { id: 'slate', bg: 'linear-gradient(160deg, #4B6B8A 0%, #3A5775 55%, #2D4661 100%)' },
      { id: 'turquoise', bg: 'linear-gradient(160deg, #43A6A2 0%, #2C7E80 55%, #1B565C 100%)' },
      { id: 'amber', bg: 'linear-gradient(160deg, #D4A138 0%, #B37E22 55%, #845614 100%)' },
      { id: 'onyx', bg: 'linear-gradient(160deg, #27282E 0%, #15161B 55%, #070709 100%)' },
      { id: 'graphite', bg: 'linear-gradient(160deg, #62666B 0%, #484B50 55%, #2F3135 100%)' },
      { id: 'cobalt', bg: 'linear-gradient(160deg, #4393D1 0%, #2B6CA8 55%, #1B4B7D 100%)' },
      { id: 'burgundy', bg: 'linear-gradient(160deg, #985060 0%, #743646 55%, #51212E 100%)' },
      { id: 'terracotta', bg: 'linear-gradient(160deg, #CE5D36 0%, #A34222 55%, #752B14 100%)' },
      { id: 'olive', bg: 'linear-gradient(160deg, #6C8149 0%, #4E6033 55%, #344120 100%)' },
      { id: 'taupe', bg: 'linear-gradient(160deg, #9D8170 0%, #7B6253 55%, #574439 100%)' },
      { id: 'crimson', bg: 'linear-gradient(160deg, #CE4642 0%, #A12D2B 55%, #741B1B 100%)' },
      { id: 'coral', bg: 'linear-gradient(160deg, #D57154 0%, #B05239 55%, #833824 100%)' },
      { id: 'royal', bg: 'linear-gradient(160deg, #4A6FE3 0%, #314EB8 55%, #1E3385 100%)' },
      { id: 'violet', bg: 'linear-gradient(160deg, #9B54E0 0%, #7434B5 55%, #501E85 100%)' },
      { id: 'emerald', bg: 'linear-gradient(160deg, #4CB272 0%, #318752 55%, #1D5E37 100%)' },
      { id: 'lavender', bg: 'linear-gradient(160deg, #9F6FD0 0%, #7A4EA8 55%, #56327C 100%)' },
      { id: 'berry', bg: 'linear-gradient(160deg, #D04F82 0%, #A63362 55%, #781F44 100%)' },
      { id: 'sage', bg: 'linear-gradient(160deg, #6F8771 0%, #516653 55%, #374739 100%)' },
      { id: 'mint', bg: 'linear-gradient(160deg, #46AD88 0%, #2D8364 55%, #1B5A43 100%)' },
      { id: 'indigo', bg: 'linear-gradient(160deg, #6271EC 0%, #434FBE 55%, #2A338B 100%)' },
      { id: 'forest', bg: 'linear-gradient(160deg, #3C6341 0%, #28472C 55%, #182E1B 100%)' },
      { id: 'plum', bg: 'linear-gradient(160deg, #8E577C 0%, #6A3B5B 55%, #48243D 100%)' },
      { id: 'teal', bg: 'linear-gradient(160deg, #528C96 0%, #386972 55%, #234850 100%)' },
      { id: 'copper', bg: 'linear-gradient(160deg, #C98042 0%, #9E5E2A 55%, #714019 100%)' }
    ];

    let profileBgCustom=localStorage.getItem('telefy_profile_bg_mode')==='custom';
    let selectedProfileBgId = state.theme==='light'?'white':'slate';
    try {
      const savedBg = localStorage.getItem('telefy_profile_bg_id');
      if (savedBg && PROFILE_GRADIENTS.some(g => g.id === savedBg)) {
        if(profileBgCustom || !['white','slate'].includes(savedBg)){selectedProfileBgId=savedBg;profileBgCustom=true;}
      }
    } catch (e) {}

    function profileForeground(background) {
      const samples = (background.match(/#[0-9a-f]{6}/gi) || ['#FFFFFF']).map(hex => {
        const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
        return rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      });
      const contrast = color => {
        const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
        const light = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return Math.min(...samples.map(sample => (Math.max(light, sample) + .05) / (Math.min(light, sample) + .05)));
      };
      const dark = contrast('#172535') > contrast('#FFFFFF');
      const primary = dark ? '#172535' : '#FFFFFF';
      const username = (dark ? ['#0879BF', '#174F7A', primary] : ['#D1E9FF', '#E6F2FF', primary]).find(color => contrast(color) >= 4.5) || primary;
      const status = (dark ? ['#596675', '#3E4B5B', primary] : ['#DDE3EB', '#EDF1F6', primary]).find(color => contrast(color) >= 4.5) || primary;
      const badge = dark && contrast('#0879BF') >= 3 ? '#0879BF' : primary;
      return { primary, username, status, badge, dark };
    }

    function applyProfileGradient(id, manual=false) {
      if(manual){profileBgCustom=true;try{localStorage.setItem('telefy_profile_bg_mode','custom');}catch(_){}}
      const found = PROFILE_GRADIENTS.find(g => g.id === id) || PROFILE_GRADIENTS[0];
      selectedProfileBgId = found.id;
      const headerEl = document.getElementById('tg-profile-header');
      if (headerEl) {
        headerEl.style.background = found.bg;
        headerEl.classList.toggle('profile-white', found.id === 'white');
        const colors = profileForeground(found.bg);
        if (found.id === 'white') {
          colors.username = '#2AABEE';
          colors.badge = '#2AABEE';
          colors.status = '#6B7684';
        }
        headerEl.classList.toggle('profile-light', colors.dark);
        for (const key of ['primary', 'username', 'status', 'badge']) headerEl.style.setProperty('--profile-' + key, colors[key]);
      }
      try { localStorage.setItem('telefy_profile_bg_id', found.id); } catch (e) {}
    }

    function renderProfileBgGrid() {
      const grid = document.getElementById('profile-bg-grid');
      if (!grid) return;
      grid.innerHTML = PROFILE_GRADIENTS.map(g => {
        const isActive = g.id === selectedProfileBgId;
        return `
          <button type="button" data-bg-id="${g.id}" aria-label="${g.id === 'white' ? (state.lang === 'en' ? 'White' : 'Белая') : g.id}" aria-pressed="${isActive}" class="relative h-28 rounded-[18px] overflow-hidden select-none active:scale-95 transition ${isActive ? 'ring-[2.5px] ring-[#2AABEE] ring-offset-2 ring-offset-[var(--bg-card)]' : 'opacity-95 hover:opacity-100'}" style="background: ${g.bg};">
            <span class="tg-ico absolute top-2 left-2.5 text-white/[0.18] text-[13px] rotate-[-12deg] pointer-events-none">&#xF15E;</span>
            <span class="tg-ico absolute top-2.5 right-2.5 text-white/[0.16] text-[12px] rotate-[14deg] pointer-events-none">&#xF01A;</span>
            <span class="tg-ico absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/[0.24] text-[24px] pointer-events-none">&#xF218;</span>
            <span class="tg-ico absolute bottom-2.5 left-3 text-white/[0.16] text-[12px] rotate-[10deg] pointer-events-none">&#xF0BF;</span>
            <span class="tg-ico absolute bottom-2 right-2.5 text-white/[0.18] text-[13px] rotate-[-10deg] pointer-events-none">&#xF157;</span>
            ${isActive ? '<span class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white text-[#2AABEE] flex items-center justify-center shadow"><span class="tg-ico text-[21px] leading-none">&#xF215;</span></span>' : ''}
          </button>
        `;
      }).join('');
    }

    const profileBgModal = document.getElementById('profile-bg-modal');
    const btnEditProfileBg = document.getElementById('btn-edit-profile-bg');
    const btnCloseProfileBg = document.getElementById('btn-close-profile-bg');
    const btnDoneProfileBg = document.getElementById('btn-done-profile-bg');
    const profileBgGrid = document.getElementById('profile-bg-grid');

    function openProfileBgModal() {
      renderProfileBgGrid();
      openSheetModal(profileBgModal, 'light');
    }
    function closeProfileBgModal() {
      closeSheetModal(profileBgModal);
    }


    function buildPersonalPlaylists(){window.TelefyTaste?.updatePlaylist();}
    let pendingPlaylistDelete=null;
    function deleteUserPlaylist(id){
      const pl=USER_PLAYLISTS.find(p=>p.id===id);if(!pl)return;
      pendingPlaylistDelete=id;
      document.getElementById('delete-playlist-description').textContent=state.lang==='en'?`Delete “${pl.title}”? This cannot be undone.`:`Удалить «${pl.title}»? Восстановить плейлист не получится.`;
      document.getElementById('delete-playlist-title').textContent=state.lang==='en'?'Delete playlist?':'Удалить плейлист?';
      document.getElementById('confirm-playlist-delete').textContent=state.lang==='en'?'Delete':'Удалить';
      document.getElementById('cancel-playlist-delete').textContent=state.lang==='en'?'Cancel':'Отмена';
      openSheetModal('delete-playlist-modal');
    }
    document.getElementById('cancel-playlist-delete').onclick=()=>{pendingPlaylistDelete=null;closeSheetModal('delete-playlist-modal');};
    document.getElementById('confirm-playlist-delete').onclick=()=>{const id=pendingPlaylistDelete;pendingPlaylistDelete=null;closeSheetModal('delete-playlist-modal');if(id)removeConfirmedPlaylist(id);};
    document.getElementById('delete-playlist-modal').addEventListener('click',e=>{if(e.target.id==='delete-playlist-modal'){pendingPlaylistDelete=null;closeSheetModal(e.target);}});
    // Count advancing playback, not seeking, buffering, paused time or time spent on a card.
    const listenAudio=document.getElementById('telefy-audio');
    let listenSample=null,listenSeconds=0,listenKey='',qualifiedThisPlay=false;
    function sampleListen(){
      const tr=tracks.find(t=>t.id===state.currentTrackId),key=tr?getTrackUniqueKey(tr):'';
      const now=performance.now(),pos=listenAudio.currentTime;
      if(key!==listenKey){listenKey=key;listenSeconds=0;listenSample=null;qualifiedThisPlay=false;}
      if(listenSample&&!listenAudio.paused&&!listenAudio.seeking&&listenAudio.readyState>=3){
        const dt=(now-listenSample.now)/1000,dp=pos-listenSample.pos;
        if(dt>0&&dp>0&&dp<=dt*Math.max(1,listenAudio.playbackRate)*1.5+.1)listenSeconds+=Math.min(dt,dp/Math.max(.1,listenAudio.playbackRate));
      }
      listenSample={now,pos};
      if(key&&listenSeconds>=30&&!qualifiedThisPlay){
        qualifiedThisPlay=true;window.TelefyTaste?.record(tr);
        userListenedTrackKeys.add(key);userListenedTrackIds.add(tr.id);saveUserListenedKeys();buildPersonalPlaylists();renderMaxBetaView();
      }
    }
    listenAudio.addEventListener('timeupdate',sampleListen);
    for(const event of ['loadstart','ended'])listenAudio.addEventListener(event,()=>{listenSeconds=0;qualifiedThisPlay=false;});
    for(const event of ['seeking','seeked','pause','playing','waiting','loadstart','ended'])listenAudio.addEventListener(event,()=>{listenSample=null;});

    // Unified Interactive Drag-Down-to-Close for All Sheet Modals
    const modalCloseMap = {
      'profile-bg-modal': closeProfileBgModal,
      'settings-modal': closeSettingsModal,
      'collection-modal': closeCollectionModal,
      'mytelefy-upsell-modal': closeUpsellModal,
      'create-playlist-modal': closeCreatePlaylistModal,
      'library-modal': closeLibraryModal,
      'artist-modal': closeArtistModal,
      'album-modal': closeAlbumModal
    };


    const sheetModals=[...document.querySelectorAll('.tg-sheet-modal, #full-player-modal')];
    const syncSheetScrollLock=()=>document.documentElement.classList.toggle('telefy-sheet-open',sheetModals.some(m=>!m.classList.contains('hidden')));
    const sheetObserver=new MutationObserver(syncSheetScrollLock);
    sheetModals.forEach(modal=>{
      sheetObserver.observe(modal,{attributes:true,attributeFilter:['class']});
      const isPlayer=modal.id==='full-player-modal';
      const panel=isPlayer?modal:modal.querySelector('.col-sheet-panel');if(!panel)return;
      // Every sheet has the same visible grip and a generous drag target.
      let grip=panel.querySelector(':scope > .telefy-sheet-grip');
      if(!grip){
        const old=panel.firstElementChild;
        if(!isPlayer && old?.classList.contains('w-10') && !old.children.length)old.remove();
        grip=document.createElement('div');grip.className='telefy-sheet-grip';
        grip.setAttribute('aria-hidden','true');panel.prepend(grip);
      }
      const handles=[grip,...[...panel.children].slice(1,2)];
      handles.forEach(h=>h.classList.add('sheet-drag-handle'));
      let gesture=null,settleTimer;
      const settle=()=>{
        panel.style.transition='transform .34s cubic-bezier(.22,1,.36,1)';
        panel.style.transform='translate3d(0,0,0)';panel.style.setProperty('--sheet-drag-y','0px');
        clearTimeout(settleTimer);settleTimer=setTimeout(()=>{panel.style.transition='';},350);
      };
      panel.addEventListener('pointerdown',e=>{
        if(modal._dismissMotion||modal.classList.contains('hidden')||modal.classList.contains('is-closing')||gesture||!e.isPrimary||e.button!==0||e.target.closest('button,a,input,textarea,select'))return;
        // Only the handle owns the gesture; lists retain native momentum scrolling.
        if(!handles.some(h=>h.contains(e.target)))return;
        clearTimeout(settleTimer);
        const visibleTransform=getComputedStyle(panel).transform;
        panel.style.animation='none';panel.style.transform=visibleTransform;
        gesture={id:e.pointerId,onGrip:grip.contains(e.target),started:performance.now(),distance:0,x:e.clientX,y:e.clientY,lastY:e.clientY,time:performance.now(),speed:0,dy:0};
        panel.style.animation='none';panel.style.transition='none';
        panel.setPointerCapture?.(e.pointerId);
      });
      panel.addEventListener('pointermove',e=>{
        if(!gesture||gesture.id!==e.pointerId)return;
        gesture.distance=Math.max(gesture.distance,Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y));
        if(Math.abs(e.clientX-gesture.x)>24&&Math.abs(e.clientX-gesture.x)>Math.abs(e.clientY-gesture.y)){finish(e,true);return;}
        const now=performance.now();gesture.speed=(e.clientY-gesture.lastY)/Math.max(1,now-gesture.time);
        gesture.lastY=e.clientY;gesture.time=now;
        gesture.dy=Math.max(0,e.clientY-gesture.y);
        panel.style.transform=`translate3d(0,${gesture.dy}px,0)`;
        panel.style.setProperty('--sheet-drag-y',gesture.dy+'px');
      });
      const finish=(e,cancelled=false)=>{
        if(!gesture||gesture.id!==e.pointerId)return;
        const g=gesture;gesture=null;
        if(panel.hasPointerCapture?.(e.pointerId))panel.releasePointerCapture(e.pointerId);
        const speed=performance.now()-g.time<100?g.speed:0;
        if(!cancelled&&((g.distance<6&&g.onGrip&&performance.now()-g.started<300)||g.dy>Math.min(120,panel.offsetHeight*.23)||(g.dy>28&&speed>.55))){
          panel.style.transition='';
          (isPlayer?closeFullPlayer:(modalCloseMap[modal.id]||(()=>closeSheetModal(modal))))();
        }else settle();
      };
      panel.addEventListener('pointerup',e=>finish(e));
      panel.addEventListener('pointercancel',e=>finish(e,true));
      panel.addEventListener('lostpointercapture',e=>finish(e,true));
    });
    syncSheetScrollLock();

    if (btnEditProfileBg) btnEditProfileBg.addEventListener('click', openProfileBgModal);
    if (btnCloseProfileBg) btnCloseProfileBg.addEventListener('click', closeProfileBgModal);
    if (btnDoneProfileBg) btnDoneProfileBg.addEventListener('click', closeProfileBgModal);
    if (profileBgModal) {
      profileBgModal.addEventListener('click', (e) => {
        if (e.target === profileBgModal) closeProfileBgModal();
      });
    }
    if (profileBgGrid) {
      profileBgGrid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-bg-id]');
        if (!card) return;
        applyProfileGradient(card.getAttribute('data-bg-id'),true);
        renderProfileBgGrid();
      });
    }

    applyProfileGradient(selectedProfileBgId);

    setTheme(state.theme);
    applyTranslations();
    renderAll();
    window.TelefySoundCloud.initialize();
  

/* AI ranks real source candidates; deterministic artist diversity remains mandatory. */
window.TelefySmartSelection=(()=>{
 const cache=new Map(),pending=new Map(),scores=new Map();
 const artist=t=>normalizeArtistToken(findRosterConfig(t.primaryArtist||t.artist)?.name||getPrimaryArtistName(t.primaryArtist||t.artist||''));
 function diverse(list,limit=60){
  const pool=[],seen=new Set();for(const t of list){const k=getTrackUniqueKey(t);if(!seen.has(k)){seen.add(k);pool.push(t);}}
  const result=[],counts=new Map();let last='';const cap=Math.max(3,Math.ceil(limit*.2));
  while(pool.length&&result.length<limit){let i=pool.findIndex(t=>artist(t)!==last&&(counts.get(artist(t))||0)<cap);if(i<0)i=pool.findIndex(t=>(counts.get(artist(t))||0)<cap);if(i<0)break;const t=pool.splice(i,1)[0];last=artist(t);counts.set(last,(counts.get(last)||0)+1);result.push(t);}
  return result;
 }
 async function rank(list,context){
  const account=String(window.TelefyProfile?.user?.telegram_id||'');
  const candidates=diverse(list,60);if(!account||candidates.length<2)return candidates;
  const key=JSON.stringify([account,context,Math.floor(Date.now()/21600000),window.TelefyTaste?.history?.map(h=>h.key),candidates.map(t=>t.soundcloudUrn)]);
  if(cache.has(key))return cache.get(key);if(pending.has(key))return pending.get(key);
  const task=(async()=>{try{
   const r=await fetch('/api/ai/rank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context,candidates:candidates.map(t=>({soundcloudUrn:t.soundcloudUrn,title:t.title,artist:t.artist,genre:t.genre,tag_list:t.tag_list,playbackCount:t.playbackCount,likesCount:t.likesCount}))}),signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw Error('rank');const data=await r.json();if(String(window.TelefyProfile?.user?.telegram_id||'')!==account)return [];
   const used=new Set(),ordered=[];for(const i of data.order||[])if(Number.isInteger(i)&&candidates[i]&&!used.has(i)){used.add(i);ordered.push(candidates[i]);}
   const blend=[];const mechanical=candidates.slice(),ai=ordered.slice();while(mechanical.length||ai.length){blend.push(...mechanical.splice(0,3));if(ai.length)blend.push(ai.shift());}const result=diverse(data.filtered?ordered:blend,60);
   if(context==='vibe'&&data.personalized){scores.clear();result.forEach((t,i)=>scores.set(account+':'+t.soundcloudUrn,4*(1-i/result.length)));}
   if(cache.size>30)cache.clear();cache.set(key,result);return result;
  }catch(_){cache.set(key,candidates);setTimeout(()=>cache.delete(key),300000);return candidates;}finally{pending.delete(key);}})();pending.set(key,task);return task;
 }
 return {artist,diverse,rank,score:t=>scores.get(String(window.TelefyProfile?.user?.telegram_id||'')+':'+t.soundcloudUrn)||0};
})();

/* Explicit list playback owns its order; discovery and global history cannot replace it. */
window.TelefyOrderedQueue=(()=>{
 let list=null,selecting=false;
 function sync(){if(list)state.queueIds=list.ids.slice(list.index+1).filter(id=>tracks.some(t=>t.id===id));}
 function select(index){
  if(!list)return;const id=list.ids[index];if(!tracks.some(t=>t.id===id))return;
  list.index=index;selecting=true;sync();
  try{playTrack(id,list.label,{orderedSource:list.kind});}finally{selecting=false;sync();}
 }
 function start(ids,id,label,kind){
  const valid=[...new Set(ids)].filter(id=>tracks.some(t=>t.id===id));const index=valid.indexOf(id);if(index<0)return;
  window.TelefyFirstRun?.cancel();state.activeMood='all';state.playbackContext=kind;
  list={ids:valid,index,label,kind};select(index);renderMoodChips();
 }
 const previousPlay=playTrack;playTrack=function(id,label,...args){if(!selecting)list=null;return previousPlay(id,label,...args);};
 const next=playNext;playNext=function(ended=false){
  if(!list)return next(ended);
  if(ended&&isRepeat){select(list.index);return;}
  let index=list.index+1;while(index<list.ids.length&&!tracks.some(t=>t.id===list.ids[index]))index++;
  if(typeof isShuffle!=='undefined'&&isShuffle&&index<list.ids.length){const pick=index+Math.floor(Math.random()*(list.ids.length-index));[list.ids[index],list.ids[pick]]=[list.ids[pick],list.ids[index]];}
  if(index<list.ids.length){select(index);return;}
  state.queueIds=[];state.isPlaying=false;syncRealAudio();renderPlayerUI();
 };
 const prev=playPrev;playPrev=function(){if(!list)return prev();if(list.index>0)select(list.index-1);else select(0);};
 return {start,snapshot(){return list?{ids:list.ids.slice(),index:list.index,label:list.label,kind:list.kind}:null;},restore(ids,id,label,kind){const index=ids.indexOf(id);if(index<0)return;list={ids:ids.slice(),index,label,kind};sync();},clear(){list=null;},get active(){return Boolean(list);},get upcoming(){return list?list.ids.slice(list.index+1):[];}};
})();

// Previous restarts after three seconds, across list, flow and headset controls.
(()=>{const previous=playPrev;playPrev=function(){if(state.progressSec>3&&window.TelefyAudio?.restart?.())return;return previous();};})();

/* Related continuation is prepared separately and cannot pollute an explicit list. */
window.TelefyTrendContinuation=(()=>{
 let pending=null,lastFetch=0;
 const owns=()=>state.activeMood==='underground'&&!window.TelefyOrderedQueue?.active&&state.playbackContext!=='favorites';
 function choices(){
  const current=getTrack(state.currentTrackId),artist=current?.artist;
  return window.TelefySmartSelection.diverse(tracks.filter(t=>{
   const year=Number(t.releaseYear||String(t.releaseDate||'').slice(0,4));
   return t.soundcloudUrn&&year>=2025&&year<=2026&&isFlowTrackUnplayed(t)&&(!window.TelefyRapCandidate||window.TelefyRapCandidate(t));
  }).sort((a,b)=>Number(b.artist===artist)-Number(a.artist===artist)),24);
 }
 async function prepare(){
  if(!owns())return [];const existing=choices();if(existing.length>=8)return existing;
  if(pending)return pending;if(Date.now()-lastFetch<300000)return existing;lastFetch=Date.now();
  pending=(async()=>{try{
   const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q:'telefy:discovery:scene',offset:0,limit:50}),{signal:AbortSignal.timeout(15000)});
   if(r.ok){const d=await r.json();mergeParsedTracksIntoCatalog(d.tracks||[]);}
  }catch(_){}finally{pending=null;}return choices();})();return pending;
 }
 function activate(){
  if(!owns())return false;const pool=choices();if(!pool.length)return false;
  state.activeMood='all';state.sourceLabel=state.lang==='en'?'My Flow':'Мой поток';
  state.queueIds=pool.slice(1).map(t=>t.id);renderMoodChips();
  document.getElementById('home-stream-title').textContent=state.sourceLabel;
  document.getElementById('home-stream-desc').textContent=state.lang==='en'?'More music with a similar vibe':'Продолжаем похожей музыкой';
  playTrack(pool[0].id,state.sourceLabel);return true;
 }
 return {prepare,activate};
})();

window.TelefyTrendContinuation={prepare:async()=>[],activate:()=>false};

/* Browser playback memory contains metadata, never temporary stream URLs. */
window.TelefyLastPlayback=(()=>{
 const prefix='telefy_last_playback_v1:',audio=document.getElementById('telefy-audio');
 let restored=false,ready=false,position=null,lastSave=0;
 const owner=()=>String(window.TelefyProfile?.user?.telegram_id||'');
 const fields=['soundcloudUrn','soundcloudUrl','title','artist','primaryArtist','album','duration','coverImg','cover','mood','modes','genre','classificationVersion','editorialPinned','curatedTrend','trendsEligible','editorialYear','releaseDate'];
 const metadata=track=>Object.fromEntries(fields.filter(k=>track[k]!==undefined).map(k=>[k,track[k]]));
 function save(force=false){
  if(!ready||!owner()||window.TelefyFirstRun?.pending)return;
  if(!force&&Date.now()-lastSave<5000)return;
  const track=tracks.find(t=>t.id===state.currentTrackId);if(!track?.soundcloudUrn)return;
  const ordered=window.TelefyOrderedQueue?.snapshot?.();
  const ids=ordered?.ids||[track.id,...(state.queueIds||[])];
  const items=[track,...ids.map(id=>tracks.find(t=>t.id===id))].filter(Boolean);
  const unique=[...new Map(items.filter(t=>t.soundcloudUrn).map(t=>[t.soundcloudUrn,t])).values()].slice(0,300);
  const data={version:1,track:track.soundcloudUrn,tracks:unique.map(metadata),position:Math.max(0,Number(state.progressSec)||0),
   label:state.sourceLabel,context:state.playbackContext||null,mood:state.activeMood,
   queue:ids.map(id=>tracks.find(t=>t.id===id)?.soundcloudUrn).filter(Boolean),ordered:ordered?{kind:ordered.kind,label:ordered.label}:null};
  try{localStorage.setItem(prefix+owner(),JSON.stringify(data));lastSave=Date.now();}catch(_){}
 }
 async function restore(){
  if(restored)return false;restored=true;
  await window.TelefyProfileReady;
  ready=true;
  if(!owner()||!window.TelefyFirstRun?.pending)return false;
  try{
   const data=JSON.parse(localStorage.getItem(prefix+owner())||'null');
   if(data?.version!==1||!Array.isArray(data.tracks)||!data.tracks.some(t=>t.soundcloudUrn===data.track))return false;
   const items=data.tracks.slice(0,300).filter(t=>/^soundcloud:tracks:\d+$/.test(t.soundcloudUrn||'')&&typeof t.title==='string'&&typeof t.artist==='string');
   mergeParsedTracksIntoCatalog(items);
   const track=tracks.find(t=>t.soundcloudUrn===data.track);if(!track)return false;
   const idByUrn=new Map(tracks.map(t=>[t.soundcloudUrn,t.id]));
   window.TelefyFirstRun.cancel();
   state.currentTrackId=track.id;state.isPlaying=false;
   state.sourceLabel=typeof data.label==='string'?data.label.slice(0,200):'Мой поток';
   state.playbackContext=['favorites','playlist','search'].includes(data.context)?data.context:null;
   state.activeMood=MOODS.some(m=>m.id===data.mood)?data.mood:'all';
   flowModeIndex=Math.max(0,MOODS.findIndex(m=>m.id===state.activeMood));
   state.progressSec=Math.min(Math.max(0,Number(data.position)||0),Math.max(0,Number(track.duration)||0));
   position={urn:track.soundcloudUrn,time:state.progressSec};
   const ids=(Array.isArray(data.queue)?data.queue:[]).map(urn=>idByUrn.get(urn)).filter(Boolean);
   if(data.ordered&&ids.includes(track.id))window.TelefyOrderedQueue.restore(ids,track.id,state.sourceLabel,data.ordered.kind);
   else state.queueIds=ids.filter(id=>id!==track.id);
   renderAll();return true;
  }catch(_){return false;}
 }
 for(const event of ['playing','pause','seeked'])audio.addEventListener(event,()=>save(true));
 audio.addEventListener('timeupdate',()=>save());
 window.addEventListener('pagehide',()=>save(true));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)save(true);});
 const previous=playTrack;playTrack=function(...args){position=null;const result=previous(...args);save(true);return result;};
 return {restore,save,consumePosition(track){if(position?.urn!==track.soundcloudUrn)return null;const time=position.time;position=null;return time;}};
})();

function syncPlaybackSource(){
 const english=state.lang==='en',context=state.playbackContext;
 const label=context==='favorites'?(english?'Favorites':'Любимое'):context==='search'?(english?'Search':'Поиск'):state.sourceLabel;
 if(!label)return;
 for(const id of ['home-stream-title','flow-stream-name']){const el=document.getElementById(id);if(el)el.textContent=label;}
 const desc=document.getElementById('home-stream-desc');
 if(desc&&['favorites','playlist','search'].includes(context))desc.textContent=context==='favorites'?(english?'Your saved tracks':'Твои сохранённые треки'):context==='search'?(english?'Playing search results':'Треки из результатов поиска'):(english?'Playing the selected playlist':'Играет выбранная подборка');
}

/* Editorial notice list supplied by the service owner. Match complete aliases only. */
window.TelefyArtistNotices=(()=>{
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
 const entries=[
  ['Noize MC','Иван Алексеев','Нойз МС'],
  ['Oxxxymiron','Мирон Фёдоров','Оксимирон'],
  ['Земфира','Земфира Рамазанова','Zemfira'],
  ['Монеточка','Елизавета Гырдымова','Monetochka'],
  ['MORGENSHTERN','Моргенштерн','Алишер Валеев'],
  ['FACE','Иван Дрёмин','Фейс'],
  ['Борис Гребенщиков','Boris Grebenshchikov','БГ'],
  ['Андрей Макаревич','Andrey Makarevich'],
  ['Лёва Би-2','Лева БИ2','Лёва БИ2','Егор Бортник'],
  ['Максим Покровский','Max Pokrovsky'],
  ['Владимир Котляров'],
  ['Илья Прусикин','Ilya Prusikin','Ильич'],
  ['Семён Слепаков','Semyon Slepakov'],
  ['Вася Обломов','Василий Гончаров','Vasya Oblomov'],
  ['Fuze Krec','Fuze','Артём Бровков'],
  ['Наоко','Naoko']
 ];
 const people=new Set(entries.flat().map(normalize));
 const groups=new Map([
  ['Аквариум','Борис Гребенщиков'],['Aquarium','Борис Гребенщиков'],
  ['Машина времени','Андрей Макаревич'],['Mashina Vremeni','Андрей Макаревич'],
  ['Би-2','Лёва Би-2'],['Bi-2','Лёва Би-2'],
  ['Ногу Свело!','Максим Покровский'],['Nogu Svelo','Максим Покровский'],
  ['Порнофильмы','Владимир Котляров'],['Pornofilmy','Владимир Котляров'],
  ['Little Big','Илья Прусикин'],['Krec','Артём Бровков'],['Стоптайм','Наоко'],['Stoptime','Наоко']
 ].map(([alias,person])=>[normalize(alias),person]));
 function label(name){const key=normalize(name);return people.has(key)?'Иноагент':groups.has(key)?groups.get(key)+' — иноагент':'';}
 function render(name){
  const heading=document.getElementById('artist-modal-name');if(!heading)return;
  let badge=document.getElementById('artist-agent-notice');
  if(!badge){badge=document.createElement('span');badge.id='artist-agent-notice';badge.className='artist-agent-notice';heading.after(badge);}
  const text=label(name);badge.textContent=text;badge.hidden=!text;
 }
 return {label,render};
})();

/* First-party aggregate events and short-lived authenticated presence. */
(()=>{
 let owner='',opened=false;
 const audio=document.getElementById('telefy-audio');let liveSession=crypto.randomUUID().replaceAll('-',''),liveSeq=0,liveOwner='',lastPosition=0,lastProgress=0,liveTimer=0,waiting=true;

 function event(name){if(!window.TelefyProfile?.user?.telegram_id)return;const body=JSON.stringify({event:name,event_id:crypto.randomUUID()});fetch('/api/me/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});}
 function start(){const id=String(window.TelefyProfile?.user?.telegram_id||'');if(owner!==id){owner=id;opened=false;}if(id&&!opened){opened=true;event('app_open');schedulePresence();}}
 window.addEventListener('telefy:profile-ready',start);if(window.TelefyProfile?.user)start();
 document.getElementById('telefy-audio')?.addEventListener('error',()=>event('playback_error'));
 const like=toggleLike;toggleLike=function(id,...args){const before=getTrack(id)?.liked;const result=like(id,...args);if(!before&&getTrack(id)?.liked)event('like');return result;};
 document.getElementById('btn-confirm-create-playlist')?.addEventListener('click',()=>event('playlist_create'));
 function presence(leaving=false){
  const id=String(window.TelefyProfile?.user?.telegram_id||'');if(!id)return;
  if(liveOwner!==id){liveOwner=id;liveSession=crypto.randomUUID().replaceAll('-','');liveSeq=0;}
  const visible=!leaving&&document.visibilityState==='visible'&&window.Telegram?.WebApp?.isActive!==false;
  const playing=!leaving&&!!audio&&!waiting&&!audio.paused&&!audio.ended&&!audio.seeking&&audio.readyState>=3&&lastProgress>0&&Date.now()-lastProgress<15000;
  const track=playing?getTrack(state.currentTrackId):null;
  const body=JSON.stringify({event:'presence',session:liveSession,seq:++liveSeq,visible,playing,title:String(track?.title||'').slice(0,160),artist:String(track?.artist||'').slice(0,160)});
  if(leaving&&navigator.sendBeacon){navigator.sendBeacon('/api/me/analytics',new Blob([body],{type:'application/json'}));return;}
  fetch('/api/me/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
 }
 function schedulePresence(){clearTimeout(liveTimer);liveTimer=setTimeout(()=>presence(),300);}
 if(audio){
  audio.addEventListener('timeupdate',()=>{const position=audio.currentTime;if(!audio.seeking&&!waiting&&!audio.paused&&position>lastPosition+.02){const first=!lastProgress;lastProgress=Date.now();if(first)schedulePresence();}lastPosition=position;});
  audio.addEventListener('playing',()=>{waiting=false;lastPosition=audio.currentTime;schedulePresence();});
  for(const name of ['pause','ended','waiting','seeking','emptied','error'])audio.addEventListener(name,()=>{waiting=true;lastProgress=0;schedulePresence();});
  audio.addEventListener('seeked',()=>{waiting=audio.paused||audio.readyState<3;lastPosition=audio.currentTime;schedulePresence();});
 }
 setInterval(()=>{if(document.visibilityState==='visible'||audio&&!audio.paused)presence();},20000);
 document.addEventListener('visibilitychange',schedulePresence);
 window.addEventListener('pagehide',()=>{clearTimeout(liveTimer);presence(true);});
 window.addEventListener('pageshow',schedulePresence);
 try{window.Telegram?.WebApp?.onEvent?.('activated',schedulePresence);window.Telegram?.WebApp?.onEvent?.('deactivated',schedulePresence);}catch(_){}
 window.TelefyAnalytics={event};
})();

window.TelefySavedAlbums=[];
window.TelefyAlbums=(()=>{
 let results=[],artists=[],query='',error='',busy=false,revision=0,active=null,favKind='tracks',favQuery='',albumTracks=[],albumRequest=0,nextAlbums=null,nextArtists=null;
 const cache=new Map(),artistPages=new Map();let starterMode=false;
 function continueStarter(){if(starterMode&&nextAlbums!==null&&state.activeTab==='search'&&state.searchFilter==='albums'&&!state.searchQuery.trim()){const rev=revision;setTimeout(()=>{if(rev===revision&&!busy&&state.activeTab==='search'&&state.searchFilter==='albums')loadMore('albums');},350);}}
 const esc=escapeTrackText;
 const releaseTitleKey=value=>{const text=String(value||'').trim().toLowerCase().replace(/…/g,'...');return text==='shh!'?'shh_bang':text==='shh...'?'shh_ellipsis':canonical(text);};
 const canonical=value=>String(value||'').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
 function uniqueAlbums(items){const unique=new Map();for(const a of items){const title=String(a.title||'').replace(new RegExp('^'+String(a.artist||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-–—:]\\s*','i'),'').replace(/\s*[[(](?:album|альбом|full album|official)[^\])]*[\])]/gi,'');const k=canonical(a.artist)+':'+releaseTitleKey(title);if(!unique.has(k))unique.set(k,a);}return [...unique.values()];}
 const albumKey=a=>canonical(a.artist)+':'+releaseTitleKey(String(a.title||'').replace(new RegExp('^'+String(a.artist||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-–—:]\\s*','i'),''));
 const liked=a=>window.TelefySavedAlbums.some(x=>albumKey(x)===albumKey(a));
 async function request(q,offset=0){const r=await fetch('/api/soundcloud/search?'+new URLSearchParams({q,offset}),{signal:AbortSignal.timeout(q.startsWith('telefy:album:')?90000:30000)});const d=await r.json();if(!r.ok){const error=Error(d.error||'catalog_unavailable');error.status=r.status;throw error;}return d;}
 function cards(items){return '<div class="album-grid">'+items.map((a,i)=>`<button class="release-card" data-release="${i}"><div class="release-art"><span class="tg-ico release-fallback">&#xF0BF;</span>${a.coverImg?`<img src="${esc(a.coverImg)}" alt="" loading="lazy">`:''}</div><strong>${esc(a.title)}</strong><span>${esc(a.artist)}</span><small>${esc(a.year||'')}</small></button>`).join('')+'</div>';}
 function releaseRows(items){return '<div class="release-row-list">'+items.map((a,i)=>`<button class="release-row" data-release="${i}"><div class="release-row-art">${a.coverImg?`<img src="${esc(a.coverImg)}" alt="">`:'<span class="tg-ico">&#xF0BF;</span>'}</div><span class="release-row-meta"><span class="release-row-title"><strong>${esc(a.title)}</strong><span class="release-type">Альбом</span></span><span class="release-row-subtitle">${esc(a.artist)}${a.year?' · '+esc(a.year):''}</span></span><span class="release-row-chevron">›</span></button>`).join('')+'</div>';}
 function bindCards(box,items){box.querySelectorAll('.release-art img,.release-row-art img').forEach(img=>img.onerror=()=>img.remove());box.querySelectorAll('[data-release]').forEach(b=>b.onclick=()=>open(items[Number(b.dataset.release)]));}
 function loadingRows(kind){return window.TelefySkeleton.html(kind);}
 function renderExtra(){
  const box=document.getElementById('search-results-list');if(!box)return;const type=state.searchFilter;box.classList.toggle('release-result-cards',type==='albums'||type==='all');
  const previous=box.querySelector(':scope > .all-tracks-group');if(previous){previous.replaceWith(...previous.childNodes);}box.querySelector(':scope > .all-tracks-heading')?.remove();
  box.querySelector('.release-search-extra')?.remove();
  document.getElementById('search-scroll-sentinel').hidden=['artists','albums'].includes(type);
  if(type==='tracks')return;
  const host=document.createElement('div');host.className='release-search-extra';
  if(type==='albums'||type==='artists'){box.replaceChildren(host);box._searchRows=[];box.classList.add('search-was-empty');}
  else box.prepend(host);
  if(type==='albums'){
   if(results.length){host.innerHTML=(type==='all'?'<h3 class="release-heading">Альбомы</h3>':'')+releaseRows(type==='all'?results.slice(0,4):results);bindCards(host,results);}
   else if(type==='albums'&&busy)host.innerHTML=loadingRows('albums');else if(type==='albums')host.textContent=error?(error==='soundcloud_rate_limited'?'SoundCloud временно ограничил запросы. Попробуй позже.':'Не удалось загрузить альбомы. Код: '+error+'. Повтори загрузку.'):nextAlbums!==null?'В этой порции релизов нет. Загрузи следующую.':'Альбомы не найдены';
  }
  if(type==='albums'&&error){const retry=document.createElement('button');retry.className='release-load-more';retry.textContent='Повторить загрузку';retry.onclick=()=>{cache.delete(query);query='';search();};host.append(retry);}
  if(type==='artists'||type==='all'){
   if(artists.length){const list=document.createElement('div');list.className='artist-search-list';list.innerHTML=(type==='all'?'<h3 class="release-heading">Артисты</h3>':'')+artists.map((a,i)=>`<button data-found-artist="${i}"><span class="artist-search-avatar"><span>${esc(Array.from(a.name||'?')[0])}</span>${(a.coverImg||getArtistAvatarUrl(a.name))?`<img src="${esc(a.coverImg||getArtistAvatarUrl(a.name))}" alt="">`:''}</span><span>${esc(a.name)}</span><span class="artist-search-chevron">›</span></button>`).join('');list.querySelectorAll('img').forEach(img=>img.onerror=()=>img.remove());list.querySelectorAll('[data-found-artist]').forEach(b=>b.onclick=()=>openArtistCard(artists[Number(b.dataset.foundArtist)].name));host.append(list);}
   else if(type==='artists'&&busy)host.innerHTML=loadingRows('artists');else if(type==='artists')host.textContent=error?'Не удалось загрузить артистов.':'Артисты не найдены';
  }
  if(type==='all'){const rows=[...box.children].filter(n=>n!==host);if(rows.length){const heading=document.createElement('h3');heading.className='release-heading all-tracks-heading';heading.textContent='Треки';const group=document.createElement('div');group.className='tg-card all-tracks-group';group.append(...rows);box.append(heading,group);}box._searchRows=[];box.classList.add('search-was-empty');}
  if(['artists','albums'].includes(type)){
   document.getElementById('search-scroll-sentinel').hidden=true;
   if((type==='albums'?nextAlbums:nextArtists)!==null){const more=document.createElement('button');more.className='release-load-more';if(busy){more.innerHTML='<span class="catalog-spinner" aria-label="Загрузка"></span>';}else more.textContent='Загрузить ещё';more.disabled=busy;more.onclick=()=>loadMore(type);host.append(more);}
  }
 }
 async function loadMore(kind){if(busy)return;busy=true;const rev=revision,offset=kind==='albums'?nextAlbums:nextArtists;renderExtra();try{const data=await request('telefy:'+kind+':'+state.searchQuery.trim(),offset);if(rev!==revision)return;if(kind==='albums'){results=uniqueAlbums([...results,...(data.albums||[])]);nextAlbums=data.hasMore?data.nextOffset:null;}else{artists=[...new Map([...artists,...(data.artists||[])].map(a=>[a.id,a])).values()];nextArtists=data.hasMore?data.nextOffset:null;}}catch(error){starterMode=false;if(error.message==='album_catalog_cursor_expired'&&kind==='albums'){nextAlbums=0;cache.delete(query);showToast('Каталог обновился. Нажми «Загрузить ещё» для продолжения.');}else showToast('Не удалось загрузить следующую страницу. Попробуй ещё раз.');}finally{if(rev===revision){busy=false;renderExtra();continueStarter();}}}
 async function search(){
  const q=state.searchQuery.trim(),type=state.searchFilter;if(type==='tracks')return;
  const key=q+'::'+type;if(key===query)return;query=key;const rev=++revision;busy=true;error='';results=[];artists=[];nextAlbums=null;nextArtists=null;renderExtra();if(q&&q.length<2){busy=false;renderExtra();return;}
  try{let data=cache.get(key);if(!data){data=await Promise.all([type==='albums'?request('telefy:albums:'+q):Promise.resolve({albums:[]}),(type==='artists'||q.length>=2&&type==='all')?request('telefy:artists:'+q):Promise.resolve({artists:[]})]);cache.set(key,data);if(cache.size>40)cache.delete(cache.keys().next().value);}if(rev!==revision)return;starterMode=data[0].starter===true;results=uniqueAlbums(data[0].albums||[]);artists=data[1].artists||[];nextAlbums=data[0].hasMore?data[0].nextOffset:null;nextArtists=data[1].hasMore?data[1].nextOffset:null;}catch(_){if(rev===revision){error=_.message||'failed';starterMode=false;}}finally{if(rev===revision){busy=false;renderExtra();continueStarter();}}
 }
 function paintHeart(){const b=document.getElementById('album-save-heart');if(!b||!active)return;const yes=liked(active);b.classList.toggle('is-liked',yes);b.setAttribute('aria-pressed',String(yes));b.setAttribute('aria-label',yes?'Удалить альбом из любимого':'Добавить альбом в любимое');b.innerHTML=`<span class="tg-ico">${yes?'&#xF016;':'&#xF1D9;'}</span>`;}
 async function toggleAlbum(){if(!active)return;if(!window.TelefyLibrary?.ready){await window.TelefyLibrary?.restore();if(!window.TelefyLibrary?.ready){showToast('Библиотека ещё загружается. Попробуй через несколько секунд.');return;}}const heart=document.getElementById('album-save-heart');if(heart.disabled)return;heart.disabled=true;const a=active;const i=window.TelefySavedAlbums.findIndex(x=>albumKey(x)===albumKey(a));if(i<0)window.TelefySavedAlbums.push({...a});else window.TelefySavedAlbums=window.TelefySavedAlbums.filter(x=>albumKey(x)!==albumKey(a));paintHeart();renderFavorites();try{await window.TelefyLibrary.save();}finally{heart.disabled=false;paintHeart();}}
 function renderAlbum(){const box=document.getElementById('album-modal-tracks');box.innerHTML=albumTracks.map(createTrackRowHTML).join('');box.querySelectorAll('.track-play-trigger').forEach(b=>b.onclick=()=>{window.TelefyOrderedQueue.start(albumTracks.map(t=>t.id),Number(b.dataset.play),active.title,'playlist');syncTrackRowPlayback();});box.querySelectorAll('[data-like]').forEach(b=>b.onclick=()=>{toggleLike(Number(b.dataset.like));renderAlbum();});syncTrackRowPlayback();}
 async function open(a){
  active=a;document.getElementById('album-modal').classList.add('soundcloud-album');document.getElementById('album-modal-cover').parentElement.classList.add('album-release-header');albumTracks=[];const rev=++albumRequest;document.getElementById('album-back-artist-label').textContent=a.artist;document.getElementById('album-modal-title').textContent=a.title;document.getElementById('album-modal-artist').textContent=a.artist;document.getElementById('album-modal-meta').textContent=[a.year,a.trackCount?`${a.trackCount} треков`:''].filter(Boolean).join(' · ');applyCoverStyle(document.getElementById('album-modal-cover'),{coverImg:a.coverImg,cover:'#2857a2'});const releaseArt=document.getElementById('album-modal-cover');releaseArt.style.backgroundImage='';releaseArt.innerHTML='<span class="tg-ico release-fallback">&#xF0BF;</span>';if(a.coverImg){const img=document.createElement('img');img.src=a.coverImg;img.alt='';img.className='release-cover-img';img.onerror=()=>img.remove();releaseArt.append(img);}document.getElementById('album-modal-tracks').innerHTML=loadingRows('tracks');document.getElementById('btn-album-shuffle').hidden=false;document.querySelector('#btn-album-shuffle .tg-ico').textContent=document.querySelector('#btn-full-shuffle .tg-ico').textContent;document.querySelector('#album-modal > .col-sheet-panel').style.setProperty('--album-art',a.coverImg?'url('+JSON.stringify(a.coverImg)+')':'none');
  let heart=document.getElementById('album-save-heart');if(!heart){heart=document.createElement('button');heart.id='album-save-heart';heart.className='album-save-heart';heart.onclick=toggleAlbum;document.getElementById('btn-album-play-all').after(heart);}heart.hidden=false;paintHeart();
  const play=document.getElementById('btn-album-play-all');play.disabled=true;document.getElementById('album-back-artist-label').textContent='Назад';document.querySelector('#album-modal > .col-sheet-panel').scrollTop=0;openSheetModal('album-modal','light');
  try{const data=await request('telefy:album:'+a.id);if(rev!==albumRequest)return;active={...a,...data.album};mergeParsedTracksIntoCatalog(data.tracks||[]);albumTracks=(data.tracks||[]).map(row=>tracks.find(t=>t.soundcloudUrn===row.soundcloudUrn)).filter(Boolean);document.getElementById('album-modal-meta').textContent=[active.year,active.expectedTrackCount&&active.complete===false?`${albumTracks.length} из ${active.expectedTrackCount} треков`:`${albumTracks.length} треков`].filter(Boolean).join(' · ');if(!albumTracks.length)document.getElementById('album-modal-tracks').textContent='В альбоме нет доступных для воспроизведения треков.';else renderAlbum();play.disabled=!albumTracks.length;}catch(error){if(rev!==albumRequest)return;const box=document.getElementById('album-modal-tracks');box.innerHTML='';const text=document.createElement('p');text.className='release-empty';text.textContent=error.status===429?'SoundCloud временно ограничил запросы. Попробуй позже.':error.message==='album_source_mismatch'?'Треклист источника не соответствует альбому.':error.message==='album_no_playable_tracks'?'В источнике пока нет доступных треков этого альбома.':'Не удалось загрузить альбом. Проверь соединение и повтори.';const retry=document.createElement('button');retry.className='release-load-more';retry.textContent='Повторить загрузку';retry.onclick=()=>open(a);box.append(text,retry);}
 }
 function positionFavoritesLens(){const tabs=document.querySelector('#view-favorites .release-tabs'),button=tabs?.querySelector('[aria-pressed="true"]'),lens=tabs?.querySelector('.release-tabs-lens');if(!button||!lens)return;lens.style.width=button.offsetWidth+'px';lens.style.transform='translateX('+button.offsetLeft+'px)';}
 function renderFavorites(){
  const view=document.getElementById('view-favorites');if(!view)return;view.querySelectorAll('[data-fav-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.favKind===favKind)));
  requestAnimationFrame(positionFavoritesLens);
  const box=document.getElementById('favorites-content'),q=favQuery.trim().toLocaleLowerCase();if(window.TelefyLibrary?.loading&&!window.TelefySavedAlbums.length&&!tracks.some(t=>t.liked)){box.innerHTML=window.TelefySkeleton.html(favKind==='albums'?'cards':'tracks',favKind==='albums'?2:6);return;}box.classList.toggle('is-albums',favKind==='albums');
  if(favKind==='albums'){const items=uniqueAlbums(window.TelefySavedAlbums).filter(a=>(a.title+' '+a.artist).toLocaleLowerCase().includes(q));box.innerHTML=items.length?cards(items):'<p class="release-empty">Здесь появятся любимые альбомы</p>';bindCards(box,items);}
  else{const items=tracks.filter(t=>t.liked&&(t.title+' '+t.artist).toLocaleLowerCase().includes(q));box.innerHTML=items.length?items.map(createTrackRowHTML).join(''):'<p class="release-empty">Здесь появятся любимые треки</p>';box.querySelectorAll('.track-play-trigger').forEach(b=>b.onclick=()=>window.TelefyOrderedQueue.start(items.map(t=>t.id),Number(b.dataset.play),'Любимое','favorites'));box.querySelectorAll('[data-like]').forEach(b=>b.onclick=()=>{toggleLike(Number(b.dataset.like));renderFavorites();});syncTrackRowPlayback();}
 }
 function showFavorites(){if(!state.isMaxSubscribed){openUpsellModal();return;}switchTab('favorites');renderFavorites();window.scrollTo({top:0,behavior:'instant'});}
 function install(){const view=document.createElement('section');view.id='view-favorites';view.className='hidden favorites-screen';view.innerHTML='<div class="favorites-title"><button id="favorites-back" aria-label="Назад"><span aria-hidden="true">←</span><span>Назад</span></button><h1 class="font-rounded">Любимое</h1></div><p class="favorites-description">Самые избранные исполнители в вашей библиотеке Telefy Max.</p><div class="favorites-search-field"><span class="tg-ico" aria-hidden="true">&#xF250;</span><input id="favorites-search" class="release-search" type="search" placeholder="Поиск в любимом" aria-label="Поиск в любимом"></div><div class="release-tabs"><span class="release-tabs-lens" aria-hidden="true"></span><button data-fav-kind="tracks" aria-pressed="true">Треки</button><button data-fav-kind="albums" aria-pressed="false">Альбомы</button></div><div id="favorites-content" class="tg-card"></div>';document.getElementById('view-search').after(view);new ResizeObserver(positionFavoritesLens).observe(view.querySelector('.release-tabs'));view.querySelector('#favorites-back').onclick=()=>switchTab('mytelefy');view.querySelector('input').oninput=e=>{favQuery=e.target.value;renderFavorites();};view.querySelectorAll('[data-fav-kind]').forEach(b=>b.onclick=()=>{if(favKind===b.dataset.favKind)return;triggerHaptic('light');favKind=b.dataset.favKind;renderFavorites();});}
 const oldRender=renderSearchView;renderSearchView=function(...args){oldRender(...args);renderExtra();if(state.activeTab==='search')search();};
 const oldPlayer=renderPlayerUI;renderPlayerUI=function(...args){const r=oldPlayer(...args);paintHeart();return r;};
 const oldLike=toggleLike;toggleLike=function(...args){const r=oldLike(...args);if(state.activeTab==='favorites')renderFavorites();return r;};
 window.addEventListener('telefy:library-painted',()=>{paintHeart();if(state.activeTab==='favorites')renderFavorites();});
 const oldSwitch=switchTab;switchTab=function(tab,...args){const r=oldSwitch(tab,...args);if(tab==='search'){renderSearchView();}return r;};
 fetchDeezerArtistAlbums=async function(name){try{const d=await request('telefy:albums:'+name);artistPages.set(name,{next:d.nextOffset,more:d.hasMore});return(d.albums||[]).map(a=>({...a,img:a.coverImg,artistName:a.artist}));}catch(_){return [];}};
 renderArtistAlbumsCarousel=function(albums,name,box){if(!box)return;const items=albums.map(a=>({...a,coverImg:a.coverImg||a.img||'',artist:a.artist||a.artistName||name}));box.innerHTML=cards(items);box.querySelector('.album-grid')?.classList.add('artist-release-grid');box.querySelectorAll('.release-art img').forEach(img=>img.onerror=()=>img.remove());box.querySelectorAll('[data-release]').forEach(b=>b.onclick=()=>openAlbumModal(albums[Number(b.dataset.release)],name));if(artistPages.get(name)?.more){const more=document.createElement('button');more.className='release-load-more';more.textContent='Все альбомы';more.onclick=async()=>{more.disabled=true;const placeholder=document.createElement('div');placeholder.innerHTML=window.TelefySkeleton.html('cards',2);box.append(placeholder);try{const page=artistPages.get(name);const d=await request('telefy:albums:'+name,page.next);artistPages.set(name,{next:d.nextOffset,more:d.hasMore});const merged=uniqueAlbums([...albums,...(d.albums||[]).map(a=>({...a,img:a.coverImg,artistName:a.artist}))]);renderArtistAlbumsCarousel(merged,name,box);}catch(_){placeholder.remove();more.disabled=false;showToast('Не удалось загрузить альбомы. Повтори позже.');}};box.append(more);}};
 const originalArtistCard=openArtistCard;
 openArtistCard=function(name){const canonicalName=findRosterConfig(name)?.name||name;return originalArtistCard(canonicalName);};
 const oldAlbum=openAlbumModal;openAlbumModal=function(a,artist){if(a?.id?.startsWith?.('soundcloud:playlists:'))return open(a);if(a?.collectionId?.startsWith?.('soundcloud:playlists:'))return open({id:a.collectionId,title:a.title,artist:artist||a.artistName,year:a.year||'',coverImg:a.img||'',url:''});active=null;document.getElementById('btn-album-play-all').disabled=false;document.getElementById('btn-album-shuffle').hidden=false;document.getElementById('album-modal').classList.remove('soundcloud-album');document.getElementById('album-save-heart')?.setAttribute('hidden','');return oldAlbum(a,artist);};
 document.getElementById('album-modal-artist').addEventListener('click',event=>{if(!active)return;event.stopImmediatePropagation();const name=active.artist;closeAlbumModal();openArtistCard(name);},true);
 document.getElementById('btn-album-shuffle').addEventListener('click',e=>{if(!active)return;e.stopImmediatePropagation();const ids=albumTracks.map(t=>t.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}if(ids.length)window.TelefyOrderedQueue.start(ids,ids[0],active.title,'playlist');},true);
 document.getElementById('btn-album-play-all').addEventListener('click',e=>{if(!active)return;e.stopImmediatePropagation();if(albumTracks.length)window.TelefyOrderedQueue.start(albumTracks.map(t=>t.id),albumTracks[0].id,active.title,'playlist');},true);
 install();return {open,showFavorites,renderFavorites};
})();

window.TelefyArtistCredits=(credit,name)=>{const cfg=findRosterConfig(name);const names=[name,...(cfg?.aliases||[])];const key=s=>String(s||'').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');return String(credit||'').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|[,&/]/i).some(part=>names.some(alias=>key(part.replace(/[()]/g,''))===key(alias)));};

window.addEventListener('telefy:library-loading',()=>{renderMaxBetaView();if(state.activeTab==='favorites')window.TelefyAlbums.renderFavorites();});

const renderBeforeContentSkeletons=renderPlayerUI;
renderPlayerUI=function(...args){const result=renderBeforeContentSkeletons(...args);const current=getTrack(state.currentTrackId);if(!current?.id&&(state.isCatalogParsing||window.TelefyFirstRun?.loading)){for(const id of ['hero-track-title','mini-title','full-title']){const el=document.getElementById(id);if(el)el.innerHTML=window.TelefySkeleton.html('note',1);}}return result;};

/* Full player composition; existing controls keep their original listeners. */
(() => {
 const modal=document.getElementById('full-player-modal'),cover=document.getElementById('full-cover');
 modal.classList.add('player-refresh');
 const top=document.getElementById('btn-close-full-player').parentElement,art=cover.parentElement,deck=modal.lastElementChild;
 top.classList.add('player-refresh-top');art.classList.add('player-refresh-art');deck.className='player-refresh-deck';
 const title=document.getElementById('full-title'),artist=document.getElementById('full-artist'),avatar=document.getElementById('btn-open-artist-card');
 const timeline=document.getElementById('full-seek-slider').parentElement;
 const titleRow=document.createElement('div');titleRow.className='player-refresh-title';titleRow.append(title,document.getElementById('full-explicit-badge'));
 const credit=document.createElement('div');credit.className='player-refresh-credit';credit.append(avatar,artist);
 const info=document.createElement('div');info.className='player-refresh-info';info.append(titleRow,credit);
 const transport=document.createElement('div');transport.className='player-refresh-transport';
 for(const id of ['btn-full-shuffle','full-prev-btn','full-play-btn','full-next-btn','btn-full-queue'])transport.append(document.getElementById(id));
 const tools=document.createElement('div');tools.className='player-refresh-tools';for(const id of ['btn-full-repeat','full-dislike-btn','btn-send-to-bot'])tools.append(document.getElementById(id));
 const dormant=document.createElement('div');dormant.hidden=true;for(const id of ['btn-full-lyrics','full-album-btn','full-album-sep'])dormant.append(document.getElementById(id));
 const label=document.createElement('span');label.id='player-refresh-caption';label.className='player-refresh-caption';
 top.replaceChildren(document.getElementById('btn-close-full-player'),label,document.getElementById('full-like-btn'));
 document.getElementById('btn-close-full-player').innerHTML='<svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 6-6 6 6 6M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 deck.replaceChildren(info,timeline,transport,tools,dormant);timeline.classList.add('player-refresh-timeline');
 const ambient=document.createElement('div');ambient.className='player-refresh-ambient';ambient.setAttribute('aria-hidden','true');modal.prepend(ambient);
 let lastCover='';
 const before=renderPlayerUI;renderPlayerUI=function(...args){const result=before(...args),track=getTrack(state.currentTrackId);label.textContent=state.lang==='en'?'Now playing':'Сейчас играет';if(track?.coverImg!==lastCover){lastCover=track?.coverImg||'';ambient.style.backgroundImage=/^https?:\/\//.test(lastCover)?'url('+JSON.stringify(lastCover)+')':'';}return result;};
 renderPlayerUI();
})();

/* Reuse the player's cover-coloured ambient light in release sheets. */
(()=>{
 function paint(id,coverId){const modal=document.getElementById(id),cover=document.getElementById(coverId),panel=modal?.querySelector('.col-sheet-panel');if(!cover||!panel)return;const image=cover.querySelector('img');const url=image?.getAttribute('src');const background=url?'url('+JSON.stringify(url)+')':cover.style.backgroundImage||'none';panel.classList.add('release-ambient-panel');panel.style.setProperty('--release-ambient-art',background);}
 for(const [modal,cover]of [['collection-modal','col-modal-cover'],['album-modal','album-modal-cover']]){const art=document.getElementById(cover);if(!art)continue;const observer=new MutationObserver(()=>paint(modal,cover));observer.observe(art,{attributes:true,childList:true,subtree:true,attributeFilter:['style','src']});paint(modal,cover);}
})();

/* Queue is a view of the playback source, never a navigation shortcut. */
window.TelefyPlayerQueue=(()=>{
 const modal=document.getElementById('player-queue-modal'),list=document.getElementById('player-queue-list');
 function items(){const ordered=window.TelefyOrderedQueue?.snapshot();return {ordered,ids:(ordered?ordered.ids.slice(ordered.index+1):state.queueIds||[]).filter(id=>id!==state.currentTrackId&&tracks.some(t=>t.id===id))};}
 function choose(id){
  const {ordered,ids}=items();if(!ids.includes(id))return;
  if(ordered)window.TelefyOrderedQueue.start(ordered.ids,id,ordered.label,ordered.kind);
  else{state.queueIds=ids.slice(ids.indexOf(id)+1);playTrack(id,state.sourceLabel);}
  render();
 }
 function render(){
  const english=state.lang==='en',queue=items(),current=tracks.find(t=>t.id===state.currentTrackId);
  document.getElementById('player-queue-title').textContent=english?'Up next':'Далее';
  document.getElementById('player-queue-source').textContent=state.sourceLabel||'';
  document.getElementById('player-queue-current-label').textContent=english?'Now playing':'Сейчас играет';
  document.getElementById('player-queue-next-label').textContent=english?'Playing next:':'Играет далее:';
  const now=document.getElementById('player-queue-current');now.innerHTML=current?createTrackRowHTML(current):'';
  now.querySelector('[data-play]')?.addEventListener('click',()=>togglePlay());
  now.querySelector('[data-like]')?.addEventListener('click',()=>{toggleLike(current.id);render();});
  list.innerHTML=queue.ids.length?queue.ids.map(id=>createTrackRowHTML(tracks.find(t=>t.id===id))).join(''):'<p class="release-empty">'+(english?'The queue is empty':'Очередь пока пуста')+'</p>';
  list.querySelectorAll('[data-play]').forEach(button=>button.onclick=()=>choose(Number(button.dataset.play)));
  list.querySelectorAll('[data-like]').forEach(button=>button.onclick=()=>{toggleLike(Number(button.dataset.like));render();});
  document.getElementById('player-queue-shuffle').textContent=isShuffle?(english?'Shuffle is on':'Включён случайный порядок'):'';
  syncTrackRowPlayback();
 }
 function open(){render();openSheetModal(modal);modal.querySelector('.col-sheet-panel').scrollTop=0;}
 document.getElementById('player-queue-close').onclick=()=>closeSheetModal(modal);
 modal.addEventListener('click',e=>{if(e.target===modal)closeSheetModal(modal);});
 const before=renderPlayerUI;renderPlayerUI=function(...args){const result=before(...args);if(!modal.classList.contains('hidden'))render();return result;};
 return {open,render};
})();
