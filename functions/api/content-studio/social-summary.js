/**
 * /api/content-studio/social-summary?days=7
 *
 * Calls the social-analytics-worker's /summary endpoint for each platform
 * (instagram, facebook, linkedin, tiktok) in parallel and merges the results.
 * Returns one payload the INSIGHTS → "Social Performance" panel renders.
 *
 * ─── ENV VARS ─────────────────────────────────────────────────────────────
 *   SOCIAL_ANALYTICS_WORKER_URL   Base URL of the deployed Worker
 *                                 (e.g. https://mtm-social-analytics-worker.<acct>.workers.dev)
 *   MTM_SHARED_SECRET             Same shared secret configured on the Worker.
 */

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok'];

async function fetchPlatform(base, secret, platform, days) {
  const url = `${base}/summary?platform=${platform}&days=${days}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } });
  if (!res.ok) {
    return { platform, status: 'error', message: `Worker returned ${res.status}` };
  }
  return res.json();
}

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.SOCIAL_ANALYTICS_WORKER_URL || !env.MTM_SHARED_SECRET) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'Set SOCIAL_ANALYTICS_WORKER_URL and MTM_SHARED_SECRET in Cloudflare Pages env vars.',
      platforms: {},
    }), { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10)));
  const base = env.SOCIAL_ANALYTICS_WORKER_URL.replace(/\/$/, '');

  const settled = await Promise.allSettled(
    PLATFORMS.map(p => fetchPlatform(base, env.MTM_SHARED_SECRET, p, days))
  );

  const platforms = {};
  settled.forEach((r, i) => {
    const name = PLATFORMS[i];
    platforms[name] = r.status === 'fulfilled'
      ? r.value
      : { platform: name, status: 'error', message: r.reason?.message || 'fetch failed' };
  });

  return new Response(JSON.stringify({ status: 'ok', windowDays: days, platforms }),
    { status: 200, headers: corsHeaders });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
