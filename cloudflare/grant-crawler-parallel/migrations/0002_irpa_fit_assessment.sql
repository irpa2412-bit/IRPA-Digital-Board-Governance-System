ALTER TABLE grant_opportunities ADD COLUMN fit_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grant_opportunities ADD COLUMN fit_assessment TEXT NOT NULL DEFAULT 'not_assessed';
ALTER TABLE grant_opportunities ADD COLUMN fit_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE grant_opportunities ADD COLUMN eligibility_status TEXT NOT NULL DEFAULT 'unverified';
