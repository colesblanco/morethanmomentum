-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — Scout tables + soft-delete column on format_library
--
-- Apply (remote):
--   npx wrangler d1 execute mtm_content_studio --remote --file=./db/content-studio/004_scout_tables.sql
--
-- Verify:
--   npx wrangler d1 execute mtm_content_studio --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
--   → expect: weekly_plans, posts, format_library, creator_baselines, uploads,
--             retrospectives, trend_digests, scout_runs (8 tables)
--
-- Notes:
-- - format_library.deleted_at supports soft-delete via DELETE endpoint.
-- - ALTER TABLE ADD COLUMN is idempotency-unsafe in SQLite; second run errors
--   are safe to ignore.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trend_digests (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              TEXT    NOT NULL DEFAULT 'mtm',
  week_start             TEXT    NOT NULL,                      -- ISO date (Monday)
  source                 TEXT    NOT NULL,                      -- 'tiktok_creative_center' | 'google_trends' | 'instagram_scout'
  digest_data            TEXT    NOT NULL,                      -- JSON
  mtm_applications       TEXT,                                  -- JSON
  format_entries_created INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scout_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT    NOT NULL DEFAULT 'mtm',
  run_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  sources_checked   TEXT    NOT NULL,                           -- JSON array
  new_formats_added INTEGER NOT NULL DEFAULT 0,
  trends_captured   INTEGER NOT NULL DEFAULT 0,
  errors            TEXT,                                       -- JSON
  duration_ms       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_trend_digests_tenant ON trend_digests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trend_digests_week   ON trend_digests (week_start);
CREATE INDEX IF NOT EXISTS idx_scout_runs_tenant    ON scout_runs    (tenant_id);

-- Soft-delete + capture-source columns on format_library.
-- captured_via lets us distinguish 'seed' / 'manual' / 'scout_tiktok' / 'scout_google' / 'scout_instagram'.
ALTER TABLE format_library ADD COLUMN deleted_at  TEXT;
ALTER TABLE format_library ADD COLUMN captured_via TEXT;
