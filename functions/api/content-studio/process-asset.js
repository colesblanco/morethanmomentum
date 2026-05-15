/**
 * POST /api/content-studio/process-asset
 *
 * Two modes:
 *   { upload_id, post_id? }                       → triggers Producer /process-upload
 *   { generate: 'graphic'|'carousel', post_id, slides?, hook? }
 *                                                 → triggers /generate-graphic or /generate-carousel
 *
 * GET /api/content-studio/process-asset?upload_id=N
 *   → proxies the worker /check-status for the frontend polling loop.
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_PRODUCER_URL  workers.dev URL of the Producer
 *   MTM_INTERNAL_SECRET          shared bearer
 */

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

function notConfigured() {
  return new Response(JSON.stringify({
    status:  'not_configured',
    message: 'Set CONTENT_STUDIO_PRODUCER_URL and MTM_INTERNAL_SECRET in Cloudflare Pages env vars.',
  }), { status: 200, headers: corsHeaders });
}

async function callProducer(env, path, init) {
  const base = env.CONTENT_STUDIO_PRODUCER_URL.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}`,
      ...(init?.headers || {}),
    },
  });
  return res.json();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_PRODUCER_URL || !env.MTM_INTERNAL_SECRET) return notConfigured();

  const body = await request.json().catch(() => ({}));

  try {
    if (body.generate === 'graphic') {
      if (!body.post_id) return new Response(JSON.stringify({ status: 'error', message: 'post_id required' }),
        { status: 400, headers: corsHeaders });
      const payload = await callProducer(env, '/generate-graphic', {
        method: 'POST',
        body:   JSON.stringify({ post_id: body.post_id }),
      });
      return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
    }

    if (body.generate === 'carousel') {
      if (!body.post_id || !Array.isArray(body.slides)) {
        return new Response(JSON.stringify({ status: 'error', message: 'post_id and slides[] required' }),
          { status: 400, headers: corsHeaders });
      }
      const payload = await callProducer(env, '/generate-carousel', {
        method: 'POST',
        body:   JSON.stringify({ post_id: body.post_id, slides: body.slides, hook: body.hook || '' }),
      });
      return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
    }

    if (!body.upload_id) {
      return new Response(JSON.stringify({ status: 'error', message: 'upload_id required (or generate=graphic|carousel)' }),
        { status: 400, headers: corsHeaders });
    }
    const payload = await callProducer(env, '/process-upload', {
      method: 'POST',
      body:   JSON.stringify({ upload_id: body.upload_id, post_id: body.post_id }),
    });
    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }),
      { status: 200, headers: corsHeaders });
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_PRODUCER_URL || !env.MTM_INTERNAL_SECRET) return notConfigured();

  const url = new URL(request.url);
  const uploadId = url.searchParams.get('upload_id');
  if (!uploadId) {
    return new Response(JSON.stringify({ status: 'error', message: 'upload_id required' }),
      { status: 400, headers: corsHeaders });
  }
  try {
    const base = env.CONTENT_STUDIO_PRODUCER_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/check-status?upload_id=${encodeURIComponent(uploadId)}`, {
      headers: { 'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}` },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }),
      { status: 200, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
