/**
 * Opus Clip pipeline.
 *
 * Two-call shape:
 *   - submitClipJob(): upload the video + create the clip job, return job_id.
 *     Used by /process-upload's async pass. Returns fast.
 *   - pollAndIngest(): check the job status on Opus; when complete, download
 *     the rendered clip into R2 + (optionally) Drive, and patch the uploads
 *     row in D1.
 *
 * Cloudflare Workers have a wall-time limit per request; the worker submits
 * the Opus job inside ctx.waitUntil from /process-upload and finalises via
 * polling on subsequent /check-status calls. This survives any Opus rendering
 * time without holding a single request open.
 */

const OPUS_BASE = 'https://api.opus.pro/v1';

/* ── Opus calls ──────────────────────────────────────────────────────────── */
async function opusUpload(apiKey, buffer, filename, contentType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType || 'video/mp4' }), filename);

  const res = await fetch(`${OPUS_BASE}/videos`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body:    form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`opus upload HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();   // { video_id, status, ... }
}

async function opusCreateClip(apiKey, videoId, settings) {
  const body = {
    video_id: videoId,
    settings: {
      auto_caption:   true,
      caption_style:  'bold_highlight',
      aspect_ratio:   '9:16',
      duration_min:   15,
      duration_max:   60,
      ...(settings || {}),
    },
  };
  const res = await fetch(`${OPUS_BASE}/clips`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`opus clip create HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();   // { job_id, status, ... }
}

async function opusJobStatus(apiKey, jobId) {
  const res = await fetch(`${OPUS_BASE}/clips/${jobId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`opus status HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();   // { job_id, status: pending|processing|completed|failed, download_url? }
}

/* ── Public ──────────────────────────────────────────────────────────────── */
export async function submitClipJob(env, { buffer, filename, contentType }, settings) {
  if (!env.OPUS_API_KEY) throw new Error('OPUS_API_KEY not configured on Producer worker');
  const uploaded = await opusUpload(env.OPUS_API_KEY, buffer, filename, contentType);
  const videoId  = uploaded.video_id || uploaded.id;
  if (!videoId) throw new Error('opus upload returned no video_id');
  const created = await opusCreateClip(env.OPUS_API_KEY, videoId, settings);
  return {
    video_id: videoId,
    job_id:   created.job_id || created.id,
    status:   created.status || 'processing',
  };
}

/** Poll Opus once. Returns the current job status payload. */
export async function checkClipStatus(env, jobId) {
  if (!env.OPUS_API_KEY) throw new Error('OPUS_API_KEY missing');
  return opusJobStatus(env.OPUS_API_KEY, jobId);
}
