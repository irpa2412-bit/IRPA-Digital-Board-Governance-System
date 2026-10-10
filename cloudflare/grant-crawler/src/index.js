import { analyzeGrant } from "./assistant.js";
import { handleApplicationPortal } from "./application-portal-handler.js";


const FIREBASE_PROJECT_ID = "irpa-digital-board-governance";
let firebaseJwkCache = { keys: [], expiresAt: 0 };

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function verifyFirebaseIdToken(token, env, requireAdmin = false) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("A valid Firebase sign-in token is required.");
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch { throw new Error("Firebase sign-in token is malformed."); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || !header.kid || claims.aud !== FIREBASE_PROJECT_ID ||
      claims.iss !== "https://securetoken.google.com/" + FIREBASE_PROJECT_ID ||
      !claims.sub || claims.sub.length > 128 || !claims.exp || claims.exp <= now ||
      !claims.iat || claims.iat > now + 60 || !claims.auth_time || claims.auth_time > now + 60) {
    throw new Error("Firebase sign-in token is invalid or expired.");
  }
  if (!firebaseJwkCache.keys.length || firebaseJwkCache.expiresAt < now) {
    const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error("Identity verification service is temporarily unavailable.");
    const data = await response.json();
    const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/i)?.[1] || 300);
    firebaseJwkCache = { keys: data.keys || [], expiresAt: now + Math.min(Math.max(maxAge, 60), 3600) };
  }
  const jwk = firebaseJwkCache.keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) { firebaseJwkCache.expiresAt = 0; throw new Error("Firebase signing key is not recognized; retry the request."); }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = decodeBase64Url(parts[2]);
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed)) throw new Error("Firebase sign-in token signature is invalid.");
  if (requireAdmin) {
    const allowed = String(env.GRANT_CRAWLER_ADMIN_EMAILS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
    const email = String(claims.email || "").trim().toLowerCase();
    if (!claims.email_verified || !email || !allowed.includes(email)) {
      throw new Error("This signed-in account is not authorized to start a donor-source scan.");
    }
  }
  return claims;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "600",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() },
  });
}

async function listOpportunities(env) {
  if (!env.GRANTS_DB) throw new Error("The isolated staging D1 database binding is missing.");
  // Only show opportunities with affirmative Tanzania or broad regional/global eligibility evidence.
  // Country-specific and unstated-geography records remain in D1 for review/audit, but are not promoted to the portal.
  const rows = await env.GRANTS_DB.prepare(
    "SELECT id, title, description, url, published_at, source_url, fit_score, fit_assessment, fit_reasons, eligibility_status, call_status, geography_assessment, triage_assessment, deadline_at, first_seen_at, last_seen_at FROM grant_opportunities WHERE geography_assessment IN ('tanzania_mentioned', 'regional_or_lmic_scope') AND triage_assessment NOT IN ('closed_do_not_prioritize', 'low_priority', 'geographic_mismatch_review', 'deadline_unverified_suppressed') AND LOWER(COALESCE(call_status, 'unknown')) NOT IN ('closed', 'expired') AND (deadline_at IS NULL OR date(deadline_at) >= date('now', '+3 hours')) ORDER BY CASE WHEN triage_assessment = 'priority_for_eligibility_review' THEN 0 ELSE 1 END, COALESCE(deadline_at, '9999-12-31'), fit_score DESC, title COLLATE NOCASE LIMIT 250"
  ).all();
  const run = await env.GRANTS_DB.prepare(
    "SELECT status, items_seen, items_changed, error_message, finished_at FROM crawler_runs ORDER BY id DESC LIMIT 1"
  ).first();
  const currentItems = (rows.results || []).filter(item => isCurrentOpportunity(item));
  return { service: "irpa-grant-crawler", feedsConfigured: JSON.parse(env.GRANT_FEED_URLS_JSON || env.GRANT_FEED_URLS || "[]").length, items: currentItems, count: currentItems.length, suppressedExpiredOrUnverified: (rows.results || []).length - currentItems.length, lastRun: run || null };
}

const MAX_FEED_BYTES = 1_000_000;
const MAX_FEEDS = 30;
const MAX_ITEMS_PER_FEED = 100;
const USER_AGENT = "IRPA-GrantCrawler/1.0 (+https://www.irpa.or.tz)";

