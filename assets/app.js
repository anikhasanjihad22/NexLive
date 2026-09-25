/**
 * NexLive — app.js
 * UI + player logic for index.html. All channel data comes from
 * NexLiveStore (assets/js/store.js); this file never touches
 * localStorage directly.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let allChannels = [];        // every enabled+disabled channel from the store
  let currentList = [];        // channel(s) currently loaded in the player's queue
  let currentIndex = -1;
  let hls = null;
  let failCount = 0;
  const MAX_AUTO_SKIP = 6;     // stop auto-skipping after this many consecutive failures
  const triedIds = new Set();  // channels already tried during one auto-skip pass
  let heroTimer = null;
  let heroIndex = 0;
  let heroChannels = [];
  let activeFilter = { type: 'all', value: null };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FLAGS = {
    BD: '🇧🇩', IN: '🇮🇳', PK: '🇵🇰', US: '🇺🇸', GB: '🇬🇧', KR: '🇰🇷', JP: '🇯🇵',
    SA: '🇸🇦', AE: '🇦🇪', NP: '🇳🇵', LK: '🇱🇰', CA: '🇨🇦', AU: '🇦🇺', FR: '🇫🇷', DE: '🇩🇪',
  };
  function flagFor(code) { return FLAGS[code] || '📺'; }

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------
  let toastTimer = null;
  function showToast(msg, duration = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ---------------------------------------------------------------------
  // Splash screen
  // ---------------------------------------------------------------------
  function hideSplash() {
    const splash = $('#splash');
    splash.classList.add('hide');
    sessionStorage.setItem('nexlive_splash_seen', '1');
  }

  // ---------------------------------------------------------------------
  // loadChannels — fetch/merge all channel data via the store
  // ---------------------------------------------------------------------
  async function loadChannels() {
    try {
      allChannels = await NexLiveStore.getAllChannels();
    } catch (e) {
      console.error('loadChannels failed', e);
      allChannels = [];
      showToast('Unable to load channel list.');
    }
    return allChannels;
  }

  // ---------------------------------------------------------------------
  // Rendering: channel cards
  // ---------------------------------------------------------------------
  function buildCard(channel) {
    const tpl = $('#cardTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    const img = $('img', node);
    img.src = channel.logo || fallbackLogo();
    img.alt = channel.name;
    img.onerror = () => { img.src = fallbackLogo(); };
    $('.card-name', node).textContent = channel.name;
    $('.flag', node).textContent = flagFor(channel.countryCode);
    $('.country-name', node).textContent = channel.country;
    const liveBadge = $('.badge-live', node);
    liveBadge.style.display = channel.enabled ? '' : 'none';
    node.setAttribute('aria-label', `${channel.name}, ${channel.country}, watch live`);
    node.addEventListener('click', () => openPlayer(channel, currentQueueFor(channel)));
    return node;
  }

  function fallbackLogo() {
    return 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="16" fill="#181D29"/>
        <text x="50" y="58" font-size="34" text-anchor="middle" fill="#4C6FFF" font-family="sans-serif">N</text>
      </svg>`);
  }

  function renderRow(container, channels) {
    container.innerHTML = '';
    if (!channels.length) {
      const empty = document.createElement('div');
      empty.className = 'grid-empty';
      empty.textContent = 'No channels found';
      container.appendChild(empty);
      return;
    }
    channels.forEach((ch) => container.appendChild(buildCard(ch)));
  }

  // ---------------------------------------------------------------------
  // renderFeaturedSlider (hero)
  // ---------------------------------------------------------------------
  function renderFeaturedSlider(channels) {
    heroChannels = NexLiveStore.orderFeatured(channels).slice(0, 8);
    const slider = $('#heroSlider');
    const dots = $('#heroDots');
    // remove old slides, keep nav controls
    $$('.hero-slide', slider).forEach((n) => n.remove());
    dots.innerHTML = '';

    if (!heroChannels.length) {
      slider.style.display = 'none';
      return;
    }
    slider.style.display = '';

    heroChannels.forEach((ch, i) => {
      const slide = document.createElement('div');
      slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
      if (ch.logo) slide.style.backgroundImage = `url('${ch.logo}')`;
      slide.innerHTML = `
        <div class="hero-content">
          <img class="hero-logo" src="${ch.logo || fallbackLogo()}" alt="" onerror="this.src='${fallbackLogo()}'"/>
          <div class="hero-info">
            <div class="hero-name">${escapeHtml(ch.name)}</div>
            <div class="hero-meta">
              <span class="badge badge-live">LIVE</span>
              <span>${flagFor(ch.countryCode)} ${escapeHtml(ch.country)}</span>
              <span>${escapeHtml(ch.category)}</span>
            </div>
          </div>
          <button class="hero-watch">Watch</button>
        </div>`;
      $('.hero-watch', slide).addEventListener('click', () => openPlayer(ch, heroChannels));
      slider.insertBefore(slide, slider.firstChild.nextSibling || null);
      slider.appendChild(slide);

      const dot = document.createElement('button');
      dot.className = i === 0 ? 'active' : '';
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      dot.addEventListener('click', () => goToHeroSlide(i));
      dots.appendChild(dot);
    });

    heroIndex = 0;
    startHeroAutoplay();
  }

  function goToHeroSlide(i) {
    if (!heroChannels.length) return;
    heroIndex = (i + heroChannels.length) % heroChannels.length;
    $$('.hero-slide', $('#heroSlider')).forEach((s, idx) => s.classList.toggle('active', idx === heroIndex));
    $$('#heroDots button').forEach((d, idx) => d.classList.toggle('active', idx === heroIndex));
  }

  function startHeroAutoplay() {
    clearInterval(heroTimer);
    if (heroChannels.length < 2) return;
    heroTimer = setInterval(() => goToHeroSlide(heroIndex + 1), 5000);
  }
  function pauseHeroAutoplay() { clearInterval(heroTimer); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------
  // Homepage sections (Bangladesh / India / Sports / ...)
  // ---------------------------------------------------------------------
  function renderSections(channels) {
    const wrap = $('#sectionsContainer');
    wrap.innerHTML = '';
    const sections = NexLiveStore.getHomepageSections().filter((s) => s.enabled);
    sections.forEach((section) => {
      const list = NexLiveStore.channelsForSection(channels, section);
      if (!list.length) return; // skip empty sections rather than showing clutter
      const sec = document.createElement('section');
      sec.className = 'section';
      sec.innerHTML = `
        <div class="section-head"><h2 class="section-title">${escapeHtml(section.label)}</h2></div>
        <div class="row-scroll" data-section="${section.id}"></div>`;
      wrap.appendChild(sec);
      renderRow($('.row-scroll', sec), list.slice(0, 20));
    });
  }

  // ---------------------------------------------------------------------
  // Country / category filter chips
  // ---------------------------------------------------------------------
  function renderFilterChips(channels) {
    const row = $('#filterChips');
    row.innerHTML = '';
    const countries = [...new Set(channels.map((c) => c.country))].sort();

    const allChip = makeChip('All', () => applyFilter({ type: 'all', value: null }), true);
    row.appendChild(allChip);
    countries.forEach((country) => {
      row.appendChild(makeChip(country, () => applyFilter({ type: 'country', value: country })));
    });
  }

  function makeChip(label, onClick, active = false) {
    const btn = document.createElement('button');
    btn.className = 'chip' + (active ? ' active' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      $$('.chip', $('#filterChips')).forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      onClick();
    });
    return btn;
  }

  function applyFilter(filter) {
    activeFilter = filter;
    const enabled = allChannels.filter((c) => c.enabled);
    if (filter.type === 'all') {
      renderSections(enabled);
      $('#browseView').style.display = '';
      $('#searchResults').style.display = 'none';
      return;
    }
    const list = filterByCountry(enabled, filter.value);
    showFlatResults(list, filter.value);
  }

  function filterByCountry(channels, country) {
    return channels.filter((c) => c.country === country);
  }
  function filterByCategory(channels, category) {
    return channels.filter((c) => c.category === category);
  }

  function showFlatResults(list, label) {
    $('#browseView').style.display = 'none';
    const results = $('#searchResults');
    results.style.display = '';
    $('.section-title', results).textContent = label;
    renderRow($('#searchGrid'), list);
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  function searchChannels(query, channels) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return channels.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      (c.language && c.language.toLowerCase().includes(q))
    );
  }

  let searchDebounce = null;
  function setupSearch() {
    const input = $('#searchInput');
    input.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const q = input.value;
        if (!q.trim()) {
          $('#searchResults').style.display = 'none';
          $('#browseView').style.display = '';
          return;
        }
        const enabled = allChannels.filter((c) => c.enabled);
        const results = searchChannels(q, enabled);
        $('#browseView').style.display = 'none';
        const box = $('#searchResults');
        box.style.display = '';
        $('.section-title', box).textContent = `Results for "${q}"`;
        renderRow($('#searchGrid'), results);
      }, 180); // debounce expensive filtering
    });
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------
  function currentQueueFor(channel) {
    // Build a sensible "related" queue: same category/country, enabled only.
    const enabled = allChannels.filter((c) => c.enabled);
    const related = enabled.filter((c) => c.category === channel.category && c.id !== channel.id);
    return [channel, ...related];
  }

  function openPlayer(channel, queue) {
    currentList = (queue && queue.length ? queue : [channel]);
    currentIndex = Math.max(0, currentList.findIndex((c) => c.id === channel.id));
    $('#playerModal').classList.add('open');
    pauseHeroAutoplay();
    document.body.style.overflow = 'hidden';
    triedIds.clear();
    failCount = 0;
    playChannel(currentList[currentIndex]);
    renderRelated();
  }

  function closePlayer() {
    $('#playerModal').classList.remove('open');
    document.body.style.overflow = '';
    destroyPlayer();
    startHeroAutoplay();
  }

  function destroyPlayer() {
    const video = $('#videoEl');
    try {
      if (hls) { hls.destroy(); hls = null; }
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (e) { /* ignore teardown errors */ }
  }

  function setPlayerStatus(show, text) {
    const status = $('#playerStatus');
    status.classList.toggle('show', show);
    if (text) $('#playerStatusText').textContent = text;
  }

  function playChannel(channel) {
    destroyPlayer();
    setPlayerStatus(true, 'Loading channel…');

    $('#playerLogo').src = channel.logo || fallbackLogo();
    $('#playerLogo').onerror = () => { $('#playerLogo').src = fallbackLogo(); };
    $('#playerChannelName').textContent = channel.name;
    $('#playerChannelCountry').textContent = `${flagFor(channel.countryCode)} ${channel.country}`;

    const video = $('#videoEl');
    if (!channel.streamUrl) {
      handlePlayerError(channel, 'This channel is currently unavailable.');
      return;
    }

    const isM3U8 = /\.m3u8($|\?)/i.test(channel.streamUrl);

    if (isM3U8 && window.Hls && window.Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 20 });
      hls.loadSource(channel.streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerStatus(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) handlePlayerError(channel, 'Channel unavailable — switching to next channel…');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || !isM3U8) {
      // native HLS (Safari) or a directly playable format (mp4/webm/dash-less)
      video.src = channel.streamUrl;
      video.addEventListener('loadedmetadata', () => setPlayerStatus(false), { once: true });
      video.play().catch(() => {});
    } else {
      handlePlayerError(channel, 'This channel is currently unavailable.');
      return;
    }

    video.onerror = () => handlePlayerError(channel, 'Channel unavailable — switching to next channel…');
  }

  function handlePlayerError(channel, message) {
    triedIds.add(channel.id);
    failCount += 1;
    setPlayerStatus(true, message);
    showToast(message);

    if (failCount >= MAX_AUTO_SKIP) {
      setPlayerStatus(true, 'Unable to play channels right now. Check your connection and try again.');
      return; // prevent infinite retry loop
    }
    setTimeout(() => {
      const moved = nextChannel({ silent: true, skipping: true });
      if (!moved) setPlayerStatus(true, 'This channel is currently unavailable.');
    }, 900);
  }

  function nextChannel(opts = {}) {
    if (!currentList.length) return false;
    // Find the next channel not already tried in this auto-skip pass (or just the next one, for manual clicks).
    for (let step = 1; step <= currentList.length; step++) {
      const idx = (currentIndex + step) % currentList.length;
      const candidate = currentList[idx];
      if (opts.skipping && triedIds.has(candidate.id)) continue;
      currentIndex = idx;
      playChannel(candidate);
      renderRelated();
      return true;
    }
    return false;
  }

  function previousChannel() {
    if (!currentList.length) return;
    currentIndex = (currentIndex - 1 + currentList.length) % currentList.length;
    triedIds.clear();
    failCount = 0;
    playChannel(currentList[currentIndex]);
    renderRelated();
  }

  function renderRelated() {
    const grid = $('#relatedGrid');
    const related = currentList.filter((_, i) => i !== currentIndex).slice(0, 12);
    renderRow(grid, related);
  }

  // ---------------------------------------------------------------------
  // Player controls wiring
  // ---------------------------------------------------------------------
  function setupPlayerControls() {
    const video = $('#videoEl');
    const overlay = $('#playerOverlay');
    let idleTimer = null;

    function wake() {
      overlay.classList.remove('hidden-idle');
      overlay.classList.add('visible');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!video.paused) overlay.classList.add('hidden-idle');
      }, 3200);
    }
    $('#playerStage').addEventListener('pointermove', wake);
    $('#playerStage').addEventListener('click', wake);
    wake();

    $('#closePlayerBtn').addEventListener('click', closePlayer);
    $('#prevChBtn').addEventListener('click', previousChannel);
    $('#nextChBtn').addEventListener('click', () => { triedIds.clear(); failCount = 0; nextChannel(); });

    $('#playPauseBtn').addEventListener('click', () => {
      if (video.paused) { video.play(); $('#playPauseBtn').innerHTML = '&#10074;&#10074;'; }
      else { video.pause(); $('#playPauseBtn').innerHTML = '&#9654;'; }
    });

    $('#muteBtn').addEventListener('click', () => {
      video.muted = !video.muted;
      $('#muteBtn').innerHTML = video.muted ? '&#128263;' : '&#128264;';
    });
    $('#volumeSlider').addEventListener('input', (e) => {
      video.volume = parseFloat(e.target.value);
      video.muted = video.volume === 0;
    });

    $('#pipBtn').addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (video.requestPictureInPicture) await video.requestPictureInPicture();
      } catch (e) { showToast('Picture-in-picture is not supported on this device.'); }
    });

    $('#fullscreenBtn').addEventListener('click', () => {
      const stage = $('#playerStage');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen();
    });

    video.addEventListener('waiting', () => setPlayerStatus(true, 'Buffering…'));
    video.addEventListener('playing', () => setPlayerStatus(false));
  }

  // ---------------------------------------------------------------------
  // Bottom nav
  // ---------------------------------------------------------------------
  function setupBottomNav() {
    $$('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.nav-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.nav;
        if (target === 'search') { $('#searchInput').focus(); }
        else if (target === 'home') { applyFilter({ type: 'all', value: null }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (target === 'live') { window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (target === 'categories') { $('#filterChips').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Hero touch/swipe support
  // ---------------------------------------------------------------------
  function setupHeroSwipe() {
    const slider = $('#heroSlider');
    let startX = null;
    slider.addEventListener('pointerdown', (e) => { startX = e.clientX; pauseHeroAutoplay(); });
    slider.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 40) goToHeroSlide(heroIndex + (dx < 0 ? 1 : -1));
      startX = null;
      startHeroAutoplay();
    });
    $('#heroPrev').addEventListener('click', () => { goToHeroSlide(heroIndex - 1); startHeroAutoplay(); });
    $('#heroNext').addEventListener('click', () => { goToHeroSlide(heroIndex + 1); startHeroAutoplay(); });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function init() {
    setupSearch();
    setupPlayerControls();
    setupBottomNav();
    setupHeroSwipe();

    const seenSplash = sessionStorage.getItem('nexlive_splash_seen');
    const splashDelay = seenSplash ? 250 : 1100;

    await loadChannels();
    const enabled = allChannels.filter((c) => c.enabled);
    renderFeaturedSlider(enabled);
    renderFilterChips(enabled);
    renderSections(enabled);

    setTimeout(hideSplash, splashDelay);

    if (!allChannels.length) {
      showToast('Unable to load channel list.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
