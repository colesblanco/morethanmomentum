/**
 * /api/content-studio/format-library
 *
 * Reads the format_library table from the mtm_content_studio D1 database.
 * Multi-tenant: filters by tenant_id ('mtm' for v1).
 *
 * ─── ENV BINDING ──────────────────────────────────────────────────────────
 *   CONTENT_STUDIO_DB   D1 binding → mtm_content_studio
 *   (Configure in Cloudflare Pages → Settings → Functions → D1 Bindings)
 */

const TENANT_ID = 'mtm';

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({
      status:  'not_configured',
      message: 'CONTENT_STUDIO_DB binding not set. Bind D1 db "mtm_content_studio" in Cloudflare Pages settings.',
      formats: [],
    }), { status: 200, headers: corsHeaders });
  }

  try {
    const result = await env.CONTENT_STUDIO_DB.prepare(
      `SELECT id, source_account, source_post_url, captured_at, hook_type,
              structure_summary, pacing_notes, why_it_works, mtm_adaptations,
              times_used, performance_avg, captured_via
         FROM format_library
        WHERE tenant_id = ? AND deleted_at IS NULL
        ORDER BY performance_avg DESC NULLS LAST, captured_at DESC
        LIMIT 50`
    ).bind(TENANT_ID).all();

    const formats = (result.results || []).map(row => ({
      ...row,
      mtm_adaptations: safeParse(row.mtm_adaptations),
    }));

    return new Response(JSON.stringify({ status: 'ok', count: formats.length, formats }),
      { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message, formats: [] }),
      { status: 200, headers: corsHeaders });
  }
}

function safeParse(s) {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

/**
 * DELETE — body { id }. Soft delete (sets deleted_at). Filters by tenant.
 * PATCH  — body { id, times_used?, performance_avg? }. Called by the
 *          Strategist after using a format in a generated plan.
 */
export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({ status: 'not_configured' }), { status: 200, headers: corsHeaders });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.id) return new Response(JSON.stringify({ status: 'error', message: 'id required' }), { status: 200, headers: corsHeaders });

  try {
    const res = await env.CONTENT_STUDIO_DB.prepare(
      `UPDATE format_library
          SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(body.id, TENANT_ID).run();
    return new Response(JSON.stringify({ status: 'ok', deleted: res.meta.changes || 0 }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), { status: 200, headers: corsHeaders });
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.CONTENT_STUDIO_DB) {
    return new Response(JSON.stringify({ status: 'not_configured' }), { status: 200, headers: corsHeaders });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.id) return new Response(JSON.stringify({ status: 'error', message: 'id required' }), { status: 200, headers: corsHeaders });

  const sets = [];
  const args = [];
  if (typeof body.times_used      === 'number') { sets.push('times_used = ?');       args.push(body.times_used); }
  if (typeof body.performance_avg === 'number') { sets.push('performance_avg = ?');  args.push(body.performance_avg); }
  if (typeof body.increment_used  === 'boolean' && body.increment_used) {
    sets.push('times_used = COALESCE(times_used, 0) + 1');
  }
  if (!sets.length) {
    return new Response(JSON.stringify({ status: 'error', message: 'no patchable fields provided' }), { status: 200, headers: corsHeaders });
  }
  sets.push("updated_at = datetime('now')");

  try {
    args.push(body.id, TENANT_ID);
    const res = await env.CONTENT_STUDIO_DB.prepare(
      `UPDATE format_library SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(...args).run();
    return new Response(JSON.stringify({ status: 'ok', updated: res.meta.changes || 0 }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), { status: 200, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
