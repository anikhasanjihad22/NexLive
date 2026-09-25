/**
 * NexLive — admin.js
 * Drives admin.html. All persistence goes through NexLiveStore
 * (assets/js/store.js) so a backend can be swapped in later
 * without touching this file's rendering logic.
 *
 * ADMIN_KEY is a client-side prototype gate only — see the
 * warning in the login screen and in README.md. Never treat this
 * as real authentication.
 */
(function () {
  'use strict';

  const ADMIN_KEY = 'Rashni22153';
  const SESSION_FLAG = 'nexlive_admin_unlocked';

  let channels = [];
  let editingId = null; // channel id currently being edited, or null when adding

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------------------------------------------------------------------
  // Auth gate
  // ---------------------------------------------------------------------
  function setupAuth() {
    if (sessionStorage.getItem(SESSION_FLAG) === '1') {
      unlock();
    }
    $('#loginBtn').addEventListener('click', tryUnlock);
    $('#adminKeyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    $('#logoutBtn').addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_FLAG);
      location.reload();
    });
  }

  function tryUnlock() {
    const val = $('#adminKeyInput').value;
    if (val === ADMIN_KEY) {
      sessionStorage.setItem(SESSION_FLAG, '1');
      unlock();
    } else {
      $('#loginError').textContent = 'Incorrect admin key.';
    }
  }

  function unlock() {
    $('#loginGate').hidden = true;
    $('#adminApp').hidden = false;
    initAdminApp();
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function setupTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  // ---------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------
  function renderDashboard() {
    const enabled = channels.filter((c) => c.enabled).length;
    const disabled = channels.length - enabled;
    const featured = channels.filter((c) => c.featured).length;
    const countries = new Set(channels.map((c) => c.country)).size;
    const categories = new Set(channels.map((c) => c.category)).size;

    const stats = [
      { label: 'Total channels', num: channels.length },
      { label: 'Enabled', num: enabled },
      { label: 'Disabled', num: disabled },
      { label: 'Featured', num: featured },
      { label: 'Countries', num: countries },
      { label: 'Categories', num: categories },
    ];
    $('#statGrid').innerHTML = stats.map((s) => `
      <div class="stat-card"><div class="num">${s.num}</div><div class="label">${s.label}</div></div>
    `).join('');
  }

  // ---------------------------------------------------------------------
  // Channel manager
  // ---------------------------------------------------------------------
  function populateCountryFilter() {
    const select = $('#channelFilterCountry');
    const current = select.value;
    const countries = [...new Set(channels.map((c) => c.country))].sort();
    select.innerHTML = '<option value="">All countries</option>' +
      countries.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    select.value = current;
  }

  function getFilteredChannels() {
    const q = $('#channelSearch').value.trim().toLowerCase();
    const country = $('#channelFilterCountry').value;
    const status = $('#channelFilterStatus').value;
    return channels.filter((c) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))) return false;
      if (country && c.country !== country) return false;
      if (status === 'enabled' && !c.enabled) return false;
      if (status === 'disabled' && c.enabled) return false;
      return true;
    });
  }

  function renderChannelTable() {
    const list = getFilteredChannels();
    const body = $('#channelTableBody');
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:24px;">No channels match your filters.</td></tr>`;
      return;
    }
    body.innerHTML = list.map((c) => `
      <tr data-id="${escapeAttr(c.id)}">
        <td><img class="logo-cell" src="${escapeAttr(c.logo || fallbackLogo())}" onerror="this.src='${fallbackLogo()}'" alt=""/></td>
        <td class="name-cell">${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.country)}</td>
        <td>${escapeHtml(c.category)}</td>
        <td>${escapeHtml(c.language || '—')}</td>
        <td><span class="pill ${c.enabled ? 'pill-on' : 'pill-off'}">${c.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td>${c.featured ? '<span class="pill pill-featured">Featured</span>' : '—'}</td>
        <td>${c.custom ? '<span class="pill pill-custom">Custom</span>' : 'Playlist'}</td>
        <td>
          <div class="row-actions">
            <button data-act="toggle-enable">${c.enabled ? 'Disable' : 'Enable'}</button>
            <button data-act="toggle-feature">${c.featured ? 'Unfeature' : 'Feature'}</button>
            <button data-act="edit">Edit</button>
            <button data-act="delete" class="danger" ${c.custom ? '' : 'disabled title="Only custom channels can be deleted; disable playlist channels instead."'}>Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function fallbackLogo() {
    return 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#181D29"/><text x="50" y="58" font-size="34" text-anchor="middle" fill="#4C6FFF" font-family="sans-serif">N</text></svg>`);
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str).replace(/`/g, '&#96;'); }

  async function reloadChannels() {
    channels = await NexLiveStore.getAllChannels();
    renderDashboard();
    populateCountryFilter();
    renderChannelTable();
    renderFeaturedManager();
    renderHomepageManager();
  }

  function setupChannelManagerEvents() {
    $('#channelSearch').addEventListener('input', debounce(renderChannelTable, 150));
    $('#channelFilterCountry').addEventListener('change', renderChannelTable);
    $('#channelFilterStatus').addEventListener('change', renderChannelTable);
    $('#addChannelBtn').addEventListener('click', () => openChannelModal(null));

    $('#channelTableBody').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const id = btn.closest('tr').dataset.id;
      const channel = channels.find((c) => c.id === id);
      if (!channel) return;
      const act = btn.dataset.act;

      if (act === 'toggle-enable') {
        NexLiveStore.setEnabled(id, !channel.enabled);
        showToast(`${channel.name} ${!channel.enabled ? 'enabled' : 'disabled'}.`);
        await reloadChannels();
      } else if (act === 'toggle-feature') {
        NexLiveStore.setFeatured(id, !channel.featured);
        showToast(`${channel.name} ${!channel.featured ? 'added to' : 'removed from'} featured.`);
        await reloadChannels();
      } else if (act === 'edit') {
        openChannelModal(channel);
      } else if (act === 'delete') {
        if (confirm(`Delete "${channel.name}"? This cannot be undone.`)) {
          NexLiveStore.deleteChannel(id);
          showToast(`${channel.name} deleted.`);
          await reloadChannels();
        }
      }
    });
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------------------------------------------------------------------
  // Add / edit channel modal
  // ---------------------------------------------------------------------
  function openChannelModal(channel) {
    editingId = channel ? channel.id : null;
    $('#channelModalTitle').textContent = channel ? 'Edit channel' : 'Add channel';
    const form = $('#channelForm');
    form.reset();
    if (channel) {
      form.name.value = channel.name;
      form.streamUrl.value = channel.streamUrl;
      form.logo.value = channel.logo;
      form.country.value = channel.country;
      form.countryCode.value = channel.countryCode;
      form.category.value = channel.category;
      form.language.value = channel.language;
      form.description.value = channel.description;
      form.featured.checked = channel.featured;
      form.enabled.checked = channel.enabled;
    } else {
      form.enabled.checked = true;
    }
    $('#channelModal').hidden = false;
  }
  function closeChannelModal() { $('#channelModal').hidden = true; editingId = null; }

  function setupChannelModal() {
    $('#cancelChannelBtn').addEventListener('click', closeChannelModal);
    $('#channelModal').addEventListener('click', (e) => { if (e.target.id === 'channelModal') closeChannelModal(); });

    $('#channelForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {
        name: form.name.value,
        streamUrl: form.streamUrl.value,
        logo: form.logo.value,
        country: form.country.value,
        countryCode: form.countryCode.value,
        category: form.category.value,
        language: form.language.value,
        description: form.description.value,
        featured: form.featured.checked,
        enabled: form.enabled.checked,
      };
      if (editingId) {
        NexLiveStore.updateChannel(editingId, data);
        showToast('Channel updated.');
      } else {
        NexLiveStore.addChannel(data);
        showToast('Channel added.');
      }
      closeChannelModal();
      await reloadChannels();
    });
  }

  // ---------------------------------------------------------------------
  // Featured manager (drag to reorder)
  // ---------------------------------------------------------------------
  function renderFeaturedManager() {
    const list = $('#featuredList');
    const featured = NexLiveStore.orderFeatured(channels);
    $('#featuredEmpty').style.display = featured.length ? 'none' : '';
    list.innerHTML = featured.map((c) => `
      <li draggable="true" data-id="${escapeAttr(c.id)}">
        <span class="grip">&#8942;&#8942;</span>
        <img src="${escapeAttr(c.logo || fallbackLogo())}" onerror="this.src='${fallbackLogo()}'" alt=""/>
        <div class="title">${escapeHtml(c.name)} <span class="sub">${escapeHtml(c.country)}</span></div>
        <button data-remove="${escapeAttr(c.id)}" class="btn-ghost">Remove</button>
      </li>
    `).join('');
    setupDragReorder(list, (orderedIds) => NexLiveStore.saveFeaturedOrder(orderedIds));

    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        NexLiveStore.setFeatured(btn.dataset.remove, false);
        await reloadChannels();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Homepage sections manager
  // ---------------------------------------------------------------------
  function renderHomepageManager() {
    const list = $('#homepageList');
    const sections = NexLiveStore.getHomepageSections();
    list.innerHTML = sections.map((s) => `
      <li draggable="true" data-id="${escapeAttr(s.id)}">
        <span class="grip">&#8942;&#8942;</span>
        <div class="title">${escapeHtml(s.label)}</div>
        <label class="checkbox"><input type="checkbox" data-toggle="${escapeAttr(s.id)}" ${s.enabled ? 'checked' : ''}/> Visible</label>
      </li>
    `).join('');

    setupDragReorder(list, (orderedIds) => {
      const bySections = new Map(sections.map((s) => [s.id, s]));
      const reordered = orderedIds.map((id) => bySections.get(id)).filter(Boolean);
      NexLiveStore.saveHomepageSections(reordered);
    });

    list.querySelectorAll('[data-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const sections2 = NexLiveStore.getHomepageSections();
        const s = sections2.find((x) => x.id === input.dataset.toggle);
        if (s) { s.enabled = input.checked; NexLiveStore.saveHomepageSections(sections2); }
      });
    });
  }

  $('#resetHomepageBtn')?.addEventListener('click', () => {
    NexLiveStore.resetHomepageSections();
    renderHomepageManager();
    showToast('Homepage sections reset to defaults.');
  });

  // Minimal, dependency-free HTML5 drag-and-drop reordering for <li> lists.
  function setupDragReorder(listEl, onReorder) {
    let dragEl = null;
    listEl.querySelectorAll('li').forEach((li) => {
      li.addEventListener('dragstart', () => { dragEl = li; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        const ids = $$('li', listEl).map((n) => n.dataset.id);
        onReorder(ids);
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === li) return;
        const rect = li.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        listEl.insertBefore(dragEl, before ? li : li.nextSibling);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function initAdminApp() {
    setupTabs();
    setupChannelManagerEvents();
    setupChannelModal();
    $('#refreshPlaylistBtn').addEventListener('click', async () => {
      showToast('Refreshing playlist…');
      await NexLiveStore.fetchPlaylistChannels({ force: true });
      await reloadChannels();
      showToast('Playlist refreshed.');
    });
    await reloadChannels();
  }

  document.addEventListener('DOMContentLoaded', setupAuth);
})();
