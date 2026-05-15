/**
 * /api/content-studio/analytics-snapshot
 *
 * Thin proxy: fetches GHL monthly snapshot + lead-source breakdown from the
 * MTM MCP Analytics Server. Returns one merged JSON payload for the
 * INSIGHTS → "GHL Pipeline & Lead Source" panel.
 *
 * The existing /api/mtm-analytics endpoint does a broader fan-out (Meta + GA4
 * too). This endpoint is intentionally narrower — only what the Content Studio
 * Insights panel needs — so the panel can render fast even if Meta/GA4 are down.
 *
 * ─── ENV VARS ─────────────────────────────────────────────────────────────
 *   MTM_GHL_SECRET   Bearer token for MTM's entry on the MCP server.
 *
 * Phase 2 will replace the shared-secret session check with real auth.
 */

const MCP_SERVER_URL = 'https://mtm-mcp-server.coleblanco.workers.dev';

async function callMcp(secret, name, args) {
  const res = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name, arguments: args || {} } }),
  });
  if (!res.ok) throw new Error(`MCP ${name} ${res.status}`);
  const data = await res.json();
  const text = data?.result?.content?.[0]?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

const corsHeaders = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control':               'no-store',
};

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.MTM_GHL_SECRET) {
    return new Response(JSON.stringify({ status: 'not_configured',
      message: 'MTM_GHL_SECRET not set in Cloudflare env vars.' }),
      { status: 200, headers: corsHeaders });
  }

  const now      = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const [snapshot, sources] = await Promise.allSettled([
      callMcp(env.MTM_GHL_SECRET, 'get_monthly_snapshot', { month: monthStr }),
      callMcp(env.MTM_GHL_SECRET, 'get_lead_source_breakdown', { limit: 8 }),
    ]);

    const snap = snapshot.status === 'fulfilled' ? snapshot.value : {};
    const src  = sources.status  === 'fulfilled' ? sources.value  : {};

    const payload = {
      status: 'ok',
      period: { month: now.getMonth() + 1, year: now.getFullYear(),
                label: `${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}` },
      pipeline: {
        totalLeads:        snap.newLeads          ?? snap.totalLeads         ?? 0,
        wonDeals:          snap.wonDeals          ?? 0,
        wonRevenue:        snap.wonRevenue        ?? snap.totalWonRevenue    ?? 0,
        lostDeals:         snap.lostDeals         ?? 0,
        openDeals:         snap.openDeals         ?? snap.openOpportunities  ?? 0,
        openPipelineValue: snap.openPipelineValue ?? snap.pipelineValue      ?? 0,
      },
      leadSources: src.sources || src.leadSources || [],
      topSource:   snap.topSource || (src.sources?.[0]?.source) || '—',
    };

    if (snapshot.status === 'rejected' && sources.status === 'rejected') {
      payload.status  = 'error';
      payload.message = 'Could not reach MTM MCP Analytics Server.';
    }

    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }),
      { status: 200, headers: corsHeaders });
  }
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
