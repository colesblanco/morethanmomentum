/**
 * Strategist Worker — HTTP + cron entrypoint.
 *
 * Endpoints (all require Authorization: Bearer ${MTM_INTERNAL_SECRET}
 *           except /health):
 *
 *   GET  /health                → { status: 'ok' }
 *   POST /generate              → full-week generation. Body: { week_start? }
 *   POST /cascade               → partial regeneration. Body: {
 *                                   plan_id, locked_posts: [...], target_days: [...]
 *                                 }
 *
 * Cron (Sunday 20:00 UTC = 16:00 ET, configured in wrangler.toml):
 *   Generates the upcoming Monday's week. If a plan for that week already
 *   exists in 'draft' state, the previous version is archived.
 */

import { generateWeek, cascade, isoMonday } from './planner.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authed(request, env) {
  if (!env.MTM_INTERNAL_SECRET) return false;
  return request.headers.get('Authorization') === `Bearer ${env.MTM_INTERNAL_SECRET}`;
}

function nextWeekMonday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return isoMonday(d);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: '1.0.0' });
    }

    if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (url.pathname === '/generate' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await generateWeek(env, { weekStart: body.week_start });
        return json(result);
      }

      if (url.pathname === '/cascade' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.plan_id) return json({ error: 'plan_id required' }, 400);
        const result = await cascade(env, {
          planId:      body.plan_id,
          lockedPosts: body.locked_posts || [],
          targetDays:  (body.target_days || []).map(d => String(d).toLowerCase()),
        });
        return json(result);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ success: false, error: err.message }, 200);
    }
  },

  async scheduled(event, env, ctx) {
    // Sunday 20:00 UTC: generate the upcoming week (Monday +1 day after the
    // Saturday/Sunday boundary). isoMonday on now gives current week's Monday;
    // we want the *next* Monday.
    ctx.waitUntil((async () => {
      try {
        const weekStart = nextWeekMonday();
        const result = await generateWeek(env, { weekStart });
        console.log('cron generateWeek ok:', JSON.stringify(result));
      } catch (err) {
        console.error('cron generateWeek failed:', err.message);
      }
    })());
  },
};
