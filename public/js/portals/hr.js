/**
 * HR portal: staff, teachers and students, adding users (automatic IDs and temporary passwords),
 * password resets, leave approvals, attendance records, staff announcements and reports.
 */
(function () {
  'use strict';
  const isAdmin = () => ['admin', 'superadmin'].includes((session.get() || {}).role);

  const nav = [
    { icon: 'grid', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'users', label: 'Staff', page: 'staff', section: 'People' },
    { icon: 'school', label: 'Teachers', page: 'teachers' },
    { icon: 'graduation', label: 'Students', page: 'students' },
    { icon: 'user-plus', label: 'Add user', page: 'adduser' },
    { icon: 'umbrella', label: 'Leave requests', page: 'leave', section: 'Management' },
    { icon: 'check-square', label: 'Attendance', page: 'attendance' },
    { icon: 'megaphone', label: 'Announcements', page: 'announcements' },
    { icon: 'bar-chart', label: 'Reports', page: 'reports' },
    { icon: 'grid', label: 'Apps', page: 'apps' },
    { icon: 'message-square', label: 'Messages', page: 'messages', section: 'Account' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'user', label: 'My profile', page: 'profile' },
  ];
  const pages = {};
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;

  pages.dashboard = async content => {
    const [st, leave] = await Promise.all([api.get('/api/stats/overview'), api.rows('leave_requests', { status: 'eq.pending', expand: 'user', order: 'start_date.asc' })]);
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Human resources</div><h1>${esc(session.get().full_name)}</h1></div>` +
      stats([{ value: st.staff, label: 'Active staff', icon: 'users', page: 'staff' }, { value: st.teachers, label: 'Teachers', icon: 'school', page: 'teachers' },
        { value: st.students, label: 'Active students', icon: 'graduation', page: 'students' },
        { value: st.leave_pending, label: 'Leave requests waiting', icon: 'umbrella', page: 'leave', accent: st.leave_pending > 0 },
        { value: st.attendance_rate_30d != null ? st.attendance_rate_30d + '%' : '—', label: 'Student attendance (30 days)', icon: 'check-square', page: 'attendance' }]) +
      `<div class="grid-2">
        ${card('Staff by role', 'users', barChart(Object.keys(st.users_by_role).filter(r => r !== 'student').map(r => ({ label: r, value: st.users_by_role[r] }))))}
        ${card('Leave waiting for a decision', 'umbrella', leave.length ? leave.map(l => `<div class="list-item"><div class="li-title">${esc(l.user ? l.user.full_name : '')} · ${esc(l.type)}</div><div class="li-meta">${formatDate(l.start_date)} → ${formatDate(l.end_date)}</div></div>`).join('') : '<p class="text-muted text-sm">No requests waiting.</p>')}
        ${card('Students with low attendance (60 days)', 'alert', st.at_risk.length ? st.at_risk.map(r => `<div class="list-item"><div class="li-title">${esc(r.full_name)} · <span class="risk">${Math.round(r.rate)}%</span></div><div class="li-meta">${esc(r.user_id)} · ${r.sessions} sessions</div></div>`).join('') : '<p class="text-muted text-sm">No students at risk.</p>')}
      </div>`;
  };

  const userFields = [
    { name: 'full_name', label: 'Full name', required: true, full: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended', 'graduated'], required: true },
    { name: 'department', label: 'Department' }, { name: 'course', label: 'Course (students)' }, { name: 'level', label: 'Level (students)', type: 'select', options: LEVELS },
    { name: 'gender', label: 'Gender', type: 'select', options: ['female', 'male', 'other'] }, { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { name: 'nationality', label: 'Nationality' }, { name: 'address', label: 'Address', full: true },
    { name: 'guardian_name', label: 'Guardian / emergency contact' }, { name: 'guardian_phone', label: 'Guardian phone', type: 'tel' }];
  const resetPassword = { label: 'Reset password', icon: 'key', run: async u => {
    if (!(await confirmDialog(`Reset the password for ${u.full_name}? They will choose a new one when they sign in.`))) return;
    const res = await api.post(`/api/users/${u.id}/reset-password`);
    openModal('Temporary password', `<p>Give <strong>${esc(u.full_name)}</strong> (${esc(u.user_id)}) this temporary password:</p><div class="id-box">${esc(res.new_password)}</div>`);
  } };
  const people = (title, query, extraColumns, report) => crudPage({
    table: 'users', title, singular: 'person', query, canCreate: false, fields: userFields, report, wideForm: true,
    toolbar: button('Add user', { action: 'go', data: { page: 'adduser' }, icon: 'user-plus', cls: 'btn-primary btn-sm' }),
    filters: [{ name: 'status', label: 'Status', options: ['active', 'inactive', 'suspended', 'graduated'] }],
    columns: [{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, ...extraColumns,
      { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Status', render: u => badge(u.status) }],
    actions: [resetPassword, { label: 'Report', icon: 'file-text', show: u => u.role === 'student', run: u => { window.open(`/api/students/${u.id}/report.html`, '_blank', 'noopener'); } }],
  });
  pages.staff = people('Staff', { role: 'neq.student', order: 'full_name.asc' }, [{ label: 'Role', key: 'role' }, { label: 'Department', key: 'department' }], 'staff');
  pages.teachers = people('Teachers', { role: 'eq.teacher', order: 'full_name.asc' }, [{ label: 'Department', key: 'department' }]);
  pages.students = people('Students', { role: 'eq.student', order: 'full_name.asc' }, [{ label: 'Course', key: 'course' }, { label: 'Level', key: 'level' }], 'students');

  pages.adduser = async content => {
    const roles = isAdmin() ? ['student', 'teacher', 'accounts', 'hr', 'director', 'admin'] : ['student', 'teacher', 'accounts', 'hr', 'director'];
    content.innerHTML = pageHead('Add a user', '', 'IDs are created automatically (HMLI-YEAR-0001 for students, HMLI-STF-0001 for staff). Leave the password empty to generate a temporary one.') +
      `<div class="card" style="max-width:780px"><div class="card-body"><form class="form-grid" data-new-user>
        <div class="form-group full"><label class="form-label" for="nu-name">Full name *</label><input class="form-input" id="nu-name" name="full_name" required></div>
        <div class="form-group"><label class="form-label" for="nu-role">Role *</label><select class="form-select" id="nu-role" name="role">${roles.map(r => `<option>${r}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="nu-email">Email</label><input class="form-input" id="nu-email" name="email" type="email"></div>
        <div class="form-group"><label class="form-label" for="nu-phone">Phone</label><input class="form-input" id="nu-phone" name="phone" type="tel"></div>
        <div class="form-group"><label class="form-label" for="nu-dept">Department</label><input class="form-input" id="nu-dept" name="department"></div>
        <div class="form-group"><label class="form-label" for="nu-course">Course (students)</label><input class="form-input" id="nu-course" name="course"></div>
        <div class="form-group"><label class="form-label" for="nu-level">Level (students)</label><select class="form-select" id="nu-level" name="level"><option value="">—</option>${LEVELS.map(l => `<option>${l}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="nu-id">Custom ID (optional)</label><input class="form-input" id="nu-id" name="user_id"></div>
        <div class="form-group"><label class="form-label" for="nu-pw">Password (optional)</label><input class="form-input" id="nu-pw" name="password" type="password" minlength="8" autocomplete="new-password"></div>
        <div class="form-group full"><label class="check"><input type="checkbox" name="send_welcome" checked> Email the sign-in details to this person</label></div>
        <div class="full"><button class="btn btn-primary" type="submit">${icon('user-plus')}<span>Create user</span></button></div></form></div></div><div data-result class="mt-md"></div>`;
    const form = content.querySelector('[data-new-user]');
    form.addEventListener('submit', e => {
      e.preventDefault();
      run(e.submitter, async () => {
        const res = await api.post('/api/users', formValues(form));
        clearCache('users');
        content.querySelector('[data-result]').innerHTML = alertBox('success', `Created <strong>${esc(res.user.full_name)}</strong> — sign-in ID <strong class="mono">${esc(res.user.user_id)}</strong>` +
          (res.temporary_password ? `<br>Temporary password: <strong class="mono">${esc(res.temporary_password)}</strong> (they must change it when they first sign in)` : ''));
        form.reset();
        toast('User created');
      });
    });
  };

  pages.leave = crudPage({
    table: 'leave_requests', title: 'Leave requests', query: { order: 'created_at.desc' }, expand: 'user', canCreate: false, canEdit: false, search: false,
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'approved', 'rejected'], default: 'pending' }], liveEvent: 'leave.new',
    columns: [{ label: 'Staff member', render: l => `<span class="td-name">${esc(l.user ? l.user.full_name : '')}</span>` }, { label: 'Type', key: 'type' },
      { label: 'From', render: l => formatDate(l.start_date) }, { label: 'To', render: l => formatDate(l.end_date) },
      { label: 'Days', render: l => Math.round((new Date(l.end_date) - new Date(l.start_date)) / 864e5) + 1 }, { label: 'Reason', key: 'reason' },
      { label: 'Status', render: l => badge(l.status) }],
    actions: [
      { label: 'Approve', icon: 'check', cls: 'btn-success', show: l => l.status === 'pending', run: async (l, reload) => { await api.update('leave_requests', l.id, { status: 'approved', reviewed_by: session.get().id }); toast('Approved'); reload(); } },
      { label: 'Decline', icon: 'x', cls: 'btn-danger-ghost', show: l => l.status === 'pending', run: async (l, reload) => { await api.update('leave_requests', l.id, { status: 'rejected', reviewed_by: session.get().id }); reload(); } }],
  });

  pages.attendance = async content => {
    content.innerHTML = pageHead('Attendance records', button('Export all', { href: '/api/reports/attendance.csv', icon: 'download' })) +
      `<div class="toolbar"><input class="form-input" type="date" data-day value="${todayISO()}" aria-label="Date"></div><div data-att>${skeleton(160)}</div>`;
    const load = async () => {
      const rows = await api.rows('attendance', { date: `eq.${content.querySelector('[data-day]').value}`, expand: 'user,class,marked_by', limit: 2000 });
      const count = s => rows.filter(r => r.status === s).length;
      content.querySelector('[data-att]').innerHTML = stats([{ value: rows.length, label: 'Records' }, { value: count('present'), label: 'Present' },
        { value: count('late'), label: 'Late' }, { value: count('absent'), label: 'Absent' }]) +
        table([{ label: 'Student', render: r => esc(r.user ? r.user.full_name : '—') }, { label: 'Class', render: r => esc(r.class ? r.class.name : '—') },
          { label: 'Status', render: r => badge(r.status) }, { label: 'Marked by', render: r => esc(r.marked_by_ref ? r.marked_by_ref.full_name : '—') }],
          rows, { empty: 'No attendance was taken on this date.' });
    };
    content.querySelector('[data-day]').addEventListener('change', load);
    load();
  };

  pages.announcements = announcementsAdmin({ audiences: ['staff', 'all', 'teacher', 'accounts', 'hr', 'students'] });
  pages.reports = async content => {
    const reports = [['staff', 'Staff directory'], ['students', 'Student list'], ['attendance', 'Attendance']];
    content.innerHTML = pageHead('Reports') + `<div class="grid-auto">${reports.map(([key, title]) => `<div class="card"><div class="card-body"><h3>${icon('bar-chart')} ${title}</h3>
      ${button('Download', { href: `/api/reports/${key}.csv`, icon: 'download' })}</div></div>`).join('')}</div>`;
  };
  pages.apps = appsPage();
  pages.messages = messagesPage();
  pages.notifications = notificationsPage();
  pages.profile = profilePage();

  onEvent('leave.new', () => toast('New leave request'));
  startPortal({ roles: ['hr', 'admin'], nav, pages });
})();
