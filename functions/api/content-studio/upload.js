/**
 * POST /api/content-studio/upload
 *
 * Accepts a single file via multipart/form-data, validates it, writes to R2,
 * and creates the uploads D1 row. Optional post_id field links the upload to
 * a specific weekly_plan post; the Producer worker reads that link when
 * /process-asset is fired.
 *
 * Form fields:
 *   file     — required (mp4, mov, png, jpg, webp)
 *   post_id  — optional (int): link to a posts row
 *   source   — optional: 'manual_upload' (default) | 'generated'
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_DB  D1 binding
 *   ASSETS_BUCKET      R2 binding (bucket: mtm-content-studio-assets)
 */

const TENANT_ID = 'mtm';
const MAX_VIDEO = 500 * 1024 * 1024;   // 500 MB
const MAX_IMAGE =  20 * 1024 * 1024;   //  20 MB

const ALLOWED = {
  'video/mp4':       'video',
  'video/quicktime': 'video',
  'image/png':       'photo',
  'image/jpeg':      'photo',
  'image/webp':      'photo',
};

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({ status: 'not_configured', message: 'CONTENT_STUDIO_DB missing' }),
      { status: 200, headers: corsHeaders });
  }
  if (!env.ASSETS_BUCKET) {
    return new Response(JSON.stringify({ status: 'not_configured', message: 'ASSETS_BUCKET R2 binding missing' }),
      { status: 200, headers: corsHeaders });
  }

  let form;
  try { form = await request.formData(); }
  catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: 'invalid multipart body: ' + err.message }),
      { status: 400, headers: corsHeaders });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ status: 'error', message: 'file field required' }),
      { status: 400, headers: corsHeaders });
  }

  const mime = file.type || 'application/octet-stream';
  const type = ALLOWED[mime];
  if (!type) {
    return new Response(JSON.stringify({ status: 'error', message: `unsupported file type: ${mime}` }),
      { status: 400, headers: corsHeaders });
  }
  const max = type === 'video' ? MAX_VIDEO : MAX_IMAGE;
  if (file.size > max) {
    return new Response(JSON.stringify({ status: 'error', message: `file exceeds ${type === 'video' ? '500MB' : '20MB'} limit` }),
      { status: 400, headers: corsHeaders });
  }

  const postId = parseInt(form.get('post_id') || '0', 10) || null;
  const source = String(form.get('source') || 'manual_upload');

  const fname = safeFilename(file.name);
  const r2Key = `uploads/${TENANT_ID}/${Date.now()}-${fname}`;

  try {
    await env.ASSETS_BUCKET.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
    });

    const ins = await env.CONTENT_STUDIO_DB.prepare(
      `INSERT INTO uploads (tenant_id, filename, r2_key, type, status, source, linked_post_id, matched_brief_item)
       VALUES (?, ?, ?, ?, 'raw', ?, ?, ?)`
    ).bind(TENANT_ID, fname, r2Key, type, source, postId, postId).run();

    return new Response(JSON.stringify({
      status:    'ok',
      upload_id: ins.meta.last_row_id,
      r2_key:    r2Key,
      type,
      mime,
      size:      file.size,
      post_id:   postId,
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }),
      { status: 200, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
