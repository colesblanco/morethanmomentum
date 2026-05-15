/**
 * Post Card component + side-panel editor.
 *
 * Exposed surface (attached to window.CSPostCard):
 *   render(post)            → returns an HTMLElement for the column grid
 *   openSide(post, onSave)  → opens the right-side editor for `post`
 *   closeSide()             → closes the side panel
 *
 * The side panel debounces field edits and POSTs to /api/content-studio/post-update.
 * onSave is the callback supplied by this-week.js so it can re-render after each save.
 */
window.CSPostCard = (function () {
  const DAY_INDEX = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
  let sideEl   = null;
  let savingTimers = new Map();   // field -> setTimeout id

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  /* ── Grid card ────────────────────────────────────────────────────── */
  function render(post) {
    const el = document.createElement('div');
    el.className = 'cs-tw-card';
    el.dataset.postId = post.id;
    el.dataset.pillar = post.pillar_id || '';

    const stateClass = post.edit_state === 'yellow' ? 'is-yellow'
                     : post.edit_state === 'locked' ? 'is-locked'
                     : 'is-green';

    const platformLabel = (post.platform || '').toUpperCase();
    const typeLabel     = (post.content_type || '').replace(/_/g, ' ').toUpperCase();

    el.innerHTML = `
      <div class="cs-tw-card-head">
        <span class="cs-tw-card-platform">${esc(platformLabel)}</span>
        <span class="cs-tw-card-time">${esc(post.post_time || '')}</span>
      </div>
      <div class="cs-tw-card-hook">${esc(post.hook || '(no hook yet)')}</div>
      <div class="cs-tw-card-foot">
        <span><span class="cs-tw-state-dot ${stateClass}"></span>${esc(typeLabel)}</span>
        ${post.needs_filming ? `<span class="cs-tw-card-badge is-filming">FILMING</span>` : `<span class="cs-tw-card-badge">${esc(post.asset_status || 'pending').toUpperCase()}</span>`}
      </div>
    `;
    return el;
  }

  /* ── Side panel ──────────────────────────────────────────────────── */
  function ensureSide() {
    sideEl = document.getElementById('cs-tw-side');
    return sideEl;
  }

  function closeSide() {
    if (!sideEl) return;
    sideEl.classList.remove('is-open');
    sideEl.setAttribute('aria-hidden', 'true');
    sideEl.innerHTML = '';
    savingTimers.forEach(t => clearTimeout(t));
    savingTimers.clear();
  }

  function openSide(post, onSave) {
    ensureSide();
    if (!sideEl) return;

    const locked = post.edit_state === 'locked';
    const hashtagsString = (post.hashtags || []).join(' ');

    sideEl.innerHTML = `
      <div class="cs-tw-side-head">
        <h2 class="cs-tw-side-title">${esc((post.day_of_week || '').toUpperCase())} · ${esc((post.platform || '').toUpperCase())}</h2>
        <button class="cs-tw-side-close" data-tw-side-close aria-label="Close">✕</button>
      </div>

      <div class="cs-tw-field">
        <label class="cs-tw-field-label">Hook
          <span class="cs-tw-state-dot ${locked ? 'is-locked' : post.edit_state === 'yellow' ? 'is-yellow' : 'is-green'}" style="margin-left:8px;"></span>
          <span class="cs-tw-saving" data-saving="hook" hidden></span>
        </label>
        <input type="text" data-field="hook" value="${esc(post.hook || '')}" ${locked ? 'disabled' : ''} />
      </div>

      <div class="cs-tw-field">
        <label class="cs-tw-field-label">Caption
          <span class="cs-tw-saving" data-saving="caption" hidden></span>
        </label>
        <textarea data-field="caption" ${locked ? 'disabled' : ''}>${esc(post.caption || '')}</textarea>
      </div>

      <div class="cs-tw-field">
        <label class="cs-tw-field-label">Hashtags (space-separated)
          <span class="cs-tw-saving" data-saving="hashtags" hidden></span>
        </label>
        <input type="text" data-field="hashtags" value="${esc(hashtagsString)}" ${locked ? 'disabled' : ''} />
      </div>

      <div class="cs-tw-field-row">
        <div class="cs-tw-field">
          <label class="cs-tw-field-label">Platform
            <span class="cs-tw-saving" data-saving="platform" hidden></span>
          </label>
          <select data-field="platform" ${locked ? 'disabled' : ''}>
            <option value="instagram" ${post.platform === 'instagram' ? 'selected' : ''}>Instagram</option>
            <option value="facebook"  ${post.platform === 'facebook'  ? 'selected' : ''}>Facebook</option>
          </select>
        </div>
        <div class="cs-tw-field">
          <label class="cs-tw-field-label">Post time
            <span class="cs-tw-saving" data-saving="post_time" hidden></span>
          </label>
          <input type="time" data-field="post_time" value="${esc(post.post_time || '')}" ${locked ? 'disabled' : ''} />
        </div>
      </div>

      ${post.decision_log ? `<div class="cs-tw-decision">${esc(post.decision_log)}</div>` : ''}

      <div class="cs-tw-side-actions">
        <button class="cs-tw-action" data-action="approve" ${locked ? 'disabled' : ''}>Approve</button>
        <button class="cs-tw-action is-secondary" data-action="regen" ${locked ? 'disabled' : ''}>Regenerate this post</button>
        <label class="cs-tw-cascade-toggle">
          <input type="checkbox" data-cascade-toggle checked /> cascade
        </label>
      </div>
    `;

    sideEl.classList.add('is-open');
    sideEl.setAttribute('aria-hidden', 'false');

    sideEl.querySelector('[data-tw-side-close]').addEventListener('click', closeSide);

    // Field editors — debounce 700ms; cascade flag from checkbox.
    sideEl.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        const raw   = input.tagName === 'SELECT' ? input.value : input.value;
        const value = field === 'hashtags'
          ? raw.trim().split(/\s+/).filter(Boolean)
          : raw;

        const savingEl = sideEl.querySelector(`[data-saving="${field}"]`);
        if (savingEl) savingEl.hidden = false;

        clearTimeout(savingTimers.get(field));
        savingTimers.set(field, setTimeout(async () => {
          const cascade = sideEl.querySelector('[data-cascade-toggle]')?.checked;
          await onSave({ post_id: post.id, field, value, cascade: !!cascade });
          if (savingEl) savingEl.hidden = true;
        }, 700));
      });
    });

    // Approve = set edit_state = locked (no cascade trigger).
    sideEl.querySelector('[data-action="approve"]')?.addEventListener('click', async () => {
      await onSave({ post_id: post.id, field: 'edit_state', value: 'locked', cascade: false });
    });

    // Regenerate-this-post: simplest path is to flip back to green and trigger cascade
    // with only this day as the target. Implemented in this-week.js via the onSave hook.
    sideEl.querySelector('[data-action="regen"]')?.addEventListener('click', async () => {
      await onSave({ post_id: post.id, field: 'edit_state', value: 'green', cascade: false, regenSelf: true });
    });
  }

  return { render, openSide, closeSide, DAY_INDEX };
})();
