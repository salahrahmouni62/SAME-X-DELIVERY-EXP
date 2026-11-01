/* SAME X DELIVERY — CRM front-end (vanilla JS SPA). All data comes from the authenticated API. */
(() => {
  'use strict';
  const C = window.SAMEX_C;
  const I = window.SAMEX_I18N;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('samex.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('samex.' + k, JSON.stringify(v)); } catch {} },
  };

  /* ---------------- state ---------------- */
  const DEFAULT_FILTERS = { search: '', stage: 'ALL', agencyId: 'ALL', ownerId: 'ALL', wilaya: 'ALL', category: 'ALL', platform: 'ALL', storeType: 'ALL', priority: 'ALL', due: false, hot: false };
  const S = {
    lang: store.get('lang', 'fr'), sound: store.get('sound', true),
    user: null, agency: null, agencies: [], users: [], leads: [], today: '', stats: null,
    view: 'dashboard', filters: { ...DEFAULT_FILTERS },
    stageTab: 'ALL', sort: { key: 'updatedAt', dir: -1 }, page: 1, pageSize: 50, selected: new Set(),
    openLeadId: null, drawerTab: 'contact', sidebarOpen: false, snapshots: [], audit: [],
  };
  const isSup = () => S.user && S.user.role === 'supervisor';

  /* ---------------- i18n ---------------- */
  const t = (k, vars) => {
    let s = (I[S.lang] && I[S.lang][k]) ?? I.fr[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
    return s;
  };
  const tv = (group, key) => ((I.values[S.lang] || I.values.fr)[group] || {})[key] ?? (I.values.fr[group] || {})[key] ?? key ?? '';
  const wName = (code) => { const w = C.WILAYAS.find((x) => x.code === code); return w ? `${w.code} · ${S.lang === 'ar' ? w.ar : w.fr}` : ''; };
  const wShort = (code) => { const w = C.WILAYAS.find((x) => x.code === code); return w ? (S.lang === 'ar' ? w.ar : w.fr) : ''; };
  const fmtDate = (iso, withTime) => {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    const loc = S.lang === 'ar' ? 'ar-DZ' : 'fr-DZ';
    try { return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', ...(iso.length > 10 && withTime ? { hour: '2-digit', minute: '2-digit' } : {}), ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); }
    catch { return iso.slice(0, 10); }
  };
  function applyLang() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  }

  /* ---------------- icons ---------------- */
  const P = {
    dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    kanban: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    building: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>', trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    wa: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5Z"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    sound: '<path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>', mute: '<path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>', refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  };
  const ic = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

  /* ---------------- API ---------------- */
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Samex': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const code = (data && data.error) || 'generic';
      if (code === 'unauthenticated' && S.user) { S.user = null; toast(t('err_unauthenticated'), 'err'); renderLogin(); }
      throw Object.assign(new Error(code), { code, data });
    }
    return data;
  }
  const errMsg = (e) => t('err_' + (e.code || 'generic'), { s: e.data && e.data.retryAfter }) || t('err_generic');

  /* ---------------- toasts & sound ---------------- */
  function toast(msg, kind = '', title = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<div>${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}</div>`;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, kind === 'err' ? 5200 : 3200);
  }
  let audioCtx = null;
  function chime(kind = 'ok') {
    if (!S.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'won' ? [660, 880, 1175] : [740];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.09 + 0.25);
        o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + i * 0.09); o.stop(audioCtx.currentTime + i * 0.09 + 0.3);
      });
    } catch {}
  }

  /* ---------------- modal helpers ---------------- */
  function openModal(html, { size = '', onClose } = {}) {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(wrap);
    const f = wrap.querySelector('[autofocus], input, select, textarea');
    if (f) setTimeout(() => f.focus(), 30);
    return { el: wrap, close };
  }
  function confirmDialog(message, { confirmText = t('confirm'), danger = false, detail = '' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal(`
        <div class="modal-h"><h2>${esc(t('confirm'))}</h2><button class="btn btn-ghost btn-icon" data-close aria-label="${esc(t('close'))}">${ic('x')}</button></div>
        <div class="modal-b"><p style="margin:0;line-height:1.55">${esc(message)}</p>${detail ? `<div class="chip chip-yellow" style="height:auto;padding:6px 10px;white-space:normal">${esc(detail)}</div>` : ''}</div>
        <div class="modal-f"><button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn ${danger ? 'btn-dark' : 'btn-primary'}" data-ok>${esc(confirmText)}</button></div>`,
      { size: 'sm', onClose: () => { if (!done) resolve(false); } });
      m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
    });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    applyLang();
    try {
      const st = await api('GET', '/api/setup-status');
      S.setupStatus = st;
      if (st.needsSetup) return renderSetup();
      try { const me = await api('GET', '/api/me'); await enterApp(me); }
      catch { renderLogin(); }
    } catch (e) {
      $('#app').innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    } finally { $('#boot').classList.add('out'); setTimeout(() => $('#boot') && $('#boot').remove(), 400); }
  }

  function langSwitch(cls = 'btn btn-sm') {
    return `<button class="${cls}" data-action="lang" type="button">${ic('globe')} ${S.lang === 'fr' ? 'العربية' : 'Français'}</button>`;
  }
  function authShell(inner) {
    return `<div class="auth">
      <aside class="auth-side">
        <div class="brand"><img src="/logo-mark.svg" alt=""><div><div class="brand-word">SAME <b>X</b> DELIVERY</div><div class="brand-sub">${esc(t('appTagline'))}</div></div></div>
        <div class="auth-headline">${S.lang === 'ar' ? 'كل تاجر إلكتروني <em>هو مُرسِل</em> قادم.' : 'Chaque e-commerçant est un <em>expéditeur</em> à signer.'}</div>
        <div class="auth-facts"><div><b>58</b>${S.lang === 'ar' ? 'ولاية مغطاة' : 'wilayas couvertes'}</div><div><b>+213</b>${S.lang === 'ar' ? 'أرقام مؤكدة' : 'numéros vérifiés'}</div><div><b>COD</b>${S.lang === 'ar' ? 'الدفع عند الاستلام' : 'paiement à la livraison'}</div></div>
      </aside>
      <main class="auth-main"><div class="auth-card"><div class="auth-lang">${langSwitch()}</div>${inner}</div></main>
    </div>`;
  }
  function renderLogin() {
    closeAllModals();
    S.authMode = 'login'; applyLang(); document.title = 'SAME X DELIVERY | ' + t('login');
    $('#app').innerHTML = authShell(`
      <h1>${esc(t('login'))}</h1><p>${esc(t('loginHint'))}</p>
      <form id="login-form" class="auth-card" style="gap:14px" novalidate>
        <div class="form-error" id="login-err" hidden></div>
        <label class="field"><span>${esc(t('username'))}</span><input class="input" id="login-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span>${esc(t('password'))}</span><input class="input" id="login-pass" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit" style="height:44px">${esc(t('signIn'))}</button>
      </form>`);
    $('#login-user').focus();
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = t('signingIn');
      $('#login-err').hidden = true;
      try {
        await api('POST', '/api/login', { username: $('#login-user').value.trim(), password: $('#login-pass').value });
        await enterApp(await api('GET', '/api/me'));
      } catch (err) {
        $('#login-err').textContent = errMsg(err); $('#login-err').hidden = false;
        btn.disabled = false; btn.textContent = t('signIn');
      }
    });
  }
  function renderSetup() {
    S.authMode = 'setup'; applyLang();
    const st = S.setupStatus || {};
    if (st.locked) {
      $('#app').innerHTML = authShell(`<h1>${esc(t('setupTitle'))}</h1><div class="form-error">${esc(t('err_setup_locked'))}</div>`);
      return;
    }
    $('#app').innerHTML = authShell(`
      <h1>${esc(t('setupTitle'))}</h1><p>${esc(t('setupText'))}</p>
      <form id="setup-form" class="auth-card" style="gap:14px" novalidate>
        <div class="form-error" id="setup-err" hidden></div>
        ${st.tokenRequired ? `<label class="field"><span class="req">${esc(t('setupToken'))}</span><input class="input" id="su-token" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" dir="ltr" required><small class="hint">${esc(t('setupTokenHint'))}</small></label>` : ''}
        <label class="field"><span class="req">${esc(t('fullName'))}</span><input class="input" id="su-name" required></label>
        <label class="field"><span class="req">${esc(t('username'))}</span><input class="input" id="su-user" autocapitalize="none" autocomplete="username" required></label>
        <label class="field"><span class="req">${esc(t('password'))}</span><input class="input" id="su-pass" type="password" autocomplete="new-password" required><small class="hint">${esc(t('pwRule'))}</small></label>
        <label class="check"><input type="checkbox" id="su-seed" checked><span>${esc(t('seedAgencies'))}</span></label>
        <button class="btn btn-primary" type="submit" style="height:44px">${esc(t('createSupervisor'))}</button>
      </form>`);
    $('#setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/setup', { name: $('#su-name').value, username: $('#su-user').value, password: $('#su-pass').value, seedAgencies: $('#su-seed').checked, setupToken: $('#su-token') ? $('#su-token').value : '' });
        await enterApp(await api('GET', '/api/me'));
      } catch (err) { $('#setup-err').textContent = errMsg(err); $('#setup-err').hidden = false; }
    });
  }

  /* ---------------- data ---------------- */
  async function loadAll() {
    const [dir, leads] = await Promise.all([api('GET', '/api/directory'), api('GET', '/api/leads')]);
    S.agencies = dir.agencies; S.users = dir.users; S.leads = leads.leads; S.today = leads.today;
  }
  async function refreshLeads(silent) {
    try { const r = await api('GET', '/api/leads'); S.leads = r.leads; S.today = r.today; renderSidebarCounts(); if (!S.openLeadId) renderContent(); }
    catch (e) { if (!silent) toast(errMsg(e), 'err'); }
  }
  let pollTimer = null;
  async function enterApp(me) {
    S.user = me.user; S.agency = me.agency;
    S.view = (location.hash || '').replace('#', '') || 'dashboard';
    if (!validView(S.view)) S.view = 'dashboard';
    await loadAll();
    renderShell();
    const due = S.leads.filter((l) => isDue(l)).length;
    if (due) toast(`${due} ${t('remindersToast')}`, '', t('nav_reminders'));
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && S.user) refreshLeads(true); }, 60000);
  }
  const VIEWS = ['dashboard', 'pipeline', 'table', 'posts', 'reminders', 'agencies', 'users', 'backup', 'audit'];
  const ADMIN_VIEWS = ['agencies', 'users', 'backup', 'audit'];
  const validView = (v) => VIEWS.includes(v) && (isSup() || !ADMIN_VIEWS.includes(v));

  /* ---------------- derived ---------------- */
  const OPEN = (l) => !['WON_EXPEDITEUR', 'LOST'].includes(l.stage);
  const isDue = (l) => OPEN(l) && l.nextFollowUpDate && l.nextFollowUpDate <= S.today;
  const isOverdue = (l) => OPEN(l) && l.nextFollowUpDate && l.nextFollowUpDate < S.today;
  const isPrio = (l) => l.priority === 'high' || isOverdue(l) || (C.HOT_STAGES.includes(l.stage) && !!l.phonePrimary);
  const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || (id === S.user.id ? S.user.name : '—');
  const agencyOf = (id) => S.agencies.find((a) => a.id === id);
  function filtered() {
    const f = S.filters;
    const s = C.norm(f.search);
    const digits = f.search.replace(/\D/g, '').replace(/^0/, '');
    return S.leads.filter((l) => {
      if (f.stage !== 'ALL' && l.stage !== f.stage) return false;
      if (f.agencyId !== 'ALL' && (l.agencyId || 'NONE') !== f.agencyId) return false;
      if (f.ownerId !== 'ALL' && l.ownerId !== f.ownerId) return false;
      if (f.wilaya !== 'ALL' && (l.wilayaCode || 'NONE') !== f.wilaya) return false;
      if (f.category !== 'ALL' && l.category !== f.category) return false;
      if (f.platform !== 'ALL' && l.platform !== f.platform) return false;
      if (f.storeType !== 'ALL' && l.storeType !== f.storeType) return false;
      if (f.priority !== 'ALL' && l.priority !== f.priority) return false;
      if (f.due && !isDue(l)) return false;
      if (f.hot && !isPrio(l)) return false;
      if (s) {
        const hay = C.norm([l.storeName, l.handle, l.phonePrimary, l.phoneSecondary, l.ownerName, l.city, l.neighborhood].join(' '));
        if (!hay.includes(s) && !(digits.length >= 4 && hay.includes(digits))) return false;
      }
      return true;
    });
  }
  const filterQuery = () => {
    const f = S.filters, q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (k === 'due' || k === 'hot') { if (v) q.set(k, '1'); } else if (v && v !== 'ALL') q.set(k, v); });
    return q.toString();
  };
  const filtersActive = () => Object.keys(DEFAULT_FILTERS).some((k) => S.filters[k] !== DEFAULT_FILTERS[k]);

  function summarise(leads) {
    const month = S.today.slice(0, 7);
    const r = { total: leads.length, enriched: 0, contacted: 0, won: 0, wonThisMonth: 0, dueToday: 0, overdue: 0, hot: 0, newThisMonth: 0, byStage: {} };
    C.STAGE_IDS.forEach((s) => (r.byStage[s] = 0));
    for (const l of leads) {
      r.byStage[l.stage]++;
      if (l.phonePrimary) r.enriched++;
      if (C.CONTACTED_STAGES.includes(l.stage)) r.contacted++;
      if (l.stage === 'WON_EXPEDITEUR') { r.won++; if ((l.wonAt || '').startsWith(month)) r.wonThisMonth++; }
      if ((l.discoveredAt || '').startsWith(month)) r.newThisMonth++;
      if (OPEN(l) && l.nextFollowUpDate === S.today) r.dueToday++;
      if (isOverdue(l)) r.overdue++;
      if (isPrio(l)) r.hot++;
    }
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    r.qualifiedRate = pct(r.enriched, r.total); r.conversionRate = pct(r.won, r.total); r.contactedConversionRate = pct(r.won, r.contacted);
    return r;
  }

  /* ---------------- shell ---------------- */
  function closeAllModals() { $('#modal-root').innerHTML = ''; S.openLeadId = null; }

  function renderShell() {
    applyLang();
    document.title = 'SAME X DELIVERY | ' + t('nav_' + S.view);
    const u = S.user;
    const initials = u.name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
    const nav = (id, icon, extra = '') => `<a class="nav-item ${S.view === id ? 'active' : ''}" href="#${id}" data-nav="${id}">${ic(icon)}<span>${esc(t('nav_' + id))}</span>${extra}</a>`;
    $('#app').innerHTML = `
      <div class="shell">
        <aside class="sidebar ${S.sidebarOpen ? 'open' : ''}" id="sidebar" aria-label="Navigation">
          <div class="sb-top">
            <a class="brand" href="#dashboard" data-nav="dashboard"><img src="/logo-mark.svg" alt=""><div><div class="brand-word" style="color:#fff">SAME <b>X</b> DELIVERY</div><div class="brand-sub">${esc(S.lang === 'ar' ? 'استقطاب المرسلين' : 'Prospection expéditeurs')}</div></div></a>
            <button class="btn btn-primary" data-action="new-lead" style="height:42px">${ic('plus')} ${esc(t('newLead'))}</button>
          </div>
          <div class="sb-scroll">
            <div><div class="sb-label">${esc(t('views'))}</div><nav class="nav">
              ${nav('dashboard', 'dash')}
              ${nav('pipeline', 'kanban', `<span class="count" data-count="total"></span>`)}
              ${nav('table', 'table')}
              ${nav('posts', 'grid')}
              ${nav('reminders', 'bell', `<span class="count" data-count="due"></span>`)}
            </nav></div>
            ${isSup() ? `<div><div class="sb-label">${esc(t('admin'))}</div><nav class="nav">${nav('agencies', 'building')}${nav('users', 'users')}${nav('backup', 'db')}${nav('audit', 'list')}</nav></div>` : ''}
            <div class="sb-card" id="sb-campaign"></div>
            <div><div class="sb-label">${esc(t('quickFilters'))}</div><div class="qf" id="sb-qf"></div></div>
          </div>
          <div class="sb-foot">
            <div class="sb-tools">
              <button class="btn" data-action="export" data-format="csv" title="${esc(t('exportCsv'))}">${ic('down')}<span>CSV</span></button>
              <button class="btn" data-action="export" data-format="xlsx" title="${esc(t('exportXlsx'))}">${ic('down')}<span>Excel</span></button>
              <button class="btn" data-action="import" title="${esc(t('import'))}">${ic('up')}<span>${esc(t('import'))}</span></button>
              <button class="btn btn-icon" data-action="sound" title="${esc(t('sound'))}" aria-pressed="${S.sound}">${ic(S.sound ? 'sound' : 'mute')}</button>
            </div>
            <div class="user-card">
              <div class="avatar" style="background:${esc(u.color || '#FFC800')}">${esc(initials)}</div>
              <div class="meta"><b>${esc(u.name)}</b><span>${esc(isSup() ? t('supervisor') : (S.agency ? S.agency.name : t('agent')))}</span></div>
              <button class="btn btn-sm btn-icon" data-action="lang" title="${esc(t('language'))}">${ic('globe')}</button>
              <button class="btn btn-sm btn-icon" data-action="password" title="${esc(t('changePassword'))}">${ic('key')}</button>
              <button class="btn btn-sm btn-icon" data-action="logout" title="${esc(t('logout'))}">${ic('logout', 'flip')}</button>
            </div>
          </div>
        </aside>
        ${S.sidebarOpen ? '<div class="sb-backdrop" data-action="close-sidebar"></div>' : ''}
        <div class="main">
          <header class="header">
            <button class="btn btn-ghost btn-icon menu-btn" data-action="open-sidebar" aria-label="Menu">${ic('menu')}</button>
            <div class="search">${ic('search')}<input class="input" id="search" type="search" placeholder="${esc(t('search'))}" value="${esc(S.filters.search)}" aria-label="${esc(t('search'))}"></div>
            <div class="filters" id="filters">${filterSelects()}</div>
            <div class="header-right">
              <button class="btn btn-sm hide-sm" data-action="reset-filters" id="reset-btn" ${filtersActive() ? '' : 'hidden'}>${esc(t('reset'))}</button>
              <div class="count-pill"><b id="count-n" class="num">0</b><span>${esc(t('merchants'))}</span></div>
            </div>
          </header>
          <div class="content" id="content"></div>
        </div>
        <nav class="bottom-nav" aria-label="Navigation mobile">
          <button data-nav="dashboard" class="${S.view === 'dashboard' ? 'on' : ''}">${ic('dash')}${esc(S.lang === 'ar' ? 'القيادة' : 'Bord')}</button>
          <button data-nav="pipeline" class="${S.view === 'pipeline' ? 'on' : ''}">${ic('kanban')}${esc(S.lang === 'ar' ? 'المسار' : 'Pipeline')}</button>
          <button data-action="new-lead" aria-label="${esc(t('newLead'))}"><span class="fab">${ic('plus')}</span></button>
          <button data-nav="table" class="${S.view === 'table' ? 'on' : ''}">${ic('table')}${esc(S.lang === 'ar' ? 'القائمة' : 'Liste')}</button>
          <button data-nav="reminders" class="${S.view === 'reminders' ? 'on' : ''}">${ic('bell')}${esc(S.lang === 'ar' ? 'المتابعات' : 'Relances')}</button>
        </nav>
      </div>`;
    renderSidebarCounts();
    renderContent();
  }

  function filterSelects() {
    const f = S.filters;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
    const sel = (key, all, options) => `<select class="select ${f[key] !== 'ALL' ? 'on' : ''}" data-filter="${key}" aria-label="${esc(all)}">${opt('ALL', all, f[key])}${options}</select>`;
    let h = '';
    if (isSup()) {
      h += sel('agencyId', t('allAgencies'), S.agencies.map((a) => opt(a.id, a.name + (a.active ? '' : ` (${t('inactive')})`), f.agencyId)).join('') + opt('NONE', t('noAgency'), f.agencyId));
      h += sel('ownerId', t('allAgents'), S.users.filter((u) => f.agencyId === 'ALL' || u.agencyId === f.agencyId || (f.agencyId === 'NONE' && !u.agencyId)).map((u) => opt(u.id, u.name, f.ownerId)).join(''));
    }
    h += sel('wilaya', t('allWilayas'), C.WILAYAS.map((w) => opt(w.code, `${w.code} - ${S.lang === 'ar' ? w.ar : w.fr}`, f.wilaya)).join('') + opt('NONE', '— ' + t('wilayaUnconfirmed'), f.wilaya));
    h += sel('category', t('allCategories'), C.CATEGORIES.map((c) => opt(c, tv('category', c), f.category)).join(''));
    h += sel('stage', t('allStages'), C.STAGE_IDS.map((s) => opt(s, tv('stage', s), f.stage)).join(''));
    h += sel('priority', t('allPriorities'), C.PRIORITIES.map((p) => opt(p, tv('priority', p), f.priority)).join(''));
    h += sel('platform', t('allPlatforms'), C.PLATFORMS.map((p) => opt(p, tv('platform', p), f.platform)).join(''));
    return h;
  }

  function renderSidebarCounts() {
    const all = summarise(S.leads);
    const fl = filtered();
    const n = $('#count-n'); if (n) n.textContent = fl.length;
    const tot = $('[data-count="total"]'); if (tot) tot.textContent = S.leads.length;
    const due = $('[data-count="due"]');
    if (due) { const d = all.dueToday + all.overdue; due.textContent = d || ''; due.classList.toggle('alert', d > 0); }
    const camp = $('#sb-campaign');
    if (camp) camp.innerHTML = `
      <div class="sb-row"><span style="text-transform:uppercase;letter-spacing:.1em;font-size:10.5px;font-weight:700">${esc(t('campaign'))}</span><strong>${all.qualifiedRate}% ${esc(t('qualified'))}</strong></div>
      <div class="sb-progress"><span style="width:${Math.min(100, all.qualifiedRate)}%"></span></div>
      <div class="sb-row"><span>${esc(t('targeted'))}</span><strong>${all.total}</strong></div>
      <div class="sb-row"><span>${esc(t('verifiedPhone'))}</span><strong>${all.enriched}</strong></div>
      <button class="sb-row btn-row ${S.filters.due ? 'on' : ''}" data-action="toggle-due"><span>● ${esc(t('dueToday'))}</span><strong>${all.dueToday + all.overdue}</strong></button>
      <div class="sb-row"><span>${esc(t('signed'))}</span><strong style="color:#4ADE80">${all.won}</strong></div>`;
    const qf = $('#sb-qf');
    if (qf) {
      const b = (label, key, val) => `<button data-qf="${key}" data-val="${val}" class="${String(S.filters[key]) === String(val) ? 'on' : ''}">${esc(label)}</button>`;
      qf.innerHTML = b('Instagram', 'platform', 'instagram') + b('TikTok', 'platform', 'tiktok') + b('🏬 ' + t('stores'), 'storeType', 'Physical Store') + b('🌐 ' + t('online'), 'storeType', 'Online Only')
        + b('🔥 ' + t('priorityOnly'), 'hot', true) + b('⏰ ' + t('dueOnly'), 'due', true);
    }
    const r = $('#reset-btn'); if (r) r.hidden = !filtersActive();
  }

  function setView(v) {
    if (!validView(v)) v = 'dashboard';
    S.view = v; S.sidebarOpen = false; S.page = 1; S.selected.clear();
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    renderShell();
  }

  function renderContent() {
    const el = $('#content');
    if (!el) return;
    renderSidebarCounts();
    const fn = { dashboard: viewDashboard, pipeline: viewPipeline, table: viewTable, posts: viewPosts, reminders: viewReminders, agencies: viewAgencies, users: viewUsers, backup: viewBackup, audit: viewAudit }[S.view];
    fn(el);
  }

  /* mobile filter block (header filters are hidden on small screens) */
  const mobileFilters = () => {
    const n = Object.keys(DEFAULT_FILTERS).filter((k) => k !== 'search' && S.filters[k] !== DEFAULT_FILTERS[k]).length;
    return `<details class="mobile-filters panel" ${S.mobileFiltersOpen ? 'open' : ''} data-mfilters>
      <summary class="btn btn-ghost" style="width:100%;justify-content:space-between">${ic('list')} ${esc(S.lang === 'ar' ? 'التصفية' : 'Filtres')}${n ? ` <span class="chip chip-yellow">${n}</span>` : ''}<span style="margin-inline-start:auto">${ic('chevR')}</span></summary>
      <div class="panel-b" style="display:grid;gap:8px;padding-top:4px"><div class="grid-2">${filterSelects()}</div>${filtersActive() ? `<button class="btn btn-sm" data-action="reset-filters">${esc(t('reset'))}</button>` : ''}</div></details>`;
  };
  document.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('[data-mfilters]')) S.mobileFiltersOpen = e.target.open; }, true);

  /* ---------------- views: dashboard ---------------- */
  async function viewDashboard(el) {
    const leads = filtered();
    const s = summarise(leads);
    const kpi = (label, value, sub, cls = '', action = '') => `<div class="kpi ${cls} ${action ? 'click' : ''}" ${action}><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
    const maxStage = Math.max(1, ...Object.values(s.byStage));
    el.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t('nav_dashboard'))}</h1><p>${esc(isSup() ? t('national') : (S.agency ? `${S.agency.name} · ${wName(S.agency.wilayaCode)}` : ''))} — ${esc(fmtDate(S.today))}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="export" data-format="xlsx">${ic('down')} ${esc(t('exportXlsx'))}</button><button class="btn btn-primary" data-action="new-lead">${ic('plus')} ${esc(t('newLead'))}</button></div></div>
      ${mobileFilters()}
      <div class="kpis">
        ${kpi(t('kpi_total'), s.total, `${s.newThisMonth} ${esc(t('kpi_newMonth').toLowerCase())}`)}
        ${kpi(t('kpi_enriched'), s.enriched, `${s.qualifiedRate}% ${esc(t('ofTotal'))}`)}
        ${kpi(t('kpi_contacted'), s.contacted, '')}
        ${kpi(t('kpi_won'), s.won, `${s.wonThisMonth} ${esc(t('kpi_wonMonth').toLowerCase())}`, 'accent')}
        ${kpi(t('kpi_conversion'), s.conversionRate + '%', `${esc(t('kpi_contactedConv'))} : ${s.contactedConversionRate}%`)}
        ${kpi(t('kpi_due'), s.dueToday, '', s.dueToday ? 'warn' : '', 'data-nav="reminders"')}
        ${kpi(t('kpi_overdue'), s.overdue, '', s.overdue ? 'bad' : '', 'data-nav="reminders"')}
        ${kpi(t('kpi_hot'), s.hot, '', '', 'data-action="filter-hot"')}
      </div>
      <div class="dash-grid">
        <section class="panel"><div class="panel-h"><h2>${esc(t('funnel'))}</h2></div><div class="panel-b funnel">
          ${C.STAGES.map((st) => `<div class="funnel-row" data-action="goto-stage" data-stage="${st.id}"><span>${esc(tv('stage', st.id))}</span><div class="bar"><span style="width:${(s.byStage[st.id] / maxStage) * 100}%;background:${st.color}"></span></div><b>${s.byStage[st.id]}</b></div>`).join('')}
        </div></section>
        <section class="panel"><div class="panel-h"><h2>${esc(t('activity'))}</h2><div class="legend"><span><i style="background:var(--black)"></i>${esc(t('interactions'))}</span><span><i style="background:var(--yellow)"></i>${esc(t('wins'))}</span></div></div>
          <div class="panel-b" id="weeks"><div class="empty">…</div></div></section>
      </div>
      <div class="dash-grid">
        <section class="panel">${isSup() ? `<div class="panel-h"><h2>${esc(t('byAgency'))}</h2></div><div class="table-wrap" id="by-agency"><div class="empty">…</div></div>` : `<div class="panel-h"><h2>${esc(t('upcoming'))}</h2></div><div id="upcoming"></div>`}</section>
        <section class="panel"><div class="panel-h"><h2>${esc(isSup() ? t('byAgent') : t('upcoming'))}</h2></div><div class="table-wrap" id="${isSup() ? 'by-agent' : 'upcoming2'}"><div class="empty">…</div></div></section>
      </div>
    </div>`;
    if (!isSup()) { $('#upcoming').innerHTML = upcomingList(leads, 8); $('#upcoming2').innerHTML = agentSelfCard(s); }
    try {
      const st = await api('GET', '/api/stats?' + filterQuery());
      if (S.view !== 'dashboard') return;
      const maxW = Math.max(1, ...st.weeks.map((w) => Math.max(w.interactions, w.won)));
      $('#weeks').innerHTML = `<div class="weeks">${st.weeks.map((w) => `<div class="week" title="${esc(t('weekOf'))} ${esc(w.start)} · ${w.interactions} ${esc(t('interactions'))} · ${w.won} ${esc(t('wins'))}"><div class="cols"><span class="i" style="height:${(w.interactions / maxW) * 100}%"></span><span class="w" style="height:${(w.won / maxW) * 100}%"></span></div><small>${esc(fmtDate(w.start))}</small></div>`).join('')}</div>`;
      if (isSup()) {
        const row = (name, sub, x) => `<tr><td><b>${esc(name)}</b>${sub ? `<br><small style="color:var(--muted)">${esc(sub)}</small>` : ''}</td><td class="r num">${x.total}</td><td class="r num">${x.contacted}</td><td class="r num"><b>${x.won}</b></td><td class="r num">${x.wonThisMonth}</td><td class="r num"><span class="bar-mini"><span style="width:${Math.min(100, x.conversionRate * 2)}%"></span></span>${x.conversionRate}%</td><td class="r num">${x.dueToday + x.overdue ? `<span class="chip ${x.overdue ? 'chip-red' : 'chip-yellow'}">${x.dueToday + x.overdue}</span>` : '0'}</td></tr>`;
        const head = (first) => `<thead><tr><th>${esc(first)}</th><th class="r">${esc(t('kpi_total'))}</th><th class="r">${esc(t('kpi_contacted'))}</th><th class="r">${esc(t('wins'))}</th><th class="r">${esc(t('kpi_wonMonth'))}</th><th class="r">${esc(t('kpi_conversion'))}</th><th class="r">${esc(t('kpi_due'))}</th></tr></thead>`;
        $('#by-agency').innerHTML = st.byAgency.length ? `<table class="tbl">${head(t('agency'))}<tbody>${st.byAgency.map((a) => row(a.name || t('noAgency'), a.id === 'NONE' ? '' : `${a.code ? a.code + ' · ' : ''}${wName(a.wilayaCode)}${a.active === false ? ' · ' + t('inactive') : ''}`, a)).join('')}</tbody></table>` : `<div class="empty">${esc(t('noData'))}</div>`;
        $('#by-agent').innerHTML = st.byAgent.length ? `<table class="tbl">${head(t('col_agent'))}<tbody>${st.byAgent.map((a) => row(a.name, a.role === 'supervisor' ? t('supervisor') : (agencyOf(a.agencyId) || {}).name || '', a)).join('')}</tbody></table>` : `<div class="empty">${esc(t('noData'))}</div>`;
      }
    } catch (e) { toast(errMsg(e), 'err'); }
  }
  function agentSelfCard(s) {
    return `<div class="panel-b" style="display:grid;gap:10px">${[['kpi_total', s.total], ['kpi_contacted', s.contacted], ['kpi_won', s.won], ['kpi_wonMonth', s.wonThisMonth], ['kpi_conversion', s.conversionRate + '%'], ['kpi_contactedConv', s.contactedConversionRate + '%']].map(([k, v]) => `<div class="sb-row" style="color:var(--muted)"><span>${esc(t(k))}</span><strong style="color:var(--black)">${v}</strong></div>`).join('')}</div>`;
  }
  function upcomingList(leads, limit) {
    const up = leads.filter((l) => OPEN(l) && l.nextFollowUpDate).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate)).slice(0, limit);
    if (!up.length) return `<div class="empty">${esc(t('noReminders'))}</div>`;
    return `<div class="panel-b" style="display:grid;gap:8px">${up.map((l) => remRow(l)).join('')}</div>`;
  }

  /* ---------------- views: pipeline ---------------- */
  const stageMeta = (id) => C.STAGES.find((s) => s.id === id) || C.STAGES[0];
  function leadCard(l) {
    const idx = C.STAGE_IDS.indexOf(l.stage);
    const due = isDue(l), late = isOverdue(l);
    return `<article class="card ${isPrio(l) ? 'prio' : ''}" draggable="true" data-lead="${l.id}">
      <div class="card-top"><div style="min-width:0"><div class="card-title" dir="auto">${esc(l.storeName)}</div><div class="card-handle" dir="auto">${esc(l.handle || '')}</div></div><span class="plat plat-${esc(l.platform)}">${esc(tv('platform', l.platform))}</span></div>
      <div class="card-tags">
        <span class="chip">${esc(tv('category', l.category))}</span>
        <span class="chip">${esc(tv('storeShort', l.storeType))}</span>
        ${l.wilayaCode ? `<span class="chip ${l.wilayaConfirmed ? 'chip-green' : ''}">${ic('pin')}${esc(wShort(l.wilayaCode))}</span>` : `<span class="chip chip-yellow">${ic('pin')}${esc(t('wilayaUnconfirmed'))}</span>`}
        ${l.priority === 'high' ? `<span class="chip chip-red">${ic('flame')}${esc(tv('priority', 'high'))}</span>` : ''}
        ${late ? `<span class="chip chip-red">${ic('clock')}${esc(t('overdueBadge'))}</span>` : due ? `<span class="chip chip-yellow">${ic('clock')}${esc(t('dueTodayBadge'))}</span>` : ''}
        ${isSup() && l.ownerId !== S.user.id ? `<span class="chip chip-dark">${esc(userName(l.ownerId))}</span>` : ''}
      </div>
      <div class="card-foot">
        <span>${l.phonePrimary ? `<span class="num" dir="ltr">${esc(C.formatPhone(l.phonePrimary))}</span>` : esc(t('toEnrich'))}</span>
        <span class="acts">
          ${l.phonePrimary ? `<button class="btn btn-sm btn-icon btn-wa" data-action="pitch" data-id="${l.id}" title="${esc(t('pitch'))}">${ic('wa')}</button>` : ''}
          <button class="btn btn-sm btn-icon" data-action="move" data-id="${l.id}" data-dir="-1" ${idx <= 0 ? 'disabled' : ''} title="${esc(t('prevStage'))}">${ic('chevL', 'flip')}</button>
          <button class="btn btn-sm btn-icon" data-action="move" data-id="${l.id}" data-dir="1" ${idx >= C.STAGE_IDS.length - 1 ? 'disabled' : ''} title="${esc(t('nextStage'))}">${ic('chevR', 'flip')}</button>
        </span>
      </div></article>`;
  }
  function viewPipeline(el) {
    const leads = filtered();
    const counts = Object.fromEntries(C.STAGE_IDS.map((s) => [s, leads.filter((l) => l.stage === s).length]));
    const stages = S.stageTab === 'ALL' ? C.STAGES : C.STAGES.filter((s) => s.id === S.stageTab);
    const LIMIT = 80;
    el.innerHTML = `<div class="board-wrap">
      <div class="stage-tabs"><button class="stage-tab ${S.stageTab === 'ALL' ? 'on' : ''}" data-stage-tab="ALL">${esc(t('all'))} <span class="n">${leads.length}</span></button>
        ${C.STAGES.map((s) => `<button class="stage-tab ${S.stageTab === s.id ? 'on' : ''}" data-stage-tab="${s.id}"><span class="dot" style="background:${s.color}"></span>${esc(tv('stage', s.id))} <span class="n">${counts[s.id]}</span></button>`).join('')}</div>
      <div class="board">${stages.map((s) => {
        const items = leads.filter((l) => l.stage === s.id).sort((a, b) => (isPrio(b) - isPrio(a)) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        return `<section class="column" data-col="${s.id}"><div class="column-h"><span class="dot" style="background:${s.color}"></span>${esc(tv('stage', s.id))}<span class="n">${items.length}</span></div>
          <div class="column-desc">${esc(tv('stageDesc', s.id))}</div>
          <div class="column-b">${items.length ? items.slice(0, LIMIT).map(leadCard).join('') + (items.length > LIMIT ? `<button class="btn btn-sm" data-action="goto-table-stage" data-stage="${s.id}">+${items.length - LIMIT} → ${esc(t('nav_table'))}</button>` : '') : `<div class="empty" style="padding:24px 8px">${esc(t('noLeads'))}</div>`}</div></section>`;
      }).join('')}</div></div>`;
    bindDnD(el);
  }
  function bindDnD(el) {
    let dragId = null;
    el.addEventListener('dragstart', (e) => { const c = e.target.closest('.card'); if (!c) return; dragId = c.dataset.lead; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch {} });
    el.addEventListener('dragend', (e) => { const c = e.target.closest('.card'); if (c) c.classList.remove('dragging'); $$('.column.drop', el).forEach((x) => x.classList.remove('drop')); });
    el.addEventListener('dragover', (e) => { const col = e.target.closest('.column'); if (!col || !dragId) return; e.preventDefault(); $$('.column.drop', el).forEach((x) => x !== col && x.classList.remove('drop')); col.classList.add('drop'); });
    el.addEventListener('drop', (e) => { const col = e.target.closest('.column'); if (!col || !dragId) return; e.preventDefault(); const id = dragId; dragId = null; col.classList.remove('drop'); const l = S.leads.find((x) => x.id === id); if (l && l.stage !== col.dataset.col) changeStage(l, col.dataset.col); });
  }

  /* ---------------- views: table ---------------- */
  function sortLeads(leads) {
    const { key, dir } = S.sort;
    const val = (l) => key === 'agent' ? userName(l.ownerId) : key === 'stage' ? C.STAGE_IDS.indexOf(l.stage) : key === 'priority' ? C.PRIORITIES.indexOf(l.priority) * -1 : (l[key] || '');
    return leads.slice().sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  }
  function viewTable(el) {
    const leads = sortLeads(filtered());
    const pages = Math.max(1, Math.ceil(leads.length / S.pageSize));
    S.page = Math.min(S.page, pages);
    const slice = leads.slice((S.page - 1) * S.pageSize, S.page * S.pageSize);
    const th = (key, label, cls = '') => `<th class="sortable ${cls}" data-sort="${key}">${esc(label)}${S.sort.key === key ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const allSel = slice.length && slice.every((l) => S.selected.has(l.id));
    el.innerHTML = `<div class="page">
      ${mobileFilters()}
      ${S.selected.size ? `<div class="bulkbar"><b>${S.selected.size} ${esc(t('selected'))}</b>
        <select class="select" data-bulk="stage"><option value="">${esc(t('bulkStage'))}…</option>${C.STAGE_IDS.map((s) => `<option value="${s}">${esc(tv('stage', s))}</option>`).join('')}</select>
        <select class="select" data-bulk="priority"><option value="">${esc(t('priority'))}…</option>${C.PRIORITIES.map((p) => `<option value="${p}">${esc(tv('priority', p))}</option>`).join('')}</select>
        ${isSup() ? `<select class="select" data-bulk="ownerId"><option value="">${esc(t('bulkAssign'))}…</option>${assignOptions('')}</select>` : ''}
        <button class="btn btn-sm btn-danger" data-action="bulk-delete" style="background:#fff">${ic('trash')} ${esc(t('bulkDelete'))}</button>
        <button class="btn btn-sm btn-ghost" data-action="bulk-clear" style="color:#fff;margin-inline-start:auto">${ic('x')}</button></div>` : ''}
      <section class="panel"><div class="table-wrap"><table class="tbl">
        <thead><tr><th style="width:36px"><input type="checkbox" data-action="select-page" ${allSel ? 'checked' : ''} aria-label="select"></th>
          ${th('storeName', t('col_store'))}${th('category', t('col_category'))}${th('wilayaCode', t('col_model'))}<th>${esc(t('col_contact'))}</th>${th('estimatedVolume', t('col_volume'))}${th('stage', t('col_stage'))}${th('nextFollowUpDate', t('col_followup'))}${isSup() ? th('agent', t('col_agent')) : ''}<th></th></tr></thead>
        <tbody>${slice.length ? slice.map((l) => `<tr data-row="${l.id}" class="${S.selected.has(l.id) ? 'sel' : ''}">
          <td><input type="checkbox" data-select="${l.id}" ${S.selected.has(l.id) ? 'checked' : ''} aria-label="select"></td>
          <td class="store" data-open="${l.id}" style="cursor:pointer"><span class="plat plat-${esc(l.platform)}">${esc(tv('platform', l.platform))}</span> ${isPrio(l) ? `<span class="hot">${ic('flame')}</span>` : ''}<b dir="auto">${esc(l.storeName)}</b><small dir="auto">${esc(l.handle)}</small></td>
          <td>${esc(tv('category', l.category))}</td>
          <td><span class="chip">${esc(tv('storeShort', l.storeType))}</span><br><small style="color:${l.wilayaConfirmed ? 'var(--green)' : 'var(--muted)'}">${l.wilayaCode ? esc(wName(l.wilayaCode)) : esc(t('wilayaUnconfirmed'))}</small></td>
          <td>${l.ownerName ? `<b>${esc(l.ownerName)}</b><br>` : ''}${l.phonePrimary ? `<small class="num" dir="ltr">${esc(C.formatPhone(l.phonePrimary))}</small>` : '<small style="color:var(--faint)">—</small>'}</td>
          <td><small>${esc(tv('volume', l.estimatedVolume))}</small></td>
          <td><select class="select" data-stage-select="${l.id}" aria-label="${esc(t('stage'))}">${C.STAGE_IDS.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${esc(tv('stage', s))}</option>`).join('')}</select></td>
          <td>${l.nextFollowUpDate ? `<span class="chip ${isOverdue(l) ? 'chip-red' : isDue(l) ? 'chip-yellow' : ''}">${esc(fmtDate(l.nextFollowUpDate))}</span>` : '—'}</td>
          ${isSup() ? `<td><small>${esc(userName(l.ownerId))}</small></td>` : ''}
          <td style="white-space:nowrap">${l.phonePrimary ? `<button class="btn btn-sm btn-icon btn-wa" data-action="pitch" data-id="${l.id}" title="${esc(t('pitch'))}">${ic('wa')}</button> ` : ''}<button class="btn btn-sm" data-open="${l.id}">${esc(t('open'))}</button></td>
        </tr>`).join('') : `<tr><td colspan="10"><div class="empty">${esc(t('noLeads'))}</div></td></tr>`}</tbody></table></div>
        <div class="pager"><span>${leads.length ? `${(S.page - 1) * S.pageSize + 1}–${Math.min(S.page * S.pageSize, leads.length)} ${esc(t('of'))} ${leads.length}` : ''}</span>
          <span style="display:flex;gap:6px;align-items:center"><button class="btn btn-sm btn-icon" data-page="${S.page - 1}" ${S.page <= 1 ? 'disabled' : ''}>${ic('chevL', 'flip')}</button><span class="num">${esc(t('page'))} ${S.page} / ${pages}</span><button class="btn btn-sm btn-icon" data-page="${S.page + 1}" ${S.page >= pages ? 'disabled' : ''}>${ic('chevR', 'flip')}</button></span></div>
      </section></div>`;
  }

  /* ---------------- views: posts ---------------- */
  function viewPosts(el) {
    const leads = filtered().sort((a, b) => (b.discoveredAt || '').localeCompare(a.discoveredAt || ''));
    const LIMIT = 120;
    el.innerHTML = `<div class="page">${mobileFilters()}
      ${leads.length ? `<div class="posts">${leads.slice(0, LIMIT).map((l) => `<article class="post" data-open="${l.id}">
        <div class="post-media">${l.postImageUrl ? `<img src="${esc(l.postImageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div style="display:grid;justify-items:center;gap:6px">${ic('image')}<small>${esc(t('noMedia'))}</small></div>`}
          <span class="tl plat plat-${esc(l.platform)}">${esc(tv('platform', l.platform))}</span><span class="tr chip" style="background:#fff"><span class="dot" style="background:${stageMeta(l.stage).color}"></span>${esc(tv('stage', l.stage))}</span></div>
        <div class="post-b"><div class="card-top"><div style="min-width:0"><div class="card-title" dir="auto">${esc(l.storeName)}</div><div class="card-handle" dir="auto">${esc(l.handle)}</div></div>${l.postUrl ? `<a class="btn btn-sm btn-icon btn-ghost" href="${esc(l.postUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(t('openPost'))}" data-stop>${ic('ext')}</a>` : ''}</div>
          <p dir="auto">${esc(l.postCaption || '')}</p>
          <div class="card-tags"><span class="chip">${esc(tv('category', l.category))}</span><span class="chip">${esc(tv('storeShort', l.storeType))}</span>${l.wilayaCode ? `<span class="chip">${esc(wShort(l.wilayaCode))}</span>` : ''}</div></div>
        <div class="post-f"><span>${l.phonePrimary ? `<span class="num" dir="ltr">${esc(C.formatPhone(l.phonePrimary))}</span>` : esc(t('notQualified'))}</span><span>${esc(t('details'))} →</span></div>
      </article>`).join('')}</div>${leads.length > LIMIT ? `<div class="empty">+${leads.length - LIMIT} — <button class="btn btn-sm" data-nav="table">${esc(t('nav_table'))}</button></div>` : ''}` : `<div class="panel empty">${esc(t('noLeads'))}</div>`}</div>`;
  }

  /* ---------------- views: reminders ---------------- */
  function remRow(l) {
    const late = isOverdue(l);
    return `<div class="rem ${late ? 'late' : ''}">
      <div class="who" data-open="${l.id}"><b dir="auto">${isPrio(l) ? `<span class="hot">${ic('flame')}</span> ` : ''}${esc(l.storeName)}</b><small>${esc(tv('stage', l.stage))} · <span class="chip ${late ? 'chip-red' : l.nextFollowUpDate === S.today ? 'chip-yellow' : ''}">${esc(fmtDate(l.nextFollowUpDate))}</span>${l.phonePrimary ? ` · <span class="num" dir="ltr">${esc(C.formatPhone(l.phonePrimary))}</span>` : ''}${isSup() ? ` · ${esc(userName(l.ownerId))}` : ''}</small></div>
      <div class="acts">
        ${l.phonePrimary ? `<button class="btn btn-sm btn-wa" data-action="pitch" data-id="${l.id}">${ic('wa')} WhatsApp</button>` : ''}
        <button class="btn btn-sm" data-action="snooze" data-id="${l.id}" data-days="2">${esc(t('snooze'))} +2j</button>
        <button class="btn btn-sm btn-dark" data-action="log-done" data-id="${l.id}">${ic('check')} ${esc(t('done'))}</button>
      </div></div>`;
  }
  function viewReminders(el) {
    const leads = filtered().filter((l) => OPEN(l) && l.nextFollowUpDate).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate) || isPrio(b) - isPrio(a));
    const in7 = addDays(S.today, 7);
    const groups = [
      ['overdue', leads.filter((l) => l.nextFollowUpDate < S.today), 'chip-red'],
      ['today', leads.filter((l) => l.nextFollowUpDate === S.today), 'chip-yellow'],
      ['next7', leads.filter((l) => l.nextFollowUpDate > S.today && l.nextFollowUpDate <= in7), ''],
    ];
    el.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(t('nav_reminders'))}</h1><p>${esc(fmtDate(S.today))}</p></div></div>${mobileFilters()}
      ${groups.some((g) => g[1].length) ? groups.filter((g) => g[1].length).map(([k, items, chip]) => `<section class="rem-group"><h3>${esc(t(k))} <span class="chip ${chip}">${items.length}</span></h3>${items.map(remRow).join('')}</section>`).join('') : `<div class="panel empty">${esc(t('noReminders'))}</div>`}</div>`;
  }
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  /* ---------------- views: agencies ---------------- */
  function viewAgencies(el) {
    el.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(t('agenciesTitle'))}</h1><p>${esc(t('agenciesText'))}</p></div><button class="btn btn-primary" data-action="agency-form">${ic('plus')} ${esc(t('newAgency'))}</button></div>
      <div class="agency-grid">${S.agencies.length ? S.agencies.map((a) => {
        const leads = S.leads.filter((l) => l.agencyId === a.id); const s = summarise(leads);
        const agents = S.users.filter((u) => u.agencyId === a.id);
        return `<article class="agency ${a.active ? '' : 'off'}">
          <div class="agency-h"><div class="agency-badge" style="background:${esc(a.color)};color:${a.color.toLowerCase() === '#111111' ? '#FFC800' : '#111'}">${esc(a.wilayaCode)}</div><div style="min-width:0;flex:1"><b>${esc(a.name)}</b><small>${esc(a.code || '')} · ${esc(wName(a.wilayaCode))}</small></div><span class="chip ${a.active ? 'chip-green' : 'chip-red'}">${esc(a.active ? t('active') : t('inactive'))}</span></div>
          <div class="agency-stats"><div><b>${agents.length}</b><span>${esc(t('agents'))}</span></div><div><b>${s.total}</b><span>${esc(t('leads'))}</span></div><div><b>${s.won}</b><span>${esc(t('wins'))}</span></div><div><b>${s.conversionRate}%</b><span>conv.</span></div></div>
          <div class="card-tags">${(a.wilayas || []).map((c) => `<span class="chip">${esc(wName(c))}</span>`).join('')}</div>
          ${a.phone || a.address ? `<small style="color:var(--muted)">${esc([a.address, C.formatPhone(a.phone)].filter(Boolean).join(' · '))}</small>` : ''}
          <div class="agency-f"><button class="btn btn-sm" data-action="agency-form" data-id="${a.id}">${esc(t('edit'))}</button>
            <button class="btn btn-sm" data-action="agency-filter" data-id="${a.id}">${esc(t('nav_pipeline'))}</button>
            <button class="btn btn-sm ${a.active ? 'btn-danger' : ''}" data-action="agency-toggle" data-id="${a.id}">${esc(a.active ? t('deactivate') : t('activate'))}</button></div>
        </article>`; }).join('') : `<div class="panel empty">${esc(t('noData'))}</div>`}</div></div>`;
  }
  function agencyForm(a) {
    const isNew = !a; a = a || { name: '', code: '', wilayaCode: '', wilayas: [], color: '#FFC800', address: '', phone: '' };
    const m = openModal(`<form id="ag-form" novalidate>
      <div class="modal-h"><h2>${esc(isNew ? t('newAgency') : a.name)}</h2><button type="button" class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="form-error" id="ag-err" hidden></div>
        <div class="grid-2"><label class="field"><span class="req">${esc(t('agencyName'))}</span><input class="input" id="ag-name" value="${esc(a.name)}" autofocus></label>
          <label class="field"><span>${esc(t('code'))}</span><input class="input" id="ag-code" value="${esc(a.code)}" maxlength="12" placeholder="BSK"></label></div>
        <div class="grid-2"><label class="field"><span class="req">${esc(t('mainWilaya'))}</span><select class="select" id="ag-wilaya"><option value="">—</option>${C.WILAYAS.map((w) => `<option value="${w.code}" ${w.code === a.wilayaCode ? 'selected' : ''}>${w.code} - ${esc(S.lang === 'ar' ? w.ar : w.fr)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(t('color'))}</span><select class="select" id="ag-color">${[['#FFC800', 'Jaune SAME X'], ['#111111', 'Noir'], ['#333333', 'Gris foncé'], ['#F5F5F5', 'Gris clair']].map(([c, n]) => `<option value="${c}" ${c === a.color ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="field"><span>${esc(t('coveredWilayas'))}</span><div class="wilaya-pick">${C.WILAYAS.map((w) => `<label><input type="checkbox" value="${w.code}" ${(a.wilayas || []).includes(w.code) ? 'checked' : ''}>${w.code} ${esc(S.lang === 'ar' ? w.ar : w.fr)}</label>`).join('')}</div></div>
        <div class="grid-2"><label class="field"><span>${esc(t('address'))}</span><input class="input" id="ag-address" value="${esc(a.address)}"></label>
          <label class="field"><span>${esc(t('agencyPhone'))}</span><input class="input" id="ag-phone" dir="ltr" value="${esc(C.formatPhone(a.phone))}" placeholder="+213 …"></label></div>
      </div>
      <div class="modal-f"><button type="button" class="btn" data-close>${esc(t('cancel'))}</button><button class="btn btn-primary" type="submit">${esc(isNew ? t('create') : t('save'))}</button></div></form>`);
    $('#ag-wilaya', m.el).addEventListener('change', (e) => { const cb = $(`.wilaya-pick input[value="${e.target.value}"]`, m.el); if (cb) cb.checked = true; });
    $('#ag-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#ag-name', m.el).value, code: $('#ag-code', m.el).value, wilayaCode: $('#ag-wilaya', m.el).value, color: $('#ag-color', m.el).value,
        address: $('#ag-address', m.el).value, phone: $('#ag-phone', m.el).value, wilayas: $$('.wilaya-pick input:checked', m.el).map((x) => x.value) };
      try {
        const r = isNew ? await api('POST', '/api/agencies', body) : await api('PATCH', '/api/agencies/' + a.id, body);
        if (isNew) S.agencies.push(r); else Object.assign(S.agencies.find((x) => x.id === a.id), r);
        m.close(); toast(t('saved'), 'ok'); renderContent();
      } catch (err) { $('#ag-err', m.el).textContent = errMsg(err); $('#ag-err', m.el).hidden = false; }
    });
  }

  /* ---------------- views: users ---------------- */
  function viewUsers(el) {
    el.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(t('usersTitle'))}</h1><p>${esc(t('usersText'))}</p></div><button class="btn btn-primary" data-action="user-form">${ic('plus')} ${esc(t('newUser'))}</button></div>
      <section class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(t('fullName'))}</th><th>${esc(t('username'))}</th><th>${esc(t('role'))}</th><th>${esc(t('agency'))}</th><th class="r">${esc(t('leads'))}</th><th class="r">${esc(t('wins'))}</th><th>${esc(t('lastLogin'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead>
      <tbody>${S.users.map((u) => { const s = summarise(S.leads.filter((l) => l.ownerId === u.id)); const ag = agencyOf(u.agencyId); return `<tr>
        <td><div style="display:flex;gap:10px;align-items:center"><div class="avatar" style="background:${esc(u.color || '#FFC800')};width:30px;height:30px;font-size:11px">${esc(u.name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase())}</div><b>${esc(u.name)}</b>${u.id === S.user.id ? ` <span class="chip">${esc(t('you'))}</span>` : ''}</div></td>
        <td><code>${esc(u.username)}</code></td><td><span class="chip ${u.role === 'supervisor' ? 'chip-dark' : ''}">${esc(tv('role', u.role))}</span></td>
        <td>${ag ? esc(ag.name) + (ag.active ? '' : ` <span class="chip chip-red">${esc(t('inactive'))}</span>`) : '<small style="color:var(--muted)">' + esc(t('national')) + '</small>'}</td>
        <td class="r num">${s.total}</td><td class="r num">${s.won}</td><td><small>${u.lastLoginAt ? esc(fmtDate(u.lastLoginAt, true)) : esc(t('never'))}</small></td>
        <td><span class="chip ${u.active ? 'chip-green' : 'chip-red'}">${esc(u.active ? t('active') : t('inactive'))}</span></td>
        <td style="white-space:nowrap"><button class="btn btn-sm" data-action="user-form" data-id="${u.id}">${esc(t('edit'))}</button>
          ${u.id !== S.user.id ? `<button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-action="user-toggle" data-id="${u.id}">${esc(u.active ? t('deactivate') : t('activate'))}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section></div>`;
  }
  function userForm(u) {
    const isNew = !u; u = u || { name: '', username: '', role: 'agent', agencyId: (S.agencies.find((a) => a.active) || {}).id || '', color: '#FFC800' };
    const m = openModal(`<form id="u-form" novalidate>
      <div class="modal-h"><h2>${esc(isNew ? t('newUser') : u.name)}</h2><button type="button" class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="form-error" id="u-err" hidden></div>
        <div class="field"><span>${esc(t('role'))}</span><div class="grid-2">
          ${['agent', 'supervisor'].map((r) => `<label class="check section" style="padding:12px"><input type="radio" name="role" value="${r}" ${u.role === r ? 'checked' : ''}><span><b>${esc(tv('role', r))}</b><br><small class="hint">${esc(r === 'agent' ? t('roleAgentHelp') : t('roleSupHelp'))}</small></span></label>`).join('')}</div></div>
        <div class="grid-2"><label class="field"><span class="req">${esc(t('fullName'))}</span><input class="input" id="u-name" value="${esc(u.name)}" autofocus placeholder="Agent Annaba (23)"></label>
          <label class="field"><span class="req">${esc(t('username'))}</span><input class="input" id="u-username" value="${esc(u.username)}" autocapitalize="none" autocomplete="off"></label></div>
        <label class="field" id="u-agency-wrap"><span class="req">${esc(t('agency'))}</span><select class="select" id="u-agency">${S.agencies.map((a) => `<option value="${a.id}" ${a.id === u.agencyId ? 'selected' : ''} ${a.active ? '' : 'disabled'}>${esc(a.name)} — ${esc(wName(a.wilayaCode))}${a.active ? '' : ' (' + esc(t('inactive')) + ')'}</option>`).join('')}</select></label>
        <div class="grid-2"><label class="field"><span class="${isNew ? 'req' : ''}">${esc(isNew ? t('password') : t('resetPassword'))}</span><input class="input" id="u-pass" type="password" autocomplete="new-password"><small class="hint">${esc(t('pwRule'))}</small></label>
          <label class="field"><span>${esc(t('color'))}</span><select class="select" id="u-color">${[['#FFC800', 'Jaune'], ['#F5F5F5', 'Gris clair'], ['#E8F6EC', 'Vert'], ['#EAF0FD', 'Bleu'], ['#FDECEA', 'Rouge']].map(([c, n]) => `<option value="${c}" ${c === u.color ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      </div>
      <div class="modal-f"><button type="button" class="btn" data-close>${esc(t('cancel'))}</button><button class="btn btn-primary" type="submit">${esc(isNew ? t('create') : t('save'))}</button></div></form>`);
    const sync = () => { $('#u-agency-wrap', m.el).hidden = $('input[name=role]:checked', m.el).value !== 'agent'; };
    $$('input[name=role]', m.el).forEach((r) => r.addEventListener('change', sync)); sync();
    $('#u-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const role = $('input[name=role]:checked', m.el).value;
      const body = { name: $('#u-name', m.el).value, username: $('#u-username', m.el).value, role, color: $('#u-color', m.el).value };
      if (role === 'agent') body.agencyId = $('#u-agency', m.el).value;
      const pw = $('#u-pass', m.el).value; if (pw || isNew) body.password = pw;
      try {
        const r = isNew ? await api('POST', '/api/users', body) : await api('PATCH', '/api/users/' + u.id, body);
        if (isNew) S.users.push(r); else Object.assign(S.users.find((x) => x.id === u.id), r);
        if (r.id === S.user.id) Object.assign(S.user, r);
        m.close(); toast(t('saved'), 'ok');
        if (!isNew) await refreshLeads(true);
        renderContent();
      } catch (err) { $('#u-err', m.el).textContent = errMsg(err); $('#u-err', m.el).hidden = false; }
    });
  }

  /* ---------------- views: backup & audit ---------------- */
  async function viewBackup(el) {
    el.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(t('backupTitle'))}</h1><p>${esc(t('backupText'))}</p></div></div>
      <div class="dash-grid">
        <section class="panel"><div class="panel-h"><h2>${esc(t('backupTitle'))}</h2></div><div class="panel-b" style="display:grid;gap:12px">
          <a class="btn btn-dark" href="/api/backup" download>${ic('down')} ${esc(t('downloadBackup'))}</a>
          <div class="field"><span>${esc(t('restoreFile'))}</span><input class="input" type="file" id="restore-file" accept=".json,application/json" style="padding-top:7px"></div>
          <label class="check"><input type="radio" name="rmode" value="replace" checked><span>${esc(t('replace'))}</span></label>
          <label class="check"><input type="radio" name="rmode" value="merge"><span>${esc(t('merge'))}</span></label>
          <button class="btn btn-primary" data-action="restore-file">${ic('up')} ${esc(t('restore'))}</button>
        </div></section>
        <section class="panel"><div class="panel-h"><h2>${esc(t('importTitle'))}</h2></div><div class="panel-b" style="display:grid;gap:12px">
          <p class="hint" style="margin:0;line-height:1.5">${esc(t('importText'))}</p>
          <button class="btn btn-primary" data-action="import">${ic('up')} ${esc(t('import'))}</button>
          <p class="hint" style="margin:0;line-height:1.5;background:var(--grey-light);padding:10px;border-radius:8px">${esc(t('legacyHelp'))}</p>
        </div></section>
      </div>
      <section class="panel"><div class="panel-h"><h2>${esc(t('snapshots'))}</h2><button class="btn btn-sm" data-action="snapshot">${ic('plus')} ${esc(t('takeSnapshot'))}</button></div><div class="table-wrap" id="snaps"><div class="empty">…</div></div></section></div>`;
    try {
      const r = await api('GET', '/api/backups'); S.snapshots = r.snapshots;
      if (S.view !== 'backup') return;
      $('#snaps').innerHTML = r.snapshots.length ? `<table class="tbl"><thead><tr><th>${esc(t('when'))}</th><th>Type</th><th class="r">Taille</th><th></th></tr></thead><tbody>${r.snapshots.map((s) => `<tr><td>${esc(fmtDate(s.createdAt, true))}</td><td><span class="chip">${esc(s.name.replace(/^snapshot-[\d-TZ]+-/, '').replace('.json', ''))}</span></td><td class="r num">${(s.size / 1024).toFixed(0)} Ko</td><td class="r"><button class="btn btn-sm" data-action="snapshot-restore" data-name="${esc(s.name)}">${esc(t('restore'))}</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('noData'))}</div>`;
    } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function viewAudit(el) {
    el.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(t('auditTitle'))}</h1></div></div><section class="panel"><div class="table-wrap" id="audit"><div class="empty">…</div></div></section></div>`;
    try {
      const r = await api('GET', '/api/audit');
      if (S.view !== 'audit') return;
      $('#audit').innerHTML = r.entries.length ? `<table class="tbl"><thead><tr><th>${esc(t('when'))}</th><th>${esc(t('who'))}</th><th>${esc(t('what'))}</th><th>Détail</th></tr></thead><tbody>${r.entries.map((a) => `<tr><td class="num"><small>${esc(new Date(a.at).toLocaleString(S.lang === 'ar' ? 'ar-DZ' : 'fr-DZ'))}</small></td><td>${esc(a.userName || '—')}</td><td><span class="chip ${/fail|disabled|delete|restore/.test(a.action) ? 'chip-yellow' : ''}">${esc(a.action)}</span></td><td><small>${esc(a.detail)}</small></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('noData'))}</div>`;
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  /* ---------------- lead actions ---------------- */
  function upsertLead(l) { const i = S.leads.findIndex((x) => x.id === l.id); if (i >= 0) S.leads[i] = l; else S.leads.unshift(l); }
  async function patch(l, body, { quiet } = {}) {
    try {
      const r = await api('PATCH', '/api/leads/' + l.id, body);
      upsertLead(r);
      if (!quiet) toast(t('saved'), 'ok');
      return r;
    } catch (e) { toast(errMsg(e), 'err'); throw e; }
  }
  async function changeStage(l, stage) {
    try {
      const r = await patch(l, { stage }, { quiet: true });
      if (stage === 'WON_EXPEDITEUR') { chime('won'); toast(r.storeName, 'ok', t('wonCongrats')); } else { chime(); toast(tv('stage', stage), '', t('stageChanged')); }
      renderContent(); if (S.openLeadId === l.id) renderDrawer();
    } catch {}
  }
  function assignOptions(cur) {
    const opts = [`<option value="${S.user.id}" ${cur === S.user.id ? 'selected' : ''}>${esc(t('me'))} (${esc(t('supervisor'))})</option>`];
    S.agencies.forEach((a) => {
      const agents = S.users.filter((u) => u.agencyId === a.id && u.active && u.role === 'agent');
      if (agents.length) opts.push(`<optgroup label="${esc(a.name)}${a.active ? '' : ' (' + esc(t('inactive')) + ')'}">${agents.map((u) => `<option value="${u.id}" ${u.id === cur ? 'selected' : ''} ${a.active ? '' : 'disabled'}>${esc(u.name)}</option>`).join('')}</optgroup>`);
    });
    S.users.filter((u) => u.role === 'supervisor' && u.id !== S.user.id && u.active).forEach((u) => opts.push(`<option value="${u.id}" ${u.id === cur ? 'selected' : ''}>${esc(u.name)}</option>`));
    return opts.join('');
  }

  /* ---------------- new lead ---------------- */
  function newLeadModal() {
    const m = openModal(`<form id="nl-form" novalidate>
      <div class="modal-h"><h2>${esc(t('newLeadTitle'))}</h2><button type="button" class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="form-error" id="nl-err" hidden></div>
        ${isSup() ? `<label class="field"><span>👑 ${esc(t('assignTo'))}</span><select class="select" id="nl-owner">${assignOptions(S.user.id)}</select></label>` : `<div class="chip chip-yellow" style="height:auto;padding:6px 10px">${ic('pin')} ${esc(S.agency ? S.agency.name : '')} — ${esc(S.user.name)}</div>`}
        <label class="field"><span>${esc(t('sourceUrl'))}</span><input class="input" id="nl-url" dir="ltr" placeholder="https://www.instagram.com/…" autofocus></label>
        <div class="grid-2"><label class="field"><span>${esc(t('platform'))}</span><select class="select" id="nl-platform">${C.PLATFORMS.map((p) => `<option value="${p}">${esc(tv('platform', p))}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(t('format'))}</span><select class="select" id="nl-type">${['Post', 'Reel / Video', 'Image / Ad', 'Story'].map((p) => `<option value="${p}">${esc(tv('postType', p))}</option>`).join('')}</select></label></div>
        <div class="grid-2"><label class="field"><span class="req">${esc(t('storeName'))}</span><input class="input" id="nl-store" dir="auto" placeholder="Karakou El Bahdja…"></label>
          <label class="field"><span>${esc(t('handle'))}</span><input class="input" id="nl-handle" dir="ltr" placeholder="@boutique"></label></div>
        <div class="grid-2"><label class="field"><span>${esc(t('category'))}</span><select class="select" id="nl-cat">${C.CATEGORIES.map((c) => `<option value="${c}">${esc(tv('category', c))}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(t('salesModel'))}</span><select class="select" id="nl-st">${C.STORE_TYPES.map((s) => `<option value="${s}">${esc(tv('storeType', s))}</option>`).join('')}</select></label></div>
        <div class="grid-2"><label class="field"><span>${esc(t('wilayaDispatch'))}</span><select class="select" id="nl-wilaya"><option value="">— ${esc(t('wilayaUnconfirmed'))}</option>${C.WILAYAS.map((w) => `<option value="${w.code}" ${!isSup() && S.agency && S.agency.wilayaCode === w.code ? 'selected' : ''}>${w.code} - ${esc(S.lang === 'ar' ? w.ar : w.fr)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(t('city'))}</span><input class="input" id="nl-city" placeholder="Bab Ezzouar, Akid Lotfi…"></label></div>
        <label class="check"><input type="checkbox" id="nl-wconf"><span>${esc(t('wilayaConfirmed'))}</span></label>
        <div class="grid-2"><label class="field"><span>${esc(t('phone'))}</span><input class="input" id="nl-phone" dir="ltr" inputmode="tel" placeholder="0550 12 34 56"><small class="err" id="nl-phone-err" hidden>${esc(t('invalidPhone'))}</small></label>
          <label class="field"><span>${esc(t('priority'))}</span><select class="select" id="nl-prio">${C.PRIORITIES.map((p) => `<option value="${p}" ${p === 'medium' ? 'selected' : ''}>${esc(tv('priority', p))}</option>`).join('')}</select></label></div>
        <label class="field"><span>${esc(t('caption'))}</span><textarea class="textarea" id="nl-caption" dir="auto" placeholder="Nouvel arrivage, livraison 58 wilayas…"></textarea></label>
        <label class="field"><span>${esc(t('imageUrl'))}</span><input class="input" id="nl-img" dir="ltr" placeholder="https://…"></label>
        <label class="field"><span>${esc(t('initialNote'))}</span><textarea class="textarea" id="nl-note" dir="auto" style="min-height:70px"></textarea></label>
      </div>
      <div class="modal-f"><button type="button" class="btn" data-close>${esc(t('cancel'))}</button><button class="btn btn-primary" type="submit">${esc(t('saveLead'))}</button></div></form>`, { size: 'lg' });
    $('#nl-url', m.el).addEventListener('input', (e) => {
      const v = e.target.value.trim();
      let mm;
      if ((mm = v.match(/instagram\.com\/([A-Za-z0-9._]+)/))) {
        $('#nl-platform', m.el).value = 'instagram';
        const isPost = /^(reel|reels|p|tv|stories|explore)$/.test(mm[1]);
        if (!isPost && !$('#nl-handle', m.el).value) $('#nl-handle', m.el).value = '@' + mm[1];
        if (/\/(reel|reels|tv)\//.test(v)) $('#nl-type', m.el).value = 'Reel / Video';
      }
      else if ((mm = v.match(/tiktok\.com\/@([A-Za-z0-9._]+)/))) { $('#nl-platform', m.el).value = 'tiktok'; $('#nl-type', m.el).value = 'Reel / Video'; if (!$('#nl-handle', m.el).value) $('#nl-handle', m.el).value = '@' + mm[1]; }
      else if ((mm = v.match(/facebook\.com\/([A-Za-z0-9.\-]+)/))) { $('#nl-platform', m.el).value = 'facebook'; if (!/^(ads|profile\.php|share|watch|groups)$/.test(mm[1]) && !$('#nl-handle', m.el).value) $('#nl-handle', m.el).value = mm[1]; }
    });
    $('#nl-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('#nl-phone', m.el).value.trim();
      const pOk = !phone || C.normalizePhone(phone);
      $('#nl-phone-err', m.el).hidden = !!pOk; $('#nl-phone', m.el).classList.toggle('invalid', !pOk);
      if (!pOk) return;
      const url = $('#nl-url', m.el).value.trim();
      const isProfile = url && !/\/(p|reel|posts|videos|ads)\/|\?id=|story/.test(url);
      const body = { platform: $('#nl-platform', m.el).value, postType: $('#nl-type', m.el).value, storeName: $('#nl-store', m.el).value, handle: $('#nl-handle', m.el).value,
        category: $('#nl-cat', m.el).value, storeType: $('#nl-st', m.el).value, wilayaCode: $('#nl-wilaya', m.el).value, wilayaConfirmed: $('#nl-wconf', m.el).checked,
        city: $('#nl-city', m.el).value, phonePrimary: phone, priority: $('#nl-prio', m.el).value, postCaption: $('#nl-caption', m.el).value,
        postImageUrl: $('#nl-img', m.el).value, initialNote: $('#nl-note', m.el).value, postUrl: isProfile ? '' : url, profileUrl: isProfile ? url : '' };
      if (isSup()) body.ownerId = $('#nl-owner', m.el).value;
      if (!body.storeName.trim()) { $('#nl-err', m.el).textContent = t('storeRequired'); $('#nl-err', m.el).hidden = false; $('#nl-store', m.el).focus(); return; }
      try {
        const r = await api('POST', '/api/leads', body);
        upsertLead(r); m.close(); chime(); toast(r.storeName, 'ok', t('leadCreated')); renderContent(); openLead(r.id);
      } catch (err) { $('#nl-err', m.el).textContent = errMsg(err); $('#nl-err', m.el).hidden = false; }
    });
  }

  /* ---------------- lead drawer ---------------- */
  let drawerRef = null;
  function openLead(id) {
    S.openLeadId = id; S.drawerTab = S.drawerTab || 'contact';
    const root = $('#modal-root');
    if (drawerRef) drawerRef.remove();
    drawerRef = document.createElement('div');
    drawerRef.className = 'overlay';
    drawerRef.innerHTML = '<aside class="drawer" role="dialog" aria-modal="true"></aside>';
    drawerRef.addEventListener('mousedown', (e) => { if (e.target === drawerRef) closeLead(); });
    root.appendChild(drawerRef);
    renderDrawer();
  }
  function closeLead() { if (drawerRef) drawerRef.remove(); drawerRef = null; S.openLeadId = null; renderContent(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerRef && $('#modal-root').lastElementChild === drawerRef) closeLead(); });

  function fieldInput(l, key, label, opts = {}) {
    const v = l[key] ?? '';
    const shown = opts.phone ? C.formatPhone(v) : v;
    return `<label class="field"><span>${esc(label)}</span><input class="input" data-field="${key}" ${opts.phone ? 'data-phone dir="ltr" inputmode="tel"' : ''} ${opts.ltr ? 'dir="ltr"' : 'dir="auto"'} type="${opts.type || 'text'}" value="${esc(shown)}" placeholder="${esc(opts.ph || '')}">${opts.phone ? `<small class="err" hidden>${esc(t('invalidPhone'))}</small>` : ''}</label>`;
  }
  function fieldSelect(l, key, label, options) {
    return `<label class="field"><span>${esc(label)}</span><select class="select" data-field="${key}">${options.map(([v, n]) => `<option value="${esc(v)}" ${String(l[key] ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  }
  function renderDrawer() {
    if (!drawerRef) return;
    const l = S.leads.find((x) => x.id === S.openLeadId);
    if (!l) { closeLead(); return; }
    const d = $('.drawer', drawerRef);
    const scroll = $('.drawer-b', d) ? $('.drawer-b', d).scrollTop : 0;
    const ag = agencyOf(l.agencyId);
    const interactions = l.notes.filter((n) => n.kind !== 'system').length;
    d.innerHTML = `
      <div class="drawer-h">
        <div class="drawer-title"><div style="min-width:0">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="plat plat-${esc(l.platform)}">${esc(tv('platform', l.platform))}</span><span style="color:var(--muted);font-size:12.5px" dir="auto">${esc(l.handle)}</span>
              ${isPrio(l) ? `<span class="chip chip-red">${ic('flame')}${esc(t('kpi_hot'))}</span>` : ''}${l.wilayaConfirmed ? `<span class="chip chip-green">${ic('pin')}${esc(wShort(l.wilayaCode))}</span>` : `<span class="chip chip-yellow">${ic('pin')}${esc(t('wilayaDispatch'))} ${esc(t('wilayaUnconfirmed'))}</span>`}</div>
            <h2 dir="auto">${esc(l.storeName)}</h2>
            <small style="color:var(--muted)">${esc(t('discovered'))} ${esc(fmtDate(l.discoveredAt))} · ${esc(t('updated'))} ${esc(fmtDate(l.updatedAt, true))}${ag ? ' · ' + esc(ag.name) : ''}</small></div>
          <div class="tools">
            ${l.phonePrimary ? `<button class="btn btn-sm btn-wa" data-action="pitch" data-id="${l.id}">${ic('wa')} <span class="hide-sm">WhatsApp</span></button><a class="btn btn-sm btn-icon" href="tel:${esc(l.phonePrimary)}" title="${esc(C.formatPhone(l.phonePrimary))}">${ic('phone')}</a>` : ''}
            <button class="btn btn-sm btn-icon btn-danger" data-action="delete-lead" data-id="${l.id}" title="${esc(t('deleteLead'))}">${ic('trash')}</button>
            <button class="btn btn-sm btn-icon" data-action="close-lead" title="${esc(t('close'))}">${ic('x')}</button></div></div>
        <div class="drawer-meta">
          ${isSup() ? `<label class="field"><span>${esc(t('hub'))}</span><select class="select" data-field="ownerId">${assignOptions(l.ownerId)}</select></label>` : `<label class="field"><span>${esc(t('hub'))}</span><input class="input" value="${esc(userName(l.ownerId))}" disabled></label>`}
          ${fieldSelect(l, 'stage', t('stage'), C.STAGE_IDS.map((s) => [s, tv('stage', s)]))}
          ${fieldSelect(l, 'priority', t('priority'), C.PRIORITIES.map((p) => [p, tv('priority', p)]))}
          <label class="field"><span>${esc(t('followUp'))}${isOverdue(l) ? ` <b style="color:var(--red)">· ${esc(t('overdue'))}</b>` : isDue(l) ? ` <b style="color:var(--yellow-ink)">· ${esc(t('today'))}</b>` : ''}</span><input class="input" type="date" data-field="nextFollowUpDate" value="${esc(l.nextFollowUpDate || '')}"></label>
        </div>
      </div>
      <div class="tabs" role="tablist">${[['contact', t('tab_contact')], ['needs', t('tab_needs')], ['post', t('tab_post')], ['journal', `${t('tab_journal')} (${interactions})`]].map(([k, n]) => `<button class="tab ${S.drawerTab === k ? 'on' : ''}" data-tab="${k}" role="tab">${esc(n)}</button>`).join('')}</div>
      <div class="drawer-b">${drawerTab(l)}</div>`;
    $('.drawer-b', d).scrollTop = scroll;
  }
  function drawerTab(l) {
    if (S.drawerTab === 'contact') return `
      <div class="section"><div class="section-t">${esc(t('modelLocation'))}</div>
        <div class="grid-2">${fieldSelect(l, 'storeType', t('salesModel'), C.STORE_TYPES.map((s) => [s, tv('storeType', s)]))}
          ${fieldSelect(l, 'wilayaCode', t('wilayaDispatch'), [['', '— ' + t('wilayaUnconfirmed')], ...C.WILAYAS.map((w) => [w.code, `${w.code} - ${S.lang === 'ar' ? w.ar : w.fr}`])])}</div>
        <label class="check"><input type="checkbox" data-field="wilayaConfirmed" ${l.wilayaConfirmed ? 'checked' : ''}><span>${esc(t('wilayaConfirmed'))}</span></label>
        <div class="grid-2">${fieldInput(l, 'city', t('city'), { ph: 'Sidi Yahia, Bab Ezzouar…' })}${fieldInput(l, 'neighborhood', t('neighborhood'))}</div>
        <div class="grid-2">${fieldInput(l, 'address', t('pickupAddress'))}
          <label class="field"><span>${esc(t('maps'))}</span><div class="input-link"><input class="input" data-field="googleMapsUrl" dir="ltr" value="${esc(l.googleMapsUrl)}" placeholder="https://maps.google.com/…">${l.googleMapsUrl ? `<a class="btn btn-icon" href="${esc(l.googleMapsUrl)}" target="_blank" rel="noopener noreferrer">${ic('ext')}</a>` : ''}</div></label></div></div>
      <div class="section"><div class="section-t">${esc(t('decisionMaker'))}</div>
        <div class="grid-2">${fieldInput(l, 'ownerName', t('ownerName'), { ph: 'Nom & prénom' })}${fieldInput(l, 'ownerRole', t('ownerRole'), { ph: 'Gérant, fondatrice…' })}</div>
        <div class="grid-2">${fieldInput(l, 'phonePrimary', t('phone'), { phone: true, ph: '+213 5 50 00 00 00' })}${fieldInput(l, 'phoneSecondary', t('phone2'), { phone: true, ph: '+213 21 00 00 00' })}</div>
        ${fieldInput(l, 'email', t('email'), { ltr: true, type: 'email', ph: 'contact@boutique.dz' })}</div>`;
    if (S.drawerTab === 'needs') return `
      <div class="section"><div class="section-t">${esc(t('volumePickup'))}</div>
        <div class="grid-2">${fieldSelect(l, 'estimatedVolume', t('volume'), C.VOLUMES.map((v) => [v, tv('volume', v)]))}${fieldInput(l, 'currentCourier', t('courier'), { ph: 'Yalidine, ZR Express, Maystro…' })}</div>
        <div class="grid-2">${fieldSelect(l, 'preferredPickupTime', t('pickupTime'), C.PICKUP_TIMES.map((v) => [v, tv('pickup', v)]))}
          <label class="check" style="align-self:end;padding-bottom:9px"><input type="checkbox" data-field="codRequired" ${l.codRequired ? 'checked' : ''}><span>${esc(t('cod'))}</span></label></div></div>
      <div class="section"><div class="section-t">${esc(t('painPoints'))}</div>
        ${C.PAIN_POINTS.map((p) => `<label class="check"><input type="checkbox" data-pain="${p}" ${(l.painPoints || []).includes(p) ? 'checked' : ''}><span>${esc(tv('pain', p))}</span></label>`).join('')}</div>`;
    if (S.drawerTab === 'post') return `
      <div class="section"><div class="section-t">${esc(t('originPost'))}${l.postUrl ? `<a class="btn btn-sm" href="${esc(l.postUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('openPost'))} ${ic('ext')}</a>` : ''}</div>
        ${l.postImageUrl ? `<img src="${esc(l.postImageUrl)}" alt="" referrerpolicy="no-referrer" style="max-height:260px;object-fit:contain;border-radius:8px;background:var(--grey-light)">` : ''}
        <label class="field"><span>${esc(t('caption'))}</span><textarea class="textarea" data-field="postCaption" dir="auto">${esc(l.postCaption)}</textarea></label>
        <div class="grid-2">${fieldSelect(l, 'category', t('category'), C.CATEGORIES.map((c) => [c, tv('category', c)]))}${fieldSelect(l, 'postType', t('format'), ['Post', 'Reel / Video', 'Image / Ad', 'Story'].map((p) => [p, tv('postType', p)]))}</div>
        <div class="grid-2">${fieldSelect(l, 'platform', t('platform'), C.PLATFORMS.map((p) => [p, tv('platform', p)]))}${fieldInput(l, 'handle', t('handle'), { ltr: true })}</div>
        ${fieldInput(l, 'storeName', t('storeName'))}
        <div class="grid-2">${fieldInput(l, 'postUrl', t('postUrl'), { ltr: true })}${fieldInput(l, 'profileUrl', t('profileUrl'), { ltr: true })}</div>
        ${fieldInput(l, 'postImageUrl', t('imageUrl'), { ltr: true })}</div>`;
    // journal
    const icFor = (n) => n.kind === 'system' ? 'cog' : ({ WhatsApp: 'wa', 'Phone Call': 'phone', 'Store Visit': 'pin', 'Internal Note': 'note' }[n.channel] || 'note');
    return `
      <form class="section" id="note-form" novalidate><div class="grid-3">
          ${`<label class="field"><span>${esc(t('channel'))}</span><select class="select" id="n-channel">${C.CHANNELS.map((c) => `<option value="${c}">${esc(tv('channel', c))}</option>`).join('')}</select></label>`}
          ${`<label class="field"><span>${esc(t('outcome'))}</span><select class="select" id="n-outcome">${C.OUTCOMES.map((o) => `<option value="${o}">${esc(tv('outcome', o))}</option>`).join('')}</select></label>`}
          <label class="field"><span>${esc(t('nextFollowUpOpt'))}</span><input class="input" type="date" id="n-follow" min="${S.today}"></label></div>
        <textarea class="textarea" id="n-content" dir="auto" placeholder="${esc(t('noteSummary'))}" style="min-height:76px"></textarea>
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" type="submit">${ic('check')} ${esc(t('addInteraction'))}</button></div></form>
      <div class="timeline">${l.notes.length ? l.notes.map((n) => `<div class="tl-item ${n.kind === 'system' ? 'sys' : 'int'}"><div class="tl-ico">${ic(icFor(n))}</div><div class="tl-body">
        <div class="tl-head"><b>${esc(n.authorName || t('system'))}</b>${n.kind !== 'system' ? `<span class="chip">${esc(tv('channel', n.channel))}</span>${n.outcome && n.outcome !== 'Note' ? `<span class="chip chip-yellow">${esc(tv('outcome', n.outcome))}</span>` : ''}` : ''}<span style="margin-inline-start:auto">${esc(fmtDate(n.createdAt, true))}</span></div>
        <p dir="auto">${esc(n.kind === 'system' ? sysText(n.content) : n.content)}</p></div></div>`).join('') : `<div class="empty">${esc(t('noNotes'))}</div>`}</div>`;
  }
  // Render system-note stage codes with human labels
  const sysText = (s) => String(s).replace(/\b(NEW_DISCOVERED|ENRICHED|CONTACTED|INTERESTED|MEETING_SCHEDULED|TRIAL_DELIVERY|WON_EXPEDITEUR|LOST)\b/g, (m) => tv('stage', m)).replace(/\b(high|medium|low)\b/g, (m) => tv('priority', m));

  // Field changes in the drawer → PATCH
  let fieldTimers = {};
  function onDrawerField(el) {
    const l = S.leads.find((x) => x.id === S.openLeadId); if (!l) return;
    if (el.dataset.pain) {
      const pains = $$('[data-pain]', drawerRef).filter((x) => x.checked).map((x) => x.dataset.pain);
      return patch(l, { painPoints: pains }, { quiet: true }).then(() => toast(t('saved'), 'ok'));
    }
    const key = el.dataset.field;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-phone')) {
      const n = value.trim() ? C.normalizePhone(value) : '';
      const bad = value.trim() && !n;
      el.classList.toggle('invalid', !!bad); const e = el.parentElement.querySelector('.err'); if (e) e.hidden = !bad;
      if (bad) return;
      value = n;
    }
    if (String(l[key] ?? '') === String(value)) return;
    clearTimeout(fieldTimers[key]);
    fieldTimers[key] = setTimeout(async () => {
      const prevStage = l.stage;
      try {
        await patch(l, { [key]: value }, { quiet: true });
        if (key === 'stage' && value !== prevStage) { if (value === 'WON_EXPEDITEUR') { chime('won'); toast(l.storeName, 'ok', t('wonCongrats')); } else toast(tv('stage', value), '', t('stageChanged')); }
        else if (key === 'ownerId') toast(userName(value), 'ok', t('reassigned'));
        else toast(t('saved'), 'ok');
        renderDrawer(); renderSidebarCounts();
      } catch { renderDrawer(); }
    }, el.tagName === 'INPUT' && el.type === 'text' ? 0 : 0);
  }

  /* ---------------- pitch ---------------- */
  const PITCHES = {
    fr: [
      { id: 'intro', name: 'Présentation SAME X DELIVERY (58 wilayas)', body: (n, c) => `Salam ${n} ! 👋\n\nJ'ai découvert votre page et vos produits, bravo pour votre travail. Je fais partie de l'équipe SAME X DELIVERY.\n\nCe que nous proposons aux e-commerçants :\n🚚 Livraison 58 wilayas, à domicile ou en stop-desk\n📍 Ramassage gratuit à votre boutique ou atelier${c ? ' à ' + c : ''}\n💰 Paiement à la livraison (COD) reversé rapidement par BaridiMob, CCP ou virement\n📱 Suivi et notifications pour vos clients\n\nÇa vous dirait de tester 2 ou 3 envois offerts pour comparer avec votre livreur actuel ?` },
      { id: 'cod', name: 'Reversement COD rapide', body: (n) => `Salam ${n} ! 🚚\n\nVotre argent de livraison reste bloqué trop longtemps ?\n\nChez SAME X DELIVERY, la trésorerie de nos expéditeurs passe en premier :\n✅ Reversement COD rapide (BaridiMob, CCP ou virement)\n✅ Ramassage sans minimum de colis\n✅ Appel du client avant chaque passage pour réduire les retours\n\nCombien de colis envoyez-vous en moyenne par jour ? Je vous prépare une offre adaptée.` },
      { id: 'visit', name: 'Visite commerciale en boutique', body: (n, c) => `Salam ${n} ! 😊\n\nUn commercial SAME X DELIVERY passe dans votre quartier${c ? ' à ' + c : ''} cette semaine.\n\nPouvons-nous venir 5 minutes vous présenter nos tarifs 58 wilayas et nos emballages ?\n\nQuel créneau vous arrange, aujourd'hui ou demain ?` },
      { id: 'trial', name: 'Offre d’essai : 3 colis offerts', body: (n) => `Bonjour ${n} ! 🎉\n\nPour découvrir la rapidité de SAME X DELIVERY, nous vous offrons 3 livraisons vers les wilayas de votre choix, sans engagement.\n\nVous avez des commandes prêtes aujourd'hui ? On peut envoyer un coursier pour le ramassage dès cet après-midi. 📦` },
    ],
    ar: [
      { id: 'intro', name: 'تقديم SAME X DELIVERY (58 ولاية)', body: (n, c) => `السلام عليكم ${n} 👋\n\nاطلعت على صفحتكم ومنتجاتكم، بالتوفيق. أنا من فريق SAME X DELIVERY.\n\nما نقدمه للتجار الإلكترونيين:\n🚚 توصيل إلى 58 ولاية، إلى المنزل أو المكتب\n📍 استلام مجاني من متجركم${c ? ' في ' + c : ''}\n💰 الدفع عند الاستلام مع تحويل سريع عبر بريدي موب أو CCP\n📱 متابعة وإشعارات لزبائنكم\n\nهل تودون تجربة 2 أو 3 طرود مجاناً للمقارنة مع شركتكم الحالية؟` },
      { id: 'cod', name: 'تحويل سريع لأموال الدفع عند الاستلام', body: (n) => `السلام عليكم ${n} 🚚\n\nهل تبقى أموال التوصيل محجوزة لمدة طويلة؟\n\nفي SAME X DELIVERY سيولة المرسلين أولويتنا:\n✅ تحويل سريع عبر بريدي موب أو CCP\n✅ استلام بدون حد أدنى للطرود\n✅ الاتصال بالزبون قبل كل توصيل لتقليل المرتجعات\n\nكم طرداً ترسلون يومياً في المتوسط؟ نحضر لكم عرضاً مناسباً.` },
      { id: 'visit', name: 'زيارة تجارية للمتجر', body: (n, c) => `السلام عليكم ${n} 😊\n\nممثل SAME X DELIVERY سيكون في حيكم${c ? ' في ' + c : ''} هذا الأسبوع.\n\nهل يمكننا المرور 5 دقائق لتقديم أسعارنا نحو 58 ولاية؟\n\nما الوقت المناسب لكم اليوم أو غداً؟` },
      { id: 'trial', name: 'عرض تجريبي: 3 طرود مجانية', body: (n) => `مرحباً ${n} 🎉\n\nلتجربة سرعة SAME X DELIVERY نقدم لكم 3 طرود مجانية نحو الولايات التي تختارونها، بدون التزام.\n\nهل لديكم طلبيات جاهزة اليوم؟ نرسل موزعاً للاستلام بعد الظهر. 📦` },
    ],
  };
  function pitchModal(l) {
    const list = PITCHES[S.lang] || PITCHES.fr;
    const name = l.ownerName || l.storeName;
    const city = l.city || wShort(l.wilayaCode);
    const m = openModal(`
      <div class="modal-h"><h2>${esc(t('pitchTitle'))}</h2><button class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b dir="auto">${esc(l.storeName)}</b>${l.phonePrimary ? `<span class="chip chip-green num" dir="ltr">${esc(C.formatPhone(l.phonePrimary))}</span>` : `<span class="chip chip-red">${esc(t('phoneRequired'))}</span>`}</div>
        <label class="field"><span>${esc(t('template'))}</span><select class="select" id="p-tpl">${list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('message'))}</span><textarea class="textarea pitch-box" id="p-msg" dir="auto"></textarea></label>
      </div>
      <div class="modal-f"><button class="btn" id="p-copy">${esc(t('copy'))}</button>${l.phonePrimary ? `<a class="btn btn-primary" id="p-wa" target="_blank" rel="noopener noreferrer">${ic('wa')} ${esc(t('openWhatsapp'))}</a>` : ''}</div>`, { size: 'lg' });
    const msg = $('#p-msg', m.el);
    const fill = () => { const tpl = list.find((p) => p.id === $('#p-tpl', m.el).value); msg.value = tpl.body(name, city); syncWa(); };
    const syncWa = () => { const a = $('#p-wa', m.el); if (a) a.href = `https://wa.me/${l.phonePrimary.replace('+', '')}?text=${encodeURIComponent(msg.value)}`; };
    $('#p-tpl', m.el).addEventListener('change', fill); msg.addEventListener('input', syncWa); fill();
    $('#p-copy', m.el).addEventListener('click', () => {
      const done = () => toast(t('copied'), 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg.value).then(done, () => { msg.select(); toast(t('copyFallback')); });
      else { msg.select(); try { document.execCommand('copy') ? done() : toast(t('copyFallback')); } catch { toast(t('copyFallback')); } }
    });
    const wa = $('#p-wa', m.el);
    if (wa) wa.addEventListener('click', async () => {
      const tplName = $('#p-tpl', m.el).selectedOptions[0].textContent;
      try {
        const r = await api('POST', `/api/leads/${l.id}/notes`, { channel: 'WhatsApp', outcome: 'Note', content: `Pitch WhatsApp envoyé : « ${tplName} »` });
        upsertLead(r); renderContent(); if (S.openLeadId === l.id) renderDrawer();
      } catch {}
    });
  }

  /* ---------------- import / export / password ---------------- */
  function exportFile(format) { window.location.href = `/api/export?format=${format}&${filterQuery()}`; }
  function importModal() {
    const m = openModal(`<div class="modal-h"><h2>${esc(t('importTitle'))}</h2><button class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b"><p class="hint" style="margin:0;line-height:1.5">${esc(t('importText'))}</p>
        <div class="form-error" id="im-err" hidden></div>
        <label class="field"><span>${esc(t('chooseFile'))}</span><input class="input" type="file" id="im-file" accept=".csv,.json,text/csv,application/json" style="padding-top:7px"></label>
        ${isSup() ? `<label class="field"><span>${esc(t('importTarget'))}</span><select class="select" id="im-owner">${assignOptions(S.user.id)}</select></label>` : ''}
        <label class="check"><input type="checkbox" id="im-dup" checked><span>${esc(t('skipDup'))}</span></label>
        ${isSup() ? `<p class="hint" style="margin:0;line-height:1.5;background:var(--grey-light);padding:10px;border-radius:8px">${esc(t('legacyHelp'))}</p>` : ''}
      </div>
      <div class="modal-f"><button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn btn-primary" id="im-go">${ic('up')} ${esc(t('import'))}</button></div>`);
    $('#im-go', m.el).addEventListener('click', async () => {
      const f = $('#im-file', m.el).files[0];
      const err = $('#im-err', m.el); err.hidden = true;
      if (!f) { err.textContent = t('chooseFile'); err.hidden = false; return; }
      const text = await f.text();
      let body;
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') body = { csv: text };
      else { try { const j = JSON.parse(text); body = { records: Array.isArray(j) ? j : j.leads ? j.leads : j }; } catch { err.textContent = t('err_invalid_json'); err.hidden = false; return; } }
      body.skipDuplicates = $('#im-dup', m.el).checked;
      if (isSup()) body.ownerId = $('#im-owner', m.el).value;
      const btn = $('#im-go', m.el); btn.disabled = true;
      try {
        const r = await api('POST', '/api/import', body);
        m.close(); toast(t('importResult', { c: r.created, s: r.skipped, i: r.invalid }), 'ok', t('importDone'));
        await refreshLeads(true); renderContent();
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; btn.disabled = false; }
    });
  }
  function passwordModal() {
    const m = openModal(`<form id="pw-form" novalidate><div class="modal-h"><h2>${esc(t('changePassword'))}</h2><button type="button" class="btn btn-ghost btn-icon" data-close>${ic('x')}</button></div>
      <div class="modal-b"><div class="form-error" id="pw-err" hidden></div>
        <label class="field"><span>${esc(t('currentPassword'))}</span><input class="input" type="password" id="pw-cur" autocomplete="current-password" autofocus></label>
        <label class="field"><span>${esc(t('newPassword'))}</span><input class="input" type="password" id="pw-new" autocomplete="new-password"><small class="hint">${esc(t('pwRule'))}</small></label></div>
      <div class="modal-f"><button type="button" class="btn" data-close>${esc(t('cancel'))}</button><button class="btn btn-primary" type="submit">${esc(t('save'))}</button></div></form>`, { size: 'sm' });
    $('#pw-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/me/password', { currentPassword: $('#pw-cur', m.el).value, newPassword: $('#pw-new', m.el).value }); m.close(); toast(t('saved'), 'ok'); }
      catch (err) { $('#pw-err', m.el).textContent = errMsg(err); $('#pw-err', m.el).hidden = false; }
    });
  }
  async function restoreData(data, mode) {
    const r = await api('POST', '/api/restore', { data, mode });
    toast(t('restoreDone'), 'ok');
    if (r.loggedOut) { S.user = null; renderLogin(); } else { await loadAll(); renderShell(); }
  }

  /* ---------------- global events ---------------- */
  let searchTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id === 'search') {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => { S.filters.search = v; S.page = 1; renderContent(); }, 160);
    }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.filter) {
      S.filters[el.dataset.filter] = el.value; S.page = 1;
      if (el.dataset.filter === 'agencyId') S.filters.ownerId = 'ALL';
      $$('#filters').forEach((f) => (f.innerHTML = filterSelects()));
      renderContent(); return;
    }
    if (drawerRef && drawerRef.contains(el) && (el.dataset.field || el.dataset.pain)) return onDrawerField(el);
    if (el.dataset.stageSelect) { const l = S.leads.find((x) => x.id === el.dataset.stageSelect); if (l) changeStage(l, el.value); return; }
    if (el.dataset.select) { el.checked ? S.selected.add(el.dataset.select) : S.selected.delete(el.dataset.select); renderContent(); return; }
    if (el.dataset.action === 'select-page') {
      const leads = sortLeads(filtered()).slice((S.page - 1) * S.pageSize, S.page * S.pageSize);
      leads.forEach((l) => (el.checked ? S.selected.add(l.id) : S.selected.delete(l.id))); renderContent(); return;
    }
    if (el.dataset.bulk && el.value) {
      const field = el.dataset.bulk, value = el.value;
      try { const r = await api('POST', '/api/leads/bulk', { ids: [...S.selected], [field]: value }); toast(`${r.updated} ✓`, 'ok'); S.selected.clear(); await refreshLeads(true); renderContent(); }
      catch (err) { toast(errMsg(err), 'err'); }
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'note-form') return;
    e.preventDefault();
    const l = S.leads.find((x) => x.id === S.openLeadId); if (!l) return;
    const content = $('#n-content').value.trim();
    if (!content) { $('#n-content').classList.add('invalid'); toast(t('err_note_required'), 'err'); return; }
    const body = { channel: $('#n-channel').value, outcome: $('#n-outcome').value, content };
    if ($('#n-follow').value) body.nextFollowUpDate = $('#n-follow').value;
    try {
      const before = l.stage;
      const r = await api('POST', `/api/leads/${l.id}/notes`, body);
      upsertLead(r); toast(t('interactionSaved'), 'ok');
      if (r.stage !== before) { if (r.stage === 'WON_EXPEDITEUR') chime('won'); toast(tv('stage', r.stage), '', t('stageChanged')); } else chime();
      renderDrawer(); renderSidebarCounts();
    } catch (err) { toast(errMsg(err), 'err'); }
  });
  document.addEventListener('dragstart', (e) => { if (!e.target.closest || !e.target.closest('.card')) return; });

  document.addEventListener('click', async (e) => {
    const stop = e.target.closest('[data-stop]'); if (stop) { e.stopPropagation(); return; }
    const navEl = e.target.closest('[data-nav]');
    if (navEl) { e.preventDefault(); closeAllModalsSoft(); setView(navEl.dataset.nav); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { S.drawerTab = tab.dataset.tab; renderDrawer(); return; }
    const st = e.target.closest('[data-stage-tab]'); if (st) { S.stageTab = st.dataset.stageTab; renderContent(); return; }
    const sortEl = e.target.closest('[data-sort]'); if (sortEl) { const k = sortEl.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; renderContent(); return; }
    const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { S.page = +pg.dataset.page; renderContent(); $('#content').scrollTop = 0; return; }
    const qf = e.target.closest('[data-qf]');
    if (qf) { const k = qf.dataset.qf; const v = qf.dataset.val === 'true' ? true : qf.dataset.val; S.filters[k] = S.filters[k] === v ? DEFAULT_FILTERS[k] : v; S.page = 1; renderContent(); return; }
    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action, id = act.dataset.id, lead = id && S.leads.find((x) => x.id === id);
      if (a === 'select-page' || act.tagName === 'SELECT') return;
      e.stopPropagation();
      switch (a) {
        case 'new-lead': S.sidebarOpen = false; $('#sidebar') && $('#sidebar').classList.remove('open'); $('.sb-backdrop') && $('.sb-backdrop').remove(); return newLeadModal();
        case 'lang': S.lang = S.lang === 'fr' ? 'ar' : 'fr'; store.set('lang', S.lang); applyLang(); if (S.user) { const open = S.openLeadId; renderShell(); if (open) openLead(open); } else if (S.authMode === 'setup') renderSetup(); else renderLogin(); return;
        case 'sound': S.sound = !S.sound; store.set('sound', S.sound); act.innerHTML = ic(S.sound ? 'sound' : 'mute'); act.setAttribute('aria-pressed', S.sound); if (S.sound) chime(); return;
        case 'logout': try { await api('POST', '/api/logout'); } catch {} S.user = null; clearInterval(pollTimer); closeAllModals(); toast(S.lang === 'ar' ? 'تم تسجيل الخروج.' : 'Vous êtes déconnecté.'); return renderLogin();
        case 'password': return passwordModal();
        case 'open-sidebar': S.sidebarOpen = true; return renderShellKeep();
        case 'close-sidebar': S.sidebarOpen = false; return renderShellKeep();
        case 'reset-filters': S.filters = { ...DEFAULT_FILTERS }; S.page = 1; return renderShell();
        case 'toggle-due': S.filters.due = !S.filters.due; S.page = 1; return renderContent();
        case 'filter-hot': S.filters.hot = true; return setView('table');
        case 'goto-stage': S.stageTab = act.dataset.stage; return setView('pipeline');
        case 'goto-table-stage': S.filters.stage = act.dataset.stage; return setView('table');
        case 'export': return exportFile(act.dataset.format);
        case 'import': return importModal();
        case 'pitch': if (lead) pitchModal(lead); return;
        case 'move': if (lead) { const i = C.STAGE_IDS.indexOf(lead.stage) + Number(act.dataset.dir); if (i >= 0 && i < C.STAGE_IDS.length) changeStage(lead, C.STAGE_IDS[i]); } return;
        case 'close-lead': return closeLead();
        case 'delete-lead':
          if (lead && await confirmDialog(t('deleteLeadQ'), { danger: true, confirmText: t('delete'), detail: `${lead.storeName} ${lead.handle ? '(' + lead.handle + ')' : ''}` })) {
            try { await api('DELETE', '/api/leads/' + lead.id); S.leads = S.leads.filter((x) => x.id !== lead.id); closeLead(); toast(lead.storeName, 'ok', t('delete')); } catch (err) { toast(errMsg(err), 'err'); }
          }
          return;
        case 'snooze': if (lead) { await patch(lead, { nextFollowUpDate: addDays(S.today, Number(act.dataset.days || 2)) }); renderContent(); } return;
        case 'log-done': if (lead) { S.drawerTab = 'journal'; openLead(lead.id); setTimeout(() => $('#n-content') && $('#n-content').focus(), 50); } return;
        case 'bulk-clear': S.selected.clear(); return renderContent();
        case 'bulk-delete':
          if (await confirmDialog(t('deleteLeadQ'), { danger: true, confirmText: t('delete'), detail: `${S.selected.size} ${t('selected')}` })) {
            try { const r = await api('POST', '/api/leads/bulk', { ids: [...S.selected], action: 'delete' }); toast(`${r.updated} ✓`, 'ok'); S.selected.clear(); await refreshLeads(true); renderContent(); } catch (err) { toast(errMsg(err), 'err'); }
          }
          return;
        case 'agency-form': return agencyForm(S.agencies.find((x) => x.id === id));
        case 'agency-filter': S.filters = { ...DEFAULT_FILTERS, agencyId: id }; return setView('pipeline');
        case 'agency-toggle': {
          const ag = S.agencies.find((x) => x.id === id); if (!ag) return;
          if (ag.active && !(await confirmDialog(t('deactivateAgencyQ'), { danger: true, confirmText: t('deactivate'), detail: ag.name }))) return;
          try { Object.assign(ag, await api('PATCH', '/api/agencies/' + id, { active: !ag.active })); toast(t('saved'), 'ok'); renderContent(); } catch (err) { toast(errMsg(err), 'err'); }
          return;
        }
        case 'user-form': return userForm(S.users.find((x) => x.id === id));
        case 'user-toggle': {
          const u = S.users.find((x) => x.id === id); if (!u) return;
          if (u.active && !(await confirmDialog(t('deactivateUserQ'), { danger: true, confirmText: t('deactivate'), detail: u.name }))) return;
          try { Object.assign(u, await api('PATCH', '/api/users/' + id, { active: !u.active })); toast(t('saved'), 'ok'); renderContent(); } catch (err) { toast(errMsg(err), 'err'); }
          return;
        }
        case 'snapshot': try { await api('POST', '/api/backups'); toast(t('saved'), 'ok'); renderContent(); } catch (err) { toast(errMsg(err), 'err'); } return;
        case 'snapshot-restore':
          if (await confirmDialog(t('restoreQ'), { confirmText: t('restore'), detail: act.dataset.name })) {
            try { const r = await api('POST', `/api/backups/${encodeURIComponent(act.dataset.name)}/restore`, { mode: 'replace' }); toast(t('restoreDone'), 'ok'); if (r.loggedOut) { S.user = null; renderLogin(); } } catch (err) { toast(errMsg(err), 'err'); }
          }
          return;
        case 'restore-file': {
          const f = $('#restore-file') && $('#restore-file').files[0];
          if (!f) { toast(t('chooseFile'), 'err'); return; }
          let data; try { data = JSON.parse(await f.text()); } catch { toast(t('err_invalid_json'), 'err'); return; }
          const mode = ($('input[name=rmode]:checked') || {}).value || 'replace';
          if (await confirmDialog(t('restoreQ'), { confirmText: t('restore'), detail: `${f.name} · ${mode === 'merge' ? t('merge') : t('replace')}` })) {
            try { await restoreData(data, mode); } catch (err) { toast(errMsg(err), 'err'); }
          }
          return;
        }
      }
    }
    const openEl = e.target.closest('[data-open]');
    if (openEl && !e.target.closest('input,select,a,button:not([data-open])')) { openLead(openEl.dataset.open); return; }
    const card = e.target.closest('.card[data-lead]');
    if (card && !e.target.closest('button,a')) { openLead(card.dataset.lead); return; }
  });
  function closeAllModalsSoft() { if (drawerRef) { drawerRef.remove(); drawerRef = null; S.openLeadId = null; } }
  function renderShellKeep() { const sb = $('#sidebar'); if (!sb) return; sb.classList.toggle('open', S.sidebarOpen); const bd = $('.sb-backdrop'); if (S.sidebarOpen && !bd) { const d = document.createElement('div'); d.className = 'sb-backdrop'; d.dataset.action = 'close-sidebar'; sb.after(d); } else if (!S.sidebarOpen && bd) bd.remove(); }
  window.addEventListener('hashchange', () => { const v = location.hash.replace('#', ''); if (S.user && v && v !== S.view) setView(v); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user) refreshLeads(true); });

  boot();
})();
