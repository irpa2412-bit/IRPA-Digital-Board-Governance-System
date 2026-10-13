/**
 * Portal-local, read-only source registry for CSR/ESG and complementary fundraising.
 * A registry entry is a discovery route, never proof that a call is open or IRPA is eligible.
 */
export const FUNDRAISING_SOURCE_TYPES = [
  "Corporate CSR / ESG",
  "Corporate foundation",
  "Climate / environment",
  "Philanthropy",
  "Institutional / multilateral",
  "Innovation / enterprise",
  "In-kind / partnership",
];

export const FUNDRAISING_SOURCE_REGIONS = ["Tanzania", "Africa / regional", "International"];

export const FUNDRAISING_SOURCES = [
  { id: "fcs-tz", name: "Foundation for Civil Society", region: "Tanzania", type: "Philanthropy", url: "https://www.thefoundation.or.tz/what-we-do/grantmaking", focus: ["Civil society", "Community development"], support: ["Grant", "Capacity strengthening"], officialRoute: true },
  { id: "vodacom-tz", name: "Vodacom Tanzania", region: "Tanzania", type: "Corporate CSR / ESG", url: "https://www.vodacom.co.tz/", focus: ["Digital inclusion", "Community investment", "Youth"], support: ["CSR partnership", "Sponsorship", "In-kind", "Technology"], officialRoute: true },
  { id: "crdb-foundation", name: "CRDB Bank Foundation", region: "Tanzania", type: "Corporate foundation", url: "https://www.crdbbank.co.tz/", focus: ["Financial inclusion", "Entrepreneurship", "Community development"], support: ["Partnership", "Enterprise support", "Financial inclusion"], officialRoute: true },
  { id: "nmb-tz", name: "NMB Bank Tanzania", region: "Tanzania", type: "Corporate CSR / ESG", url: "https://www.nmbbank.co.tz/", focus: ["Community investment", "Financial inclusion", "Agriculture"], support: ["CSR partnership", "Sponsorship", "Technical partnership"], officialRoute: true },
  { id: "airtel-tz", name: "Airtel Tanzania", region: "Tanzania", type: "Corporate CSR / ESG", url: "https://www.airtel.co.tz/", focus: ["Digital inclusion", "Youth", "Community support"], support: ["CSR partnership", "Connectivity", "In-kind"], officialRoute: true },
  { id: "tanzania-forest-fund", name: "Tanzania Forest Fund", region: "Tanzania", type: "Climate / environment", url: "https://www.mfukowamisitu.go.tz/", focus: ["Forest conservation", "Restoration", "Environmental sustainability"], support: ["Grant", "Conservation partnership"], officialRoute: true },
  { id: "tfs", name: "Tanzania Forest Services Agency", region: "Tanzania", type: "Climate / environment", url: "https://www.tfs.go.tz/", focus: ["Forest landscape", "Tree planting", "Restoration"], support: ["Technical partnership", "Seedlings", "Knowledge exchange"], officialRoute: true },
  { id: "gepf", name: "GEF Small Grants Programme", region: "Tanzania", type: "Climate / environment", url: "https://www.thegef.org/what-we-do/topics/gef-small-grants-programme", focus: ["Community-led environment", "Biodiversity", "Climate resilience"], support: ["Grant"], officialRoute: true },
  { id: "undp-tz", name: "UNDP Tanzania", region: "Tanzania", type: "Institutional / multilateral", url: "https://www.undp.org/tanzania", focus: ["Resilience", "Inclusive development", "Climate"], support: ["Grant call", "Partnership", "Technical assistance"], officialRoute: true },
  { id: "un-partner-portal", name: "UN Partner Portal", region: "International", type: "Institutional / multilateral", url: "https://www.unpartnerportal.org/landing/opportunities/", focus: ["Civil-society partnerships", "Humanitarian and development programmes"], support: ["Partnership", "Call for proposals"], officialRoute: true },
  { id: "fao-funding", name: "FAO Funding Opportunities", region: "International", type: "Institutional / multilateral", url: "https://www.fao.org/partnerships/funding-opportunities/en", focus: ["Agriculture", "Livestock", "Food systems"], support: ["Grant call", "Technical partnership"], officialRoute: true },
  { id: "eep-africa", name: "EEP Africa", region: "Africa / regional", type: "Climate / environment", url: "https://eepafrica.org/", focus: ["Clean energy", "Climate innovation", "Energy access"], support: ["Grant", "Catalytic finance"], officialRoute: true },
  { id: "aecf", name: "African Enterprise Challenge Fund", region: "Africa / regional", type: "Innovation / enterprise", url: "https://www.aecfafrica.org/", focus: ["Agribusiness", "Resilient livelihoods", "Enterprise"], support: ["Challenge fund", "Enterprise finance"], officialRoute: true },
  { id: "african-climate-foundation", name: "African Climate Foundation", region: "Africa / regional", type: "Climate / environment", url: "https://africanclimatefoundation.org/", focus: ["Climate resilience", "Climate policy", "Just transition"], support: ["Grant", "Strategic partnership"], officialRoute: true },
  { id: "acccf", name: "Africa Climate Change Fund", region: "Africa / regional", type: "Climate / environment", url: "https://accf.afdb.org/", focus: ["Climate adaptation", "African climate action"], support: ["Grant call", "Capacity strengthening"], officialRoute: true },
  { id: "global-ebafund", name: "Global EbA Fund", region: "International", type: "Climate / environment", url: "https://globalebafund.org/", focus: ["Ecosystem-based adaptation", "Nature-based solutions"], support: ["Grant"], officialRoute: true },
  { id: "cjrf", name: "Climate Justice Resilience Fund", region: "International", type: "Philanthropy", url: "https://cjrfund.org/", focus: ["Community-led climate resilience", "Climate justice"], support: ["Grant", "Community partnership"], officialRoute: true },
  { id: "global-greengrants", name: "Global Greengrants Fund", region: "International", type: "Philanthropy", url: "https://www.greengrants.org/", focus: ["Grassroots environmental action", "Community-led conservation"], support: ["Environmental grant"], officialRoute: true },
  { id: "iucn", name: "IUCN", region: "International", type: "Climate / environment", url: "https://www.iucn.org/", focus: ["Nature conservation", "Biodiversity", "Nature-based solutions"], support: ["Grant call", "Technical partnership"], officialRoute: true },
  { id: "darwin-initiative", name: "Darwin Initiative", region: "International", type: "Climate / environment", url: "https://www.darwininitiative.org.uk/", focus: ["Biodiversity", "Livelihoods", "Conservation"], support: ["Grant"], officialRoute: true },
  { id: "global-innovation-fund", name: "Global Innovation Fund", region: "International", type: "Innovation / enterprise", url: "https://www.globalinnovation.fund/", focus: ["Development innovation", "Evidence-led impact"], support: ["Grant", "Investment", "Technical support"], officialRoute: true },
  { id: "mastercard-foundation", name: "Mastercard Foundation", region: "International", type: "Corporate foundation", url: "https://mastercardfdn.org/", focus: ["Youth employment", "Education", "Inclusive economic growth"], support: ["Programme partnership", "Youth livelihoods"], officialRoute: true },
  { id: "standard-chartered-foundation", name: "Standard Chartered Foundation", region: "International", type: "Corporate foundation", url: "https://www.sc.com/en/about/foundation/", focus: ["Employability", "Entrepreneurship", "Financial inclusion"], support: ["Partnership", "Youth enterprise"], officialRoute: true },
];

