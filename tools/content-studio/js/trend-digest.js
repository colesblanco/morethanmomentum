/**
 * INSIGHTS — Trend Digest panel renderer.
 *
 * Patches the existing window.CSViews.insights.mount hook (registered by
 * insights.js) so it ALSO fetches and renders the latest trend_digests
 * rows after the original mount has finished.
 *
 * This avoids editing insights.js while still wiring a new panel into the
 * same view lifecycle. Script load order in index.html must be:
 *   insights.js → trend-digest.js
 */
(function () {
  if (!window.CSViews || !window.CSViews.insights) return;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('en-US');
  }

  async function fetchLatestDigests() {
    try {
      const res = await fetch('/api/content-studio/trend-scout');
      return await res.json();
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  function digestRow(label, meta, pillar) {
    return `
      <div class="cs-sc-digest-row">
        <span class="cs-sc-digest-label">${esc(label)}</span>
        ${pillar ? `<span class="cs-sc-pillar-tag ${esc(pillar)}">${esc(pillar.replace('pillar_', 'P'))}</span>` : ''}
        <span class="cs-sc-digest-meta">${esc(meta || '')}</span>
      </div>`;
  }

  function renderTikTokCol(payload) {
    const sounds = (payload?.trending_sounds || []).slice(0, 5);
    const tags   = (payload?.trending_hashtags || []).slice(0, 5);
    const signals = (payload?.format_signals || []).slice(0, 3);

    if (!sounds.length && !tags.length) {
      return `
        <div class="cs-sc-digest-col">
          <h3 class="cs-sc-digest-head">TikTok Trending</h3>
          <div class="cs-empty-state" style="padding: 16px 0;">No trend signals yet.</div>
        </div>`;
    }

    return `
      <div class="cs-sc-digest-col">
        <h3 class="cs-sc-digest-head">TikTok Trending</h3>
        ${sounds.map(s => digestRow(s.title, s.plays != null ? `${fmtInt(s.plays)} plays` : '')).join('')}
        ${tags.map(t => digestRow('#' + t.tag, t.views != null ? `${fmtInt(t.views)} views` : '')).join('')}
        ${signals.length ? `<div class="cs-sc-digest-foot"><span>Format signals: ${signals.map(x => esc(x.pattern)).join(', ')}</span></div>` : ''}
      </div>`;
  }

  function renderGoogleCol(payload) {
    const topics = (payload?.pillar_mapping || payload?.trending_topics || []).slice(0, 5);
    if (!topics.length) {
      return `
        <div class="cs-sc-digest-col">
          <h3 class="cs-sc-digest-head">Google Trends</h3>
          <div class="cs-empty-state" style="padding: 16px 0;">No rising queries yet.</div>
        </div>`;
    }
    return `
      <div class="cs-sc-digest-col">
        <h3 class="cs-sc-digest-head">Google Trends — Rising</h3>
        ${topics.map(t => digestRow(t.title, t.traffic || '', t.pillar)).join('')}
      </div>`;
  }

  function renderDigestPanel(container, status) {
    const latest = status?.latest_run;
    if (!latest) {
      container.innerHTML = `
        <div class="cs-empty-state">
          <p>Scout runs every Friday at 4:30pm ET.<br/>
          Or go to <a href="#settings" style="color: var(--cs-electric);">Settings → Run Scout Now</a> to generate your first trend digest.</p>
        </div>`;
      return;
    }

    // The status endpoint attaches the latest digest payload per source.
    const digestsByCol = {
      tiktok_creative_center: status.digests?.tiktok_creative_center?.payload || null,
      google_trends:          status.digests?.google_trends?.payload          || null,
    };

    container.innerHTML = `
      <div class="cs-sc-digest-grid">
        ${renderTikTokCol(digestsByCol.tiktok_creative_center)}
        ${renderGoogleCol(digestsByCol.google_trends)}
      </div>
      <div class="cs-sc-digest-foot" style="margin-top: 16px;">
        <span>Last run: ${esc(latest.run_at || 'unknown')}</span>
        <span>Format Library updated: +${fmtInt(latest.new_formats_added || 0)} entries from this week's scout</span>
      </div>
    `;
  }

  // Patch the insights mount hook so trend digest renders after the original
  // three panels have populated.
  const originalMount = window.CSViews.insights.mount;
  window.CSViews.insights.mount = async function (root) {
    await originalMount(root);
    const panel = root.querySelector('#cs-panel-trend-digest');
    if (!panel) return;
    panel.innerHTML = `<div class="cs-loading"><div class="cs-spinner"></div><p>Loading trend digest…</p></div>`;

    // Two requests: scout status (gives last run summary) and the digest data
    // is embedded in the status response under the keys our scout writes.
    const status = await fetchLatestDigests();

    renderDigestPanel(panel, status);
  };
})();
