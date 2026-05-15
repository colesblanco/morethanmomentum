-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4 — Producer columns on uploads
--
-- Apply (remote):
--   npx wrangler d1 execute mtm_content_studio --remote --file=./db/content-studio/005_producer_columns.sql
--
-- ALTER TABLE ADD COLUMN is not idempotent in SQLite -- a re-run errors per
-- column; those errors are safe to ignore.
--
-- posts.asset_status is a free-form TEXT (no CHECK constraint), so the new
-- value set is documented here rather than enforced:
--   pending | uploading | processing | ready | approved | scheduled | failed
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE uploads ADD COLUMN asset_url         TEXT;
ALTER TABLE uploads ADD COLUMN drive_url         TEXT;
ALTER TABLE uploads ADD COLUMN opus_job_id       TEXT;
ALTER TABLE uploads ADD COLUMN canva_design_id   TEXT;
ALTER TABLE uploads ADD COLUMN processing_error  TEXT;
ALTER TABLE uploads ADD COLUMN processed_at      TEXT;
ALTER TABLE uploads ADD COLUMN linked_post_id    INTEGER;
ALTER TABLE uploads ADD COLUMN source            TEXT;   -- 'manual_upload' | 'generated' | etc.

CREATE INDEX IF NOT EXISTS idx_uploads_status        ON uploads (status);
CREATE INDEX IF NOT EXISTS idx_uploads_linked_post   ON uploads (linked_post_id);
