ALTER TABLE grant_opportunities ADD COLUMN call_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE grant_opportunities ADD COLUMN geography_assessment TEXT NOT NULL DEFAULT 'not_stated';
ALTER TABLE grant_opportunities ADD COLUMN triage_assessment TEXT NOT NULL DEFAULT 'manual_eligibility_review';
