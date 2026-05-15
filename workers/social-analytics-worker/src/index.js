/**
 * MTM Social Analytics Worker
 *
 * Standalone Cloudflare Worker that fronts MTM's social platform analytics.
 * Phase 1 ships Instagram + Facebook live; LinkedIn + TikTok return a
 * scaffolded "coming Phase 1.5" response so the front-end can render the
 * UI shell against the real endpoint shape today.
 *
 * Why a separate Worker (not a Pages Function)?
 *   - This Worker will be cron-triggered in Phase 1.5 to roll up daily
 *     snapshots into D1. Pages Functions can't host cron triggers.
 *   - Keeping the platform tokens isolated to a single tightly-scoped
 *     Worker reduces blast radius vs. exposing them to every Pages Function.
 *
 * ─── ENV VARS (configure via `wrangler secret put` or dashboard) ───────────
 *   IG_ACCESS_TOKEN          Instagram Graph long-lived token
 *   IG_BUSINESS_ACCOUNT_ID   MTM's Instagram Business Account ID
 *   FB_PAGE_ACCESS_TOKEN     Facebook Page access token (never-expires variant)
 *   FB_PAGE_ID               MTM's Facebook Page numeric ID
 *   MTM_SHARED_SECRET        Required on every inbound request as
 *                            `Authorization: Bearer <secret>`. Matches the
 *                            secret that Pages Functions send.
 *
 * ─── ENDPOINTS ─────────────────────────────────────────────────────────────
 *   GET /health
 *   GET /summary?platform=instagram|facebook|linkedin|tiktok&days=7|30
 *   GET /top-posts?platform=instagram&days=30&limit=5
 *
 * ─── CORS ─────────────────────────────────────────────────────────────────
 *   Allow-list: morethanmomentum.com (and *.pages.dev preview origins).
 */

const ALLOWED_ORIGIN_HOSTS = new Set([
  'morethanmomentum.com',
  'www.morethanmomentum.com',
]);
const ALLOWED_ORIGIN_SUFFIX = '.pages.dev';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

function corsHeaders(originHeader) {
  let origin = '';
  if (originHeader) {
    try {
      const url = new URL(originHeader);
      if (
        ALLOWED_ORIGIN_HOSTS.has(url.hostname) ||
        url.hostname.endsWith(ALLOWED_ORIGIN_SUFFIX)
      ) {
        origin = originHeader;
      }
    } catch {
      origin = '';
    }
  }
  return {
    'Access-Control-Allow-Origin':  origin || 'https://morethanmomentum.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary':                         'Origin',
  };
}

function json(payload, init = {}, originHeader = null) {
  return new Response(JSON.stringify(payload), {
    status:  init.status  || 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(originHeader),
      ...(init.headers || {}),
    },
  });
}

function unauthorized(originHeader) {
  return json({ error: 'unauthorized' }, { status: 401 }, originHeader);
}

function badRequest(message, originHeader) {
  return json({ error: 'bad_request', message }, { status: 400 }, originHeader);
}

function requireAuth(request, env) {
  if (!env.MTM_SHARED_SECRET) return false;
  const header = request.headers.get('Authorization') || '';
  return header === `Bearer ${env.MTM_SHARED_SECRET}`;
}

/* ── Instagram ──────────────────────────────────────────────────────────── */
async function fetchInstagramSummary(env, days) {
  if (!env.IG_ACCESS_TOKEN || !env.IG_BUSINESS_ACCOUNT_ID) {
    return { platform: 'instagram', status: 'not_configured',
             message: 'Set IG_ACCESS_TOKEN and IG_BUSINESS_ACCOUNT_ID in Cloudflare env vars.' };
  }

  const id    = env.IG_BUSINESS_ACCOUNT_ID;
  const token = env.IG_ACCESS_TOKEN;
  const period = days <= 7 ? 'day' : 'days_28';

  const [accountRes, insightsRes] = await Promise.allSettled([
    fetch(`${META_API_BASE}/${id}?fields=followers_count,media_count&access_token=${token}`),
    fetch(`${META_API_BASE}/${id}/insights?metric=reach,impressions,profile_views&period=${period}&access_token=${token}`),
  ]);

  let followers = 0, mediaCount = 0;
  if (accountRes.status === 'fulfilled' && accountRes.value.ok) {
    const d = await accountRes.value.json();
    followers  = d.followers_count || 0;
    mediaCount = d.media_count     || 0;
  }

  let reach = 0, impressions = 0, profileViews = 0;
  if (insightsRes.status === 'fulfilled' && insightsRes.value.ok) {
    const d = await insightsRes.value.json();
    for (const m of (d.data || [])) {
      const val = m?.values?.[0]?.value || 0;
      if (m.name === 'reach')         reach        = val;
      if (m.name === 'impressions')   impressions  = val;
      if (m.name === 'profile_views') profileViews = val;
    }
  }

  return {
    platform: 'instagram',
    status:   'ok',
    windowDays: days,
    followers,
    mediaCount,
    reach,
    impressions,
    profileViews,
    engagement: profileViews,
    followerDelta: null,
  };
}

