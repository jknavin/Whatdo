/* Whatdo core — shared by website, extension popup and Android app.
   Platform differences (Google sign-in, storage) live in window.WhatdoPlatform. */
(function () {
  'use strict';

  var CFG = window.WHATDO_CONFIG;
  var P = window.WhatdoPlatform;
  var FILE_NAME = 'whatdo-data.json';
  var PRESETS = ['#6c5ce7', '#0984e3', '#00b894', '#e17055', '#e84393', '#fdcb6e', '#2d3436'];
  var TAG_COLORS = ['#6c5ce7', '#0984e3', '#00b894', '#e17055', '#e84393', '#f5a524'];

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var uid = function () { return Math.random().toString(36).slice(2, 10) + now().toString(36); };

  // ---------- state ----------
  var state = blank();
  var session = { token: null, tokenAt: 0, user: null, fileId: null };
  var filter = 'active';
  var tagFilter = null;
  var syncTimer = null, syncing = false, pending = false;

  function blank() {
    return { tasks: [], tags: [], settings: { theme: 'auto', accent: PRESETS[0], u: 0 }, pro: null, updatedAt: 0 };
  }
  function isPro() { return !!(state.pro && state.pro.active); }

  // ---------- local persistence ----------
  function saveLocal() {
    return P.store.set('whatdo_state', JSON.stringify(state));
  }
  function loadLocal() {
    return P.store.get('whatdo_state').then(function (v) {
      if (v) { try { state = Object.assign(blank(), JSON.parse(v)); } catch (e) {} }
    });
  }

  // ---------- merge (per-item last-write-wins with tombstones) ----------
  function mergeList(a, b) {
    var map = {};
    (a || []).concat(b || []).forEach(function (x) {
      var cur = map[x.id];
      if (!cur || (x.u || 0) > (cur.u || 0)) map[x.id] = x;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function merge(local, remote) {
    var out = blank();
    out.tasks = mergeList(local.tasks, remote.tasks);
    out.tags = mergeList(local.tags, remote.tags);
    out.settings = ((remote.settings && remote.settings.u) || 0) > ((local.settings && local.settings.u) || 0) ? remote.settings : local.settings;
    var lp = local.pro, rp = remote.pro;
    out.pro = (lp && lp.active) ? lp : (rp && rp.active) ? rp : (lp || rp || null);
    // drop tombstones older than 30 days
    var cut = now() - 30 * 864e5;
    out.tasks = out.tasks.filter(function (t) { return !t.d || t.u > cut; });
    out.tags = out.tags.filter(function (t) { return !t.d || t.u > cut; });
    out.updatedAt = now();
    return out;
  }

  // ---------- Google Drive (appDataFolder: private to Whatdo, invisible in user's Drive UI) ----------
  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + session.token }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { var e = new Error('auth'); e.code = 401; throw e; }
      if (!r.ok) throw new Error('Drive ' + r.status);
      return r;
    });
  }
  function findFile() {
    if (session.fileId) return Promise.resolve(session.fileId);
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    return api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id)')
      .then(function (r) { return r.json(); })
      .then(function (j) { session.fileId = j.files && j.files[0] ? j.files[0].id : null; return session.fileId; });
  }
  function download(id) {
    return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.json(); });
  }
  function upload(id, data) {
    var body = JSON.stringify(data);
    if (id) {
      return api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body });
    }
    var boundary = 'whatdo' + uid();
    var meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    var multi = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multi })
      .then(function (r) { return r.json(); })
      .then(function (j) { session.fileId = j.id; });
  }

  function setStatus(kind, text) {
    $('dot').className = 'dot ' + (kind || '');
    $('statusText').textContent = text;
  }

  function syncNow() {
    if (!session.token) return Promise.resolve();
    if (syncing) { pending = true; return Promise.resolve(); }
    syncing = true;
    setStatus('busy', 'Syncing…');
    return findFile().then(function (id) {
      return id ? download(id) : null;
    }).then(function (remote) {
      var merged = remote ? merge(state, remote) : state;
      var changed = !remote || JSON.stringify(strip(merged)) !== JSON.stringify(strip(remote));
      state = merged;
      render();
      return saveLocal().then(function () {
        return changed ? upload(session.fileId, state) : null;
      });
    }).then(function () {
      setStatus('ok', 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }).catch(function (e) {
      if (e && e.code === 401) {
        // token expired: refresh silently and retry once
        session.token = null;
        return P.getToken(false).then(function (t) { session.token = t; syncing = false; return syncNow(); })
          .catch(function () { setStatus('err', 'Sign in again'); showSignedOut(true); });
      }
      setStatus('err', 'Offline — will retry');
    }).then(function () {
      syncing = false;
      if (pending) { pending = false; scheduleSync(300); }
    });
  }
  function strip(s) { var c = Object.assign({}, s); delete c.updatedAt; return c; }
  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, ms == null ? 1200 : ms);
  }

  // ---------- mutations ----------
  function touch() { state.updatedAt = now(); saveLocal(); render(); scheduleSync(); }
  function addTask(text, tagId) {
    text = text.trim(); if (!text) return;
    state.tasks.push({ id: uid(), t: text, done: false, tag: tagId || null, c: now(), u: now() });
    touch();
  }
  function patchTask(id, patch) {
    state.tasks.forEach(function (t) { if (t.id === id) { Object.assign(t, patch); t.u = now(); } });
    touch();
  }
  function liveTags() { return state.tags.filter(function (t) { return !t.d; }); }
  function tagById(id) { return state.tags.filter(function (t) { return t.id === id && !t.d; })[0]; }

  // ---------- theme ----------
  function applyTheme() {
    var s = state.settings, root = document.documentElement;
    var theme = s.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme;
    root.setAttribute('data-theme', theme);
    var accent = isPro() ? s.accent : PRESETS[0];
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-text', luminance(accent) > 0.6 ? '#111' : '#fff');
  }
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // ---------- rendering ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function tagStyle(el_, tag) {
    if (tag && isPro() && tag.col) {
      el_.style.background = tag.col + '26';
      el_.style.color = tag.col;
    }
  }

  function render() {
    applyTheme();
    $('proBadge').classList.toggle('hidden', !isPro());

    // tag select
    var sel = $('tagSelect'), keep = sel.value;
    sel.textContent = '';
    var o0 = el('option', null, 'No tag'); o0.value = ''; sel.appendChild(o0);
    liveTags().forEach(function (t) { var o = el('option', null, t.n); o.value = t.id; sel.appendChild(o); });
    sel.value = keep && tagById(keep) ? keep : '';

    // filters
    var f = $('filters'); f.textContent = '';
    [['active', 'Active'], ['done', 'Done'], ['all', 'All']].forEach(function (p) {
      var b = el('button', 'f' + (filter === p[0] && !tagFilter ? ' on' : ''), p[1]);
      b.onclick = function () { filter = p[0]; tagFilter = null; render(); };
      f.appendChild(b);
    });
    liveTags().forEach(function (t) {
      var b = el('button', 'f' + (tagFilter === t.id ? ' on' : ''), '# ' + t.n);
      b.onclick = function () { tagFilter = tagFilter === t.id ? null : t.id; render(); };
      f.appendChild(b);
    });

    // list
    var list = $('list'); list.textContent = '';
    var tasks = state.tasks.filter(function (t) {
      if (t.d) return false;
      if (tagFilter) return t.tag === tagFilter;
      return filter === 'all' || (filter === 'done' ? t.done : !t.done);
    }).sort(function (a, b) { return a.done - b.done || b.c - a.c; });

    $('empty').classList.toggle('hidden', tasks.length > 0);
    tasks.forEach(function (t) {
      var li = el('li', 'task' + (t.done ? ' done' : ''));
      var chk = el('button', 'check', t.done ? '✓' : '');
      chk.setAttribute('aria-label', 'Toggle done');
      chk.onclick = function () { patchTask(t.id, { done: !t.done }); };
      var txt = el('div', 'txt', t.t);
      txt.ondblclick = function () {
        var v = prompt('Edit task', t.t);
        if (v && v.trim()) patchTask(t.id, { t: v.trim() });
      };
      li.appendChild(chk); li.appendChild(txt);
      var tg = t.tag && tagById(t.tag);
      if (tg) { var pill = el('span', 'tag', tg.n); tagStyle(pill, tg); li.appendChild(pill); }
      var del = el('button', 'del', '×'); del.setAttribute('aria-label', 'Delete');
      del.onclick = function () { patchTask(t.id, { d: true }); };
      li.appendChild(del);
      list.appendChild(li);
    });

    var open = state.tasks.filter(function (t) { return !t.d && !t.done; }).length;
    $('count').textContent = open + ' to do';
  }

  // ---------- settings / pro UI ----------
  function openModal(id) { $(id).classList.add('open'); }
  function closeModals() { document.querySelectorAll('.modal').forEach(function (m) { m.classList.remove('open'); }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function renderSettings() {
    var pro = isPro();
    $('themeSel').value = state.settings.theme;
    $('proLockColors').classList.toggle('lock', !pro);
    $('proLockTags').classList.toggle('lock', !pro);
    $('proUpsell').classList.toggle('hidden', pro);
    $('proActive').classList.toggle('hidden', !pro);

    var sw = $('swatches'); sw.textContent = '';
    PRESETS.forEach(function (c) {
      var b = el('button', 'sw' + (state.settings.accent === c ? ' on' : '')); b.style.background = c;
      b.onclick = function () { setAccent(c); };
      sw.appendChild(b);
    });
    var pick = el('input'); pick.type = 'color'; pick.value = state.settings.accent; pick.title = 'Custom color';
    pick.onchange = function () { setAccent(pick.value); };
    sw.appendChild(pick);

    var tl = $('tagList'); tl.textContent = '';
    liveTags().forEach(function (t) {
      var row = el('div', 'tagrow');
      var name = el('input'); name.type = 'text'; name.value = t.n; name.maxLength = 24;
      name.onchange = function () { t.n = name.value.trim() || t.n; t.u = now(); touch(); };
      var col = el('input'); col.type = 'color'; col.value = t.col || TAG_COLORS[0];
      col.onchange = function () { t.col = col.value; t.u = now(); touch(); };
      var rm = el('button', 'del', '×');
      rm.onclick = function () {
        t.d = true; t.u = now();
        state.tasks.forEach(function (k) { if (k.tag === t.id) { k.tag = null; k.u = now(); } });
        touch(); renderSettings();
      };
      row.appendChild(name); row.appendChild(col); row.appendChild(rm);
      tl.appendChild(row);
    });
  }
  function setAccent(c) { state.settings.accent = c; state.settings.u = now(); touch(); renderSettings(); }

  function addTagFromUI() {
    var inp = $('newTag'), n = inp.value.trim();
    if (!n) return;
    var count = liveTags().length;
    // Free: plain tags (up to 3, no colors). Pro: unlimited custom-colored tags.
    if (!isPro() && count >= 3) { openModal('proModal'); toast('Free plan allows 3 tags'); return; }
    state.tags.push({ id: uid(), n: n, col: isPro() ? TAG_COLORS[count % TAG_COLORS.length] : null, u: now() });
    inp.value = ''; touch(); renderSettings();
  }

  // ---------- Pro activation ----------
  function activatePro() {
    var key = $('licenseKey').value.trim();
    if (!key) return;
    if (!CFG.LICENSE_VERIFY_URL) { toast('License server not configured yet'); return; }
    $('licenseBtn').disabled = true;
    fetch(CFG.LICENSE_VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, email: session.user && session.user.email })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.valid) {
        state.pro = { active: true, key: key, since: now(), u: now() };
        touch(); renderSettings(); closeModals(); toast('Pro unlocked 🎉');
      } else toast('Invalid license key');
    }).catch(function () { toast('Could not reach license server'); })
      .then(function () { $('licenseBtn').disabled = false; });
  }

  // ---------- auth flow ----------
  function showSignedOut(show) {
    $('signinBanner').classList.toggle('hidden', !show);
    $('avatar').classList.toggle('hidden', show);
    if (show) setStatus('', 'Local only');
  }
  function onSignedIn(token) {
    session.token = token;
    return P.userInfo(token).then(function (u) {
      session.user = u;
      var av = $('avatar'); av.src = u.picture || ''; av.title = u.email || '';
      showSignedOut(false);
      return syncNow();
    });
  }
  function signIn() {
    return P.getToken(true).then(onSignedIn).catch(function (e) {
      toast('Sign-in failed' + (e && e.message ? ': ' + e.message : ''));
    });
  }
  function signOut() {
    P.signOut(session.token).then(function () {
      session = { token: null, user: null, fileId: null };
      state = blank();
      saveLocal(); P.store.set('whatdo_signed_in', ''); showSignedOut(true); render(); closeModals();
    });
  }

  // ---------- boot ----------
  function bind() {
    $('addForm').onsubmit = function (e) {
      e.preventDefault();
      addTask($('newTask').value, $('tagSelect').value);
      $('newTask').value = '';
    };
    $('btnSignin').onclick = signIn;
    $('btnSettings').onclick = function () { renderSettings(); openModal('settingsModal'); };
    $('btnUpgrade').onclick = function () { openModal('proModal'); };
    $('btnUpgrade2').onclick = function () { closeModals(); openModal('proModal'); };
    $('btnBuy').onclick = function () {
      if (!CFG.PAYMENT_URL) { toast('Payment link not configured yet'); return; }
      P.openUrl(CFG.PAYMENT_URL + (session.user ? (CFG.PAYMENT_URL.indexOf('?') > -1 ? '&' : '?') + 'email=' + encodeURIComponent(session.user.email) : ''));
    };
    $('licenseBtn').onclick = activatePro;
    $('addTagBtn').onclick = addTagFromUI;
    $('newTag').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addTagFromUI(); } };
    $('themeSel').onchange = function () { state.settings.theme = this.value; state.settings.u = now(); touch(); };
    $('btnSignout').onclick = signOut;
    $('btnSyncNow').onclick = function () { syncNow(); };
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModals; });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) closeModals(); });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNow(); });
    window.addEventListener('focus', function () { syncNow(); });
    window.addEventListener('online', function () { syncNow(); });
    setInterval(function () { if (!document.hidden) syncNow(); }, 30000);
    // Chrome extension: pick up changes made in another popup/tab
    if (P.onExternalChange) P.onExternalChange(function () { loadLocal().then(render); });
  }

  function boot() {
    document.body.classList.add(P.type);
    $('priceText').textContent = CFG.PRO_PRICE;
    bind();
    loadLocal().then(function () {
      render();
      showSignedOut(true);
      return P.store.get('whatdo_signed_in');
    }).then(function (flag) {
      if (flag) {
        // returning user: try silent sign-in
        P.getToken(false).then(onSignedIn).catch(function () { setStatus('', 'Tap Sign in to sync'); });
      }
    });
  }
  var origOnSignedIn = onSignedIn;
  onSignedIn = function (t) { return P.store.set('whatdo_signed_in', '1').then(function () { return origOnSignedIn(t); }); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
