
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
  if (now - claims.auth_time > 60 * 60 * 24 * 7) throw new Error("Sign in again before using grant scanning.");
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
  const rows = await env.GRANTS_DB.prepare(
    "SELECT id, title, description, url, published_at, source_url, fit_score, fit_assessment, fit_reasons, eligibility_status, call_status, geography_assessment, triage_assessment, deadline_at, first_seen_at, last_seen_at FROM grant_opportunities ORDER BY CASE WHEN triage_assessment = 'priority_for_eligibility_review' THEN 0 WHEN triage_assessment = 'manual_eligibility_review' THEN 1 ELSE 2 END, COALESCE(deadline_at, '9999-12-31'), fit_score DESC, title COLLATE NOCASE LIMIT 250"
  ).all();
  const run = await env.GRANTS_DB.prepare(
    "SELECT status, items_seen, items_changed, error_message, finished_at FROM crawler_runs ORDER BY id DESC LIMIT 1"
  ).first();
  return { service: "irpa-grant-crawler", items: rows.results || [], count: (rows.results || []).length, lastRun: run || null };
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

function extractDeadline(item) {
  const text = String(item.title || "") + " " + String(item.description || "");
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const patterns = [
    /\b(?:by|deadline(?: date)?|submission deadline|closing date|due date|submit(?:ted)? by)\D{0,40}?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i,
    /\b(?:by|deadline(?: date)?|submission deadline|closing date|due date|submit(?:ted)? by)\D{0,40}?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const dayFirst = /^\d+$/.test(match[1]);
    const monthToken = dayFirst ? match[2] : match[1];
    const day = Number(dayFirst ? match[1] : match[2]);
    const yearText = match[3];
    const year = yearText ? Number(yearText) : new Date().getUTCFullYear();
    const month = monthNames.indexOf(monthToken.toLowerCase());
    if (month < 0 || day < 1 || day > 31) continue;
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) continue;
    return date.toISOString().slice(0, 10);
  }
  const iso = text.match(/\b(?:deadline|due|submit by|closing date)\D{0,30}?(\d{4})-(\d{2})-(\d{2})/i);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  return null;
}
function assessFit(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  const deadlineAt = extractDeadline(item);
  const isExpired = Boolean(deadlineAt && deadlineAt < new Date().toISOString().slice(0, 10));
  const signals = [
    { label: "pastoralism/rangelands", weight: 35, terms: ["pastoral", "pastoralist", "rangeland", "herder", "grazing", "dryland", "nomadic"] },
    { label: "restoration/environment", weight: 20, terms: ["restoration", "land degradation", "biodiversity", "ecosystem", "conservation", "desertification", "reforestation", "natural resource"] },
    { label: "livestock/agriculture", weight: 15, terms: ["livestock", "animal health", "veterinary", "fodder", "agriculture", "food system", "smallholder", "value chain"] },
    { label: "climate resilience", weight: 15, terms: ["climate adaptation", "climate resilience", "climate change", "drought", "resilience", "early warning"] },
    { label: "community/NGO delivery", weight: 10, terms: ["civil society", "non-governmental", "ngo", "community-led", "community based", "local communities", "indigenous peoples"] },
    { label: "women/youth inclusion", weight: 8, terms: ["women", "gender", "youth", "young people", "social inclusion"] },
    { label: "water/livelihoods", weight: 8, terms: ["water", "livelihood", "income generation", "economic empowerment", "food security"] },
    { label: "research/innovation", weight: 5, terms: ["research", "innovation", "digital", "knowledge management", "data"] },
  ];
  const matched = signals.filter(signal => signal.terms.some(term => text.includes(term)));
  const score = Math.min(100, matched.reduce((sum, signal) => sum + signal.weight, 0));
  const fitAssessment = score >= 35 ? "strong_topic_match" : score >= 15 ? "possible_topic_match" : "low_topic_match";
  const sourceIsOpenFeed = /(?:^|[?&])fund_state=open(?:&|$)/i.test(item.sourceUrl || "");
  const callStatus = text.includes("closed")
    ? "closed"
    : isExpired
      ? "expired"
      : sourceIsOpenFeed || /fund state:\s*open|open for applications|applications are open|call is open/i.test(text)
        ? "open"
        : "unknown";
  const tanzaniaMentioned = /\btanzania\b|united republic of tanzania/i.test(text);
  const otherCountryFocus = /\b(kenya|uganda|south africa|west africa|sudan|albania|rwanda|bangladesh|morocco|nepal)\b/i.test(text);
  const regionalScope = /east africa|sub-saharan africa|africa-wide|across africa|global|worldwide|low[- ]and[- ]middle[- ]income|\blmic\b|developing countries/i.test(text);
  const geographyAssessment = tanzaniaMentioned
    ? "tanzania_mentioned"
    : otherCountryFocus && !regionalScope
      ? "other_country_focus"
      : regionalScope
        ? "regional_or_lmic_scope"
        : "not_stated";
  const triageAssessment = ["closed", "expired"].includes(callStatus)
    ? "closed_do_not_prioritize"
    : geographyAssessment === "other_country_focus"
      ? "geographic_mismatch_review"
      : score >= 15 && ["tanzania_mentioned", "regional_or_lmic_scope"].includes(geographyAssessment)
        ? "priority_for_eligibility_review"
        : score >= 15
          ? "manual_eligibility_review"
          : "low_priority";
  return {
    score,
    fitAssessment,
    reasons: matched.map(signal => signal.label),
    deadlineAt,
    callStatus,
    geographyAssessment,
    triageAssessment,
    eligibilityStatus: "unverified",
  };
}

