/**
 * POST /api/content-studio/trend-scout
 *
 * Manual trigger for the Scout Worker — surfaces in Settings → "Run Scout Now".
 * Returns the worker's pipeline summary for inline display.
 *
 * GET /api/content-studio/trend-scout returns the most recent scout_runs row
 * (status panel in Settings + INSIGHTS Trend Digest header line).
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_DB          D1 binding
 *   CONTENT_STUDIO_SCOUT_URL   workers.dev URL of the Scout Worker (set in Pages env)
 *   MTM_INTERNAL_SECRET        shared secret (same value as Strategist)
 */

const TENANT_ID = 'mtm';

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({
      status: 'not_configured',
      message: 'CONTENT_STUDIO_DB binding missing.',
      latest_run: null,
      formats_added_this_month: 0,
    }), { status: 200, headers: corsHeaders });
  }

  try {
    const latest = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT id, run_at, sources_checked, new_formats_added, trends_captured, errors, duration_ms
         FROM scout_runs
        WHERE tenant_id = ?
        ORDER BY run_at DESC
        LIMIT 1`
    ).bind(TENANT_ID).first();

    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const monthIso = start.toISOString().slice(0, 19).replace('T', ' ');

    const counts = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT COUNT(*) AS n FROM format_library
        WHERE tenant_id = ? AND deleted_at IS NULL AND captured_at >= ?`
    ).bind(TENANT_ID, monthIso).first();

    // Most recent digest row per source — keep the panel snappy by only
    // hydrating one row per source (the latest week's).
    const digestsRows = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT t.source, t.digest_data, t.mtm_applications, t.format_entries_created, t.week_start, t.created_at
         FROM trend_digests t
         JOIN (SELECT source, MAX(created_at) AS m FROM trend_digests WHERE tenant_id = ? GROUP BY source) latest
           ON latest.source = t.source AND latest.m = t.created_at
        WHERE t.tenant_id = ?`
    ).bind(TENANT_ID, TENANT_ID).all();

    const digests = {};
    for (const row of (digestsRows.results || [])) {
      digests[row.source] = {
        source:                  row.source,
        week_start:              row.week_start,
        created_at:              row.created_at,
        format_entries_created:  row.format_entries_created,
        payload:                 safeParse(row.digest_data, null),
        mtm_applications:        safeParse(row.mtm_applications, null),
      };
    }

    return new Response(JSON.stringify({
      status: 'ok',
      latest_run: latest ? {
        ...latest,
        sources_checked: safeParse(latest.sources_checked, []),
        errors:          safeParse(latest.errors, null),
      } : null,
      formats_added_this_month: counts?.n || 0,
      digests,
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message, latest_run: null }),
      { status: 200, headers: corsHeaders });
  }
}

export async function onRequestPost(context) {
  const { env } = context;

  if (!env.CONTENT_STUDIO_SCOUT_URL || !env.MTM_INTERNAL_SECRET) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'Set CONTENT_STUDIO_SCOUT_URL and MTM_INTERNAL_SECRET in Cloudflare Pages env vars.',
    }), { status: 200, headers: corsHeaders });
  }

  const base = env.CONTENT_STUDIO_SCOUT_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/run-scout`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}`,
      },
      body: '{}',
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
