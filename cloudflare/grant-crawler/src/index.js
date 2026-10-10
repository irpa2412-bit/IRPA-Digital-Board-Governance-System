const MAX_FEED_BYTES = 1_000_000;
const MAX_FEEDS = 30;
const MAX_ITEMS_PER_FEED = 100;
const USER_AGENT = "IRPA-GrantCrawler/1.0 (+https://www.irpa.or.tz)";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

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

function assessFit(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
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
  return {
    score,
    fitAssessment,
    reasons: matched.map(signal => signal.label),
    eligibilityStatus: "unverified",
  };
}

async function crawl(env) {
  if (!env.GRANTS_DB) throw new Error("The isolated staging D1 database binding is missing.");
  const items = await readFeeds(env);
  const assessedItems = items.map(item => ({ ...item, fit: assessFit(item) }));
  let changed = 0;
  const matchCounts = { strong: 0, possible: 0, low: 0, eligibilityUnverified: 0 };
  for (const item of assessedItems) {
    const fit = item.fit;
    if (fit.fitAssessment === "strong_topic_match") matchCounts.strong++;
    else if (fit.fitAssessment === "possible_topic_match") matchCounts.possible++;
    else matchCounts.low++;
    matchCounts.eligibilityUnverified++;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.url));
    const id = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    const result = await env.GRANTS_DB.prepare(
      "INSERT INTO grant_opportunities (id, title, description, url, published_at, source_url, fit_score, fit_assessment, fit_reasons, eligibility_status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description, published_at=excluded.published_at, source_url=excluded.source_url, fit_score=excluded.fit_score, fit_assessment=excluded.fit_assessment, fit_reasons=excluded.fit_reasons, eligibility_status=excluded.eligibility_status, last_seen_at=CURRENT_TIMESTAMP"
    ).bind(id, item.title, item.description, item.url, item.publishedAt, item.sourceUrl, fit.score, fit.fitAssessment, JSON.stringify(fit.reasons), fit.eligibilityStatus).run();
    if (result.meta?.changes) changed += result.meta.changes;
  }
  await env.GRANTS_DB.prepare(
    "INSERT INTO crawler_runs (status, items_seen, items_changed, finished_at) VALUES ('success', ?, ?, CURRENT_TIMESTAMP)"
  ).bind(items.length, changed).run();
  const topMatches = assessedItems
    .filter(item => item.fit.score > 0)
    .sort((a, b) => b.fit.score - a.fit.score || a.title.localeCompare(b.title))
    .slice(0, 12)
    .map(item => ({
      title: item.title,
      url: item.url,
      fitScore: item.fit.score,
      fitAssessment: item.fit.fitAssessment,
      fitReasons: item.fit.reasons,
      eligibilityStatus: item.fit.eligibilityStatus,
    }));
  return { status: "success", feedsConfigured: JSON.parse(env.GRANT_FEED_URLS_JSON || env.GRANT_FEED_URLS || "[]").length, itemsSeen: items.length, recordsChanged: changed, irpaFitMatches: matchCounts, topMatches };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "irpa-grant-crawler", environment: env.IRPA_ENVIRONMENT || "local", storage: env.GRANTS_DB ? "configured" : "missing", firebase: "disabled-by-design-until-dedicated-rules-and-identity-are-approved" });
    }
    if (request.method !== "POST" || url.pathname !== "/crawl") return json({ error: "Not found" }, 404);
    const expected = String(env.CRAWLER_CONTROL_TOKEN || "");
    if (expected.length < 32 || request.headers.get("authorization") !== "Bearer " + expected) return json({ error: "Unauthorized" }, 401);
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
