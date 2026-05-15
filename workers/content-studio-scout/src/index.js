/**
 * Trend Scout Worker — HTTP + cron entrypoint.
 *
 * Endpoints (auth: Authorization: Bearer ${MTM_INTERNAL_SECRET}, except /health):
 *
 *   GET  /health     → { status: 'ok', version, phase_3b_enabled }
 *   POST /run-scout  → run the full scout pipeline once; returns the summary
 *   POST /decompose  → decompose a single format (used by Format Capture UI)
 *                      Body: { description, url, source_account, persist? }
 *
 * Cron: Friday 20:30 UTC — runs the same pipeline as POST /run-scout.
 *
 * Pipeline:
 *   1. Insert scout_runs row (status pending)
 *   2. Run TikTok + Google Trends in parallel
 *   3. Run Instagram scout (no-op if INSTAGRAM_SCOUT_ENABLED != 'true')
 *   4. For each healthy source, decompose top signals into format_library
 *   5. Write trend_digests rows (one per source)
 *   6. Patch the scout_runs row with summary
 *
 * Any per-source failure is captured in scout_runs.errors but doesn't abort
 * the pipeline.
 */

import { fetchTikTokTrends }    from './tiktok.js';
import { fetchGoogleTrends }    from './google-trends.js';
import { runInstagramScout }    from './instagram.js';
import { decomposeAndStore, decomposeFormat } from './decomposer.js';

const TENANT_ID = 'mtm';

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

function isoMonday(d = new Date()) {
  const dt  = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  if (day !== 1) dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().slice(0, 10);
}

function isEnabled(env) {
  return String(env.INSTAGRAM_SCOUT_ENABLED || '').toLowerCase() === 'true';
}

/* ── Top-signal selection ──────────────────────────────────────────────── */
function topTikTokSignals(payload) {
  const out = [];
  for (const t of (payload.trending_sounds || []).slice(0, 5)) {
    out.push({
      description: `TikTok trending sound: "${t.title}" -- plays: ${t.plays ?? '?'}. Author: ${t.handle || 'unknown'}.`,
      url:         t.sample_url || null,
      source_account: t.handle ? `@${t.handle}` : null,
    });
  }
  for (const sig of (payload.format_signals || []).slice(0, 3)) {
    out.push({
      description: `TikTok format signal: pattern=${sig.pattern}, evidence=${sig.evidence}`,
      url: null, source_account: null,
    });
  }
  return out;
}

function topGoogleSignals(payload) {
  return (payload.pillar_mapping || []).slice(0, 5).map(t => ({
    description: `Google rising query: "${t.title}" -- mapped to ${t.pillar}. Traffic: ${t.traffic || '?'}.`,
    url: null, source_account: null,
  }));
}

