/** Application tracking by reference + email. */
(function () {
  'use strict';
  const form = document.getElementById('status-form');
  const out = document.querySelector('[data-result]');
  const STEPS = ['pending', 'under_review', 'interview', 'approved'];
  const params = new URLSearchParams(location.search);
  if (params.get('ref')) form.reference.value = params.get('ref');
  if (params.get('email')) form.email.value = params.get('email');

  form.addEventListener('submit', e => {
    e.preventDefault();
    run(e.submitter, async () => {
      try {
        const r = await api.post('/api/application-status', { reference: form.reference.value.trim().toUpperCase(), email: form.email.value.trim().toLowerCase() });
        const at = STEPS.indexOf(r.status);
        out.innerHTML = `<div class="card"><div class="card-body">
          <h3>${esc(r.full_name)} · ${esc(r.course)} ${esc(r.level)}</h3>
          <p>${badge(r.status)} ${esc(r.status_text)}</p>
          ${at >= 0 ? `<div class="progress mt-md"><span style="width:${(at + 1) / STEPS.length * 100}%"></span></div>
            <div class="steps">${STEPS.map((s, i) => `<span class="${i <= at ? 'done' : ''}">${s.replace('_', ' ')}</span>`).join('')}</div>` : ''}
          ${r.student_id ? `<div class="id-box">${esc(r.student_id)}</div><p class="mt-md"><a class="btn btn-primary" href="/login.html?id=${encodeURIComponent(r.student_id)}">Sign in to the student portal</a></p>` : ''}
          <p class="text-sm text-muted mt-md">Submitted ${formatDate(r.submitted_at)}</p></div></div>`;
      } catch (err) { out.innerHTML = alertBox('error', esc(err.message)); }
    });
  });
  if (form.reference.value && form.email.value) form.requestSubmit();
})();
