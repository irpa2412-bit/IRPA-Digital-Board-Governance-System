CREATE TABLE IF NOT EXISTS crawler_engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  configured INTEGER NOT NULL DEFAULT 0,
  items_seen INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crawler_engine_runs_finished
  ON crawler_engine_runs(finished_at DESC, engine);
