/**
 * PATCH /api/content-studio/post-update
 *
 * Body:
 *   {
 *     post_id: number,
 *     field:   'hook' | 'caption' | 'hashtags' | 'platform' | 'post_time' | 'edit_state' | ...,
 *     value:   any,                                  // hashtags arrives as array
 *     cascade: boolean                               // if true, regen downstream green posts
 *   }
 *
 * Behaviour:
 *   1. Update the post's field. If the change is a content edit (not a pure
 *      state flip like approve/lock), set edit_state = 'yellow' so future
 *      cascades skip it.
 *   2. If cascade && there are downstream green posts after this day, call
 *      the Strategist Worker /cascade with locked context.
 *   3. Return the fresh plan + posts payload.
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_DB
 *   CONTENT_STUDIO_STRATEGIST_URL
 *   MTM_INTERNAL_SECRET
 */

const TENANT_ID = 'mtm';

const ALLOWED_FIELDS = new Set([
  'hook', 'caption', 'hashtags', 'platform', 'post_time',
  'content_type', 'pillar_id', 'format_id', 'needs_filming',
  'edit_state', 'asset_status', 'decision_log',
]);

const CONTENT_FIELDS = new Set([
  'hook', 'caption', 'hashtags', 'platform', 'post_time',
  'content_type', 'pillar_id', 'format_id', 'needs_filming',
]);

const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function normaliseValue(field, value) {
  if (field === 'hashtags') return JSON.stringify(Array.isArray(value) ? value : []);
  if (field === 'needs_filming') return value ? 1 : 0;
  return value;
}

async function loadPlanState(db, planId) {
  const plan = await db.prepare(
    `SELECT id, week_start, status, strategy_summary, monday_brief, wednesday_brief
       FROM weekly_plans WHERE id = ? AND tenant_id = ?`
  ).bind(planId, TENANT_ID).first();

  const posts = await db.prepare(
    `SELECT id, day_of_week, post_time, platform, hook, caption, hashtags,
            format_id, asset_status, edit_state, pillar_id, content_type,
            needs_filming, decision_log, ghl_post_id, updated_at
       FROM posts
      WHERE plan_id = ? AND tenant_id = ?
      ORDER BY post_time ASC`
  ).bind(planId, TENANT_ID).all();

  return {
    plan: plan && {
      ...plan,
      monday_brief:    safeParse(plan.monday_brief,    { required: false, shots: [] }),
      wednesday_brief: safeParse(plan.wednesday_brief, { required: false, shots: [] }),
    },
    posts: (posts.results || [])
      .map(p => ({ ...p, hashtags: safeParse(p.hashtags, []), needs_filming: !!p.needs_filming }))
      .sort((a, b) => (DAY_ORDER[a.day_of_week] || 9) - (DAY_ORDER[b.day_of_week] || 9)),
  };
}

async function handle(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({ status: 'not_configured', message: 'CONTENT_STUDIO_DB binding missing.' }),
      { status: 200, headers: corsHeaders });
  }
  const db = env.CONTENT_STUDIO_DB;

  const body = await request.json().catch(() => ({}));
  const { post_id, field, value, cascade, regen_self } = body;

  if (!post_id || !field) {
    return new Response(JSON.stringify({ status: 'error', message: 'post_id and field required' }),
      { status: 200, headers: corsHeaders });
  }
  if (!ALLOWED_FIELDS.has(field)) {
    return new Response(JSON.stringify({ status: 'error', message: `field "${field}" not editable` }),
      { status: 200, headers: corsHeaders });
  }

  const post = await db.prepare(
    `SELECT id, plan_id, day_of_week, edit_state FROM posts WHERE id = ? AND tenant_id = ?`
  ).bind(post_id, TENANT_ID).first();
  if (!post) {
    return new Response(JSON.stringify({ status: 'error', message: 'post not found' }),
      { status: 200, headers: corsHeaders });
  }
  if (post.edit_state === 'locked' && field !== 'edit_state') {
    return new Response(JSON.stringify({ status: 'error', message: 'post is locked' }),
      { status: 200, headers: corsHeaders });
  }

  const isContentEdit = CONTENT_FIELDS.has(field);
  const normalised    = normaliseValue(field, value);

  // Update the field + bump edit_state to 'yellow' for content edits (unless the
  // user just locked the post via edit_state itself).
  if (isContentEdit) {
    await db.prepare(
      `UPDATE posts
          SET ${field} = ?, edit_state = 'yellow', updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?`
    ).bind(normalised, post_id, TENANT_ID).run();
  } else {
    await db.prepare(
      `UPDATE posts
          SET ${field} = ?, updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?`
    ).bind(normalised, post_id, TENANT_ID).run();
  }

  let cascadeResult = null;

  const wantsCascade = (cascade && isContentEdit) || regen_self;
  if (wantsCascade && env.CONTENT_STUDIO_STRATEGIST_URL && env.MTM_INTERNAL_SECRET) {
    const day = String(post.day_of_week || '').toLowerCase();
    const dayIdx = DAY_ORDER[day] || 0;

    // All posts in the plan, partitioned by downstream + state.
    const all = await db.prepare(
      `SELECT id, day_of_week, post_time, platform, hook, caption, edit_state, pillar_id
         FROM posts
        WHERE plan_id = ? AND tenant_id = ?`
    ).bind(post.plan_id, TENANT_ID).all();

    const rows = all.results || [];

    // regen_self → target only this post's day, lock everything else.
    // Otherwise → target every downstream green day, lock everything else.
    const downstreamGreenDays = regen_self
      ? [day]
      : [...new Set(
          rows
            .filter(r => (DAY_ORDER[String(r.day_of_week).toLowerCase()] || 0) > dayIdx)
            .filter(r => r.edit_state === 'green')
            .map(r => String(r.day_of_week).toLowerCase())
        )];

    // For regen_self we need to flip this post back to green so the worker's
    // UPDATE (filtered by edit_state='green') will actually catch it.
    if (regen_self) {
      await db.prepare(`UPDATE posts SET edit_state = 'green', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
        .bind(post_id, TENANT_ID).run();
    }

    if (downstreamGreenDays.length) {
      const lockedPosts = rows
        .filter(r => regen_self ? r.id !== post_id : r.edit_state !== 'green')
        .map(r => ({
          day_of_week: String(r.day_of_week).toLowerCase(),
          post_time:   r.post_time,
          platform:    r.platform,
          hook:        r.hook,
          caption:     r.caption,
          pillar_id:   r.pillar_id,
          edit_state:  r.edit_state,
        }));

      try {
        const res = await fetch(`${env.CONTENT_STUDIO_STRATEGIST_URL.replace(/\/$/, '')}/cascade`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${env.MTM_INTERNAL_SECRET}`,
          },
          body: JSON.stringify({
            plan_id:      post.plan_id,
            locked_posts: lockedPosts,
            target_days:  downstreamGreenDays,
          }),
        });
        cascadeResult = await res.json();
      } catch (err) {
        cascadeResult = { success: false, error: err.message };
      }
    } else {
      cascadeResult = { success: true, regenerated: 0, note: 'no downstream green posts' };
    }
  }

  const state = await loadPlanState(db, post.plan_id);
  return new Response(JSON.stringify({
    status: 'ok',
    cascade: cascadeResult,
    ...state,
  }), { status: 200, headers: corsHeaders });
}

export const onRequestPatch = handle;
export const onRequestPost  = handle;   // permit POST too for clients that don't send PATCH

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'PATCH, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
