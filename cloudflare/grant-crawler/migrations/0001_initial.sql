PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS grant_opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL UNIQUE,
  published_at TEXT,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grant_opportunities_last_seen
  ON grant_opportunities(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS crawler_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  items_seen INTEGER NOT NULL DEFAULT 0,
  items_changed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
