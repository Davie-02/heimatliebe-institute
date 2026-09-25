/**
 * Management screens shared by the Director and Admin portals.
 * Each function returns a page renderer:  pages.courses = coursesPage();
 */
(function (global, doc) {
  'use strict';

  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const LANGUAGES = ['German', 'French', 'Swahili', 'Spanish', 'Chinese', 'Latin', 'English'];
  const studentLookup = { table: 'users', query: 'role=eq.student&order=full_name.asc&limit=2000', label: u => `${u.full_name} (${u.user_id})` };
  const teacherLookup = { table: 'users', query: 'role=eq.teacher&status=eq.active&order=full_name.asc', label: u => u.full_name };
  const courseLookup = { table: 'courses', query: 'order=title.asc', label: c => `${c.title}${c.level ? ' (' + c.level + ')' : ''}` };
  const classLookup = { table: 'classes', query: 'order=name.asc', label: c => c.name };
  const staffLookup = { table: 'users', query: 'role=neq.student&status=eq.active&order=full_name.asc', label: u => `${u.full_name} (${u.role})` };
  const published = { name: 'published', label: 'Show on the website', type: 'checkbox', default: true };
  const isImage = url => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url || '');

  /* ── Admissions ────────────────────────────────────────────────────── */
  function applicationsPage() {
    return crudPage({
      table: 'applications', title: 'Applications', singular: 'application', canCreate: false, canEdit: false,
      report: 'applications', query: { order: 'submitted_at.desc' }, liveEvent: 'application.new',
      filters: [{ name: 'status', label: 'Status', options: ['pending', 'under_review', 'interview', 'waitlisted', 'approved', 'rejected'] }],
      columns: [
        { label: 'Reference', key: 'reference', cls: 'td-id' },
        { label: 'Applicant', render: a => `<div class="td-name">${esc(a.full_name)}</div><div class="text-sm text-muted">${esc(a.email)} · ${esc(a.phone || '')}</div>` },
        { label: 'Course', render: a => `${esc(a.course)} ${esc(a.level)}` },
        { label: 'Schedule', key: 'preferred_schedule' },
        { label: 'Received', render: a => timeAgo(a.submitted_at) },
        { label: 'Status', render: a => badge(a.status) }],
      actions: [{ label: 'Review', icon: 'eye', cls: 'btn-primary', run: (a, reload) => reviewApplication(a, reload) }],
      rowClick: (a, reload) => reviewApplication(a, reload),
    });
  }

  async function reviewApplication(a, reload) {
    const placement = a.placement_attempt_id ? await api.row('placement_attempts', a.placement_attempt_id).catch(() => null) : null;
    const row = (label, value) => value ? `<div class="detail-row"><div class="detail-label">${esc(label)}</div><div class="detail-value">${value}</div></div>` : '';
    const proof = a.payment_proof_url
      ? (isImage(a.payment_proof_url) ? `<a href="${esc(a.payment_proof_url)}" target="_blank" rel="noopener"><img src="${esc(a.payment_proof_url)}" alt="Proof of payment" style="max-height:260px;border-radius:8px"></a>`
        : button('Open payment proof', { href: a.payment_proof_url, icon: 'paperclip' }))
      : '<span class="text-muted">Not uploaded</span>';
    const done = a.status === 'approved';
    const body = openModal(`Application ${a.reference}`, `<div class="grid-2"><div>
      ${row('Name', esc(a.full_name))}${row('Email', esc(a.email))}${row('Phone', esc(a.phone))}
      ${row('Course', `${esc(a.course)} · ${esc(a.level)}`)}${row('Preferred schedule', esc(a.preferred_schedule))}
      ${row('Date of birth', a.date_of_birth ? formatDate(a.date_of_birth) : '')}${row('Gender', esc(a.gender))}${row('Nationality', esc(a.nationality))}
      ${row('Address', esc(a.address))}${row('Guardian', a.guardian_name ? `${esc(a.guardian_name)} ${esc(a.guardian_phone || '')}` : '')}
      ${row('Heard about us', esc(a.source))}
      ${row('Placement test', placement ? `<strong>${esc(placement.recommended_level)}</strong> (${placement.score}/${placement.total}, ${esc(placement.language)})` : '')}
      ${row('Status', badge(a.status))}${row('Student ID', esc(a.student_id))}
      ${a.motivation ? `<p class="text-sm mt-sm"><strong>Motivation:</strong> ${esc(a.motivation)}</p>` : ''}</div>
      <div><div class="form-label">Proof of payment</div><div class="mb-md">${proof}</div>
      <label class="form-label" for="ap-notes">Internal notes</label><textarea class="form-textarea" id="ap-notes" rows="3">${esc(a.notes || '')}</textarea></div></div>
      ${done ? '' : `<div class="flex gap-sm flex-wrap mt-md">
        <button class="btn btn-success" data-approve>${icon('check')}<span>Approve and create student</span></button>
        <select class="form-select" data-status style="width:auto" aria-label="New status"><option value="">Move to…</option>
          ${['under_review', 'interview', 'waitlisted', 'rejected', 'pending'].map(s => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select>
        <button class="btn btn-outline" data-move>Update and notify applicant</button></div>`}`, { wide: true });
    if (done) return;
    body.querySelector('[data-move]').addEventListener('click', e => run(e.currentTarget, async () => {
      const status = body.querySelector('[data-status]').value;
      if (!status) throw new Error('Choose the new status first.');
      await api.post(`/api/applications/${a.id}/status`, { status, notes: body.querySelector('#ap-notes').value });
      closeModal();
      toast('Updated — the applicant has been emailed');
      reload();
    }));
    body.querySelector('[data-approve]').addEventListener('click', async () => {
      const [classes, fees] = await Promise.all([cachedRows('classes', 'status=eq.active&order=name.asc'), cachedRows('fees', '')]);
      formModal(`Approve ${a.full_name}`, [
        { name: 'class_id', label: 'Place in class (optional)', type: 'select', full: true, options: classes.map(c => ({ value: c.id, label: `${c.name}${c.level ? ' · ' + c.level : ''}` })) },
        { name: 'fee_id', label: 'First invoice from fee', type: 'select', options: fees.map(f => ({ value: f.id, label: `${f.description || f.type} — ${money(f.amount)}` })) },
        { name: 'invoice_amount', label: '…or invoice amount', type: 'number', min: 1 },
        { name: 'invoice_due', label: 'Invoice due date', type: 'date' },
        { name: 'record_application_payment', label: 'Amount already paid (from the proof)', type: 'number', min: 1, hint: 'Recorded as a confirmed payment against the invoice.' }],
        {}, async values => {
          const res = await api.post(`/api/applications/${a.id}/approve`, values);
          toast(`Approved — student ID ${res.student_id}${res.enrolment ? ` (${res.enrolment.status} in ${res.enrolment.class})` : ''}`);
          reload();
        }, { submitLabel: 'Approve and email student' });
    });
  }

  /* ── Enquiries & placement ─────────────────────────────────────────── */
  function enquiriesPage() {
    return crudPage({
      table: 'enquiries', title: 'Enquiries', singular: 'enquiry', createLabel: 'Log enquiry', report: 'enquiries', liveEvent: 'enquiry.new',
      subtitle: 'Every website, walk-in, phone and WhatsApp enquiry. Set a follow-up date and the assigned person is reminded on the day.',
      query: { order: 'created_at.desc' }, expand: 'assigned_to', canDelete: true,
      filters: [{ name: 'status', label: 'Status', options: ['new', 'contacted', 'follow_up', 'converted', 'closed'] },
        { name: 'channel', label: 'Channel', options: ['website', 'walk-in', 'phone', 'whatsapp', 'email', 'social'] }],
      columns: [
        { label: 'Name', render: e => `<div class="td-name">${esc(e.name)}</div><div class="text-sm text-muted">${esc(e.phone || '')} ${esc(e.email || '')}</div>` },
        { label: 'Interested in', key: 'interest' }, { label: 'Channel', key: 'channel' }, { label: 'Status', render: e => badge(e.status) },
        { label: 'Follow up', render: e => e.next_follow_up ? `<span class="${new Date(e.next_follow_up) <= new Date() && !['converted', 'closed'].includes(e.status) ? 'risk' : ''}">${formatDate(e.next_follow_up)}</span>` : '—' },
        { label: 'Assigned', render: e => esc(e.assigned_to_ref ? e.assigned_to_ref.full_name : '—') },
        { label: 'Received', render: e => timeAgo(e.created_at) }],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
        { name: 'interest', label: 'Interested in' },
        { name: 'channel', label: 'Channel', type: 'select', options: ['website', 'walk-in', 'phone', 'whatsapp', 'email', 'social'], default: 'walk-in' },
        { name: 'status', label: 'Status', type: 'select', options: ['new', 'contacted', 'follow_up', 'converted', 'closed'], default: 'new' },
        { name: 'assigned_to', label: 'Assigned to', type: 'lookup', lookup: staffLookup },
        { name: 'next_follow_up', label: 'Next follow-up', type: 'date' },
        { name: 'message', label: 'Their message', type: 'textarea', full: true }, { name: 'notes', label: 'Call notes', type: 'textarea', full: true }],
      actions: [{ label: 'WhatsApp', icon: 'message-circle', show: e => !!e.phone,
        run: e => { global.open(`https://wa.me/${String(e.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${e.name}, thank you for your interest in Heimatliebe Institute.`)}`, '_blank', 'noopener'); } }],
    });
  }

  function placementsPage() {
    return crudPage({
      table: 'placement_attempts', title: 'Placement test results', canCreate: false, canEdit: false, canDelete: true,
      report: 'placements', liveEvent: 'placement.new', query: { order: 'created_at.desc' },
      filters: [{ name: 'recommended_level', label: 'Level', options: LEVELS }],
      columns: [
        { label: 'Name', render: p => `<div class="td-name">${esc(p.full_name)}</div><div class="text-sm text-muted">${esc(p.email || '')} ${esc(p.phone || '')}</div>` },
        { label: 'Language', key: 'language' }, { label: 'Score', render: p => `${p.score}/${p.total}` },
        { label: 'Level', render: p => `<strong>${esc(p.recommended_level)}</strong>` }, { label: 'Taken', render: p => formatDateTime(p.created_at) }],
    });
  }

  /* ── Courses, classes, enrolment, timetables ───────────────────────── */
  function coursesPage() {
    return crudPage({
      table: 'courses', title: 'Courses', singular: 'course', createLabel: 'New course', canDelete: true, wideForm: true, query: { order: 'title.asc' },
      columns: [{ label: 'Course', render: c => `<span class="td-name">${esc(c.title)}</span>` }, { label: 'Language', key: 'language' },
        { label: 'Level', key: 'level' }, { label: 'Badge', key: 'status' }, { label: 'Fee', key: 'fee' }, { label: 'Website', render: c => badge(c.published ? 'published' : 'draft') }],
      fields: [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'language', label: 'Language', type: 'select', options: LANGUAGES },
        { name: 'level', label: 'Level', type: 'select', options: LEVELS.concat(['Beginner', 'Intermediate', 'Advanced', 'All levels']) },
        { name: 'status', label: 'Badge on the website', type: 'select', options: ['Enrolling Now', 'Starting Soon', 'Coming Soon', 'Full'] },
        { name: 'schedule', label: 'Schedule', placeholder: 'Mon & Wed, 17:00–19:00' }, { name: 'duration', label: 'Duration', placeholder: '3 months' },
        { name: 'fee', label: 'Fee (as shown on the website)', placeholder: 'MWK 200,000 / month' }, { name: 'fee_amount', label: 'Fee amount (number)', type: 'number' },
        { name: 'capacity', label: 'Capacity', type: 'number' }, { name: 'image', label: 'Image', type: 'file', bucket: 'uploads', accept: 'image/*' },
        { name: 'body', label: 'Description', type: 'textarea', rows: 6, full: true }, published],
    });
  }

  function classesPage() {
    return crudPage({
      table: 'classes', title: 'Classes', singular: 'class', createLabel: 'New class', canDelete: true, wideForm: true,
      query: { order: 'name.asc' }, expand: 'teacher,course',
      filters: [{ name: 'status', label: 'Status', options: ['planned', 'active', 'completed', 'cancelled'], default: 'active' }],
      columns: [
        { label: 'Class', render: c => `<div class="td-name">${esc(c.name)}</div><div class="text-sm text-muted">${esc(c.course ? c.course.title : '')}</div>` },
        { label: 'Teacher', render: c => esc(c.teacher ? c.teacher.full_name : 'Not assigned') }, { label: 'Level', key: 'level' },
        { label: 'Room / mode', render: c => `${esc(c.room || '—')} · ${esc(c.mode || '')}` }, { label: 'Seats', key: 'max_students' },
        { label: 'Dates', render: c => `${formatDate(c.start_date)} – ${formatDate(c.end_date)}` }, { label: 'Status', render: c => badge(c.status) }],
      fields: [
        { name: 'name', label: 'Class name', required: true, full: true, placeholder: 'German A1 — Evening A' },
        { name: 'course_id', label: 'Course', type: 'lookup', lookup: courseLookup }, { name: 'teacher_id', label: 'Teacher', type: 'lookup', lookup: teacherLookup },
        { name: 'level', label: 'Level', type: 'select', options: LEVELS }, { name: 'room', label: 'Room' },
        { name: 'mode', label: 'Mode', type: 'select', options: ['in-person', 'online', 'hybrid'], default: 'in-person' },
        { name: 'meeting_url', label: 'Online class link (Google Meet, Zoom …)', type: 'url' },
        { name: 'schedule', label: 'Schedule (text)' }, { name: 'max_students', label: 'Seats', type: 'number', default: 20 },
        { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'end_date', label: 'End date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: ['planned', 'active', 'completed', 'cancelled'], default: 'active' }],
      actions: [{ label: 'Students', icon: 'users', cls: 'btn-primary', run: c => manageEnrolment(c) },
        { label: 'Timetable', icon: 'clock', run: c => manageTimetable(c) }],
    });
  }

  async function manageEnrolment(cls) {
    const roster = await api.get(`/api/classes/${cls.id}/roster`);
    const active = roster.students.filter(s => s.status === 'active').length;
    const body = openModal(`${cls.name} — students (${active}/${cls.max_students || '∞'})`, `
      <div class="form-group"><input class="form-input search-input" data-find placeholder="Search students to add…" aria-label="Search students"></div>
      <div class="pick-list mb-md" data-found></div>
      ${table([{ label: 'Student', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Status', render: s => badge(s.status) },
        { label: 'Attendance', render: s => s.attendance && s.attendance.rate != null ? s.attendance.rate + '%' : '—' },
        { label: '', render: s => `<button class="btn btn-danger-ghost btn-sm" data-unenrol="${s.id}">${icon('x')}<span>Remove</span></button>` }], roster.students, { empty: 'No students yet.' })}`, { wide: true });
    let timer;
    body.querySelector('[data-find]').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = e.target.value.trim();
        if (q.length < 2) return;
        const found = await api.rows('users', { role: 'eq.student', status: 'eq.active', q, limit: 10 });
        const list = body.querySelector('[data-found]');
        list.innerHTML = found.map(u => `<button class="pick" data-enrol="${u.id}">${icon('plus')} ${esc(u.full_name)} <small>${esc(u.user_id)} · ${esc(u.level || '')}</small></button>`).join('');
        list.querySelectorAll('[data-enrol]').forEach(b => b.addEventListener('click', () => run(b, async () => {
          const res = await api.post(`/api/classes/${cls.id}/enroll`, { user_ids: [b.dataset.enrol] });
          toast(res.waitlisted ? 'The class is full — added to the waiting list' : 'Enrolled');
          manageEnrolment(cls);
        })));
      }, 250);
    });
    body.querySelectorAll('[data-unenrol]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remove this student from the class? The first person on the waiting list gets the seat.'))) return manageEnrolment(cls);
      const res = await api.post(`/api/classes/${cls.id}/unenroll/${b.dataset.unenrol}`);
      toast(res.promoted_from_waitlist ? 'Removed — a waiting student was given the seat' : 'Removed');
      manageEnrolment(cls);
    }));
  }

  async function manageTimetable(cls) {
    const rows = await api.rows('timetable_entries', { class_id: `eq.${cls.id}`, order: 'day_of_week.asc' });
    const body = openModal(`${cls.name} — timetable`, table([
      { label: 'Day', render: r => DAYS[r.day_of_week] }, { label: 'Time', render: r => `${esc(r.start_time)}–${esc(r.end_time)}` }, { label: 'Room', key: 'room' },
      { label: '', render: r => `<button class="btn btn-danger-ghost btn-sm" data-drop="${r.id}" aria-label="Delete session">${icon('trash')}</button>` }], rows, { empty: 'No sessions yet.' }) +
      `<form class="form-grid mt-md" data-add-slot>
        <div class="form-group"><label class="form-label" for="tt-day">Day</label><select class="form-select" id="tt-day" name="day_of_week">${[1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}">${DAYS[i]}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="tt-room">Room</label><input class="form-input" id="tt-room" name="room" value="${esc(cls.room || '')}"></div>
        <div class="form-group"><label class="form-label" for="tt-start">Starts</label><input class="form-input" type="time" id="tt-start" name="start_time" required></div>
        <div class="form-group"><label class="form-label" for="tt-end">Ends</label><input class="form-input" type="time" id="tt-end" name="end_time" required></div>
        <div class="full"><button class="btn btn-primary" type="submit">${icon('plus')}<span>Add session</span></button></div></form>`, { wide: true });
    body.querySelector('[data-add-slot]').addEventListener('submit', e => {
      e.preventDefault();
      run(e.submitter, async () => {
        const v = formValues(e.target);
        await api.create('timetable_entries', Object.assign(v, { day_of_week: Number(v.day_of_week), class_id: cls.id }));
        manageTimetable(cls);
      });
    });
    body.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => run(b, async () => { await api.remove('timetable_entries', b.dataset.drop); manageTimetable(cls); })));
  }

  function teachersPage() {
    return async content => {
      const [teachers, classes, feedback] = await Promise.all([
        api.rows('users', { role: 'eq.teacher', order: 'full_name.asc' }), api.rows('classes', { status: 'eq.active' }),
        api.rows('course_evaluations', { expand: 'class', limit: 2000 }).catch(() => [])]);
      const rating = t => {
        const mine = feedback.filter(f => f.class && f.class.teacher_id === t.id);
        if (!mine.length) return '—';
        const avg = mine.reduce((sum, f) => sum + f.teacher_rating, 0) / mine.length;
        return `${avg.toFixed(1)} / 5 <span class="text-sm text-muted">(${mine.length})</span>`;
      };
      content.innerHTML = pageHead('Teachers') + table([
        { label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Department', key: 'department' },
        { label: 'Active classes', render: t => classes.filter(c => c.teacher_id === t.id).length }, { label: 'Student rating', render: rating },
        { label: 'Email', key: 'email' }, { label: 'Status', render: t => badge(t.status) }], teachers, { empty: 'No teachers yet.' });
    };
  }

  function feedbackPage() {
    return async content => {
      const rows = await api.rows('course_evaluations', { expand: 'class', order: 'created_at.desc', limit: 1000 });
      const byClass = {};
      rows.forEach(r => { const name = r.class ? r.class.name : '—'; (byClass[name] = byClass[name] || []).push(r); });
      const avg = (list, key) => (list.reduce((sum, r) => sum + r[key], 0) / list.length).toFixed(1);
      content.innerHTML = pageHead('Course feedback', '', 'Anonymous ratings from students (1–5).') + (rows.length
        ? table([{ label: 'Class', key: 'name', cls: 'td-name' }, { label: 'Responses', key: 'n' }, { label: 'Course', key: 'course' }, { label: 'Teaching', key: 'teaching' }],
          Object.keys(byClass).map(name => ({ name, n: byClass[name].length, course: avg(byClass[name], 'course_rating'), teaching: avg(byClass[name], 'teacher_rating') }))) +
          '<h3 class="mt-lg mb-sm">Comments</h3>' + rows.filter(r => r.comments).map(r => `<div class="list-item"><div class="li-title">${esc(r.class ? r.class.name : '')} · ${r.course_rating}/5</div><div class="li-meta">${esc(r.comments)}</div></div>`).join('')
        : emptyState('star', 'No feedback yet.'));
    };
  }

  /* ── Certificates & official exams ─────────────────────────────────── */
  function certificatesPage() {
    return crudPage({
      table: 'certificates', title: 'Certificates', singular: 'certificate', query: { order: 'created_at.desc' }, expand: 'user', canEdit: false, canCreate: false,
      toolbar: `<button class="btn btn-primary btn-sm" data-issue>${icon('award')}<span>Issue certificate</span></button>`,
      columns: [
        { label: 'Number', key: 'certificate_no', cls: 'td-id' }, { label: 'Student', render: c => esc(c.user ? c.user.full_name : '—') },
        { label: 'Course', render: c => `${esc(c.course)} ${esc(c.level || '')}` }, { label: 'Grade', key: 'grade' },
        { label: 'Issued', render: c => formatDate(c.issued_at) }, { label: 'Code', key: 'verification_code', cls: 'td-id' },
        { label: 'Status', render: c => badge(c.revoked ? 'revoked' : 'active', c.revoked ? 'revoked' : 'valid') }],
      actions: [{ label: 'Print', icon: 'printer', run: c => { global.open(`/api/certificates/${c.id}/print`, '_blank', 'noopener'); } },
        { label: c => (c.revoked ? 'Restore' : 'Revoke'), cls: 'btn-danger-ghost', run: async (c, reload) => {
          const ok = await confirmDialog(c.revoked ? 'Restore this certificate?' : 'Revoke this certificate? Online verification will show it as invalid.', { danger: !c.revoked });
          if (ok) { await api.update('certificates', c.id, { revoked: !c.revoked }); reload(); }
        } }],
      onReady: ({ reload }) => doc.querySelector('[data-issue]').addEventListener('click', () => formModal('Issue certificate', [
        { name: 'user_id', label: 'Student', type: 'lookup', lookup: studentLookup, required: true, full: true },
        { name: 'class_id', label: 'Class', type: 'lookup', lookup: classLookup },
        { name: 'course', label: 'Course name on the certificate', required: true, placeholder: 'German Language Course' },
        { name: 'level', label: 'CEFR level', type: 'select', options: LEVELS }, { name: 'grade', label: 'Grade', placeholder: 'Sehr gut (1.3)' },
        { name: 'hours', label: 'Teaching hours', type: 'number' }, { name: 'issued_at', label: 'Issue date', type: 'date', default: todayISO() }],
        {}, async values => {
          const res = await api.post('/api/certificates/issue', values);
          toast(`Issued ${res.certificate_no}`);
          reload();
          global.open(`/api/certificates/${res.id}/print`, '_blank', 'noopener');
        })),
    });
  }

  function examSessionsPage() {
    return crudPage({
      table: 'exam_sessions', title: 'Official exam sessions', singular: 'session', createLabel: 'New session', canDelete: true,
      subtitle: 'Goethe, ÖSD, telc, DELF and other official exams that candidates can register for on the website.',
      query: { order: 'exam_date.desc' },
      columns: [
        { label: 'Exam', render: x => `<div class="td-name">${esc(x.title)}</div><div class="text-sm text-muted">${esc(x.provider)}</div>` },
        { label: 'Date', render: x => formatDate(x.exam_date) }, { label: 'Register by', render: x => formatDate(x.registration_deadline) },
        { label: 'Venue', key: 'venue' }, { label: 'Fee', render: x => (x.fee ? money(x.fee) : '—') }, { label: 'Seats', key: 'capacity' },
        { label: 'Website', render: x => badge(x.published ? 'published' : 'draft') }],
      fields: [
        { name: 'title', label: 'Title', required: true, full: true, placeholder: 'Goethe-Zertifikat B1' },
        { name: 'provider', label: 'Provider', type: 'select', default: 'Goethe-Institut',
          options: ['Goethe-Institut', 'ÖSD', 'telc', 'TestDaF', 'DELF/DALF', 'DELE', 'Cambridge', 'IELTS', 'Other'] },
        { name: 'level', label: 'Level', type: 'select', options: LEVELS },
        { name: 'modules', label: 'Modules', full: true, default: 'Lesen, Hören, Schreiben, Sprechen' },
        { name: 'exam_date', label: 'Exam date', type: 'date', required: true }, { name: 'registration_deadline', label: 'Registration deadline', type: 'date' },
        { name: 'venue', label: 'Venue' }, { name: 'fee', label: 'Fee', type: 'number' }, { name: 'capacity', label: 'Seats', type: 'number' },
        { name: 'published', label: 'Open for registration on the website', type: 'checkbox', default: true }],
      actions: [{ label: 'Candidates', icon: 'users', cls: 'btn-primary', run: async x => {
        const regs = await api.rows('exam_registrations', { session_id: `eq.${x.id}`, order: 'created_at.asc' });
        const body = openModal(`${x.title} — candidates (${regs.length})`, table([
          { label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' },
          { label: 'Passport', key: 'passport_no' }, { label: 'Modules', key: 'modules' },
          { label: 'Proof', render: r => r.payment_proof_url ? `<a href="${esc(r.payment_proof_url)}" target="_blank" rel="noopener">${icon('paperclip')}</a>` : '—' },
          { label: 'Status', render: r => `<select class="form-select" data-reg-status="${r.id}" aria-label="Status">${['pending', 'confirmed', 'cancelled', 'sat'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select>` },
          { label: 'Result', render: r => `<input class="form-input" data-reg-result="${r.id}" value="${esc(r.result || '')}" style="width:110px" aria-label="Result">` }],
          regs, { empty: 'No registrations yet.' }) + `<p class="mt-md">${button('Export list', { action: 'exportCandidates', icon: 'download' })}</p>`, { wide: true });
        body.querySelectorAll('[data-reg-status]').forEach(s => s.addEventListener('change', () => api.update('exam_registrations', s.dataset.regStatus, { status: s.value }).then(() => toast('Saved'))));
        body.querySelectorAll('[data-reg-result]').forEach(s => s.addEventListener('change', () => api.update('exam_registrations', s.dataset.regResult, { result: s.value }).then(() => toast('Saved'))));
        actions({ exportCandidates: () => downloadCSV(`${x.title}.csv`, ['Name', 'Email', 'Phone', 'Date of birth', 'Passport', 'Modules', 'Status'],
          regs.map(r => [r.full_name, r.email, r.phone, r.date_of_birth, r.passport_no, r.modules, r.status])) });
      } }],
    });
  }

  /* ── Website content ───────────────────────────────────────────────── */
  function newsPage() {
    return crudPage({
      table: 'news', title: 'News', singular: 'article', createLabel: 'New article', canDelete: true, wideForm: true, query: { order: 'date.desc.nullslast' },
      columns: [{ label: 'Title', render: n => `<span class="td-name">${esc(n.title)}</span>` }, { label: 'Category', key: 'category' },
        { label: 'Date', render: n => formatDate(n.date) }, { label: 'Website', render: n => badge(n.published ? 'published' : 'draft') }],
      fields: [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'category', label: 'Category', type: 'select', options: ['Announcement', 'Event', 'Achievement', 'Update', 'Exam'] },
        { name: 'date', label: 'Date', type: 'date', default: todayISO() },
        { name: 'summary', label: 'Summary', type: 'textarea', rows: 2, full: true },
        { name: 'body', label: 'Full article', type: 'textarea', rows: 8, full: true, hint: 'Formatting: **bold**, *italic*, lines starting with "- " become bullet points.' },
        { name: 'image', label: 'Image', type: 'file', bucket: 'news', accept: 'image/*' }, published],
    });
  }
  function galleryPage() {
    return crudPage({
      table: 'gallery', title: 'Gallery', singular: 'photo', createLabel: 'Add photo', canDelete: true, search: false,
      columns: [{ label: 'Photo', render: g => `<img src="${esc(g.src)}" alt="" loading="lazy" style="height:56px;width:84px;object-fit:cover;border-radius:6px">` },
        { label: 'Caption', key: 'caption' }, { label: 'Category', key: 'category' }, { label: 'Website', render: g => badge(g.published ? 'published' : 'draft') }],
      fields: [{ name: 'src', label: 'Photo', type: 'file', bucket: 'gallery', accept: 'image/*', required: true, full: true },
        { name: 'caption', label: 'Caption', full: true }, { name: 'category', label: 'Category', placeholder: 'Classroom, Events…' }, published],
      beforeSave: v => { if (!v.src) throw new Error('Please choose a photo.'); return v; },
    });
  }
  function documentsPage() {
    return crudPage({
      table: 'documents', title: 'Downloads', singular: 'document', createLabel: 'Add document', canDelete: true,
      columns: [{ label: 'Title', render: x => `<span class="td-name">${esc(x.title)}</span>` }, { label: 'Type', key: 'type' },
        { label: 'Date', render: x => formatDate(x.date) }, { label: 'File', render: x => `<a href="${esc(x.file)}" target="_blank" rel="noopener">Open</a>` }],
      fields: [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'type', label: 'Type', placeholder: 'Brochure, Timetable, Policy…' },
        { name: 'date', label: 'Date', type: 'date' }, { name: 'description', label: 'Description', type: 'textarea', full: true },
        { name: 'file', label: 'File', type: 'file', bucket: 'documents', required: true, full: true }, published],
      beforeSave: v => { if (!v.file) throw new Error('Please choose a file.'); return v; },
    });
  }
  function testimonialsPage() {
    return crudPage({
      table: 'testimonials', title: 'Testimonials', singular: 'testimonial', createLabel: 'Add testimonial', canDelete: true, search: false,
      columns: [{ label: 'Name', key: 'name', cls: 'td-name' }, { label: 'Course', key: 'course' }, { label: 'Quote', render: t => esc((t.body || '').slice(0, 100)) }],
      fields: [{ name: 'name', label: 'Student name', required: true }, { name: 'course', label: 'Course and year' },
        { name: 'body', label: 'Quote', type: 'textarea', required: true, full: true }, { name: 'photo', label: 'Photo', type: 'file', bucket: 'gallery', accept: 'image/*' }, published],
    });
  }
  function libraryPage() {
    return crudPage({
      table: 'library', title: 'Library', singular: 'resource', createLabel: 'Add resource', canDelete: true, wideForm: true,
      filters: [{ name: 'language', label: 'Language', options: LANGUAGES.concat(['General']) }, { name: 'level', label: 'Level', options: LEVELS }],
      columns: [{ label: 'Title', render: x => `<div class="td-name">${esc(x.title)}</div><div class="text-sm text-muted">${esc(x.author || '')}</div>` },
        { label: 'Type', key: 'type' }, { label: 'Language', key: 'language' }, { label: 'Level', key: 'level' },
        { label: 'Visible', render: x => badge(x.published ? 'published' : 'draft') },
        { label: 'File', render: x => x.file_url ? `<a href="${esc(x.file_url)}" target="_blank" rel="noopener">Open</a>` : '—' }],
      fields: [
        { name: 'title', label: 'Title', required: true, full: true }, { name: 'author', label: 'Author' },
        { name: 'type', label: 'Type', type: 'select', options: ['Textbook', 'Grammar Guide', 'Vocabulary List', 'Exercise Sheet', 'Exam Prep', 'Audio', 'Video', 'Other'] },
        { name: 'language', label: 'Language', type: 'select', options: LANGUAGES.concat(['General']) },
        { name: 'level', label: 'Level', type: 'select', options: LEVELS.concat(['All levels']) },
        { name: 'description', label: 'Description', type: 'textarea', full: true },
        { name: 'file_url', label: 'Resource: paste a link (Google Drive, YouTube …) or upload a file', type: 'filelink', bucket: 'library-files', full: true },
        { name: 'cover_url', label: 'Cover image', type: 'file', bucket: 'library-covers', accept: 'image/*' },
        { name: 'free', label: 'Free', type: 'checkbox', default: true }, published],
    });
  }
  function scholarshipsPage() {
    return crudPage({
      table: 'scholarships', title: 'Scholarships', singular: 'scholarship', createLabel: 'New scholarship', canDelete: true,
      toolbar: `<button class="btn btn-outline btn-sm" data-sch-apps>${icon('inbox')}<span>Applications</span></button>`,
      columns: [{ label: 'Title', render: x => `<span class="td-name">${esc(x.title)}</span>` }, { label: 'Amount', render: x => (x.amount ? money(x.amount) : '—') },
        { label: 'Deadline', render: x => formatDate(x.deadline) }, { label: 'Status', render: x => badge(x.open ? 'open' : 'closed') }],
      fields: [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'amount', label: 'Amount', type: 'number' }, { name: 'deadline', label: 'Deadline', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea', full: true }, { name: 'criteria', label: 'Who can apply', type: 'textarea', full: true },
        { name: 'open', label: 'Open for applications', type: 'checkbox', default: true }],
      onReady: () => doc.querySelector('[data-sch-apps]').addEventListener('click', async () => {
        const rows = await api.rows('scholarship_applications', { expand: 'user,scholarship', order: 'created_at.desc' });
        const body = openModal('Scholarship applications', table([
          { label: 'Student', render: r => esc(r.user ? r.user.full_name : '') }, { label: 'Scholarship', render: r => esc(r.scholarship ? r.scholarship.title : '') },
          { label: 'Statement', render: r => esc((r.statement || '').slice(0, 160)) },
          { label: 'Decision', render: r => `<select class="form-select" data-decide="${r.id}" aria-label="Decision">${['pending', 'awarded', 'rejected'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select>` }],
          rows, { empty: 'No applications yet.' }), { wide: true });
        body.querySelectorAll('[data-decide]').forEach(s => s.addEventListener('change', () => api.update('scholarship_applications', s.dataset.decide, { status: s.value }).then(() => toast('Saved'))));
      }),
    });
  }
  function alumniPage() {
    return crudPage({
      table: 'alumni', title: 'Alumni', singular: 'alumnus', createLabel: 'Add alumnus', canDelete: true,
      columns: [{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'Course', key: 'course' }, { label: 'Year', key: 'graduation_year' },
        { label: 'Now', key: 'current_job' }, { label: 'Location', key: 'location' }],
      fields: [{ name: 'full_name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'course', label: 'Course' },
        { name: 'graduation_year', label: 'Graduation year', type: 'number' }, { name: 'current_job', label: 'Now working / studying at' },
        { name: 'location', label: 'Location', placeholder: 'e.g. Germany — nursing Ausbildung' }],
    });
  }

  /**
   * Homepage content editor: every text block on the public homepage, including the lists of goals,
   * statistics and languages, without touching code. Saved to settings → shown on the site within a minute.
   */
  function siteContentPage() {
    return async content => {
      const s = await api.get('/api/settings/site');
      const text = (key, label, rows) => rows
        ? `<div class="form-group full"><label class="form-label" for="s-${key}">${label}</label><textarea class="form-textarea" id="s-${key}" name="${key}" rows="${rows}">${esc(s[key] || '')}</textarea></div>`
        : `<div class="form-group"><label class="form-label" for="s-${key}">${label}</label><input class="form-input" id="s-${key}" name="${key}" value="${esc(s[key] || '')}"></div>`;
      const GOAL_ICONS = ['graduation', 'briefcase', 'plane', 'globe', 'book', 'sprout', 'award', 'users', 'star', 'target', 'school', 'compass'];
      const repeater = (key, fields, items) => `<div data-repeater="${key}">${(items || []).map(item => repeaterRow(fields, item)).join('')}</div>
        <button type="button" class="btn btn-outline btn-sm" data-add-row="${key}">${icon('plus')}<span>Add</span></button>`;
      const repeaterRow = (fields, item) => `<div class="repeater-row" style="grid-template-columns:${fields.map(f => f.width || '1fr').join(' ')} auto">
        ${fields.map(f => f.options
          ? `<select class="form-select" data-key="${f.key}" aria-label="${f.label}">${f.options.map(o => `<option${o === item[f.key] ? ' selected' : ''}>${o}</option>`).join('')}</select>`
          : f.long ? `<textarea class="form-textarea" data-key="${f.key}" rows="2" placeholder="${f.label}" aria-label="${f.label}">${esc(item[f.key] || '')}</textarea>`
            : `<input class="form-input" data-key="${f.key}" value="${esc(item[f.key] || '')}" placeholder="${f.label}" aria-label="${f.label}">`).join('')}
        <button type="button" class="btn btn-danger-ghost btn-icon" data-remove-row aria-label="Remove">${icon('trash')}</button></div>`;
      const LIST_FIELDS = {
        stats: [{ key: 'num', label: 'Number', width: '120px' }, { key: 'label', label: 'Label' }],
        goals: [{ key: 'icon', label: 'Icon', options: GOAL_ICONS, width: '130px' }, { key: 'title', label: 'Title', width: '1fr' }, { key: 'text', label: 'Text', long: true, width: '2fr' }],
        languages: [{ key: 'code', label: 'Code', width: '70px' }, { key: 'name', label: 'Language' }, { key: 'desc', label: 'Description' },
          { key: 'status', label: 'Status', options: ['Currently Offered', 'Coming Soon'], width: '170px' }],
      };
      content.innerHTML = pageHead('Homepage content', button('View website', { href: '/', icon: 'external' }), 'Edit the text on the public homepage. Changes appear on the website within a minute.') +
        `<form data-site-form>
        <div class="card mb-md"><div class="card-header"><h3>${icon('home')} Top of the page</h3></div><div class="card-body form-grid">
          <div class="form-group full"><label class="form-label" for="s-hero">Headline words (one per line, the middle one is highlighted)</label><textarea class="form-textarea" id="s-hero" name="hero_words" rows="5">${esc((s.hero_words || []).join('\n'))}</textarea></div>
          ${text('hero_label', 'Small label')}${text('hero_location', 'Subtitle')}${text('hero_tagline', 'Tagline', 2)}</div></div>
        <div class="card mb-md"><div class="card-header"><h3>${icon('info')} About</h3></div><div class="card-body form-grid">
          ${text('about_title', 'Heading')}<div></div>${text('about_body', 'Text (leave a blank line between paragraphs)', 7)}
          <div class="full"><div class="form-label">Highlights</div>${repeater('stats', LIST_FIELDS.stats, s.stats)}</div></div></div>
        <div class="card mb-md"><div class="card-header"><h3>${icon('target')} Goals</h3></div><div class="card-body form-grid">
          ${text('goals_title', 'Heading')}${text('goals_intro', 'Introduction')}<div class="full">${repeater('goals', LIST_FIELDS.goals, s.goals)}</div></div></div>
        <div class="card mb-md"><div class="card-header"><h3>${icon('globe')} Languages</h3></div><div class="card-body form-grid">
          ${text('languages_title', 'Heading')}${text('languages_intro', 'Introduction')}<div class="full">${repeater('languages', LIST_FIELDS.languages, s.languages)}</div></div></div>
        <div class="card mb-md"><div class="card-header"><h3>${icon('star')} Vision</h3></div><div class="card-body form-grid">
          ${text('vision_title', 'Heading')}<div></div>${text('vision_body', 'Text', 5)}${text('vision_quote', 'Quote', 2)}</div></div>
        <div class="card mb-md"><div class="card-header"><h3>${icon('phone')} Contact & social media</h3></div><div class="card-body form-grid">
          ${text('contact_address', 'Address')}${text('contact_phone', 'Phone / WhatsApp')}${text('contact_email', 'Email')}${text('office_hours', 'Office hours', 2)}
          ${text('social_facebook', 'Facebook link')}${text('social_instagram', 'Instagram link')}${text('social_tiktok', 'TikTok link')}${text('social_youtube', 'YouTube link')}</div></div>
        <button class="btn btn-primary btn-lg" type="submit">${icon('check')}<span>Save homepage</span></button></form>`;
      const form = content.querySelector('[data-site-form]');
      form.addEventListener('click', e => {
        const add = e.target.closest('[data-add-row]');
        if (add) form.querySelector(`[data-repeater="${add.dataset.addRow}"]`).insertAdjacentHTML('beforeend', repeaterRow(LIST_FIELDS[add.dataset.addRow], {}));
        const remove = e.target.closest('[data-remove-row]');
        if (remove) remove.closest('.repeater-row').remove();
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        run(e.submitter, async () => {
          const values = {};
          form.querySelectorAll('[name]').forEach(el => { values[el.name] = el.value.trim(); });
          values.hero_words = values.hero_words.split('\n').map(w => w.trim()).filter(Boolean);
          Object.keys(LIST_FIELDS).forEach(key => {
            values[key] = [...form.querySelectorAll(`[data-repeater="${key}"] .repeater-row`)].map(rowEl => {
              const item = {};
              rowEl.querySelectorAll('[data-key]').forEach(el => { item[el.dataset.key] = el.value.trim(); });
              return item;
            }).filter(item => Object.values(item).some(Boolean));
          });
          await api.put('/api/settings/site', values);
          toast('Homepage saved');
        });
      });
    };
  }

  /* ── Integrations ──────────────────────────────────────────────────── */
  const APP_ICONS = ['grid', 'book-open', 'video', 'file-text', 'folder', 'edit', 'calendar', 'globe', 'message-square', 'star', 'layers', 'monitor', 'link'];
  function appsAdminPage() {
    return crudPage({
      table: 'external_apps', title: 'Apps & integrations', singular: 'app', createLabel: 'Add app', canDelete: true,
      subtitle: 'Add Google Classroom, Drive folders, Forms, Moodle, H5P, Kahoot or any other tool. Users find them under "Apps" in their portal.',
      query: { order: 'position.asc,name.asc' }, search: false,
      columns: [
        { label: 'App', render: a => `<div class="td-name">${icon(a.icon || 'grid')} ${esc(a.name)}</div><div class="text-sm text-muted">${esc(a.description || '')}</div>` },
        { label: 'Link', render: a => `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="text-sm">${esc(a.url.slice(0, 48))}${a.url.length > 48 ? '…' : ''}</a>` },
        { label: 'Who sees it', key: 'audience' }, { label: 'Opens', render: a => (a.embed ? 'inside the portal' : 'new tab') },
        { label: 'Status', render: a => badge(a.active ? 'active' : 'inactive') }],
      fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Google Classroom' },
        { name: 'icon', label: 'Icon', type: 'select', options: APP_ICONS, default: 'grid' },
        { name: 'url', label: 'Link', type: 'url', required: true, full: true, placeholder: 'https://classroom.google.com' },
        { name: 'description', label: 'Short description', full: true },
        { name: 'audience', label: 'Who sees it', default: 'all', hint: '"all", or roles separated by commas: student, teacher, accounts, hr, director, admin' },
        { name: 'position', label: 'Order', type: 'number', default: 0 },
        { name: 'embed', label: 'Open inside the portal (works for Google Docs/Forms/Drive, YouTube, H5P …)', type: 'checkbox', full: true },
        { name: 'active', label: 'Active', type: 'checkbox', default: true }],
    });
  }

  function webhooksPage() {
    return async content => {
      const events = ['application.new', 'application.approved', 'enquiry.new', 'placement.new', 'payment.new', 'payment.confirmed',
        'exam_registration.new', 'certificate.issued', 'leave.new'];
      const render = crudPage({
        table: 'webhooks', title: 'Webhooks', singular: 'webhook', createLabel: 'Add webhook', canDelete: true, search: false,
        subtitle: 'Send events to Zapier, Make, n8n, Google Apps Script or your own tools. Each request is signed (X-Heimatliebe-Signature: sha256 HMAC of the body using the secret).',
        columns: [
          { label: 'Name', key: 'name', cls: 'td-name' }, { label: 'Events', render: h => `<span class="text-sm">${esc(h.events)}</span>` },
          { label: 'Last delivery', render: h => h.last_sent_at ? `${esc(h.last_status || '')} · ${timeAgo(h.last_sent_at)}` : 'never' },
          { label: 'Status', render: h => badge(h.active ? 'active' : 'inactive') }],
        fields: [
          { name: 'name', label: 'Name', required: true, placeholder: 'Zapier — new applications' },
          { name: 'url', label: 'Receiver URL (https)', type: 'url', required: true, full: true },
          { name: 'events', label: 'Events', default: '*', full: true, hint: `"*" for all, or a comma-separated list: ${events.join(', ')}` },
          { name: 'active', label: 'Active', type: 'checkbox', default: true }],
        actions: [{ label: 'Secret', icon: 'key', run: h => openModal('Signing secret', `<p class="text-sm">Use this secret on the receiving side to verify the signature.</p><div class="id-box" style="font-size:.85rem">${esc(h.secret)}</div>`) }],
      });
      await render(content);
    };
  }

  /* ── Users, reports, settings, audit ───────────────────────────────── */
  function usersPage() {
    return crudPage({
      table: 'users', title: 'Students & users', singular: 'user', query: { order: 'created_at.desc' }, canCreate: false, wideForm: true, report: 'students',
      toolbar: button('Add user', { href: '/hr/?page=adduser', icon: 'user-plus', cls: 'btn-primary btn-sm' }).replace(' target="_blank" rel="noopener"', ''),
      filters: [{ name: 'role', label: 'Role', options: ['student', 'teacher', 'accounts', 'hr', 'director', 'admin', 'superadmin'] },
        { name: 'status', label: 'Status', options: ['active', 'inactive', 'suspended', 'graduated'] }],
      columns: [{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Role', key: 'role' },
        { label: 'Course / department', render: u => esc(u.course || u.department || '—') },
        { label: 'Last sign-in', render: u => (u.last_login_at ? timeAgo(u.last_login_at) : 'never') }, { label: 'Status', render: u => badge(u.status) }],
      fields: [{ name: 'full_name', label: 'Full name', required: true, full: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'role', label: 'Role', type: 'select', options: ['student', 'teacher', 'accounts', 'hr', 'director', 'admin'], required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended', 'graduated'], required: true },
        { name: 'course', label: 'Course' }, { name: 'level', label: 'Level', type: 'select', options: LEVELS }, { name: 'department', label: 'Department' }],
      actions: [{ label: 'Reset password', icon: 'key', run: async u => {
        if (!(await confirmDialog(`Reset the password for ${u.full_name}?`))) return;
        const res = await api.post(`/api/users/${u.id}/reset-password`);
        openModal('Temporary password', `<p>Give <strong>${esc(u.full_name)}</strong> (${esc(u.user_id)}) this temporary password. They must choose a new one when they sign in.</p><div class="id-box">${esc(res.new_password)}</div>`);
      } }, { label: 'Report', icon: 'file-text', show: u => u.role === 'student', run: u => { global.open(`/api/students/${u.id}/report.html`, '_blank', 'noopener'); } }],
    });
  }

  function reportsPage() {
    const reports = [
      ['students', 'Students', 'Every student with contact and guardian details'], ['staff', 'Staff', 'Staff directory'],
      ['applications', 'Applications', 'The admissions pipeline'], ['enquiries', 'Enquiries', 'Leads and their status'],
      ['placements', 'Placement tests', 'Results and recommended levels'], ['payments', 'Payments', 'All payments'],
      ['invoices', 'Invoices', 'Invoices and balances'], ['results', 'Exam results', 'All exam results'], ['attendance', 'Attendance', 'Attendance records']];
    return async content => {
      content.innerHTML = pageHead('Reports', '', 'CSV files that open in Excel or Google Sheets.') + `<div class="grid-auto">${reports.map(([key, title, text]) => `
        <div class="card"><div class="card-body"><h3>${icon('bar-chart')} ${title}</h3><p class="text-sm text-muted">${text}</p>
        ${button('Download', { href: `/api/reports/${key}.csv`, icon: 'download', cls: 'btn-outline btn-sm' })}</div></div>`).join('')}</div>`;
    };
  }

  function institutionPage() {
    return async content => {
      const i = await api.get('/api/settings/institution');
      const field = (name, label, type) => `<div class="form-group"><label class="form-label" for="i-${name}">${label}</label><input class="form-input" id="i-${name}" name="${name}" type="${type || 'text'}" value="${esc(i[name] == null ? '' : i[name])}"></div>`;
      content.innerHTML = pageHead('Institution settings', '', 'Used on the website, emails, invoices, receipts, report cards and certificates.') + `<div class="card"><div class="card-body">
        <form class="form-grid" data-inst>
        ${field('name', 'Institute name')}${field('tagline', 'Tagline')}${field('location', 'Location')}${field('phone', 'Phone', 'tel')}${field('email', 'Email', 'email')}${field('currency', 'Currency')}
        <div class="form-group"><label class="form-label" for="i-term">Current term</label><select class="form-select" id="i-term" name="current_term">${['Term 1', 'Term 2', 'Term 3', 'Term 4'].map(t => `<option${t === i.current_term ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${field('academic_year', 'Academic year')}${field('pass_mark', 'Default pass mark (%)', 'number')}${field('attendance_alert_threshold', 'Attendance warning below (%)', 'number')}${field('application_fee', 'Application fee', 'number')}
        <div class="form-group full"><label class="form-label" for="i-langs">Languages offered (comma-separated)</label><input class="form-input" id="i-langs" name="languages" value="${esc((i.languages || []).join(', '))}"></div>
        <div class="form-group full"><label class="check"><input type="checkbox" name="enrolment_open"${i.enrolment_open ? ' checked' : ''}> Online applications are open</label></div>
        <div class="full"><button class="btn btn-primary" type="submit">Save settings</button></div></form></div></div>`;
      content.querySelector('[data-inst]').addEventListener('submit', e => {
        e.preventDefault();
        run(e.submitter, async () => {
          const values = formValues(e.target);
          values.languages = String(values.languages || '').split(',').map(x => x.trim()).filter(Boolean);
          values.academic_year = String(values.academic_year || '');
          await api.put('/api/settings/institution', values);
          toast('Settings saved');
        });
      });
    };
  }

  function auditPage() {
    return crudPage({
      table: 'audit_logs', title: 'Audit log', subtitle: 'Who changed what, and when.', canCreate: false, canEdit: false,
      query: { order: 'created_at.desc' }, expand: 'user', pageSize: 50,
      columns: [{ label: 'When', render: a => formatDateTime(a.created_at) }, { label: 'Who', render: a => esc(a.user ? a.user.full_name : 'Website visitor / system') },
        { label: 'Action', render: a => `<strong>${esc(a.action)}</strong>` }, { label: 'Area', key: 'entity' },
        { label: 'Details', render: a => `<span class="mono">${esc(a.details ? JSON.stringify(a.details) : '')}</span>` }, { label: 'IP', key: 'ip', cls: 'td-id' }],
    });
  }

  Object.assign(global, {
    applicationsPage, reviewApplication, enquiriesPage, placementsPage, coursesPage, classesPage, teachersPage, feedbackPage,
    certificatesPage, examSessionsPage, newsPage, galleryPage, documentsPage, testimonialsPage, libraryPage, scholarshipsPage,
    alumniPage, siteContentPage, appsAdminPage, webhooksPage, usersPage, reportsPage, institutionPage, auditPage,
    studentLookup, classLookup, teacherLookup, LEVELS, LANGUAGES,
  });
})(window, document);