async function fetchInstagramTopPosts(env, days, limit) {
  if (!env.IG_ACCESS_TOKEN || !env.IG_BUSINESS_ACCOUNT_ID) {
    return { platform: 'instagram', status: 'not_configured', posts: [] };
  }
  const id    = env.IG_BUSINESS_ACCOUNT_ID;
  const token = env.IG_ACCESS_TOKEN;

  const res = await fetch(
    `${META_API_BASE}/${id}/media?fields=id,caption,timestamp,like_count,comments_count,media_type,permalink,thumbnail_url,media_url&limit=25&access_token=${token}`
  );
  if (!res.ok) return { platform: 'instagram', status: 'error', posts: [] };

  const data = await res.json();
  const sinceMs = Date.now() - days * 86400 * 1000;
  const items = (data.data || [])
    .filter(p => new Date(p.timestamp).getTime() >= sinceMs)
    .map(p => ({
      id:        p.id,
      caption:   (p.caption || '').slice(0, 140),
      timestamp: p.timestamp,
      likes:     p.like_count     || 0,
      comments:  p.comments_count || 0,
      type:      p.media_type     || 'IMAGE',
      url:       p.permalink      || '',
      thumb:     p.thumbnail_url  || p.media_url || '',
      score:     (p.like_count || 0) + (p.comments_count || 0) * 3,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { platform: 'instagram', status: 'ok', windowDays: days, posts: items };
}

/* ── Facebook ───────────────────────────────────────────────────────────── */
async function fetchFacebookSummary(env, days) {
  if (!env.FB_PAGE_ACCESS_TOKEN || !env.FB_PAGE_ID) {
    return { platform: 'facebook', status: 'not_configured',
             message: 'Set FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID in Cloudflare env vars.' };
  }

  const id    = env.FB_PAGE_ID;
  const token = env.FB_PAGE_ACCESS_TOKEN;

  const now   = Date.now();
  const since = Math.floor((now - days * 86400 * 1000) / 1000);
  const until = Math.floor(now / 1000);

  const [pageRes, insightsRes] = await Promise.allSettled([
    fetch(`${META_API_BASE}/${id}?fields=fan_count,followers_count&access_token=${token}`),
    fetch(
      `${META_API_BASE}/${id}/insights` +
      `?metric=page_impressions_unique,page_fan_adds_unique,page_engaged_users` +
      `&period=day&since=${since}&until=${until}&access_token=${token}`
    ),
  ]);

  let followers = 0, fans = 0;
  if (pageRes.status === 'fulfilled' && pageRes.value.ok) {
    const d = await pageRes.value.json();
    fans      = d.fan_count       || 0;
    followers = d.followers_count || fans;
  }

  let reach = 0, newFollowers = 0, engaged = 0;
  if (insightsRes.status === 'fulfilled' && insightsRes.value.ok) {
    const d = await insightsRes.value.json();
    for (const m of (d.data || [])) {
      const sum = (m.values || []).reduce((a, v) => a + (v.value || 0), 0);
      if (m.name === 'page_impressions_unique') reach        = sum;
      if (m.name === 'page_fan_adds_unique')   newFollowers = sum;
      if (m.name === 'page_engaged_users')     engaged      = sum;
    }
  }

  return {
    platform: 'facebook',
    status:   'ok',
    windowDays: days,
    followers,
    fans,
    reach,
    impressions: reach,
    engagement: engaged,
    followerDelta: newFollowers,
  };
}

/* ── Scaffolded platforms ───────────────────────────────────────────────── */
function scaffoldedResponse(platform) {
  return {
    platform,
    status:  'scaffolded',
    message: `${platform[0].toUpperCase() + platform.slice(1)} integration coming in Phase 1.5`,
  };
}

/* ── Router ─────────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(originHeader) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: '1.0.0' }, {}, originHeader);
    }

    if (!requireAuth(request, env)) {
      return unauthorized(originHeader);
    }

    if (url.pathname === '/summary') {
      const platform = (url.searchParams.get('platform') || '').toLowerCase();
      const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10)));
      if (!platform) return badRequest('platform query param required', originHeader);

      try {
        if (platform === 'instagram') return json(await fetchInstagramSummary(env, days), {}, originHeader);
        if (platform === 'facebook')  return json(await fetchFacebookSummary(env, days),  {}, originHeader);
        if (platform === 'linkedin')  return json(scaffoldedResponse('linkedin'), {}, originHeader);
        if (platform === 'tiktok')    return json(scaffoldedResponse('tiktok'),   {}, originHeader);
        return badRequest('unknown platform', originHeader);
      } catch (err) {
        return json({ platform, status: 'error', message: err.message }, { status: 200 }, originHeader);
      }
    }

    if (url.pathname === '/top-posts') {
      const platform = (url.searchParams.get('platform') || '').toLowerCase();
      const days  = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days')  || '30', 10)));
      const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get('limit') || '5',  10)));
      if (!platform) return badRequest('platform query param required', originHeader);

      try {
        if (platform === 'instagram') return json(await fetchInstagramTopPosts(env, days, limit), {}, originHeader);
        if (platform === 'facebook')  return json({ platform: 'facebook', status: 'scaffolded', posts: [] }, {}, originHeader);
        if (platform === 'linkedin' || platform === 'tiktok') {
          return json({ platform, status: 'scaffolded', posts: [] }, {}, originHeader);
        }
        return badRequest('unknown platform', originHeader);
      } catch (err) {
        return json({ platform, status: 'error', message: err.message }, { status: 200 }, originHeader);
      }
    }

    return json({ error: 'not_found' }, { status: 404 }, originHeader);
  },
};
