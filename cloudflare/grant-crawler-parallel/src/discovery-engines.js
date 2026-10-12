const MAX_SOURCE_PAGES = 20;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_LINKS = 8;
const MAX_TOTAL_DETAIL_PAGES = 2;
const MAX_SOURCE_PAGES_PER_RUN = 4;
const USER_AGENT = "IRPA-GrantDiscovery/1.0 (+https://www.irpa.or.tz)";
const GRANT_TERMS = /grant|funding|fund|call for proposals|call for applications|request for proposals|request for applications|expression of interest|small grant|challenge fund|fellowship|award|open call|apply now|application window|tender opportunity|rolling calls?|rolling basis|rolling applications?|year.round applications?|ongoing calls?|continuous application|no fixed deadline|deadline|closing date|capacity building|seed funding|pastoralism|pastoralist|rangeland|dryland|grazing|land restoration|land degradation|invasive species|grassland|livestock|animal health|veterinary|fodder|forage|livestock market|value chain|value addition|meat processing|dairy|leather|hides and skins|market access|market systems|climate adaptation|climate resilience|drought|early warning|water security|biodiversity|ecosystem restoration|nature-based solutions|agroecology|irrigation|women.s empowerment|gender equality|gender equity|social inclusion|disability inclusion|indigenous peoples|youth|young people|women-led|community-led|community based|civil society|local organizations|livelihoods?|food security|nutrition|renewable energy|solar energy|energy access|entrepreneurship|economic empowerment|research|innovation|knowledge management|digital inclusion|community development/i;
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
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[")) throw new Error("Local and IP-literal URLs are not permitted.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function isSpecificOpportunity(title = "", description = "") {
  const titleText = String(title).trim();
  const bodyText = String(description).trim();
  const combined = titleText + " " + bodyText;
  const explicitCallTitle = /\b(call for proposals|call for applications|grant call|open grant|grant opportunity|funding opportunity|grant fund|small grants? (?:programme|program|fund)|open call|request for proposals|expression of interest|funding call|applications open|apply now|submit proposals|challenge fund|grant competition|award competition|funding available|funding announcement|grantmaking opportunity|grant programme|grant program|rolling call|rolling grant|seed funding|capacity building grant)\b/i.test(titleText);
  const fundingSignal = /\b(grant|funding|funds|fund|proposal|application|award|fellowship|small grants?|financial support|call for|open call|donor opportunity|financing|seed funding|capacity building)\b/i.test(combined);
  const actionableSignal = /\b(deadline|due date|closing date|apply by|submit (?:by|before)|applications? close|applications? due|application window|closes on|closing on|submission deadline|eligible applicants?|eligibility|apply|applications? (?:are )?open|invites? proposals?|seeking proposals?|call for proposals|funding opportunity|grant opportunity|small grants?|funding available|now accepting|rolling basis|rolling applications?|rolling call|year.round applications?|accepting applications year.round|ongoing applications?|continuous application|no fixed deadline)\b/i.test(combined);
  const institutionalSignal = /\b(grants?|funding|call for proposals|funding opportunities|financial support|small grants?)\b/i.test(titleText);
  return explicitCallTitle || (fundingSignal && actionableSignal) || institutionalSignal;
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
  return { html, finalUrl, status: response.status };
}
export function parseOfficialPage(html, pageUrl) {
  const title = htmlTitle(html) || metaContent(html, "og:title");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const text = decodeHtml(html).slice(0, 5000);
  return { title: title.slice(0, 500), description: (description + (description && text ? " " : "") + text).slice(0, 5000), url: normalizeOpportunityUrl(pageUrl), publishedAt: null, sourceUrl: normalizeOpportunityUrl(pageUrl) };
}
export async function readOfficialPages(env) {
  const urls = configuredUrls(env.GRANT_SOURCE_PAGE_URLS_JSON || env.GRANT_SOURCE_PAGE_URLS, "GRANT_SOURCE_PAGE_URLS", MAX_SOURCE_PAGES);
  // Rotate through the full configured source registry across six-hour runs.
  // This bounds per-invocation subrequests while still checking every configured source over successive runs.
  const rotation = urls.length ? Math.floor(Date.now() / (6 * 60 * 60 * 1000)) * MAX_SOURCE_PAGES_PER_RUN % urls.length : 0;
  const selectedUrls = Array.from({ length: Math.min(MAX_SOURCE_PAGES_PER_RUN, urls.length) }, (_, index) => urls[(rotation + index) % urls.length]);
  const errors = [];
  const sources = await Promise.all(selectedUrls.map(async sourceUrl => {
    try {
      const source = await fetchHtml(sourceUrl);
      const sourceHost = new URL(source.finalUrl).hostname;
      const anchors = getAnchors(source.html, source.finalUrl)
        .filter(anchor => new URL(anchor.url).hostname === sourceHost)
        .slice(0, MAX_PAGE_LINKS);
      return { sourceUrl: source.finalUrl, anchors };
    } catch (error) {
      errors.push({ sourceUrl, error: String(error.message || error).slice(0, 180) });
      return { sourceUrl, anchors: [] };
    }
  }));
  // Round-robin across configured donor pages and cap detail requests. This keeps
  // the combined feed + page + search scan below Cloudflare's subrequest ceiling.
  const selected = [];
  for (let index = 0; selected.length < MAX_TOTAL_DETAIL_PAGES; index++) {
    let added = false;
    for (const source of sources) {
      if (source.anchors[index]) {
        selected.push({ sourceUrl: source.sourceUrl, anchor: source.anchors[index] });
        added = true;
        if (selected.length >= MAX_TOTAL_DETAIL_PAGES) break;
      }
    }
    if (!added) break;
  }
  const results = await Promise.all(selected.map(async ({ sourceUrl, anchor }) => {
    try {
      const detail = await fetchHtml(anchor.url);
      const parsed = parseOfficialPage(detail.html, detail.finalUrl);
      const title = parsed.title || anchor.label;
      const description = (parsed.description + " " + anchor.context).trim().slice(0, 5000);
      if (!isSpecificOpportunity(title, description)) return null;
      return { ...parsed, title, description, sourceUrl, discoveryEngine: "official_pages" };
    } catch (error) {
      errors.push({ sourceUrl: anchor.url, error: String(error.message || error).slice(0, 180) });
      return null;
    }
  }));
  const items = results.filter(Boolean);
  return { items, stats: { configured: urls.length, scanned: selectedUrls.length, configuredSources: urls.length, sourcesScanned: selectedUrls, detailPagesScanned: selected.length, found: items.length, errors: errors.slice(0, 20) } };
}

export const DONOR_SCANNERS = [
  { name: "japan_embassy", label: "Japan Embassy Grassroots Grants", url: "https://www.tz.emb-japan.go.jp/e_bilateral/kusanone_en.htm" },
  { name: "canada_funding", label: "Canada International Funding Calls", url: "https://www.international.gc.ca/world-monde/funding-financement/open_calls-appels_ouverts.aspx?lang=eng" },
  { name: "usadf_grants", label: "U.S. African Development Foundation", url: "https://www.usadf.gov/apply/" },
  { name: "un_tanzania", label: "United Nations Tanzania Calls", url: "https://tanzania.un.org/en" },
  { name: "undp_tanzania", label: "UNDP Tanzania Opportunities", url: "https://www.undp.org/tanzania/news-centre" },
  { name: "gef_small_grants", label: "GEF Small Grants Programme", url: "https://www.thegef.org/what-we-do/topics/gef-small-grants-programme" },
  { name: "fao_funding", label: "FAO Funding Opportunities", url: "https://fao-grants.smapply.io/" },
  { name: "eu_tanzania", label: "EU Delegation Tanzania", url: "https://www.eeas.europa.eu/tanzania_en" },
  { name: "tanzania_forest_fund", label: "Tanzania Forest Fund", url: "https://www.mfukowamisitu.go.tz/download-center" },
  { name: "world_bank_funding", label: "World Bank Funding Opportunities", url: "https://projects.worldbank.org/en/projects-operations/opportunities" },
  { name: "fundsforngos_latest", label: "FundsforNGOs Latest Funding Opportunities", url: "https://www2.fundsforngos.org/" },
  { name: "fundsforngos_africa", label: "FundsforNGOs Current Funding Listings", url: "https://www2.fundsforngos.org/category/listing/" },
  { name: "fundsforngos_tanzania", label: "FundsforNGOs Tanzania Funding Calls", url: "https://www2.fundsforngos.org/listing/new-grant-funding-opportunities-for-tanzania-in-2026/" },
  { name: "fundsforngos_news", label: "FundsforNGOs Funding News", url: "https://news.fundsforngos.org/" },
  { name: "africanngos_roundups", label: "AfricanNGOs Funding Roundups", url: "https://africanngos.org/" },
  { name: "ngo_portal_africa", label: "NGO Portal Africa Funding Calls", url: "https://jobs.ngoportal.africa/grants-funding/" },
  { name: "awdf_grants", label: "African Women’s Development Fund", url: "https://awdf.org/what-we-do/resourcing/" },
  { name: "urgent_action_fund_africa", label: "Urgent Action Fund Africa", url: "https://www.uaf-africa.org/apply-for-a-grant/" },
  { name: "rufford_grants", label: "Rufford Foundation Conservation Grants", url: "https://www.rufford.org/" },
  { name: "awhf_grants", label: "African World Heritage Fund Grants", url: "https://awhf.net/grants/" },
  { name: "gfcf_grants", label: "Global Fund for Community Foundations", url: "https://globalfundcommunityfoundations.org/what-we-do/grants/" },
  { name: "mbz_species_grants", label: "Mohamed bin Zayed Species Conservation Fund", url: "https://www.speciesconservation.org/" },
  { name: "africa_climate_change_fund", label: "Africa Climate Change Fund — AfDB", url: "https://accf.afdb.org/" },
  { name: "global_eba_fund", label: "Global EbA Fund Small-Size Grants", url: "https://globalebafund.org/small-size-grants/" },
  { name: "climate_justice_resilience_fund", label: "Climate Justice Resilience Fund — East Africa", url: "https://cjrfund.org/our-grants/" },
  { name: "whitley_fund_for_nature", label: "Whitley Fund for Nature — Conservation Awards", url: "https://whitleyaward.org/apply-for-conservation-funding/" },
];

export async function readDonorScanner(scanner) {
  const errors = [];
  let warningMessage = null;
  let httpStatus = null;
  let pagesScanned = 0;
  let sourceUrl = scanner.url;
  try {
    sourceUrl = normalizeOpportunityUrl(scanner.url);
    const source = await fetchHtml(sourceUrl);
    pagesScanned = 1;
    httpStatus = source.status ?? 200;
    sourceUrl = source.finalUrl;
    const sourceHost = new URL(source.finalUrl).hostname;
    const anchors = getAnchors(source.html, source.finalUrl)
      .filter(anchor => new URL(anchor.url).hostname === sourceHost)
      .slice(0, 20);
    const items = [];
    const self = parseOfficialPage(source.html, source.finalUrl);
    const isAggregator = /(?:^|\.)(?:fundsforngos\.org|africanngos\.org|ngoportal\.africa)$/i.test(new URL(source.finalUrl).hostname);
    // Aggregator articles are discovery leads, not the opportunity issuance.
    // Resolve the article and extract an external application/call URL; never
    // make a FundsforNGOs listing the primary tap target.
    if (!isAggregator && isSpecificOpportunity(self.title, self.description)) {
      items.push({ ...self, sourceUrl, discoveryEngine: scanner.name, originalOpportunityUrl: self.url });
    }
    let detailPagesScanned = 0;
    for (const anchor of anchors) {
      const title = String(anchor.label || "").trim().slice(0, 500);
      const description = String(anchor.context || "").trim().slice(0, 5000);
      if (!title || !isSpecificOpportunity(title, description)) continue;
      if (isAggregator) {
        if (detailPagesScanned >= 1) continue;
        try {
          const detail = await fetchHtml(anchor.url);
          detailPagesScanned++;
          pagesScanned++;
          const detailParsed = parseOfficialPage(detail.html, detail.finalUrl);
          const detailHost = new URL(detail.finalUrl).hostname;
          const outgoing = getAnchors(detail.html, detail.finalUrl).filter(candidate => {
            const host = new URL(candidate.url).hostname;
            return host !== detailHost &&
              /apply|application|submit|official call|grant|funding|proposal|guidelines|opportunity|call for/i.test(candidate.label + " " + candidate.context) &&
              !/(?:fundsforngos\.org|facebook\.com|linkedin\.com|instagram\.com|youtube\.com|twitter\.com|x\.com)$/i.test(host);
          });
          const original = outgoing.find(candidate => /apply|application|submit|official call|application form|apply here/i.test(candidate.label + " " + candidate.context)) || outgoing[0];
          if (!original) {
            // Never promote a directory/listing page as the apply target. Search
            // for the original issuer URL when an aggregator article has no outbound call link.
            const query = scanner.label + " grant funding opportunity Tanzania Africa";
            try {
              const searchUrl = new URL("https://www.bing.com/search");
              searchUrl.searchParams.set("format", "rss");
              searchUrl.searchParams.set("q", query);
              const response = await fetch(searchUrl.href, {
                headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": USER_AGENT },
                signal: AbortSignal.timeout(12_000),
              });
              if (!response.ok) throw new Error("Bing RSS fallback HTTP " + response.status);
              const xml = await response.text();
              if (xml.length > MAX_PAGE_BYTES) throw new Error("Bing RSS fallback response exceeds the 1 MB limit.");
              const fallbackItems = parseSearchRss(xml, query, "Bing RSS").map(item => ({
                ...item,
                discoveryEngine: scanner.name,
                primarySourceUrl: scanner.url,
                fallbackProvider: "Bing RSS",
              }));
              if (fallbackItems.length) items.push(...fallbackItems);
              else warningMessage = "No original issuer URL was present in the aggregator article; Bing RSS fallback found no matching call.";
            } catch (error) {
              errors.push({ sourceUrl: detail.finalUrl, error: String(error.message || error).slice(0, 180) });
            }
            continue;
          }
          const opportunityTitle = detailParsed.title || title;
          const opportunityDescription = (detailParsed.description + " " + description).trim().slice(0, 5000);
          if (!isSpecificOpportunity(opportunityTitle, opportunityDescription)) continue;
          items.push({
            title: opportunityTitle,
            description: opportunityDescription,
            url: original.url,
            originalOpportunityUrl: original.url,
            publishedAt: detailParsed.publishedAt || null,
            sourceUrl: detail.finalUrl,
            discoverySourceUrl: sourceUrl,
            discoveryEngine: scanner.name,
            eligibilityEvidence: "Original issuer/application URL extracted from aggregator article; confirm call status and eligibility.",
          });
        } catch (error) {
          errors.push({ sourceUrl: anchor.url, error: String(error.message || error).slice(0, 180) });
        }
        continue;
      }
      items.push({
        title,
        description,
        url: anchor.url,
        originalOpportunityUrl: anchor.url,
        publishedAt: null,
        sourceUrl,
        discoveryEngine: scanner.name,
        eligibilityEvidence: "Source link extracted; verify it opens the original call or application page.",
      });
    }
    const unique = [...new Map(items.map(item => [item.url, item])).values()];
    return {
      items: unique,
      stats: {
        configured: 1,
        scanned: pagesScanned,
        pagesScanned,
        httpStatus,
        detailPagesScanned,
        found: unique.length,
        message: warningMessage,
        errors,
      },
    };
  } catch (error) {
    const primarySourceError = String(error.message || error).slice(0, 180);
    const statusMatch = primarySourceError.match(/HTTP (\d{3})/);
    const primaryHttpStatus = statusMatch ? Number(statusMatch[1]) : null;
    // Some official donor sites reject automated Worker requests (403) or move
    // their landing pages (404). Fall back to a live Bing RSS query, explicitly
    // retaining the primary failure in telemetry instead of masking it.
    try {
      const query = scanner.label + " grant funding opportunity Tanzania Africa";
      const searchUrl = new URL("https://www.bing.com/search");
      searchUrl.searchParams.set("format", "rss");
      searchUrl.searchParams.set("q", query);
      const response = await fetch(searchUrl.href, {
        headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("Bing RSS fallback HTTP " + response.status);
      const xml = await response.text();
      if (xml.length > MAX_PAGE_BYTES) throw new Error("Bing RSS fallback response exceeds the 1 MB limit.");
      const items = parseSearchRss(xml, query, "Bing RSS").map(item => ({
        ...item,
        discoveryEngine: scanner.name,
        primarySourceUrl: scanner.url,
        fallbackProvider: "Bing RSS",
      }));
      return {
        items,
        stats: {
          configured: 1,
          scanned: 1,
          pagesScanned: 1,
          httpStatus: response.status,
          primaryHttpStatus,
          primarySourceError,
          fallbackProvider: "Bing RSS",
          detailPagesScanned: 0,
          found: items.length,
          errors: [],
        },
      };
    } catch (fallbackError) {
      errors.push({ sourceUrl, error: primarySourceError });
      errors.push({ sourceUrl: "https://www.bing.com/search?format=rss", error: String(fallbackError.message || fallbackError).slice(0, 180) });
      return {
        items: [],
        stats: {
          configured: 1,
          scanned: pagesScanned,
          pagesScanned,
          httpStatus: primaryHttpStatus,
          primaryHttpStatus,
          primarySourceError,
          fallbackProvider: "Bing RSS",
          detailPagesScanned: 0,
          found: 0,
          errors,
        },
      };
    }
  }
}

export const SEARCH_QUERIES = [
  '"call for proposals" OR grant OR funding pastoralism rangeland grazing dryland restoration "pastoral mobility" "communal rangelands" "invasive plant species" Maasai Tanzania East Africa',
  '"livestock development" OR "animal health" OR "veterinary services" OR "livestock breeding" OR "fodder banks" OR forage grants Tanzania Africa',
  '"livestock market" OR "market access" OR "value addition" OR "livestock value chain" OR "hides and skins" OR "meat processing" OR leather dairy funding Africa',
  '"climate adaptation" OR drought OR "early warning" OR "water security" OR "renewable energy" OR solar grant Tanzania East Africa',
  '"biodiversity conservation" OR "ecosystem restoration" OR "invasive species" OR "nature-based solutions" funding Africa',
  '"women-led" OR youth OR "gender equality" OR "social inclusion" OR "women economic empowerment" OR "youth groups" OR GESI grants livelihoods Tanzania Africa',
  '"Indigenous Peoples" OR pastoralist OR "community-led" grants climate resilience East Africa',
  '"market systems" OR "market linkages" OR "small enterprise" OR entrepreneurship OR "seed funding" OR "capacity building grant" women youth Africa',
  '"research grant" OR innovation OR "knowledge management" OR "community monitoring" rangeland livestock Africa',
  '"rolling call for proposals" OR "rolling grant" OR "rolling basis" OR "year-round applications" NGO Africa',
  '"no fixed deadline" OR "ongoing applications" OR "rolling applications" grant funding Tanzania Africa',
  '"call for proposals" OR "application deadline" OR "closing date" grant climate livestock rangeland Tanzania Africa'
];
const SEARCH_BATCH_SIZE = 4;
function activeSearchQueries() {
  const batchCount = Math.ceil(SEARCH_QUERIES.length / SEARCH_BATCH_SIZE);
  const batch = Math.floor(Date.now() / (6 * 60 * 60 * 1000)) % batchCount;
  const start = batch * SEARCH_BATCH_SIZE;
  return SEARCH_QUERIES.slice(start, Math.min(start + SEARCH_BATCH_SIZE, SEARCH_QUERIES.length));
}
export const GDELT_QUERIES = [
  '("call for proposals" OR grant OR funding) AND (pastoralism OR rangeland OR dryland OR grazing) AND (Tanzania OR "East Africa" OR Africa)',
  '(grant OR funding OR "call for applications") AND (livestock OR veterinary OR fodder OR "animal health") AND (Tanzania OR Africa)',
  '(grant OR funding OR "call for proposals") AND ("market access" OR "value addition" OR "livestock market" OR leather OR dairy) AND Africa',
  '(grant OR funding OR "call for proposals") AND (women OR youth OR gender OR "Indigenous Peoples" OR "social inclusion") AND (climate OR livelihoods OR biodiversity) AND Africa',
  '(rolling OR "year-round" OR "no fixed deadline") AND (grant OR funding OR "call for proposals") AND (NGO OR civil society OR Africa)',
  '(deadline OR "closing date") AND ("call for proposals" OR grant) AND ("climate adaptation" OR water OR resilience OR restoration) AND Africa'
];

function xmlField(block, name) {
  const pattern = "<" + name + "\\b[^>]*>([\\s\\S]*?)<\\/" + name + "\\s*>";
  const match = block.match(new RegExp(pattern, "i"));
  return match ? decodeHtml(match[1]) : "";
}
export function parseSearchRss(xml, query, provider = "Google News RSS") {
  const sourceUrl = provider === "Bing RSS"
    ? "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query)
    : "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=en-TZ&gl=TZ&ceid=TZ:en";
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].slice(0, 20).map(match => {
    const block = match[1], title = xmlField(block, "title").slice(0, 500);
    let url = ""; try { url = normalizeOpportunityUrl(xmlField(block, "link")); } catch {}
    const description = xmlField(block, "description").slice(0, 5000);
    const publisher = block.match(/<source\b[^>]*\burl=["']([^"']+)["']/i)?.[1];
    let verifiedSourceUrl = sourceUrl;
    try { if (publisher) verifiedSourceUrl = normalizeOpportunityUrl(publisher); } catch {}
    if (!title || !url || !isSpecificOpportunity(title, description)) return null;
    return { title, description, url, publishedAt: xmlField(block, "pubDate") || null, sourceUrl: verifiedSourceUrl, discoveryEngine: "web_search" };
  }).filter(Boolean);
}
async function readGoogleNewsSearch() {
  const results = await Promise.all(activeSearchQueries().map(async query => {
    try {
      const url = new URL("https://news.google.com/rss/search");
      url.searchParams.set("q", query); url.searchParams.set("hl", "en-TZ"); url.searchParams.set("gl", "TZ"); url.searchParams.set("ceid", "TZ:en");
      const response = await fetch(url.href, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("Google News search HTTP " + response.status);
      const xml = await response.text();
      if (xml.length > MAX_PAGE_BYTES) throw new Error("Search response exceeds the 1 MB limit.");
      return { items: parseSearchRss(xml, query), error: null };
    } catch (error) { return { items: [], error: { query, error: String(error.message || error).slice(0, 180) } }; }
  }));
  const items = results.flatMap(result => result.items), errors = results.filter(result => result.error).map(result => result.error);
  return { items, stats: { configured: true, provider: "Google News RSS", queries: activeSearchQueries().length, queryCatalogSize: SEARCH_QUERIES.length, found: items.length, errors } };
}
async function readBingSearch() {
  const results = await Promise.all(activeSearchQueries().map(async query => {
    try {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("format", "rss"); url.searchParams.set("q", query);
      const response = await fetch(url.href, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("Bing RSS search HTTP " + response.status);
      const xml = await response.text();
      if (xml.length > MAX_PAGE_BYTES) throw new Error("Search response exceeds the 1 MB limit.");
      return { items: parseSearchRss(xml, query, "Bing RSS"), error: null };
    } catch (error) { return { items: [], error: { query, error: String(error.message || error).slice(0, 180) } }; }
  }));
  const items = results.flatMap(result => result.items), errors = results.filter(result => result.error).map(result => result.error);
  return { items, stats: { configured: true, provider: "Bing RSS", queries: activeSearchQueries().length, queryCatalogSize: SEARCH_QUERIES.length, found: items.length, errors } };
}
export async function readGdeltSearch() {
  const batchCount = Math.ceil(GDELT_QUERIES.length / SEARCH_BATCH_SIZE);
  const batch = Math.floor(Date.now() / (6 * 60 * 60 * 1000)) % batchCount;
  const queries = GDELT_QUERIES.slice(batch * SEARCH_BATCH_SIZE, Math.min((batch + 1) * SEARCH_BATCH_SIZE, GDELT_QUERIES.length));
  const settled = await Promise.all(queries.map(async query => {
    try {
      const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
      url.searchParams.set("query", query);
      url.searchParams.set("mode", "ArtList");
      url.searchParams.set("format", "json");
      url.searchParams.set("maxrecords", "10");
      url.searchParams.set("sort", "HybridRel");
      url.searchParams.set("timespan", "1y");
      const response = await fetch(url.href, { headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("GDELT search HTTP " + response.status);
      const body = await response.json();
      const items = (Array.isArray(body.articles) ? body.articles : []).map(article => {
        let articleUrl = ""; try { articleUrl = normalizeOpportunityUrl(article.url); } catch {}
        const title = decodeHtml(article.title || "").slice(0, 500);
        const description = [article.domain, article.sourceCountry, article.language].filter(Boolean).join(" · ").slice(0, 1000);
        const dateText = String(article.seendate || "");
        const publishedAt = /^\d{8}T\d{6}Z$/.test(dateText)
          ? dateText.slice(0, 4) + "-" + dateText.slice(4, 6) + "-" + dateText.slice(6, 8) + "T" + dateText.slice(9, 11) + ":" + dateText.slice(11, 13) + ":" + dateText.slice(13, 15) + "Z"
          : null;
        if (!title || !articleUrl || !isSpecificOpportunity(title, description)) return null;
        return { title, description, url: articleUrl, publishedAt, sourceUrl: articleUrl, discoveryEngine: "gdelt_search", discoveryEvidence: "GDELT index result; verify the linked publisher page and original issuer call before applying." };
      }).filter(Boolean);
      return { items, error: null };
    } catch (error) {
      return { items: [], error: { query, error: String(error.message || error).slice(0, 180) } };
    }
  }));
  const items = [...new Map(settled.flatMap(result => result.items).map(item => [item.url, item])).values()];
  const errors = settled.filter(result => result.error).map(result => result.error);
  return { items, stats: { configured: true, provider: "GDELT DOC API", queries: queries.length, queryCatalogSize: GDELT_QUERIES.length, found: items.length, errors } };
}

export async function readWebSearch(env) {
  const apiKey = String(env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!apiKey) {
    const google = await readGoogleNewsSearch();
    if (google.items.length > 0 || google.stats.errors.length === 0 && google.stats.found > 0) return google;
    const bing = await readBingSearch();
    if (bing.items.length || bing.stats.errors.length === 0) return bing;
    return { items: [], stats: { configured: true, provider: "Google News RSS / Bing RSS", queries: activeSearchQueries().length, queryCatalogSize: SEARCH_QUERIES.length, found: 0, errors: [...google.stats.errors, ...bing.stats.errors] } };
  }
  const results = await Promise.all(activeSearchQueries().map(async query => {
    const items = [];
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query); url.searchParams.set("count", "10"); url.searchParams.set("country", "ALL"); url.searchParams.set("search_lang", "en");
      const response = await fetch(url.href, { headers: { "X-Subscription-Token": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("Search API HTTP " + response.status);
      const body = await response.json();
      for (const result of body.web?.results || []) {
        let resultUrl; try { resultUrl = normalizeOpportunityUrl(result.url); } catch { continue; }
        const title = decodeHtml(result.title || "").slice(0, 500), description = decodeHtml(result.description || "").slice(0, 5000);
        if (!title || !isSpecificOpportunity(title, description)) continue;
        items.push({ title, description, url: resultUrl, publishedAt: result.page_age || null, sourceUrl: "https://search.brave.com/search?q=" + encodeURIComponent(query), discoveryEngine: "web_search" });
      }
      return { items, error: null };
    } catch (error) { return { items: [], error: { query, error: String(error.message || error).slice(0, 180) } }; }
  }));
  const errors = results.filter(result => result.error).map(result => result.error), items = results.flatMap(result => result.items);
  return { items, stats: { configured: true, provider: "Brave Search API", queries: activeSearchQueries().length, queryCatalogSize: SEARCH_QUERIES.length, found: items.length, errors } };
}


export async function searchFundraisingSources(query, mode = "all") {
 const cleanQuery=String(query||"").replace(/[<>]/g," ").replace(/\s+/g," ").trim().slice(0,240);
 if(cleanQuery.length<2)throw new Error("Enter at least two characters to search fundraising sources.");
 const safeMode=["all","rolling","deadlines","corporate_support"].includes(mode)?mode:"all";
 const region='(Tanzania OR "East Africa" OR Africa)';
 const core='(grant OR funding OR donor OR foundation OR philanthropy OR partnership OR sponsorship OR CSR)';
 const q1=cleanQuery+" "+core+" "+region;
 const q2=safeMode==="rolling"?cleanQuery+' ("rolling basis" OR "year-round" OR "no fixed deadline") '+region:safeMode==="deadlines"?cleanQuery+' (deadline OR "closing date" OR "call for proposals") '+region:safeMode==="corporate_support"?cleanQuery+' ("corporate social responsibility" OR CSR OR sponsorship OR philanthropy OR "in-kind support") '+region:cleanQuery+' ("funding opportunity" OR "partnership opportunity" OR "call for proposals" OR sponsorship OR philanthropy) '+region;
 const queries=[safeMode==="all"?q1:q2];
 const tasks=queries.flatMap(searchQuery=>[
  (async()=>{try{
   const url=new URL("https://news.google.com/rss/search");url.searchParams.set("q",searchQuery);url.searchParams.set("hl","en-TZ");url.searchParams.set("gl","TZ");url.searchParams.set("ceid","TZ:en");
   let provider="Google News RSS";
   let response=await fetch(url.href,{headers:{accept:"application/rss+xml, application/xml, text/xml","user-agent":USER_AGENT},signal:AbortSignal.timeout(12000)});
   if(!response.ok){
    const bingUrl=new URL("https://www.bing.com/search");bingUrl.searchParams.set("format","rss");bingUrl.searchParams.set("q",searchQuery);
    response=await fetch(bingUrl.href,{headers:{accept:"application/rss+xml, application/xml, text/xml","user-agent":USER_AGENT},signal:AbortSignal.timeout(12000)});
    provider="Bing RSS fallback";
   }
   if(!response.ok)throw new Error(provider+" HTTP "+response.status);
   const xml=await response.text();if(xml.length>MAX_PAGE_BYTES)throw new Error("Search response exceeds 1 MB.");
   const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map(match=>{
    const block=match[1],title=xmlField(block,"title").slice(0,500),description=xmlField(block,"description").slice(0,2500);let url="";try{url=normalizeOpportunityUrl(xmlField(block,"link"))}catch{}
    const signal=/\b(grant|funding|donor|foundation|philanthrop|csr|corporate social responsibility|sponsorship|partnership|in[- ]kind|award|fellowship|accelerator|rolling|deadline|call for proposals|funding opportunity)\b/i;
    if(!title||!url||!signal.test(title+" "+description))return null;
    const sm=block.match(/<source\b[^>]*\burl=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source\s*>/i);let sourceUrl=provider==="Bing RSS fallback"?"https://www.bing.com/":"https://news.google.com/";try{if(sm?.[1])sourceUrl=normalizeOpportunityUrl(sm[1])}catch{}
    const value=title+" "+description;
    return {title,description,url,sourceUrl,sourceName:sm?decodeHtml(sm[2]).slice(0,120):provider+" indexed source",publishedAt:xmlField(block,"pubDate")||null,discoveryEngine:provider==="Bing RSS fallback"?"bing_rss":"google_news_rss",fundraisingType:/\b(csr|corporate social responsibility|sponsorship|in[- ]kind)\b/i.test(value)?"Corporate partnership / CSR":/\b(partnership|philanthrop)\b/i.test(value)?"Partnership / philanthropy":"Grant / funding lead",deadlineSignal:/\b(rolling basis|rolling applications?|rolling grants?|rolling calls?|year[- ]round|no fixed deadline|ongoing applications)\b/i.test(value)?"Possible rolling opportunity — verify issuer page":/\b(deadline|closing date|apply by|due date|applications close)\b/i.test(value)?"Deadline language detected — verify exact date":"Deadline not established from search result",verificationStatus:"unverified_lead",searchQuery};
   }).filter(Boolean);
   return {provider,searchQuery,items,error:null};
  }catch(error){return {provider:"Google News RSS",searchQuery,items:[],error:String(error.message||error).slice(0,180)}}})(),
  (async()=>{try{
   const url=new URL("https://api.gdeltproject.org/api/v2/doc/doc");const q="("+cleanQuery.replace(/["']/g," ")+") AND (grant OR funding OR donor OR foundation OR philanthropy OR partnership OR sponsorship OR CSR) AND (Tanzania OR \"East Africa\" OR Africa)"+(safeMode==="rolling"?' AND (rolling OR "year-round" OR "no fixed deadline")':safeMode==="deadlines"?' AND (deadline OR "closing date" OR "call for proposals")':safeMode==="corporate_support"?' AND (CSR OR sponsorship OR philanthropy OR partnership OR "in-kind")':"");
   url.searchParams.set("query",q);url.searchParams.set("mode","ArtList");url.searchParams.set("format","json");url.searchParams.set("maxrecords","20");url.searchParams.set("sort","HybridRel");url.searchParams.set("timespan","1y");
   const response=await fetch(url.href,{headers:{accept:"application/json","user-agent":USER_AGENT},signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error("GDELT HTTP "+response.status);const body=await response.json();
   const items=(Array.isArray(body.articles)?body.articles:[]).map(article=>{let url="";try{url=normalizeOpportunityUrl(article.url)}catch{}const title=decodeHtml(article.title||"").slice(0,500),description=[article.domain,article.sourceCountry,article.language].filter(Boolean).join(" · ").slice(0,1000);const signal=/\b(grant|funding|donor|foundation|philanthrop|csr|corporate social responsibility|sponsorship|partnership|in[- ]kind|award|fellowship|accelerator|rolling|deadline|call for proposals|funding opportunity)\b/i;if(!title||!url||!signal.test(title+" "+description))return null;const date=String(article.seendate||""),publishedAt=/^\d{8}T\d{6}Z$/.test(date)?date.slice(0,4)+"-"+date.slice(4,6)+"-"+date.slice(6,8)+"T"+date.slice(9,11)+":"+date.slice(11,13)+":"+date.slice(13,15)+"Z":null;const value=title+" "+description;return {title,description,url,sourceUrl:url,sourceName:article.domain||"GDELT indexed publisher",publishedAt,discoveryEngine:"gdelt_search",fundraisingType:/\b(csr|corporate social responsibility|sponsorship|in[- ]kind)\b/i.test(value)?"Corporate partnership / CSR":/\b(partnership|philanthrop)\b/i.test(value)?"Partnership / philanthropy":"Grant / funding lead",deadlineSignal:/\b(rolling basis|rolling applications?|rolling grants?|rolling calls?|year[- ]round|no fixed deadline|ongoing applications)\b/i.test(value)?"Possible rolling opportunity — verify issuer page":/\b(deadline|closing date|apply by|due date|applications close)\b/i.test(value)?"Deadline language detected — verify exact date":"Deadline not established from search result",verificationStatus:"unverified_lead",searchQuery}});
   return {provider:"GDELT DOC API",searchQuery,items:items.filter(Boolean),error:null};
  }catch(error){return {provider:"GDELT DOC API",searchQuery,items:[],error:String(error.message||error).slice(0,180)}}})()
 ]);
 const results=await Promise.all(tasks),unique=new Map(),terms=cleanQuery.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2);
 for(const result of results)for(const item of result.items){const key=item.url.replace(/[?#].*$/,"").replace(/\/$/,""),all=(item.title+" "+item.description).toLowerCase();item.relevanceScore=terms.reduce((n,t)=>n+(all.includes(t)?2:0),0);const prior=unique.get(key);if(!prior||item.relevanceScore>prior.relevanceScore)unique.set(key,item)}
 const items=[...unique.values()].sort((a,b)=>b.relevanceScore-a.relevanceScore||String(b.publishedAt||"").localeCompare(String(a.publishedAt||""))).slice(0,20);
 return {query:cleanQuery,mode:safeMode,providers:[...new Set(results.map(r=>r.provider))],items,resultCount:items.length,errors:results.filter(r=>r.error).map(r=>({provider:r.provider,query:r.searchQuery,error:r.error}))};
}
