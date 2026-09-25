/**
 * Director portal: executive dashboard, analytics, revenue, academic oversight,
 * certificates, calendar, institution settings and the audit log.
 */
(function () {
  'use strict';
  const nav = [
    { icon: 'grid', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'activity', label: 'Analytics', page: 'analytics' },
    { icon: 'dollar', label: 'Revenue', page: 'revenue' },
    { icon: 'graduation', label: 'Students', page: 'students', section: 'Academic' },
    { icon: 'users', label: 'Teachers', page: 'teachers' },
    { icon: 'layers', label: 'Courses', page: 'courses' },
    { icon: 'school', label: 'Classes', page: 'classes' },
    { icon: 'star', label: 'Course feedback', page: 'feedback' },
    { icon: 'award', label: 'Certificates', page: 'certificates' },
    { icon: 'calendar', label: 'Academic calendar', page: 'calendar' },
    { icon: 'megaphone', label: 'Announcements', page: 'announcements' },
    { icon: 'bar-chart', label: 'Reports', page: 'reports', section: 'Administration' },
    { icon: 'monitor', label: 'Homepage content', page: 'site' },
    { icon: 'settings', label: 'Institution settings', page: 'institution' },
    { icon: 'shield', label: 'Audit log', page: 'audit' },
    { icon: 'grid', label: 'Apps', page: 'apps' },
    { icon: 'message-square', label: 'Messages', page: 'messages', section: 'Account' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'umbrella', label: 'Leave', page: 'leave' },
    { icon: 'user', label: 'My profile', page: 'profile' },
  ];
  const pages = {};
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;
  const pct = v => (v == null ? '—' : v + '%');
  const thousands = v => (v >= 1000 ? Math.round(v / 1000) + 'k' : String(v));

  pages.dashboard = async content => {
    const st = await api.get('/api/stats/overview');
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Director</div><h1>${esc(session.get().full_name)}</h1><p>${st.online_now === 1 ? "1 person is" : st.online_now + " people are"} online now</p></div>` +
      stats([
        { value: st.students, label: 'Active students', icon: 'graduation', page: 'students' }, { value: st.teachers, label: 'Teachers', icon: 'users', page: 'teachers' },
        { value: st.classes_active, label: 'Active classes', icon: 'school', page: 'classes' }, { value: st.courses, label: 'Courses', icon: 'layers', page: 'courses' },
        { value: money(st.revenue_month), label: 'Collected this month', icon: 'dollar', page: 'revenue', accent: true },
        { value: money(st.outstanding), label: 'Outstanding fees', icon: 'wallet', page: 'revenue' },
        { value: st.applications_open, label: 'Open applications', icon: 'inbox' }, { value: st.enquiries_open, label: 'Open enquiries', icon: 'phone' },
        { value: pct(st.attendance_rate_30d), label: 'Attendance (30 days)', icon: 'check-square' }, { value: pct(st.exam_average), label: 'Average exam score', icon: 'edit' }]) +
      `<div class="grid-2">
        ${card('New students per month', 'trending-up', columnChart(st.student_growth.map(g => ({ label: g.month.slice(2), value: g.count }))))}
        ${card('Students by course', 'layers', barChart(st.students_by_course.map(c => ({ label: c.course, value: c.count }))))}
        ${card('Students at risk (attendance below 75%)', 'alert', st.at_risk.length ? st.at_risk.slice(0, 8).map(r => `<div class="list-item"><div class="li-title">${esc(r.full_name)} · <span class="risk">${Math.round(r.rate)}%</span></div><div class="li-meta">${esc(r.user_id)}</div></div>`).join('') : '<p class="text-muted text-sm">No students at risk.</p>')}
        ${card('Latest announcements', 'megaphone', await announcementsFeed(4))}
      </div>`;
  };

  pages.analytics = async content => {
    const st = await api.get('/api/stats/overview');
    const funnel = ['pending', 'under_review', 'interview', 'waitlisted', 'approved', 'rejected'].map(k => ({ label: k.replace('_', ' '), value: st.applications[k] || 0 }));
    const leads = ['new', 'contacted', 'follow_up', 'converted', 'closed'].map(k => ({ label: k.replace('_', ' '), value: st.enquiries[k] || 0 }));
    content.innerHTML = pageHead('Analytics') + stats([{ value: pct(st.enquiry_conversion), label: 'Enquiries that became students', icon: 'target', accent: true },
      { value: st.placement_tests_30d, label: 'Placement tests (30 days)', icon: 'compass' }, { value: st.exam_registrations_pending, label: 'Exam registrations waiting', icon: 'flag' }]) +
      `<div class="grid-2">${card('Admissions', 'inbox', barChart(funnel))}${card('Enquiries', 'phone', barChart(leads))}
        ${card('Students by CEFR level', 'target', barChart(st.students_by_level.map(l => ({ label: l.level, value: l.count }))))}
        ${card('People by role', 'users', barChart(Object.keys(st.users_by_role).map(r => ({ label: r, value: st.users_by_role[r] }))))}</div>`;
  };

  pages.revenue = async content => {
    const f = await api.get('/api/finance/summary');
    content.innerHTML = pageHead('Revenue', button('Payments CSV', { href: '/api/reports/payments.csv', icon: 'download' })) +
      stats([{ value: money(f.total_revenue), label: 'Collected in total', icon: 'dollar', accent: true }, { value: money(f.this_month), label: 'This month', icon: 'calendar' },
        { value: money(f.outstanding), label: 'Outstanding', icon: 'wallet' }, { value: money(f.overdue_amount), label: `Overdue (${f.overdue_count} invoices)`, icon: 'alert' }]) +
      `<div class="card mb-md"><div class="card-header"><h3>${icon('bar-chart')} Last 12 months</h3></div><div class="card-body">${columnChart(f.monthly.map(m => ({ label: m.month.slice(2), value: m.amount })), { format: thousands })}</div></div>
      <div class="grid-2">${card('By course', 'layers', barChart(f.by_course.map(c => ({ label: c.course, value: c.amount })), { format: money }))}
      ${card('By payment method', 'credit-card', barChart(f.by_method.map(m => ({ label: m.method, value: m.amount })), { format: money }))}</div>`;
  };

  pages.students = crudPage({
    table: 'users', title: 'Students', query: { role: 'eq.student', order: 'created_at.desc' }, canCreate: false, canEdit: false, report: 'students',
    filters: [{ name: 'status', label: 'Status', options: ['active', 'inactive', 'graduated', 'suspended'] }, { name: 'level', label: 'Level', options: LEVELS }],
    columns: [{ label: 'Name', key: 'full_name', cls: 'td-name' }, { label: 'ID', key: 'user_id', cls: 'td-id' }, { label: 'Course', key: 'course' }, { label: 'Level', key: 'level' },
      { label: 'Status', render: u => badge(u.status) }, { label: 'Joined', render: u => formatDate(u.created_at) }],
    actions: [{ label: 'Report', icon: 'file-text', run: u => { window.open(`/api/students/${u.id}/report.html`, '_blank', 'noopener'); } }],
  });
  pages.teachers = teachersPage();
  pages.courses = coursesPage();
  pages.classes = classesPage();
  pages.feedback = feedbackPage();
  pages.certificates = certificatesPage();
  pages.calendar = calendarPage(true);
  pages.announcements = announcementsAdmin({ classLookup });
  pages.reports = reportsPage();
  pages.site = siteContentPage();
  pages.institution = institutionPage();
  pages.audit = auditPage();
  pages.apps = appsPage();
  pages.messages = messagesPage();
  pages.notifications = notificationsPage();
  pages.leave = leavePage();
  pages.profile = profilePage();

  onEvent('search:open', r => { if (r.type === 'user') window.open(`/api/students/${r.id}/report.html`, '_blank', 'noopener'); });
  startPortal({ roles: ['director', 'admin'], nav, pages });
})();
