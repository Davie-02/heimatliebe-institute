/**
 * Reusable portal building blocks.
 *
 *   crudPage(options)    Server-paginated table with search, filters, create/edit forms and row actions.
 *                        Most admin screens are just a crudPage configuration.
 *   formModal(...)       A form in a dialog, generated from a list of field definitions.
 *   messagesPage()       Realtime chat (inbox + conversation).
 *   timetablePage()      Weekly timetable with a "sync to my calendar" button.
 *   calendarPage()       Academic calendar (term dates, holidays, exams).
 *   announcementsFeed / announcementsAdmin / leavePage
 *
 * Field definition: { name, label, type, required, options, lookup, bucket, accept, full, hint, default, show(row) }
 *   type: text (default) | email | tel | url | number | date | datetime | textarea | select | lookup | checkbox | file | filelink
 *   lookup: { table, query, label: row => text }  — options loaded from the data API
 */
(function (global, doc) {
  'use strict';

  /* ── Forms ─────────────────────────────────────────────────────────── */
  async function optionsFor(field) {
    if (field.lookup) {
      const rows = await cachedRows(field.lookup.table, field.lookup.query || '', 30000);
      return rows.map(r => ({ value: r[field.lookup.value || 'id'], label: field.lookup.label(r) }));
    }
    return (field.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o).replace(/_/g, ' ') }));
  }

  function fieldHtml(field, value, options) {
    const id = `f-${field.name}`;
    const required = field.required ? ' required' : '';
    const v = value == null ? (field.default == null ? '' : field.default) : value;
    const label = `<label class="form-label" for="${id}">${esc(field.label)}${field.required ? ' *' : ''}</label>`;
    let input;
    switch (field.type) {
      case 'textarea':
        input = `<textarea class="form-textarea" id="${id}" name="${field.name}" rows="${field.rows || 4}"${required} placeholder="${esc(field.placeholder || '')}">${esc(v)}</textarea>`;
        break;
      case 'select':
      case 'lookup':
        input = `<select class="form-select" id="${id}" name="${field.name}"${required}>${field.required ? '' : '<option value="">—</option>'}
          ${options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        break;
      case 'checkbox':
        return `<div class="form-group${field.full ? ' full' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${field.name}"${(value == null ? field.default : value) ? ' checked' : ''}> ${esc(field.label)}</label></div>`;
      case 'file':
        input = `<input type="hidden" name="${field.name}" value="${esc(v)}">
          <input class="form-input" type="file" id="${id}" data-area="${field.bucket}" data-target="${field.name}" accept="${esc(field.accept || '')}">
          ${v ? `<div class="form-hint">Current file: <a href="${esc(v)}" target="_blank" rel="noopener">${esc(String(v).split('/').pop())}</a></div>` : ''}`;
        break;
      case 'filelink':
        // A link (e.g. Google Drive, YouTube) OR an uploaded file — an uploaded file wins.
        input = `<input class="form-input" type="url" id="${id}" name="${field.name}" value="${esc(v)}" placeholder="https://… (Google Drive, YouTube, website)">
          <input class="form-input mt-sm" type="file" data-area="${field.bucket}" data-target="${field.name}" accept="${esc(field.accept || '')}" aria-label="${esc(field.label)} — upload a file">`;
        break;
      case 'datetime':
        input = `<input class="form-input" type="datetime-local" id="${id}" name="${field.name}" value="${esc(toLocalInput(v))}"${required}>`;
        break;
      case 'date':
        input = `<input class="form-input" type="date" id="${id}" name="${field.name}" value="${esc(String(v || '').slice(0, 10))}"${required}>`;
        break;
      default:
        input = `<input class="form-input" type="${field.type || 'text'}" id="${id}" name="${field.name}" value="${esc(v)}"${required}
          ${field.min != null ? ` min="${field.min}"` : ''}${field.max != null ? ` max="${field.max}"` : ''}${field.step ? ` step="${field.step}"` : ''} placeholder="${esc(field.placeholder || '')}">`;
    }
    return `<div class="form-group${field.full ? ' full' : ''}">${label}${input}${field.hint ? `<div class="form-hint">${esc(field.hint)}</div>` : ''}</div>`;
  }

  /** Read the form, uploading any chosen files first. Returns an object keyed by field name. */
  async function readForm(form, fields) {
    const out = {};
    fields.forEach(field => {
      const el = form.querySelector(`[name="${field.name}"]`);
      if (!el) return;
      if (field.type === 'checkbox') out[field.name] = el.checked;
      else if (field.type === 'number') out[field.name] = el.value === '' ? null : Number(el.value);
      else if (field.type === 'datetime') out[field.name] = el.value ? new Date(el.value).toISOString() : null;
      else out[field.name] = el.value.trim() === '' ? null : el.value.trim();
    });
    for (const input of form.querySelectorAll('input[type=file][data-area]')) {
      if (input.files[0]) out[input.dataset.target] = await uploadFile(input.dataset.area, input.files[0]);
    }
    return out;
  }

  /** Show a generated form in a dialog; `onSubmit(values)` saves it (throw to show an error). */
  async function formModal(title, fields, row, onSubmit, { submitLabel = 'Save', wide = false } = {}) {
    row = row || {};
    const visible = fields.filter(f => !f.show || f.show(row));
    const options = await Promise.all(visible.map(optionsFor));
    const body = openModal(title, `<form class="form-grid" novalidate>${visible.map((f, i) => fieldHtml(f, row[f.name], options[i])).join('')}
      <div class="full flex gap-sm mt-sm"><button class="btn btn-primary" type="submit">${esc(submitLabel)}</button>
      <button class="btn btn-outline" type="button" data-close>Cancel</button></div></form>`, { wide });
    const form = body.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      run(e.submitter, async () => {
        await onSubmit(await readForm(form, visible));
        closeModal();
      });
    });
  }

  /* ── CRUD page ─────────────────────────────────────────────────────── */
  /**
   * options:
   *   table, title, subtitle, singular, createLabel, query (object or function), expand,
   *   columns: [{label, key | render(row), cls}], fields (for create/edit), filters: [{name, label, options, default}],
   *   actions: [{label | label(row), icon, cls, show(row), run(row, reload)}],
   *   canCreate / canEdit / canDelete, report (CSV name), toolbar (HTML), liveEvent, beforeSave(values, row),
   *   rowClick(row, reload), onReady({reload, edit}), pageSize, search (false to hide), empty
   */
  function crudPage(o) {
    const pageSize = o.pageSize || 25;
    return async function (content) {
      const state = { offset: 0, q: '', filters: {} };
      (o.filters || []).forEach(f => { if (f.default) state.filters[f.name] = f.default; });
      const canCreate = o.canCreate !== false && o.fields;
      content.innerHTML = pageHead(o.title,
        (o.report ? button('Export', { href: `/api/reports/${o.report}.csv`, icon: 'download' }) : '') + (o.toolbar || '') +
        (canCreate ? `<button class="btn btn-primary btn-sm" data-crud-new>${icon('plus')}<span>${esc(o.createLabel || 'New')}</span></button>` : ''),
        o.subtitle || '') + `
        <div class="toolbar">
          ${o.search !== false ? '<input class="form-input search-input" type="search" data-crud-q placeholder="Search…" aria-label="Search">' : ''}
          ${(o.filters || []).map(f => `<select class="form-select" data-crud-filter="${f.name}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>
            ${f.options.map(x => { const v = typeof x === 'object' ? x.value : x; const l = typeof x === 'object' ? x.label : String(x).replace(/_/g, ' ');
              return `<option value="${esc(v)}"${f.default === v ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`).join('')}
          <span class="text-sm text-muted" data-crud-count></span>
        </div>
        <div data-crud-table>${skeleton(200)}</div>
        <div class="pager"><span data-crud-range></span>
          <button class="btn btn-outline btn-sm" data-crud-prev aria-label="Previous page">${icon('chevron-left')}</button>
          <button class="btn btn-outline btn-sm" data-crud-next aria-label="Next page">${icon('chevron-right')}</button></div>`;
      const $ = sel => content.querySelector(sel);

      const rowActions = [];
      if (o.canEdit !== false && o.fields) rowActions.push({ label: 'Edit', icon: 'edit', cls: 'btn-ghost', edit: true });
      (o.actions || []).forEach(a => rowActions.push(a));
      if (o.canDelete) rowActions.push({ label: 'Delete', icon: 'trash', cls: 'btn-danger-ghost', remove: true });

      async function load() {
        const holder = $('[data-crud-table]');
        if (!holder) return; // page was left
        const base = typeof o.query === 'function' ? o.query() : (o.query || {});
        const query = Object.assign({}, base, { limit: pageSize, offset: state.offset, count: 'exact' });
        if (o.expand) query.expand = o.expand;
        if (state.q) query.q = state.q;
        Object.keys(state.filters).forEach(k => { if (state.filters[k]) query[k] = `eq.${state.filters[k]}`; });
        try {
          const rows = await api.rows(o.table, query);
          const total = rows.total == null ? rows.length : rows.total;
          const columns = o.columns.slice();
          if (rowActions.length) {
            columns.push({ label: '', render: r => `<div class="row-actions">${rowActions.map((a, i) => (!a.show || a.show(r))
              ? `<button class="btn btn-sm ${a.cls || 'btn-ghost'}" data-row-action="${i}" data-id="${esc(r.id)}">${a.icon ? icon(a.icon) : ''}<span>${esc(typeof a.label === 'function' ? a.label(r) : a.label)}</span></button>` : '').join('')}</div>` });
          }
          holder.innerHTML = table(columns, rows, { empty: o.empty || 'Nothing here yet.' });
          $('[data-crud-count]').textContent = `${total} record${total === 1 ? '' : 's'}`;
          $('[data-crud-range]').textContent = total ? `${state.offset + 1}–${Math.min(state.offset + pageSize, total)} of ${total}` : '';
          $('[data-crud-prev]').disabled = state.offset === 0;
          $('[data-crud-next]').disabled = state.offset + pageSize >= total;
          holder.querySelectorAll('[data-row-action]').forEach(btn => btn.addEventListener('click', async e => {
            e.stopPropagation();
            const row = rows.find(r => String(r.id) === btn.dataset.id);
            const action = rowActions[+btn.dataset.rowAction];
            if (action.edit) return edit(row);
            if (action.remove) {
              if (!(await confirmDialog(`Delete this ${o.singular || 'record'}? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
              return run(btn, async () => { await api.remove(o.table, row.id); clearCache(o.table); toast('Deleted'); load(); });
            }
            await run(btn, () => action.run(row, load));
          }));
          if (o.rowClick) {
            holder.querySelectorAll('tbody tr').forEach((tr, i) => {
              if (!rows[i]) return;
              tr.classList.add('clickable');
              tr.addEventListener('click', e => { if (!e.target.closest('button, a, input, select')) o.rowClick(rows[i], load); });
            });
          }
        } catch (err) {
          holder.innerHTML = alertBox('error', esc(err.message));
        }
      }

      function edit(row) {
        const isNew = !row;
        const title = isNew ? (o.createLabel || 'New') : `Edit ${o.singular || 'record'}`;
        return formModal(title, o.fields, row || {}, async values => {
          const body = o.beforeSave ? await o.beforeSave(values, row) : values;
          if (isNew) await api.create(o.table, body); else await api.update(o.table, row.id, body);
          clearCache(o.table);
          toast(isNew ? 'Created' : 'Saved');
          if (o.afterSave) o.afterSave();
          load();
        }, { wide: o.wideForm });
      }

      const newBtn = $('[data-crud-new]');
      if (newBtn) newBtn.addEventListener('click', () => edit(null));
      const search = $('[data-crud-q]');
      let timer;
      if (search) search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value.trim(); state.offset = 0; load(); }, 300); });
      content.querySelectorAll('[data-crud-filter]').forEach(sel => sel.addEventListener('change', () => { state.filters[sel.dataset.crudFilter] = sel.value; state.offset = 0; load(); }));
      $('[data-crud-prev]').addEventListener('click', () => { state.offset = Math.max(0, state.offset - pageSize); load(); });
      $('[data-crud-next]').addEventListener('click', () => { state.offset += pageSize; load(); });
      if (o.onReady) o.onReady({ reload: load, edit });
      if (o.liveEvent) onEvent(o.liveEvent, () => { if (content.isConnected) load(); });
      await load();
    };
  }

  /* ── Messages (realtime chat) ──────────────────────────────────────── */
  function messagesPage() {
    return async function (content, params) {
      const me = session.get();
      let active = null;
      content.innerHTML = pageHead('Messages', `<button class="btn btn-primary btn-sm" data-new-message>${icon('plus')}<span>New message</span></button>`) +
        `<div class="chat"><div class="chat-list" data-inbox>${skeleton(120)}</div>
         <div class="chat-thread" data-thread>${emptyState('message-square', 'Choose a conversation or start a new one.')}</div></div>`;

      const bubble = m => {
        const mine = m.sender_id === me.id;
        return `<div class="bubble${mine ? ' mine' : ''}"><div class="bubble-meta">${esc(mine ? 'You' : m.sender_name || 'User')} · ${formatDateTime(m.created_at)}</div><div class="bubble-body">${esc(m.body)}</div></div>`;
      };

      async function loadInbox() {
        const list = content.querySelector('[data-inbox]');
        if (!list) return;
        const conversations = await api.get('/api/inbox');
        list.innerHTML = conversations.length ? conversations.map(c => `<button class="chat-item${c.unread ? ' unread' : ''}${c.id === active ? ' active' : ''}" data-open="${c.id}">
          <div class="ci-top"><strong>${esc(c.with.join(', ') || 'Conversation')}</strong><span class="text-sm text-muted">${timeAgo(c.updated_at)}</span></div>
          <div class="text-sm">${esc(c.subject || '')}</div><div class="ci-snippet">${c.last_from_me ? 'You: ' : ''}${esc(c.last_message)}</div></button>`).join('')
          : emptyState('inbox', 'No conversations yet.');
        list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openThread(b.dataset.open)));
      }

      async function openThread(id) {
        active = id;
        const thread = content.querySelector('[data-thread]');
        const conv = await api.get(`/api/conversations/${id}/messages`);
        thread.innerHTML = `<div class="thread-head"><strong>${esc(conv.subject || '')}</strong><div class="text-sm text-muted">${conv.participants.map(p => esc(p.full_name)).join(', ')}</div></div>
          <div class="thread-msgs" data-msgs>${conv.messages.map(bubble).join('')}</div>
          <form class="reply" data-reply><textarea class="form-textarea" name="body" rows="1" placeholder="Write a reply…" aria-label="Reply" required></textarea>
          <button class="btn btn-primary btn-icon" aria-label="Send">${icon('arrow-right')}</button></form>`;
        const box = thread.querySelector('[data-msgs]');
        box.scrollTop = box.scrollHeight;
        const form = thread.querySelector('[data-reply]');
        form.body.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
        form.addEventListener('submit', e => {
          e.preventDefault();
          const text = form.body.value.trim();
          if (!text) return;
          run(e.submitter, async () => {
            const res = await api.post(`/api/conversations/${id}/messages`, { body: text });
            box.insertAdjacentHTML('beforeend', bubble({ body: text, sender_id: me.id, created_at: res.created_at }));
            box.scrollTop = box.scrollHeight;
            form.reset();
            loadInbox();
          });
        });
        loadInbox();
        refreshCounts();
      }

      content.querySelector('[data-new-message]').addEventListener('click', () => {
        const body = openModal('New message', `<form data-compose>
          <div class="form-group"><label class="form-label" for="to">To</label><input class="form-input" id="to" data-to placeholder="Type a name or ID…" autocomplete="off"><input type="hidden" name="recipient">
          <div class="pick-list" data-people></div></div>
          <div class="form-group"><label class="form-label" for="subject">Subject</label><input class="form-input" id="subject" name="subject"></div>
          <div class="form-group"><label class="form-label" for="msg">Message</label><textarea class="form-textarea" id="msg" name="body" rows="5" required></textarea></div>
          <button class="btn btn-primary" type="submit">${icon('arrow-right')}<span>Send</span></button></form>`);
        const form = body.querySelector('[data-compose]');
        const to = body.querySelector('[data-to]');
        const people = body.querySelector('[data-people]');
        let timer;
        async function search() {
          const found = await api.get('/api/directory', { q: to.value.trim() });
          people.innerHTML = found.map(p => `<button type="button" class="pick" data-id="${p.id}" data-name="${esc(p.full_name)}">${esc(p.full_name)} <small>${esc(p.user_id)} · ${esc(p.role)}${p.department ? ' · ' + esc(p.department) : ''}</small></button>`).join('')
            || '<p class="text-sm text-muted">No matches</p>';
          people.querySelectorAll('.pick').forEach(p => p.addEventListener('click', () => { form.recipient.value = p.dataset.id; to.value = p.dataset.name; people.innerHTML = ''; }));
        }
        to.addEventListener('input', () => { form.recipient.value = ''; clearTimeout(timer); timer = setTimeout(search, 200); });
        search();
        form.addEventListener('submit', e => {
          e.preventDefault();
          run(e.submitter, async () => {
            if (!form.recipient.value) throw new Error('Choose who to send the message to.');
            const res = await api.post('/api/conversations', { recipient: form.recipient.value, subject: form.subject.value, body: form.body.value });
            closeModal();
            toast('Message sent');
            await loadInbox();
            openThread(res.id);
          });
        });
      });

      onEvent('message', m => {
        if (!content.isConnected) return;
        if (m.conversation_id === active) openThread(active); else loadInbox();
      });
      await loadInbox();
      if (params && params.get('c')) openThread(params.get('c'));
    };
  }

  /* ── Timetable & calendar ──────────────────────────────────────────── */
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function timetablePage(title) {
    return async function (content) {
      const [rows, cal] = await Promise.all([api.get('/api/me/timetable'), api.get('/api/calendar/link').catch(() => null)]);
      const today = new Date().getDay();
      content.innerHTML = pageHead(title || 'My timetable',
        (cal ? button('Add to Google Calendar', { href: cal.google, icon: 'calendar', cls: 'btn-primary btn-sm' }) : '') +
        button('Print', { action: 'print', icon: 'printer' })) +
        (rows.length ? `<div class="week">${[1, 2, 3, 4, 5, 6, 0].map(d => {
          const slots = rows.filter(r => r.day_of_week === d);
          return `<div class="day${d === today ? ' today' : ''}"><div class="day-name">${DAYS[d]}</div>${slots.length ? slots.map(r => `
            <div class="slot"><div class="slot-time">${esc(r.start_time)}–${esc(r.end_time)}</div><div class="slot-title">${esc(r.class_name)}</div>
            <div class="slot-meta">${r.room ? 'Room ' + esc(r.room) : ''}${r.teacher ? ' · ' + esc(r.teacher) : ''}</div>
            ${r.meeting_url ? `<a class="btn btn-success btn-sm mt-sm" href="${esc(r.meeting_url)}" target="_blank" rel="noopener">${icon('video')}<span>Join online</span></a>` : ''}</div>`).join('')
            : '<div class="slot slot-meta">No classes</div>'}</div>`;
        }).join('')}</div>` : emptyState('clock', 'No timetable yet.'));
    };
  }

  const EVENT_ICON = { term: 'book', holiday: 'sun', exam: 'edit', event: 'star', deadline: 'clock' };

  function calendarPage(editable) {
    return async function (content) {
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const events = await api.rows('events', { order: 'start_date.asc', start_date: `gte.${since}`, limit: 300 });
      const months = {};
      events.forEach(e => { const key = e.start_date.slice(0, 7); (months[key] = months[key] || []).push(e); });
      content.innerHTML = pageHead('Academic calendar', editable ? `<button class="btn btn-primary btn-sm" data-new-event>${icon('plus')}<span>Add event</span></button>` : '') +
        (events.length ? Object.keys(months).map(m => `<div class="card mb-md"><div class="card-header"><h3>${new Date(m + '-01T12:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3></div>
          <div class="card-body">${months[m].map(e => `<div class="list-item flex justify-between items-center gap-sm"><div>
            <div class="li-title">${icon(EVENT_ICON[e.type] || 'calendar')} ${esc(e.title)}</div>
            <div class="li-meta">${formatDate(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ' – ' + formatDate(e.end_date) : ''} · ${esc(e.type)}${e.description ? ' · ' + esc(e.description) : ''}</div></div>
            ${editable ? `<button class="btn btn-danger-ghost btn-sm" data-delete-event="${e.id}" aria-label="Delete event">${icon('trash')}</button>` : ''}</div>`).join('')}</div></div>`).join('')
          : emptyState('calendar', 'No upcoming events.'));
      if (!editable) return;
      content.querySelector('[data-new-event]').addEventListener('click', () => formModal('Add event', [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'type', label: 'Type', type: 'select', options: ['term', 'holiday', 'exam', 'event', 'deadline'], required: true },
        { name: 'public', label: 'Show on the public website', type: 'checkbox', default: true },
        { name: 'start_date', label: 'Start date', type: 'date', required: true }, { name: 'end_date', label: 'End date', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea', full: true }],
        {}, async values => { await api.create('events', values); toast('Event added'); refresh(); }));
      content.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete this event?', { ok: 'Delete', danger: true })) { await api.remove('events', b.dataset.deleteEvent); refresh(); }
      }));
    };
  }

  async function announcementsFeed(limit) {
    const rows = await api.rows('announcements', { order: 'pinned.desc,created_at.desc', limit: limit || 5 }).catch(() => []);
    return rows.length ? rows.map(a => `<div class="list-item${a.pinned ? ' pinned' : ''}"><div class="li-title">${a.pinned ? icon('pin') : ''}${esc(a.title)}</div>
      <div class="li-meta">${esc(a.body || '')}</div><div class="li-meta">${timeAgo(a.created_at)}</div></div>`).join('')
      : '<p class="text-muted text-sm">No announcements.</p>';
  }

  function announcementsAdmin(opts) {
    opts = opts || {};
    return crudPage({
      table: 'announcements', title: 'Announcements', singular: 'announcement', createLabel: 'New announcement',
      query: { order: 'created_at.desc' }, canDelete: true, search: false,
      columns: [
        { label: 'Title', render: r => `<div class="td-name">${r.pinned ? icon('pin') + ' ' : ''}${esc(r.title)}</div><div class="text-sm text-muted">${esc((r.body || '').slice(0, 90))}</div>` },
        { label: 'Audience', render: r => esc(r.audience) + (r.class_id ? ' (class)' : '') },
        { label: 'Status', render: r => badge(r.published ? 'published' : 'draft') },
        { label: 'Posted', render: r => formatDate(r.created_at) }],
      fields: [
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'body', label: 'Message', type: 'textarea', full: true },
        ...(opts.classLookup ? [{ name: 'class_id', label: 'Class', type: 'lookup', required: opts.classRequired, lookup: opts.classLookup }] : []),
        { name: 'audience', label: 'Who sees it', type: 'select', options: opts.audiences || ['all', 'students', 'staff', 'teacher', 'accounts', 'hr'], default: 'all' },
        { name: 'expires_at', label: 'Show until', type: 'date' },
        { name: 'pinned', label: 'Pin to the top', type: 'checkbox' },
        { name: 'published', label: 'Published', type: 'checkbox', default: true }],
    });
  }

  function leavePage() {
    return crudPage({
      table: 'leave_requests', title: 'My leave requests', singular: 'leave request', createLabel: 'Request leave',
      query: () => ({ user_id: `eq.${session.get().id}`, order: 'created_at.desc' }), search: false, canEdit: false,
      columns: [{ label: 'Type', key: 'type' }, { label: 'From', render: r => formatDate(r.start_date) },
        { label: 'To', render: r => formatDate(r.end_date) }, { label: 'Reason', key: 'reason' }, { label: 'Status', render: r => badge(r.status) }],
      fields: [
        { name: 'type', label: 'Type of leave', type: 'select', options: ['annual', 'sick', 'maternity', 'study', 'unpaid', 'other'], required: true },
        { name: 'start_date', label: 'From', type: 'date', required: true }, { name: 'end_date', label: 'To', type: 'date', required: true },
        { name: 'reason', label: 'Reason', type: 'textarea', full: true }],
      actions: [{ label: 'Withdraw', icon: 'x', cls: 'btn-danger-ghost', show: r => r.status === 'pending',
        run: async (r, reload) => { if (await confirmDialog('Withdraw this leave request?')) { await api.remove('leave_requests', r.id); reload(); } } }],
    });
  }

  actions({ print: () => global.print() });

  Object.assign(global, { crudPage, formModal, messagesPage, timetablePage, calendarPage, announcementsFeed, announcementsAdmin, leavePage, DAYS });
})(window, document);
