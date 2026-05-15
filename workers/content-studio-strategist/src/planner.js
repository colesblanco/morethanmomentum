/**
 * Strategist Agent — Claude API call + D1 persistence.
 *
 * Why prompt caching:
 *   The system prompt is ~3-4k tokens of stable brand voice. The user prompt
 *   is ~1k tokens of variable per-week context. Wrapping the system block in
 *   { cache_control: { type: 'ephemeral' } } gives a ~90% input-token discount
 *   on every call within the 5-minute cache window — meaningful when the
 *   cascade endpoint fires multiple times in a single edit session.
 */

import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL  = 'claude-sonnet-4-6';
const MAX_TOKENS     = 8000;
const TENANT_ID      = 'mtm';

/* ─── Brand voice fetcher ────────────────────────────────────────────────── */
async function fetchBrandVoice(env) {
  const url = `${env.PAGES_BASE_URL.replace(/\/$/, '')}/tools/content-studio/config/brand-voice.json`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`brand-voice.json fetch failed: HTTP ${res.status}`);
  return res.json();
}

/* ─── D1 helpers ─────────────────────────────────────────────────────────── */
async function loadAnalytics(env) {
  // The MCP server is a runtime dep we'd rather avoid here; the Worker reads
  // directly from D1 where the latest snapshot is stored. For Phase 2, we fall
  // back to a placeholder since the snapshot table isn't seeded yet — the
  // Pages Function /analytics-snapshot remains the source of live GHL data.
  // Future: cron the analytics-snapshot into D1 and read from there.
  try {
    if (!env.PAGES_BASE_URL) return { newLeads: 0, topSource: '—', openPipelineValue: 0, openDeals: 0 };
    const url = `${env.PAGES_BASE_URL.replace(/\/$/, '')}/api/content-studio/analytics-snapshot`;
    const res = await fetch(url);
    if (!res.ok) return { newLeads: 0, topSource: '—', openPipelineValue: 0, openDeals: 0 };
    const data = await res.json();
    const p = data.pipeline || {};
    return {
      newLeads:          p.totalLeads        ?? 0,
      topSource:         data.topSource      ?? '—',
      openPipelineValue: p.openPipelineValue ?? 0,
      openDeals:         p.openDeals         ?? 0,
    };
  } catch {
    return { newLeads: 0, topSource: '—', openPipelineValue: 0, openDeals: 0 };
  }
}

async function loadRetro(db) {
  const r = await db.prepare(
    `SELECT week_start, key_learnings, asset_gaps
       FROM retrospectives
      WHERE tenant_id = ?
      ORDER BY week_start DESC
      LIMIT 1`
  ).bind(TENANT_ID).first();
  return r || null;
}

async function loadFormats(db, limit = 10) {
  const r = await db.prepare(
    `SELECT id, hook_type, structure_summary, why_it_works, mtm_adaptations,
            times_used, performance_avg
       FROM format_library
      WHERE tenant_id = ?
      ORDER BY performance_avg DESC NULLS LAST, times_used ASC
      LIMIT ?`
  ).bind(TENANT_ID, limit).all();
  return r.results || [];
}

/* ─── Date helpers ───────────────────────────────────────────────────────── */
export function isoMonday(d = new Date()) {
  const dt  = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;          // 1..7, Mon..Sun
  if (day !== 1) dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().slice(0, 10);
}

/* ─── Claude call ────────────────────────────────────────────────────────── */
async function callClaude(env, system, userPrompt) {
  const model = env.STRATEGIST_MODEL || DEFAULT_MODEL;

  const res = await fetch(ANTHROPIC_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Empty Anthropic response');

  // Sanitize the raw text before parsing. Claude occasionally emits smart
  // quotes / em-dashes / ellipsis inside string values — JSON.parse handles
  // those fine in well-formed strings, but they corrupt downstream rendering
  // and (more importantly) UTF-8 transport through some intermediaries.
  // Strip markdown fences and normalize the offenders to ASCII equivalents.
  const sanitized = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/[‘’]/g, "'")   // smart single quotes → straight
    .replace(/[“”]/g, '"')   // smart double quotes → straight
    .replace(/—/g, '--')          // em dash
    .replace(/–/g, '-')           // en dash
    .replace(/…/g, '...')         // ellipsis
    .trim();

  try {
    return { plan: JSON.parse(sanitized), usage: data.usage || null, model };
  } catch (err) {
    throw new Error(`Plan JSON parse failed: ${err.message}. Raw head: ${sanitized.slice(0, 200)}`);
  }
}

/* ─── D1 write helpers ───────────────────────────────────────────────────── */
async function upsertPlan(db, plan) {
  // One plan per (tenant, week_start). If already exists, archive it and insert new.
  const existing = await db.prepare(
    `SELECT id FROM weekly_plans WHERE tenant_id = ? AND week_start = ?`
  ).bind(TENANT_ID, plan.week_start).first();

  if (existing) {
    await db.prepare(
      `UPDATE weekly_plans
          SET status = 'archived', updated_at = datetime('now')
        WHERE id = ?`
    ).bind(existing.id).run();
  }

  const ins = await db.prepare(
    `INSERT INTO weekly_plans
       (tenant_id, week_start, status, strategy_summary, monday_brief, wednesday_brief)
     VALUES (?, ?, 'draft', ?, ?, ?)`
  ).bind(
    TENANT_ID,
    plan.week_start,
    plan.strategy_summary || '',
    JSON.stringify(plan.monday_brief    || { required: false, shots: [] }),
    JSON.stringify(plan.wednesday_brief || { required: false, shots: [] }),
  ).run();

  return ins.meta.last_row_id;
}

