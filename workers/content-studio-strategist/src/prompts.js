/**
 * Strategist Agent — system prompt assembly.
 *
 * Every prompt is built from brand-voice.json at runtime. No MTM-specific
 * copy lives in this file; it's all tokens pulled from the config.
 *
 * Why two functions:
 *   - buildSystemPrompt() returns the *stable* portion (brand voice, voice
 *     rules, pillars, platform rules, strategist instructions). This is
 *     cacheable via Anthropic's prompt caching — same content across cron
 *     runs and on-demand calls within a 5-minute window.
 *   - buildUserPrompt() returns the *variable* portion (week start date,
 *     analytics snapshot, retrospective, format library top N, mode flag,
 *     optional locked-posts context for cascade). Not cached.
 */

function bullets(items, prefix = '• ') {
  if (!items || !items.length) return '(none)';
  return items.map(i => `${prefix}${i}`).join('\n');
}

function pillarBlock(pillar) {
  const pct = Math.round(pillar.weight * 100);
  return [
    `[${pillar.id}] ${pillar.name} — ${pct}% of weekly mix`,
    `Role: ${pillar.role}`,
    `Description: ${pillar.description}`,
    `Goal: ${pillar.goal}`,
    `Formats: ${(pillar.formats || []).join(', ')}`,
    `Example hooks the brand has used:`,
    bullets(pillar.example_hooks || []),
  ].join('\n');
}

function platformBlock(name, p) {
  if (!p || p.enabled === false) return null;
  return [
    `▸ ${name.toUpperCase()}`,
    `  best post times: ${(p.best_post_times || []).join(' · ')}`,
    `  caption style:   ${p.caption_style || ''}`,
    `  hashtag pool:    ${(p.hashtag_pool || []).join(' ')}`,
  ].join('\n');
}

