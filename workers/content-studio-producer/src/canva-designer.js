/**
 * Claude + Canva MCP designer.
 *
 * Calls the Anthropic Messages API with the Canva MCP server included so
 * Claude can use Canva tools (search templates, create design, apply brand
 * kit, export). Returns the asset export URL Claude reports.
 *
 * Requires:
 *   ANTHROPIC_API_KEY   — Claude key on this worker
 *   CANVA_MCP_TOKEN     — OAuth token for the user's Canva account (passed in
 *                         mcp_servers[].authorization_token). If missing, the
 *                         caller is responsible for returning a not_configured
 *                         response rather than failing the run.
 *
 * The system prompt is built from brand-voice.json at runtime so any brand
 * edits flow through without code changes.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MCP_BETA      = 'mcp-client-2025-04-04';
const MAX_TOKENS    = 4000;

const URL_REGEX = /https:\/\/[^\s"'<>)]+?\.(?:png|jpg|jpeg|webp|mp4|pdf)/gi;

async function fetchBrandVoice(env) {
  const base = (env.PAGES_BASE_URL || 'https://morethanmomentum.com').replace(/\/$/, '');
  const res = await fetch(`${base}/tools/content-studio/config/brand-voice.json`);
  if (!res.ok) throw new Error(`brand-voice fetch HTTP ${res.status}`);
  return res.json();
}

function buildSystemPrompt(brand) {
  const id = brand.identity || {};
  const v  = brand.visual_identity || {};
  return [
    `You are a graphic designer for ${id.name || 'this brand'}.`,
    ``,
    `BRAND TOKENS (use these, never substitute)`,
    `Background:  ${v.colors?.primary_bg   || '#0C0C0C'}`,
    `CTA primary: ${v.colors?.cta_primary  || '#2D6BE4'}`,
    `Accent:      ${v.colors?.accent       || '#5B8FF0'}`,
    `Highlight:   ${v.colors?.highlight    || '#F5C518'}`,
    `Light:       ${v.colors?.light_surface|| '#F4F4F2'}`,
    ``,
    `Typography`,
    `Headlines: ${v.typography?.display_headline || 'Barlow Condensed ExtraBold, uppercase, tracking +20'}`,
    `Body:      ${v.typography?.body            || 'Inter Regular, 16px, 1.6 line height'}`,
    ``,
    `Design philosophy: ${v.design_philosophy || 'Dark-first. Authority, trust, bold clarity. Never generic AI aesthetic.'}`,
    ``,
    `WORKFLOW`,
    `Use the connected Canva tools to:`,
    `1. Search for or create a template that matches the brief.`,
    `2. Apply the brand colors and typography above.`,
    `3. Place the supplied hook as the headline and any body copy underneath.`,
    `4. Position the MTM logo bottom-left if a brand kit asset is available.`,
    `5. Export the design as PNG (vertical 1080x1350 for IG posts; 1080x1920 for Reels).`,
    `6. After exporting, REPLY WITH THE EXPORT URL on its own line so the worker can pick it up.`,
    ``,
    `Never invent URLs. Only return URLs produced by Canva tool calls.`,
  ].join('\n');
}

function pickFirstUrl(text) {
  if (!text) return null;
  const matches = text.match(URL_REGEX);
  return matches && matches.length ? matches[0] : null;
}

function joinTextBlocks(blocks) {
  return (blocks || [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n');
}

async function callClaudeWithCanva(env, { systemPrompt, userPrompt, imageUrl }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  if (!env.CANVA_MCP_TOKEN)   throw new Error('CANVA_MCP_TOKEN missing -- cannot authenticate the MCP connection');

  const content = [];
  if (imageUrl) {
    content.push({
      type: 'image',
      source: { type: 'url', url: imageUrl },
    });
  }
  content.push({ type: 'text', text: userPrompt });

  const body = {
    model:       env.PRODUCER_MODEL || DEFAULT_MODEL,
    max_tokens:  MAX_TOKENS,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content }],
    mcp_servers: [
      {
        type: 'url',
        url:  env.CANVA_MCP_URL || 'https://mcp.canva.com/mcp',
        name: 'canva',
        authorization_token: env.CANVA_MCP_TOKEN,
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    MCP_BETA,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`anthropic ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = joinTextBlocks(data.content);
  const url  = pickFirstUrl(text);
  if (!url) throw new Error('Canva export URL not found in Claude response');
  return { export_url: url, raw_text: text, usage: data.usage || null, model: body.model };
}

/* ── Public ──────────────────────────────────────────────────────────────── */
export async function generateGraphic(env, postBrief, imageUrl = null) {
  const brand = await fetchBrandVoice(env);
  const systemPrompt = buildSystemPrompt(brand);
  const userPrompt = [
    `Create a single graphic for this post:`,
    ``,
    `Hook (headline): ${postBrief.hook || ''}`,
    `Caption summary: ${postBrief.caption_summary || postBrief.caption || ''}`,
    `Content type:    ${postBrief.content_type || 'single_image'}`,
    `Pillar:          ${postBrief.pillar_id || ''}`,
    `Platform:        ${postBrief.platform || 'instagram'}`,
    ``,
    imageUrl ? `An image is attached above; incorporate it into the design.` : `No reference image -- design from scratch using the brand tokens.`,
    ``,
    `Output: one PNG, vertical 1080x1350. Reply with the export URL on its own line.`,
  ].join('\n');
  return callClaudeWithCanva(env, { systemPrompt, userPrompt, imageUrl });
}

export async function generateCarousel(env, postBrief, slides) {
  const brand = await fetchBrandVoice(env);
  const systemPrompt = buildSystemPrompt(brand);
  const slideList = (slides || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  const userPrompt = [
    `Create a ${slides?.length || 'multi'}-slide carousel for Instagram (1080x1350 per slide).`,
    ``,
    `Hook (slide 1): ${postBrief.hook || ''}`,
    `Slide content:`,
    slideList,
    ``,
    `Apply the brand tokens above to every slide. Keep the visual rhythm consistent.`,
    `After exporting, REPLY WITH ONE EXPORT URL PER LINE, in slide order.`,
  ].join('\n');
  const result = await callClaudeWithCanva(env, { systemPrompt, userPrompt });
  // Carousel mode: parse every URL Claude emitted, in order.
  const urls = (result.raw_text.match(URL_REGEX) || []);
  return { export_urls: urls, raw_text: result.raw_text, usage: result.usage, model: result.model };
}
