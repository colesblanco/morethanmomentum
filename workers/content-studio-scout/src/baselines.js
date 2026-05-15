/**
 * Per-account baseline tracking for Phase 3b Instagram scout.
 *
 * Maintains a rolling 30-day median of views and engagement per watched account
 * in creator_baselines. Used to detect overperforming posts that are worth
 * decomposing into format library entries.
 *
 * "Median over the last N samples" rather than time-windowed median is fine for
 * accounts that post a handful of times per week — N=20 approximates 30 days.
 */

const TENANT_ID = 'mtm';
const SAMPLE_N  = 20;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Update the baseline for an account from a fresh set of post metrics.
 * postMetrics: [{ views, engagement }, ...] — last 20-ish posts.
 */
export async function updateBaseline(db, accountHandle, platform, postMetrics) {
  const samples = (postMetrics || []).slice(0, SAMPLE_N);
  const medViews = median(samples.map(p => p.views      || 0));
  const medEng   = median(samples.map(p => p.engagement || 0));

  const existing = await db.prepare(
    `SELECT id FROM creator_baselines WHERE tenant_id = ? AND account_handle = ? AND platform = ?`
  ).bind(TENANT_ID, accountHandle, platform).first();

  if (existing) {
    await db.prepare(
      `UPDATE creator_baselines
          SET median_views_30d      = ?,
              median_engagement_30d = ?,
              last_updated          = datetime('now'),
              updated_at            = datetime('now')
        WHERE id = ?`
    ).bind(medViews, medEng, existing.id).run();
    return { id: existing.id, medianViews: medViews, medianEngagement: medEng, created: false };
  }

  const ins = await db.prepare(
    `INSERT INTO creator_baselines
       (tenant_id, account_handle, platform, median_views_30d, median_engagement_30d)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(TENANT_ID, accountHandle, platform, medViews, medEng).run();
  return { id: ins.meta.last_row_id, medianViews: medViews, medianEngagement: medEng, created: true };
}

/**
 * Overperformance test: a post is "overperforming" if it beats the account's
 * own median views by 50%+ or engagement by 30%+. Looking at the account's
 * own median (not a cross-account average) is the whole point — Hormozi's
 * "normal" video already outperforms most accounts' best post.
 */
export function isOverperforming(postMetrics, baseline) {
  if (!baseline || (!baseline.median_views_30d && !baseline.median_engagement_30d)) {
    return false;   // need at least one signal to compare against
  }
  const viewsThreshold      = (baseline.median_views_30d      || 0) * 1.5;
  const engagementThreshold = (baseline.median_engagement_30d || 0) * 1.3;
  if ((postMetrics.views || 0)      > viewsThreshold)      return true;
  if ((postMetrics.engagement || 0) > engagementThreshold) return true;
  return false;
}

export async function getBaseline(db, accountHandle, platform) {
  return db.prepare(
    `SELECT id, median_views_30d, median_engagement_30d, last_updated
       FROM creator_baselines
      WHERE tenant_id = ? AND account_handle = ? AND platform = ?`
  ).bind(TENANT_ID, accountHandle, platform).first();
}
