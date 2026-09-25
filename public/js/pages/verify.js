/** Public certificate verification. */
(function () {
  'use strict';
  const form = document.getElementById('verify-form');
  const out = document.querySelector('[data-result]');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const code = form.code.value.trim().toUpperCase();
    if (!code) return;
    run(e.submitter, async () => {
      const r = await api.get(`/api/verify-certificate/${encodeURIComponent(code)}`);
      const row = (label, value) => value ? `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>` : '';
      out.innerHTML = r.valid
        ? `<div class="card" style="border-left:4px solid var(--success)"><div class="card-body"><h3>${icon('check-circle')} This certificate is genuine</h3>
            ${row('Holder', `<strong>${esc(r.full_name)}</strong>`)}${row('Course', `${esc(r.course)} ${esc(r.level || '')}`)}${row('Grade', esc(r.grade))}
            ${row('Teaching hours', esc(r.hours))}${row('Certificate number', `<span class="mono">${esc(r.certificate_no)}</span>`)}${row('Issued', formatDate(r.issued_at))}</div></div>`
        : alertBox('error', r.revoked ? 'This certificate has been <strong>revoked</strong> and is no longer valid.' : 'No certificate matches this code. Check it and try again, or contact the institute.');
    });
  });
  const code = new URLSearchParams(location.search).get('code');
  if (code) { form.code.value = code; form.requestSubmit(); }
})();
