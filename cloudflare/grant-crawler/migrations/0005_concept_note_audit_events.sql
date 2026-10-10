CREATE TABLE IF NOT EXISTS grant_application_draft_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('draft_created', 'draft_updated')),
  event_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_id) REFERENCES grant_application_drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_grant_application_draft_events_owner
  ON grant_application_draft_events(owner_uid, draft_id, created_at DESC);