function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only credential-free HTTPS feed URLs are permitted.");
  if (url.port && url.port !== "443") throw new Error("Non-standard feed ports are not permitted.");
  return url;
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const match = block.match(new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>", "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseFeed(xml, sourceUrl) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)].slice(0, MAX_ITEMS_PER_FEED);
  return blocks.map((match) => {
    const block = match[2];
    const linkTag = block.match(/<link\b([^>]*)\/?\s*>/i);
    const href = linkTag?.[1]?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const rawLink = href || tag(block, "link") || tag(block, "guid") || tag(block, "id");
    let url = "";
    try {
      const parsed = new URL(rawLink, sourceUrl);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) url = parsed.href;
    } catch {}
    const title = tag(block, "title");
    const description = tag(block, "description") || tag(block, "summary") || tag(block, "content");
    const publishedAt = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || null;
    return { title: title.slice(0, 500), description: description.slice(0, 5000), url, publishedAt, sourceUrl };
  }).filter(item => item.title && item.url);
}

async function readFeeds(env) {
  let configured;
  try { configured = JSON.parse(env.GRANT_FEED_URLS_JSON || env.GRANT_FEED_URLS || "[]"); } catch { throw new Error("GRANT_FEED_URLS must be a JSON array."); }
  if (!Array.isArray(configured) || configured.length > MAX_FEEDS) throw new Error("GRANT_FEED_URLS must be an array of no more than 30 feeds.");
  const feeds = [];
  for (const entry of configured) {
    const url = safeUrl(String(entry));
    let requestUrl = url;
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(requestUrl.href, {
        headers: { "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 3) throw new Error("Feed exceeded the three-redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Feed redirected without a Location header.");
      const nextUrl = safeUrl(new URL(location, requestUrl.href).href);
      if (nextUrl.hostname !== url.hostname) throw new Error("Cross-host feed redirects are not permitted.");
      requestUrl = nextUrl;
    }
    if (!response?.ok) throw new Error("Feed request failed with HTTP " + response?.status + ".");
    const type = response.headers.get("content-type") || "";
    if (!/xml|rss|atom|text\/plain/i.test(type)) throw new Error("Feed from " + requestUrl.hostname + " did not return XML-compatible content (content type: " + (type || "missing") + ").");
    const text = await response.text();
    if (text.length > MAX_FEED_BYTES) throw new Error("Feed exceeds the 1 MB response limit.");
    feeds.push(...parseFeed(text, requestUrl.href));
  }
  return feeds;
}

function todayInTanzania() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function extractDeadline(item) {
  const structured = [item.deadline_at, item.deadline, item.closingDate, item.closeDate, item.dueDate]
    .find(value => value !== undefined && value !== null && String(value).trim() !== "");
  if (structured) {
    const candidate = String(structured).trim();
    const isoDate = candidate.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate && !Number.isNaN(Date.parse(isoDate[1] + "T00:00:00Z"))) return isoDate[1];
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(parsed);
      const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
      return values.year + "-" + values.month + "-" + values.day;
    }
  }
  const sourceText = String(item.title || "") + " " + String(item.description || "");
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const patterns = [
    /\b(?:deadline(?: date)?|submission deadline|closing date|closing on|applications? close(?:s)?|call closes|apply before|apply by|submit(?:ted)? by|due date|no later than|by)\D{0,40}?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i,
    /\b(?:deadline(?: date)?|submission deadline|closing date|closing on|applications? close(?:s)?|call closes|apply before|apply by|submit(?:ted)? by|due date|no later than|by)\D{0,40}?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i,
    /\b(?:deadline(?: date)?|submission deadline|closing date|closing on|applications? close(?:s)?|call closes|apply before|apply by|submit(?:ted)? by|due date|no later than|by)\D{0,40}?(\d{4})-(\d{2})-(\d{2})\b/i
  ];
  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (!match) continue;
    if (/^\d{4}$/.test(match[1])) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])) return date.toISOString().slice(0, 10);
      continue;
    }
    const dayFirst = /^\d+$/.test(match[1]);
    const monthToken = dayFirst ? match[2] : match[1];
    const day = Number(dayFirst ? match[1] : match[2]);
    const yearText = match[3];
    const year = yearText ? Number(yearText) : Number(todayInTanzania().slice(0, 4));
    const month = monthNames.indexOf(monthToken.toLowerCase());
    if (month < 0 || day < 1 || day > 31) continue;
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) continue;
    return date.toISOString().slice(0, 10);
  }
  return null;
}
function isCurrentOpportunity(item, today = todayInTanzania()) {
  const status = String(item.call_status || item.callStatus || "").trim().toLowerCase();
  const text = [item.title, item.description].filter(Boolean).join(" ").toLowerCase();
  if (["closed", "expired", "closed_do_not_prioritize"].includes(status) ||
      /\b(?:fund state:\s*closed|call is closed|call closed|applications? (?:are )?closed|this call has closed|deadline has passed|expired opportunity)\b/i.test(text)) return false;
  const deadline = extractDeadline(item);
  if (deadline && deadline < today) return false;
  if (deadline) return true; // Deadline is today or in the future (Tanzania local date).
  const rolling = /\b(?:rolling basis|rolling applications?|year[- ]round|open throughout the year|no fixed deadline|no application deadline)\b/i.test(text);
  return status === "open" || rolling;
}

