/** Official exam sessions (Goethe, ÖSD …) and the registration form. */
(function () {
  'use strict';
  const holder = document.querySelector('[data-sessions]');
  let sessions = [];

  async function list() {
    sessions = await api.rows('exam_sessions', { exam_date: `gte.${todayISO()}`, order: 'exam_date.asc' }).catch(() => []);
    const today = todayISO();
    const row = (label, value) => `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>`;
    holder.innerHTML = sessions.length ? sessions.map(s => {
      const closed = s.registration_deadline && s.registration_deadline < today;
      return `<div class="card"><div class="card-body"><div class="eyebrow">${esc(s.provider)}</div><h3>${esc(s.title)}</h3>
        ${row('Exam date', `<strong>${formatDate(s.exam_date)}</strong>`)}${row('Register by', formatDate(s.registration_deadline))}
        ${row('Venue', esc(s.venue || 'To be announced'))}${row('Modules', esc(s.modules || ''))}${row('Fee', s.fee ? money(s.fee) : 'To be announced')}</div>
        <div class="card-footer">${closed ? badge('closed', 'registration closed') : button('Register', { action: 'register', data: { id: s.id }, cls: 'btn-primary btn-sm' })}</div></div>`;
    }).join('') : `<div class="panel">${emptyState('flag', 'No exam sessions are open right now. Follow our news or contact us to be told when registration opens.')}</div>`;
  }

  actions({ register: el => {
    const s = sessions.find(x => x.id === el.dataset.id);
    const body = openModal(`Register — ${s.title}`, `<p class="text-sm text-muted">${formatDate(s.exam_date)} · ${esc(s.venue || '')}</p><div data-status></div>
      <form class="form-grid" data-reg novalidate>
        <div class="form-group full"><label class="form-label" for="r-name">Full name (exactly as in your passport) *</label><input class="form-input" id="r-name" name="full_name" required></div>
        <div class="form-group"><label class="form-label" for="r-email">Email *</label><input class="form-input" id="r-email" name="email" type="email" required></div>
        <div class="form-group"><label class="form-label" for="r-phone">Phone *</label><input class="form-input" id="r-phone" name="phone" type="tel" required></div>
        <div class="form-group"><label class="form-label" for="r-dob">Date of birth *</label><input class="form-input" id="r-dob" name="date_of_birth" type="date" required></div>
        <div class="form-group"><label class="form-label" for="r-pass">Passport or ID number *</label><input class="form-input" id="r-pass" name="passport_no" required></div>
        <div class="form-group full"><label class="form-label" for="r-mod">Modules</label><input class="form-input" id="r-mod" name="modules" value="${esc(s.modules || '')}"></div>
        <div class="form-group full"><label class="form-label" for="r-proof">Proof of fee payment (photo or PDF)</label><input class="form-input" id="r-proof" type="file" name="proof" accept="image/*,.pdf"></div>
        <div class="full"><button class="btn btn-primary" type="submit">Submit registration</button></div></form>`, { wide: true });
    const form = body.querySelector('[data-reg]');
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      run(e.submitter, async () => {
        try {
          const values = formValues(form);
          Object.keys(values).forEach(k => { if (values[k] === null) delete values[k]; });
          if (form.proof.files[0]) values.payment_proof_url = await uploadFile('registrations', form.proof.files[0]);
          await api.post('/api/exam-registrations/register', Object.assign(values, { session_id: s.id }));
          body.innerHTML = `<div class="success">${icon('check-circle')}<h2>Registration received</h2><p class="lead">We've emailed you a confirmation. Your place is confirmed once the exam fee is verified.</p></div>`;
        } catch (err) { body.querySelector('[data-status]').innerHTML = alertBox('error', esc(err.message)); }
      });
    });
  } });

  list();
})();
