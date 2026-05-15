/**
 * Content Studio — workspace router.
 *
 * Hash-based router. Each #view loads ./views/<view>.html into <main id="cs-main">.
 * After load, calls the optional view hook on window.CSViews[view].mount() if present.
 *
 * Why hash routing (not History API): keeps deploy-time path config minimal and
 * survives the Pages-Functions fallthrough rules without any rewrites.
 */
(function () {
  const VIEWS = ['this-week', 'production', 'calendar', 'insights', 'settings'];
  const DEFAULT_VIEW = 'insights';

  const main = document.getElementById('cs-main');
  const nav  = document.getElementById('cs-nav');

  function setActiveNav(view) {
    nav.querySelectorAll('.cs-nav-item').forEach(el => {
      el.classList.toggle('is-active', el.dataset.view === view);
    });
  }

  function viewFromHash() {
    const h = (location.hash || '').replace(/^#/, '').trim();
    return VIEWS.includes(h) ? h : DEFAULT_VIEW;
  }

  async function loadView(view) {
    setActiveNav(view);
    main.innerHTML = '<div class="cs-empty-state"><div class="cs-spinner" aria-hidden="true"></div><p>Loading…</p></div>';

    try {
      const res = await fetch(`./views/${view}.html`, { headers: { 'Accept': 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      main.innerHTML = html;
    } catch (err) {
      main.innerHTML = `<div class="cs-error">Could not load view "${view}": ${err.message}</div>`;
      return;
    }

    const hook = window.CSViews && window.CSViews[view];
    if (hook && typeof hook.mount === 'function') {
      try { await hook.mount(main); }
      catch (err) {
        const errBox = document.createElement('div');
        errBox.className = 'cs-error';
        errBox.textContent = `View "${view}" failed to initialise: ${err.message}`;
        main.appendChild(errBox);
      }
    }
  }

  window.CSViews = window.CSViews || {};

  window.addEventListener('hashchange', () => loadView(viewFromHash()));

  document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) location.hash = `#${DEFAULT_VIEW}`;
    loadView(viewFromHash());
  });
})();
