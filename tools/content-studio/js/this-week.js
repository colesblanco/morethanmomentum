/**
 * THIS WEEK view controller.
 *
 * Responsibilities:
 *   - resolve which week is being viewed (defaults to the ISO Monday of today)
 *   - load /api/content-studio/weekly-plan?week_start=…
 *   - render the strategy summary + filming briefs + 7-column grid
 *   - hand each post card to CSPostCard.render
 *   - on edit, PATCH /api/content-studio/post-update and re-render
 *   - drive the Generate / Approve All buttons
 *
 * Why everything lives here (not split into multiple files): keeps the diff
 * small and avoids touching app.js. CSPostCard handles the side panel; this
 * file owns the view-level state machine.
 */
(function () {
  window.CSViews = window.CSViews || {};

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  let state = {
    weekStart: isoMonday(new Date()),
    plan: null,
    posts: [],
    busy: false,
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  function isoMonday(d) {
    const dt  = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = dt.getUTCDay() || 7;
    if (day !== 1) dt.setUTCDate(dt.getUTCDate() - day + 1);
    return dt.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtWeekLabel(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  }
  function fmtShortDate(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /* ─── API ──────────────────────────────────────────────────────────── */
  async function loadPlan(weekStart) {
    const res = await fetch(`/api/content-studio/weekly-plan?week_start=${weekStart}`);
    if (!res.ok) return { plan: null, posts: [] };
    return res.json();
  }
  async function generatePlan(weekStart) {
    const res = await fetch('/api/content-studio/weekly-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, week_start: weekStart }),
    });
    return res.json();
  }
  async function patchPost(payload) {
    const res = await fetch('/api/content-studio/post-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  /* ─── Rendering ────────────────────────────────────────────────────── */
  function showCascadeBanner(targetDays, lockedDays) {
    const el = document.getElementById('cs-tw-cascade-banner');
    if (!el) return;
    el.hidden = false;
    el.className = 'cs-tw-cascade-banner';
    el.innerHTML = `
      <div class="cs-spinner"></div>
      <div>Regenerating <b>${targetDays.length}</b> downstream post${targetDays.length === 1 ? '' : 's'} based on your edit.${lockedDays.length ? ` Untouched: ${lockedDays.map(esc).join(', ')}.` : ''}</div>
    `;
  }
  function hideCascadeBanner() {
    const el = document.getElementById('cs-tw-cascade-banner');
    if (el) el.hidden = true;
  }

  function renderHeader() {
    const lbl = document.getElementById('cs-tw-week-label');
    if (lbl) lbl.textContent = fmtWeekLabel(state.weekStart);
  }

  function renderStrategy() {
    const wrap = document.getElementById('cs-tw-strategy');
    if (!wrap) return;
    const txt = state.plan?.strategy_summary;
    if (!txt) { wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.querySelector('.cs-tw-summary-body').textContent = txt;
  }

  function renderBrief(elId, brief, label) {
    const wrap = document.getElementById(elId);
    if (!wrap) return;
    if (!brief?.required) { wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.innerHTML = `
      <div class="cs-tw-brief-head">
        <span>${esc(label)} Filming Brief</span>
        <span class="cs-tw-brief-tag">FILMING</span>
      </div>
      <div class="cs-tw-brief-body">
        ${(brief.shots || []).length
          ? `<ul class="cs-tw-shot-list">${brief.shots.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
          : '<i>No shots listed.</i>'}
      </div>`;
  }

  function renderBody() {
    const body = document.getElementById('cs-tw-body');
    if (!body) return;

    if (!state.plan) {
      body.innerHTML = `
        <div class="cs-empty-state" style="border:1px dashed var(--cs-border); border-radius:var(--cs-radius); padding:40px 24px;">
          <p style="margin:0 0 14px;">No plan generated yet. The Strategist runs automatically every Sunday at 4&nbsp;pm ET.</p>
          <button class="cs-tw-action" id="cs-tw-generate-empty">Generate this week now</button>
        </div>`;
      const btn = document.getElementById('cs-tw-generate-empty');
      if (btn) btn.addEventListener('click', handleGenerate);
      return;
    }

    const byDay = {};
    for (const d of DAYS) byDay[d] = [];
    for (const p of state.posts) {
      const k = String(p.day_of_week || '').toLowerCase();
      (byDay[k] || (byDay[k] = [])).push(p);
    }

    const grid = document.createElement('div');
    grid.className = 'cs-tw-grid';

    DAYS.forEach((day, i) => {
      const col = document.createElement('div');
      col.className = 'cs-tw-col';
      const dateIso = addDays(state.weekStart, i);
      col.innerHTML = `
        <div class="cs-tw-col-head">
          <span class="cs-tw-col-day">${day.slice(0, 3).toUpperCase()}</span>
          <span class="cs-tw-col-date">${esc(fmtShortDate(dateIso))}</span>
        </div>`;
      const items = byDay[day] || [];
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'cs-tw-col-empty';
        empty.textContent = 'No post';
        col.appendChild(empty);
      } else {
        for (const p of items) {
          const card = window.CSPostCard.render(p);
          card.addEventListener('click', () => openEditor(p.id));
          col.appendChild(card);
        }
      }
      grid.appendChild(col);
    });

    body.innerHTML = '';
    body.appendChild(grid);
  }

  function renderAll() {
    renderHeader();
    renderStrategy();
    renderBrief('cs-tw-monday-brief',    state.plan?.monday_brief,    'Monday');
    renderBrief('cs-tw-wednesday-brief', state.plan?.wednesday_brief, 'Wednesday');
    renderBody();
  }

  /* ─── Handlers ─────────────────────────────────────────────────────── */
  async function refresh() {
    const data = await loadPlan(state.weekStart);
    state.plan  = data.plan  || null;
    state.posts = data.posts || [];
    renderAll();
  }

  async function handleGenerate() {
    if (state.busy) return;
    state.busy = true;
    setActionBusy(true, 'Generating…');
    try {
      await generatePlan(state.weekStart);
      await refresh();
    } finally {
      state.busy = false;
      setActionBusy(false);
    }
  }

  function setActionBusy(busy, label) {
    document.querySelectorAll('#cs-tw-generate, #cs-tw-generate-empty').forEach(b => {
      if (!b) return;
      b.disabled = busy;
      if (busy && label) b.dataset.prevLabel = b.dataset.prevLabel || b.textContent, b.textContent = label;
      if (!busy && b.dataset.prevLabel) { b.textContent = b.dataset.prevLabel; delete b.dataset.prevLabel; }
    });
  }

  function openEditor(postId) {
    const post = state.posts.find(p => p.id === postId);
    if (!post) return;

    const onSave = async (payload) => {
      const dayIdx = window.CSPostCard.DAY_INDEX[String(post.day_of_week).toLowerCase()] || 0;

      // For a normal content edit with cascade=true we expect downstream green days.
      // For regen_self we expect exactly this post's day.
      const targetDays = payload.regenSelf
        ? [String(post.day_of_week).toLowerCase()]
        : (payload.cascade
            ? state.posts
                .filter(p => (window.CSPostCard.DAY_INDEX[String(p.day_of_week).toLowerCase()] || 0) > dayIdx)
                .filter(p => p.edit_state === 'green')
                .map(p => String(p.day_of_week).toLowerCase())
            : []);
      const lockedDays = state.posts
        .filter(p => p.edit_state !== 'green' || (payload.regenSelf && p.id !== postId))
        .map(p => `${String(p.day_of_week).slice(0,3).toUpperCase()} (${p.edit_state})`);

      if (targetDays.length && (payload.cascade || payload.regenSelf)) {
        showCascadeBanner(targetDays, lockedDays);
      }

      const result = await patchPost({
        post_id:    payload.post_id,
        field:      payload.field,
        value:      payload.value,
        cascade:    !!payload.cascade,
        regen_self: !!payload.regenSelf,
      });

      if (result.status === 'ok') {
        state.plan  = result.plan  || state.plan;
        state.posts = result.posts || state.posts;
        renderAll();
        const fresh = state.posts.find(p => p.id === postId);
        if (fresh) window.CSPostCard.openSide(fresh, onSave);
      }
      hideCascadeBanner();
    };

    window.CSPostCard.openSide(post, onSave);
  }

  function handleWeekNav(dir) {
    if (dir === 'today') state.weekStart = isoMonday(new Date());
    else if (dir === 'prev') state.weekStart = addDays(state.weekStart, -7);
    else if (dir === 'next') state.weekStart = addDays(state.weekStart, +7);
    window.CSPostCard.closeSide();
    refresh();
  }

  async function handleApproveAll() {
    if (state.busy || !state.posts.length) return;
    state.busy = true;
    try {
      for (const p of state.posts) {
        if (p.edit_state === 'locked') continue;
        await patchPost({ post_id: p.id, field: 'edit_state', value: 'locked', cascade: false });
      }
      await refresh();
    } finally {
      state.busy = false;
    }
  }

  /* ─── Mount hook ───────────────────────────────────────────────────── */
  window.CSViews['this-week'] = {
    async mount(root) {
      root.querySelectorAll('[data-tw-week]').forEach(btn => {
        btn.addEventListener('click', () => handleWeekNav(btn.dataset.twWeek));
      });
      const genBtn = document.getElementById('cs-tw-generate');
      if (genBtn) genBtn.addEventListener('click', handleGenerate);
      const apprBtn = document.getElementById('cs-tw-approve-all');
      if (apprBtn) apprBtn.addEventListener('click', handleApproveAll);

      const summaryHead = root.querySelector('[data-tw-toggle="strategy"]');
      if (summaryHead) summaryHead.addEventListener('click', () => {
        const body = root.querySelector('#cs-tw-strategy .cs-tw-summary-body');
        if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
      });

      await refresh();
    },
  };
})();
