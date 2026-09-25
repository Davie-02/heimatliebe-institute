/** Sign-in page: password sign-in, optional Google sign-in, and redirect to the right portal. */
(function () {
  'use strict';
  const PORTAL_OF = { student: '/student/', teacher: '/teacher/', accounts: '/accounts/', hr: '/hr/', director: '/director/', admin: '/admin/', superadmin: '/admin/' };
  const params = new URLSearchParams(location.search);
  const status = document.querySelector('[data-login-status]');
  const form = document.getElementById('login-form');

  /** Go to the page the user originally wanted (only within their own portal), otherwise their portal home. */
  function enter(user) {
    sessionStorage.setItem('hmli_user', JSON.stringify(user));
    const home = PORTAL_OF[user.role] || '/student/';
    const next = params.get('next') || '';
    const safe = next.startsWith('/') && !next.startsWith('//') && (next.startsWith(home) || next.startsWith('/library.html'));
    location.replace(safe ? next : home);
  }

  if (params.get('id')) form.user_id.value = params.get('id');
  if (params.get('next')) status.innerHTML = alertBox('info', 'Please sign in to continue.');
  if (params.get('error')) status.innerHTML = alertBox('error', esc(params.get('error') === 'unauthorized' ? 'You do not have access to that area.' : params.get('error')));
  if (params.get('sso')) api.get('/api/me').then(res => enter(res.user)).catch(() => { status.innerHTML = alertBox('error', 'Google sign-in did not complete. Please try again.'); });
  siteConfig().then(cfg => { document.querySelector('[data-google]').hidden = !cfg.google_login; });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = form.user_id.value.trim();
    if (!id || !form.password.value) { status.innerHTML = alertBox('error', 'Please enter your ID and password.'); return; }
    status.innerHTML = '';
    run(e.submitter, async () => {
      try {
        const res = await api.post('/api/login', { user_id: id.includes('@') ? id.toLowerCase() : id.toUpperCase(), password: form.password.value });
        enter(res.user);
      } catch (err) {
        status.innerHTML = alertBox('error', esc(err.message));
        form.password.value = '';
        form.password.focus();
      }
    });
  });
})();
