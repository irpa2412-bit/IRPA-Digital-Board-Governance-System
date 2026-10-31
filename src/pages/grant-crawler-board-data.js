export function mapCrawlerOpportunity(item) {
  const parseList = value => {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  };
  let fallbackFunder = "Funder not verified";
  try { fallbackFunder = new URL(item.source_url || item.url).hostname.replace(/^www\\./, ""); } catch {}
  const callStatus = String(item.call_status || "").toLowerCase();
  return {
    id: "crawler-" + item.id,
    title: item.title || "Untitled opportunity",
    funder: item.funder || item.source_name || fallbackFunder,
    url: item.url || item.source_url || "",
    source_url: item.source_url || "",
    deadline: item.deadline_at || null,
    country: item.country || (item.geography_assessment === "tanzania_mentioned" ? "Tanzania" : item.geography_assessment === "regional_or_lmic_scope" ? "Regional / LMIC" : "Not verified"),
    amount: item.amount || "Not stated",
    summary: item.description || "No description supplied by source.",
    status: ["closed", "expired", "closed_do_not_prioritize"].includes(callStatus) ? "Closed" : callStatus === "open" ? "Open" : "Under review",
    callStatus: item.call_status || "unknown",
    pillars: parseList(item.pillars),
    themes: parseList(item.themes),
    verificationStatus: item.verification_status || "Pending official-call verification",
    sourceType: "Cloudflare crawler",
    discoveryEngine: item.discovery_engine || "unknown",
    sourceUrl: item.source_url || "",
    discoveryEvidence: item.discovery_evidence || "",
    fitScore: Number(item.fit_score || 0),
    fitReasons: item.fit_reasons || "[]",
    eligibilityStatus: item.eligibility_status || "unverified",
    triageAssessment: item.triage_assessment || "manual_eligibility_review",
    createdAt: item.first_seen_at || null
  };
}

export function mergeCrawlerOpportunityPage(current, incoming, offset = 0) {
  if (Number(offset) <= 0) return incoming;
  const merged = new Map((Array.isArray(current) ? current : []).map(record => [String(record.id), record]));
  for (const record of incoming) merged.set(String(record.id), record);
  return [...merged.values()];
}

export function summarizeCrawlerSources(data = {}) {
  const runs = Array.isArray(data.engineRuns) ? data.engineRuns : Array.isArray(data.engines) ? data.engines : [];
  const healthy = runs.filter(run => ["success", "partial"].includes(String(run.status || run.stats?.status || "").toLowerCase())).length;
  const failed = runs.filter(run => String(run.status || run.stats?.status || "").toLowerCase() === "failed").length;
  return { checked: runs.length, healthy, failed };
}
