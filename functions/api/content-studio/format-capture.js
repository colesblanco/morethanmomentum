/**
 * POST /api/content-studio/format-capture
 *
 * Receives a manual format capture from the Settings UI: a URL, a description,
 * and an optional source account handle. Validates input, then proxies to the
 * Scout Worker's /decompose endpoint (single source of truth for the prompt).
 *
 * The Worker decomposes the format via Claude, writes the new format_library
 * row, and returns the persisted entry. This Pages Function relays the worker
 * response unchanged so the UI can render the new card immediately.
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_SCOUT_URL   workers.dev URL of the Scout Worker
 *   MTM_INTERNAL_SECRET        shared secret (matches the worker)
 */

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.CONTENT_STUDIO_SCOUT_URL || !env.MTM_INTERNAL_SECRET) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'Set CONTENT_STUDIO_SCOUT_URL and MTM_INTERNAL_SECRET in Cloudflare Pages env vars.',
    }), { status: 200, headers: corsHeaders });
  }

  const body = await request.json().catch(() => ({}));
  const description    = (body.description    || '').trim();
  const url            = (body.url            || '').trim();
  const source_account = (body.source_account || '').trim();

  if (!description && !url) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Provide either a URL or a description.',
    }), { status: 200, headers: corsHeaders });
  }

  const base = env.CONTENT_STUDIO_SCOUT_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/decompose`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({
        description,
        url:            url || null,
        source_account: source_account || null,
        persist:        true,
        captured_via:   'manual',
      }),
    });
    const payload = await res.json();
    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }),
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
