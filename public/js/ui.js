/**
 * UI helpers shared by all portals: escaping, formatting, icons, click actions, modals, toasts,
 * tables and charts. Everything renders to HTML strings; user data is always passed through esc().
 */
(function (global, doc) {
  'use strict';

  /* ── Escaping & formatting ─────────────────────────────────────────── */
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ESCAPES[ch]);

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d) ? esc(value) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d) ? esc(value) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function timeAgo(value) {
    if (!value) return '';
    const seconds = (Date.now() - new Date(value)) / 1000;
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' d ago';
    return formatDate(value);
  }
  /** Value for <input type="datetime-local"> in the user's time zone. */
  function toLocalInput(value) {
    if (!value) return '';
    const d = new Date(value);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  let currency = 'MWK';
  siteConfig().then(c => { currency = (c.institution && c.institution.currency) || currency; });
  const money = value => `${currency} ${Number(value || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;

  /* ── Icons (SVG sprite in /img/icons.svg) ──────────────────────────── */
  const icon = (name, cls) => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="/img/icons.svg#i-${name}"></use></svg>`;

  /* ── Status badges ─────────────────────────────────────────────────── */
  const BADGE_TONE = {
    success: 'active approved confirmed paid present converted awarded graded published completed graduated pass open',
    warning: 'pending new partial late under_review interview contacted follow_up waitlisted submitted',
    danger: 'rejected overdue absent suspended revoked cancelled fail closed',
    info: 'excused sat info',
  };
  function badge(status, label) {
    const key = String(status == null ? '' : status);
    const tone = Object.keys(BADGE_TONE).find(t => BADGE_TONE[t].split(' ').includes(key)) || 'neutral';
    return `<span class="badge badge-${tone}">${esc(label || key.replace(/_/g, ' ') || '—')}</span>`;
  }

  /* ── Click actions (no inline onclick attributes, so a strict CSP is possible) ──
   * Markup:  <button data-action="openAssignment" data-id="…">
   * Code:    actions({ openAssignment: (el) => … })
   */
  const handlers = {};
  function actions(map) { Object.assign(handlers, map); }
  doc.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el || !handlers[el.dataset.action]) return;
    event.preventDefault();
    Promise.resolve(handlers[el.dataset.action](el, event)).catch(err => toast(err.message || String(err), true));
  });

  /** A small button/link with an icon. `data` becomes data-* attributes. */
  function button(label, { action, icon: iconName, cls = 'btn-outline btn-sm', data = {}, href, title } = {}) {
    const attrs = Object.keys(data).map(k => ` data-${k}="${esc(data[k])}"`).join('');
    const inner = (iconName ? icon(iconName) : '') + (label ? `<span>${esc(label)}</span>` : '');
    const t = title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '';
    if (href) return `<a class="btn ${cls}" href="${esc(href)}"${attrs}${t} target="_blank" rel="noopener">${inner}</a>`;
    return `<button type="button" class="btn ${cls}" data-action="${esc(action)}"${attrs}${t}>${inner}</button>`;
  }

  /* ── Modal ─────────────────────────────────────────────────────────── */
  let modalEl = null;
  let modalLocked = false;
  let lastFocus = null;
  function openModal(title, bodyHtml, { wide = false, locked = false } = {}) {
    if (!modalEl) {
      modalEl = doc.createElement('div');
      modalEl.className = 'modal';
      modalEl.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><div class="modal-title" id="modal-title"></div>
        <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body"></div></div>`;
      modalEl.addEventListener('click', e => { if (e.target === modalEl || e.target.closest('[data-close]')) closeModal(); });
      doc.body.appendChild(modalEl);
    }
    lastFocus = doc.activeElement;
    modalLocked = locked;
    modalEl.querySelector('[data-close]').hidden = locked;
    modalEl.querySelector('.modal-box').classList.toggle('wide', wide);
    modalEl.querySelector('.modal-title').textContent = title;
    const body = modalEl.querySelector('.modal-body');
    body.innerHTML = bodyHtml;
    modalEl.classList.add('open');
    doc.body.style.overflow = 'hidden';
    const first = body.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
    if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 60);
    return body;
  }
  function closeModal(force) {
    if (!modalEl || (modalLocked && !force)) return;
    modalLocked = false;
    modalEl.classList.remove('open');
    doc.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /** Promise-based confirmation dialog. Resolves true/false. */
  function confirmDialog(message, { ok = 'Confirm', danger = false } = {}) {
    return new Promise(resolve => {
      const body = openModal('Please confirm', `<p>${esc(message)}</p>
        <div class="flex gap-sm mt-md"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
        <button class="btn btn-outline" data-cancel>Cancel</button></div>`);
      body.querySelector('[data-ok]').onclick = () => { closeModal(); resolve(true); };
      body.querySelector('[data-cancel]').onclick = () => { closeModal(); resolve(false); };
    });
  }

  /* ── Toasts ────────────────────────────────────────────────────────── */
  let stack = null;
  function toast(message, isError) {
    if (!stack) {
      stack = doc.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      doc.body.appendChild(stack);
    }
    const el = doc.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.innerHTML = icon(isError ? 'alert' : 'check-circle') + `<span>${esc(message)}</span>`;
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, isError ? 5500 : 3500);
  }

  /**
   * Run an async action tied to a button: shows a spinner, disables the button to prevent double
   * submissions, and reports errors as a toast. Returns the action's result (undefined on error).
   */
  async function run(button, fn) {
    const el = button && button.tagName ? button : null;
    const original = el && el.innerHTML;
    if (el) { el.disabled = true; el.innerHTML = '<span class="spinner"></span>'; }
    try { return await fn(); } catch (err) { toast(err.message || String(err), true); } finally {
      if (el && el.isConnected) { el.disabled = false; el.innerHTML = original; }
    }
  }

  /** Collect named form fields into an object (numbers as numbers, blanks as null, checkboxes as booleans). */
  function formValues(form) {
    const out = {};
    form.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'file' || (el.type === 'radio' && !el.checked)) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
      else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
    });
    return out;
  }

  /* ── Tables, stats and charts ──────────────────────────────────────── */
  /** table([{label, key | render(row), cls}], rows, {empty}) */
  function table(columns, rows, { empty = 'Nothing here yet.' } = {}) {
    const head = columns.map(c => `<th>${esc(c.label)}</th>`).join('');
    const body = rows && rows.length
      ? rows.map(row => `<tr>${columns.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.render ? c.render(row) : esc(row[c.key] == null ? '—' : row[c.key])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="empty-cell">${esc(empty)}</td></tr>`;
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /** stats([{value, label, icon, page, accent}]) — clicking a stat with `page` opens that page. */
  function stats(items) {
    return `<div class="stats">${items.map(i => `<div class="stat${i.accent ? ' accent' : ''}"${i.page ? ` data-page="${i.page}" role="link" tabindex="0"` : ''}>
      ${i.icon ? icon(i.icon) : ''}<div class="stat-value">${i.value == null ? '—' : i.value}</div><div class="stat-label">${esc(i.label)}</div></div>`).join('')}</div>`;
  }

  function barChart(data, { format = v => Number(v).toLocaleString(), empty = 'No data yet.' } = {}) {
    if (!data || !data.length) return `<p class="text-muted">${esc(empty)}</p>`;
    const max = Math.max(...data.map(d => Number(d.value) || 0), 1);
    return `<div class="bars">${data.map(d => `<div class="bar-row"><span class="bar-label" title="${esc(d.label)}">${esc(d.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (Number(d.value) || 0) / max * 100)}%"></span></span>
      <span class="bar-value">${esc(format(d.value))}</span></div>`).join('')}</div>`;
  }

  function columnChart(data, { format = v => Number(v).toLocaleString(), empty = 'No data yet.' } = {}) {
    if (!data || !data.length) return `<p class="text-muted">${esc(empty)}</p>`;
    const max = Math.max(...data.map(d => Number(d.value) || 0), 1);
    return `<div class="columns">${data.map(d => `<div class="column" title="${esc(d.label)}: ${esc(format(d.value))}">
      <span class="column-value">${esc(format(d.value))}</span><span class="column-bar" style="height:${Math.max(2, (Number(d.value) || 0) / max * 100)}%"></span>
      <span class="column-label">${esc(d.label)}</span></div>`).join('')}</div>`;
  }

  const emptyState = (iconName, text) => `<div class="empty">${icon(iconName)}<p>${esc(text)}</p></div>`;
  const alertBox = (tone, text, iconName) => `<div class="alert alert-${tone}">${icon(iconName || ({ error: 'alert', warning: 'alert', success: 'check-circle' }[tone] || 'info'))}<div>${text}</div></div>`;
  const skeleton = (height = 160) => `<div class="skeleton" style="height:${height}px"></div>`;

  /** Browser-side CSV download for small tables already on screen (large exports stream from the server). */
  function downloadCSV(filename, headers, rows) {
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
    const link = doc.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /**
   * Turn a shared link into an embeddable URL where the provider supports it
   * (Google Docs/Sheets/Slides/Forms/Drive, YouTube). Returns null when it can't be embedded.
   */
  function embedUrl(url) {
    if (!url) return null;
    let m = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/${m[1] === 'presentation' ? 'embed' : 'preview'}`;
    m = url.match(/docs\.google\.com\/forms\/d\/e?\/?([\w-]+)/);
    if (m) return url.replace(/\/(viewform|edit)(\?.*)?$/, '/viewform?embedded=true');
    m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
    m = url.match(/drive\.google\.com\/drive\/folders\/([\w-]+)/);
    if (m) return `https://drive.google.com/embeddedfolderview?id=${m[1]}#grid`;
    m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    if (/\.pdf($|\?)/i.test(url) && url.startsWith('/')) return url;
    return null;
  }

  Object.assign(global, {
    esc, formatDate, formatDateTime, timeAgo, toLocalInput, money, icon, badge, actions, button,
    openModal, closeModal, confirmDialog, toast, run, formValues, table, stats, barChart, columnChart,
    emptyState, alertBox, skeleton, downloadCSV, embedUrl,
  });
})(window, document);
