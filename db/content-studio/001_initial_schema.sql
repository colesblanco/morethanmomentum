-- ─────────────────────────────────────────────────────────────────────────────
-- MTM Content Studio — Phase 1 schema (6 tables, multi-tenant ready)
--
-- Database: mtm_content_studio
-- Binding (configure in Cloudflare Pages → Settings → Functions → D1 Bindings):
--   CONTENT_STUDIO_DB  →  mtm_content_studio
--
-- Create DB (one-time):
--   npx wrangler d1 create mtm_content_studio
--
-- Apply schema (remote / production):
--   npx wrangler d1 execute mtm_content_studio --remote --file=./db/content-studio/001_initial_schema.sql
--
-- Apply locally during dev:
--   npx wrangler d1 execute mtm_content_studio --local  --file=./db/content-studio/001_initial_schema.sql
--
-- Verify seed count after running 002:
--   npx wrangler d1 execute mtm_content_studio --remote --command="SELECT count(*) FROM format_library"
--   (expect: 10)
--
-- Multi-tenancy: every table carries tenant_id (default 'mtm'); every query MUST filter by it.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) weekly_plans -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_plans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT    NOT NULL DEFAULT 'mtm',
  week_start        TEXT    NOT NULL,                        -- ISO date (YYYY-MM-DD, Monday of week)
  status            TEXT    NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','approved','live','archived')),
  strategy_summary  TEXT,
  monday_brief      TEXT,                                    -- JSON
  wednesday_brief   TEXT,                                    -- JSON
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_tenant      ON weekly_plans (tenant_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_week_start  ON weekly_plans (week_start);

-- 2) posts --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT    NOT NULL DEFAULT 'mtm',
  plan_id           INTEGER,
  day_of_week       TEXT,                                    -- mon|tue|...|sun
  post_time         TEXT,                                    -- HH:MM
  platform          TEXT,                                    -- instagram|facebook|linkedin|tiktok
  hook              TEXT,
  caption           TEXT,
  hashtags          TEXT,                                    -- JSON array
  format_id         INTEGER,                                 -- FK -> format_library.id (nullable)
  asset_status      TEXT,                                    -- raw|edited|approved|missing
  ghl_post_id       TEXT,
  decision_log      TEXT,
  edit_state        TEXT    NOT NULL DEFAULT 'green'
                              CHECK (edit_state IN ('green','yellow','locked')),
  performance_1h    TEXT,                                    -- JSON (nullable)
  performance_24h   TEXT,                                    -- JSON (nullable)
  performance_7d    TEXT,                                    -- JSON (nullable)
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id)   REFERENCES weekly_plans   (id) ON DELETE SET NULL,
  FOREIGN KEY (format_id) REFERENCES format_library (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_tenant   ON posts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_posts_plan_id  ON posts (plan_id);

-- 3) format_library -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS format_library (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           TEXT    NOT NULL DEFAULT 'mtm',
  source_account      TEXT,
  source_post_url     TEXT,
  captured_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  hook_type           TEXT    NOT NULL,
  structure_summary   TEXT,
  pacing_notes        TEXT,
  why_it_works        TEXT,
  mtm_adaptations     TEXT,                                  -- JSON array
  times_used          INTEGER NOT NULL DEFAULT 0,
  performance_avg     REAL,                                  -- nullable
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_format_library_tenant ON format_library (tenant_id);

-- 4) creator_baselines --------------------------------------------------------
CREATE TABLE IF NOT EXISTS creator_baselines (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                TEXT    NOT NULL DEFAULT 'mtm',
  account_handle           TEXT    NOT NULL,
  platform                 TEXT    NOT NULL,
  median_views_30d         INTEGER,
  median_engagement_30d    INTEGER,
  last_updated             TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_creator_baselines_tenant ON creator_baselines (tenant_id);
CREATE INDEX IF NOT EXISTS idx_creator_baselines_handle ON creator_baselines (account_handle);

-- 5) uploads ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             TEXT    NOT NULL DEFAULT 'mtm',
  filename              TEXT    NOT NULL,
  r2_key                TEXT    NOT NULL,
  type                  TEXT    NOT NULL CHECK (type IN ('video','photo','screen')),
  claude_tags           TEXT,                                -- JSON array
  matched_brief_item    TEXT,
  status                TEXT    NOT NULL DEFAULT 'raw'
                                  CHECK (status IN ('raw','processed','archived')),
  output_asset_id       INTEGER,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_tenant ON uploads (tenant_id);

-- 6) retrospectives -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS retrospectives (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                TEXT    NOT NULL DEFAULT 'mtm',
  week_start               TEXT    NOT NULL,
  top_post_id              INTEGER,
  worst_post_id            INTEGER,
  key_learnings            TEXT,                             -- JSON
  asset_gaps               TEXT,                             -- JSON
  library_updates_made     INTEGER NOT NULL DEFAULT 0,
  formats_promoted         TEXT,                             -- JSON
  formats_demoted          TEXT,                             -- JSON
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (top_post_id)   REFERENCES posts (id) ON DELETE SET NULL,
  FOREIGN KEY (worst_post_id) REFERENCES posts (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_retrospectives_tenant ON retrospectives (tenant_id);
