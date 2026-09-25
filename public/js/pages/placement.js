/** Placement test: details → questions (with progress) → recommended CEFR level and a link to apply. */
(function () {
  'use strict';
  const app = document.querySelector('[data-app]');
  const start = document.getElementById('start-form');
  const say = html => { const s = app.querySelector('[data-status]'); if (s) s.innerHTML = html; };

  api.get('/api/placement').then(res => {
    start.language.innerHTML = res.languages.map(l => `<option${l === 'German' ? ' selected' : ''}>${esc(l)}</option>`).join('');
  });

  start.addEventListener('submit', e => {
    e.preventDefault();
    const person = formValues(start);
    if (!person.full_name || person.full_name.length < 2) return say(alertBox('error', 'Please enter your full name.'));
    run(e.submitter, async () => {
      const { questions } = await api.get(`/api/placement/${encodeURIComponent(person.language)}`);
      renderTest(person, questions);
    });
  });

  function renderTest(person, questions) {
    app.innerHTML = `<div class="eyebrow">${esc(person.language)} placement test</div>
      <div class="flex justify-between text-sm mb-sm"><span>Answer what you can</span><span data-count>0 of ${questions.length} answered</span></div>
      <div class="progress mb-md"><span data-bar style="width:0"></span></div>
      <form id="test-form">${questions.map((q, i) => `<fieldset class="question" style="border:1px solid var(--border)">
        <legend class="question-text">${i + 1}. ${esc(q.q)}</legend>
        ${q.options.map((o, j) => `<label class="option"><input type="radio" name="q${q.n}" value="${j}"> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
        <div data-status></div><button class="btn btn-primary btn-lg" type="submit">See my level</button></form>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const form = document.getElementById('test-form');
    form.addEventListener('change', () => {
      const n = new Set([...new FormData(form).keys()]).size;
      app.querySelector('[data-count]').textContent = `${n} of ${questions.length} answered`;
      app.querySelector('[data-bar]').style.width = (n / questions.length * 100) + '%';
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const answers = {};
      for (const [key, value] of new FormData(form)) answers[key.slice(1)] = Number(value);
      run(e.submitter, async () => {
        const res = await api.post(`/api/placement/${encodeURIComponent(person.language)}`,
          { full_name: person.full_name, email: person.email, phone: person.phone, answers });
        sessionStorage.setItem('placement_attempt', res.id);
        renderResult(person, res);
      });
    });
  }

  function renderResult(person, res) {
    const levels = Object.keys(res.breakdown);
    app.innerHTML = `<div class="eyebrow">Your result</div><h1>Well done, ${esc(person.full_name.split(' ')[0])}!</h1>
      <div class="result-level"><div class="text-sm">Recommended starting level</div><strong>${esc(res.recommended_level)}</strong><div>${res.score} of ${res.total} correct</div></div>
      ${barChart(levels.map(l => ({ label: l, value: res.breakdown[l].correct })), { format: v => v })}
      <p class="lead mt-md">A teacher may confirm your level with a short conversation on your first day.${person.email ? ' We have emailed you a copy of this result.' : ''}</p>
      <div class="flex gap-sm flex-wrap"><a class="btn btn-primary" href="/apply.html?course=${encodeURIComponent(person.language)}&level=${encodeURIComponent(res.recommended_level)}">Apply for ${esc(res.recommended_level)}</a>
      <a class="btn btn-outline" href="/#contact">Ask us a question</a></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
