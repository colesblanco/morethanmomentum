/**
 * POST /api/content-studio/approve-asset
 *
 * Body: { upload_id, post_id }
 *
 * Marks the asset as approved + locks the post. Phase 5 (GHL Social Planner
 * push) picks up posts where asset_status='approved' and edit_state='locked'.
 *
 *   - Refuses if upload.asset_url is missing (asset not ready yet).
 *   - Sets uploads.status='processed' and matched_brief_item=post_id.
 *   - Sets posts.asset_status='approved' and edit_state='locked'.
 */

const TENANT_ID = 'mtm';

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({ status: 'not_configured', message: 'CONTENT_STUDIO_DB missing' }),
      { status: 200, headers: corsHeaders });
  }

  const body = await request.json().catch(() => ({}));
  if (!body.upload_id || !body.post_id) {
    return new Response(JSON.stringify({ status: 'error', message: 'upload_id and post_id required' }),
      { status: 400, headers: corsHeaders });
  }

  try {
    const upload = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT id, asset_url, drive_url FROM uploads WHERE id = ? AND tenant_id = ?`
    ).bind(body.upload_id, TENANT_ID).first();
    if (!upload)              return new Response(JSON.stringify({ status: 'error', message: 'upload not found' }),  { status: 200, headers: corsHeaders });
    if (!upload.asset_url)    return new Response(JSON.stringify({ status: 'error', message: 'asset not ready'   }), { status: 200, headers: corsHeaders });

    await env.CONTENT_STUDIO_DB.batch([
      env.CONTENT_STUDIO_DB.prepare(
        `UPDATE posts
            SET asset_status = 'approved',
                edit_state   = 'locked',
                updated_at   = datetime('now')
          WHERE id = ? AND tenant_id = ?`
      ).bind(body.post_id, TENANT_ID),
      env.CONTENT_STUDIO_DB.prepare(
        `UPDATE uploads
            SET status             = 'processed',
                matched_brief_item = ?,
                linked_post_id     = ?,
                updated_at         = datetime('now')
          WHERE id = ? AND tenant_id = ?`
      ).bind(body.post_id, body.post_id, body.upload_id, TENANT_ID),
    ]);

    return new Response(JSON.stringify({
      status:     'ok',
      upload_id:  body.upload_id,
      post_id:    body.post_id,
      asset_url:  upload.asset_url,
      drive_url:  upload.drive_url,
      message:    'Asset approved. Phase 5 will push this to GHL Social Planner.',
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
