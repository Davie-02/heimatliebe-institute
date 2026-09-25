/**
 * Portal shell shared by every role: sign-in check, sidebar navigation, top bar (search,
 * notifications, theme), realtime updates and a few pages every portal has (profile,
 * notifications, apps).
 *
 * A portal file only describes its menu and pages:
 *
 *   startPortal({ roles: ['teacher'], nav: [{ icon: 'grid', label: 'Dashboard', page: 'dashboard' }, …],
 *                 pages: { dashboard: async content => { content.innerHTML = '…' } } });
 */
(function (global, doc) {
  'use strict';

  const SESSION_KEY = 'hmli_user';
  const PORTAL_OF = { student: '/student/', teacher: '/teacher/', accounts: '/accounts/', hr: '/hr/',
    director: '/director/', admin: '/admin/', superadmin: '/admin/' };
  const STAFF_ROLES = ['teacher', 'accounts', 'hr', 'director', 'admin', 'superadmin'];

  /* ── Session (the server is the source of truth; this only caches the profile) ── */
  const session = {
    get() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } },
    set(user) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); return user; },
    clear() { sessionStorage.removeItem(SESSION_KEY); },
  };
  const portalFor = role => PORTAL_OF[role] || '/student/';

  function toLogin() {
    session.clear();
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  }
  api.setUnauthorizedHandler(toLogin);

  async function logout() {
    try { await api.post('/api/logout'); } catch (e) { /* already signed out */ }
    session.clear();
    location.href = '/login.html';
  }

  function changePassword(forced) {
    const body = openModal(forced ? 'Choose a new password' : 'Change password', `
      ${forced ? alertBox('warning', 'You signed in with a temporary password. Please choose your own to continue.') : ''}
      <form id="pw-form">
        <div class="form-group"><label class="form-label" for="pw-old">Current password</label><input class="form-input" id="pw-old" type="password" name="old" required autocomplete="current-password"></div>
        <div class="form-group"><label class="form-label" for="pw-new">New password (at least 8 characters)</label><input class="form-input" id="pw-new" type="password" name="new" minlength="8" required autocomplete="new-password"></div>
        <div class="form-group"><label class="form-label" for="pw-confirm">Repeat new password</label><input class="form-input" id="pw-confirm" type="password" name="confirm" minlength="8" required autocomplete="new-password"></div>
        <button class="btn btn-primary" type="submit">Update password</button>
      </form>`, { locked: forced });
    body.querySelector('#pw-form').onsubmit = e => {
      e.preventDefault();
      const f = e.target;
      if (f.new.value !== f.confirm.value) return toast('The new passwords do not match.', true);
      run(e.submitter, async () => {
        await api.post('/api/change-password', { old_password: f.old.value, new_password: f.new.value });
        const user = session.get();
        if (user) session.set(Object.assign(user, { must_change_password: false }));
        closeModal(true);
        toast('Password updated');
      });
    };
  }

  /* ── Realtime (WebSocket with automatic reconnect and back-off) ─────── */
  const listeners = {};
  function onEvent(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  function emit(name, data) { (listeners[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
  let socket, attempts = 0, pingTimer;
  function connect() {
    if (!('WebSocket' in global)) return;
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    socket.onopen = () => {
      attempts = 0;
      setLive(true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => socket.readyState === 1 && socket.send('ping'), 25000);
    };
    socket.onmessage = e => { try { const msg = JSON.parse(e.data); if (msg.event !== 'pong') emit(msg.event, msg.data); } catch (err) { /* ignore */ } };
    socket.onclose = e => {
      setLive(false);
      clearInterval(pingTimer);
      if (e.code === 4401) return; // signed out
      setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, attempts++)));
    };
  }
  function setLive(on) {
    const el = doc.getElementById('live');
    if (el) { el.classList.toggle('on', on); el.title = on ? 'Live updates on' : 'Reconnecting…'; }
  }

  /* ── Layout ────────────────────────────────────────────────────────── */
  function shell(user, nav) {
    let menu = '', section = '';
    nav.forEach(item => {
      if (item.section && item.section !== section) { section = item.section; menu += `<div class="nav-section">${esc(section)}</div>`; }
      menu += `<a class="nav-link" href="?page=${item.page}" data-page="${item.page}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
    });
    const role = user.role === 'superadmin' ? 'Admin' : user.role.charAt(0).toUpperCase() + user.role.slice(1);
    const avatar = user.photo_url ? `<img src="${esc(user.photo_url)}" alt="">` : esc((user.full_name || '?').trim().charAt(0));
    const staff = STAFF_ROLES.includes(user.role);
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar" aria-label="Main menu">
        <a class="sidebar-brand" href="/"><img src="/img/mark.png" alt="" width="40" height="40">
          <div class="brand-name">Heimatliebe<span>${esc(role)} portal</span></div></a>
        <nav class="sidebar-nav">${menu}</nav>
        <div class="sidebar-user"><div class="avatar">${avatar}</div>
          <div><div class="su-name">${esc(user.full_name)}</div><div class="su-id">${esc(user.user_id)}</div></div></div>
      </aside>
      <div class="scrim" data-action="closeMenu"></div>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-btn" data-action="toggleMenu" aria-label="Open menu">${icon('menu')}</button>
          <div class="topbar-title" id="page-title"></div>
          <div class="topbar-spacer"></div>
          ${staff ? `<div class="gsearch"><input class="form-input search-input" id="gsearch" type="search" placeholder="Search people, classes…" autocomplete="off" aria-label="Search">
            <div class="dropdown" id="gsearch-results" hidden></div></div>` : ''}
          <span class="live" id="live" title="Connecting…"></span>
          <div style="position:relative">
            <button class="btn btn-ghost btn-icon bell" data-action="toggleBell" aria-label="Notifications">${icon('bell')}<span class="bell-count" id="bell-count" hidden></span></button>
            <div class="dropdown" id="bell-panel" hidden></div>
          </div>
          <button class="btn btn-ghost btn-icon hide-sm" data-action="toggleTheme" aria-label="Switch light/dark theme">${icon('moon')}</button>
          <button class="btn btn-ghost btn-icon hide-sm" data-action="changePassword" aria-label="Change password">${icon('key')}</button>
          <button class="btn btn-ghost btn-icon" data-action="logout" aria-label="Sign out" title="Sign out">${icon('log-out')}</button>
        </header>
        <main class="content" id="content" tabindex="-1"></main>
      </div>
    </div>
    <div class="offline-bar">${icon('wifi-off')} You're offline — some information may be out of date</div>`;
  }

  /* ── Navigation between pages (no full reloads) ────────────────────── */
  let pages = {};
  const currentPage = () => new URLSearchParams(location.search).get('page') || 'dashboard';

  function go(page, { push = true, params = {} } = {}) {
    if (!pages[page]) page = 'dashboard';
    if (push) {
      const url = new URL(location.href);
      url.search = '';
      url.searchParams.set('page', page);
      Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
      history.pushState({ page }, '', url);
    }
    doc.querySelectorAll('.nav-link').forEach(a => {
      const active = a.dataset.page === page;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const link = doc.querySelector(`.nav-link[data-page="${page}"] span`);
    const title = link ? link.textContent : 'Dashboard';
    doc.getElementById('page-title').textContent = title;
    doc.title = `${title} · Heimatliebe Institute`;
    doc.getElementById('sidebar').classList.remove('open');
    const content = doc.getElementById('content');
    content.innerHTML = skeleton(180);
    content.classList.remove('page-enter');
    Promise.resolve()
      .then(() => pages[page](content, new URLSearchParams(location.search)))
      .then(() => { content.classList.add('page-enter'); })
      .catch(err => { content.innerHTML = alertBox('error', esc(err.message || String(err))); });
    global.scrollTo(0, 0);
  }
  const refresh = () => go(currentPage(), { push: false });

  /* ── Unread counters, notifications panel, global search ───────────── */
  async function refreshCounts() {
    try {
      const unread = await api.get('/api/unread');
      const bell = doc.getElementById('bell-count');
      bell.hidden = !unread.notifications;
      bell.textContent = unread.notifications > 99 ? '99+' : unread.notifications;
      [['messages', unread.messages], ['notifications', unread.notifications]].forEach(([page, n]) => {
        const link = doc.querySelector(`.nav-link[data-page="${page}"]`);
        if (!link) return;
        let count = link.querySelector('.count');
        if (n > 0) {
          if (!count) { count = doc.createElement('span'); count.className = 'count'; link.appendChild(count); }
          count.textContent = n > 99 ? '99+' : n;
        } else if (count) count.remove();
      });
    } catch (e) { /* offline — keep the last numbers */ }
  }

  async function toggleBell() {
    const panel = doc.getElementById('bell-panel');
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = skeleton(80);
    const items = await api.rows('notifications', { order: 'created_at.desc', limit: 12 }).catch(() => []);
    panel.innerHTML = `<div class="dd-head"><strong>Notifications</strong>${button('Mark all read', { action: 'markAllRead', cls: 'btn-ghost btn-sm' })}</div>` +
      (items.length ? items.map(n => `<a class="dd-item${n.read ? '' : ' unread'}" href="${esc(n.link || '#')}" data-note="${n.id}">
        <div><div class="li-title">${esc(n.title)}</div><div class="li-meta">${esc(n.body || '')}</div><div class="li-meta">${timeAgo(n.created_at)}</div></div></a>`).join('')
        : `<div class="empty">${icon('bell')}<p>You're all caught up.</p></div>`);
    panel.querySelectorAll('[data-note]').forEach(a => a.addEventListener('click', () => api.update('notifications', a.dataset.note, { read: true }).catch(() => {})));
  }

  function setupSearch() {
    const input = doc.getElementById('gsearch');
    if (!input) return;
    const box = doc.getElementById('gsearch-results');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        const { results } = await api.get('/api/search', { q }).catch(() => ({ results: [] }));
        box.innerHTML = results.length ? results.map(r => `<button class="dd-item" data-kind="${r.type}" data-id="${r.id}">
          <span class="dd-kind">${esc(r.type)}</span><span><strong>${esc(r.title)}</strong><br><small class="text-muted">${esc(r.subtitle || '')}</small></span></button>`).join('')
          : '<div class="empty"><p>No matches</p></div>';
        box.hidden = false;
        box.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
          box.hidden = true; input.value = '';
          emit('search:open', { type: b.dataset.kind, id: b.dataset.id });
        }));
      }, 250);
    });
  }

  function applyTheme(theme) {
    doc.documentElement.setAttribute('data-theme', theme);
    const btn = doc.querySelector('[data-action="toggleTheme"]');
    if (btn) btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  }

  let idleTimer, idleWarning;
  function signOutWhenIdle(minutes) {
    const ms = minutes * 60000;
    const reset = () => {
      clearTimeout(idleTimer); clearTimeout(idleWarning);
      idleWarning = setTimeout(() => toast('You will be signed out in one minute because of inactivity.'), ms - 60000);
      idleTimer = setTimeout(logout, ms);
    };
    ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => doc.addEventListener(ev, reset, { passive: true }));
    reset();
  }

  actions({
    toggleMenu: () => doc.getElementById('sidebar').classList.toggle('open'),
    closeMenu: () => doc.getElementById('sidebar').classList.remove('open'),
    toggleBell,
    markAllRead: async () => { await api.post('/api/notifications/mark-all-read'); doc.getElementById('bell-panel').hidden = true; refreshCounts(); },
    toggleTheme: () => {
      const theme = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', theme); } catch (e) { /* private mode */ }
      applyTheme(theme);
    },
    changePassword: () => changePassword(false),
    logout,
    go: el => go(el.dataset.page),
  });

  /* ── Start a portal ────────────────────────────────────────────────── */
  function startPortal({ roles, nav, pages: portalPages }) {
    const cached = session.get();
    const allowed = user => !roles || roles.includes(user.role) || user.role === 'superadmin';
    if (!cached) return toLogin();
    if (!allowed(cached)) { location.href = portalFor(cached.role); return; }
    pages = portalPages;

    let theme = 'light';
    try { theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* ignore */ }
    doc.body.innerHTML = shell(cached, nav);
    applyTheme(theme);

    doc.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.page); }));
    doc.addEventListener('click', e => {
      const stat = e.target.closest('.stat[data-page]');
      if (stat) go(stat.dataset.page);
      const panel = doc.getElementById('bell-panel');
      if (panel && !panel.hidden && !e.target.closest('#bell-panel, [data-action="toggleBell"]')) panel.hidden = true;
      const results = doc.getElementById('gsearch-results');
      if (results && !e.target.closest('.gsearch')) results.hidden = true;
    });
    global.addEventListener('popstate', () => go(currentPage(), { push: false }));
    const online = () => doc.body.classList.toggle('offline', !navigator.onLine);
    global.addEventListener('online', online); global.addEventListener('offline', online);

    setupSearch();
    go(currentPage(), { push: false });
    refreshCounts();
    connect();
    onEvent('notification', n => { toast(n.body ? `${n.title} — ${n.body}` : n.title); refreshCounts(); });
    onEvent('message', m => { toast(`${m.from}: ${m.body}`); refreshCounts(); });
    onEvent('announcement', a => toast(`Announcement: ${a.title}`));
    signOutWhenIdle(cached.role === 'student' ? 60 : 30);

    // Confirm the session with the server (it may have expired or the role may have changed).
    api.get('/api/me').then(({ user }) => {
      session.set(user);
      if (!allowed(user)) location.href = portalFor(user.role);
      else if (user.must_change_password) changePassword(true);
    }).catch(() => {});
    registerServiceWorker();
  }

  function registerServiceWorker() {
    // Service workers need HTTPS (localhost is allowed for development).
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  /* ── Pages shared by every portal ──────────────────────────────────── */
  const pageHead = (title, actionsHtml = '', subtitle = '') =>
    `<div class="page-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p class="text-muted text-sm">${subtitle}</p>` : ''}</div><div class="flex gap-sm flex-wrap">${actionsHtml}</div></div>`;

  function profilePage() {
    return async content => {
      const { user } = await api.get('/api/me');
      session.set(user);
      const row = (label, value) => `<div class="detail-row"><div class="detail-label">${esc(label)}</div><div class="detail-value">${value}</div></div>`;
      const avatar = user.photo_url ? `<img src="${esc(user.photo_url)}" alt="">` : esc((user.full_name || '?').charAt(0));
      const cal = await api.get('/api/calendar/link').catch(() => null);
      content.innerHTML = pageHead('My profile') + `<div class="grid-2">
        <div class="card"><div class="card-body">
          <div class="flex items-center gap-md mb-md"><div class="avatar avatar-lg">${avatar}</div>
            <div><h3>${esc(user.full_name)}</h3><div class="td-id">${esc(user.user_id)}</div>${badge('active', user.role)}</div></div>
          ${row('Email', esc(user.email || '—'))}${row('Phone', esc(user.phone || '—'))}
          ${user.role === 'student' ? row('Course', esc(user.course || '—')) + row('Level', esc(user.level || '—')) : row('Department', esc(user.department || '—'))}
          ${row('Member since', formatDate(user.created_at))}
        </div></div>
        <div class="card"><div class="card-header"><h3>${icon('edit')} Update my details</h3></div><div class="card-body">
          <form id="profile-form">
            <div class="form-group"><label class="form-label" for="pf-photo">Profile photo</label><input class="form-input" id="pf-photo" type="file" accept="image/*"></div>
            <div class="form-row"><div class="form-group"><label class="form-label" for="pf-email">Email</label><input class="form-input" id="pf-email" name="email" type="email" value="${esc(user.email || '')}"></div>
            <div class="form-group"><label class="form-label" for="pf-phone">Phone</label><input class="form-input" id="pf-phone" name="phone" type="tel" value="${esc(user.phone || '')}"></div></div>
            <div class="form-group"><label class="form-label" for="pf-address">Address</label><input class="form-input" id="pf-address" name="address" value="${esc(user.address || '')}"></div>
            ${user.role === 'student' ? `<div class="form-row"><div class="form-group"><label class="form-label" for="pf-gn">Guardian / emergency contact</label><input class="form-input" id="pf-gn" name="guardian_name" value="${esc(user.guardian_name || '')}"></div>
            <div class="form-group"><label class="form-label" for="pf-gp">Guardian phone</label><input class="form-input" id="pf-gp" name="guardian_phone" type="tel" value="${esc(user.guardian_phone || '')}"></div></div>` : ''}
            <div class="flex gap-sm flex-wrap"><button class="btn btn-primary" type="submit">Save changes</button>${button('Change password', { action: 'changePassword', icon: 'key' })}</div>
          </form></div></div>
        ${cal ? `<div class="card"><div class="card-header"><h3>${icon('calendar')} Sync with my calendar</h3></div><div class="card-body">
          <p class="text-sm text-muted">Your classes, exams and deadlines appear in Google Calendar, Outlook or your phone's calendar and stay up to date. Keep this link private.</p>
          <input class="form-input mono" readonly value="${esc(cal.url)}" aria-label="Calendar link">
          <div class="flex gap-sm mt-sm flex-wrap">${button('Add to Google Calendar', { href: cal.google, icon: 'external', cls: 'btn-primary btn-sm' })}
          ${button('Copy link', { action: 'copyText', icon: 'clipboard', data: { text: cal.url } })}</div></div></div>` : ''}
      </div>`;
      content.querySelector('#profile-form').onsubmit = e => {
        e.preventDefault();
        run(e.submitter, async () => {
          const body = formValues(e.target);
          const photo = doc.getElementById('pf-photo').files[0];
          if (photo) body.photo_url = await uploadFile('avatars', photo);
          const res = await api.patch('/api/me', body);
          session.set(res.user);
          toast('Profile updated');
          refresh();
        });
      };
    };
  }

  function notificationsPage() {
    return async content => {
      const items = await api.rows('notifications', { order: 'created_at.desc', limit: 200 });
      content.innerHTML = pageHead('Notifications', button('Mark all as read', { action: 'markAllReadPage', icon: 'check' })) +
        (items.length ? `<div class="card">${items.map(n => `<div class="notice${n.read ? '' : ' unread'}">
          <div><div class="li-title">${esc(n.title)}</div><div class="li-meta">${esc(n.body || '')} · ${timeAgo(n.created_at)}</div></div>
          ${n.link ? `<a class="btn btn-ghost btn-sm" href="${esc(n.link)}">Open</a>` : ''}</div>`).join('')}</div>`
          : emptyState('bell', 'No notifications yet.'));
    };
  }

  function appsPage() {
    return async content => {
      const apps = await api.rows('external_apps', { active: 'is.true', order: 'position.asc,name.asc' });
      content.innerHTML = pageHead('Apps', '', 'Tools the institute uses — Google Workspace, learning platforms and more.') +
        (apps.length ? `<div class="apps">${apps.map(a => a.embed
          ? `<button class="app-tile" data-action="openApp" data-id="${a.id}">${icon(a.icon || 'grid')}<strong>${esc(a.name)}</strong><span class="text-sm text-muted">${esc(a.description || '')}</span></button>`
          : `<a class="app-tile" href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.icon || 'grid')}<strong>${esc(a.name)} ${icon('external')}</strong><span class="text-sm text-muted">${esc(a.description || '')}</span></a>`).join('')}</div>`
          : emptyState('grid', 'No apps have been added yet.'));
      actions({ openApp: el => {
        const app = apps.find(a => a.id === el.dataset.id);
        openModal(app.name, `<iframe class="embed" src="${esc(embedUrl(app.url) || app.url)}" title="${esc(app.name)}" loading="lazy" referrerpolicy="no-referrer" allow="fullscreen"></iframe>
          <p class="mt-sm">${button('Open in a new tab', { href: app.url, icon: 'external' })}</p>`, { wide: true });
      } });
    };
  }

  actions({
    markAllReadPage: async () => { await api.post('/api/notifications/mark-all-read'); refreshCounts(); refresh(); },
    copyText: async el => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch (e) { toast('Copy failed — select the text and copy it manually.', true); } },
  });

  Object.assign(global, {
    session, portalFor, logout, changePassword, startPortal, go, refresh, refreshCounts, onEvent, pageHead,
    profilePage, notificationsPage, appsPage, STAFF_ROLES,
  });
})(window, document);
