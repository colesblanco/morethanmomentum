/**
 * Producer Worker — HTTP entrypoint.
 *
 *   GET  /health                  → { status, version, services }
 *   POST /process-upload          → { upload_id, post_id? }
 *                                   Returns IMMEDIATELY with status: 'processing'.
 *                                   The router runs in ctx.waitUntil so video
 *                                   pipelines (Opus) and Canva calls don't
 *                                   hold the request open.
 *   GET  /check-status?upload_id  → reads D1 + (for video uploads with an
 *                                   open opus_job_id) polls Opus once and
 *                                   finalises if complete.
 *   POST /generate-graphic        → { post_id, brief? }
 *                                   Generates a graphic from scratch via Canva
 *                                   MCP. Same async pattern.
 *   POST /generate-carousel       → { post_id, slides: [...] }
 *
 * All non-/health endpoints require Authorization: Bearer ${MTM_INTERNAL_SECRET}.
 */

import { routeUpload }                from './router.js';
import { generateGraphic, generateCarousel } from './canva-designer.js';
import { checkClipStatus }            from './opus-clip.js';
import { processedKey, putBuffer, publicUrl, fetchToBuffer } from './r2-storage.js';
import { uploadToDrive, driveEnabled } from './drive-sync.js';

const TENANT_ID = 'mtm';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authed(request, env) {
  if (!env.MTM_INTERNAL_SECRET) return false;
  return request.headers.get('Authorization') === `Bearer ${env.MTM_INTERNAL_SECRET}`;
}

async function loadUpload(db, uploadId) {
  return db.prepare(
    `SELECT * FROM uploads WHERE id = ? AND tenant_id = ?`
  ).bind(uploadId, TENANT_ID).first();
}

async function updateUpload(db, uploadId, fields) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); args.push(v); }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  args.push(uploadId, TENANT_ID);
  await db.prepare(
    `UPDATE uploads SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...args).run();
}

/* ── Opus finalisation (called from /check-status) ───────────────────────── */
async function finaliseOpusIfReady(env, upload) {
  if (!upload.opus_job_id || upload.status === 'processed') return null;
  const poll = await checkClipStatus(env, upload.opus_job_id);
  if (poll.status === 'pending' || poll.status === 'processing') {
    return { status: 'processing', opus: poll.status };
  }
  if (poll.status === 'failed') {
    await updateUpload(env.CONTENT_STUDIO_DB, upload.id, {
      status:           'failed',
      asset_status:     'failed',
      processing_error: poll.error || 'opus job failed',
    });
    return { status: 'failed', opus: 'failed' };
  }
  // completed
  const downloadUrl = poll.download_url || poll.url;
  if (!downloadUrl) throw new Error('opus complete but no download_url');
  const { buf, contentType } = await fetchToBuffer(downloadUrl);
  const ext = (downloadUrl.match(/\.(\w+)(?:\?|#|$)/) || [])[1] || 'mp4';
  const key = processedKey(upload.id, ext);
  await putBuffer(env.ASSETS_BUCKET, key, buf, contentType);

  let driveUrl = null;
  try {
    driveUrl = await uploadToDrive(env, {
      buffer:   buf,
      filename: `${upload.id}-${upload.filename || 'clip'}.${ext}`,
      mimeType: contentType,
    });
  } catch { /* non-fatal */ }

  await updateUpload(env.CONTENT_STUDIO_DB, upload.id, {
    status:       'processed',
    asset_status: 'ready',
    asset_url:    publicUrl(env, key),
    drive_url:    driveUrl,
    processed_at: new Date().toISOString(),
  });

  // Mirror to the linked post if there is one.
  if (upload.linked_post_id) {
    await env.CONTENT_STUDIO_DB.prepare(
      `UPDATE posts SET asset_status = 'ready', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
    ).bind(upload.linked_post_id, TENANT_ID).run();
  }
  return { status: 'ready', opus: 'completed', asset_url: publicUrl(env, key) };
}

