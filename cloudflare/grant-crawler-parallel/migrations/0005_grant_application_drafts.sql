CREATE TABLE IF NOT EXISTS grant_application_drafts (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  opportunity_title TEXT NOT NULL DEFAULT '',
  opportunity_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_for_review')),
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grant_application_drafts_owner_updated
  ON grant_application_drafts(owner_uid, updated_at DESC);