function assessFit(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  const deadlineAt = extractDeadline(item);
  const isExpired = Boolean(deadlineAt && deadlineAt < todayInTanzania());
  const signals = [
    { label: "pastoralism/rangelands", weight: 35, terms: ["pastoral", "pastoralist", "rangeland", "herder", "grazing", "dryland", "nomadic"] },
    { label: "restoration/environment", weight: 20, terms: ["restoration", "land degradation", "biodiversity", "ecosystem", "conservation", "desertification", "reforestation", "natural resource"] },
    { label: "livestock/agriculture", weight: 15, terms: ["livestock", "animal health", "veterinary", "fodder", "agriculture", "food system", "smallholder", "value chain"] },
    { label: "market development/value addition", weight: 10, terms: ["market access", "market linkage", "market development", "value addition", "value-added", "livestock market", "leather processing", "meat processing", "market systems"] },
    { label: "governance/institutional capacity", weight: 10, terms: ["institutional strengthening", "institutional capacity", "organizational development", "organisational development", "governance", "accountability", "transparency", "board management", "nonprofit management", "non-profit management"] },
    { label: "digital governance/DBGS investment", weight: 25, terms: ["digital governance", "board management system", "board governance", "governance technology", "digital transformation", "civic technology", "cybersecurity", "cloud infrastructure", "digital public infrastructure", "nonprofit technology", "non-profit technology", "responsible ai", "software development", "digital capacity building"] },
    { label: "climate resilience", weight: 15, terms: ["climate adaptation", "climate resilience", "climate change", "drought", "resilience", "early warning"] },
    { label: "community/NGO delivery", weight: 10, terms: ["civil society", "non-governmental", "ngo", "community-led", "community based", "local communities", "indigenous peoples"] },
    { label: "women/youth inclusion", weight: 8, terms: ["women", "gender", "youth", "young people", "social inclusion"] },
    { label: "water/livelihoods", weight: 8, terms: ["water", "livelihood", "income generation", "economic empowerment", "food security"] },
    { label: "research/innovation", weight: 5, terms: ["research", "innovation", "digital", "knowledge management", "data"] },
  ];
  const matched = signals.filter(signal => signal.terms.some(term => text.includes(term)));
  const score = Math.min(100, matched.reduce((sum, signal) => sum + signal.weight, 0));
  const digitalGovernanceMatch = matched.some(signal => signal.label === "digital governance/DBGS investment");
  const strategicTrack = digitalGovernanceMatch ? "digital_governance_DBGS_investment" : "rangeland_livestock_market_and_cross_cutting";
  const fitAssessment = score >= 35 ? "strong_topic_match" : score >= 15 ? "possible_topic_match" : "low_topic_match";
  const sourceIsOpenFeed = /(?:^|[?&])fund_state=open(?:&|$)/i.test(item.sourceUrl || "");
  const callStatus = text.includes("closed")
    ? "closed"
    : isExpired
      ? "expired"
      : sourceIsOpenFeed || /fund state:\s*open|open for applications|applications are open|call is open/i.test(text)
        ? "open"
        : "unknown";
  const opportunityText = [item.title, item.description].filter(Boolean).join(" ").toLowerCase();
  const geographyText = opportunityText;
  const explicitTanzaniaEligibility = /(?:eligible countries?[^.!?]{0,100}\btanzania\b|\btanzania\b[^.!?]{0,80}(?:is an eligible country|is eligible)|applications? (?:are )?open to (?:applicants?|organisations?|organizations?|ngos?) in tanzania|applications? from tanzania|applicants? from tanzania|tanzania-based (?:ngos?|organisations?|organizations?|civil society)|(?:applicants?|organisations?|organizations?|ngos?|civil society groups?) (?:must|should|may|can) be (?:registered|based|located|operating) in tanzania|(?:registered|based|located) in tanzania[^.!?]{0,80}(?:eligible|applicants?|organisations?|organizations?|ngos?)|(?:applicants?|organisations?|organizations?|ngos?|civil society groups?)[^.!?]{0,80}(?:registered|based|located|operating)[^.!?]{0,50}\btanzania\b)/i.test(opportunityText);
  const hardCountryOnly = /\b(?:only|exclusively|restricted to|limited to|eligible only in|applicants? (?:must|should) be (?:registered|based|located) in|must be registered in|must be based in)\b[^.!?]{0,90}\b(?:south africa|south african|rsa|zimbabwe|zimbabwean)\b|\b(?:south africa|south african|rsa|zimbabwe|zimbabwean)\b[^.!?]{0,90}\b(?:only|exclusively|restricted to|limited to|based applicants?|registered applicants?|eligible applicants?|organisations? only|organizations? only)\b/i.test(geographyText);
  const regionalScope = /(?:eligible|eligibility|applicants?|organisations?|organizations?|open to|available to|applications? from|funding across|call for|within|across|throughout|for)[^.!?]{0,90}(?:east africa|east african|sub[- ]saharan africa|africa[- ]wide|across africa|pan[- ]african|continental africa|low[- ]and[- ]middle[- ]income countries|\blmics?\b|developing countries|all countries)|(?:east africa|east african|sub[- ]saharan africa|africa[- ]wide|across africa|pan[- ]african|continental africa|low[- ]and[- ]middle[- ]income countries|\blmics?\b|developing countries)[^.!?]{0,90}(?:eligible|eligibility|applicants?|organisations?|organizations?|open to|available to|funding across|call for|applications? from)|\b(?:global|worldwide|international)\s+(?:applicants?|applicant pool|eligibility|eligibility criteria)\b|\b(?:applicants?|organisations?|organizations?|applications?)\b[^.!?]{0,60}\b(?:globally|worldwide|internationally)\b|\bopen to (?:applicants?|organisations?|organizations?|applications?) worldwide\b/i.test(opportunityText);
  const countryNamePattern = /\b(?:south africa|south african|rsa|zimbabwe|zimbabwean|kenya|kenyan|uganda|ugandan|rwanda|rwandan|burundi|burundian|zambia|zambian|botswana|namibia|namibian|malawi|malawian|mozambique|mozambican|lesotho|eswatini|swaziland|angola|angolan|ethiopia|ethiopian|somalia|somalian|sudan|south sudan|ghana|nigeria|senegal|cameroon|liberia|sierra leone|gambia|guinea|mali|niger|burkina faso|benin|togo|cote d.?ivoire|ivory coast|egypt|morocco|algeria|tunisia|libya|chad|eritrea|djibouti|madagascar|mauritius|seychelles|democratic republic of the congo|drc|congo|united states of america|united states|american|canada|canadian|united kingdom|british|england|scotland|wales|northern ireland|australia|australian|new zealand|new zealander|germany|german|france|french|italy|italian|spain|spanish|portugal|portuguese|netherlands|dutch|belgium|belgian|sweden|swedish|norway|norwegian|denmark|danish|finland|finnish|switzerland|swiss|austria|austrian|poland|polish|czech republic|czechia|hungary|hungarian|romania|romanian|greece|greek|turkey|turkish|ukraine|ukrainian|russia|russian|china|chinese|india|indian|japan|japanese|south korea|korean|indonesia|indonesian|philippines|filipino|vietnam|vietnamese|thailand|thai|malaysia|malaysian|singapore|singaporean|pakistan|pakistani|bangladesh|bangladeshi|nepal|nepalese|sri lanka|sri lankan|brazil|brazilian|mexico|mexican|argentina|argentinian|chile|chilean|colombia|colombian|peru|peruvian|venezuela|venezuelan|ecuador|ecuadorian|uruguay|uruguayan|paraguay|paraguayan|bolivia|bolivian|costa rica|panama|panamanian|saudi arabia|saudi|united arab emirates|uae|qatar|kuwait|oman|bahrain|israel|israeli|palestine|palestinian|jordan|jordanian|lebanon|lebanese|iraq|iraqi|iran|iranian|afghanistan|afghan|kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|mongolia|mongolian)\b/i;
  const countryNames = countryNamePattern.test(geographyText);
  const titleText = String(item.title || "").toLowerCase();
  // A country-focused title is a hard geographic signal: generic regional wording elsewhere
  // in the description cannot make a country-specific call eligible for Tanzania.
  const countryFocusedTitle = countryNamePattern.test(titleText) &&
    !/\b(?:africa[- ]wide|pan[- ]african|east africa(?:n)?|sub[- ]saharan africa|global (?:grant|fund|call|programme|program)|worldwide (?:grant|call|eligibility)|open to applicants worldwide|regional (?:grant|fund|call|programme|program))\b/i.test(titleText);
  const geographyAssessment = hardCountryOnly || (countryFocusedTitle && !explicitTanzaniaEligibility) || (countryNames && !regionalScope && !explicitTanzaniaEligibility)
    ? "other_country_focus"
    : regionalScope
      ? "regional_or_lmic_scope"
      : explicitTanzaniaEligibility
        ? "tanzania_mentioned"
        : "not_stated";
  const rollingIntake = /\b(?:rolling basis|rolling applications?|year[- ]round|open throughout the year|no fixed deadline|no application deadline)\b/i.test(text);
  const triageAssessment = ["closed", "expired"].includes(callStatus)
    ? "closed_do_not_prioritize"
    : geographyAssessment === "other_country_focus"
      ? "geographic_mismatch_review"
      : geographyAssessment === "not_stated"
        ? "geography_unverified_suppressed"
        : callStatus === "unknown" && !deadlineAt && !rollingIntake
          ? "deadline_unverified_suppressed"
          : score >= 15
            ? "priority_for_eligibility_review"
            : "low_priority";
  return {
    score,
    fitAssessment,
    reasons: matched.map(signal => signal.label),
    strategicTrack,
    digitalGovernanceMatch,
    deadlineAt,
    callStatus,
    geographyAssessment,
    triageAssessment,
    eligibilityStatus: geographyAssessment === "other_country_focus" ? "geographic_ineligible" : geographyAssessment === "not_stated" ? "geography_unverified" : "unverified",
  };
}

