/** Public library with filters. Resources marked "for students" open only after signing in. */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  let items = [];
  let signedIn = false;

  function fillFilter(sel, values) {
    $(sel).insertAdjacentHTML('beforeend', [...new Set(values.filter(Boolean))].sort().map(v => `<option>${esc(v)}</option>`).join(''));
  }

  function render() {
    const q = $('[data-q]').value.toLowerCase();
    const language = $('[data-language]').value, level = $('[data-level]').value, type = $('[data-type]').value;
    const shown = items.filter(i => (!language || i.language === language) && (!level || i.level === level) && (!type || i.type === type) &&
      [i.title, i.author, i.language, i.type, i.description].join(' ').toLowerCase().includes(q));
    $('[data-count]').textContent = `${shown.length} resource${shown.length === 1 ? '' : 's'}`;
    $('[data-items]').innerHTML = shown.length ? shown.map(i => {
      const locked = !i.free && !signedIn;
      const open = !i.file_url ? '' : locked
        ? `<a class="btn btn-outline btn-sm" href="/login.html?next=/library.html">${icon('lock')}<span>Sign in to open</span></a>`
        : (embedUrl(i.file_url) ? button('Read', { action: 'read', data: { id: i.id }, icon: 'eye', cls: 'btn-primary btn-sm' }) : '') + button('Open', { href: i.file_url, icon: 'external' });
      return `<div class="card">${i.cover_url ? `<img class="card-media" src="${esc(i.cover_url)}" alt="" loading="lazy" decoding="async">` : ''}
        <div class="card-body"><div class="flex gap-sm flex-wrap mb-sm">${badge('info', i.language || 'General')}${badge('neutral', i.level || 'All levels')}${i.free ? '' : badge('pending', 'for students')}</div>
        <h3>${esc(i.title)}</h3>${i.author ? `<p class="text-sm text-muted">${esc(i.author)}</p>` : ''}<p class="text-sm">${esc((i.description || '').slice(0, 160))}</p></div>
        ${open ? `<div class="card-footer">${open}</div>` : ''}</div>`;
    }).join('') : emptyState('book-open', 'No resources match your search.');
  }

  actions({ read: el => {
    const i = items.find(x => x.id === el.dataset.id);
    openModal(i.title, `<iframe class="embed" src="${esc(embedUrl(i.file_url))}" title="${esc(i.title)}" loading="lazy" allow="fullscreen"></iframe>`, { wide: true });
  } });

  Promise.all([api.rows('library', { order: 'created_at.desc', limit: 1000 }), api.get('/api/session').then(r => !!r.user).catch(() => false)]).then(([rows, me]) => {
    items = rows;
    signedIn = me;
    fillFilter('[data-language]', items.map(i => i.language));
    fillFilter('[data-level]', items.map(i => i.level));
    fillFilter('[data-type]', items.map(i => i.type));
    ['[data-q]', '[data-language]', '[data-level]', '[data-type]'].forEach(sel => $(sel).addEventListener(sel === '[data-q]' ? 'input' : 'change', render));
    render();
  });
})();
