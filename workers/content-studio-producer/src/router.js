/**
 * Router — picks the right processor for an upload.
 *
 *   video  → Opus Clip pipeline (submit job; finalise on later /check-status calls)
 *   photo  → Canva graphic pipeline (incorporates the photo)
 *   screen → Canva carousel pipeline (one slide per stitched frame group)
 *
 * Every path is wrapped in error handling so the upload row reflects the
 * final state even when an external API fails.
 */

import { submitClipJob } from './opus-clip.js';
import { generateGraphic, generateCarousel } from './canva-designer.js';
import { processedKey, putBuffer, publicUrl, fetchToBuffer } from './r2-storage.js';
import { uploadToDrive }   from './drive-sync.js';

const TENANT_ID = 'mtm';

async function updateUpload(db, uploadId, fields) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  args.push(uploadId, TENANT_ID);
  await db.prepare(
    `UPDATE uploads SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...args).run();
}

async function loadUpload(db, uploadId) {
  return db.prepare(
    `SELECT * FROM uploads WHERE id = ? AND tenant_id = ?`
  ).bind(uploadId, TENANT_ID).first();
}

async function loadLinkedPost(db, postId) {
  if (!postId) return null;
  return db.prepare(
    `SELECT id, hook, caption, content_type, pillar_id, platform FROM posts WHERE id = ? AND tenant_id = ?`
  ).bind(postId, TENANT_ID).first();
}

/* ── Video path (async — finalised by /check-status) ─────────────────────── */
async function routeVideo(env, upload, post) {
  const obj = await env.ASSETS_BUCKET.get(upload.r2_key);
  if (!obj) throw new Error(`R2 object missing for upload ${upload.id}: ${upload.r2_key}`);
  const buffer = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType || 'video/mp4';

  const submitted = await submitClipJob(env, {
    buffer,
    filename:    upload.filename,
    contentType: ct,
  }, {});

  return {
    status:       'processing',
    opus_job_id:  submitted.job_id,
    asset_status: 'processing',
  };
}

/* ── Photo path (Canva graphic, synchronous via Claude+MCP) ──────────────── */
async function routePhoto(env, upload, post) {
  const imageUrl = publicUrl(env, upload.r2_key);
  const result = await generateGraphic(env, {
    hook:            post?.hook            || '',
    caption_summary: (post?.caption || '').slice(0, 280),
    content_type:    post?.content_type    || 'single_image',
    pillar_id:       post?.pillar_id       || '',
    platform:        post?.platform        || 'instagram',
  }, imageUrl);

  // Pull the Canva export into R2 + (optionally) Drive.
  const ext = (result.export_url.match(/\.(\w+)(?:\?|#|$)/) || [])[1] || 'png';
  const key = processedKey(upload.id, ext);
  const { buf, contentType } = await fetchToBuffer(result.export_url);
  await putBuffer(env.ASSETS_BUCKET, key, buf, contentType);

  let driveUrl = null;
  try {
    driveUrl = await uploadToDrive(env, {
      buffer:   buf,
      filename: `${upload.id}-${(upload.filename || 'asset')}.${ext}`,
      mimeType: contentType,
    });
  } catch (err) {
    // Drive failure is non-fatal; capture but don't block the run.
    driveUrl = null;
  }

  return {
    status:       'processed',
    asset_status: 'ready',
    asset_url:    publicUrl(env, key),
    drive_url:    driveUrl,
    processed_at: new Date().toISOString(),
  };
}

/* ── Screen path (carousel) ──────────────────────────────────────────────── */
async function routeScreen(env, upload, post) {
  // Phase 4 v1: a screen recording becomes one carousel of 3 stylised slides
  // built from the post hook + caption. Future: actually split frames.
  const slides = [
    post?.hook || 'Hook',
    (post?.caption || '').slice(0, 160) || 'Body',
    'CTA — what to do next',
  ];

  const result = await generateCarousel(env, {
    hook:      post?.hook      || '',
    pillar_id: post?.pillar_id || '',
    platform:  post?.platform  || 'instagram',
  }, slides);

  if (!result.export_urls?.length) throw new Error('Canva returned no carousel URLs');

  // Store the first slide as the primary asset; record all URLs in a tag JSON
  // on the upload so the UI can render the rest.
  const first = result.export_urls[0];
  const ext = (first.match(/\.(\w+)(?:\?|#|$)/) || [])[1] || 'png';
  const key = processedKey(upload.id, ext);
  const { buf, contentType } = await fetchToBuffer(first);
  await putBuffer(env.ASSETS_BUCKET, key, buf, contentType);

  return {
    status:       'processed',
    asset_status: 'ready',
    asset_url:    publicUrl(env, key),
    claude_tags:  JSON.stringify({ carousel_urls: result.export_urls }),
    processed_at: new Date().toISOString(),
  };
}

/* ── Public entry ────────────────────────────────────────────────────────── */
export async function routeUpload(env, uploadId, postId) {
  const db = env.CONTENT_STUDIO_DB;
  const upload = await loadUpload(db, uploadId);
  if (!upload) throw new Error(`upload ${uploadId} not found`);
  const post = await loadLinkedPost(db, postId || upload.linked_post_id || upload.matched_brief_item);

  await updateUpload(db, uploadId, { status: 'processing', linked_post_id: post?.id || null });

  try {
    let patch;
    if (upload.type === 'video')      patch = await routeVideo(env, upload, post);
    else if (upload.type === 'photo') patch = await routePhoto(env, upload, post);
    else if (upload.type === 'screen') patch = await routeScreen(env, upload, post);
    else throw new Error(`unknown upload type: ${upload.type}`);

    await updateUpload(db, uploadId, patch);

    // If the upload is linked to a post AND the asset is ready (not just async),
    // bump the post.asset_status so the UI reflects the new state.
    if (post && patch.asset_status === 'ready') {
      await db.prepare(
        `UPDATE posts SET asset_status = 'ready', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(post.id, TENANT_ID).run();
    } else if (post && patch.asset_status === 'processing') {
      await db.prepare(
        `UPDATE posts SET asset_status = 'processing', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(post.id, TENANT_ID).run();
    }

    return { success: true, upload_id: uploadId, ...patch };
  } catch (err) {
    await updateUpload(db, uploadId, {
      status:           'failed',
      asset_status:     'failed',
      processing_error: err.message,
    });
    if (post) {
      await db.prepare(
        `UPDATE posts SET asset_status = 'failed' WHERE id = ? AND tenant_id = ?`
      ).bind(post.id, TENANT_ID).run();
    }
    return { success: false, upload_id: uploadId, error: err.message };
  }
}
