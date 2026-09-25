/**
 * Student portal: learning (classes, assignments, exams, results, attendance, timetable, library),
 * communication, fees, certificates, official exam registration, scholarships and course feedback.
 */
(function () {
  'use strict';
  const me = () => session.get() || {};

  const nav = [
    { icon: 'grid', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'school', label: 'My classes', page: 'classes', section: 'Learning' },
    { icon: 'file-text', label: 'Assignments', page: 'assignments' },
    { icon: 'edit', label: 'Exams', page: 'exams' },
    { icon: 'trending-up', label: 'Results & progress', page: 'results' },
    { icon: 'check-square', label: 'Attendance', page: 'attendance' },
    { icon: 'clock', label: 'Timetable', page: 'timetable' },
    { icon: 'calendar', label: 'Calendar', page: 'calendar' },
    { icon: 'book-open', label: 'Library', page: 'library' },
    { icon: 'grid', label: 'Apps', page: 'apps' },
    { icon: 'users', label: 'Classmates', page: 'classmates' },
    { icon: 'message-square', label: 'Messages', page: 'messages', section: 'Communication' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'credit-card', label: 'Fees & payments', page: 'payments', section: 'Administration' },
    { icon: 'award', label: 'Certificates', page: 'certificates' },
    { icon: 'flag', label: 'Official exams', page: 'official' },
    { icon: 'gift', label: 'Scholarships', page: 'scholarships' },
    { icon: 'star', label: 'Course feedback', page: 'feedback' },
    { icon: 'user', label: 'My profile', page: 'profile', section: 'Account' },
  ];

  const pages = {};
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;
  const listItem = (title, meta, cls) => `<div class="list-item${cls ? ' ' + cls : ''}"><div class="li-title">${title}</div>${meta ? `<div class="li-meta">${meta}</div>` : ''}</div>`;

  /* Dashboard: everything that needs attention today, in one request. */
  pages.dashboard = async content => {
    const d = await api.get('/api/dashboard/student');
    const u = me();
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Willkommen zurück</div><h1>${esc(u.full_name)}</h1>
        <p>Student ID <span class="td-id">${esc(u.user_id)}</span> · ${esc(u.course || 'Course to be confirmed')} · Level ${esc(u.level || '—')}</p></div>` +
      stats([
        { value: d.upcoming_assignments.length, label: 'Assignments to do', icon: 'file-text', page: 'assignments' },
        { value: d.upcoming_exams.length, label: 'Upcoming exams', icon: 'edit', page: 'exams' },
        { value: d.average != null ? d.average + '%' : '—', label: 'Exam average', icon: 'trending-up', page: 'results' },
        { value: d.attendance && d.attendance.rate != null ? d.attendance.rate + '%' : '—', label: 'Attendance', icon: 'check-square', page: 'attendance' },
        { value: money(d.balance), label: 'Fee balance', icon: 'credit-card', page: 'payments', accent: d.balance > 0 },
      ]) + `<div class="grid-2">
        ${card("Today's classes", 'clock', d.today_classes.length ? d.today_classes.map(c => listItem(`${esc(c.start_time)}–${esc(c.end_time)} · ${esc(c.name)}`,
          `Room ${esc(c.room || 'to be confirmed')}${c.meeting_url ? ` · <a href="${esc(c.meeting_url)}" target="_blank" rel="noopener">Join online</a>` : ''}`)).join('') : '<p class="text-muted text-sm">No classes today.</p>')}
        ${card('Announcements', 'megaphone', d.announcements.length ? d.announcements.map(a => listItem((a.pinned ? icon('pin') : '') + esc(a.title), esc(a.body || ''), a.pinned ? 'pinned' : '')).join('') : '<p class="text-muted text-sm">No announcements.</p>')}
        ${card('Upcoming deadlines', 'alert', d.upcoming_assignments.length ? d.upcoming_assignments.map(a => listItem(esc(a.title), 'Due ' + formatDateTime(a.due_date))).join('') : '<p class="text-muted text-sm">Nothing due — gut gemacht!</p>')}
        ${card('Recent results', 'award', (d.recent_results.length ? d.recent_results.map(r => listItem(`${esc(r.title)} · ${r.percentage == null ? '—' : r.percentage + '%'}`,
          r.passed == null ? 'Being marked' : r.passed ? 'Passed' : 'Not passed')).join('') : '<p class="text-muted text-sm">No results yet.</p>') +
          (d.events.length ? '<h4 class="mt-md">Coming up</h4>' + d.events.map(e => listItem(esc(e.title), `${formatDate(e.start_date)} · ${esc(e.type)}`)).join('') : ''))}
      </div>`;
  };

  pages.classes = async content => {
    const rows = await api.get('/api/me/courses-summary');
    content.innerHTML = pageHead('My classes') + (rows.length ? `<div class="grid-auto">${rows.map(c => `<div class="card"><div class="card-body">
        <div class="flex justify-between items-center gap-sm"><h3>${esc(c.name)}</h3>${badge(c.status)}</div>
        <p class="text-sm text-muted">${esc(c.course || '')} · Level ${esc(c.level || '—')}</p>
        <div class="detail-row"><div class="detail-label">Teacher</div><div class="detail-value">${esc(c.teacher || 'To be confirmed')}</div></div>
        <div class="detail-row"><div class="detail-label">Schedule</div><div class="detail-value">${esc(c.schedule || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Room / mode</div><div class="detail-value">${esc(c.room || '—')} · ${esc(c.mode || 'in person')}</div></div></div>
        ${c.meeting_url ? `<div class="card-footer">${button('Join online class', { href: c.meeting_url, icon: 'video', cls: 'btn-success btn-sm' })}</div>` : ''}</div>`).join('')}</div>`
      : emptyState('school', 'You are not in a class yet. The admissions office will place you soon.'));
  };

  /* Assignments: read the task, write an answer and/or attach a file, see grades and feedback. */
  pages.assignments = async content => {
    const [assignments, submissions] = await Promise.all([
      api.rows('assignments', { order: 'due_date.asc', expand: 'class' }), api.rows('submissions', { user_id: `eq.${me().id}` })]);
    const now = new Date();
    const subFor = a => submissions.find(s => s.assignment_id === a.id);
    const status = a => { const s = subFor(a); if (s) return s.grade != null ? 'graded' : 'submitted'; return a.due_date && new Date(a.due_date) < now ? 'overdue' : 'pending'; };
    content.innerHTML = pageHead('Assignments') + table([
      { label: 'Assignment', render: a => `<div class="td-name">${esc(a.title)}</div>${a.skill ? `<div class="text-sm text-muted">${esc(a.skill)}</div>` : ''}` },
      { label: 'Class', render: a => esc(a.class ? a.class.name : 'General') },
      { label: 'Due', render: a => formatDateTime(a.due_date) },
      { label: 'Status', render: a => badge(status(a)) },
      { label: 'Grade', render: a => { const s = subFor(a); return s && s.grade != null ? `<strong>${s.grade}/${a.total_points}</strong>` : '—'; } },
      { label: '', render: a => button('Open', { action: 'openAssignment', data: { id: a.id }, cls: 'btn-primary btn-sm' }) },
    ], assignments, { empty: 'No assignments yet.' });

    actions({ openAssignment: el => {
      const a = assignments.find(x => x.id === el.dataset.id);
      const sub = subFor(a);
      const editable = !sub || sub.grade == null;
      const embed = embedUrl(a.attachment_url);
      const body = openModal(a.title, `
        <p class="text-sm text-muted">Due ${formatDateTime(a.due_date)} · ${a.total_points} points</p>
        <div class="mb-md" style="white-space:pre-wrap">${esc(a.description || '')}</div>
        ${a.attachment_url ? (embed ? `<iframe class="embed" style="height:50vh" src="${esc(embed)}" title="Task material" loading="lazy"></iframe>` : '') +
          `<p class="mt-sm">${button('Open task material', { href: a.attachment_url, icon: 'paperclip' })}</p>` : ''}
        ${sub && sub.grade != null ? alertBox('success', `Grade: <strong>${sub.grade}/${a.total_points}</strong>${sub.feedback ? `<br>Feedback: ${esc(sub.feedback)}` : ''}`) : ''}
        ${editable ? `<form data-submit>
          <div class="form-group"><label class="form-label" for="answer">Your answer</label><textarea class="form-textarea" id="answer" name="content" rows="8">${esc(sub ? sub.content || '' : '')}</textarea></div>
          <div class="form-group"><label class="form-label" for="attach">Attach a file (optional)</label><input class="form-input" id="attach" type="file" name="file">
          ${sub && sub.file_url ? `<div class="form-hint">Already attached: <a href="${esc(sub.file_url)}" target="_blank" rel="noopener">your file</a></div>` : ''}</div>
          ${a.due_date && new Date(a.due_date) < now ? alertBox('warning', 'The deadline has passed. Your teacher will see that this was handed in late.') : ''}
          <button class="btn btn-primary" type="submit">${icon('upload')}<span>${sub ? 'Update my work' : 'Hand in'}</span></button></form>` : ''}`, { wide: true });
      const form = body.querySelector('[data-submit]');
      if (form) form.addEventListener('submit', e => {
        e.preventDefault();
        run(e.submitter, async () => {
          const values = { content: form.content.value };
          if (form.file.files[0]) values.file_url = await uploadFile('submissions', form.file.files[0]);
          if (sub) await api.update('submissions', sub.id, values); else await api.create('submissions', Object.assign(values, { assignment_id: a.id }));
          closeModal();
          toast('Handed in');
          refresh();
        });
      });
    } });
  };

  /* Exams: timed, auto-submitted when time runs out, marked instantly where possible. */
  pages.exams = async content => {
    const [exams, results] = await Promise.all([api.rows('exams', { order: 'date.asc' }), api.rows('exam_results', { user_id: `eq.${me().id}` })]);
    const now = new Date();
    const resultFor = e => results.find(r => r.exam_id === e.id);
    const isOpen = e => (!e.date || new Date(e.date) <= now) && !(e.close_date && new Date(e.close_date) < now);
    content.innerHTML = pageHead('Exams') + table([
      { label: 'Exam', render: e => `<span class="td-name">${esc(e.title)}</span>` },
      { label: 'Opens', render: e => formatDateTime(e.date) },
      { label: 'Duration', render: e => (e.duration_minutes ? e.duration_minutes + ' min' : '—') },
      { label: 'Status', render: e => { const r = resultFor(e); if (r) return badge(r.needs_review ? 'submitted' : 'completed');
          return isOpen(e) ? badge('open') : badge(e.date && new Date(e.date) > now ? 'pending' : 'closed', e.date && new Date(e.date) > now ? 'upcoming' : 'closed'); } },
      { label: '', render: e => { const r = resultFor(e);
          if (r) return r.needs_review ? '<span class="text-sm text-muted">Being marked</span>' : `<strong>${r.percentage}%</strong>`;
          return isOpen(e) ? button('Start', { action: 'startExam', data: { id: e.id }, cls: 'btn-primary btn-sm', icon: 'edit' }) : '—'; } },
    ], exams, { empty: 'No exams scheduled.' });
  };

  actions({ startExam: async el => {
    const exam = await api.row('exams', el.dataset.id);
    const questions = exam.questions || [];
    if (!questions.length) return toast('This exam has no questions yet.', true);
    if (!(await confirmDialog(`Start "${exam.title}"? ${exam.duration_minutes ? `You have ${exam.duration_minutes} minutes and` : 'You'} can submit only once.`, { ok: 'Start now' }))) return;
    const started = Date.now();
    const body = openModal(exam.title, `
      ${exam.duration_minutes ? `<div class="exam-timer" data-timer><span>${icon('clock')} Time left</span><span data-left></span></div>` : ''}
      ${exam.description ? `<p class="text-sm">${esc(exam.description)}</p>` : ''}
      <form data-exam>${questions.map((q, i) => `<fieldset class="question" style="border:1px solid var(--border)"><legend class="question-text">${i + 1}. ${esc(q.text || '')} <span class="text-sm text-muted">(${q.points || 1} pt)</span></legend>
        ${q.type === 'mcq' ? (q.options || []).map((opt, j) => `<label class="option"><input type="radio" name="q${i}" value="${j}"> ${esc(opt)}</label>`).join('')
          : `<textarea class="form-textarea" name="q${i}" rows="3" aria-label="Answer to question ${i + 1}"></textarea>`}</fieldset>`).join('')}
        <button class="btn btn-primary btn-lg" type="submit">${icon('check')}<span>Submit answers</span></button></form>`, { wide: true, locked: true });
    const form = body.querySelector('[data-exam]');
    let timer = null;
    let submitting = false;
    async function submit() {
      if (submitting) return;
      submitting = true;
      clearInterval(timer);
      const data = new FormData(form);
      const answers = {};
      questions.forEach((_, i) => { answers[i] = data.get(`q${i}`); });
      try {
        const res = await api.post(`/api/exams/${exam.id}/submit`, { answers, started_at: new Date(started).toISOString() });
        closeModal(true);
        openModal('Exam submitted', res.needs_review
          ? '<p>Your answers are in. Some questions are marked by your teacher — you will get a notification when your result is ready.</p>'
          : `<div class="text-center"><div class="stat-value" style="font-size:3rem">${res.percentage}%</div><p>${res.score}/${res.total_points} points · ${res.passed ? 'Passed' : 'Not passed'}</p></div>`);
        refresh();
      } catch (err) {
        submitting = false;
        toast(err.message, true);
      }
    }
    if (exam.duration_minutes) {
      const limit = exam.duration_minutes * 60000;
      const tick = () => {
        const left = limit - (Date.now() - started);
        const el = body.querySelector('[data-left]');
        if (!el) return clearInterval(timer);
        if (left <= 0) { toast('Time is up — submitting your answers.'); return submit(); }
        el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        body.querySelector('[data-timer]').classList.toggle('low', left < 120000);
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  } });

  pages.results = async content => {
    const r = await api.get(`/api/students/${me().id}/report`);
    const s = r.summary;
    const latest = r.skills[r.skills.length - 1];
    const pct = v => (v == null ? '—' : v + '%');
    content.innerHTML = pageHead('Results & progress', button('Report card', { href: `/api/students/${me().id}/report.html`, icon: 'printer' })) +
      stats([{ value: pct(s.exam_average), label: 'Exam average', icon: 'edit', accent: true }, { value: pct(s.assignment_average), label: 'Assignment average', icon: 'file-text' },
        { value: pct(s.attendance_rate), label: 'Attendance', icon: 'check-square' }, { value: esc(s.latest_cefr || '—'), label: 'Current CEFR level', icon: 'target' }]) +
      (latest ? `<div class="card mb-md"><div class="card-header"><h3>${icon('target')} Skills profile · ${esc(latest.term || formatDate(latest.created_at))}</h3></div><div class="card-body">
        ${barChart(['reading', 'writing', 'listening', 'speaking'].map(k => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: latest[k] || 0 })), { format: v => v + '%' })}
        ${latest.comments ? `<p class="text-sm mt-md"><strong>Teacher's comment:</strong> ${esc(latest.comments)}</p>` : ''}</div></div>` : '') +
      '<h3 class="mb-sm">Exams</h3>' + table([{ label: 'Exam', key: 'title', cls: 'td-name' }, { label: 'Score', render: e => `${e.score == null ? '—' : e.score} / ${e.total_points == null ? '—' : e.total_points}` },
        { label: 'Result', render: e => (e.passed == null ? badge('pending', 'being marked') : badge(e.passed ? 'pass' : 'fail', `${e.percentage}% · ${e.passed ? 'pass' : 'fail'}`)) },
        { label: 'Date', render: e => formatDate(e.submitted_at) }], r.exams, { empty: 'No exam results yet.' }) +
      '<h3 class="mb-sm mt-lg">Assignments</h3>' + table([{ label: 'Assignment', key: 'title', cls: 'td-name' },
        { label: 'Grade', render: a => (a.grade != null ? `${a.grade}/${a.total_points}` : 'Not marked yet') }, { label: 'Feedback', key: 'feedback' }], r.assignments, { empty: 'No marked assignments yet.' });
  };

  pages.attendance = async content => {
    const rows = await api.rows('attendance', { user_id: `eq.${me().id}`, order: 'date.desc', expand: 'class', limit: 500 });
    const count = s => rows.filter(r => r.status === s).length;
    const rate = rows.length ? Math.round((count('present') + count('late')) / rows.length * 1000) / 10 : null;
    content.innerHTML = pageHead('My attendance') +
      stats([{ value: rate == null ? '—' : rate + '%', label: 'Attendance rate', icon: 'check-square', accent: true }, { value: count('present'), label: 'Present' },
        { value: count('late'), label: 'Late' }, { value: count('absent'), label: 'Absent' }, { value: count('excused'), label: 'Excused' }]) +
      (rate != null && rate < 75 ? alertBox('warning', 'Your attendance is below 75%. Regular attendance is required to sit exams and receive a certificate.') : '') +
      table([{ label: 'Date', render: r => formatDate(r.date) }, { label: 'Class', render: r => esc(r.class ? r.class.name : '—') },
        { label: 'Status', render: r => badge(r.status) }, { label: 'Note', key: 'notes' }], rows, { empty: 'No attendance records yet.' });
  };

  pages.timetable = timetablePage();
  pages.calendar = calendarPage(false);
  pages.apps = appsPage();

  pages.library = async content => {
    const items = await api.rows('library', { order: 'created_at.desc', limit: 500 });
    const levels = [...new Set(items.map(i => i.level).filter(Boolean))];
    content.innerHTML = pageHead('Library') + `<div class="toolbar">
      <input class="form-input search-input" type="search" data-lib-q placeholder="Search title, author, language…" aria-label="Search the library">
      <select class="form-select" data-lib-level aria-label="Level"><option value="">All levels</option>${levels.map(l => `<option>${esc(l)}</option>`).join('')}</select></div>
      <div class="grid-auto" data-lib-grid></div>`;
    const render = () => {
      const q = content.querySelector('[data-lib-q]').value.toLowerCase();
      const level = content.querySelector('[data-lib-level]').value;
      const list = items.filter(i => (!level || i.level === level) && [i.title, i.author, i.language, i.description].join(' ').toLowerCase().includes(q));
      content.querySelector('[data-lib-grid]').innerHTML = list.length ? list.map(i => `<div class="card">
        ${i.cover_url ? `<img class="card-media" src="${esc(i.cover_url)}" alt="" loading="lazy">` : ''}
        <div class="card-body"><div class="flex gap-sm mb-sm">${badge('info', i.language || 'General')}${badge('neutral', i.level || 'All levels')}</div>
        <h3>${esc(i.title)}</h3>${i.author ? `<p class="text-sm text-muted">${esc(i.author)}</p>` : ''}<p class="text-sm">${esc((i.description || '').slice(0, 140))}</p></div>
        ${i.file_url ? `<div class="card-footer">${embedUrl(i.file_url) ? button('Read here', { action: 'readResource', data: { id: i.id }, icon: 'eye', cls: 'btn-primary btn-sm' }) : ''}
          ${button('Open', { href: i.file_url, icon: 'external' })}</div>` : ''}</div>`).join('') : emptyState('book-open', 'No matching resources.');
    };
    content.querySelector('[data-lib-q]').addEventListener('input', render);
    content.querySelector('[data-lib-level]').addEventListener('change', render);
    render();
    actions({ readResource: el => { const i = items.find(x => x.id === el.dataset.id);
      openModal(i.title, `<iframe class="embed" src="${esc(embedUrl(i.file_url))}" title="${esc(i.title)}" loading="lazy" allow="fullscreen"></iframe>`, { wide: true }); } });
  };

  pages.classmates = async content => {
    const users = await api.rows('users', { role: 'eq.student', id: `neq.${me().id}`, order: 'full_name.asc' });
    content.innerHTML = pageHead('My classmates') + table([{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'Student ID', key: 'user_id', cls: 'td-id' },
      { label: 'Level', key: 'level' }], users, { empty: 'No classmates yet.' });
  };

  pages.messages = messagesPage();
  pages.notifications = notificationsPage();

  /* Fees: statement, reporting a mobile-money/bank payment with proof, receipts. */
  pages.payments = async content => {
    const st = await api.get(`/api/finance/statement/${me().id}`);
    const open = st.invoices.filter(i => ['pending', 'partial', 'overdue'].includes(i.status));
    content.innerHTML = pageHead('Fees & payments', `<button class="btn btn-primary btn-sm" data-report-payment>${icon('upload')}<span>Report a payment</span></button>`) +
      stats([{ value: money(st.totals.billed), label: 'Total billed', icon: 'file-text' }, { value: money(st.totals.paid), label: 'Paid', icon: 'check-circle' },
        { value: money(st.totals.balance), label: 'Balance', icon: 'wallet', accent: st.totals.balance > 0 }]) +
      alertBox('info', 'Pay with Airtel Money, TNM Mpamba or a bank transfer, then choose <strong>Report a payment</strong> and upload your proof. The accounts office confirms it and your receipt appears here.') +
      '<h3 class="mb-sm">Invoices</h3>' + table([{ label: 'Invoice', key: 'invoice_number', cls: 'td-id' }, { label: 'Description', key: 'description' },
        { label: 'Amount', render: i => money(i.amount - (i.discount || 0)) }, { label: 'Paid', render: i => money(i.paid) }, { label: 'Due', render: i => formatDate(i.due_date) },
        { label: 'Status', render: i => badge(i.status) }, { label: '', render: i => button('', { href: `/api/invoices/${i.id}/print`, icon: 'printer', cls: 'btn-ghost btn-sm', title: 'Print invoice' }) }],
        st.invoices, { empty: 'No invoices.' }) +
      '<h3 class="mb-sm mt-lg">Payments</h3>' + table([{ label: 'Date', render: p => formatDate(p.created_at) }, { label: 'Amount', render: p => `<strong>${money(p.amount)}</strong>` },
        { label: 'Method', key: 'method' }, { label: 'Reference', key: 'reference', cls: 'td-id' }, { label: 'Status', render: p => badge(p.status) },
        { label: 'Receipt', render: p => (p.status === 'confirmed' ? button(p.receipt_no || 'Receipt', { href: `/api/payments/${p.id}/receipt`, icon: 'printer' }) : '—') }],
        st.payments, { empty: 'No payments yet.' });
    content.querySelector('[data-report-payment]').addEventListener('click', () => formModal('Report a payment', [
      { name: 'invoice_id', label: 'For invoice', type: 'select', full: true, options: open.map(i => ({ value: i.id, label: `${i.invoice_number} — ${i.description || ''} (${money(i.amount - i.discount - i.paid)} due)` })) },
      { name: 'amount', label: 'Amount paid', type: 'number', required: true, min: 1 },
      { name: 'method', label: 'How you paid', type: 'select', required: true, options: [{ value: 'airtel', label: 'Airtel Money' }, { value: 'tnm', label: 'TNM Mpamba' }, { value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }] },
      { name: 'reference', label: 'Transaction reference', required: true },
      { name: 'proof_url', label: 'Proof of payment (screenshot or PDF)', type: 'file', bucket: 'payment-proofs', accept: 'image/*,.pdf', full: true }],
      {}, async values => { await api.post('/api/payments/submit', values); toast('Payment reported — the accounts office will confirm it shortly'); refresh(); }));
  };

  pages.certificates = async content => {
    const rows = await api.rows('certificates', { order: 'issued_at.desc' });
    content.innerHTML = pageHead('My certificates') + (rows.length ? `<div class="grid-auto">${rows.map(c => `<div class="card"><div class="card-body">
      <div class="eyebrow">${esc(c.certificate_no)}</div><h3>${esc(c.course)} ${esc(c.level || '')}</h3>
      <p class="text-sm text-muted">Issued ${formatDate(c.issued_at)}${c.grade ? ' · Grade ' + esc(c.grade) : ''}</p>
      <p class="text-sm">Verification code <strong class="td-id">${esc(c.verification_code)}</strong></p></div>
      <div class="card-footer">${button('View & print', { href: `/api/certificates/${c.id}/print`, icon: 'printer', cls: 'btn-primary btn-sm' })}
      ${button('Verification page', { href: `/verify.html?code=${c.verification_code}`, icon: 'shield' })}</div></div>`).join('')}</div>`
      : emptyState('award', 'Your certificates appear here when you complete a course.'));
  };

  pages.official = async content => {
    const [sessions, regs] = await Promise.all([
      api.rows('exam_sessions', { order: 'exam_date.asc', exam_date: `gte.${todayISO()}` }),
      api.rows('exam_registrations', { user_id: `eq.${me().id}`, expand: 'session' })]);
    content.innerHTML = pageHead('Official exams', '', 'Goethe-Zertifikat and other internationally recognised exams.') +
      '<h3 class="mb-sm">My registrations</h3>' + table([{ label: 'Exam', render: r => esc(r.session ? r.session.title : '—') },
        { label: 'Date', render: r => formatDate(r.session && r.session.exam_date) }, { label: 'Modules', key: 'modules' },
        { label: 'Status', render: r => badge(r.status) }, { label: 'Result', key: 'result' }], regs, { empty: 'You have not registered for an official exam yet.' }) +
      '<h3 class="mb-sm mt-lg">Upcoming sessions</h3>' + table([
        { label: 'Exam', render: x => `<div class="td-name">${esc(x.title)}</div><div class="text-sm text-muted">${esc(x.provider)}</div>` },
        { label: 'Date', render: x => formatDate(x.exam_date) }, { label: 'Register by', render: x => formatDate(x.registration_deadline) },
        { label: 'Venue', key: 'venue' }, { label: 'Fee', render: x => (x.fee ? money(x.fee) : '—') },
        { label: '', render: x => (regs.some(r => r.session_id === x.id) ? badge('submitted', 'registered') : button('Register', { action: 'registerExam', data: { id: x.id }, cls: 'btn-primary btn-sm' })) }],
        sessions, { empty: 'No sessions have been announced yet.' });
    actions({ registerExam: el => {
      const x = sessions.find(s => s.id === el.dataset.id);
      const u = me();
      formModal(`Register — ${x.title}`, [
        { name: 'modules', label: 'Modules', default: x.modules || '', full: true, hint: 'Keep all modules, or list only the ones you are re-taking.' },
        { name: 'date_of_birth', label: 'Date of birth (as in your passport)', type: 'date', required: true },
        { name: 'passport_no', label: 'Passport or ID number', required: true },
        { name: 'payment_proof_url', label: 'Proof of exam fee payment', type: 'file', bucket: 'registrations', accept: 'image/*,.pdf', full: true }],
        {}, async values => {
          await api.post('/api/exam-registrations/register', Object.assign(values, { session_id: x.id, full_name: u.full_name, email: u.email, phone: u.phone }));
          toast('Registration received');
          refresh();
        });
    } });
  };

  pages.scholarships = async content => {
    const [list, applied] = await Promise.all([api.rows('scholarships', { open: 'is.true' }), api.rows('scholarship_applications', { expand: 'scholarship' })]);
    content.innerHTML = pageHead('Scholarships') + '<h3 class="mb-sm">My applications</h3>' +
      table([{ label: 'Scholarship', render: a => esc(a.scholarship ? a.scholarship.title : '—') }, { label: 'Applied', render: a => formatDate(a.created_at) },
        { label: 'Status', render: a => badge(a.status) }], applied, { empty: 'No applications yet.' }) +
      '<h3 class="mb-sm mt-lg">Open scholarships</h3>' + (list.length ? `<div class="grid-auto">${list.map(x => `<div class="card"><div class="card-body">
        <h3>${esc(x.title)}</h3><p class="text-sm">${esc(x.description || '')}</p>${x.criteria ? `<p class="text-sm"><strong>Who can apply:</strong> ${esc(x.criteria)}</p>` : ''}
        <p class="text-sm text-muted">${x.amount ? money(x.amount) : ''}${x.deadline ? ' · Closes ' + formatDate(x.deadline) : ''}</p></div>
        <div class="card-footer">${applied.some(a => a.scholarship_id === x.id) ? badge('submitted', 'applied') : button('Apply', { action: 'applyScholarship', data: { id: x.id }, cls: 'btn-primary btn-sm' })}</div></div>`).join('')}</div>`
        : '<p class="text-muted">No scholarships are open right now.</p>');
    actions({ applyScholarship: el => formModal('Scholarship application', [{ name: 'statement', label: 'Why should you receive this scholarship?', type: 'textarea', rows: 8, required: true, full: true }],
      {}, async values => { await api.create('scholarship_applications', Object.assign(values, { scholarship_id: el.dataset.id })); toast('Application sent'); refresh(); }) });
  };

  pages.feedback = async content => {
    const [classes, given] = await Promise.all([api.get('/api/me/courses-summary'), api.rows('course_evaluations')]);
    content.innerHTML = pageHead('Course feedback', '', 'Anonymous — your teacher sees ratings and comments, not your name.') + (classes.length ? `<div class="grid-auto">${classes.map(c => {
      const done = given.find(g => g.class_id === c.id);
      return `<div class="card"><div class="card-body"><h3>${esc(c.name)}</h3><p class="text-sm text-muted">${esc(c.teacher || '')}</p>
        ${done ? `<p class="text-sm">Course ${done.course_rating}/5 · Teaching ${done.teacher_rating}/5</p>` : ''}</div>
        <div class="card-footer">${done ? badge('submitted', 'thank you') : button('Give feedback', { action: 'rateClass', data: { id: c.id }, icon: 'star', cls: 'btn-primary btn-sm' })}</div></div>`;
    }).join('')}</div>` : emptyState('star', 'No classes to rate yet.'));
    const scale = [5, 4, 3, 2, 1].map(n => ({ value: n, label: `${n} — ${['', 'poor', 'fair', 'good', 'very good', 'excellent'][n]}` }));
    actions({ rateClass: el => formModal('Course feedback', [
      { name: 'course_rating', label: 'Course content', type: 'select', options: scale, required: true },
      { name: 'teacher_rating', label: 'Teaching', type: 'select', options: scale, required: true },
      { name: 'comments', label: 'Comments', type: 'textarea', full: true }],
      {}, async v => {
        await api.create('course_evaluations', { class_id: el.dataset.id, course_rating: Number(v.course_rating), teacher_rating: Number(v.teacher_rating), comments: v.comments });
        toast('Danke! Thank you for your feedback.');
        refresh();
      }) });
  };

  pages.profile = profilePage();

  startPortal({ roles: ['student'], nav, pages });
})();
