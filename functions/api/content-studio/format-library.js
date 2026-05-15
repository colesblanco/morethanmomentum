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
              times_used, performance_avg
         FROM format_library
        WHERE tenant_id = ?
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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
