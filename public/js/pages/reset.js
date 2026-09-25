/** Password reset: step 1 requests an email link; step 2 (opened from the email) sets the new password. */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const id = params.get('id');
  const step = name => document.querySelectorAll('[data-step]').forEach(el => { el.hidden = el.dataset.step !== name; });
  const say = (html, where) => { document.querySelector(`[data-step="${where}"] [data-status]`).innerHTML = html; };

  if (token && id) step('reset');

  document.getElementById('request-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (!f.student_id.value.trim() || !f.email.value.trim()) return say(alertBox('error', 'Please enter your ID and email.'), 'request');
    run(e.submitter, async () => {
      const res = await api.post('/api/request-password-reset', { student_id: f.student_id.value.trim().toUpperCase(), email: f.email.value.trim().toLowerCase() });
      say(alertBox('success', esc(res.message)), 'request');
    });
  });

  const pw = document.querySelector('#reset-form [name=password]');
  pw.addEventListener('input', () => {
    const v = pw.value;
    const score = [v.length >= 8, v.length >= 12, /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
    const bar = document.querySelector('[data-strength]');
    bar.style.width = score * 20 + '%';
    bar.style.background = ['#c0392b', '#e67e22', '#d4ac0d', '#27ae60', '#1e7b4f'][Math.max(0, score - 1)];
  });

  document.getElementById('reset-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value.length < 8) return say(alertBox('error', 'The password needs at least 8 characters.'), 'reset');
    if (f.password.value !== f.confirm.value) return say(alertBox('error', 'The two passwords are different.'), 'reset');
    run(e.submitter, async () => {
      try {
        await api.post('/api/reset-password', { token, student_id: id, new_password: f.password.value });
        step('done');
      } catch (err) { say(alertBox('error', esc(err.message)), 'reset'); }
    });
  });
})();
