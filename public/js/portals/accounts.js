/**
 * Accounts portal: payment verification (live), payments and receipts, invoices (single and bulk),
 * fee structures, student statements, debtors, official exam fees, scholarships and reports.
 */
(function () {
  'use strict';
  const studentLookup = { table: 'users', query: 'role=eq.student&status=eq.active&order=full_name.asc&limit=2000', label: u => `${u.full_name} (${u.user_id})` };

  const nav = [
    { icon: 'grid', label: 'Dashboard', page: 'dashboard', section: 'Overview' },
    { icon: 'check-circle', label: 'Verify payments', page: 'verify', section: 'Money in' },
    { icon: 'credit-card', label: 'All payments', page: 'payments' },
    { icon: 'file-text', label: 'Invoices', page: 'invoices', section: 'Billing' },
    { icon: 'tag', label: 'Fee structures', page: 'fees' },
    { icon: 'list', label: 'Student statements', page: 'statements' },
    { icon: 'alert', label: 'Debtors', page: 'debtors' },
    { icon: 'flag', label: 'Exam registrations', page: 'examregs' },
    { icon: 'gift', label: 'Scholarships', page: 'scholarships' },
    { icon: 'bar-chart', label: 'Reports', page: 'reports', section: 'Insight' },
    { icon: 'grid', label: 'Apps', page: 'apps' },
    { icon: 'message-square', label: 'Messages', page: 'messages', section: 'Account' },
    { icon: 'bell', label: 'Notifications', page: 'notifications' },
    { icon: 'umbrella', label: 'Leave', page: 'leave' },
    { icon: 'user', label: 'My profile', page: 'profile' },
  ];
  const pages = {};
  const card = (title, iconName, body) => `<div class="card"><div class="card-header"><h3>${icon(iconName)} ${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;
  const proof = url => (url ? button('', { href: url, icon: 'paperclip', cls: 'btn-ghost btn-sm', title: 'Open proof of payment' }) : '—');
  const thousands = v => (v >= 1000 ? Math.round(v / 1000) + 'k' : String(v));

  pages.dashboard = async content => {
    const f = await api.get('/api/finance/summary');
    const u = session.get();
    content.innerHTML = `<div class="welcome"><div class="eyebrow">Finance</div><h1>${esc(u.full_name)}</h1><p>Accounts office</p></div>` +
      stats([{ value: money(f.this_month), label: 'Collected this month', icon: 'dollar', accent: true }, { value: money(f.total_revenue), label: 'Collected in total', icon: 'trending-up' },
        { value: money(f.outstanding), label: 'Outstanding', icon: 'wallet', page: 'debtors' },
        { value: f.overdue_count, label: `Overdue invoices (${money(f.overdue_amount)})`, icon: 'alert', page: 'debtors' },
        { value: f.pending_payments, label: 'Payments to verify', icon: 'check-circle', page: 'verify' }]) +
      `<div class="grid-2">
        ${card('Collections by month', 'bar-chart', columnChart(f.monthly.map(m => ({ label: m.month.slice(2), value: m.amount })), { format: thousands }))}
        ${card('By payment method', 'credit-card', barChart(f.by_method.map(m => ({ label: m.method, value: m.amount })), { format: money }))}
        ${card('By course', 'layers', barChart(f.by_course.map(c => ({ label: c.course, value: c.amount })), { format: money }))}
        ${card('Largest balances', 'alert', f.top_debtors.length ? f.top_debtors.slice(0, 8).map(d => `<div class="list-item"><div class="li-title">${esc(d.full_name)} · ${money(d.balance)}</div><div class="li-meta">${esc(d.user_id)} · ${esc(d.phone || '')}</div></div>`).join('') : '<p class="text-muted text-sm">No outstanding balances.</p>')}
      </div>`;
  };

  pages.verify = crudPage({
    table: 'payments', title: 'Payments to verify', liveEvent: 'payment.new', canCreate: false, canEdit: false, empty: 'Nothing to verify.',
    subtitle: 'Payments reported by students. Check your mobile-money or bank statement, then confirm or reject. Unlinked payments settle the oldest open invoice.',
    query: { status: 'eq.pending', order: 'created_at.asc' }, expand: 'user,invoice',
    columns: [
      { label: 'Student', render: p => `<div class="td-name">${esc(p.user ? p.user.full_name : '—')}</div><div class="td-id">${esc(p.user ? p.user.user_id : '')}</div>` },
      { label: 'Amount', render: p => `<strong>${money(p.amount)}</strong>` }, { label: 'Method', key: 'method' }, { label: 'Reference', key: 'reference', cls: 'td-id' },
      { label: 'Invoice', render: p => esc(p.invoice ? p.invoice.invoice_number : '—') }, { label: 'Reported', render: p => timeAgo(p.created_at) },
      { label: 'Proof', render: p => proof(p.proof_url) }],
    actions: [
      { label: 'Confirm', icon: 'check', cls: 'btn-success', run: async (p, reload) => { const r = await api.post(`/api/payments/${p.id}/confirm`); toast(`Confirmed — receipt ${r.receipt_no}`); reload(); } },
      { label: 'Reject', icon: 'x', cls: 'btn-danger-ghost', run: (p, reload) => formModal('Reject payment', [{ name: 'reason', label: 'Reason (sent to the student)', type: 'textarea', required: true, full: true }],
        {}, async values => { await api.post(`/api/payments/${p.id}/reject`, values); toast('Payment rejected'); reload(); }) }],
  });

  pages.payments = crudPage({
    table: 'payments', title: 'Payments', singular: 'payment', createLabel: 'Record payment', canEdit: false, report: 'payments',
    query: { order: 'created_at.desc' }, expand: 'user,invoice',
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'confirmed', 'rejected'] }, { name: 'method', label: 'Method', options: ['airtel', 'tnm', 'bank', 'cash', 'card'] }],
    columns: [{ label: 'Receipt', key: 'receipt_no', cls: 'td-id' }, { label: 'Student', render: p => esc(p.user ? p.user.full_name : '—') },
      { label: 'Amount', render: p => `<strong>${money(p.amount)}</strong>` }, { label: 'Method', key: 'method' }, { label: 'Status', render: p => badge(p.status) },
      { label: 'Date', render: p => formatDate(p.created_at) }],
    fields: [
      { name: 'user_id', label: 'Student', type: 'lookup', lookup: studentLookup, required: true, full: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, min: 1 },
      { name: 'method', label: 'Method', type: 'select', options: ['cash', 'airtel', 'tnm', 'bank', 'card'], required: true },
      { name: 'reference', label: 'Reference' }, { name: 'description', label: 'Description' },
      { name: 'invoice_id', label: 'Invoice number (optional)', hint: 'e.g. INV-2026-00012. Leave empty to settle the oldest open invoice.' }],
    beforeSave: async values => {
      if (values.invoice_id) {
        const found = await api.rows('invoices', { invoice_number: `eq.${values.invoice_id.toUpperCase()}` });
        if (!found.length) throw new Error('No invoice with that number.');
        values.invoice_id = found[0].id;
      }
      return Object.assign(values, { status: 'confirmed' });
    },
    actions: [{ label: 'Receipt', icon: 'printer', show: p => p.status === 'confirmed', run: p => { window.open(`/api/payments/${p.id}/receipt`, '_blank', 'noopener'); } },
      { label: 'Proof', icon: 'paperclip', show: p => !!p.proof_url, run: p => { window.open(p.proof_url, '_blank', 'noopener'); } }],
  });

  pages.invoices = crudPage({
    table: 'invoices', title: 'Invoices', singular: 'invoice', createLabel: 'New invoice', report: 'invoices', canDelete: true,
    toolbar: button('Bill a class or course', { action: 'bulkInvoice', icon: 'zap' }),
    query: { order: 'created_at.desc' }, expand: 'user',
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'partial', 'paid', 'overdue', 'cancelled'] }],
    columns: [{ label: 'Invoice', key: 'invoice_number', cls: 'td-id' }, { label: 'Student', render: i => esc(i.user ? i.user.full_name : '—') },
      { label: 'Description', key: 'description' }, { label: 'Amount', render: i => money(i.amount - (i.discount || 0)) }, { label: 'Paid', render: i => money(i.paid) },
      { label: 'Due', render: i => formatDate(i.due_date) }, { label: 'Status', render: i => badge(i.status) }],
    fields: [
      { name: 'user_id', label: 'Student', type: 'lookup', lookup: studentLookup, required: true, full: true },
      { name: 'description', label: 'Description', required: true, full: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, min: 0 }, { name: 'discount', label: 'Discount or scholarship', type: 'number', default: 0, min: 0 },
      { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: ['pending', 'cancelled'], show: r => !!r.id }],
    actions: [{ label: 'Print', icon: 'printer', run: i => { window.open(`/api/invoices/${i.id}/print`, '_blank', 'noopener'); } },
      { label: 'Remind', icon: 'bell', show: i => ['pending', 'partial', 'overdue'].includes(i.status), run: async i => { await api.post(`/api/invoices/${i.id}/remind`); toast('Reminder sent'); } }],
  });

  actions({ bulkInvoice: async () => {
    const [classes, fees, courses] = await Promise.all([cachedRows('classes', 'status=eq.active&order=name.asc'), cachedRows('fees', ''), cachedRows('courses', 'order=title.asc')]);
    formModal('Bill a class or course', [
      { name: 'target', label: 'Who to bill', type: 'select', required: true, full: true,
        options: [{ value: 'class', label: 'Every active student in a class' }, { value: 'course', label: 'Every active student taking a language' }] },
      { name: 'class_id', label: 'Class', type: 'select', options: classes.map(c => ({ value: c.id, label: c.name })) },
      { name: 'course', label: 'Language', type: 'select', options: [...new Set(courses.map(c => c.language).filter(Boolean))] },
      { name: 'fee_id', label: 'Fee structure (or enter an amount)', type: 'select', full: true, options: fees.map(f => ({ value: f.id, label: `${f.description || f.type} — ${money(f.amount)} / ${f.frequency}` })) },
      { name: 'amount', label: 'Amount', type: 'number', min: 1 }, { name: 'description', label: 'Description', required: true, placeholder: 'October tuition' },
      { name: 'due_date', label: 'Due date', type: 'date' }], {}, async v => {
        const body = { description: v.description, due_date: v.due_date, fee_id: v.fee_id, amount: v.amount };
        if (v.target === 'class') body.class_id = v.class_id; else body.course = v.course;
        const res = await api.post('/api/invoices/bulk', body);
        toast(`${res.created} invoices created — students have been notified`);
        refresh();
      }, { submitLabel: 'Create invoices' });
  } });

  pages.fees = crudPage({
    table: 'fees', title: 'Fee structures', singular: 'fee', createLabel: 'Add fee', canDelete: true, search: false, expand: 'course',
    columns: [{ label: 'Course', render: f => esc(f.course ? f.course.title : 'General') }, { label: 'Type', key: 'type' },
      { label: 'Amount', render: f => `<strong>${money(f.amount)}</strong>` }, { label: 'Frequency', key: 'frequency' }, { label: 'Description', key: 'description' }],
    fields: [{ name: 'course_id', label: 'Course', type: 'lookup', lookup: { table: 'courses', query: 'order=title.asc', label: c => c.title } },
      { name: 'type', label: 'Type', type: 'select', options: ['tuition', 'application', 'exam', 'materials', 'late_fee', 'other'], required: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, min: 0 },
      { name: 'frequency', label: 'Frequency', type: 'select', options: ['one-time', 'monthly', 'term', 'yearly'], required: true },
      { name: 'description', label: 'Description', full: true }],
  });

  pages.statements = async (content, params) => {
    content.innerHTML = pageHead('Student statements') + `<div class="form-group" style="max-width:420px"><input class="form-input search-input" data-find placeholder="Search by student name or ID…" aria-label="Find student"></div>
      <div class="pick-list" data-found style="max-width:420px"></div><div data-statement></div>`;
    let timer;
    content.querySelector('[data-find]').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = e.target.value.trim();
        if (q.length < 2) return;
        const rows = await api.rows('users', { role: 'eq.student', q, limit: 10 });
        const list = content.querySelector('[data-found]');
        list.innerHTML = rows.map(u => `<button class="pick" data-student="${u.id}">${esc(u.full_name)} <small>${esc(u.user_id)}</small></button>`).join('');
        list.querySelectorAll('[data-student]').forEach(b => b.addEventListener('click', () => show(b.dataset.student)));
      }, 250);
    });
    async function show(id) {
      content.querySelector('[data-found]').innerHTML = '';
      const st = await api.get(`/api/finance/statement/${id}`);
      content.querySelector('[data-statement]').innerHTML = `<h3 class="mt-md">${esc(st.student.full_name)} <span class="td-id">${esc(st.student.user_id)}</span></h3>` +
        stats([{ value: money(st.totals.billed), label: 'Billed' }, { value: money(st.totals.paid), label: 'Paid' }, { value: money(st.totals.balance), label: 'Balance', accent: st.totals.balance > 0 }]) +
        table([{ label: 'Invoice', key: 'invoice_number', cls: 'td-id' }, { label: 'Description', key: 'description' }, { label: 'Amount', render: i => money(i.amount - i.discount) },
          { label: 'Paid', render: i => money(i.paid) }, { label: 'Status', render: i => badge(i.status) }], st.invoices, { empty: 'No invoices.' }) +
        '<div class="mt-md"></div>' + table([{ label: 'Date', render: p => formatDate(p.created_at) }, { label: 'Receipt', key: 'receipt_no', cls: 'td-id' },
          { label: 'Amount', render: p => money(p.amount) }, { label: 'Method', key: 'method' }, { label: 'Status', render: p => badge(p.status) }], st.payments, { empty: 'No payments.' });
    }
    if (params.get('student')) show(params.get('student'));
  };

  pages.debtors = crudPage({
    table: 'invoices', title: 'Outstanding and overdue', canCreate: false, canEdit: false,
    subtitle: 'Reminders also go out automatically three days before the due date and weekly while an invoice is overdue.',
    query: { status: 'in.(overdue,partial,pending)', order: 'due_date.asc' }, expand: 'user',
    filters: [{ name: 'status', label: 'Status', options: ['overdue', 'partial', 'pending'] }],
    columns: [{ label: 'Student', render: i => `<div class="td-name">${esc(i.user ? i.user.full_name : '—')}</div><div class="text-sm text-muted">${esc(i.user ? i.user.phone || '' : '')}</div>` },
      { label: 'Invoice', key: 'invoice_number', cls: 'td-id' }, { label: 'Balance', render: i => `<strong>${money(i.amount - i.discount - i.paid)}</strong>` },
      { label: 'Due', render: i => formatDate(i.due_date) }, { label: 'Status', render: i => badge(i.status) },
      { label: 'Last reminder', render: i => (i.reminder_sent_at ? timeAgo(i.reminder_sent_at) : '—') }],
    actions: [{ label: 'Remind', icon: 'bell', cls: 'btn-primary', run: async (i, reload) => { await api.post(`/api/invoices/${i.id}/remind`); toast('Reminder sent'); reload(); } }],
  });

  pages.examregs = crudPage({
    table: 'exam_registrations', title: 'Official exam registrations', query: { order: 'created_at.desc' }, expand: 'session', canCreate: false, canEdit: false,
    filters: [{ name: 'status', label: 'Status', options: ['pending', 'confirmed', 'cancelled', 'sat'] }], liveEvent: 'exam_registration.new',
    columns: [{ label: 'Candidate', render: r => `<div class="td-name">${esc(r.full_name)}</div><div class="text-sm text-muted">${esc(r.email)} · ${esc(r.phone || '')}</div>` },
      { label: 'Exam', render: r => esc(r.session ? r.session.title : '—') }, { label: 'Fee', render: r => (r.session && r.session.fee ? money(r.session.fee) : '—') },
      { label: 'Proof', render: r => proof(r.payment_proof_url) }, { label: 'Status', render: r => badge(r.status) }],
    actions: [{ label: 'Mark paid', icon: 'check', cls: 'btn-success', show: r => r.status === 'pending',
      run: async (r, reload) => { await api.update('exam_registrations', r.id, { status: 'confirmed' }); toast('Confirmed'); reload(); } }],
  });

  pages.scholarships = crudPage({
    table: 'scholarship_applications', title: 'Scholarship applications', query: { order: 'created_at.desc' }, expand: 'user,scholarship',
    canCreate: false, canEdit: false, search: false,
    columns: [{ label: 'Student', render: r => esc(r.user ? r.user.full_name : '—') }, { label: 'Scholarship', render: r => esc(r.scholarship ? r.scholarship.title : '') },
      { label: 'Amount', render: r => (r.scholarship && r.scholarship.amount ? money(r.scholarship.amount) : '—') }, { label: 'Status', render: r => badge(r.status) }],
  });

  pages.reports = async content => {
    const reports = [['payments', 'Payments', 'Every payment with receipt number, method and status'], ['invoices', 'Invoices', 'All invoices with balances'], ['students', 'Students', 'Student list with contacts']];
    content.innerHTML = pageHead('Reports', '', 'CSV files that open in Excel or Google Sheets.') + `<div class="grid-auto">${reports.map(([key, title, text]) => `<div class="card"><div class="card-body">
      <h3>${icon('bar-chart')} ${title}</h3><p class="text-sm text-muted">${text}</p>${button('Download', { href: `/api/reports/${key}.csv`, icon: 'download' })}</div></div>`).join('')}</div>`;
  };

  pages.apps = appsPage();
  pages.messages = messagesPage();
  pages.notifications = notificationsPage();
  pages.leave = leavePage();
  pages.profile = profilePage();

  onEvent('payment.new', p => { toast(`New payment reported: ${p.name} — ${money(p.amount)}`); refreshCounts(); });
  onEvent('search:open', r => { if (r.type === 'user') go('statements', { params: { student: r.id } }); });
  startPortal({ roles: ['accounts', 'admin'], nav, pages });
})();
