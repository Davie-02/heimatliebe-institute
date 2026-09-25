/**
 * Public website behaviour.
 *
 * Every public page: mobile menu, reveal-on-scroll, back-to-top button, footer year and social links,
 * offline support (service worker).
 * Homepage only: applies the text admins edit under "Homepage content", then loads courses, news,
 * gallery, downloads and testimonials from the API, and sends the contact form to the enquiries inbox.
 */
(function (doc) {
  'use strict';
  // Enable fade-in-on-scroll only where it can work, so content is never left hidden.
  if ('IntersectionObserver' in window) doc.documentElement.classList.add('js');

  /* ── Shared behaviour ──────────────────────────────────────────────── */
  actions({
    toggleNav: el => {
      const nav = doc.getElementById('site-nav');
      const open = nav.classList.toggle('open');
      el.setAttribute('aria-expanded', String(open));
    },
    toTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });
  doc.querySelectorAll('#site-nav a').forEach(a => a.addEventListener('click', () => doc.getElementById('site-nav').classList.remove('open')));
  doc.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  const toTop = doc.querySelector('.to-top');
  if (toTop) window.addEventListener('scroll', () => toTop.classList.toggle('show', window.scrollY > 600), { passive: true });

  // Fade sections in as they scroll into view (skipped entirely on browsers without IntersectionObserver).
  function observeReveals(root) {
    const items = (root || doc).querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));
  }
  observeReveals();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  siteConfig().then(cfg => {
    const s = cfg.site || {};
    const social = [['social_facebook', 'Facebook'], ['social_instagram', 'Instagram'], ['social_tiktok', 'TikTok'], ['social_youtube', 'YouTube']]
      .filter(([key]) => /^https?:\/\//.test(s[key] || ''))
      .map(([key, label]) => `<a href="${esc(s[key])}" target="_blank" rel="noopener">${label}</a>`);
    if (cfg.whatsapp) social.unshift(`<a href="https://wa.me/${esc(cfg.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`);
    doc.querySelectorAll('[data-social]').forEach(el => { el.innerHTML = social.join(''); });
  });

  if (!doc.querySelector('.hero')) return; // the rest is homepage-only

  /* ── Admin-editable homepage text ──────────────────────────────────── */
  function applySiteText(s) {
    doc.querySelectorAll('[data-site]').forEach(el => {
      const value = s[el.dataset.site];
      if (typeof value !== 'string' || !value) return;
      el.textContent = value;
      if (el.dataset.siteHref === 'tel') el.href = 'tel:' + value.replace(/[^\d+]/g, '');
      if (el.dataset.siteHref === 'mailto') el.href = 'mailto:' + value;
    });
    doc.querySelectorAll('[data-site-paragraphs]').forEach(el => {
      const value = s[el.dataset.siteParagraphs];
      if (value) el.innerHTML = value.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('');
    });
    const words = s.hero_words;
    const tower = doc.querySelector('[data-site-list="hero_words"]');
    if (Array.isArray(words) && words.length && tower) {
      tower.innerHTML = words.slice(0, 5).map(w => `<span>${esc(w)}</span>`).join('');
      tower.setAttribute('aria-label', words.join(' '));
    }
    const render = {
      stats: list => list.map(x => `<div class="highlight"><strong>${esc(x.num)}</strong><span>${esc(x.label)}</span></div>`).join(''),
      goals: list => list.map(g => `<div class="tile reveal"><span class="tile-icon">${icon(g.icon || 'star')}</span><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p></div>`).join(''),
      languages: list => list.map(l => `<div class="language reveal"><span class="language-code">${esc(l.code || (l.name || '').slice(0, 2).toUpperCase())}</span>
        <h3>${esc(l.name)}</h3><p>${esc(l.desc || '')}</p>${badge(l.status === 'Currently Offered' ? 'active' : 'pending', l.status)}</div>`).join(''),
    };
    doc.querySelectorAll('[data-site-render]').forEach(el => {
      const list = s[el.dataset.siteRender];
      if (Array.isArray(list) && list.length) el.innerHTML = render[el.dataset.siteRender](list);
    });
    observeReveals();
  }

  /* ── Live sections ─────────────────────────────────────────────────── */
  const holder = name => doc.querySelector(`[data-dynamic="${name}"]`);
  const load = (table, query) => api.rows(table, Object.assign({ limit: 60 }, query)).catch(() => []);
  const BADGE_FOR = { 'Enrolling Now': 'active', 'Starting Soon': 'pending', 'Coming Soon': 'info', Full: 'closed' };

  async function renderCourses() {
    const courses = await load('courses', { order: 'title.asc' });
    const rank = { 'Enrolling Now': 0, 'Starting Soon': 1, 'Coming Soon': 2, Full: 3 };
    courses.sort((a, b) => (rank[a.status] == null ? 2 : rank[a.status]) - (rank[b.status] == null ? 2 : rank[b.status]));
    holder('courses').innerHTML = courses.length ? courses.map(c => `<article class="course reveal">
        <div class="course-lang">${esc(c.language || '')}</div><h3>${esc(c.title)}</h3>
        <div class="course-meta">${c.schedule ? `<div>${icon('calendar')}${esc(c.schedule)}</div>` : ''}${c.duration ? `<div>${icon('clock')}${esc(c.duration)}</div>` : ''}
          ${c.level ? `<div>${icon('target')}Level ${esc(c.level)}</div>` : ''}</div>
        <div class="course-foot"><span class="course-fee">${esc(c.fee || '')}</span>${badge(BADGE_FOR[c.status] || 'info', c.status || 'Coming Soon')}</div>
        ${c.status === 'Enrolling Now' ? `<a class="btn btn-primary btn-sm mt-md" href="/apply.html?course=${encodeURIComponent(c.language || '')}&level=${encodeURIComponent(c.level || '')}">Apply for this course</a>` : ''}
      </article>`).join('') : '<p class="text-muted">New courses will be announced soon.</p>';
  }

  let newsItems = [];
  async function renderNews() {
    newsItems = await load('news', { order: 'date.desc.nullslast', limit: 6 });
    holder('news').innerHTML = newsItems.length ? newsItems.map((n, i) => `<article class="news-card reveal">
        ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" decoding="async">` : ''}
        <div class="body"><div class="news-cat">${esc(n.category || 'Update')}</div><h3>${esc(n.title)}</h3><p>${esc(n.summary || '')}</p>
        <div class="text-sm text-muted mb-sm">${formatDate(n.date || n.created_at)}</div>
        ${n.body ? `<button class="btn btn-outline btn-sm more" data-action="readNews" data-index="${i}">Read more ${icon('arrow-right')}</button>` : ''}</div></article>`).join('')
      : '<p class="text-muted">News will appear here soon.</p>';
  }

  /** Safe Markdown subset for news articles: text is escaped first, then bold/italic/lists/links are applied. */
  function markdown(text) {
    const inline = s => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return text.split(/\n\s*\n/).map(block => {
      const lines = block.trim().split('\n');
      if (lines.every(l => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) return `<h3>${inline(heading[2])}</h3>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }
  actions({ readNews: el => {
    const n = newsItems[+el.dataset.index];
    openModal(n.title, `<div class="article">${n.image ? `<img src="${esc(n.image)}" alt="">` : ''}<div class="news-cat">${esc(n.category || '')} · ${formatDate(n.date)}</div>
      <div class="article-body mt-sm">${markdown(n.body || '')}</div></div>`, { wide: true });
  } });

  let photos = [];
  let photoIndex = 0;
  async function renderGallery() {
    photos = await load('gallery', { order: 'created_at.desc' });
    const grid = holder('gallery');
    const categories = [...new Set(photos.map(p => p.category).filter(Boolean))];
    const filters = doc.querySelector('[data-gallery-filters]');
    const draw = category => {
      const shown = photos.map((p, i) => ({ p, i })).filter(x => !category || x.p.category === category);
      grid.innerHTML = shown.length ? shown.map(({ p, i }) => `<button class="photo" data-photo="${i}" aria-label="Open photo${p.caption ? ': ' + esc(p.caption) : ''}">
        <img src="${esc(p.src)}" alt="${esc(p.caption || '')}" loading="lazy" decoding="async">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</button>`).join('')
        : '<p class="text-muted">Photos will appear here soon.</p>';
    };
    if (categories.length > 1) {
      filters.hidden = false;
      filters.innerHTML = ['<button class="filter active" data-filter="">All</button>'].concat(categories.map(c => `<button class="filter" data-filter="${esc(c)}">${esc(c)}</button>`)).join('');
      filters.addEventListener('click', e => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        filters.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b));
        draw(b.dataset.filter);
      });
    }
    draw('');
  }

  const box = doc.querySelector('[data-lightbox]');
  function showPhoto(i) {
    photoIndex = (i + photos.length) % photos.length;
    box.querySelector('img').src = photos[photoIndex].src;
    box.querySelector('img').alt = photos[photoIndex].caption || '';
    box.querySelector('p').textContent = photos[photoIndex].caption || '';
    box.classList.add('open');
  }
  doc.addEventListener('click', e => {
    const photo = e.target.closest('[data-photo]');
    if (photo) showPhoto(+photo.dataset.photo);
    const control = e.target.closest('[data-lb]');
    if (control) ({ close: () => box.classList.remove('open'), prev: () => showPhoto(photoIndex - 1), next: () => showPhoto(photoIndex + 1) })[control.dataset.lb]();
    else if (e.target === box) box.classList.remove('open');
  });
  doc.addEventListener('keydown', e => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') box.classList.remove('open');
    if (e.key === 'ArrowRight') showPhoto(photoIndex + 1);
    if (e.key === 'ArrowLeft') showPhoto(photoIndex - 1);
  });

  async function renderDocuments() {
    const docs = await load('documents', { order: 'date.desc.nullslast' });
    holder('documents').innerHTML = docs.length ? docs.map(d => `<div class="doc reveal">${icon('file-text')}
        <div class="doc-info"><div class="doc-title">${esc(d.title)}</div><div class="doc-meta">${esc(d.type || '')}${d.date ? ' · ' + formatDate(d.date) : ''}</div>
        ${d.description ? `<div class="text-sm text-muted">${esc(d.description)}</div>` : ''}</div>
        <a class="btn btn-outline btn-sm" href="${esc(d.file)}" target="_blank" rel="noopener" download>${icon('download')}<span>Download</span></a></div>`).join('')
      : '<p class="text-muted">Documents will appear here soon.</p>';
  }

  async function renderTestimonials() {
    const quotes = await load('testimonials', { order: 'created_at.desc' });
    const section = doc.getElementById('testimonials');
    if (!quotes.length) { section.hidden = true; return; }
    holder('testimonials').innerHTML = quotes.map(t => `<figure class="quote reveal"><p>${esc(t.body)}</p>
      <figcaption class="quote-by"><span class="avatar">${t.photo ? `<img src="${esc(t.photo)}" alt="" loading="lazy">` : esc((t.name || '?').charAt(0))}</span>
      <span><strong>${esc(t.name)}</strong><small>${esc(t.course || '')}</small></span></figcaption></figure>`).join('');
  }

  /* ── Contact form → enquiries inbox (+ optional WhatsApp) ──────────── */
  const form = doc.getElementById('enquiry-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const status = form.querySelector('[data-form-status]');
    const values = formValues(form);
    if (!values.name) { status.innerHTML = alertBox('error', 'Please tell us your name.'); return; }
    if (!values.phone && !values.email) { status.innerHTML = alertBox('error', 'Please give a phone number or an email address so we can reply.'); return; }
    const cfg = await siteConfig();
    let whatsappWindow = null;
    if (values.whatsapp && cfg.whatsapp) {
      // Open WhatsApp immediately (browsers block pop-ups opened after an await on slow networks).
      const text = [`Hello Heimatliebe Institute! My name is ${values.name}.`, values.interest ? `I'm interested in: ${values.interest}` : '', values.message || ''].filter(Boolean).join('\n');
      whatsappWindow = window.open(`https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
    await run(e.submitter, async () => {
      await api.post('/api/contact-enquiry', { name: values.name, email: values.email, phone: values.phone, interest: values.interest, message: values.message });
      status.innerHTML = alertBox('success', 'Thank you! Your message has reached us and we will be in touch shortly.');
      form.reset();
    });
    return whatsappWindow;
  });

  siteConfig().then(cfg => applySiteText(cfg.site || {}));
  Promise.all([renderCourses(), renderNews(), renderGallery(), renderDocuments(), renderTestimonials()]).then(() => observeReveals());
})(document);