export function buildSystemPrompt(brand) {
  const id    = brand.identity || {};
  const aud   = brand.audience || {};
  const voice = brand.voice    || {};
  const pillars = brand.content_pillars || [];
  const mix     = brand.content_mix || {};
  const platforms = brand.platforms || {};
  const si    = brand.strategist_instructions || {};

  const enabledPlatforms = Object.entries(platforms)
    .map(([name, p]) => platformBlock(name, p))
    .filter(Boolean)
    .join('\n\n');

  return [
    `You are the Content Strategist for ${id.name || 'this brand'}, an AI-native digital growth agency.`,
    ``,
    `BRAND IDENTITY`,
    id.positioning || '',
    id.voice_in_one_line ? `Voice in one line: ${id.voice_in_one_line}` : '',
    ``,
    `AUDIENCE`,
    aud.primary    ? `Primary: ${aud.primary}` : '',
    aud.profile    ? `Profile: ${aud.profile}` : '',
    aud.inner_dialogue ? `What they say to themselves:\n${bullets(aud.inner_dialogue)}` : '',
    ``,
    `VOICE & TONE`,
    voice.tone_summary || '',
    ``,
    `DO sound like this:`,
    bullets(voice.do || []),
    ``,
    `NEVER sound like this:`,
    bullets(voice.dont || []),
    ``,
    `Avoid always: ${(voice.avoid_always || []).join(' · ')}`,
    ``,
    `CONTENT PILLARS & WEEKLY MIX`,
    pillars.map(pillarBlock).join('\n\n'),
    ``,
    `Weekly mix targets (over rolling 4-week window):`,
    Object.entries(mix)
      .filter(([k]) => k !== 'note')
      .map(([k, v]) => `  ${k}: ${Math.round((typeof v === 'number' ? v : 0) * 100)}%`)
      .join('\n'),
    ``,
    `PLATFORMS (only generate posts for the platforms listed below)`,
    enabledPlatforms || '(no platforms enabled)',
    ``,
    `STRATEGIST RULES`,
    bullets(si.weekly_plan_rules || []),
    ``,
    `TONE REMINDERS`,
    bullets(si.tone_reminders || []),
    ``,
    `OUTPUT CONTRACT`,
    `You always return a single valid JSON object. Never wrap it in markdown fences. Never add commentary outside the JSON.`,
    `Schema:`,
    `{`,
    `  "week_start": "YYYY-MM-DD",                       // Monday of the planning week`,
    `  "strategy_summary": "2-3 sentence overview",`,
    `  "monday_brief":    { "required": boolean, "shots": ["..."] },`,
    `  "wednesday_brief": { "required": boolean, "shots": ["..."] },`,
    `  "posts": [`,
    `    {`,
    `      "day_of_week": "monday|tuesday|...|sunday",`,
    `      "post_time":   "HH:MM",                       // 24h local platform time`,
    `      "platform":    "instagram|facebook",`,
    `      "pillar_id":   "pillar_01|pillar_02|pillar_03",`,
    `      "format_id":   integer-or-null,               // matches format_library.id when used`,
    `      "hook":        "first line of the caption (≤12 words)",`,
    `      "caption":     "full caption text including the hook",`,
    `      "hashtags":    ["#tag1","#tag2"],`,
    `      "content_type":"reel|carousel|single_image|story",`,
    `      "needs_filming": boolean,                     // true if must be shot on Monday or Wednesday`,
    `      "decision_log":"one specific paragraph explaining why this hook, platform, format, time. Cite the data."`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Generate exactly 7 posts — one per day, Monday through Sunday — unless the user prompt says you are in CASCADE mode, in which case generate only the days listed in TARGET_DAYS.`,
  ].filter(line => line !== null && line !== undefined).join('\n');
}

/**
 * Build the user prompt — variable per call.
 *
 * @param {object} ctx
 * @param {string} ctx.weekStart         ISO date (Monday)
 * @param {object} ctx.analytics         { newLeads, openPipelineValue, topSource, ... }
 * @param {object|null} ctx.retro        last retrospective row (or null)
 * @param {Array}  ctx.formats           top-N format library rows
 * @param {object} ctx.mode              { type: 'full' } | { type: 'cascade', lockedPosts, targetDays }
 */
export function buildUserPrompt(ctx) {
  const lines = [];

  lines.push(`WEEK_START: ${ctx.weekStart}`);
  lines.push('');

  lines.push('ANALYTICS_CONTEXT');
  const a = ctx.analytics || {};
  lines.push(`  new leads this month: ${a.newLeads ?? 0}`);
  lines.push(`  top lead source:      ${a.topSource ?? '—'}`);
  lines.push(`  open pipeline value:  $${(a.openPipelineValue ?? 0).toLocaleString('en-US')}`);
  lines.push(`  open deals:           ${a.openDeals ?? 0}`);
  lines.push('');

  lines.push('LAST_WEEK_RETROSPECTIVE');
  if (!ctx.retro) {
    lines.push('  (none — this is the first generated week; no prior signal)');
  } else {
    lines.push(`  week_start: ${ctx.retro.week_start}`);
    lines.push(`  key_learnings: ${ctx.retro.key_learnings || '(none recorded)'}`);
    lines.push(`  asset_gaps:    ${ctx.retro.asset_gaps    || '(none recorded)'}`);
  }
  lines.push('');

  lines.push('FORMAT_LIBRARY (ranked by performance desc, ties broken by least-used)');
  if (!ctx.formats || !ctx.formats.length) {
    lines.push('  (empty)');
  } else {
    for (const f of ctx.formats) {
      lines.push(`  [${f.id}] ${f.hook_type} — used ${f.times_used || 0}× — ${f.structure_summary || ''}`);
      if (f.why_it_works) lines.push(`        why it works: ${f.why_it_works}`);
    }
  }
  lines.push('');

  if (ctx.mode && ctx.mode.type === 'cascade') {
    lines.push('MODE: CASCADE');
    lines.push(`TARGET_DAYS: ${ctx.mode.targetDays.join(', ')}`);
    lines.push('LOCKED_POSTS (do not modify; use as creative context for downstream days):');
    for (const p of (ctx.mode.lockedPosts || [])) {
      lines.push(`  ${p.day_of_week} ${p.post_time} ${p.platform} [${p.edit_state}]`);
      lines.push(`    hook: ${p.hook}`);
      if (p.caption) lines.push(`    caption: ${p.caption.slice(0, 200)}${p.caption.length > 200 ? '…' : ''}`);
    }
    lines.push('');
    lines.push('Return a JSON object whose "posts" array contains ONLY entries for the TARGET_DAYS, in the same schema.');
  } else {
    lines.push('MODE: FULL_WEEK');
    lines.push('Return a JSON object with all 7 posts (Monday through Sunday) plus strategy_summary, monday_brief, wednesday_brief.');
  }

  return lines.join('\n');
}
