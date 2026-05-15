-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 — posts table column additions
--
-- The Strategist Agent's output JSON carries three fields not in the Phase 1
-- schema. SQLite ALTER TABLE only supports ADD COLUMN, so each is added below.
-- Existing rows get NULL/0 defaults; the Strategist always populates them.
--
-- Apply (remote):
--   npx wrangler d1 execute mtm_content_studio --remote --file=./db/content-studio/003_posts_phase2_columns.sql
--
-- Idempotency: the IF NOT EXISTS-equivalent for ADD COLUMN isn't supported,
-- so wrap individually if you re-run. Errors on a second run are safe to ignore.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE posts ADD COLUMN pillar_id     TEXT;             -- pillar_01 | pillar_02 | pillar_03
ALTER TABLE posts ADD COLUMN content_type  TEXT;             -- reel | carousel | single_image | story
ALTER TABLE posts ADD COLUMN needs_filming INTEGER NOT NULL DEFAULT 0;  -- 0 = no, 1 = yes
