/**
 * Google Trends reader.
 *
 * Two surfaces:
 *   1. Daily Trending Searches RSS (no auth, no rate limit issues for moderate use):
 *        https://trends.google.com/trends/trendingsearches/daily/rss?geo=US
 *   2. Explore endpoint for category rising queries (Business / Marketing / Tech):
 *        https://trends.google.com/trends/api/explore?... — response is prefixed
 *        with ")]}'," which we strip before parsing.
 *
 * Returns a structured payload with topics mapped to MTM content pillars.
 * Failures on either surface are tolerated; we return what we have.
 */

const RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';

const CATEGORIES = [
  { id: 12,  label: 'Business & Industrial' },
  { id: 958, label: 'Marketing'             },
  { id: 5,   label: 'Computers & Electronics' },
];

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Decode a handful of common RSS entities. Workers has no DOMParser by default. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse Google Trends daily RSS. Returns an array of { title, traffic, link }. */
function parseRss(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const fieldRe = (name) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');

  for (const block of xml.match(itemRe) || []) {
    const title   = block.match(fieldRe('title'))?.[1] || '';
    const link    = block.match(fieldRe('link'))?.[1] || '';
    const traffic = block.match(fieldRe('ht:approx_traffic'))?.[1] || '';
    items.push({
      title:   decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, '').trim()),
      link:    decodeEntities(link.trim()),
      traffic: decodeEntities(traffic.trim()),
    });
  }
  return items;
}

async function fetchDailyRss() {
  const res = await fetch(RSS_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`rss HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml).slice(0, 15);
}

async function fetchCategoryRising(category) {
  const req = encodeURIComponent(JSON.stringify({
    comparisonItem: [{ keyword: '', geo: 'US', time: 'now 7-d' }],
    category:       category.id,
    property:       '',
  }));
  const url = `https://trends.google.com/trends/api/explore?hl=en-US&tz=-300&req=${req}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`explore ${category.id} HTTP ${res.status}`);
  const raw = await res.text();
  // Google prefixes the JSON with ")]}'," to prevent JSON hijacking; strip it.
  const json = raw.replace(/^\)\]\}',?\s*/, '');
  try { return JSON.parse(json); } catch (err) {
    throw new Error(`explore ${category.id} parse: ${err.message}`);
  }
}

/** Map a topic title to an MTM pillar based on keyword heuristics. */
function pillarFor(title) {
  const t = title.toLowerCase();
  if (/(ai|automation|chatgpt|claude|gpt|tool|software|tech)/.test(t))           return 'pillar_02';
  if (/(meme|skit|funny|viral|pov|relatable|day in the life)/.test(t))           return 'pillar_03';
  if (/(small business|local|owner|entrepreneur|marketing|lead|sales|growth)/.test(t)) return 'pillar_01';
  return null;
}

export async function fetchGoogleTrends() {
  const captured_at = new Date().toISOString();

  const [rssRes, ...categoryResults] = await Promise.allSettled([
    fetchDailyRss(),
    ...CATEGORIES.map(c => fetchCategoryRising(c)),
  ]);

  const errors = [];
  const daily  = rssRes.status === 'fulfilled' ? rssRes.value : [];
  if (rssRes.status === 'rejected') errors.push(`rss: ${rssRes.reason?.message || 'unknown'}`);

  const categoryRising = [];
  categoryResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      errors.push(`${CATEGORIES[i].label}: ${r.reason?.message || 'unknown'}`);
      return;
    }
    categoryRising.push({ category: CATEGORIES[i].label, payload: r.value });
  });

  // Build pillar mapping from the daily RSS topics; the explore payloads are
  // kept as raw_data so the decomposer can be pointed at them later.
  const pillar_mapping = daily
    .map(d => ({ title: d.title, traffic: d.traffic, pillar: pillarFor(d.title) }))
    .filter(d => d.pillar);

  return {
    source:     'google_trends',
    status:     errors.length && !daily.length ? 'error' : 'ok',
    captured_at,
    trending_topics:  daily,
    pillar_mapping,
    category_rising:  categoryRising,
    errors:           errors.length ? errors : undefined,
    raw_data:         { daily, categoryRising },
  };
}
