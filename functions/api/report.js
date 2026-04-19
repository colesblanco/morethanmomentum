/**
 * MTM Client Report Generator — Pages Function
 * Route: POST /api/report
 *
 * Environment Variables Required (morethanmomentum Pages project):
 *   ANTHROPIC_API_KEY          — MTM Anthropic key (already set)
 *   GOOGLE_SERVICE_ACCOUNT     — Full service account JSON string
 *   GA4_PROPERTY_SNH           — GA4 property ID for SNH
 *   GHL_API_KEY_SNH            — GHL API key for SNH
 *   GHL_LOCATION_ID_SNH        — GHL location ID for SNH
 *   MTM_CLIENT_PROFILES        — KV namespace binding
 *
 * Future clients: store credentials in KV under "client:{clientId}"
 * instead of adding new env vars per client.
 *
 * Accepts:  { clientId: "snh", month: 4, year: 2026 }
 * Returns:  { success: true, report: { client, period, ghl, ga4, takeaways } }
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta';

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await request.json();
    const { clientId, month, year } = body;

    if (!clientId || !month || !year) {
      return new Response(
        JSON.stringify({ error: 'clientId, month, and year are required.' }),
        { status: 400, headers }
      );
    }

    // Resolve client profile — KV first, env var fallback for SNH
    const profile = await resolveClientProfile(clientId.toLowerCase(), env);
    if (!profile) {
      return new Response(
        JSON.stringify({ error: `Client "${clientId}" not found. Add to MTM_CLIENT_PROFILES KV or set env vars.` }),
        { status: 404, headers }
      );
    }

    // Calculate date range for the requested month
    const { startDate, endDate, monthLabel } = getDateRange(parseInt(month), parseInt(year));

    // Run GHL and GA4 in parallel — each fails gracefully
    const [ghlResult, ga4Result] = await Promise.allSettled([
      fetchGHLData(profile, startDate, endDate),
      fetchGA4Data(profile.ga4PropertyId, startDate, endDate, env.GOOGLE_SERVICE_ACCOUNT),
    ]);

    const ghl = ghlResult.status === 'fulfilled'
      ? ghlResult.value
      : { error: ghlResult.reason?.message || 'GHL data unavailable' };

    const ga4 = ga4Result.status === 'fulfilled'
      ? ga4Result.value
      : { error: ga4Result.reason?.message || 'GA4 data unavailable' };

    // Generate Key Takeaways via Claude
    const takeaways = await generateTakeaways(
      { ghl, ga4, clientName: profile.businessName, monthLabel },
      env.ANTHROPIC_API_KEY
    );

    return new Response(JSON.stringify({
      success: true,
      report: {
        client: {
          id: clientId,
          name: profile.businessName,
          industry: profile.industry || 'Unknown',
        },
        period: {
          month: parseInt(month),
          year: parseInt(year),
          label: monthLabel,
          startDate,
          endDate,
        },
        ghl,
        ga4,
        takeaways,
        generatedAt: new Date().toISOString(),
      },
    }), { headers });

  } catch (err) {
    console.error('Report function error:', err.message);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers }
    );
  }
}

// ── CLIENT PROFILE RESOLUTION ────────────────────────────────────────────────
// KV first (future clients via onboarding pipeline)
// Env var fallback (SNH + any manually configured clients)

async function resolveClientProfile(clientId, env) {
  // Try KV first
  try {
    if (env.MTM_CLIENT_PROFILES) {
      const raw = await env.MTM_CLIENT_PROFILES.get(`client:${clientId}`);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('KV profile read failed:', e.message);
  }

  // Env var fallback
  const key = clientId.toUpperCase().replace(/-/g, '_');
  const ghlApiKey     = env[`GHL_API_KEY_${key}`];
  const ghlLocationId = env[`GHL_LOCATION_ID_${key}`];
  const ga4PropertyId = env[`GA4_PROPERTY_${key}`] || null;

  if (!ghlApiKey || !ghlLocationId) return null;

  // Client name map for known env-var clients
  const nameMap = { SNH: 'SNH Golf Carts' };

  return {
    id: clientId,
    businessName: nameMap[key] || clientId,
    industry: 'Unknown',
    ghlApiKey,
    ghlLocationId,
    ga4PropertyId,
  };
}

// ── DATE HELPERS ─────────────────────────────────────────────────────────────

function getDateRange(month, year) {
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 0); // last day of month
  const fmt   = d => d.toISOString().split('T')[0];
  const monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return { startDate: fmt(start), endDate: fmt(end), monthLabel };
}

// ── GHL DATA ─────────────────────────────────────────────────────────────────

async function fetchGHLData(profile, startDate, endDate) {
  const { ghlApiKey, ghlLocationId } = profile;

  const ghlHeaders = {
    'Authorization': `Bearer ${ghlApiKey}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  };

  // Fetch contacts and opportunities in parallel
  const [contactsResp, oppsResp] = await Promise.all([
    fetch(
      `${GHL_BASE}/contacts/?locationId=${ghlLocationId}&limit=100&startDate=${startDate}&endDate=${endDate}`,
      { headers: ghlHeaders }
    ),
    fetch(
      `${GHL_BASE}/opportunities/search?location_id=${ghlLocationId}&limit=100`,
      { headers: ghlHeaders }
    ),
  ]);

  const [contactsData, oppsData] = await Promise.all([
    contactsResp.json(),
    oppsResp.json(),
  ]);

  // ── Process contacts ──
  const contacts = contactsData.contacts || [];
  const totalLeads = contacts.length;

  // Lead source breakdown
  const sourceCounts = {};
  contacts.forEach(c => {
    const source = c.source
      || c.attributionSource?.medium
      || c.attributionSource?.utmSource
      || 'Direct / Unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  const leadSources = Object.entries(sourceCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([source, count]) => ({
      source,
      count,
      percentage: totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0,
    }));

  const topSource = leadSources[0]?.source || 'Unknown';

  // ── Process opportunities ──
  const allOpps = oppsData.opportunities || [];

  const inRange = opp => {
    const d = new Date(opp.createdAt || opp.dateAdded);
    return d >= new Date(startDate) && d <= new Date(endDate + 'T23:59:59Z');
  };

  const wonDeals  = allOpps.filter(o => o.status === 'won'  && inRange(o));
  const lostDeals = allOpps.filter(o => o.status === 'lost' && inRange(o));
  const openDeals = allOpps.filter(o => o.status === 'open');

  const wonRevenue        = wonDeals.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);
  const openPipelineValue = openDeals.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);

  // Stage breakdown for open deals
  const stageMap = {};
  openDeals.forEach(o => {
    const stage = o.pipelineStage?.name || o.stage?.name || 'Unknown';
    stageMap[stage] = (stageMap[stage] || 0) + 1;
  });

  return {
    totalLeads,
    leadSources,
    topSource,
    wonDeals: wonDeals.length,
    lostDeals: lostDeals.length,
    openDeals: openDeals.length,
    wonRevenue: parseFloat(wonRevenue.toFixed(2)),
    openPipelineValue: parseFloat(openPipelineValue.toFixed(2)),
    wonDealsList: wonDeals.slice(0, 10).map(o => ({
      name:     o.contact?.name || o.name || 'Unknown',
      value:    parseFloat(o.monetaryValue) || 0,
      source:   o.contact?.source || 'Unknown',
      closedAt: o.lastStatusChangeAt || o.updatedAt || null,
    })),
    stageBreakdown: Object.entries(stageMap)
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ── GA4 DATA ─────────────────────────────────────────────────────────────────

async function fetchGA4Data(propertyId, startDate, endDate, serviceAccountJson) {
  if (!propertyId || !serviceAccountJson) {
    return { error: 'GA4 not configured for this client' };
  }

  const accessToken = await getGoogleAccessToken(
    serviceAccountJson,
    ['https://www.googleapis.com/auth/analytics.readonly']
  );

  // Run overview + channel breakdown in parallel
  const [overviewResp, channelResp] = await Promise.all([
    fetch(`${GA4_BASE}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
      }),
    }),
    fetch(`${GA4_BASE}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
    }),
  ]);

  const [overview, channels] = await Promise.all([
    overviewResp.json(),
    channelResp.json(),
  ]);

  // Parse overview row
  const metrics = { sessions: 0, users: 0, pageviews: 0, bounceRate: 0, avgSessionDurationSec: 0 };
  if (overview.rows?.[0]) {
    const v = overview.rows[0].metricValues;
    metrics.sessions              = parseInt(v[0]?.value || 0);
    metrics.users                 = parseInt(v[1]?.value || 0);
    metrics.pageviews             = parseInt(v[2]?.value || 0);
    metrics.bounceRate            = parseFloat((parseFloat(v[3]?.value || 0) * 100).toFixed(1));
    metrics.avgSessionDurationSec = parseInt(parseFloat(v[4]?.value || 0));
  }

  // Parse traffic channels
  const trafficChannels = (channels.rows || []).map(row => ({
    channel:  row.dimensionValues[0].value,
    sessions: parseInt(row.metricValues[0].value),
    users:    parseInt(row.metricValues[1].value),
  }));

  return {
    ...metrics,
    trafficChannels,
    topChannel: trafficChannels[0]?.channel || 'Unknown',
  };
}

// ── GOOGLE SERVICE ACCOUNT JWT AUTH ──────────────────────────────────────────

async function getGoogleAccessToken(serviceAccountJson, scopes) {
  const sa = typeof serviceAccountJson === 'string'
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);

  const b64url = obj =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const header  = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({
    iss:   sa.client_email,
    scope: scopes.join(' '),
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  });

  const signingInput = `${header}.${payload}`;

  // Parse PEM private key
  const pemKey  = sa.private_key.replace(/\\n/g, '\n');
  const pemBody = pemKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ── CLAUDE KEY TAKEAWAYS ──────────────────────────────────────────────────────

async function generateTakeaways({ ghl, ga4, clientName, monthLabel }, apiKey) {
  if (!apiKey) return ['Key Takeaways unavailable — ANTHROPIC_API_KEY not configured.'];

  const dataContext = JSON.stringify({ ghl, ga4 }, null, 2);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are a performance analyst for More Than Momentum (MTM), a digital growth agency.
Write 4-5 Key Takeaways for a client monthly performance report.

Rules:
- Be direct and specific — use actual numbers from the data
- Flag wins clearly: "Lead volume up 40% — Facebook is your top source this month"
- Flag risks clearly: "Bounce rate at 74% — homepage needs attention"
- Connect metrics to business outcomes where possible
- Keep each point to 1-2 sentences max
- No corporate jargon, no vague statements
- Return ONLY the bullet points as a JSON array of strings, no markdown, no intro text

Example format: ["Lead volume increased to 24 this month, up from 18 in March.", "Facebook drove 62% of all leads — strongest performing channel by far."]`,
      messages: [{
        role: 'user',
        content: `Client: ${clientName}\nReporting period: ${monthLabel}\n\nData:\n${dataContext}\n\nReturn the Key Takeaways as a JSON array of strings.`,
      }],
    }),
  });

  const data = await resp.json();
  const text = data.content?.[0]?.text || '[]';

  try {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const arr = JSON.parse(cleaned);
    return Array.isArray(arr) ? arr : [text];
  } catch {
    return text.split('\n').filter(l => l.trim()).map(l => l.replace(/^[-•*]\s*/, ''));
  }
}

// ── OPTIONS ───────────────────────────────────────────────────────────────────

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