async function insertPosts(db, planId, posts) {
  const stmt = db.prepare(
    `INSERT INTO posts
       (tenant_id, plan_id, day_of_week, post_time, platform, hook, caption,
        hashtags, format_id, asset_status, edit_state,
        pillar_id, content_type, needs_filming, decision_log)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'green', ?, ?, ?, ?)`
  );
  const ops = posts.map(p => stmt.bind(
    TENANT_ID,
    planId,
    String(p.day_of_week || '').toLowerCase(),
    p.post_time     || '',
    p.platform      || '',
    p.hook          || '',
    p.caption       || '',
    JSON.stringify(p.hashtags || []),
    p.format_id ?? null,
    p.pillar_id     || null,
    p.content_type  || null,
    p.needs_filming ? 1 : 0,
    p.decision_log  || '',
  ));
  return db.batch(ops);
}

/* ─── Public: full-week generation ───────────────────────────────────────── */
export async function generateWeek(env, options = {}) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured on Worker');
  if (!env.CONTENT_STUDIO_DB) throw new Error('CONTENT_STUDIO_DB binding missing');

  const db = env.CONTENT_STUDIO_DB;

  const weekStart = options.weekStart || isoMonday(new Date());
  const [brand, analytics, retro, formats] = await Promise.all([
    fetchBrandVoice(env),
    loadAnalytics(env),
    loadRetro(db),
    loadFormats(db, 10),
  ]);

  const system = buildSystemPrompt(brand);
  const user   = buildUserPrompt({
    weekStart, analytics, retro, formats, mode: { type: 'full' },
  });

  const { plan, usage, model } = await callClaude(env, system, user);
  if (!plan.week_start) plan.week_start = weekStart;

  const planId = await upsertPlan(db, plan);
  await insertPosts(db, planId, plan.posts || []);

  return {
    success:    true,
    plan_id:    planId,
    week_start: plan.week_start,
    post_count: (plan.posts || []).length,
    model,
    usage,
  };
}

/* ─── Public: cascade regeneration ───────────────────────────────────────── */
export async function cascade(env, { planId, lockedPosts, targetDays }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured on Worker');
  if (!env.CONTENT_STUDIO_DB) throw new Error('CONTENT_STUDIO_DB binding missing');
  if (!planId || !targetDays?.length) {
    return { success: true, regenerated: 0, note: 'no green downstream posts' };
  }

  const db = env.CONTENT_STUDIO_DB;
  const planRow = await db.prepare(
    `SELECT week_start FROM weekly_plans WHERE id = ? AND tenant_id = ?`
  ).bind(planId, TENANT_ID).first();
  if (!planRow) throw new Error(`plan ${planId} not found for tenant ${TENANT_ID}`);

  const [brand, analytics, retro, formats] = await Promise.all([
    fetchBrandVoice(env),
    loadAnalytics(env),
    loadRetro(db),
    loadFormats(db, 10),
  ]);

  const system = buildSystemPrompt(brand);
  const user   = buildUserPrompt({
    weekStart: planRow.week_start,
    analytics, retro, formats,
    mode: { type: 'cascade', lockedPosts: lockedPosts || [], targetDays },
  });

  const { plan, usage, model } = await callClaude(env, system, user);

  // Update only the green posts whose day_of_week is in targetDays.
  const updateStmt = db.prepare(
    `UPDATE posts
        SET post_time     = ?,
            platform      = ?,
            hook          = ?,
            caption       = ?,
            hashtags      = ?,
            format_id     = ?,
            pillar_id     = ?,
            content_type  = ?,
            needs_filming = ?,
            decision_log  = ?,
            updated_at    = datetime('now')
      WHERE plan_id     = ?
        AND tenant_id   = ?
        AND day_of_week = ?
        AND edit_state  = 'green'`
  );

  const ops = (plan.posts || [])
    .filter(p => targetDays.includes(String(p.day_of_week || '').toLowerCase()))
    .map(p => updateStmt.bind(
      p.post_time     || '',
      p.platform      || '',
      p.hook          || '',
      p.caption       || '',
      JSON.stringify(p.hashtags || []),
      p.format_id ?? null,
      p.pillar_id     || null,
      p.content_type  || null,
      p.needs_filming ? 1 : 0,
      p.decision_log  || '',
      planId, TENANT_ID,
      String(p.day_of_week || '').toLowerCase(),
    ));

  if (ops.length) await db.batch(ops);

  return {
    success:     true,
    regenerated: ops.length,
    target_days: targetDays,
    model,
    usage,
  };
}