const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase();

export function isValidFundingSource(source) {
  if (!source || typeof source !== "object") return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(source.id || ""))) return false;
  if (!String(source.name || "").trim()) return false;
  if (!FUNDRAISING_SOURCE_REGIONS.includes(source.region)) return false;
  if (![...FUNDRAISING_SOURCE_TYPES].includes(source.type)) return false;
  if (source.officialRoute !== true) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateFundingSourceRegistry(sources = FUNDRAISING_SOURCES) {
  const errors = [];
  const ids = new Set();
  const urls = new Set();
  for (const source of sources) {
    if (!isValidFundingSource(source)) errors.push(`Invalid source record: ${source?.id || "(missing id)"}`);
    const id = normalize(source?.id);
    if (ids.has(id)) errors.push(`Duplicate source id: ${id}`);
    ids.add(id);
    let canonical = "";
    try {
      const parsed = new URL(source?.url);
      canonical = parsed.origin + parsed.pathname.replace(/\/$/, "");
    } catch {}
    if (canonical && urls.has(canonical)) errors.push(`Duplicate source URL: ${canonical}`);
    if (canonical) urls.add(canonical);
  }
  return errors;
}

export function searchFundingSources(sources, { query = "", region = "all", type = "all" } = {}) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return sources.filter((source) => {
    if (region !== "all" && source.region !== region) return false;
    if (type !== "all" && source.type !== type) return false;
    const haystack = normalize([
      source.name, source.region, source.type, ...(source.focus || []), ...(source.support || [])
    ].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}
