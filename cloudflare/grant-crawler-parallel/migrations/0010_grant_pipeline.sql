CREATE TABLE IF NOT EXISTS grant_pipeline_evaluations (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('ELIGIBLE', 'CONDITIONAL', 'NOT_ELIGIBLE')),
  fit_score INTEGER NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  fit_breakdown_json TEXT NOT NULL DEFAULT '{}',
  eligibility_reasons_json TEXT NOT NULL DEFAULT '[]',
  missing_json TEXT NOT NULL DEFAULT '[]',
  validity_status TEXT NOT NULL CHECK (validity_status IN ('CURRENT', 'CLOSED', 'UNVERIFIED')),
  evaluated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grant_pipeline_evaluations_call
  ON grant_pipeline_evaluations(call_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grant_pipeline_stages (
  call_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('identified', 'screening', 'eligible', 'conditional', 'not_eligible', 'concept_note', 'submitted', 'awarded', 'declined', 'archived')),
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grant_pipeline_stages_updated
  ON grant_pipeline_stages(updated_at DESC);

CREATE TABLE IF NOT EXISTS grant_pipeline_evidence (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grant_pipeline_evidence_call
  ON grant_pipeline_evidence(call_id, created_at DESC);
