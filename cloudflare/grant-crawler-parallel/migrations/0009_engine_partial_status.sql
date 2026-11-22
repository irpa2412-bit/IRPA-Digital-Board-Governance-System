DROP INDEX IF EXISTS idx_crawler_engine_runs_finished;

ALTER TABLE crawler_engine_runs RENAME TO crawler_engine_runs_legacy;

CREATE TABLE crawler_engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  configured INTEGER NOT NULL DEFAULT 0,
  items_seen INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO crawler_engine_runs (id, engine, status, configured, items_seen, error_message, finished_at)
SELECT id, engine, status, configured, items_seen, error_message, finished_at
FROM crawler_engine_runs_legacy;

DROP TABLE crawler_engine_runs_legacy;

CREATE INDEX IF NOT EXISTS idx_crawler_engine_runs_finished
  ON crawler_engine_runs(finished_at DESC, engine);