async function crawl(env) {
  if (!env.GRANTS_DB) throw new Error("The isolated staging D1 database binding is missing.");
  const items = await readFeeds(env);
  const assessedItems = items.map(item => ({ ...item, fit: assessFit(item) }));
  let changed = 0;
  const matchCounts = { strong: 0, possible: 0, low: 0, priorityForReview: 0, open: 0, closed: 0, expired: 0, statusUnknown: 0, geographicMismatch: 0, eligibilityUnverified: 0 };
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
    matchCounts.eligibilityUnverified++;
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
    .filter(item => item.fit.score > 0 && !["closed_do_not_prioritize", "low_priority"].includes(item.fit.triageAssessment))
    .sort((a, b) => {
      const priority = item => item.fit.triageAssessment === "priority_for_eligibility_review" ? 0 : 1;
      return priority(a) - priority(b) || b.fit.score - a.fit.score || a.title.localeCompare(b.title);
    })
    .slice(0, 12)
    .map(item => ({
      title: item.title,
      url: item.url,
      fitScore: item.fit.score,
      fitAssessment: item.fit.fitAssessment,
      fitReasons: item.fit.reasons,
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
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "irpa-grant-crawler", environment: env.IRPA_ENVIRONMENT || "local", storage: env.GRANTS_DB ? "configured" : "missing", firebase: "disabled-by-design-until-dedicated-rules-and-identity-are-approved" });
    }
    if (request.method === "GET" && url.pathname === "/opportunities") {
      try {
        const token = String(request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
        await verifyFirebaseIdToken(token, env, false);
        return json(await listOpportunities(env));
      } catch (error) {
        return json({ error: String(error.message || "Unable to retrieve grant results").slice(0, 300) }, 401);
      }
    }
    if (request.method !== "POST" || !["/crawl", "/run"].includes(url.pathname)) return json({ error: "Not found" }, 404);
    if (url.pathname === "/run") {
      try {
        const token = String(request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
        await verifyFirebaseIdToken(token, env, true);
      } catch (error) {
        return json({ error: String(error.message || "Unauthorized").slice(0, 300) }, 401);
      }
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

export { assessFit, parseFeed, safeUrl };
