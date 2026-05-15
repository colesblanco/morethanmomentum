/**
 * INSIGHTS view — wires three live panels:
 *   1. GHL Pipeline & Lead Source  (via /api/content-studio/analytics-snapshot)
 *   2. Social Performance           (via /api/content-studio/social-summary)
 *   3. Format Library Preview       (via /api/content-studio/format-library)
 *
 * All three fetch in parallel on mount. Each panel renders independently —
 * a failure in one does not block the others.
 */
(function () {
  window.CSViews = window.CSViews || {};

  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function fmtMoney(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ── Panel 1: GHL Pipeline ────────────────────────────────────────── */
  function renderPipeline(panel, data) {
    if (!data || data.status === 'error') {
      panel.innerHTML = `<div class="cs-error">Couldn't reach MTM MCP Analytics Server. ${esc(data?.message || '')}</div>`;
      return;
    }
    if (data.status === 'not_configured') {
      panel.innerHTML = `<div class="cs-error">${esc(data.message || 'MTM_GHL_SECRET not configured.')}</div>`;
      return;
    }
    const p = data.pipeline || {};
    const sources = (data.leadSources || []).slice(0, 6);

    panel.innerHTML = `
      <div class="cs-grid cs-grid-stats">
        <div class="cs-stat"><span class="cs-stat-label">New Leads</span><span class="cs-stat-value">${fmtInt(p.totalLeads)}</span><span class="cs-stat-meta">${esc(data.period?.label || '')}</span></div>
        <div class="cs-stat"><span class="cs-stat-label">Won Deals</span><span class="cs-stat-value">${fmtInt(p.wonDeals)}</span><span class="cs-stat-meta">${fmtMoney(p.wonRevenue)} revenue</span></div>
        <div class="cs-stat"><span class="cs-stat-label">Open Pipeline</span><span class="cs-stat-value">${fmtMoney(p.openPipelineValue)}</span><span class="cs-stat-meta">${fmtInt(p.openDeals)} deals</span></div>
        <div class="cs-stat"><span class="cs-stat-label">Top Source</span><span class="cs-stat-value" style="font-size:20px;">${esc(data.topSource && data.topSource !== '—' ? data.topSource : 'No leads yet')}</span><span class="cs-stat-meta">this month</span></div>
      </div>
      ${sources.length ? `
        <div style="margin-top:20px;">
          <div class="cs-panel-sub" style="margin-bottom:8px;">Lead source breakdown</div>
          ${sources.map(s => `
            <div class="cs-platform-row">
              <span class="cs-platform-row-label">${esc(s.source || s.name || 'Unknown')}</span>
              <span class="cs-platform-row-value">${fmtInt(s.count ?? s.leads ?? 0)}</span>
            </div>`).join('')}
        </div>` : ''}
    `;
  }

  /* ── Panel 2: Social Performance ──────────────────────────────────── */
  function renderPlatform(p) {
    if (!p) return '';
    if (p.status === 'scaffolded') {
      return `
        <div class="cs-platform">
          <div class="cs-platform-head">
            <span class="cs-platform-name">${esc(p.platform)}</span>
            <span class="cs-platform-status is-scaffolded">Coming Phase 1.5</span>
          </div>
          <div class="cs-platform-row"><span class="cs-platform-row-label">${esc(p.message || 'Integration scaffolded.')}</span></div>
        </div>`;
    }
    if (p.status === 'not_configured') {
      return `
        <div class="cs-platform">
          <div class="cs-platform-head">
            <span class="cs-platform-name">${esc(p.platform)}</span>
            <span class="cs-platform-status is-error">Not configured</span>
          </div>
          <div class="cs-platform-row"><span class="cs-platform-row-label">${esc(p.message || 'Missing env vars.')}</span></div>
        </div>`;
    }
    if (p.status === 'error') {
      return `
        <div class="cs-platform">
          <div class="cs-platform-head">
            <span class="cs-platform-name">${esc(p.platform)}</span>
            <span class="cs-platform-status is-error">Error</span>
          </div>
          <div class="cs-platform-row"><span class="cs-platform-row-label">${esc(p.message || 'Could not load.')}</span></div>
        </div>`;
    }
    const rows = [
      ['Followers',   fmtInt(p.followers)],
      ['Reach',       fmtInt(p.reach)],
      ['Impressions', fmtInt(p.impressions)],
      ['Engagement',  fmtInt(p.engagement)],
    ];
    if (p.followerDelta !== null && p.followerDelta !== undefined) {
      rows.push([`Δ Followers (${p.windowDays}d)`, fmtInt(p.followerDelta)]);
    }
    return `
      <div class="cs-platform">
        <div class="cs-platform-head">
          <span class="cs-platform-name">${esc(p.platform)}</span>
          <span class="cs-platform-status">Live</span>
        </div>
        ${rows.map(([l, v]) => `<div class="cs-platform-row"><span class="cs-platform-row-label">${esc(l)}</span><span class="cs-platform-row-value">${v}</span></div>`).join('')}
      </div>`;
  }

  function renderSocial(panel, data) {
    if (!data || data.status === 'error') {
      panel.innerHTML = `<div class="cs-error">Couldn't reach social analytics — check MTM_SHARED_SECRET / SOCIAL_ANALYTICS_WORKER_URL in Cloudflare env vars. ${esc(data?.message || '')}</div>`;
      return;
    }
    if (data.status === 'not_configured') {
      panel.innerHTML = `<div class="cs-error">${esc(data.message)}</div>`;
      return;
    }
    const order = ['instagram', 'facebook', 'linkedin', 'tiktok'];
    panel.innerHTML = `
      <div class="cs-grid-platforms">
        ${order.map(name => renderPlatform(data.platforms[name])).join('')}
      </div>`;
  }

  /* ── Panel 3: Format Library ──────────────────────────────────────── */
  function renderFormats(panel, data) {
    if (!data || data.status === 'error') {
      panel.innerHTML = `<div class="cs-error">Couldn't reach the format library — check CONTENT_STUDIO_DB binding. ${esc(data?.message || '')}</div>`;
      return;
    }
    if (data.status === 'not_configured') {
      panel.innerHTML = `<div class="cs-error">${esc(data.message)}</div>`;
      return;
    }
    const formats = data.formats || [];
    if (!formats.length) {
      panel.innerHTML = `<div class="cs-empty-state"><p>No formats yet. Run db/content-studio/002_seed_format_library.sql.</p></div>`;
      return;
    }
    panel.innerHTML = `
      <div class="cs-grid cs-grid-formats">
        ${formats.map(f => `
          <div class="cs-card cs-format">
            <div class="cs-format-hook">${esc(f.hook_type)}</div>
            <div class="cs-format-summary">${esc(f.structure_summary || '')}</div>
            <div class="cs-format-why">${esc(f.why_it_works || '')}</div>
            <div class="cs-format-foot">
              <span>${esc(f.source_account || '—')}</span>
              <span>used ${fmtInt(f.times_used || 0)}×</span>
            </div>
          </div>`).join('')}
      </div>`;
  }

  /* ── Mount hook ───────────────────────────────────────────────────── */
  window.CSViews['insights'] = {
    async mount(root) {
      const pPipeline = root.querySelector('#cs-panel-pipeline');
      const pSocial   = root.querySelector('#cs-panel-social');
      const pFormats  = root.querySelector('#cs-panel-formats');

      const [ghl, social, formats] = await Promise.all([
        window.CSApi.analyticsSnapshot(),
        window.CSApi.socialSummary(7),
        window.CSApi.formatLibrary(),
      ]);

      if (pPipeline) renderPipeline(pPipeline, ghl);
      if (pSocial)   renderSocial(pSocial,    social);
      if (pFormats)  renderFormats(pFormats,  formats);
    },
  };
})();
