const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

const db = getFirestore();
const REGION = "us-central1";
const USER_AGENT = "IRPA-DBGS-GrantDiscovery/1.0 (+https://www.irpa.or.tz; public funding opportunity indexing)";
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_ITEMS_PER_SOURCE = 80;
const MAX_CANDIDATES_PER_RUN = 250;
const FRESH_DAYS = 180;

// Public feeds and public opportunity hubs only. Source availability is checked at run time;
// a configured source is never presented as healthy until it responds successfully.
const SOURCES = [
  { id: "fundsforngos", name: "FundsforNGOs", kind: "feed", url: "https://www2.fundsforngos.org/feed/", scope: "Aggregator", regions: ["Africa", "Global"] },
  { id: "opportunitydesk", name: "Opportunity Desk", kind: "feed", url: "https://opportunitydesk.org/feed/", scope: "Aggregator", regions: ["Africa", "Global"] },
  { id: "fao-newsroom", name: "FAO Newsroom", kind: "feed", url: "https://www.fao.org/newsroom/rss/en/", scope: "Official", regions: ["Global"] },
  { id: "reliefweb-jobs", name: "ReliefWeb public API", kind: "json", url: "https://api.reliefweb.int/v2/jobs?appname=irpa-dbgs&limit=50&sort[]=date:desc&query[value]=grant%20OR%20funding%20OR%20livelihoods%20OR%20climate", scope: "Public API", regions: ["Africa", "Global"] },
  { id: "gef-sgp", name: "Global Environment Facility Small Grants Programme", kind: "hub", url: "https://www.thegef.org/what-we-do/topics/gef-small-grants-programme", scope: "Official", regions: ["Global"] },
  { id: "undp-procurement", name: "UNDP Procurement Notices", kind: "hub", url: "https://procurement-notices.undp.org/", scope: "Official", regions: ["Global"] },
  { id: "eu-funding", name: "EU Funding & Tenders Portal", kind: "hub", url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home", scope: "Official", regions: ["Global"] },
  { id: "adaptation-fund", name: "Adaptation Fund", kind: "hub", url: "https://www.adaptation-fund.org/", scope: "Official", regions: ["Global"] },
  { id: "green-climate-fund", name: "Green Climate Fund", kind: "hub", url: "https://www.greenclimate.fund/", scope: "Official", regions: ["Global"] },
  { id: "afdb", name: "African Development Bank", kind: "hub", url: "https://www.afdb.org/en/about-us/corporate-procurement", scope: "Official", regions: ["Africa"] },
  { id: "tanzania-forest-services", name: "Tanzania Forest Services", kind: "hub", url: "https://www.tfs.go.tz/", scope: "Official", regions: ["Tanzania"] }
];

const PILLAR_RULES = [
  { id: "rangeland", words: /rangeland|pastoral|grazing|range land|land restoration|landscape restoration|dryland|grassland|invasive plant|ecosystem restoration|biodiversity|conservation|forest|reforestation|tree nursery|watershed/ },
  { id: "livestock", words: /livestock|animal health|veterinary|cattle|goat|sheep|pastoral herd|fodder|forage|dairy|meat processing|animal breeding|herding/ },
  { id: "market", words: /market access|value chain|value addition|agribusiness|agri-business|trade|enterprise|small business|entrepreneur|leather|meat value|market development|income generation/ }
];
const THEME_RULES = [
  { id: "climate", words: /climate|adaptation|resilience|drought|flood|early warning|carbon|weather|climate-smart/ },
  { id: "gender", words: /gender|women|female|inclusion|disability|marginalized|equity/ },
  { id: "youth", words: /youth|young people|young entrepreneur/ },
  { id: "community", words: /community-led|community based|community-based|participatory|local communities|indigenous|pastoral communities/ },
  { id: "innovation", words: /research|innovation|digital|technology|data|knowledge|pilot|evidence|learning/ },
  { id: "governance", words: /governance|institutional capacity|capacity building|accountability|transparency|organizational development/ },
  { id: "environment", words: /environment|biodiversity|ecosystem|conservation|restoration|forest|soil|water resource|sustainable land/ }
];
const OPPORTUNITY_TERMS = /grant|grants|funding|funded|call for proposals|call for application|application call|expression of interest|\beoi\b|challenge fund|small grants|research award|fellowship|prize|tender|request for proposals|\brfp\b|\bcfp\b|open call|innovation fund|funding opportunity|subsidy|donor opportunity|financing window/i;
const NON_GRANT_TERMS = /job vacancy|career opportunity|staff position|employment opportunity|internship vacancy|procurement of office supplies|purchase of vehicles/i;

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripHtml(value) {
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 6000);
}
function xmlTag(block, name) {
  const re = new RegExp("<(?:[\\w.-]+:)?" + name + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>", "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, " ").trim()) : "";
}
function parseFeed(xml, baseUrl) {
  const blocks = [...String(xml).matchAll(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)\s*>/gi)].slice(0, MAX_ITEMS_PER_SOURCE);
  return blocks.map(block => {
    const title = stripHtml(xmlTag(block, "title"));
    let url = xmlTag(block, "link");
    const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (href && (!url || !/^https?:/i.test(url))) url = href[1];
    const guid = xmlTag(block, "guid") || xmlTag(block, "id");
    const description = stripHtml(xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content") || xmlTag(block, "encoded"));
    const date = xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "date");
    return normalizeCandidate({ title, url: resolveUrl(url || guid, baseUrl), description, publishedAt: date });
  }).filter(Boolean);
}
function normalizeCandidate(item) {
  if (!item || !item.title || !item.url) return null;
  try {
    const u = new URL(item.url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (u.username || u.password) return null;
    const title = stripHtml(item.title).slice(0, 400);
    const description = stripHtml(item.description).slice(0, 6000);
    if (title.length < 8 || !OPPORTUNITY_TERMS.test(title + " " + description) || NON_GRANT_TERMS.test(title)) return null;
    let publishedAt = null;
    if (item.publishedAt) {
      const parsed = new Date(item.publishedAt);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 86400000) publishedAt = parsed;
    }
    return { title, url: u.href, description, publishedAt };
  } catch { return null; }
}
function resolveUrl(href, base) {
  if (!href) return "";
  try { return new URL(decodeEntities(href.trim()), base).href; } catch { return ""; }
}
async function fetchText(url, accept) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: accept || "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Response too large");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Response too large");
  return { body, type, finalUrl: response.url || url };
}
function parseHub(html, baseUrl) {
  const found = [];
  const anchorRe = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchorRe.exec(html)) && found.length < MAX_ITEMS_PER_SOURCE) {
    const attrs = match[1] + " " + match[4];
    const title = stripHtml(match[5] || attrs.match(/aria-label=["']([^"']+)/i)?.[1] || attrs.match(/title=["']([^"']+)/i)?.[1] || "");
    const url = resolveUrl(match[3], baseUrl);
    if (!title || !url) continue;
    try {
      const target = new URL(url), root = new URL(baseUrl);
      if (target.hostname !== root.hostname && !target.hostname.endsWith("." + root.hostname)) continue;
      if (target.href === root.href || /^(#|javascript:|mailto:)/i.test(match[3])) continue;
      const candidate = normalizeCandidate({ title, url, description: "", publishedAt: null });
      if (candidate) found.push(candidate);
    } catch {}
  }
  const seen = new Set();
  return found.filter(x => !seen.has(canonicalUrl(x.url)) && seen.add(canonicalUrl(x.url)));
}
function canonicalUrl(value) {
  try { const u = new URL(value); u.hash = ""; for (const key of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"]) u.searchParams.delete(key); return u.href.replace(/\/$/, ""); } catch { return value; }
}
function classify(text) {
  const content = String(text || "").toLowerCase();
  const pillars = PILLAR_RULES.filter(x => x.words.test(content)).map(x => x.id);
  const themes = THEME_RULES.filter(x => x.words.test(content)).map(x => x.id);
  return { pillars: pillars.length ? pillars : [], themes };
}
function geography(text) {
  const t = String(text || "").toLowerCase();
  if (/tanzania|east africa|sub-saharan africa|africa-wide|african countries|countries in africa/.test(t)) return "Tanzania / Africa (verify call rules)";
  if (/global|worldwide|all countries|international applicants/.test(t)) return "Global (verify call rules)";
  return "Not verified — check official call";
}
function likelyStatus(candidate) {
  if (candidate.publishedAt && Date.now() - candidate.publishedAt.getTime() > FRESH_DAYS * 86400000) return "Under review";
  return "Under review";
}
function stableOpportunityId(url) {
  return crypto.createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 40);
}
function deadlineHint(text) {
  const matches = [...String(text || "").matchAll(/(?:deadline|applications? close|closing date|submit by|due date)\s*[:\-]?\s*((?:\d{1,2}[\s/-]+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s,/-]+\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi)];
  return matches.length ? matches[0][1].slice(0, 100) : "";
}
async function readSource(source) {
  const started = Date.now();
  const { body, type, finalUrl } = await fetchText(source.url, source.kind === "json" ? "application/json" : undefined);
  let candidates = [];
  if (source.kind === "json" || /json/i.test(type)) {
    const data = JSON.parse(body);
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    candidates = rows.slice(0, MAX_ITEMS_PER_SOURCE).map(row => {
      const fields = row.fields || row;
      const title = fields.title || fields.name || "";
      const description = [fields.body, fields.description, fields.country, fields.source].flat().map(v => typeof v === "string" ? v : v?.name || "").filter(Boolean).join(" ");
      const url = fields.url || fields.web_url || fields.uri || "";
      return normalizeCandidate({ title, url: resolveUrl(url, finalUrl), description, publishedAt: fields.date?.created || fields.date || fields.published });
    }).filter(Boolean);
  } else if (source.kind === "feed" || /xml|rss|atom/i.test(type) || /<(rss|feed|rdf)\b/i.test(body.slice(0, 1000))) {
    candidates = parseFeed(body, finalUrl);
  } else {
    candidates = parseHub(body, finalUrl);
  }
  return { candidates: candidates.slice(0, MAX_ITEMS_PER_SOURCE), durationMs: Date.now() - started, httpStatus: 200 };
}
async function upsertCandidate(candidate, source, runId) {
  const id = stableOpportunityId(candidate.url);
  const ref = db.collection("grantOpportunities").doc(id);
  const existing = await ref.get();
  const current = existing.exists ? existing.data() || {} : {};
  const classification = classify(candidate.title + " " + candidate.description);
  const deadline = deadlineHint(candidate.title + " " + candidate.description);
  const sourceName = source.name;
  const now = FieldValue.serverTimestamp();
  const payload = {
    title: candidate.title,
    funder: current.funder || sourceName,
    url: candidate.url,
    summary: candidate.description || current.summary || "Automatically discovered from a public funding source. Open the original call to verify scope, eligibility and application requirements.",
    country: current.country || geography(candidate.title + " " + candidate.description),
    amount: current.amount || "Not verified — see official call",
    status: current.status && !["Open", "Under review"].includes(current.status) ? current.status : likelyStatus(candidate),
    pillars: current.pillars?.length ? current.pillars : classification.pillars,
    themes: current.themes?.length ? current.themes : classification.themes,
    eligibleCountries: current.eligibleCountries || [],
    eligibleApplicantTypes: current.eligibleApplicantTypes || [],
    requiredDocuments: current.requiredDocuments || [],
    applicationRequirements: current.applicationRequirements || "Not extracted or verified. Read the official call and confirm all mandatory documents before applying.",
    applicationMethod: current.applicationMethod || "See official call",
    deadline: current.deadline || deadline || null,
    verificationStatus: "Pending verification",
    sourceType: source.scope,
    sourceId: source.id,
    sourceName,
    recordOrigin: "AUTOMATED_CRAWLER",
    discoveredAt: current.discoveredAt || now,
    lastSeenAt: now,
    lastCrawlRunId: runId,
    updatedAt: now,
    crawlerVersion: 1
  };
  if (candidate.publishedAt) payload.sourcePublishedAt = Timestamp.fromDate(candidate.publishedAt);
  if (!existing.exists) {
    payload.createdAt = now;
    payload.createdByUid = "irpa-grant-crawler";
    payload.createdByEmail = "automated-crawler@irpa.or.tz";
    await ref.set(payload);
    return "created";
  }
  // Do not overwrite decisions, application progress, manual classification, or edited requirements.
  const safeUpdate = { lastSeenAt: now, lastCrawlRunId: runId, crawlerVersion: 1 };
  if (!current.sourceName) safeUpdate.sourceName = sourceName;
  if (!current.sourceId) safeUpdate.sourceId = source.id;
  if (!current.verificationStatus) safeUpdate.verificationStatus = "Pending verification";
  if ((!current.summary || !String(current.summary).trim()) && candidate.description) safeUpdate.summary = candidate.description;
  await ref.set(safeUpdate, { merge: true });
  return "updated";
}
async function runGrantCrawler(trigger = "scheduled") {
  const startedAt = new Date();
  const runId = crypto.randomUUID();
  const runRef = db.collection("grantCrawlerRuns").doc(runId);
  const statusRef = db.collection("grantCrawlerStatus").doc("current");
  await runRef.set({ runId, trigger, status: "running", startedAt: FieldValue.serverTimestamp(), sourceCount: SOURCES.length, completedSources: 0, candidatesFound: 0, created: 0, updated: 0, errors: [] });
  await statusRef.set({ active: true, status: "running", currentRunId: runId, lastStartedAt: FieldValue.serverTimestamp(), configuredSources: SOURCES.length, schedule: "Every 6 hours", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const sourceResults = [];
  let created = 0, updated = 0, candidatesFound = 0, errors = 0;
  for (const source of SOURCES) {
    const sourceStarted = Date.now();
    try {
      const result = await readSource(source);
      const candidates = result.candidates.slice(0, Math.max(0, MAX_CANDIDATES_PER_RUN - candidatesFound));
      let sourceCreated = 0, sourceUpdated = 0;
      for (const candidate of candidates) {
        const action = await upsertCandidate(candidate, source, runId);
        if (action === "created") { created++; sourceCreated++; }
        else { updated++; sourceUpdated++; }
      }
      candidatesFound += candidates.length;
      sourceResults.push({ sourceId: source.id, name: source.name, url: source.url, scope: source.scope, status: "healthy", httpStatus: result.httpStatus, candidateCount: result.candidates.length, created: sourceCreated, updated: sourceUpdated, durationMs: Date.now() - sourceStarted, checkedAt: FieldValue.serverTimestamp(), error: null });
    } catch (error) {
      errors++;
      sourceResults.push({ sourceId: source.id, name: source.name, url: source.url, scope: source.scope, status: "error", candidateCount: 0, durationMs: Date.now() - sourceStarted, checkedAt: FieldValue.serverTimestamp(), error: String(error?.message || error).slice(0, 300) });
    }
    await db.collection("grantCrawlerSources").doc(source.id).set(sourceResults[sourceResults.length - 1], { merge: true });
  }
  const finalStatus = errors === SOURCES.length ? "failed" : errors ? "completed_with_errors" : "completed";
  const summary = { runId, trigger, status: finalStatus, startedAt: Timestamp.fromDate(startedAt), completedAt: FieldValue.serverTimestamp(), sourceCount: SOURCES.length, healthySources: sourceResults.filter(s => s.status === "healthy").length, failedSources: errors, candidatesFound, created, updated, errors: sourceResults.filter(s => s.error).slice(0, 30) };
  await runRef.set(summary, { merge: true });
  await statusRef.set({ active: true, status: finalStatus, currentRunId: runId, lastStartedAt: Timestamp.fromDate(startedAt), lastCompletedAt: FieldValue.serverTimestamp(), configuredSources: SOURCES.length, healthySources: summary.healthySources, failedSources: errors, candidatesFound, created, updated, schedule: "Every 6 hours", nextScheduledWindow: "Within 6 hours of the previous scheduled invocation", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log("IRPA grant crawler run complete", JSON.stringify({ runId, trigger, status: finalStatus, candidatesFound, created, updated, errors }));
  return summary;
}

exports.runGrantCrawlerScheduled = onSchedule({ schedule: "every 6 hours", timeZone: "Africa/Dar_es_Salaam", region: REGION, timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 }, async () => runGrantCrawler("scheduled"));
exports.runGrantCrawlerNow = onCall({ region: REGION, timeoutSeconds: 540, memory: "512MiB" }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to IRPA-DBGS first.");
  const token = request.auth.token || {};
  const roleText = [token.role, token.roles, token.profileRole].flat().filter(Boolean).join(" ").toLowerCase();
  const allowed = token.admin === true || token.isAdmin === true || /administrator|executive director|director outreach|fundraising officer|research director|research manager|research officer/.test(roleText);
  if (!allowed) throw new HttpsError("permission-denied", "Only authorized IRPA grant-management roles may start a manual scan.");
  return await runGrantCrawler("manual");
});
