const MAX_SOURCE_PAGES = 20;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_LINKS = 8;
const USER_AGENT = "IRPA-GrantDiscovery/1.0 (+https://www.irpa.or.tz)";
const GRANT_TERMS = /grant|funding|fund|call for proposals|call for applications|expression of interest|small grant|challenge fund|fellowship|award|open call|apply now|application window|tender opportunity/i;
const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeHtml(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, token) => {
    if (token[0] === "#") { const number = token[1].toLowerCase() === "x" ? parseInt(token.slice(2), 16) : Number(token.slice(1)); try { return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : " "; } catch { return " "; } }
    return HTML_ENTITIES[token.toLowerCase()] ?? whole;
  }).replace(/\s+/g, " ").trim();
}
export function normalizeOpportunityUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Only credential-free HTTPS opportunity URLs are permitted.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function configuredUrls(value, label, max) {
  let urls; try { urls = JSON.parse(value || "[]"); } catch { throw new Error(label + " must be a JSON array."); }
  if (!Array.isArray(urls) || urls.length > max) throw new Error(label + " must be an array with no more than " + max + " URLs.");
  return [...new Set(urls.map(entry => normalizeOpportunityUrl(String(entry))))];
}
function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (String(key || "").toLowerCase() !== name.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content).slice(0, 1200);
  }
  return "";
}
function htmlTitle(html) { return decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""); }
function getAnchors(html, baseUrl) {
  const results = [], pattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const label = decodeHtml(match[2]).slice(0, 500);
    const context = decodeHtml(html.slice(Math.max(0, match.index - 250), Math.min(html.length, match.index + match[0].length + 250))).slice(0, 1000);
    let url; try { url = normalizeOpportunityUrl(new URL(href[1] || href[2] || href[3], baseUrl).href); } catch { continue; }
    if (url === baseUrl || !label || !GRANT_TERMS.test(label + " " + url + " " + context)) continue;
    results.push({ url, label, context }); if (results.length >= 100) break;
  }
  return results;
}
async function fetchHtml(url) {
  const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const finalUrl = normalizeOpportunityUrl(response.url || url);
  if (new URL(finalUrl).hostname !== new URL(url).hostname) throw new Error("Cross-host page redirects are not permitted.");
  if (!/html|xhtml|text\/plain/i.test(response.headers.get("content-type") || "")) throw new Error("Source did not return HTML.");
  const html = await response.text(); if (html.length > MAX_PAGE_BYTES) throw new Error("Page exceeds the 1 MB response limit.");
  return { html, finalUrl };
}
export function parseOfficialPage(html, pageUrl) {
  const title = htmlTitle(html) || metaContent(html, "og:title");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const text = decodeHtml(html).slice(0, 5000);
  return { title: title.slice(0, 500), description: (description + (description && text ? " " : "") + text).slice(0, 5000), url: normalizeOpportunityUrl(pageUrl), publishedAt: null, sourceUrl: normalizeOpportunityUrl(pageUrl) };
}
export async function readOfficialPages(env) {
  const urls = configuredUrls(env.GRANT_SOURCE_PAGE_URLS_JSON || env.GRANT_SOURCE_PAGE_URLS, "GRANT_SOURCE_PAGE_URLS", MAX_SOURCE_PAGES);
  const items = [], errors = [];
  for (const sourceUrl of urls) {
    try {
      const source = await fetchHtml(sourceUrl), anchors = getAnchors(source.html, source.finalUrl), seen = new Set();
      for (const anchor of anchors) {
        if (items.length >= MAX_SOURCE_PAGES * MAX_PAGE_LINKS || seen.has(anchor.url)) continue;
        seen.add(anchor.url);
        try {
          const detail = await fetchHtml(anchor.url), parsed = parseOfficialPage(detail.html, detail.finalUrl);
          const title = parsed.title || anchor.label, description = (parsed.description + " " + anchor.context).trim().slice(0, 5000);
          if (!GRANT_TERMS.test(title + " " + description) && !/climate|pastoral|rangeland|livestock|conservation|community|women|youth|resilience|biodiversity|agriculture/i.test(title + " " + description)) continue;
          items.push({ ...parsed, title, description, sourceUrl: source.finalUrl, discoveryEngine: "official_pages" });
          if (seen.size >= MAX_PAGE_LINKS) break;
        } catch (error) { errors.push({ sourceUrl: anchor.url, error: String(error.message || error).slice(0, 180) }); }
      }
    } catch (error) { errors.push({ sourceUrl, error: String(error.message || error).slice(0, 180) }); }
  }
  return { items, stats: { configured: urls.length, scanned: urls.length, found: items.length, errors: errors.slice(0, 20) } };
}
const SEARCH_QUERIES = ['"grant call" Tanzania NGO climate pastoral livestock rangeland','"call for proposals" Africa NGO environment biodiversity restoration','foundation grants Tanzania civil society women youth livelihoods','embassy small grants Tanzania NGO community development'];
export async function readWebSearch(env) {
  const apiKey = String(env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!apiKey) return { items: [], stats: { configured: false, queries: 0, found: 0, errors: [], message: "BRAVE_SEARCH_API_KEY is not configured." } };
  const items = [], errors = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search"); url.searchParams.set("q", query); url.searchParams.set("count", "10"); url.searchParams.set("country", "ALL"); url.searchParams.set("search_lang", "en");
      const response = await fetch(url.href, { headers: { "X-Subscription-Token": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("Search API HTTP " + response.status);
      const body = await response.json();
      for (const result of body.web?.results || []) {
        let resultUrl; try { resultUrl = normalizeOpportunityUrl(result.url); } catch { continue; }
        const title = decodeHtml(result.title || "").slice(0, 500), description = decodeHtml(result.description || "").slice(0, 5000);
        if (!title || (!GRANT_TERMS.test(title + " " + description) && !/climate|pastoral|rangeland|livestock|conservation|community|women|youth|resilience|biodiversity|agriculture/i.test(title + " " + description))) continue;
        items.push({ title, description, url: resultUrl, publishedAt: result.page_age || null, sourceUrl: "https://search.brave.com/search?q=" + encodeURIComponent(query), discoveryEngine: "web_search" });
      }
    } catch (error) { errors.push({ query, error: String(error.message || error).slice(0, 180) }); }
  }
  return { items, stats: { configured: true, queries: SEARCH_QUERIES.length, found: items.length, errors } };
}