async function crawl(env) {
  if (!env.GRANTS_DB) throw new Error("The isolated staging D1 database binding is missing.");
  const items = await readFeeds(env);
  const assessedItems = items.map(item => ({ ...item, fit: assessFit(item) }));
  let changed = 0;
  const matchCounts = { strong: 0, possible: 0, low: 0, priorityForReview: 0, open: 0, closed: 0, expired: 0, statusUnknown: 0, geographicMismatch: 0, geographyUnverifiedSuppressed: 0, eligibilityUnverified: 0 };
  for (const item of assessedItems) {
    const fit = item.fit;
    if (fit.fitAssessment === "strong_topic_match") matchCounts.strong++;
    else if (fit.fitAssessment === "possible_topic_match") matchCounts.possible++;
    else matchCounts.low++;
    if (fit.triageAssessment === "priority_for_eligibility_review") matchCounts.priorityForReview++;
    if (fit.callStatus === "open") matchCounts.open++;
    if (fit.callStatus === "closed") matchCounts.closed++;
    if (fit.callStatus === "expired") matchCounts.expired++;
    if (fit.callStatus === "unknown") matchCounts.statusUnknown++;
    if (fit.geographyAssessment === "other_country_focus") matchCounts.geographicMismatch++;
    if (fit.geographyAssessment === "not_stated") matchCounts.geographyUnverifiedSuppressed++;
    if (fit.eligibilityStatus === "unverified") matchCounts.eligibilityUnverified++;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.url));
    const id = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    const result = await env.GRANTS_DB.prepare(
      "INSERT INTO grant_opportunities (id, title, description, url, published_at, source_url, fit_score, fit_assessment, fit_reasons, eligibility_status, call_status, geography_assessment, triage_assessment, deadline_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description, published_at=excluded.published_at, source_url=excluded.source_url, fit_score=excluded.fit_score, fit_assessment=excluded.fit_assessment, fit_reasons=excluded.fit_reasons, eligibility_status=excluded.eligibility_status, call_status=excluded.call_status, geography_assessment=excluded.geography_assessment, triage_assessment=excluded.triage_assessment, deadline_at=excluded.deadline_at, last_seen_at=CURRENT_TIMESTAMP"
    ).bind(id, item.title, item.description, item.url, item.publishedAt, item.sourceUrl, fit.score, fit.fitAssessment, JSON.stringify(fit.reasons), fit.eligibilityStatus, fit.callStatus, fit.geographyAssessment, fit.triageAssessment, fit.deadlineAt).run();
    if (result.meta?.changes) changed += result.meta.changes;
  }
  await env.GRANTS_DB.prepare(
    "INSERT INTO crawler_runs (status, items_seen, items_changed, finished_at) VALUES ('success', ?, ?, CURRENT_TIMESTAMP)"
  ).bind(items.length, changed).run();
  const topMatches = assessedItems
    .filter(item => item.fit.score > 0 && ["tanzania_mentioned", "regional_or_lmic_scope"].includes(item.fit.geographyAssessment) && !["closed_do_not_prioritize", "low_priority"].includes(item.fit.triageAssessment))
    .sort((a, b) => {
      const priority = item => item.fit.triageAssessment === "priority_for_eligibility_review" ? 0 : 1;
      return priority(a) - priority(b) || b.fit.score - a.fit.score || a.title.localeCompare(b.title);
    })
    .slice(0, 12)
    .map(item => ({
      title: item.title,
      description: item.description,
      url: item.url,
      sourceUrl: item.sourceUrl,
      fitScore: item.fit.score,
      fitAssessment: item.fit.fitAssessment,
      fitReasons: item.fit.reasons,
      strategicTrack: item.fit.strategicTrack,
      digitalGovernanceMatch: item.fit.digitalGovernanceMatch,
      deadlineAt: item.fit.deadlineAt,
      callStatus: item.fit.callStatus,
      geographyAssessment: item.fit.geographyAssessment,
      triageAssessment: item.fit.triageAssessment,
      eligibilityStatus: item.fit.eligibilityStatus,
    }));
  return { status: "success", feedsConfigured: JSON.parse(env.GRANT_FEED_URLS_JSON || env.GRANT_FEED_URLS || "[]").length, itemsSeen: items.length, recordsChanged: changed, irpaFitMatches: matchCounts, topMatches };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/" || url.pathname === "/application" || url.pathname === "/application/" || url.pathname === "/application/drafts" || url.pathname.startsWith("/application/drafts/")) return handleApplicationPortal(request, env);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "irpa-grant-crawler", environment: env.IRPA_ENVIRONMENT || "local", storage: env.GRANTS_DB ? "configured" : "missing", ai: env.AI ? "configured" : "missing", identity: "firebase-id-token-verification-only", draftStorage: "cloudflare-d1" });
    }
    if (request.method === "GET" && url.pathname === "/opportunities") {
      try {
        const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        await verifyFirebaseIdToken(token, env, false);
        return json(await listOpportunities(env));
      } catch (error) {
        return json({ error: String(error.message || "Unable to retrieve grant results").slice(0, 300) }, 401);
      }
    }
    if (request.method !== "POST" || !["/crawl", "/run", "/assistant/analyze"].includes(url.pathname)) return json({ error: "Not found" }, 404);
    if (url.pathname === "/run") {
      try {
        const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        await verifyFirebaseIdToken(token, env, true);
      } catch (error) {
        return json({ error: String(error.message || "Unauthorized").slice(0, 300) }, 401);
      }
    } else if (url.pathname === "/assistant/analyze") {
      const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const expected = String(env.CRAWLER_CONTROL_TOKEN || "");
      if (expected.length >= 32 && token === expected) return analyzeGrant(request, env);
      try { await verifyFirebaseIdToken(token, env, false); }
      catch (error) { return json({ error: String(error.message || "A valid sign-in is required.").slice(0, 300) }, 401); }
      return analyzeGrant(request, env);
    } else {
      const expected = String(env.CRAWLER_CONTROL_TOKEN || "");
      if (expected.length < 32 || request.headers.get("authorization") !== "Bearer " + expected) return json({ error: "Unauthorized" }, 401);
    }
    try { return json(await crawl(env)); }
    catch (error) {
      if (env.GRANTS_DB) {
        try { await env.GRANTS_DB.prepare("INSERT INTO crawler_runs (status, error_message, finished_at) VALUES ('failed', ?, CURRENT_TIMESTAMP)").bind(String(error.message || "Crawler failed").slice(0, 500)).run(); } catch {}
      }
      return json({ error: String(error.message || "Crawler failed").slice(0, 500) }, 502);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(crawl(env).catch(async error => {
      if (env.GRANTS_DB) {
        try { await env.GRANTS_DB.prepare("INSERT INTO crawler_runs (status, error_message, finished_at) VALUES ('failed', ?, CURRENT_TIMESTAMP)").bind(String(error.message || "Crawler failed").slice(0, 500)).run(); } catch {}
      }
    }));
  },
};

export { assessFit, isCurrentOpportunity, parseFeed, safeUrl };