/* ── Pipeline ──────────────────────────────────────────────────────────── */
async function runFullPipeline(env) {
  const db = env.CONTENT_STUDIO_DB;
  if (!db) throw new Error('CONTENT_STUDIO_DB binding missing');

  const startedAt = Date.now();
  const week_start = isoMonday(new Date());
  const sources_attempted = ['tiktok_creative_center', 'google_trends'];
  if (isEnabled(env)) sources_attempted.push('instagram_scout');

  // Insert the run row up front so we can patch it on completion.
  const runIns = await db.prepare(
    `INSERT INTO scout_runs (tenant_id, sources_checked) VALUES (?, ?)`
  ).bind(TENANT_ID, JSON.stringify(sources_attempted)).run();
  const run_id = runIns.meta.last_row_id;

  const errors = [];
  const digestRows = [];
  let new_formats_added = 0;
  let trends_captured  = 0;

  // 1+2. Public APIs in parallel.
  const [tiktokRes, googleRes] = await Promise.allSettled([
    fetchTikTokTrends(),
    fetchGoogleTrends(),
  ]);

  const tiktok = tiktokRes.status === 'fulfilled' ? tiktokRes.value : { source: 'tiktok_creative_center', status: 'error', message: tiktokRes.reason?.message };
  const google = googleRes.status === 'fulfilled' ? googleRes.value : { source: 'google_trends',          status: 'error', message: googleRes.reason?.message };

  trends_captured += (tiktok.trending_sounds?.length   || 0) + (tiktok.trending_hashtags?.length || 0);
  trends_captured += (google.trending_topics?.length   || 0);

  // 3. Instagram (gated).
  const instagram = await runInstagramScout(env).catch(err => ({
    source: 'instagram_scout', status: 'error', message: err.message,
  }));
  if (instagram.formats_added) new_formats_added += instagram.formats_added;
  if (instagram.errors)        errors.push(...instagram.errors);

  // 4. Decompose top signals from each healthy public source.
  const signalGroups = [];
  if (tiktok.status === 'ok') signalGroups.push({ source: 'scout_tiktok', signals: topTikTokSignals(tiktok) });
  if (google.status === 'ok') signalGroups.push({ source: 'scout_google', signals: topGoogleSignals(google) });

  for (const group of signalGroups) {
    for (const sig of group.signals) {
      try {
        const stored = await decomposeAndStore(env, sig, group.source);
        if (stored?.confidence !== 'low') new_formats_added += 1;
      } catch (err) {
        errors.push(`${group.source} decompose: ${err.message}`);
      }
    }
  }

  // 5. Trend digests — one row per source, keep the raw payload.
  for (const payload of [tiktok, google, instagram]) {
    if (!payload || payload.status === 'disabled') continue;
    try {
      const ins = await db.prepare(
        `INSERT INTO trend_digests
           (tenant_id, week_start, source, digest_data, mtm_applications, format_entries_created)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        TENANT_ID,
        week_start,
        payload.source,
        JSON.stringify(payload),
        JSON.stringify(payload.pillar_mapping || payload.format_signals || null),
        payload.formats_added || 0,
      ).run();
      digestRows.push({ source: payload.source, id: ins.meta.last_row_id });
    } catch (err) {
      errors.push(`digest write ${payload?.source || 'unknown'}: ${err.message}`);
    }
  }

  const duration_ms = Date.now() - startedAt;

  // 6. Finalize scout_runs row.
  await db.prepare(
    `UPDATE scout_runs
        SET new_formats_added = ?,
            trends_captured   = ?,
            errors            = ?,
            duration_ms       = ?
      WHERE id = ?`
  ).bind(
    new_formats_added,
    trends_captured,
    errors.length ? JSON.stringify(errors) : null,
    duration_ms,
    run_id,
  ).run();

  return {
    success:           true,
    run_id,
    week_start,
    sources_attempted,
    new_formats_added,
    trends_captured,
    duration_ms,
    digests:           digestRows,
    tiktok_status:     tiktok.status,
    google_status:     google.status,
    instagram_status:  instagram.status,
    instagram_message: instagram.message || null,
    errors:            errors.length ? errors : null,
  };
}

/* ── HTTP + cron surface ───────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        version: '3.0.0',
        phase_3b_enabled: isEnabled(env),
      });
    }

    if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (url.pathname === '/run-scout' && request.method === 'POST') {
        const result = await runFullPipeline(env);
        return json(result);
      }

      if (url.pathname === '/decompose' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.description && !body.url) return json({ error: 'description or url required' }, 400);

        if (body.persist === false) {
          const entry = await decomposeFormat(env, body);
          return json({ success: true, entry });
        }
        const stored = await decomposeAndStore(env, body, body.captured_via || 'manual');
        return json({ success: true, entry: stored });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ success: false, error: err.message }, 200);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const summary = await runFullPipeline(env);
        console.log('scout cron ok:', JSON.stringify(summary));
      } catch (err) {
        console.error('scout cron failed:', err.message);
      }
    })());
  },
};
