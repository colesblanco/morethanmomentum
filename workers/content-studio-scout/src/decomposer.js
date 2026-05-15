/**
 * Format Decomposer — Claude-powered.
 *
 * Used by:
 *   - the automated scout pipeline (decompose trend signals on Friday cron)
 *   - the Format Capture UI (via the Pages Function proxy → /decompose endpoint)
 *
 * Returns a normalized format_library entry shape so callers can persist
 * directly. All Claude API conventions match the Strategist worker
 * (ASCII-safe JSON rule + post-parse sanitizer for defense in depth).
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a social media format analyst for More Than Momentum (MTM), an AI-native digital growth agency targeting small local business owners.

Your job is to decompose a content format into a reusable structural pattern that MTM can apply to its own content.

MTM's three content pillars:
1. Small Business Growth Mindset (40%) -- trust, owner mentality, invisible problems that cost real money
2. AI Tools & Automation (35%) -- demystifying tech for non-tech business owners, always tied to practical outcomes
3. Relatable Business Skits (25%) -- funny, relatable, secretly educational scenes from a business owner's day

OUTPUT CONTRACT
Return ONLY valid JSON, no text outside the object. Use straight quotes only. No em dashes -- use -- instead. No smart quotes, no ellipsis character.

Schema:
{
  "hook_type": "one of: mistake_reveal | cost_framing | identity_callout | skit_setup | numbered_list | behind_scenes | stat_punch | comparison | day_in_life | question_hook | other",
  "structure_summary": "2-3 sentences describing the exact sequence of the format",
  "pacing_notes": "1 sentence on timing, cut points, or rhythm",
  "why_it_works": "1-2 sentences on the psychological mechanism",
  "mtm_adaptations": [
    "Specific MTM application for Pillar 01 (Growth Mindset)",
    "Specific MTM application for Pillar 02 (AI & Automation)",
    "Specific MTM application for Pillar 03 (Skits)"
  ],
  "source_account": "account handle or null",
  "source_post_url": "URL or null",
  "confidence": "high | medium | low"
}`;

function sanitize(text) {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .trim();
}

export async function decomposeFormat(env, { description, url, source_account }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing on Scout worker');
  if (!description && !url) throw new Error('description or url required');

  const userPrompt = [
    `Decompose this content format into a reusable pattern.`,
    ``,
    url ? `URL: ${url}` : '',
    source_account ? `Source account: ${source_account}` : '',
    ``,
    `Description / transcript / context:`,
    description || '(no description provided -- infer what you can from the URL and source account)',
  ].filter(Boolean).join('\n');

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
      max_tokens: 1000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('empty decomposer response');

  let parsed;
  try {
    parsed = JSON.parse(sanitize(text));
  } catch (err) {
    throw new Error(`decomposer JSON parse failed: ${err.message}`);
  }

  // Normalize to the format_library row shape.
  return {
    hook_type:         parsed.hook_type        || 'other',
    structure_summary: parsed.structure_summary || '',
    pacing_notes:      parsed.pacing_notes     || '',
    why_it_works:      parsed.why_it_works     || '',
    mtm_adaptations:   Array.isArray(parsed.mtm_adaptations) ? parsed.mtm_adaptations : [],
    source_account:    parsed.source_account   || source_account || null,
    source_post_url:   parsed.source_post_url  || url || null,
    confidence:        ['high','medium','low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    usage:             data.usage || null,
    model,
  };
}

/**
 * Convenience: decompose + write to D1, return the new row id (and the data).
 * captured_via tags the source — useful for analytics later.
 */
export async function decomposeAndStore(env, payload, captured_via = 'manual') {
  if (!env.CONTENT_STUDIO_DB) throw new Error('CONTENT_STUDIO_DB binding missing');

  const TENANT_ID = env.TENANT_ID || 'mtm';
  const entry = await decomposeFormat(env, payload);

  const ins = await env.CONTENT_STUDIO_DB.prepare(
    `INSERT INTO format_library
       (tenant_id, source_account, source_post_url, hook_type, structure_summary,
        pacing_notes, why_it_works, mtm_adaptations, captured_via)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    TENANT_ID,
    entry.source_account,
    entry.source_post_url,
    entry.hook_type,
    entry.structure_summary,
    entry.pacing_notes,
    entry.why_it_works,
    JSON.stringify(entry.mtm_adaptations),
    captured_via,
  ).run();

  return { id: ins.meta.last_row_id, ...entry, captured_via };
}
