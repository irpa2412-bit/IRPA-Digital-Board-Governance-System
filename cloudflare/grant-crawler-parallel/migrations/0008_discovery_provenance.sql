ALTER TABLE grant_opportunities ADD COLUMN discovery_engine TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE grant_opportunities ADD COLUMN discovery_evidence TEXT;

CREATE INDEX IF NOT EXISTS idx_grant_opportunities_discovery_engine
  ON grant_opportunities(discovery_engine, last_seen_at DESC);
