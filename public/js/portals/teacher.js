/**
 * Teacher portal: classes and rosters, attendance, assignments, exams with a question builder,
 * marking, gradebook, CEFR skills assessments, announcements and messages.
 */
(function () {
  'use strict';
  const me = () => session.get() || {};
  const isTeacher = () => me().role === 'teacher';
  const myClassesQuery = () => (isTeacher() ? `teacher_id=eq.${me().id}&order=name.asc` : 'order=name.asc');
  const classLookup = { table: 'classes', query: myClassesQuery(), label: c => c.name };

  const nav = [
    { icon: 'grid', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'school', label: 'My classes', page: 'classes', section: 'Teaching' },
    { icon: 'check-square', label: 'Attendance', page: 'attendance' },
    { icon: 'file-text', label: 'Assignments', page: 'assignments' },
    { icon: 'edit', label: 'Exams', page: 'exams' },
    { icon: 'check-circle', label: 'Marking', page: 'marking' },
    { icon: 'book', label: 'Gradebook', page: 'gradebook' },
    { icon: 'target', label: 'Skills (CEFR)', page: 'skills' },
    { icon: 'users', label: 'Students', page: 'students' },
    { icon: 'clock', label: 'Timetable', page: 'timetable' },
    { icon: 'calendar', label: 'Calendar', page: 'calendar' },
    { icon: 'grid', label: 'Apps', page: 'apps' },
    { icon: 'message-square', label: 'Messages', page: 'messages', section: 'Communication' },
    { icon: 'megaphone', label: 'Announcements', page: 'announcements' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'umbrella', label: 'Leave', page: 'leave', section: 'Account' },
    { icon: 'user', label: 'My profile', page: 'profile' },
  ];
  const pages = {};
  const classOptions = async () => (await cachedRows('classes', myClassesQuery())).map(c => ({ value: c.id, label: c.name }));
  const classSelect = (opts, attr) => `<select class="form-select" ${attr} aria-label="Class">${opts.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>`;
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;
  const item = (title, meta) => `<div class="list-item"><div class="li-title">${title}</div>${meta ? `<div class="li-meta">${meta}</div>` : ''}</div>`;

  pages.dashboard = async content => {
    const d = await api.get('/api/dashboard/teacher');
    const students = d.classes.reduce((n, c) => n + c.students, 0);
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Teacher dashboard</div><h1>${esc(me().full_name)}</h1><p>${esc(me().department || 'Teaching')} · ${esc(me().user_id)}</p></div>` +
      stats([{ value: d.classes.length, label: 'My classes', icon: 'school', page: 'classes' }, { value: students, label: 'Students', icon: 'users', page: 'students' },
        { value: d.pending_count, label: 'Work to mark', icon: 'check-circle', page: 'marking', accent: d.pending_count > 0 },
        { value: d.exams_to_review, label: 'Exams to review', icon: 'edit', page: 'marking' },
        { value: d.unread.messages, label: 'Unread messages', icon: 'message-square', page: 'messages' }]) +
      `<div class="grid-2">
        ${card('Today', 'clock', d.today.length ? d.today.map(t => item(`${esc(t.start_time)}–${esc(t.end_time)} · ${esc(t.name)}`,
          `Room ${esc(t.room || '—')} · <a href="?page=attendance&class=${t.class_id}" data-action="takeAttendance" data-class="${t.class_id}">Take attendance</a>`)).join('') : '<p class="text-muted text-sm">No classes today.</p>')}
        ${card('Waiting to be marked', 'check-circle', d.pending_submissions.length ? d.pending_submissions.map(p => item(`${esc(p.full_name)} — ${esc(p.title)}`, timeAgo(p.submitted_at))).join('') +
          `<p class="mt-sm">${button('Open marking', { action: 'go', data: { page: 'marking' }, cls: 'btn-primary btn-sm' })}</p>` : '<p class="text-muted text-sm">All caught up.</p>')}
        ${card('Upcoming exams', 'edit', d.upcoming_exams.length ? d.upcoming_exams.map(e => item(`${esc(e.title)} ${e.published ? '' : badge('draft')}`, formatDateTime(e.date))).join('') : '<p class="text-muted text-sm">No upcoming exams.</p>')}
        ${card('Announcements', 'megaphone', await announcementsFeed(4))}
      </div>`;
  };
  actions({ takeAttendance: el => go('attendance', { params: { class: el.dataset.class } }) });

  pages.classes = async content => {
    const d = await api.get('/api/dashboard/teacher');
    const classes = isTeacher() ? d.classes : await api.rows('classes', { order: 'name.asc' });
    content.innerHTML = pageHead('My classes') + (classes.length ? `<div class="grid-auto">${classes.map(c => `<div class="card"><div class="card-body">
        <h3>${esc(c.name)}</h3><p class="text-sm text-muted">${esc(c.schedule || 'Schedule to be confirmed')} · Room ${esc(c.room || '—')}</p>
        ${c.students != null ? `<div class="progress mt-sm"><span style="width:${Math.min(100, c.students / (c.max_students || 30) * 100)}%"></span></div>
        <p class="text-sm text-muted mt-sm">${c.students} of ${c.max_students || '∞'} seats taken</p>` : ''}</div>
        <div class="card-footer">${button('Roster', { action: 'roster', data: { id: c.id }, icon: 'users', cls: 'btn-primary btn-sm' })}
        ${button('Online link', { action: 'classLink', data: { id: c.id }, icon: 'video' })}
        ${button('Notify class', { action: 'notifyClass', data: { id: c.id, name: c.name }, icon: 'bell' })}</div></div>`).join('')}</div>`
      : emptyState('school', 'No classes have been assigned to you yet.'));
  };

  actions({
    roster: async el => {
      const r = await api.get(`/api/classes/${el.dataset.id}/roster`);
      openModal(`${r.class.name} — roster`, table([
        { label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Phone', key: 'phone' },
        { label: 'Status', render: s => badge(s.status) },
        { label: 'Attendance', render: s => (s.attendance && s.attendance.rate != null ? `<span class="${s.attendance.rate < 75 ? 'risk' : ''}">${s.attendance.rate}%</span>` : '—') },
        { label: '', render: s => button('Report', { href: `/api/students/${s.id}/report.html`, icon: 'file-text', cls: 'btn-ghost btn-sm' }) }],
        r.students, { empty: 'No students enrolled.' }) + `<p class="mt-md">${button('Export', { action: 'exportRoster', icon: 'download' })}</p>`, { wide: true });
      actions({ exportRoster: () => downloadCSV(`${r.class.name}.csv`, ['Name', 'ID', 'Email', 'Phone'], r.students.map(s => [s.full_name, s.user_id, s.email, s.phone])) });
    },
    classLink: async el => {
      const c = await api.row('classes', el.dataset.id);
      formModal('Online class', [{ name: 'meeting_url', label: 'Google Meet / Zoom / Teams link', type: 'url', full: true },
        { name: 'room', label: 'Room' }, { name: 'schedule', label: 'Schedule' }],
        c, async values => { await api.update('classes', c.id, values); clearCache('classes'); toast('Saved'); });
    },
    notifyClass: el => formModal(`Notify ${el.dataset.name}`, [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'body', label: 'Message', type: 'textarea', full: true }],
      {}, async values => { const r = await api.post('/api/notifications/send', Object.assign(values, { class_id: el.dataset.id })); toast(`Sent to ${r.sent} students`); }),
  });

  /* Attendance: pick class and date, everyone defaults to present, one save for the whole class. */
  pages.attendance = async (content, params) => {
    const opts = await classOptions();
    if (!opts.length) { content.innerHTML = pageHead('Attendance') + emptyState('check-square', 'No classes assigned.'); return; }
    content.innerHTML = pageHead('Attendance') + `<div class="toolbar">${classSelect(opts, 'data-att-class')}
      <input class="form-input" type="date" data-att-date value="${todayISO()}" aria-label="Date"></div><div data-att-body>${skeleton(200)}</div>`;
    const classSel = content.querySelector('[data-att-class]');
    const dateInput = content.querySelector('[data-att-date]');
    if (params.get('class')) classSel.value = params.get('class');
    async function load() {
      const classId = classSel.value;
      const date = dateInput.value;
      const [roster, existing] = await Promise.all([api.get(`/api/classes/${classId}/roster`), api.rows('attendance', { class_id: `eq.${classId}`, date: `eq.${date}` })]);
      const students = roster.students.filter(s => s.status === 'active');
      const saved = id => existing.find(e => e.user_id === id) || {};
      const holder = content.querySelector('[data-att-body]');
      if (!students.length) { holder.innerHTML = emptyState('users', 'No active students in this class.'); return; }
      holder.innerHTML = `<div class="flex gap-sm items-center mb-sm flex-wrap">${button('Everyone present', { action: 'allPresent', icon: 'check' })}
          <span class="text-sm text-muted">${existing.length ? 'Already saved for this date — you can still change it.' : 'Not taken yet for this date.'}</span></div>` +
        table([{ label: 'Student', key: 'full_name', cls: 'td-name' },
          { label: 'Overall', render: s => (s.attendance && s.attendance.rate != null ? s.attendance.rate + '%' : '—') },
          { label: 'Status', render: s => `<div class="flex gap-sm flex-wrap">${['present', 'late', 'absent', 'excused'].map(st =>
            `<label class="check"><input type="radio" name="st-${s.id}" value="${st}"${(saved(s.id).status || 'present') === st ? ' checked' : ''}> ${st}</label>`).join('')}</div>` },
          { label: 'Note', render: s => `<input class="form-input" data-note="${s.id}" value="${esc(saved(s.id).notes || '')}" aria-label="Note for ${esc(s.full_name)}">` }], students) +
        `<button class="btn btn-primary mt-md" data-save>${icon('check')}<span>Save attendance</span></button>`;
      holder.querySelector('[data-save]').addEventListener('click', e => run(e.currentTarget, async () => {
        const records = students.map(s => ({ user_id: s.id, status: holder.querySelector(`input[name="st-${s.id}"]:checked`).value,
          notes: holder.querySelector(`[data-note="${s.id}"]`).value || null }));
        await api.post('/api/attendance/bulk', { class_id: classId, date, records });
        toast(`Attendance saved · ${records.filter(r => r.status === 'absent').length} absent`);
        load();
      }));
    }
    actions({ allPresent: () => content.querySelectorAll('input[value="present"]').forEach(r => { r.checked = true; }) });
    classSel.addEventListener('change', load);
    dateInput.addEventListener('change', load);
    load();
  };

  pages.assignments = crudPage({
    table: 'assignments', title: 'Assignments', singular: 'assignment', createLabel: 'New assignment', canDelete: true, wideForm: true,
    query: { order: 'due_date.desc' }, expand: 'class',
    columns: [
      { label: 'Assignment', render: a => `<div class="td-name">${esc(a.title)}</div>${a.skill ? `<div class="text-sm text-muted">${esc(a.skill)}</div>` : ''}` },
      { label: 'Class', render: a => esc(a.class ? a.class.name : 'General') }, { label: 'Due', render: a => formatDateTime(a.due_date) },
      { label: 'Points', key: 'total_points' }, { label: 'Visible', render: a => badge(a.published ? 'published' : 'draft') }],
    fields: [
      { name: 'title', label: 'Title', required: true, full: true }, { name: 'class_id', label: 'Class', type: 'lookup', lookup: classLookup, required: true },
      { name: 'skill', label: 'Skill', type: 'select', options: ['reading', 'writing', 'listening', 'speaking', 'grammar', 'vocabulary'] },
      { name: 'due_date', label: 'Due', type: 'datetime' }, { name: 'total_points', label: 'Points', type: 'number', default: 100, min: 1 },
      { name: 'description', label: 'Instructions', type: 'textarea', rows: 6, full: true },
      { name: 'attachment_url', label: 'Material: paste a Google Docs/Drive/YouTube link or upload a file', type: 'filelink', bucket: 'documents', full: true },
      { name: 'published', label: 'Visible to students (they get a notification)', type: 'checkbox', default: true, full: true }],
  });

  pages.exams = crudPage({
    table: 'exams', title: 'Exams', singular: 'exam', createLabel: 'New exam', canDelete: true, wideForm: true,
    subtitle: 'Create the exam, add questions, then publish it. Multiple-choice and short answers with an answer key are marked automatically.',
    query: { order: 'date.desc' }, expand: 'class',
    columns: [
      { label: 'Exam', render: e => `<span class="td-name">${esc(e.title)}</span>` }, { label: 'Class', render: e => esc(e.class ? e.class.name : '—') },
      { label: 'Opens', render: e => formatDateTime(e.date) }, { label: 'Duration', render: e => (e.duration_minutes ? e.duration_minutes + ' min' : '—') },
      { label: 'Questions', render: e => (e.questions || []).length }, { label: 'Status', render: e => badge(e.published ? 'published' : 'draft') }],
    fields: [
      { name: 'title', label: 'Title', required: true, full: true }, { name: 'class_id', label: 'Class', type: 'lookup', lookup: classLookup, required: true },
      { name: 'date', label: 'Opens at', type: 'datetime', required: true }, { name: 'close_date', label: 'Closes at (optional)', type: 'datetime' },
      { name: 'duration_minutes', label: 'Time allowed (minutes)', type: 'number', default: 60 }, { name: 'pass_mark', label: 'Pass mark (%)', type: 'number', default: 50 },
      { name: 'description', label: 'Instructions', type: 'textarea', full: true }],
    actions: [
      { label: 'Questions', icon: 'list', cls: 'btn-primary', run: (e, reload) => questionBuilder(e, reload) },
      { label: e => (e.published ? 'Unpublish' : 'Publish'), run: async (e, reload) => {
        await api.update('exams', e.id, { published: !e.published });
        toast(e.published ? 'Unpublished' : 'Published — students have been notified');
        reload();
      } },
      { label: 'Results', icon: 'bar-chart', run: e => examResults(e) }],
  });

  /** Visual question editor: multiple choice (auto-marked) and short/open answers. */
  function questionBuilder(exam, reload) {
    const qs = JSON.parse(JSON.stringify(exam.questions || []));
    const body = openModal(`Questions — ${exam.title}`, `<div data-qb></div>
      <div class="flex gap-sm flex-wrap mt-md">${button('Multiple choice', { action: 'qbAddMcq', icon: 'plus' })}${button('Short / open answer', { action: 'qbAddText', icon: 'plus' })}
      <button class="btn btn-primary" data-qb-save>${icon('check')}<span>Save questions</span></button></div>
      <p class="form-hint mt-sm">Open questions without accepted answers go to your marking queue.</p>`, { wide: true });
    const holder = body.querySelector('[data-qb]');
    const read = () => holder.querySelectorAll('.builder-item').forEach(el => {
      const q = qs[+el.dataset.i];
      const val = f => el.querySelector(`[data-f="${f}"]`).value;
      q.text = val('text');
      q.points = Number(val('points')) || 1;
      if (q.type === 'mcq') {
        q.options = val('options').split('\n').map(x => x.trim()).filter(Boolean);
        q.answer = val('answer') ? Number(val('answer')) - 1 : null;
      } else {
        const accepted = val('answer').split(',').map(x => x.trim()).filter(Boolean);
        q.answer = accepted.length ? accepted : null;
      }
    });
    const render = () => {
      holder.innerHTML = qs.length ? qs.map((q, i) => `<div class="builder-item" data-i="${i}">
        <div class="flex justify-between items-center"><strong>Question ${i + 1} · ${q.type === 'mcq' ? 'multiple choice' : 'text answer'}</strong>
          <button type="button" class="btn btn-danger-ghost btn-icon" data-qb-remove="${i}" aria-label="Remove question">${icon('trash')}</button></div>
        <div class="form-group mt-sm"><input class="form-input" data-f="text" value="${esc(q.text || '')}" placeholder="Question" aria-label="Question"></div>
        ${q.type === 'mcq'
          ? `<div class="form-group"><textarea class="form-textarea" data-f="options" rows="3" placeholder="One answer option per line" aria-label="Options">${esc((q.options || []).join('\n'))}</textarea></div>
            <div class="form-row"><div class="form-group"><label class="form-label">Correct option number</label><input class="form-input" type="number" min="1" data-f="answer" value="${q.answer != null ? q.answer + 1 : ''}"></div>`
          : `<div class="form-row"><div class="form-group"><label class="form-label">Accepted answers (comma-separated, blank = mark by hand)</label><input class="form-input" data-f="answer" value="${esc([].concat(q.answer || []).join(', '))}"></div>`}
          <div class="form-group"><label class="form-label">Points</label><input class="form-input" type="number" min="0" data-f="points" value="${q.points || 1}"></div></div></div>`).join('')
        : '<p class="text-muted">No questions yet — add the first one below.</p>';
      holder.querySelectorAll('[data-qb-remove]').forEach(b => b.addEventListener('click', () => { read(); qs.splice(+b.dataset.qbRemove, 1); render(); }));
    };
    actions({
      qbAddMcq: () => { read(); qs.push({ type: 'mcq', text: '', options: [], answer: null, points: 1 }); render(); },
      qbAddText: () => { read(); qs.push({ type: 'text', text: '', answer: null, points: 1 }); render(); },
    });
    body.querySelector('[data-qb-save]').addEventListener('click', e => run(e.currentTarget, async () => {
      read();
      const bad = qs.findIndex(q => !q.text || (q.type === 'mcq' && (q.options.length < 2 || q.answer == null || q.answer < 0 || q.answer >= q.options.length)));
      if (bad >= 0) throw new Error(`Question ${bad + 1} is incomplete: it needs text, at least two options and a valid correct option.`);
      await api.update('exams', exam.id, { questions: qs });
      closeModal();
      toast('Questions saved');
      reload();
    }));
    render();
  }

  async function examResults(exam) {
    const rows = await api.rows('exam_results', { exam_id: `eq.${exam.id}`, expand: 'user', order: 'percentage.desc' });
    const avg = rows.length ? (rows.reduce((a, r) => a + (r.percentage || 0), 0) / rows.length).toFixed(1) : '—';
    openModal(`Results — ${exam.title}`, `<p class="mb-md">${rows.length} submitted · average ${avg}% · ${rows.filter(r => r.passed).length} passed</p>` +
      table([{ label: 'Student', render: r => esc(r.user ? r.user.full_name : '—') }, { label: 'Score', render: r => `${r.score}/${r.total_points}` },
        { label: '%', render: r => r.percentage + '%' }, { label: 'Result', render: r => (r.needs_review ? badge('pending', 'to review') : badge(r.passed ? 'pass' : 'fail')) }], rows), { wide: true });
  }

  /* Marking queue: handed-in work and exam answers that need a teacher. */
  pages.marking = async content => {
    const [subs, reviews] = await Promise.all([
      api.rows('submissions', { grade: 'is.null', order: 'submitted_at.asc', expand: 'user,assignment', limit: 200 }),
      api.rows('exam_results', { needs_review: 'is.true', order: 'submitted_at.asc', expand: 'user,exam', limit: 200 })]);
    content.innerHTML = pageHead('Marking', button('Recently marked', { action: 'recentlyMarked', icon: 'clock' })) +
      `<div class="tabs" role="tablist"><button class="tab active" data-tab="work">Assignments (${subs.length})</button><button class="tab" data-tab="exams">Exams to review (${reviews.length})</button></div><div data-queue></div>`;
    const queue = content.querySelector('[data-queue]');
    const show = tab => {
      content.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      queue.innerHTML = tab === 'work'
        ? table([{ label: 'Student', render: s => `<span class="td-name">${esc(s.user ? s.user.full_name : '—')}</span>` }, { label: 'Assignment', render: s => esc(s.assignment ? s.assignment.title : '—') },
          { label: 'Handed in', render: s => timeAgo(s.submitted_at) }, { label: '', render: s => button('Mark', { action: 'markWork', data: { id: s.id }, cls: 'btn-primary btn-sm' }) }], subs, { empty: 'Nothing to mark.' })
        : table([{ label: 'Student', render: r => `<span class="td-name">${esc(r.user ? r.user.full_name : '—')}</span>` }, { label: 'Exam', render: r => esc(r.exam ? r.exam.title : '—') },
          { label: 'Automatic score', render: r => `${r.score}/${r.total_points}` }, { label: '', render: r => button('Review', { action: 'reviewExam', data: { id: r.id }, cls: 'btn-primary btn-sm' }) }], reviews, { empty: 'No exams need reviewing.' });
    };
    content.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    show('work');
  };

  actions({
    recentlyMarked: async () => {
      const done = await api.rows('submissions', { grade: 'not.is.null', order: 'graded_at.desc', expand: 'user,assignment', limit: 50 });
      openModal('Recently marked', table([{ label: 'Student', render: s => esc(s.user ? s.user.full_name : '') }, { label: 'Assignment', render: s => esc(s.assignment ? s.assignment.title : '') },
        { label: 'Grade', render: s => `${s.grade}/${s.assignment ? s.assignment.total_points : ''}` }, { label: '', render: s => button('Edit', { action: 'markWork', data: { id: s.id }, cls: 'btn-ghost btn-sm' }) }], done), { wide: true });
    },
    markWork: async el => {
      const s = await api.row('submissions', el.dataset.id, { expand: 'user,assignment' });
      const max = s.assignment ? s.assignment.total_points : 100;
      const body = openModal(`Mark — ${s.user ? s.user.full_name : ''}`, `<p class="text-sm text-muted">${esc(s.assignment ? s.assignment.title : '')} · handed in ${formatDateTime(s.submitted_at)}</p>
        <div class="card mb-md"><div class="card-body" style="white-space:pre-wrap">${esc(s.content || '(no text)')}</div></div>
        ${s.file_url ? `<p class="mb-md">${button('Open attached file', { href: s.file_url, icon: 'paperclip' })}</p>` : ''}
        <form data-mark><div class="form-row"><div class="form-group"><label class="form-label" for="grade">Grade (out of ${max})</label>
          <input class="form-input" id="grade" type="number" name="grade" min="0" max="${max}" step="0.5" value="${s.grade == null ? '' : s.grade}" required></div></div>
        <div class="form-group"><label class="form-label" for="fb">Feedback</label><textarea class="form-textarea" id="fb" name="feedback" rows="4">${esc(s.feedback || '')}</textarea></div>
        <button class="btn btn-primary" type="submit">Save grade</button></form>`, { wide: true });
      body.querySelector('[data-mark]').addEventListener('submit', e => {
        e.preventDefault();
        run(e.submitter, async () => {
          await api.update('submissions', s.id, { grade: Number(e.target.grade.value), feedback: e.target.feedback.value, graded_by: me().id, graded_at: new Date().toISOString() });
          closeModal();
          toast('Grade saved — the student has been notified');
          refresh();
        });
      });
    },
    reviewExam: async el => {
      const r = await api.row('exam_results', el.dataset.id, { expand: 'user' });
      const exam = await api.row('exams', r.exam_id);
      const qs = exam.questions || [];
      const accepted = q => [].concat(q.answer || []).map(a => String(a).toLowerCase());
      const body = openModal(`Review — ${r.user ? r.user.full_name : ''}`, `<form data-review>${qs.map((q, i) => {
        const given = (r.answers || {})[i];
        const shown = q.type === 'mcq' ? ((q.options || [])[given] == null ? '—' : q.options[given]) : given || '—';
        const auto = q.type === 'mcq' ? (Number(given) === q.answer ? q.points || 1 : 0)
          : (q.answer ? (accepted(q).includes(String(given || '').trim().toLowerCase()) ? q.points || 1 : 0) : '');
        return `<div class="question"><div class="question-text">${i + 1}. ${esc(q.text)}</div><div class="text-sm">Answer: <strong>${esc(shown)}</strong></div>
          <label class="form-label mt-sm" for="q${i}">Points (max ${q.points || 1})</label>
          <input class="form-input" id="q${i}" type="number" step="0.5" min="0" max="${q.points || 1}" data-q="${i}" value="${auto}" required style="max-width:120px"></div>`;
      }).join('')}
        <div class="form-group"><label class="form-label" for="efb">Feedback</label><textarea class="form-textarea" id="efb" name="feedback" rows="3"></textarea></div>
        <button class="btn btn-primary" type="submit">Save result</button></form>`, { wide: true });
      body.querySelector('[data-review]').addEventListener('submit', e => {
        e.preventDefault();
        run(e.submitter, async () => {
          const score = [...body.querySelectorAll('[data-q]')].reduce((sum, input) => sum + Number(input.value || 0), 0);
          const total = qs.reduce((sum, q) => sum + (q.points || 1), 0);
          const pct = Math.round(score / total * 1000) / 10;
          await api.update('exam_results', r.id, { score, percentage: pct, passed: pct >= (exam.pass_mark || 50), needs_review: false,
            feedback: e.target.feedback.value, graded_by: me().id, graded_at: new Date().toISOString() });
          closeModal();
          toast(`Saved: ${pct}%`);
          refresh();
        });
      });
    },
  });

  pages.gradebook = async content => {
    const opts = await classOptions();
    if (!opts.length) { content.innerHTML = pageHead('Gradebook') + emptyState('book', 'No classes.'); return; }
    content.innerHTML = pageHead('Gradebook') + `<div class="toolbar">${classSelect(opts, 'data-gb-class')}${button('Export', { action: 'exportGradebook', icon: 'download' })}</div><div data-gb>${skeleton(200)}</div>`;
    let data;
    const load = async () => {
      data = await api.get(`/api/classes/${content.querySelector('[data-gb-class]').value}/gradebook`);
      const columns = [
        { label: 'Student', render: s => `<a href="/api/students/${s.id}/report.html" target="_blank" rel="noopener">${esc(s.full_name)}</a>` },
        ...data.assignments.map(a => ({ label: a.title.slice(0, 18), render: s => (s.assignments[a.id] != null ? `${s.assignments[a.id]}/${a.total_points}` : '·') })),
        ...data.exams.map(e => ({ label: 'Exam: ' + e.title.slice(0, 14), render: s => (s.exams[e.id] != null ? s.exams[e.id] + '%' : '·') })),
        { label: 'Average', render: s => (s.average != null ? `<strong class="${s.average < 50 ? 'risk' : ''}">${s.average}%</strong>` : '—') },
        { label: 'Attendance', render: s => (s.attendance && s.attendance.rate != null ? `<span class="${s.attendance.rate < 75 ? 'risk' : ''}">${s.attendance.rate}%</span>` : '—') }];
      content.querySelector('[data-gb]').innerHTML = `<div class="gradebook">${table(columns, data.students, { empty: 'No students.' })}</div>`;
    };
    actions({ exportGradebook: () => downloadCSV(`gradebook-${data.class.name}.csv`,
      ['Student', ...data.assignments.map(a => a.title), ...data.exams.map(e => e.title), 'Average', 'Attendance %'],
      data.students.map(s => [s.full_name, ...data.assignments.map(a => (s.assignments[a.id] == null ? '' : s.assignments[a.id])),
        ...data.exams.map(e => (s.exams[e.id] == null ? '' : s.exams[e.id])), s.average == null ? '' : s.average, s.attendance ? s.attendance.rate : ''])) });
    content.querySelector('[data-gb-class]').addEventListener('change', load);
    load();
  };

  const skillField = name => ({ name, label: `${name.charAt(0).toUpperCase() + name.slice(1)} (0–100)`, type: 'number', min: 0, max: 100 });
  pages.skills = crudPage({
    table: 'skill_assessments', title: 'Skills assessments (CEFR)', singular: 'assessment', createLabel: 'New assessment', canDelete: true, search: false,
    subtitle: 'Rate each student on the four skills each term. Students see this on their progress page and report card.',
    query: { order: 'created_at.desc' }, expand: 'user',
    columns: [{ label: 'Student', render: r => esc(r.user ? r.user.full_name : '—') }, { label: 'Term', key: 'term' },
      { label: 'Reading / Writing / Listening / Speaking', render: r => [r.reading, r.writing, r.listening, r.speaking].map(v => (v == null ? '–' : v)).join(' / ') },
      { label: 'CEFR', render: r => `<strong>${esc(r.cefr_level || '—')}</strong>` }, { label: 'Date', render: r => formatDate(r.created_at) }],
    fields: [
      { name: 'user_id', label: 'Student', type: 'lookup', required: true, lookup: { table: 'users', query: 'role=eq.student&order=full_name.asc', label: u => `${u.full_name} (${u.user_id})` } },
      { name: 'class_id', label: 'Class', type: 'lookup', lookup: classLookup }, { name: 'term', label: 'Term', placeholder: 'Term 1 2026' },
      { name: 'cefr_level', label: 'CEFR level', type: 'select', options: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
      skillField('reading'), skillField('writing'), skillField('listening'), skillField('speaking'),
      { name: 'comments', label: 'Comments', type: 'textarea', full: true }],
  });

  pages.students = crudPage({
    table: 'users', title: 'My students', query: { role: 'eq.student', order: 'full_name.asc' }, canCreate: false, canEdit: false,
    columns: [{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Level', key: 'level' },
      { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }],
    actions: [{ label: 'Report', icon: 'file-text', run: u => { window.open(`/api/students/${u.id}/report.html`, '_blank', 'noopener'); } }],
  });

  pages.timetable = timetablePage('My teaching timetable');
  pages.calendar = calendarPage(false);
  pages.apps = appsPage();
  pages.messages = messagesPage();
  pages.announcements = announcementsAdmin({ classLookup, classRequired: true, audiences: ['students', 'all'] });
  pages.notifications = notificationsPage();
  pages.leave = leavePage();
  pages.profile = profilePage();

  onEvent('search:open', r => { if (r.type === 'user') window.open(`/api/students/${r.id}/report.html`, '_blank', 'noopener'); });
  startPortal({ roles: ['teacher', 'admin'], nav, pages });
})();
