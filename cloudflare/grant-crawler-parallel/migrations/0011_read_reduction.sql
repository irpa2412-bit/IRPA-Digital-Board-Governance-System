CREATE INDEX IF NOT EXISTS idx_grant_opps_board_seek
  ON grant_opportunities (
    date(COALESCE(deadline_at, '9999-12-31')),
    CASE WHEN call_status = 'open' THEN 0 ELSE 1 END,
    COALESCE(deadline_at, '9999-12-31'),
    fit_score DESC,
    title COLLATE NOCASE
  )
  WHERE LOWER(COALESCE(call_status, 'unknown')) NOT IN ('closed', 'expired');

CREATE INDEX IF NOT EXISTS idx_grant_opps_pipeline_calls
  ON grant_opportunities (COALESCE(deadline_at, '9999-12-31'), title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_crawler_engine_runs_engine_id
  ON crawler_engine_runs (engine, id DESC);
