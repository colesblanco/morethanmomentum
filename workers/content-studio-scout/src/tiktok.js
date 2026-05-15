/**
 * TikTok Creative Center reader.
 *
 * Two paths, tried in order:
 *   1. Internal "creative_radar" JSON endpoints (no auth required from server origins,
 *      but TikTok rate-limits aggressively — we send realistic browser headers).
 *   2. Fallback: fetch the Creative Center inspiration HTML page and parse the
 *      JSON blob from __NEXT_DATA__.
 *
 * Returns a normalized payload regardless of which path succeeded. On total
 * failure, returns { source, status: 'error', message } — never throws so the
 * Scout pipeline keeps running.
 */

const COUNTRY  = 'US';
const PERIOD   = 7;
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://ads.tiktok.com/creative_radar/',
};

async function tryApi() {
  const trendUrl   = `https://ads.tiktok.com/creative_radar_api/v1/popular_trend/list?period=${PERIOD}&country_code=${COUNTRY}&industry_id=0`;
  const hashtagUrl = `https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?period=${PERIOD}&country_code=${COUNTRY}`;

  const [trendRes, hashtagRes] = await Promise.allSettled([
    fetch(trendUrl,   { headers: BROWSER_HEADERS }),
    fetch(hashtagUrl, { headers: BROWSER_HEADERS }),
  ]);

  if (trendRes.status !== 'fulfilled' || !trendRes.value.ok) {
    throw new Error(`trend list HTTP ${trendRes.status === 'fulfilled' ? trendRes.value.status : 'reject'}`);
  }

  const trendJson = await trendRes.value.json();
  const list = trendJson?.data?.list || trendJson?.data?.items || [];

  let hashtags = [];
  if (hashtagRes.status === 'fulfilled' && hashtagRes.value.ok) {
    try {
      const j = await hashtagRes.value.json();
      hashtags = j?.data?.list || j?.data?.items || [];
    } catch {/* tolerate */}
  }

  return { path: 'api', trends: list, hashtags };
}

async function tryHtml() {
  // Public inspiration page; embeds Next.js __NEXT_DATA__ JSON.
  const url = 'https://www.tiktok.com/creative-center/inspiration/popular-music/pc/en';
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`creative-center page HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found');
  let next;
  try { next = JSON.parse(m[1]); } catch (err) { throw new Error('__NEXT_DATA__ parse failed: ' + err.message); }

  // The shape is best-effort; the Creative Center page reshuffles frequently.
  const props = next?.props?.pageProps || {};
  const trends   = props.musicList     || props.trendList    || props.list || [];
  const hashtags = props.hashtagList   || props.tags         || [];
  return { path: 'html', trends, hashtags };
}

function normalizeTrend(t) {
  return {
    title:     t.title || t.music_title || t.name || t.keyword || '(unknown)',
    handle:    t.author || t.author_name || null,
    plays:     t.play_count ?? t.video_count ?? t.popularity ?? null,
    growth:    t.growth_rate ?? t.rank_diff ?? null,
    sample_url:t.sample_url || t.url || null,
  };
}

function normalizeHashtag(h) {
  return {
    tag:        h.hashtag_name || h.name || h.tag || '(unknown)',
    views:      h.view_count   || h.video_count || h.views || null,
    rank:       h.rank         || null,
    growth:     h.rank_diff    || null,
  };
}

export async function fetchTikTokTrends() {
  const captured_at = new Date().toISOString();
  let raw, path;
  try {
    raw = await tryApi();
    path = 'api';
  } catch (apiErr) {
    try {
      raw = await tryHtml();
      path = 'html';
    } catch (htmlErr) {
      return {
        source:     'tiktok_creative_center',
        status:     'error',
        captured_at,
        message:    `api: ${apiErr.message} | html: ${htmlErr.message}`,
        trending_sounds:   [],
        trending_hashtags: [],
        format_signals:    [],
      };
    }
  }

  const trending_sounds   = (raw.trends   || []).slice(0, 10).map(normalizeTrend);
  const trending_hashtags = (raw.hashtags || []).slice(0, 20).map(normalizeHashtag);

  // Format signals are derived heuristics — when sound titles or hashtags
  // reveal an obvious structural pattern, surface it here so the decomposer
  // has something concrete to chew on.
  const format_signals = [];
  for (const t of trending_sounds) {
    if (/pov/i.test(t.title))             format_signals.push({ pattern: 'pov_hook',       evidence: t.title });
    if (/(types of|tell me you|me when)/i.test(t.title)) format_signals.push({ pattern: 'identity_callout', evidence: t.title });
    if (/(day in the life|24 hours)/i.test(t.title)) format_signals.push({ pattern: 'day_in_life', evidence: t.title });
  }

  return {
    source:     'tiktok_creative_center',
    status:     'ok',
    captured_at,
    path,
    trending_sounds,
    trending_hashtags,
    format_signals,
    raw_data:   raw,
  };
}