/* ── Generate-graphic background work ─────────────────────────────────────── */
async function generateGraphicAsync(env, postId, brief, uploadIdForRecord) {
  try {
    const result = await generateGraphic(env, brief, brief.image_url || null);
    const ext = (result.export_url.match(/\.(\w+)(?:\?|#|$)/) || [])[1] || 'png';
    const key = processedKey(uploadIdForRecord, ext);
    const { buf, contentType } = await fetchToBuffer(result.export_url);
    await putBuffer(env.ASSETS_BUCKET, key, buf, contentType);

    let driveUrl = null;
    try {
      driveUrl = await uploadToDrive(env, {
        buffer:   buf,
        filename: `generated-${uploadIdForRecord}.${ext}`,
        mimeType: contentType,
      });
    } catch { /* non-fatal */ }

    await updateUpload(env.CONTENT_STUDIO_DB, uploadIdForRecord, {
      status:           'processed',
      asset_status:     'ready',
      asset_url:        publicUrl(env, key),
      drive_url:        driveUrl,
      canva_design_id:  null,
      processed_at:     new Date().toISOString(),
    });

    if (postId) {
      await env.CONTENT_STUDIO_DB.prepare(
        `UPDATE posts SET asset_status = 'ready', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(postId, TENANT_ID).run();
    }
  } catch (err) {
    await updateUpload(env.CONTENT_STUDIO_DB, uploadIdForRecord, {
      status:           'failed',
      asset_status:     'failed',
      processing_error: err.message,
    });
    if (postId) {
      await env.CONTENT_STUDIO_DB.prepare(
        `UPDATE posts SET asset_status = 'failed' WHERE id = ? AND tenant_id = ?`
      ).bind(postId, TENANT_ID).run();
    }
  }
}

/** Create a synthetic uploads row so generated assets share the same lifecycle as uploaded ones. */
async function createGeneratedUpload(db, postId, kind /* 'graphic' | 'carousel' */) {
  const ins = await db.prepare(
    `INSERT INTO uploads (tenant_id, filename, r2_key, type, status, source, linked_post_id)
     VALUES (?, ?, ?, ?, 'processing', 'generated', ?)`
  ).bind(
    TENANT_ID,
    `generated-${kind}-${Date.now()}`,
    `placeholder/${kind}-${Date.now()}`,    // r2_key gets overwritten when stored
    kind === 'carousel' ? 'screen' : 'photo',
    postId || null,
  ).run();
  return ins.meta.last_row_id;
}

/* ── HTTP surface ────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status:  'ok',
        version: '4.0.0',
        services: {
          opus:      !!env.OPUS_API_KEY,
          canva_mcp: !!env.CANVA_MCP_TOKEN,
          anthropic: !!env.ANTHROPIC_API_KEY,
          r2:        !!env.ASSETS_BUCKET,
          d1:        !!env.CONTENT_STUDIO_DB,
          drive:     driveEnabled(env),
        },
      });
    }

    if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (url.pathname === '/process-upload' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.upload_id) return json({ error: 'upload_id required' }, 400);
        // Kick off the router asynchronously so we return fast.
        ctx.waitUntil(routeUpload(env, body.upload_id, body.post_id).catch(err =>
          console.error('routeUpload failed:', err.message)
        ));
        return json({ success: true, upload_id: body.upload_id, status: 'processing' });
      }

      if (url.pathname === '/check-status' && request.method === 'GET') {
        const uploadId = parseInt(url.searchParams.get('upload_id') || '0', 10);
        if (!uploadId) return json({ error: 'upload_id required' }, 400);
        const upload = await loadUpload(env.CONTENT_STUDIO_DB, uploadId);
        if (!upload) return json({ error: 'upload not found' }, 404);

        // For video uploads still in flight, poll Opus once.
        let finalise = null;
        if (upload.type === 'video' && upload.opus_job_id && upload.status !== 'processed' && upload.status !== 'failed') {
          try { finalise = await finaliseOpusIfReady(env, upload); }
          catch (err) { finalise = { error: err.message }; }
        }
        const fresh = await loadUpload(env.CONTENT_STUDIO_DB, uploadId);
        return json({ success: true, upload: fresh, finalise });
      }

      if (url.pathname === '/generate-graphic' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.post_id) return json({ error: 'post_id required' }, 400);
        if (!env.CANVA_MCP_TOKEN) return json({ error: 'CANVA_MCP_TOKEN missing' }, 200);

        const post = await env.CONTENT_STUDIO_DB.prepare(
          `SELECT id, hook, caption, content_type, pillar_id, platform FROM posts WHERE id = ? AND tenant_id = ?`
        ).bind(body.post_id, TENANT_ID).first();
        if (!post) return json({ error: 'post not found' }, 404);

        const recordId = await createGeneratedUpload(env.CONTENT_STUDIO_DB, post.id, 'graphic');
        ctx.waitUntil(generateGraphicAsync(env, post.id, {
          hook:            post.hook,
          caption_summary: (post.caption || '').slice(0, 280),
          content_type:    post.content_type,
          pillar_id:       post.pillar_id,
          platform:        post.platform,
        }, recordId));

        await env.CONTENT_STUDIO_DB.prepare(
          `UPDATE posts SET asset_status = 'processing' WHERE id = ? AND tenant_id = ?`
        ).bind(post.id, TENANT_ID).run();

        return json({ success: true, upload_id: recordId, post_id: post.id, status: 'processing' });
      }

      if (url.pathname === '/generate-carousel' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.post_id || !Array.isArray(body.slides) || !body.slides.length) {
          return json({ error: 'post_id and slides[] required' }, 400);
        }
        if (!env.CANVA_MCP_TOKEN) return json({ error: 'CANVA_MCP_TOKEN missing' }, 200);

        const recordId = await createGeneratedUpload(env.CONTENT_STUDIO_DB, body.post_id, 'carousel');
        // Reuse generateCarousel synchronously inside waitUntil.
        ctx.waitUntil((async () => {
          try {
            const result = await generateCarousel(env, { hook: body.hook || '' }, body.slides);
            if (!result.export_urls?.length) throw new Error('no carousel urls returned');
            const first = result.export_urls[0];
            const ext = (first.match(/\.(\w+)(?:\?|#|$)/) || [])[1] || 'png';
            const key = processedKey(recordId, ext);
            const { buf, contentType } = await fetchToBuffer(first);
            await putBuffer(env.ASSETS_BUCKET, key, buf, contentType);

            await updateUpload(env.CONTENT_STUDIO_DB, recordId, {
              status:       'processed',
              asset_status: 'ready',
              asset_url:    publicUrl(env, key),
              claude_tags:  JSON.stringify({ carousel_urls: result.export_urls }),
              processed_at: new Date().toISOString(),
            });
            await env.CONTENT_STUDIO_DB.prepare(
              `UPDATE posts SET asset_status = 'ready' WHERE id = ? AND tenant_id = ?`
            ).bind(body.post_id, TENANT_ID).run();
          } catch (err) {
            await updateUpload(env.CONTENT_STUDIO_DB, recordId, {
              status: 'failed', asset_status: 'failed', processing_error: err.message,
            });
          }
        })());

        return json({ success: true, upload_id: recordId, post_id: body.post_id, status: 'processing' });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ success: false, error: err.message }, 200);
    }
  },
};
