/**
 * Settings view controller — Format Capture form + Scout config + Run Now.
 *
 * Registers window.CSViews['settings'] mount hook. Wires:
 *   #cs-sc-capture-form  → POST /api/content-studio/format-capture
 *   #cs-sc-run-now       → POST /api/content-studio/trend-scout
 *   #cs-sc-status        → GET  /api/content-studio/trend-scout (status panel)
 */
(function () {
  window.CSViews = window.CSViews || {};

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function fmtRunAt(iso) {
    if (!iso) return 'Never';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function postCapture(payload) {
    const res = await fetch('/api/content-studio/format-capture', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    return res.json();
  }
  async function postScoutRun() {
    const res = await fetch('/api/content-studio/trend-scout', { method: 'POST' });
    return res.json();
  }
  async function getScoutStatus() {
    const res = await fetch('/api/content-studio/trend-scout');
    return res.json();
  }

  function renderResultCard(entry) {
    if (!entry) return '';
    const adaptations = Array.isArray(entry.mtm_adaptations) ? entry.mtm_adaptations : [];
    return `
      <div class="cs-sc-result">
        <div class="cs-format-hook" style="color: var(--cs-yellow); font-family: var(--cs-font-head); font-weight:700; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px;">${esc(entry.hook_type || 'unknown')}</div>
        <div style="font-size: 13px; margin-bottom: 6px;">${esc(entry.structure_summary || '')}</div>
        <div style="font-size: 12px; color: var(--cs-text-muted); font-style: italic; margin-bottom: 6px;">${esc(entry.why_it_works || '')}</div>
        ${adaptations.length ? `<ul style="margin: 8px 0 0 18px; padding: 0; font-size: 12px; color: var(--cs-text);">${adaptations.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        <div class="cs-sc-result-foot">
          <span>confidence: ${esc(entry.confidence || 'unknown')}</span>
          <a href="#insights">View in Format Library →</a>
        </div>
      </div>
    `;
  }

  function renderStatusBlock(status) {
    const latest = status?.latest_run;
    const sourcesChecked = latest?.sources_checked || [];
    const igLive = sourcesChecked.includes('instagram_scout');

    return `
      <div class="cs-sc-config-row">
        <span class="cs-sc-config-label">Scout status</span>
        <span class="cs-sc-config-value">Active — runs every Friday at 4:30pm ET</span>
      </div>
      <div class="cs-sc-config-row">
        <span class="cs-sc-config-label">Last run</span>
        <span class="cs-sc-config-value">${esc(fmtRunAt(latest?.run_at))}</span>
      </div>
      <div class="cs-sc-config-row">
        <span class="cs-sc-config-label">Sources active</span>
        <span class="cs-sc-config-value">
          TikTok <span class="cs-sc-source-pill is-live">live</span>
          Google <span class="cs-sc-source-pill is-live">live</span>
          Instagram <span class="cs-sc-source-pill ${igLive ? 'is-live' : 'is-pending'}">${igLive ? 'live' : 'Phase 3b'}</span>
        </span>
      </div>
      <div class="cs-sc-config-row">
        <span class="cs-sc-config-label">Formats added this month</span>
        <span class="cs-sc-config-value">${fmtInt(status?.formats_added_this_month)}</span>
      </div>
      <div class="cs-sc-config-row">
        <span class="cs-sc-config-label">Latest run</span>
        <span class="cs-sc-config-value">+${fmtInt(latest?.new_formats_added || 0)} formats · ${fmtInt(latest?.trends_captured || 0)} trends · ${latest?.duration_ms ?? '—'} ms</span>
      </div>
    `;
  }

  async function refreshStatusPanel(root) {
    const target = root.querySelector('#cs-sc-status');
    if (!target) return;
    try {
      const status = await getScoutStatus();
      target.innerHTML = renderStatusBlock(status);
    } catch (err) {
      target.innerHTML = `<div class="cs-error">Couldn't load scout status: ${esc(err.message)}</div>`;
    }
  }

  async function handleCapture(root, ev) {
    if (ev) ev.preventDefault();
    const urlEl   = root.querySelector('#cs-sc-url');
    const descEl  = root.querySelector('#cs-sc-description');
    const srcEl   = root.querySelector('#cs-sc-account');
    const btn     = root.querySelector('#cs-sc-capture-btn');
    const resBox  = root.querySelector('#cs-sc-capture-result');
    if (!urlEl || !descEl || !srcEl || !resBox) return;

    const payload = {
      url:            urlEl.value.trim(),
      description:    descEl.value.trim(),
      source_account: srcEl.value.trim(),
    };
    if (!payload.url && !payload.description) {
      resBox.innerHTML = `<div class="cs-error">Provide either a URL or a description.</div>`;
      return;
    }

    if (btn) btn.disabled = true;
    resBox.innerHTML = `<div class="cs-loading"><div class="cs-spinner"></div><p>Claude is decomposing this format…</p></div>`;

    try {
      const result = await postCapture(payload);
      if (result.success && result.entry) {
        resBox.innerHTML = renderResultCard(result.entry);
        descEl.value = ''; urlEl.value = ''; srcEl.value = '';
      } else {
        resBox.innerHTML = `<div class="cs-error">${esc(result.message || result.error || 'Decompose failed.')}</div>`;
      }
    } catch (err) {
      resBox.innerHTML = `<div class="cs-error">Network error: ${esc(err.message)}</div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function handleScoutRun(root) {
    const btn  = root.querySelector('#cs-sc-run-now');
    const out  = root.querySelector('#cs-sc-run-result');
    if (!out) return;
    if (btn) btn.disabled = true;
    out.innerHTML = `<div class="cs-loading"><div class="cs-spinner"></div><p>Running scout — this can take 30-60 seconds…</p></div>`;
    try {
      const result = await postScoutRun();
      if (result.success) {
        out.innerHTML = `
          <div class="cs-sc-result">
            <div><b>${fmtInt(result.new_formats_added)}</b> new formats · <b>${fmtInt(result.trends_captured)}</b> trends captured · ${result.duration_ms} ms</div>
            <div class="cs-sc-result-foot">
              <span>tiktok: ${esc(result.tiktok_status)} · google: ${esc(result.google_status)} · instagram: ${esc(result.instagram_status)}</span>
              <a href="#insights">See trend digest →</a>
            </div>
          </div>`;
        await refreshStatusPanel(root);
      } else {
        out.innerHTML = `<div class="cs-error">${esc(result.message || result.error || 'Scout failed.')}</div>`;
      }
    } catch (err) {
      out.innerHTML = `<div class="cs-error">Network error: ${esc(err.message)}</div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.CSViews['settings'] = {
    async mount(root) {
      const form   = root.querySelector('#cs-sc-capture-form');
      const runBtn = root.querySelector('#cs-sc-run-now');
      if (form)   form.addEventListener('submit', (e) => handleCapture(root, e));
      if (runBtn) runBtn.addEventListener('click',  () => handleScoutRun(root));
      await refreshStatusPanel(root);
    },
  };
})();
