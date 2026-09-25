/** Online application: uploads the payment proof privately, then submits the application. */
(function () {
  'use strict';
  const form = document.getElementById('apply-form');
  const status = document.querySelector('[data-status]');
  const params = new URLSearchParams(location.search);
  const fileInput = form.querySelector('[name=proof]');
  const drop = form.querySelector('[data-drop]');

  // Pre-fill from a course card or a placement test result.
  if (params.get('course')) form.course.value = params.get('course');
  if (params.get('level')) {
    form.level.value = params.get('level');
    document.querySelector('[data-placement-note]').innerHTML = `${icon('check-circle')}<div>Level <strong>${esc(params.get('level'))}</strong> filled in from your placement test.</div>`;
  }

  fileInput.addEventListener('change', () => { form.querySelector('[data-file-name]').textContent = fileInput.files[0] ? fileInput.files[0].name : ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, () => drop.classList.add('over')));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));

  const pw = form.password;
  pw.addEventListener('input', () => {
    const v = pw.value;
    const score = [v.length >= 8, v.length >= 12, /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
    const bar = form.querySelector('[data-strength]');
    bar.style.width = score * 20 + '%';
    bar.style.background = ['#c0392b', '#e67e22', '#d4ac0d', '#27ae60', '#1e7b4f'][Math.max(0, score - 1)];
  });

  const fail = message => { status.innerHTML = alertBox('error', esc(message)); status.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.full_name || !v.email || !v.phone || !v.course || !v.level) return fail('Please fill in all fields marked with *.');
    if ((v.password || '').length < 8) return fail('Your password needs at least 8 characters.');
    if (v.password !== v.password2) return fail('The two passwords are different.');
    const file = fileInput.files[0];
    if (!file) return fail('Please upload your proof of payment.');
    if (file.size > 10 * 1024 * 1024) return fail('The file is larger than 10 MB. Please upload a smaller photo or PDF.');
    status.innerHTML = '';
    run(e.submitter, async () => {
      try {
        delete v.password2;
        v.payment_proof_url = await uploadFile('payment-proofs', file);
        v.email = v.email.toLowerCase();
        const placement = sessionStorage.getItem('placement_attempt');
        if (placement) v.placement_attempt_id = placement;
        Object.keys(v).forEach(k => { if (v[k] === null) delete v[k]; });
        const res = await api.post('/api/submit-application', v);
        form.hidden = true;
        document.querySelector('[data-placement-note]').hidden = true;
        document.querySelector('[data-reference]').textContent = res.reference;
        document.querySelector('[data-track]').href = '/status.html?ref=' + encodeURIComponent(res.reference);
        document.querySelector('[data-done]').hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) { fail(err.message); }
    });
  });
})();
