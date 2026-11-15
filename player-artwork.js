/* Preload the next artwork, then dissolve it over the previous one. */
(() => {
  let key = '', revision = 0, pendingImage = null, loadTimer = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function update(track) {
    const host = document.getElementById('full-cover');
    if (!host || !track) return;
    const url = /^https?:\/\//.test(track.coverImg || '') ? track.coverImg : '';
    const background = track.cover || '#1E293B';
    const nextKey = JSON.stringify([url, background]);
    if (nextKey === key) return;
    key = nextKey;
    const token = ++revision;
    clearTimeout(loadTimer);
    if (pendingImage) {
      pendingImage.onload = pendingImage.onerror = null;
      pendingImage.removeAttribute('src'); pendingImage = null;
    }
    const legacyGlyph = document.getElementById('full-center-artwork');
    legacyGlyph.classList.add('hidden');
    const commit = image => {
      if (token !== revision) return;
      clearTimeout(loadTimer); pendingImage = null;
      const previous = [...host.querySelectorAll('.full-cover-layer')];
      const layer = document.createElement('div');
      layer.className = 'full-cover-layer'; layer.style.backgroundColor = background;
      layer.setAttribute('aria-hidden', 'true');
      if (image) {
        image.className = 'cover-art-img'; image.alt = '';
        layer.append(image);
      } else {
        const glyph = legacyGlyph.cloneNode(true);
        glyph.removeAttribute('id'); glyph.classList.remove('hidden');
        layer.append(glyph);
      }
      host.insertBefore(layer, host.firstChild);
      // New layers must be above all previous covers, but below lyrics.
      previous.forEach(el => host.insertBefore(el, layer));
      host.style.backgroundImage = 'none';
      if (!previous.length || reducedMotion.matches) {
        previous.forEach(el => el.remove()); return;
      }
      const fade = layer.animate([{opacity:0},{opacity:1}], {
        duration:420, easing:'cubic-bezier(.22,1,.36,1)', fill:'both'
      });
      fade.finished.then(() => {
        layer.style.opacity = '1'; fade.cancel();
        previous.forEach(el => el.remove());
      }).catch(() => {});
    };
    if (!url) { commit(null); return; }
    // Keep the current cover visible for the entire network/decode wait.
    if (!host.querySelector('.full-cover-layer')) {
      const placeholder = document.createElement('div');
      placeholder.className = 'full-cover-layer'; placeholder.style.backgroundColor = background;
      const glyph = legacyGlyph.cloneNode(true);
      glyph.removeAttribute('id'); glyph.classList.remove('hidden'); placeholder.append(glyph);
      host.insertBefore(placeholder, host.firstChild);
    }
    const image = new Image(); pendingImage = image;
    image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
    let settled = false;
    const finish = result => {
      if (settled || token !== revision) return;
      settled = true; image.onload = image.onerror = null;
      commit(result);
    };
    image.onload = async () => {
      try { await image.decode(); } catch (_) { /* Loaded image may already be usable. */ }
      finish(image.naturalWidth ? image : null);
    };
    image.onerror = () => {
      if (token !== revision) return;
      if (image.src.includes('1000x1000')) image.src = image.src.replace('1000x1000','500x500');
      else if (image.src.includes('500x500')) image.src = image.src.replace('500x500','250x250');
      else finish(null);
    };
    loadTimer = setTimeout(() => finish(null), 8000);
    image.src = url;
  }
  window.TelefyArtwork = { update };
})();
