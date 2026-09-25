/**
 * Admin portal: the front office (applications, enquiries, placement tests), people, academic
 * structure, finance overview, the whole website's content, integrations and system settings.
 */
(function () {
  'use strict';
  const nav = [
    { icon: 'home', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'inbox', label: 'Applications', page: 'applications', section: 'Front office' },
    { icon: 'phone', label: 'Enquiries', page: 'enquiries' },
    { icon: 'compass', label: 'Placement tests', page: 'placements' },
    { icon: 'users', label: 'Students & users', page: 'users', section: 'People' },
    { icon: 'user-check', label: 'Alumni', page: 'alumni' },
    { icon: 'layers', label: 'Courses', page: 'courses', section: 'Academic' },
    { icon: 'school', label: 'Classes & timetable', page: 'classes' },
    { icon: 'file-text', label: 'Assignments', page: 'assignments' },
    { icon: 'edit', label: 'Exams', page: 'exams' },
    { icon: 'trending-up', label: 'Results', page: 'results' },
    { icon: 'check-square', label: 'Attendance', page: 'attendance' },
    { icon: 'award', label: 'Certificates', page: 'certificates' },
    { icon: 'flag', label: 'Official exams', page: 'examsessions' },
    { icon: 'calendar', label: 'Calendar', page: 'calendar' },
    { icon: 'credit-card', label: 'Payments', page: 'payments', section: 'Finance' },
    { icon: 'file', label: 'Invoices', page: 'invoices' },
    { icon: 'tag', label: 'Fees', page: 'fees' },
    { icon: 'gift', label: 'Scholarships', page: 'scholarships' },
    { icon: 'monitor', label: 'Homepage content', page: 'site', section: 'Website' },
    { icon: 'file-text', label: 'News', page: 'news' },
    { icon: 'book-open', label: 'Library', page: 'library' },
    { icon: 'image', label: 'Gallery', page: 'gallery' },
    { icon: 'folder', label: 'Downloads', page: 'documents' },
    { icon: 'message-circle', label: 'Testimonials', page: 'testimonials' },
    { icon: 'megaphone', label: 'Announcements', page: 'announcements', section: 'Communication' },
    { icon: 'message-square', label: 'Messages', page: 'messages' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'grid', label: 'Apps & integrations', page: 'integrations', section: 'System' },
    { icon: 'zap', label: 'Webhooks', page: 'webhooks' },
    { icon: 'bar-chart', label: 'Reports', page: 'reports' },
    { icon: 'settings', label: 'Institution settings', page: 'settings' },
    { icon: 'shield', label: 'Audit log', page: 'audit' },
    { icon: 'user', label: 'My profile', page: 'profile' },
  ];
  const pages = {};
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;

  pages.dashboard = async content => {
    const [st, apps, leads] = await Promise.all([api.get('/api/stats/overview'),
      api.rows('applications', { status: 'in.(pending,under_review,interview)', order: 'submitted_at.desc', limit: 8 }),
      api.rows('enquiries', { status: 'in.(new,follow_up)', order: 'created_at.desc', limit: 8 })]);
    const firstName = (session.get().full_name || '').split(' ')[0];
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Administration</div><h1>Guten Tag, ${esc(firstName)}</h1><p>${st.online_now === 1 ? "1 person is" : st.online_now + " people are"} online now</p></div>` +
      stats([
        { value: st.applications_open, label: 'Open applications', icon: 'inbox', page: 'applications', accent: st.applications_open > 0 },
        { value: st.enquiries_open, label: 'Open enquiries', icon: 'phone', page: 'enquiries' }, { value: st.students, label: 'Active students', icon: 'graduation', page: 'users' },
        { value: st.classes_active, label: 'Active classes', icon: 'school', page: 'classes' }, { value: money(st.revenue_month), label: 'Collected this month', icon: 'dollar', page: 'payments' },
        { value: st.pending_payments, label: 'Payments to verify', icon: 'check-circle', page: 'payments' },
        { value: st.exam_registrations_pending, label: 'Exam registrations waiting', icon: 'flag', page: 'examsessions' },
        { value: st.placement_tests_30d, label: 'Placement tests (30 days)', icon: 'compass', page: 'placements' }]) +
      `<div class="flex gap-sm flex-wrap mb-md">
        ${button('Course', { action: 'go', data: { page: 'courses' }, icon: 'plus' })}${button('Class', { action: 'go', data: { page: 'classes' }, icon: 'plus' })}
        ${button('News', { action: 'go', data: { page: 'news' }, icon: 'plus' })}${button('Library item', { action: 'go', data: { page: 'library' }, icon: 'plus' })}
        ${button('Announcement', { action: 'go', data: { page: 'announcements' }, icon: 'plus' })}${button('Edit homepage', { action: 'go', data: { page: 'site' }, icon: 'monitor' })}</div>
      <div class="grid-2">
        ${card('Applications to review', 'inbox', apps.length ? apps.map((a, i) => `<button class="dd-item" data-app="${i}" style="border-radius:8px"><div><div class="li-title">${esc(a.full_name)} · ${esc(a.course)} ${esc(a.level)} ${badge(a.status)}</div>
          <div class="li-meta">${esc(a.reference)} · ${timeAgo(a.submitted_at)}</div></div></button>`).join('') : '<p class="text-muted text-sm">No open applications.</p>')}
        ${card('Enquiries to follow up', 'phone', leads.length ? leads.map(e => `<div class="list-item"><div class="li-title">${esc(e.name)} · ${esc(e.interest || 'General')}</div>
          <div class="li-meta">${esc(e.phone || e.email || '')} · ${esc(e.channel)} · ${timeAgo(e.created_at)}</div></div>`).join('') : '<p class="text-muted text-sm">All enquiries handled.</p>')}
        ${card('Students by course', 'layers', barChart(st.students_by_course.map(c => ({ label: c.course, value: c.count }))))}
        ${card('Admissions', 'bar-chart', barChart(Object.keys(st.applications).map(k => ({ label: k.replace('_', ' '), value: st.applications[k] }))))}
      </div>`;
    content.querySelectorAll('[data-app]').forEach(b => b.addEventListener('click', () => reviewApplication(apps[+b.dataset.app], refresh)));
  };

  pages.applications = applicationsPage();
  pages.enquiries = enquiriesPage();
  pages.placements = placementsPage();
  pages.users = usersPage();
  pages.alumni = alumniPage();
  pages.courses = coursesPage();
  pages.classes = classesPage();
  pages.assignments = crudPage({
    table: 'assignments', title: 'Assignments', subtitle: 'Teachers create assignments in their portal; you can review, edit or remove any of them here.',
    query: { order: 'due_date.desc' }, expand: 'class', canCreate: false, canDelete: true,
    columns: [{ label: 'Assignment', render: a => `<span class="td-name">${esc(a.title)}</span>` }, { label: 'Class', render: a => esc(a.class ? a.class.name : 'General') },
      { label: 'Due', render: a => formatDateTime(a.due_date) }, { label: 'Points', key: 'total_points' }],
    fields: [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'due_date', label: 'Due', type: 'datetime' }, { name: 'total_points', label: 'Points', type: 'number' },
      { name: 'description', label: 'Instructions', type: 'textarea', full: true }, { name: 'published', label: 'Visible to students', type: 'checkbox' }],
  });
  pages.exams = crudPage({
    table: 'exams', title: 'Exams', query: { order: 'date.desc' }, expand: 'class', canCreate: false, canEdit: false, canDelete: true,
    columns: [{ label: 'Exam', render: e => `<span class="td-name">${esc(e.title)}</span>` }, { label: 'Class', render: e => esc(e.class ? e.class.name : '—') },
      { label: 'Opens', render: e => formatDateTime(e.date) }, { label: 'Questions', render: e => (e.questions || []).length }, { label: 'Status', render: e => badge(e.published ? 'published' : 'draft') }],
    actions: [{ label: e => (e.published ? 'Unpublish' : 'Publish'), run: async (e, reload) => { await api.update('exams', e.id, { published: !e.published }); reload(); } }],
  });
  pages.results = crudPage({
    table: 'exam_results', title: 'Exam results', query: { order: 'submitted_at.desc' }, expand: 'user,exam', canCreate: false, canEdit: false, report: 'results', search: false,
    filters: [{ name: 'needs_review', label: 'Needs review', options: [{ value: 'true', label: 'yes' }, { value: 'false', label: 'no' }] }],
    columns: [{ label: 'Student', render: r => esc(r.user ? r.user.full_name : '—') }, { label: 'Exam', render: r => esc(r.exam ? r.exam.title : r.title) },
      { label: 'Score', render: r => `${r.score}/${r.total_points}` }, { label: '%', render: r => `<strong>${r.percentage}%</strong>` },
      { label: 'Result', render: r => (r.needs_review ? badge('pending', 'to review') : badge(r.passed ? 'pass' : 'fail')) }, { label: 'Date', render: r => formatDate(r.submitted_at) }],
  });
  pages.attendance = crudPage({
    table: 'attendance', title: 'Attendance', query: { order: 'date.desc' }, expand: 'user,class', canCreate: false, canEdit: false, canDelete: true, report: 'attendance', search: false,
    filters: [{ name: 'status', label: 'Status', options: ['present', 'late', 'absent', 'excused'] }],
    columns: [{ label: 'Date', render: a => formatDate(a.date) }, { label: 'Student', render: a => esc(a.user ? a.user.full_name : '—') },
      { label: 'Class', render: a => esc(a.class ? a.class.name : '—') }, { label: 'Status', render: a => badge(a.status) }, { label: 'Note', key: 'notes' }],
  });
  pages.certificates = certificatesPage();
  pages.examsessions = examSessionsPage();
  pages.calendar = calendarPage(true);
  pages.payments = crudPage({
    table: 'payments', title: 'Payments', query: { order: 'created_at.desc' }, expand: 'user', canCreate: false, canEdit: false, report: 'payments', liveEvent: 'payment.new',
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'confirmed', 'rejected'] }],
    toolbar: button('Accounts portal', { href: '/accounts/', icon: 'external' }),
    columns: [{ label: 'Receipt', key: 'receipt_no', cls: 'td-id' }, { label: 'Student', render: p => esc(p.user ? p.user.full_name : '—') },
      { label: 'Amount', render: p => `<strong>${money(p.amount)}</strong>` }, { label: 'Method', key: 'method' }, { label: 'Status', render: p => badge(p.status) },
      { label: 'Date', render: p => formatDate(p.created_at) }],
    actions: [
      { label: 'Confirm', icon: 'check', cls: 'btn-success', show: p => p.status === 'pending', run: async (p, reload) => { const r = await api.post(`/api/payments/${p.id}/confirm`); toast(`Confirmed — ${r.receipt_no}`); reload(); } },
      { label: 'Proof', icon: 'paperclip', show: p => !!p.proof_url, run: p => { window.open(p.proof_url, '_blank', 'noopener'); } }],
  });
  pages.invoices = crudPage({
    table: 'invoices', title: 'Invoices', query: { order: 'created_at.desc' }, expand: 'user', canCreate: false, canEdit: false, canDelete: true, report: 'invoices',
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'partial', 'paid', 'overdue', 'cancelled'] }],
    toolbar: button('Create in the accounts portal', { href: '/accounts/?page=invoices', icon: 'external' }),
    columns: [{ label: 'Invoice', key: 'invoice_number', cls: 'td-id' }, { label: 'Student', render: i => esc(i.user ? i.user.full_name : '—') },
      { label: 'Description', key: 'description' }, { label: 'Amount', render: i => money(i.amount - i.discount) }, { label: 'Paid', render: i => money(i.paid) },
      { label: 'Due', render: i => formatDate(i.due_date) }, { label: 'Status', render: i => badge(i.status) }],
    actions: [{ label: 'Print', icon: 'printer', run: i => { window.open(`/api/invoices/${i.id}/print`, '_blank', 'noopener'); } }],
  });
  pages.fees = crudPage({
    table: 'fees', title: 'Fee structures', createLabel: 'Add fee', canDelete: true, search: false, expand: 'course',
    columns: [{ label: 'Course', render: f => esc(f.course ? f.course.title : 'General') }, { label: 'Type', key: 'type' }, { label: 'Amount', render: f => money(f.amount) },
      { label: 'Frequency', key: 'frequency' }, { label: 'Description', key: 'description' }],
    fields: [{ name: 'course_id', label: 'Course', type: 'lookup', lookup: { table: 'courses', query: 'order=title.asc', label: c => c.title } },
      { name: 'type', label: 'Type', type: 'select', options: ['tuition', 'application', 'exam', 'materials', 'late_fee', 'other'], required: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true }, { name: 'frequency', label: 'Frequency', type: 'select', options: ['one-time', 'monthly', 'term', 'yearly'], required: true },
      { name: 'description', label: 'Description', full: true }],
  });
  pages.scholarships = scholarshipsPage();
  pages.site = siteContentPage();
  pages.news = newsPage();
  pages.library = libraryPage();
  pages.gallery = galleryPage();
  pages.documents = documentsPage();
  pages.testimonials = testimonialsPage();
  pages.announcements = announcementsAdmin({ classLookup });
  pages.messages = messagesPage();
  pages.notifications = notificationsPage();
  pages.integrations = appsAdminPage();
  pages.webhooks = webhooksPage();
  pages.reports = reportsPage();
  pages.settings = institutionPage();
  pages.audit = auditPage();
  pages.profile = profilePage();

  onEvent('application.new', a => toast(`New application: ${a.name} (${a.course})`));
  onEvent('enquiry.new', e => toast(`New enquiry: ${e.name}${e.interest ? ' — ' + e.interest : ''}`));
  onEvent('placement.new', p => toast(`Placement test: ${p.name} — ${p.level} (${p.language})`));
  onEvent('search:open', async r => {
    if (r.type === 'application') reviewApplication(await api.row('applications', r.id), () => {});
    else if (r.type === 'user') window.open(`/api/students/${r.id}/report.html`, '_blank', 'noopener');
    else if (r.type === 'enquiry') go('enquiries');
    else if (r.type === 'class') go('classes');
    else if (r.type === 'course') go('courses');
  });
  startPortal({ roles: ['admin'], nav, pages });
})();
