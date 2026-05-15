/**
 * /api/content-studio/weekly-plan
 *
 *   GET  ?week_start=YYYY-MM-DD   → { plan, posts }  (week_start optional; defaults to current ISO Monday)
 *   POST { force: true, week_start? } → triggers the Strategist Worker to generate.
 *
 * The POST shape mirrors what the Worker's /generate endpoint accepts so the
 * frontend can re-use the same payload.
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_DB              D1 binding → mtm_content_studio
 *   CONTENT_STUDIO_STRATEGIST_URL  workers.dev URL of the Strategist Worker
 *   MTM_INTERNAL_SECRET            shared secret for Pages → Worker auth
 */

const TENANT_ID = 'mtm';

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

function isoMonday(d = new Date()) {
  const dt  = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  if (day !== 1) dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().slice(0, 10);
}

function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'CONTENT_STUDIO_DB binding missing.',
      plan: null, posts: [],
    }), { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const weekStart = url.searchParams.get('week_start') || isoMonday();

  try {
    const plan = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT id, week_start, status, strategy_summary, monday_brief, wednesday_brief, created_at, updated_at
         FROM weekly_plans
        WHERE tenant_id = ? AND week_start = ? AND status != 'archived'
        ORDER BY id DESC
        LIMIT 1`
    ).bind(TENANT_ID, weekStart).first();

    if (!plan) {
      return new Response(JSON.stringify({ status: 'ok', week_start: weekStart, plan: null, posts: [] }),
        { status: 200, headers: corsHeaders });
    }

    const posts = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT id, day_of_week, post_time, platform, hook, caption, hashtags,
              format_id, asset_status, edit_state, pillar_id, content_type,
              needs_filming, decision_log, ghl_post_id, updated_at
         FROM posts
        WHERE plan_id = ? AND tenant_id = ?
        ORDER BY post_time ASC`
    ).bind(plan.id, TENANT_ID).all();

    const hydrated = (posts.results || [])
      .map(p => ({
        ...p,
        hashtags:      safeParse(p.hashtags, []),
        needs_filming: !!p.needs_filming,
      }))
      .sort((a, b) => (DAY_ORDER[a.day_of_week] || 9) - (DAY_ORDER[b.day_of_week] || 9));

    return new Response(JSON.stringify({
      status: 'ok',
      week_start: weekStart,
      plan: {
        ...plan,
        monday_brief:    safeParse(plan.monday_brief,    { required: false, shots: [] }),
        wednesday_brief: safeParse(plan.wednesday_brief, { required: false, shots: [] }),
      },
      posts: hydrated,
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message, plan: null, posts: [] }),
      { status: 200, headers: corsHeaders });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.CONTENT_STUDIO_STRATEGIST_URL || !env.MTM_INTERNAL_SECRET) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'CONTENT_STUDIO_STRATEGIST_URL and MTM_INTERNAL_SECRET must be set in Cloudflare Pages env vars.',
    }), { status: 200, headers: corsHeaders });
  }

  const body = await request.json().catch(() => ({}));
  const base = env.CONTENT_STUDIO_STRATEGIST_URL.replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/generate`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ week_start: body.week_start }),
    });
    const payload = await res.json();
    return new Response(JSON.stringify(payload), { status: res.ok ? 200 : 200, headers: corsHeaders });
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
