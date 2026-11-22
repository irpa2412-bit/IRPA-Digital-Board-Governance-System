CREATE INDEX IF NOT EXISTS idx_grant_opps_board ON grant_opportunities (
  (CASE WHEN call_status = 'open' THEN 0 ELSE 1 END),
  (COALESCE(deadline_at, '9999-12-31')),
  fit_score DESC,
  title COLLATE NOCASE
);
CREATE INDEX IF NOT EXISTS idx_grant_opps_deadline ON grant_opportunities (deadline_at);
CREATE INDEX IF NOT EXISTS idx_grant_opps_call_status ON grant_opportunities (call_status);
