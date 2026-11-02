const ENTITY_MAP = { amp: "&", apos: "'", quot: '"', nbsp: " ", lt: "<", gt: ">", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
export function cleanCrawlerText(value, maxLength = 280) {
 const decoded=String(value??"").replace(/<(script|style|noscript)\\b[^>]*>[\\s\\S]*?<\\/\\1>/gi," ").replace(/<[^>]*>/g," ").replace(/&(#x[0-9a-f]+|#\\d+|[a-z][a-z0-9]+);/gi,(entity,key)=>{
  if(key[0]==="#"){const hex=key[1]?.toLowerCase()==="x";const code=Number.parseInt(key.slice(hex?2:1),hex?16:10);return Number.isFinite(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):" ";}
  return ENTITY_MAP[key.toLowerCase()]??" ";
 });
 return decoded.replace(/\\b(skip to main content|skip navigation|main menu|cookie settings|accept all cookies|reject all cookies|manage cookies|privacy policy|terms of use|subscribe to our newsletter|home|menu|about us|contact us|search this site|accessibility statement)\\b/gi," ").replace(/[\\u00a0\\s]+/g," ").trim().slice(0,Math.max(0,Number(maxLength)||280));
}
export function mapCrawlerOpportunity(item) {
  const parseList = value => {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  };
  let fallbackFunder = "Funder not verified";
  try { fallbackFunder = new URL(item.source_url || item.url).hostname.replace(/^www\./, ""); } catch {}
  const callStatus = String(item.call_status || "").toLowerCase();
  return {
    id: "crawler-" + item.id,
    title: cleanCrawlerText(item.title, 180) || "Untitled opportunity",
    funder: item.funder || item.source_name || fallbackFunder,
    url: item.url || item.source_url || "",
    source_url: item.source_url || "",
    deadline: item.deadline_at || null,
    country: item.country || (item.geography_assessment === "tanzania_mentioned" ? "Tanzania" : item.geography_assessment === "regional_or_lmic_scope" ? "Regional / LMIC" : "Not verified"),
    amount: item.amount || "Not stated",
    summary: cleanCrawlerText(item.description, 280) || "No description supplied by source.",
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
