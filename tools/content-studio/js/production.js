/**
 * PRODUCTION view controller.
 *
 *  - Wires the upload zone (CSUploadZone) → posts files to /api/content-studio/upload
 *  - On each upload completion, fires /api/content-studio/process-asset to
 *    kick off the Producer worker, then polls /process-asset?upload_id=...
 *    until the upload row reports asset_status='ready' or 'failed'.
 *  - Renders three sections: in-flight queue, generate-graphic panel,
 *    approved assets.
 *  - Auto-suggests linking new uploads to unmatched needs_filming posts in
 *    the current week's plan.
 */
(function () {
  window.CSViews = window.CSViews || {};

  const POLL_INTERVAL_MS = 5000;
  const inflight = new Map();   // upload_id → { upload, suggestionPostId? }
  let weekPosts = [];           // posts from /weekly-plan GET (used for suggestions + gen panel)

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  async function jsonGet(url)  { const r = await fetch(url); return r.json(); }
  async function jsonPost(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  }

  /* ── Load week posts (used for auto-link suggestions + generate panel) ── */
  async function loadWeekPosts() {
    const data = await jsonGet('/api/content-studio/weekly-plan');
    weekPosts = data?.posts || [];
  }

  function findSuggestion(uploadType) {
    // First needs_filming post with pending asset_status, of matching content_type.
    return weekPosts.find(p =>
      (p.asset_status === 'pending' || !p.asset_status) &&
      (uploadType === 'video' ? p.needs_filming === true : true)
    );
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  function postLabel(p) {
    const day = (p.day_of_week || '').slice(0, 3).toUpperCase();
    const platform = (p.platform || '').toUpperCase();
    const hook = (p.hook || '').slice(0, 50);
    return `${day} ${platform} — “${hook}${hook.length === 50 ? '…' : ''}”`;
  }

  function renderQueue(root) {
    const container = root.querySelector('#cs-prod-queue');
    if (!container) return;
    const items = [...inflight.values()];
    if (!items.length) {
      container.innerHTML = '<div class="cs-prod-empty">Nothing in flight. Drop a file above or generate a graphic below.</div>';
    } else {
      container.innerHTML = '';
      for (const entry of items) {
        const card = window.CSAssetCard.render(entry.upload, {
          progress:    entry.progress,
          suggestion:  entry.suggestion,
          onApprove:   (u) => approveAsset(root, u),
          onReject:    (u) => rejectAsset(root, u),
          onLink:      (u, sug, yes) => handleLink(root, u, sug, yes),
        });
        container.appendChild(card);
      }
    }

    const meta = root.querySelector('#cs-prod-queue-meta');
    if (meta) {
      const active = items.filter(i => (i.upload.asset_status || i.upload.status) !== 'ready' &&
                                       (i.upload.asset_status || i.upload.status) !== 'approved' &&
                                       (i.upload.asset_status || i.upload.status) !== 'failed').length;
      meta.textContent = items.length ? `${active} in flight · ${items.length - active} ready` : '—';
    }
  }

  async function renderApproved(root) {
    const container = root.querySelector('#cs-prod-approved');
    if (!container) return;
    container.innerHTML = '<div class="cs-loading"><div class="cs-spinner"></div><p>Loading approved assets…</p></div>';
    const data = await jsonGet('/api/content-studio/uploads?status=approved').catch(() => null);
    // The /uploads listing endpoint doesn't exist yet -- fall back to listing
    // posts whose asset_status is 'approved' and rendering their assets here.
    const posts = (weekPosts || []).filter(p => p.asset_status === 'approved');
    if (!posts.length) {
      container.innerHTML = '<div class="cs-prod-empty">No approved assets yet.</div>';
      return;
    }
    container.innerHTML = '';
    for (const p of posts) {
      const fake = {
        id:            p.id,
        filename:      postLabel(p),
        type:          p.content_type === 'reel' ? 'video' : 'photo',
        asset_status:  'approved',
        status:        'processed',
        asset_url:     null,   // we'd hydrate from a real uploads-by-post endpoint
        linked_post_id: p.id,
      };
      container.appendChild(window.CSAssetCard.render(fake, {}));
    }
  }

  function renderGenerate(root) {
    const container = root.querySelector('#cs-prod-generate');
    if (!container) return;

    const candidates = (weekPosts || []).filter(p =>
      (p.content_type === 'single_image' || p.content_type === 'carousel') &&
      (p.asset_status === 'pending' || !p.asset_status)
    );

    if (!candidates.length) {
      container.innerHTML = '<div class="cs-prod-empty">No posts need a graphic right now.</div>';
      return;
    }

    container.innerHTML = candidates.map(p => `
      <div class="cs-prod-gen-row" data-post-id="${esc(p.id)}">
        <div class="cs-prod-gen-row-info">
          <b>${esc(postLabel(p))}</b>
          <div class="cs-prod-gen-row-meta">${esc(p.content_type)} · pillar ${esc(p.pillar_id || '?')}</div>
        </div>
        <button class="cs-sc-btn is-secondary" data-action="generate-graphic" data-post-id="${esc(p.id)}">
          ${p.content_type === 'carousel' ? 'Generate carousel' : 'Generate with Canva'}
        </button>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="generate-graphic"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const postId = parseInt(btn.dataset.postId, 10);
        const post = weekPosts.find(p => p.id === postId);
        if (!post) return;
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Submitting…';
        try {
          const body = post.content_type === 'carousel'
            ? { generate: 'carousel', post_id: postId, slides: [post.hook, post.caption?.slice(0, 160) || '', 'CTA'], hook: post.hook }
            : { generate: 'graphic',  post_id: postId };
          const result = await jsonPost('/api/content-studio/process-asset', body);
          if (result?.upload_id) {
            const upload = {
              id:             result.upload_id,
              filename:       `generated-${post.content_type}-${postId}`,
              type:           post.content_type === 'carousel' ? 'screen' : 'photo',
              status:         'processing',
              asset_status:   'processing',
              linked_post_id: postId,
            };
            inflight.set(upload.id, { upload, suggestion: null });
            renderQueue(document);
            pollUpload(upload.id);
          } else {
            btn.disabled = false; btn.textContent = prev;
            alert(result?.error || result?.message || 'generate failed');
          }
        } catch (err) {
          btn.disabled = false; btn.textContent = prev;
          alert(err.message);
        }
      });
    });
  }

  /* ── Polling loop ──────────────────────────────────────────────────────── */
  async function pollUpload(uploadId) {
    const entry = inflight.get(uploadId);
    if (!entry) return;

    try {
      const data = await jsonGet(`/api/content-studio/process-asset?upload_id=${uploadId}`);
      const upload = data?.upload || entry.upload;
      entry.upload = upload;
      renderQueue(document);

      const status = upload.asset_status || upload.status;
      if (status === 'ready' || status === 'failed' || status === 'approved') {
        return;   // stop polling
      }
    } catch {
      // tolerate transient failures and keep polling
    }
    setTimeout(() => pollUpload(uploadId), POLL_INTERVAL_MS);
  }

  /* ── Actions ───────────────────────────────────────────────────────────── */
  async function approveAsset(root, upload) {
    if (!upload.linked_post_id) {
      alert('Link the upload to a post first.');
      return;
    }
    const result = await jsonPost('/api/content-studio/approve-asset', {
      upload_id: upload.id,
      post_id:   upload.linked_post_id,
    });
    if (result?.status === 'ok') {
      upload.asset_status = 'approved';
      renderQueue(root);
      await loadWeekPosts();
      renderApproved(root);
      renderGenerate(root);
    } else {
      alert(result?.message || 'approve failed');
    }
  }

  async function rejectAsset(root, upload) {
    inflight.delete(upload.id);
    renderQueue(root);
  }

  async function handleLink(root, upload, suggestion, yes) {
    if (!yes) {
      const entry = inflight.get(upload.id);
      if (entry) { delete entry.suggestion; renderQueue(root); }
      return;
    }
    upload.linked_post_id = suggestion.postId;
    const entry = inflight.get(upload.id);
    if (entry) { delete entry.suggestion; entry.upload = upload; renderQueue(root); }

    // Kick off processing now that we have a linked post.
    await jsonPost('/api/content-studio/process-asset', {
      upload_id: upload.id,
      post_id:   suggestion.postId,
    });
    pollUpload(upload.id);
  }

  /* ── Mount ─────────────────────────────────────────────────────────────── */
  window.CSViews['production'] = {
    async mount(root) {
      await loadWeekPosts();
      renderQueue(root);
      renderGenerate(root);
      renderApproved(root);

      window.CSUploadZone.mount(root, {
        onFileQueued: ({ tempId, file }) => {
          const fakeUpload = {
            id:           tempId,
            filename:     file.name,
            type:         file.type.startsWith('video/') ? 'video' : 'photo',
            status:       'uploading',
            asset_status: 'uploading',
          };
          inflight.set(tempId, { upload: fakeUpload, progress: 0 });
          renderQueue(root);
        },
        onProgress: ({ tempId, percent }) => {
          const entry = inflight.get(tempId);
          if (entry) { entry.progress = percent; renderQueue(root); }
        },
        onComplete: ({ tempId, response }) => {
          const entry = inflight.get(tempId);
          if (!entry) return;
          // Swap the temp ID for the real upload_id.
          const realUpload = {
            id:           response.upload_id,
            filename:     entry.upload.filename,
            type:         response.type,
            status:       'raw',
            asset_status: 'pending',
          };
          inflight.delete(tempId);

          // Suggest a link to a planned post.
          const suggestion = (() => {
            const target = findSuggestion(realUpload.type);
            if (!target) return null;
            return { postId: target.id, label: postLabel(target) };
          })();

          inflight.set(realUpload.id, { upload: realUpload, suggestion });
          renderQueue(root);

          // If no suggestion, kick off processing immediately without a link.
          if (!suggestion) {
            jsonPost('/api/content-studio/process-asset', { upload_id: realUpload.id });
            pollUpload(realUpload.id);
          }
        },
        onError: ({ tempId, message }) => {
          const entry = inflight.get(tempId);
          if (!entry) return;
          entry.upload.asset_status = 'failed';
          entry.upload.processing_error = message;
          renderQueue(root);
        },
      });
    },
  };
})();
