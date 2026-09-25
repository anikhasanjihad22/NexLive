/**
 * NexLive data layer
 * ------------------------------------------------------------
 * This file is the single source of truth for channel data.
 * It is intentionally isolated from UI code (app.js / admin.js)
 * so a real backend/API can replace it later without touching
 * any rendering logic — every function here returns plain
 * data (arrays/objects), never DOM nodes.
 *
 * IMPORTANT — read this before deploying NexLive for real users:
 * Admin edits (add/edit/delete/enable/feature/reorder) are saved
 * to this browser's localStorage only. That means:
 *   - Changes made in the admin panel on one device/browser are
 *     NOT visible to visitors using a different device/browser.
 *   - Clearing browser data erases all admin changes.
 * This is fine for a prototype or a single-operator demo, but for
 * a real multi-user deployment you should replace the
 * `LocalStore` methods below with calls to a real API/database
 * (see the "SWAP IN A BACKEND" note at the bottom of this file).
 * ------------------------------------------------------------
 */

const NexLiveStore = (() => {
  const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
  const LS_KEYS = {
    channels: 'nexlive_channels_v1',      // admin-added/edited channels (overrides + custom)
    overrides: 'nexlive_overrides_v1',    // per-channel enabled/featured overrides keyed by id
    homepage: 'nexlive_homepage_v1',      // homepage section order/visibility
    featuredOrder: 'nexlive_featured_v1', // ordered list of featured channel ids
    playlistCache: 'nexlive_playlist_cache_v1',
    cacheTime: 'nexlive_playlist_cache_time_v1',
  };
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  const DEFAULT_SECTIONS = [
    { id: 'bangladesh', label: 'Bangladesh', match: { country: 'Bangladesh' }, enabled: true },
    { id: 'india', label: 'India', match: { country: 'India' }, enabled: true },
    { id: 'sports', label: 'Sports', match: { category: 'Sports' }, enabled: true },
    { id: 'news', label: 'News', match: { category: 'News' }, enabled: true },
    { id: 'entertainment', label: 'Entertainment', match: { category: 'Entertainment' }, enabled: true },
    { id: 'movies', label: 'Movies', match: { category: 'Movies' }, enabled: true },
    { id: 'kids', label: 'Kids', match: { category: 'Kids' }, enabled: true },
    { id: 'music', label: 'Music', match: { category: 'Music' }, enabled: true },
    { id: 'international', label: 'International', match: { category: 'International' }, enabled: true },
  ];

  // ---------- tiny persistence helpers (swap point for a backend) ----------
  const LocalStore = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn('NexLiveStore: failed to read', key, e);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('NexLiveStore: failed to write', key, e);
        return false;
      }
    },
  };

  // ---------- M3U parsing ----------
  // Parses #EXTM3U / #EXTINF playlists (iptv-org format) into channel objects.
  function parsePlaylist(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let current = null;
    let counter = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF')) {
        current = extractExtInf(line);
      } else if (line.startsWith('#')) {
        // ignore other directives (#EXTVLCOPT, #EXTGRP, etc.) for this lightweight parser
        continue;
      } else {
        // a non-comment, non-empty line is the stream URL for the preceding #EXTINF
        if (current) {
          counter += 1;
          current.streamUrl = line;
          current.id = current.tvgId || `ch-${counter}-${slugify(current.name || 'channel')}`;
          channels.push(normalizeChannel(current));
          current = null;
        }
      }
    }
    return channels;
  }

  function extractExtInf(line) {
    // Example:
    // #EXTINF:-1 tvg-id="JamunaTV.bd" tvg-logo="https://.../logo.png" group-title="News",Jamuna TV
    const attrs = {};
    const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
    let m;
    while ((m = attrRegex.exec(line)) !== null) {
      attrs[m[1]] = m[2];
    }
    const nameMatch = line.match(/,(.*)$/);
    const name = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';

    return {
      name,
      logo: attrs['tvg-logo'] || '',
      tvgId: attrs['tvg-id'] || '',
      language: attrs['tvg-language'] || '',
      countryRaw: attrs['tvg-country'] || '',
      category: attrs['group-title'] || 'International',
    };
  }

  // Best-effort country name from tvg-country code or channel-id suffix (".bd", ".in" etc.)
  const COUNTRY_CODE_MAP = {
    BD: 'Bangladesh', IN: 'India', PK: 'Pakistan', US: 'USA', GB: 'UK',
    KR: 'Korea', JP: 'Japan', SA: 'Saudi Arabia', AE: 'UAE', NP: 'Nepal',
    LK: 'Sri Lanka', CA: 'Canada', AU: 'Australia', FR: 'France', DE: 'Germany',
  };

  function guessCountry(ch) {
    if (ch.countryRaw) {
      const code = ch.countryRaw.toUpperCase();
      return { name: COUNTRY_CODE_MAP[code] || ch.countryRaw, code };
    }
    if (ch.tvgId) {
      const parts = ch.tvgId.split('.');
      const suffix = parts[parts.length - 1]?.toUpperCase();
      if (suffix && COUNTRY_CODE_MAP[suffix]) {
        return { name: COUNTRY_CODE_MAP[suffix], code: suffix };
      }
    }
    return { name: 'International', code: '' };
  }

  function slugify(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  // Normalizes a raw parsed entry (or an admin-entered form object) into the
  // canonical channel shape used everywhere in the app.
  function normalizeChannel(raw) {
    const country = raw.country
      ? { name: raw.country, code: raw.countryCode || '' }
      : guessCountry(raw);

    return {
      id: raw.id || `custom-${slugify(raw.name || 'channel')}-${Date.now()}`,
      name: raw.name?.trim() || 'Unknown Channel',
      streamUrl: raw.streamUrl?.trim() || '',
      logo: raw.logo?.trim() || '',
      country: country.name || 'International',
      countryCode: (raw.countryCode || country.code || '').toUpperCase(),
      category: raw.category?.trim() || 'International',
      language: raw.language?.trim() || '',
      description: raw.description?.trim() || '',
      featured: Boolean(raw.featured),
      enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
      custom: Boolean(raw.custom), // true for admin-added channels (not from the public playlist)
    };
  }

  // ---------- fetching + caching the public playlist ----------
  async function fetchPlaylistChannels({ force = false } = {}) {
    if (!force) {
      const cachedAt = LocalStore.get(LS_KEYS.cacheTime, 0);
      const cached = LocalStore.get(LS_KEYS.playlistCache, null);
      if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cached;
      }
    }
    const res = await fetch(PLAYLIST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Playlist request failed: ${res.status}`);
    const text = await res.text();
    const channels = parsePlaylist(text);
    LocalStore.set(LS_KEYS.playlistCache, channels);
    LocalStore.set(LS_KEYS.cacheTime, Date.now());
    return channels;
  }

  // ---------- admin-managed channels + overrides ----------
  function getCustomChannels() {
    return LocalStore.get(LS_KEYS.channels, []);
  }
  function saveCustomChannels(list) {
    LocalStore.set(LS_KEYS.channels, list);
  }
  function getOverrides() {
    return LocalStore.get(LS_KEYS.overrides, {});
  }
  function saveOverrides(map) {
    LocalStore.set(LS_KEYS.overrides, map);
  }

  function setOverride(id, patch) {
    const overrides = getOverrides();
    overrides[id] = { ...(overrides[id] || {}), ...patch };
    saveOverrides(overrides);
  }

  // Merge: playlist channels + per-id overrides (enabled/featured) + admin-added custom channels.
  async function getAllChannels({ force = false } = {}) {
    let base = [];
    try {
      base = await fetchPlaylistChannels({ force });
    } catch (e) {
      console.warn('NexLiveStore: playlist fetch failed, continuing with custom channels only', e);
      base = LocalStore.get(LS_KEYS.playlistCache, []);
    }
    const overrides = getOverrides();
    const withOverrides = base.map((ch) => {
      const o = overrides[ch.id];
      return o ? { ...ch, ...o } : ch;
    });
    const custom = getCustomChannels();
    // Custom channels take priority if an id collides.
    const customIds = new Set(custom.map((c) => c.id));
    return [...withOverrides.filter((c) => !customIds.has(c.id)), ...custom];
  }

  function addChannel(formData) {
    const channel = normalizeChannel({ ...formData, custom: true, id: undefined });
    const list = getCustomChannels();
    list.push(channel);
    saveCustomChannels(list);
    return channel;
  }

  function updateChannel(id, formData) {
    const list = getCustomChannels();
    const idx = list.findIndex((c) => c.id === id);
    if (idx !== -1) {
      list[idx] = normalizeChannel({ ...list[idx], ...formData, id, custom: true });
      saveCustomChannels(list);
      return list[idx];
    }
    // Editing a playlist (non-custom) channel: store as an override instead of duplicating it.
    setOverride(id, formData);
    return null;
  }

  function deleteChannel(id) {
    const list = getCustomChannels().filter((c) => c.id !== id);
    saveCustomChannels(list);
  }

  function setEnabled(id, enabled) {
    const list = getCustomChannels();
    const idx = list.findIndex((c) => c.id === id);
    if (idx !== -1) {
      list[idx].enabled = enabled;
      saveCustomChannels(list);
    } else {
      setOverride(id, { enabled });
    }
  }

  function setFeatured(id, featured) {
    const list = getCustomChannels();
    const idx = list.findIndex((c) => c.id === id);
    if (idx !== -1) {
      list[idx].featured = featured;
      saveCustomChannels(list);
    } else {
      setOverride(id, { featured });
    }
    const order = getFeaturedOrder();
    if (featured && !order.includes(id)) {
      order.push(id);
      saveFeaturedOrder(order);
    } else if (!featured) {
      saveFeaturedOrder(order.filter((x) => x !== id));
    }
  }

  function getFeaturedOrder() {
    return LocalStore.get(LS_KEYS.featuredOrder, []);
  }
  function saveFeaturedOrder(order) {
    LocalStore.set(LS_KEYS.featuredOrder, order);
  }

  // ---------- homepage sections ----------
  function getHomepageSections() {
    return LocalStore.get(LS_KEYS.homepage, DEFAULT_SECTIONS);
  }
  function saveHomepageSections(sections) {
    LocalStore.set(LS_KEYS.homepage, sections);
  }
  function resetHomepageSections() {
    saveHomepageSections(DEFAULT_SECTIONS);
    return DEFAULT_SECTIONS;
  }

  // Order channels according to the saved featured id order; unlisted featured
  // channels are appended at the end.
  function orderFeatured(channels) {
    const order = getFeaturedOrder();
    const featured = channels.filter((c) => c.featured && c.enabled);
    const byId = new Map(featured.map((c) => [c.id, c]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const remaining = featured.filter((c) => !order.includes(c.id));
    return [...ordered, ...remaining];
  }

  function channelsForSection(channels, section) {
    const enabled = channels.filter((c) => c.enabled);
    if (!section.match) return enabled;
    return enabled.filter((c) => {
      if (section.match.country) return c.country === section.match.country;
      if (section.match.category) return c.category === section.match.category;
      return false;
    });
  }

  return {
    LS_KEYS,
    parsePlaylist,
    normalizeChannel,
    fetchPlaylistChannels,
    getAllChannels,
    addChannel,
    updateChannel,
    deleteChannel,
    setEnabled,
    setFeatured,
    getFeaturedOrder,
    saveFeaturedOrder,
    getHomepageSections,
    saveHomepageSections,
    resetHomepageSections,
    orderFeatured,
    channelsForSection,
    getCustomChannels,
  };
})();

/**
 * SWAP IN A BACKEND
 * ------------------------------------------------------------
 * To move persistence server-side, replace the bodies of:
 *   addChannel, updateChannel, deleteChannel, setEnabled,
 *   setFeatured, saveHomepageSections, saveFeaturedOrder
 * with `fetch()` calls to your API, and replace `getAllChannels`
 * with a call that reads the merged channel list from your
 * database instead of localStorage. Because every UI file
 * (app.js / admin.js) only ever calls these exported functions —
 * never localStorage directly — no other code needs to change.
 */
