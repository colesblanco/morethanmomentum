/**
 * Upload zone — drag/drop + browse, multi-file, POSTs each file to
 * /api/content-studio/upload and reports per-file progress via XMLHttpRequest
 * (fetch doesn't expose upload progress events).
 *
 * Surface: window.CSUploadZone.mount(rootEl, { onFileQueued, onProgress, onComplete, onError })
 *   - onFileQueued({ tempId, file })            fires the moment we accept a file
 *   - onProgress  ({ tempId, percent })         fires as bytes go up
 *   - onComplete  ({ tempId, response })        fires when /upload returns
 *   - onError     ({ tempId, message })         fires on any network/validation error
 */
window.CSUploadZone = (function () {
  const ACCEPT = ['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp'];

  function uploadOne(file, tempId, callbacks) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        callbacks.onProgress?.({ tempId, percent });
      });

      xhr.addEventListener('load', () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && body?.status === 'ok') {
          callbacks.onComplete?.({ tempId, response: body });
          resolve(body);
        } else {
          const message = body?.message || `HTTP ${xhr.status}`;
          callbacks.onError?.({ tempId, message });
          resolve(null);
        }
      });
      xhr.addEventListener('error', () => {
        callbacks.onError?.({ tempId, message: 'network error' });
        resolve(null);
      });

      xhr.open('POST', '/api/content-studio/upload');
      xhr.send(form);
    });
  }

  function mount(root, callbacks = {}) {
    const drop   = root.querySelector('#cs-prod-drop');
    const input  = root.querySelector('#cs-prod-file');
    const browse = root.querySelector('#cs-prod-browse');

    function accept(files) {
      for (const file of files) {
        if (!ACCEPT.includes(file.type)) {
          callbacks.onError?.({ tempId: `tmp-${Date.now()}-${Math.random()}`, message: `unsupported file type: ${file.type}` });
          continue;
        }
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        callbacks.onFileQueued?.({ tempId, file });
        uploadOne(file, tempId, callbacks);
      }
    }

    browse?.addEventListener('click', () => input?.click());
    drop?.addEventListener('click', (e) => {
      if (e.target === browse || e.target === input) return;
      input?.click();
    });
    input?.addEventListener('change', () => {
      if (input.files?.length) accept(Array.from(input.files));
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev => {
      drop?.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        drop.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      drop?.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        drop.classList.remove('is-drag');
      });
    });
    drop?.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files?.length) accept(Array.from(files));
    });
  }

  return { mount };
})();
