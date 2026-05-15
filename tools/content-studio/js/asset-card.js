/**
 * Asset card renderer used by the Production queue + Approved section.
 *
 * Surface: window.CSAssetCard.render(upload, { onApprove, onReject, onLink, suggestion })
 *   returns an HTMLElement. The card auto-shows a thumbnail if upload.asset_url
 *   is present; otherwise renders a spinner + processing label.
 */
window.CSAssetCard = (function () {
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  function statusLabel(upload) {
    const s = upload.asset_status || upload.status || 'pending';
    if (s === 'raw' || s === 'pending')    return 'Queued';
    if (s === 'uploading')                  return 'Uploading';
    if (s === 'processing')                 return upload.type === 'video' ? 'Opus Clip — processing' : 'Canva — applying brand kit';
    if (s === 'ready')                      return 'Ready';
    if (s === 'approved')                   return 'Approved';
    if (s === 'failed')                     return 'Failed';
    return s;
  }

  function badgeClass(upload) {
    const s = upload.asset_status || upload.status || 'pending';
    if (s === 'uploading' || s === 'raw' || s === 'pending') return 'is-uploading';
    if (s === 'processing') return 'is-processing';
    if (s === 'ready')      return 'is-ready';
    if (s === 'approved')   return 'is-approved';
    if (s === 'failed')     return 'is-failed';
    return '';
  }

  function thumbHtml(upload) {
    if (!upload.asset_url) return '<div class="cs-spinner"></div>';
    if (upload.type === 'video') {
      return `<video src="${esc(upload.asset_url)}" muted playsinline preload="metadata"></video>`;
    }
    return `<img src="${esc(upload.asset_url)}" alt="${esc(upload.filename || 'asset')}" />`;
  }

  function render(upload, opts = {}) {
    const el = document.createElement('div');
    el.className = 'cs-prod-card';
    el.dataset.uploadId = upload.id;
    el.dataset.status   = upload.asset_status || upload.status || 'pending';

    const s = upload.asset_status || upload.status || 'pending';
    const ready    = upload.asset_url && s === 'ready';
    const approved = s === 'approved';
    const failed   = s === 'failed';

    el.innerHTML = `
      <div class="cs-prod-card-head">
        <span class="cs-prod-card-name">${esc(upload.filename || `upload-${upload.id}`)}</span>
        <span class="cs-prod-card-badge ${badgeClass(upload)}">${esc(statusLabel(upload))}</span>
      </div>
      <div class="cs-prod-card-meta">${esc(upload.type || 'asset')}${upload.linked_post_id ? ' · linked to post #' + esc(upload.linked_post_id) : ''}</div>
      <div class="cs-prod-card-thumb">${thumbHtml(upload)}</div>
      ${opts.progress !== undefined && !ready && !failed
        ? `<div class="cs-prod-card-progress"><span style="width:${esc(opts.progress)}%"></span></div>`
        : ''}
      ${failed && upload.processing_error ? `<div class="cs-prod-card-error">${esc(upload.processing_error)}</div>` : ''}
      ${opts.suggestion ? `
        <div class="cs-prod-suggest">
          <span>Link to: <b>${esc(opts.suggestion.label)}</b>?</span>
          <button class="cs-sc-btn" data-action="link-yes">Yes</button>
          <button class="cs-sc-btn is-secondary" data-action="link-no">No</button>
        </div>` : ''}
      ${ready || approved ? `
        <div class="cs-prod-card-actions">
          ${approved
            ? '<button disabled>Approved</button>'
            : '<button class="is-primary" data-action="approve" ' + (upload.linked_post_id ? '' : 'disabled title="link to a post first"') + '>Approve</button>'}
          ${approved ? '' : '<button class="is-danger" data-action="reject">Reject</button>'}
        </div>` : ''}
    `;

    if (opts.onApprove) el.querySelector('[data-action="approve"]')?.addEventListener('click', () => opts.onApprove(upload));
    if (opts.onReject)  el.querySelector('[data-action="reject"]')?.addEventListener('click',  () => opts.onReject(upload));
    if (opts.onLink) {
      el.querySelector('[data-action="link-yes"]')?.addEventListener('click', () => opts.onLink(upload, opts.suggestion, true));
      el.querySelector('[data-action="link-no"]')?.addEventListener('click',  () => opts.onLink(upload, opts.suggestion, false));
    }
    return el;
  }

  return { render };
})();
