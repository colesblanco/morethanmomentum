/**
 * Instagram Account Scout — Phase 3b
 *
 * STATUS: Scaffolded, not active.
 * ACTIVATION: Set INSTAGRAM_SCOUT_ENABLED=true in Cloudflare Worker env vars.
 * REQUIRES: IG_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID secrets set on this Worker.
 *
 * Watches 10 inspiration accounts for overperforming posts via the Instagram
 * Graph API's `business_discovery` endpoint, which lets MTM's business token
 * read public business/creator accounts' posts. When a post exceeds the
 * account's 30-day median by 50%+ views or 30%+ engagement, Claude decomposes
 * the format and adds it to format_library.
 *
 * Why business_discovery (not direct media reads): the Graph API will only
 * return /media for accounts you own. To inspect other accounts' posts you
 * must go through business_discovery from your own business account.
 */

import { decomposeAndStore } from './decomposer.js';
import { updateBaseline, getBaseline, isOverperforming } from './baselines.js';

export const WATCHED_ACCOUNTS = [
  { handle: 'grantbeans',            platform: 'instagram', focus: 'hook_craft' },
  { handle: 'hormozi',               platform: 'instagram', focus: 'structure_pacing' },
  { handle: 'devinjatho',            platform: 'instagram', focus: 'skit_format' },
  { handle: 'trevorminahannn',       platform: 'instagram', focus: 'skit_format' },
  { handle: 'tylertometich',         platform: 'instagram', focus: 'hook_craft' },
  { handle: 'becomenutrition',       platform: 'instagram', focus: 'edit_signature' },
  { handle: 'theschoolofhardknockz', platform: 'instagram', focus: 'interview_format' },
  { handle: '_smokeash',             platform: 'instagram', focus: 'edit_rhythm' },
  { handle: 'trarags2',              platform: 'instagram', focus: 'cultural_relevance' },
  { handle: 'edwardkso',             platform: 'instagram', focus: 'interview_format' },
];

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const POSTS_PER_ACCOUNT = 12;

function isEnabled(env) {
  return String(env.INSTAGRAM_SCOUT_ENABLED || '').toLowerCase() === 'true';
}

async function fetchAccountPosts(env, handle) {
  const id    = env.IG_BUSINESS_ACCOUNT_ID;
  const token = env.IG_ACCESS_TOKEN;
  const fields = encodeURIComponent(
    `business_discovery.username(${handle}){followers_count,media_count,media.limit(${POSTS_PER_ACCOUNT}){id,caption,media_type,permalink,timestamp,like_count,comments_count}}`
  );
  const url = `${GRAPH_BASE}/${id}?fields=${fields}&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`business_discovery ${handle} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.business_discovery || null;
}

function postMetrics(post) {
  // Reach/views aren't exposed via business_discovery — use like_count as the
  // closest proxy. When the spec calls for "views" we accept that this is the
  // measurable signal from the Graph API for non-owned accounts.
  const views      = post.like_count     || 0;
  const engagement = (post.like_count || 0) + (post.comments_count || 0) * 3;
  return { views, engagement };
}

export async function runInstagramScout(env, ctx) {
  if (!isEnabled(env)) {
    return {
      source:  'instagram_scout',
      status:  'disabled',
      message: 'Instagram scout disabled -- set INSTAGRAM_SCOUT_ENABLED=true to activate.',
      watched: WATCHED_ACCOUNTS.length,
    };
  }
  if (!env.IG_ACCESS_TOKEN || !env.IG_BUSINESS_ACCOUNT_ID) {
    return {
      source:  'instagram_scout',
      status:  'not_configured',
      message: 'IG_ACCESS_TOKEN and IG_BUSINESS_ACCOUNT_ID secrets are required on this Worker.',
    };
  }

  const db = env.CONTENT_STUDIO_DB;
  const captured_at = new Date().toISOString();
  const errors = [];
  const overperformers = [];
  let formats_added = 0;

  for (const acct of WATCHED_ACCOUNTS) {
    try {
      const data = await fetchAccountPosts(env, acct.handle);
      if (!data) { errors.push(`${acct.handle}: no business_discovery payload`); continue; }
      const posts = (data.media?.data || []).map(p => ({ ...p, metrics: postMetrics(p) }));

      // Refresh the baseline from the freshest sample.
      const baselineSamples = posts.map(p => p.metrics);
      await updateBaseline(db, acct.handle, 'instagram', baselineSamples);
      const baseline = await getBaseline(db, acct.handle, 'instagram');

      for (const p of posts) {
        if (!isOverperforming(p.metrics, baseline)) continue;
        overperformers.push({ handle: acct.handle, post_id: p.id, url: p.permalink, metrics: p.metrics });

        // Decompose + persist. Tagged so we can audit scout-sourced entries later.
        try {
          await decomposeAndStore(env, {
            description:    `Instagram reel/post by @${acct.handle}. Caption:\n${(p.caption || '').slice(0, 1200)}\n\nFocus: ${acct.focus}. Engagement: ${p.metrics.engagement} vs median ${baseline?.median_engagement_30d}.`,
            url:            p.permalink,
            source_account: `@${acct.handle}`,
          }, 'scout_instagram');
          formats_added += 1;
        } catch (decErr) {
          errors.push(`${acct.handle} decompose: ${decErr.message}`);
        }
      }
    } catch (err) {
      errors.push(`${acct.handle}: ${err.message}`);
    }
  }

  return {
    source:           'instagram_scout',
    status:           errors.length && !overperformers.length ? 'error' : 'ok',
    captured_at,
    watched:          WATCHED_ACCOUNTS.length,
    overperformers,
    formats_added,
    errors:           errors.length ? errors : undefined,
  };
}
