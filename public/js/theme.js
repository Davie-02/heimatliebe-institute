/* Apply the saved light/dark theme before the page paints (loaded synchronously in <head>). */
(function () {
  var theme = 'light';
  try { theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* ignore */ }
  document.documentElement.setAttribute('data-theme', theme);
})();
