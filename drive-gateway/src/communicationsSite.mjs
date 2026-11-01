import { sanitizeWebsiteSvg, validateWebsiteMedia, websiteMediaSha256, validateMediaChunk } from "./websiteMedia.mjs";
const AUTHOR_ROLES = new Set([
  "Communication & Media", "Communications & Media", "Communication and Media", "Communications and Media",
  "Communications Officer", "Communication Officer", "Communications Manager", "Communication Manager",
  "Media Officer", "Media Manager", "Communications & Media Officer", "Communications and Media Officer",
  "Media and Communications Officer", "Media & Communications Officer", "Public Relations Officer",
  "Director Outreach", "Outreach Director", "Director Community Development", "Community Development Director",
  "Executive Director", "Administrator"
]);
const REVIEW_ROLES = new Set([
  "Executive Director", "Director Outreach", "Outreach Director",
  "Director Community Development", "Community Development Director", "Approver", "Administrator"
]);
const EDITABLE_EXTENSIONS = new Set([".html", ".htm", ".css", ".txt", ".json"]);
const MAX_EDIT_BYTES = 512 * 1024;
const WEBSITE_EDITOR_ROLES = new Set(["Administrator", "Communications Officer", "Executive Director"]);
const WEBSITE_EDITOR_ROLE_ALIASES = new Map([
  ["communication & media", "Communications Officer"], ["communications & media", "Communications Officer"],
  ["communication and media", "Communications Officer"], ["communications and media", "Communications Officer"],
  ["communication officer", "Communications Officer"], ["communications manager", "Communications Officer"],
  ["communication manager", "Communications Officer"], ["media officer", "Communications Officer"],
  ["media manager", "Communications Officer"], ["public relations officer", "Communications Officer"],
  ["communications & media officer", "Communications Officer"], ["communications and media officer", "Communications Officer"],
  ["media and communications officer", "Communications Officer"], ["media & communications officer", "Communications Officer"]
]);
function canonicalWebsiteRole(role) {
  const value = String(role || "").trim();
  return WEBSITE_EDITOR_ROLE_ALIASES.get(value.toLowerCase()) || value;
}
const MAX_WEBSITE_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function values(record) {
  if (!record) return [];
  return [
    record.role, record.title, record.position, record.departmentalRole,
    ...(Array.isArray(record.roles) ? record.roles : []),
    ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : [])
  ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()).filter(Boolean));
}
function active(record) {
  return !!record && (["Active", "Activated"].includes(String(record.status || "")) ||
    record.registrationStatus === "Activated" || record.employmentStatus === "Active");
}
function field(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (typeof value === "object") return { mapValue: { fields: fields(value) } };
  return { stringValue: String(value) };
}
function fields(record) {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, field(v)]));
}
function cleanText(value, max = 30000) {
  return String(value || "").trim().slice(0, max);
}
function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function plainContent(body) {
  return body.split(/\n{2,}/).map(p => "<p>" + htmlEscape(p).replace(/\n/g, "<br>") + "</p>").join("\n");
}
function sanitizeWordPressContent(value) {
  const allowedTags = new Set(["p","br","h1","h2","h3","h4","h5","h6","strong","b","em","i","u","ul","ol","li","blockquote","a","img","figure","figcaption","div","span","table","thead","tbody","tr","th","td","hr","pre","code","sup","sub"]);
  const allowedAttributes = new Set(["href","src","alt","title","width","height","target","rel","class","id","colspan","rowspan"]);
  const voidTags = new Set(["br","img","hr"]);
  const input = String(value || "").slice(0, MAX_EDIT_BYTES);
  return input.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?\s*([a-z0-9-]+)\b([^>]*)>/gi, (whole, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!allowedTags.has(tag)) return "";
    if (/^<\s*\//.test(whole)) return voidTags.has(tag) ? "" : "</" + tag + ">";
    const attrs = [];
    rawAttrs.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g, (_match, rawName, doubleValue, singleValue, bareValue) => {
      const name = rawName.toLowerCase();
      if (!allowedAttributes.has(name)) return "";
      let value = String(doubleValue ?? singleValue ?? bareValue ?? "").trim();
      if (["href","src"].includes(name)) {
        const decoded = value.replace(/&#x([0-9a-f]+);?/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
          .replace(/&#([0-9]+);?/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
          .replace(/&colon;/gi, ":").replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        const allowedUrl = /^https:\/\//.test(decoded) || /^\/(?!\/)/.test(decoded) || (name === "href" && (/^#/.test(decoded) || /^mailto:/.test(decoded) || /^tel:/.test(decoded)));
        if (!allowedUrl) return "";
      }
      if (name === "target" && !["_blank","_self"].includes(value)) return "";
      if (name === "class" || name === "id") value = value.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 150);
      if (["width","height","colspan","rowspan"].includes(name) && !/^\d{1,4}$/.test(value)) return "";
      value = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      attrs.push(" " + name + '="' + value + '"');
      return "";
    });
    if (tag === "a" && attrs.some(attr => attr.startsWith(' target="_blank"')) && !attrs.some(attr => attr.startsWith(" rel="))) attrs.push(' rel="noopener noreferrer"');
    return "<" + tag + attrs.join("") + ">";
  });
}
function safeCpanelPath(input, root) {
  const raw = String(input || "").replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.includes("\0") || raw.split("/").some(p => !p || p === "." || p === ".." || p.startsWith("."))) {
    throw new Error("Invalid website file path.");
  }
  const filename = raw.split("/").pop();
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  if (!EDITABLE_EXTENSIONS.has(ext) || /\.(php\d*|phtml|phar|cgi|pl|sh|htaccess|ini)$/i.test(filename)) {
    throw new Error("Only HTML, CSS, TXT and JSON website files can be edited through this portal.");
  }
  const base = String(root || "public_html").replace(/^\/+|\/+$/g, "");
  return { dir: base + (raw.includes("/") ? "/" + raw.split("/").slice(0, -1).join("/") : ""), file: filename, relative: raw };
}
function safeCpanelDirectory(input, root) {
  const raw = String(input || "").replace(/\\/g, "/").trim();
  if (!raw) return String(root || "public_html").replace(/^\/+|\/+$/g, "");
  if (raw.startsWith("/") || raw.includes("\0") || raw.split("/").some(p => !p || p === "." || p === ".." || p.startsWith("."))) {
    throw new Error("Invalid website directory path.");
  }
  return String(root || "public_html").replace(/^\/+|\/+$/g, "") + "/" + raw;
}

function authHeader(username, token) {
  return "cpanel " + username + ":" + token;
}

export function createCommunicationsSiteRouter(deps) {
  const {
    authenticateFirebaseRequest, getFirestoreDocument, getFirestoreAdminAccessToken, getInstitutionalProfileForUser,
    firestoreDocumentToPlain, commitDocumentAndAudit, json, corsHeaders
  } = deps;

  async function authorised(request, env, reviewer = false) {
    const claims = await authenticateFirebaseRequest(request, env);
    const adminDocument = await getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token);
    const adminProfile = firestoreDocumentToPlain(adminDocument);
    const activeAdmin = adminProfile?.active === true;
    const identity = activeAdmin ? null : await getInstitutionalProfileForUser(env, claims);
    const member = firestoreDocumentToPlain(identity?.memberRecord);
    const employee = firestoreDocumentToPlain(identity?.employeeRecord);
    const tokenRoles = [
      ...(Array.isArray(claims.irpaRoles) ? claims.irpaRoles : []),
      claims.role, claims.title, claims.position
    ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()));
    const roles = [...new Set([...tokenRoles, ...values(member), ...values(employee), ...(activeAdmin ? ["Administrator"] : [])])];
    const isActive = activeAdmin || active(member) || active(employee);
    const hasRole = [...(reviewer ? REVIEW_ROLES : AUTHOR_ROLES)].some(r => roles.includes(r));
    if (!hasRole || !isActive) {
      throw new Error("Your registered IRPA role does not permit this website-management action.");
    }
    return { claims, roles };
  }

  async function websiteEditorAuthorised(request, env) {
    const claims = await authenticateFirebaseRequest(request, env);
    const adminDocument = await getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token);
    const adminProfile = firestoreDocumentToPlain(adminDocument);
    const activeAdmin = adminProfile?.active === true;
    if (activeAdmin) return { claims, roles: ["Administrator"], admin: true };
    const identity = await getInstitutionalProfileForUser(env, claims);
    const member = firestoreDocumentToPlain(identity?.memberRecord);
    const employee = firestoreDocumentToPlain(identity?.employeeRecord);
    const tokenRoles = [
      ...(Array.isArray(claims.irpaRoles) ? claims.irpaRoles : []),
      claims.role, claims.title, claims.position
    ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()).filter(Boolean));
    const rawRoles = [...new Set([...tokenRoles, ...values(member), ...values(employee)])];
    const roles = [...new Set(rawRoles.map(canonicalWebsiteRole))];
    const isActive = active(member) || active(employee);
    if (!isActive || !roles.some(role => WEBSITE_EDITOR_ROLES.has(role))) {
      const required = "website.content.draft_edit";
      const holders = [...WEBSITE_EDITOR_ROLES].join(", ");
      throw new Error("Your registered Communication & Media role does not permit this website-editing action. Effective roles: " + (roles.join(", ") || "none") + "; required capability: " + required + "; roles holding capability: " + holders + "; active profile: " + String(isActive) + ".");
    }
    return { claims, roles, admin: false };
  }

  function configurationError(code, message, status = 503) {
    return Object.assign(new Error(message), { status, diagnosticCode: code });
  }

  function wordpressConfig(env) {
    const required = ["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD"];
    const missing = required.filter(name => !String(env?.[name] || "").trim());
    if (missing.length) throw configurationError("credentials_missing", "Required WordPress settings are missing: " + missing.join(", ") + ".");
    const rawEndpoint = String(env.WORDPRESS_BASE_URL || "").trim();
    const normalizedEndpoint = rawEndpoint.replace(/\/wp-json\/?$/i, "").replace(/\/+$/, "");
    let base;
    try { base = new URL(normalizedEndpoint); }
    catch { throw configurationError("endpoint_invalid_url", "WORDPRESS_BASE_URL is not a valid absolute URL."); }
    if (base.protocol !== "https:") throw configurationError("endpoint_not_https", "WORDPRESS_BASE_URL must use HTTPS.");
    if (base.username || base.password) throw configurationError("endpoint_contains_url_credentials", "WORDPRESS_BASE_URL must not contain embedded username or password fields.");
    if (base.search) throw configurationError("endpoint_contains_query", "WORDPRESS_BASE_URL must not contain a query string.");
    if (base.hash) throw configurationError("endpoint_contains_fragment", "WORDPRESS_BASE_URL must not contain a URL fragment.");
    if (base.port) throw configurationError("endpoint_nonstandard_port", "WORDPRESS_BASE_URL must use the standard HTTPS port.");
    if (base.pathname !== "/") throw configurationError("endpoint_has_path", "WORDPRESS_BASE_URL must be the website origin only; remove paths such as /wp-admin or /wp-json.");
    const environment = String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").trim().toLowerCase();
    const host = base.hostname.toLowerCase();
    if (!["production", "staging"].includes(environment)) {
      throw configurationError("worker_environment_missing_or_invalid", "Set IRPA_WORKER_ENVIRONMENT to exactly production or staging.");
    }
    if (environment === "production" && !["irpa.or.tz", "www.irpa.or.tz"].includes(host)) {
      throw configurationError("wordpress_host_not_allowed_for_environment", "Production permits only irpa.or.tz or www.irpa.or.tz; the configured hostname does not match.");
    }
    if (environment === "staging" && host !== "staging.irpa.or.tz") {
      throw configurationError("wordpress_host_not_allowed_for_environment", "Staging permits only staging.irpa.or.tz; the configured hostname does not match.");
    }
    const username = String(env.WORDPRESS_USERNAME || "").trim().replace(/[\r\n]+/g, "");
    const rawPassword = String(env.WORDPRESS_APPLICATION_PASSWORD || "").trim();
    const password = rawPassword.replace(/\s/g, "");
    return {
      root: base.origin, hostname: host, environment,
      auth: "Basic " + btoa(unescape(encodeURIComponent(username + ":" + password))),
      stagingAuthHeader: host === "staging.irpa.or.tz",
      secretChecks: {
        baseUrl: { present: !!rawEndpoint, https: base.protocol === "https:", hasWpJsonSuffix: /\/wp-json\/?$/i.test(rawEndpoint), canonicalOriginOnly: base.pathname === "/" },
        username: { present: !!username, length: username.length },
        applicationPassword: { present: !!password, length: password.length, containsSpaces: /\s/.test(rawPassword), expectedLength: password.length === 24 }
      }
    };
  }

  function wordpressHeaders(wp, extra = {}) {
    const headers = { Authorization: wp.auth, ...extra };
    // Staging nginx/FastCGI strips Authorization before PHP; forward it under a
    // staging-only header validated by the isolated staging MU-plugin.
    if (wp.stagingAuthHeader) headers["X-IRPA-Staging-Authorization"] = wp.auth;
    return headers;
  }

  function websiteWordPressConfig(env) {
    const wp = wordpressConfig(env);
    const base = new URL(wp.root);
    if (base.pathname !== "/") {
      throw configurationError("endpoint_has_path", "WORDPRESS_BASE_URL must be the website origin only; remove paths such as /wp-admin or /wp-json.");
    }
    if (base.hostname.toLowerCase() !== wp.hostname) {
      throw configurationError("endpoint_hostname_mismatch", "The parsed WordPress endpoint hostname does not match the validated hostname.");
    }
    return wp;
  }

  async function wordpressEditorFetch(wp, endpoint, init = {}) {
    const target = new URL(endpoint);
    if (target.protocol !== "https:" || target.hostname.toLowerCase() !== wp.hostname || target.port || target.username || target.password) {
      throw new Error("WordPress editor request attempted to leave the configured HTTPS host.");
    }
    return fetch(target.toString(), { ...init, redirect: "manual" });
  }

  async function verifyDedicatedWordPressEditor(wp) {
    const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/users/me?context=edit", {
      headers: wordpressHeaders(wp, { Accept: "application/json", "Cache-Control": "no-cache" }),
      signal: AbortSignal.timeout(12000)
    });
    const user = await response.json().catch(() => null);
    if (!response.ok || !Number.isSafeInteger(user?.id)) {
      throw new Error("Configured WordPress authentication failed; the integration account was not verified.");
    }
    const roles = Array.isArray(user.roles) ? user.roles.map(role => String(role).toLowerCase()) : [];
    if (!roles.includes("editor") || roles.includes("administrator")) {
      throw new Error("The WordPress integration account must have the Editor role and must not be an Administrator.");
    }
    return user;
  }

  function safeWordPressUrl(value, fallback = "") {
    try {
      const url = new URL(String(value || fallback));
      return url.origin + url.pathname.replace(/\/$/, "") + (url.search ? "?[query-redacted]" : "");
    } catch { return fallback || "unavailable"; }
  }

  function sanitizedWordPressBody(raw, wp) {
    let value = String(raw || "");
    if (wp?.auth) value = value.split(wp.auth).join("[redacted-auth]");
    for (const secret of [wp?.username, wp?.password].filter(Boolean)) value = value.split(secret).join("[redacted]");
    value = value.replace(/(authorization\s*[:=]\s*)([^,\s]+)/gi, "$1[redacted]")
      .replace(/(application[_ -]?password\s*[:=]\s*)([^,\s]+)/gi, "$1[redacted]")
      .replace(/(password\s*[:=]\s*)([^,\s]+)/gi, "$1[redacted]");
    return value.slice(0, 1024);
  }

  function wordpressErrorFinding(status, code, message, body) {
    const normalized = String(code || "").toLowerCase();
    const detail = cleanText(message, 220).replace(/[\r\n]/g, " ");
    if (["incorrect_password", "invalid_username"].includes(normalized)) {
      return { code: normalized, finding: "WordPress rejected the username or Application Password. Verify the integration username and rotate the Application Password." };
    }
    if (["rest_cannot_view", "rest_forbidden", "application_passwords_disabled"].includes(normalized)) {
      return { code: normalized, finding: "WordPress denied REST access. Check the integration user's Editor/Administrator role and whether Application Passwords are enabled." };
    }
    if ((status === 401 || status === 403) && (!String(body || "").trim() || !normalized)) {
      return { code: normalized || "authentication_rejected_empty_body", finding: "No WordPress REST error JSON was returned. The Authorization header may be stripped by Apache/LiteSpeed/PHP, or a WAF/proxy may be intercepting the request." };
    }
    if (status === 401) return { code: normalized || "authentication_rejected", finding: "WordPress returned HTTP 401. Check credentials and Authorization-header forwarding." + (detail ? " WordPress message: " + detail : "") };
    if (status === 403) return { code: normalized || "rest_forbidden", finding: "WordPress returned HTTP 403. Check the integration user's role, REST permissions and security-plugin rules." + (detail ? " WordPress message: " + detail : "") };
    return { code: normalized || "wordpress_http_" + status, finding: detail || "WordPress returned HTTP " + status + "." };
  }

  function cpanelConfig(env) {
    const configuredEndpoint = String(env.CPANEL_BASE_URL || "").trim();
    if (!configuredEndpoint) throw configurationError("cpanel_base_url_missing", "CPANEL_BASE_URL is not set.");
    let base;
    try {
      const endpoint = /^[a-z0-9.-]+$/i.test(configuredEndpoint)
        ? "https://" + configuredEndpoint
        : configuredEndpoint;
      base = new URL(endpoint);
    } catch {
      throw configurationError("cpanel_base_url_invalid_url", "CPANEL_BASE_URL is not a valid hostname or absolute URL.");
    }
    if (base.protocol === "https:" && !base.port) base.port = "2083";
    if (base.protocol !== "https:") throw configurationError("cpanel_endpoint_not_https", "CPANEL_BASE_URL must use HTTPS.");
    if (!base.hostname) throw configurationError("cpanel_endpoint_hostname_missing", "CPANEL_BASE_URL has no hostname.");
    if (base.username || base.password) throw configurationError("cpanel_endpoint_contains_url_credentials", "CPANEL_BASE_URL must not embed credentials.");
    if (base.search || base.hash) throw configurationError("cpanel_endpoint_has_query_or_fragment", "CPANEL_BASE_URL must not contain a query or fragment.");
    if (base.pathname !== "/") throw configurationError("cpanel_endpoint_has_path", "CPANEL_BASE_URL must be an origin only, without a path.");
    if (base.port !== "2083") throw configurationError("cpanel_endpoint_wrong_port", "cPanel API connections must use HTTPS port 2083.");
    const username = String(env.CPANEL_USERNAME || "").trim();
    const token = String(env.CPANEL_API_TOKEN || "").trim();
    if (!username || !token) throw configurationError("cpanel_credentials_missing", "Required cPanel settings are missing: " + [!username && "CPANEL_USERNAME", !token && "CPANEL_API_TOKEN"].filter(Boolean).join(", "));
    const environment = String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").trim().toLowerCase();
    if (!["production", "staging"].includes(environment)) throw configurationError("worker_environment_missing_or_invalid", "Set IRPA_WORKER_ENVIRONMENT to exactly production or staging.");
    const configuredRoot = String(env.CPANEL_DOCUMENT_ROOT || (environment === "production" ? "public_html" : "public_html/staging")).trim().replace(/\\/g, "/").replace(/\/+$/g, "");
    const allowedRoots = environment === "production" ? ["public_html", "home/" + username + "/public_html", "/home/" + username + "/public_html"] :
      ["public_html/staging", "home/" + username + "/public_html/staging", "/home/" + username + "/public_html/staging"];
    if (!allowedRoots.includes(configuredRoot)) throw configurationError("cpanel_document_root_invalid_for_environment", "CPANEL_DOCUMENT_ROOT does not match the permitted " + environment + " document root.");
    const documentRoot = "public_html" + (environment === "staging" ? "/staging" : "");
    return { root: base.origin + "/execute", username, token, documentRoot };
  }

  async function cpanelCall(config, operation, params = {}, method = "GET") {
    const url = new URL(config.root + "/" + operation);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) body.set(key, String(value));
    const response = await fetch(method === "GET" ? (url.search = body.toString(), url) : url, {
      method, headers: {
        Authorization: authHeader(config.username, config.token),
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
      },
      ...(method === "POST" ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || (!Array.isArray(data) && data.status !== 1)) {
      const status = Number.isInteger(response.status) ? response.status : 0;
      const uapiStatus = data && Number.isInteger(data.status) ? data.status : "unknown";
      const errorCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      const errorText = Array.isArray(data?.errors) ? data.errors.join(" ").toLowerCase() : "";
      const category = /permission|access denied|not authorized|not allowed/.test(errorText) ? "permission_denied" :
        /not found|does not exist|no such file|cannot find/.test(errorText) ? "not_found" :
        /invalid|unsupported|unknown function|unknown api/.test(errorText) ? "invalid_operation" :
        /auth|token|login/.test(errorText) ? "authentication_rejected" : "uapi_error";
      const diagnosticCode = "cpanel_" + category;
      throw Object.assign(new Error("cPanel " + operation.replace(/[^A-Za-z0-9_/-]/g, "").slice(0, 80) +
        " failed with HTTP " + status + ", UAPI status " + uapiStatus + ", " + errorCount + " API error(s), category " + category + "."),
        { diagnosticCode, httpStatus: status, uapiStatus, errorCount });
    }
    Object.defineProperty(data, "__httpStatus", { value: response.status, enumerable: false });
    return data;
  }

  function stripImageMetadata(contentType, bytes) {
    const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
    if (contentType === "image/jpeg" && starts(0xff, 0xd8, 0xff)) {
      const parts = [bytes.slice(0, 2)];
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) throw new Error("Invalid JPEG marker.");
        let markerOffset = offset;
        while (bytes[markerOffset] === 0xff) markerOffset++;
        const marker = bytes[markerOffset];
        if (marker === 0xda) { parts.push(bytes.slice(offset)); offset = bytes.length; break; }
        if (marker === 0xd9) { parts.push(bytes.slice(offset, markerOffset + 1)); offset = markerOffset + 1; break; }
        if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) {
          parts.push(bytes.slice(offset, markerOffset + 1)); offset = markerOffset + 1; continue;
        }
        if (markerOffset + 2 >= bytes.length) throw new Error("Truncated JPEG segment.");
        const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
        const end = markerOffset + 1 + length;
        if (length < 2 || end > bytes.length) throw new Error("Invalid JPEG segment length.");
        if (![0xe1, 0xed, 0xfe].includes(marker)) parts.push(bytes.slice(offset, end));
        offset = end;
      }
      if (offset !== bytes.length) throw new Error("Invalid JPEG end.");
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const output = new Uint8Array(total); let cursor = 0;
      for (const part of parts) { output.set(part, cursor); cursor += part.length; }
      return output;
    }
    if (contentType === "image/png" && starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)) {
      const chunks = [bytes.slice(0, 8)]; let offset = 8; let ended = false;
      while (offset + 12 <= bytes.length) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        const end = offset + 12 + length;
        if (end > bytes.length) throw new Error("Truncated PNG chunk.");
        const name = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
        if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(name)) chunks.push(bytes.slice(offset, end));
        offset = end;
        if (name === "IEND") { ended = true; break; }
      }
      if (!ended || offset !== bytes.length) throw new Error("Invalid PNG structure.");
      const total = chunks.reduce((sum, part) => sum + part.length, 0);
      const output = new Uint8Array(total); let cursor = 0;
      for (const part of chunks) { output.set(part, cursor); cursor += part.length; }
      return output;
    }
    if (contentType === "image/webp" && starts(0x52,0x49,0x46,0x46) && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP") {
      const chunks = [bytes.slice(0, 12)]; let offset = 12;
      while (offset + 8 <= bytes.length) {
        const name = new TextDecoder().decode(bytes.slice(offset, offset + 4));
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
        const end = offset + 8 + length + (length % 2);
        if (end > bytes.length) throw new Error("Truncated WebP chunk.");
        if (!["EXIF", "XMP "].includes(name)) chunks.push(bytes.slice(offset, end));
        offset = end;
      }
      if (offset !== bytes.length) throw new Error("Invalid WebP structure.");
      const total = chunks.reduce((sum, part) => sum + part.length, 0);
      const output = new Uint8Array(total); let cursor = 0;
      for (const part of chunks) { output.set(part, cursor); cursor += part.length; }
      new DataView(output.buffer).setUint32(4, output.length - 8, true);
      return output;
    }
    throw new Error("Image signature does not match MIME type.");
  }

  function isAllowedWordPressLink(value, wp) {
    try {
      const link = new URL(String(value || ""));
      return link.protocol === "https:" && link.hostname.toLowerCase() === wp.hostname && !link.port && !link.username && !link.password;
    } catch {
      return false;
    }
  }

  function editorRaw(item, key) {
    const value = item && item[key];
    return String(value && (value.raw !== undefined ? value.raw : value.rendered) || "");
  }

  function editorItem(item, type) {
    return {
      id: Number(item.id),
      type,
      title: editorRaw(item, "title"),
      content: editorRaw(item, "content"),
      excerpt: editorRaw(item, "excerpt"),
      featuredMedia: Number(item.featured_media || 0),
      status: String(item.status || "draft"),
      link: String(item.link || ""),
      modified: String(item.modified || "")
    };
  }

  function websiteSnapshotKey(type, id, snapshotId) {
    return "irpa:website-editor:snapshot:" + type + ":" + id + ":" + snapshotId;
  }

  async function readWebsiteItem(wp, type, id) {
    const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id + "?context=edit", {
      headers: wordpressHeaders(wp, { Accept: "application/json" }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (response.status === 404) throw new Error("WordPress page/post not found.");
    if (!response.ok || !Number.isSafeInteger(data?.id)) throw new Error("WordPress could not read the requested page/post.");
    if (!isAllowedWordPressLink(data.link, wp)) throw new Error("WordPress returned a URL outside the configured website host; the edit was blocked.");
    return data;
  }

  async function readWebsiteRevisions(wp, type, id) {
    const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id + "/revisions?context=edit&per_page=50&orderby=date&order=desc", {
      headers: wordpressHeaders(wp, { Accept: "application/json" }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) throw new Error("WordPress revision history could not be read; no edit was made.");
    return data;
  }

  async function recordWebsiteAudit(env, claims, action, type, id, details = {}) {
    const createdAt = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const actorEmail = String(claims.email || "");
    const record = { action, type, pageId: id, actorUid: claims.user_id, actorEmail, details, createdAt };
    const auditFields = fields({
      action, category: "COMMUNICATIONS", collection: type, recordId: id,
      actorUid: claims.user_id, actorEmail, details, createdAt
    });
    await commitDocumentAndAudit(
      env,
      "communicationWebsiteEdits/" + eventId,
      claims.token,
      fields(record),
      ["action", "type", "pageId", "actorUid", "actorEmail", "details", "createdAt"],
      auditFields,
      { createOnly: true }
    );
  }

  async function saveWebsiteSnapshot(env, claims, wp, type, id, current, changedFields = []) {
    let stage = "check_storage";
    try {
      if (!env.DRIVE_KV || typeof env.DRIVE_KV.put !== "function") {
        throw new Error("Website revision storage is unavailable; no edit was made.");
      }
      stage = "read_revisions";
      const revisions = await readWebsiteRevisions(wp, type, id);
      stage = "validate_revision";
      const currentRevisionId = revisions.length && Number.isSafeInteger(Number(revisions[0]?.id)) ? Number(revisions[0].id) : null;
      if (!currentRevisionId) throw new Error("No current WordPress revision ID is available; no edit was made.");
      stage = "build_snapshot";
      const snapshotId = crypto.randomUUID();
      const snapshot = {
        snapshotId, type, itemId: id, currentRevisionId,
        title: editorRaw(current, "title"),
        content: editorRaw(current, "content"),
        excerpt: editorRaw(current, "excerpt"),
        featuredMedia: Number(current.featured_media || 0),
        status: String(current.status || "draft"),
        link: String(current.link || ""),
        modified: String(current.modified || ""),
        actorUid: claims.user_id,
        actorEmail: String(claims.email || ""),
        createdAt: new Date().toISOString()
      };
      const serialized = JSON.stringify(snapshot);
      if (new TextEncoder().encode(serialized).byteLength > MAX_WEBSITE_SNAPSHOT_BYTES) {
        throw new Error("The current page/post exceeds the safe revision snapshot limit; no edit was made.");
      }
      stage = "write_snapshot";
      await env.DRIVE_KV.put(websiteSnapshotKey(type, id, snapshotId), serialized);
      stage = "write_audit";
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_EDIT_SNAPSHOT_SAVED", type, id, {
        snapshotId, previousRevisionId: currentRevisionId, changedFields
      });
      return snapshot;
    } catch (error) {
      const message = String(error?.message || "");
      if (message === "No current WordPress revision ID is available; no edit was made." ||
          message === "Website revision storage is unavailable; no edit was made." ||
          message === "The current page/post exceeds the safe revision snapshot limit; no edit was made.") {
        throw error;
      }
      let category = "runtime_error";
      if (/Privileged Firestore identity is not configured correctly/i.test(message)) category = "service_account_json_invalid";
      else if (/Privileged Firestore identity is not configured/i.test(message)) category = "service_account_missing";
      else if (/invalid for this Firebase project/i.test(message)) category = "service_account_project_mismatch";
      else if (/could not obtain an access token/i.test(message)) category = "oauth_token_exchange_failed";
      else if (/atomically commit.*HTTP ([0-9]{3})/i.test(message)) category = "firestore_commit_http_" + message.match(/HTTP ([0-9]{3})/i)[1];
      else if (/is not defined/i.test(message)) category = "reference_error";
      else if (/DataError|InvalidAccessError|OperationError/i.test(message)) category = "crypto_key_import_or_sign_error";
      else if (error?.name === "ReferenceError") category = "reference_error";
      throw new Error("Website snapshot failed at stage " + stage + " (" + category + "); no page edit was made.");
    }
  }

  function snapshotPayload(snapshot) {
    return {
      title: String(snapshot.title || ""),
      content: String(snapshot.content || ""),
      excerpt: String(snapshot.excerpt || ""),
      featured_media: Number(snapshot.featuredMedia || 0),
      status: String(snapshot.status || "draft")
    };
  }

  function sameEditorFields(actual, expected) {
    return editorRaw(actual, "title") === String(expected.title || "") &&
      editorRaw(actual, "content") === String(expected.content || "") &&
      editorRaw(actual, "excerpt") === String(expected.excerpt || "") &&
      Number(actual.featured_media || 0) === Number(expected.featured_media || 0) &&
      String(actual.status || "draft") === String(expected.status || "draft");
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/api/communications/records" && request.method === "GET") {
      const collectionName = String(url.searchParams.get("collection") || "");
      const readableCollections = new Set(["communicationMediaItems", "communicationMediaAssets", "communicationOperations", "socialMediaAccounts"]);
      if (!readableCollections.has(collectionName)) return json({ error: "This communications register is not enabled for Worker reads." }, 400, corsHeaders(request));
      let authz;
      try { authz = await authorised(request, env, false); }
      catch { authz = await authorised(request, env, true); }
      const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
      if (!projectId) return json({ error: "FIREBASE_PROJECT_ID is not configured for this Worker." }, 500, corsHeaders(request));
      const token = await getFirestoreAdminAccessToken(env);
      const endpoint = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents/" + collectionName;
      const response = await fetch(endpoint + "?pageSize=100", { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: "Firestore register read failed (HTTP " + response.status + "): " + String(body?.error?.status || "UNKNOWN") + " " + String(body?.error?.message || "").slice(0, 180) }, 502, corsHeaders(request));
      const items = (Array.isArray(body.documents) ? body.documents : []).map(document => ({ id: String(document.name || "").split("/").pop(), ...(firestoreDocumentToPlain(document) || {}) }));
      return json({ ok: true, collection: collectionName, count: items.length, items }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/records" && request.method === "POST") {
      const input = await request.json().catch(() => ({}));
      const collectionName = String(input.collection || "");
      const action = String(input.action || "");
      const allowedCollections = new Set(["communicationMediaAssets", "communicationMediaItems", "communicationSocialPosts", "communicationOperations", "socialMediaAccounts"]);
      if (!allowedCollections.has(collectionName)) return json({ error: "This communications register is not enabled for Worker writes." }, 400, corsHeaders(request));
      const reviewerAction = ["approve", "return", "archive", "status"].includes(action);
      const { claims, roles } = await authorised(request, env, reviewerAction);
      const now = new Date().toISOString();
      const actorEmail = String(claims.email || "").slice(0, 180);
      const id = String(input.id || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 150);
      if (!id) return json({ error: "A valid record ID is required." }, 400, corsHeaders(request));
      const existingRaw = action === "create" || action === "register-media-asset" ? null : await getFirestoreDocument(env, collectionName + "/" + id, await getFirestoreAdminAccessToken(env));
      const existing = firestoreDocumentToPlain(existingRaw);
      if (!["create", "register-media-asset"].includes(action) && !existing) return json({ error: "The communications record was not found." }, 404, corsHeaders(request));
      let row = {};
      if (action === "register-media-asset" && collectionName === "communicationMediaAssets") {
        const d = input.data || {};
        if (!String(d.fileId || "").trim() || !String(d.contentType || "").trim() || !Number.isSafeInteger(Number(d.fileSize)) || Number(d.fileSize) < 1 || Number(d.fileSize) > 25 * 1024 * 1024) return json({ error: "Valid Drive file ID, content type and file size (maximum 25 MiB) are required." }, 400, corsHeaders(request));
        row = { title: cleanText(d.title, 180) || cleanText(d.originalFileName, 180) || "Untitled media", originalFileName: cleanText(d.originalFileName, 180), contentType: cleanText(d.contentType, 120), fileSize: Number(d.fileSize), fileId: cleanText(d.fileId, 200), webViewLink: /^https:\/\//i.test(String(d.webViewLink || "")) ? cleanText(d.webViewLink, 1000) : "", storageProvider: "Google Drive", purpose: "Communication Media", tags: cleanText(d.tags, 500), mediaKind: cleanText(d.mediaKind, 60), status: "Available", recordOrigin: String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").toLowerCase() === "staging" ? "STAGING" : "PRODUCTION", uploadedByUid: claims.user_id, uploadedByEmail: actorEmail, createdAt: now, updatedAt: now };
      } else if (action === "create" && ["communicationMediaItems", "communicationSocialPosts", "communicationOperations", "socialMediaAccounts"].includes(collectionName)) {
        const d = input.data || {};
        const allowedFields = collectionName === "communicationMediaItems" ? ["title","type","channel","summary","body","scheduledAt","tags","assetUrl","slug","language","pageTemplate","hashtags","platform","campaignId"] :
          collectionName === "communicationSocialPosts" ? ["title","platform","channel","body","assetUrl","scheduledAt","hashtags","campaignId"] :
          collectionName === "communicationOperations" ? ["kind","title","summary","owner","startDate","dueDate","channels","audience","objective","budgetNote","contactName","organization","email","phone","beat","consent","assetType","assetUrl","rights","version","expiryDate","severity","lead","approver","trigger","holdingStatement","nextReview","channel","sourceUrl","observedDate","reach","engagement","sentiment","evidence","tags"] :
          ["platform","accountName","handle","profileUrl","accountType","owner","custodian","purpose","audience","authorizationReference","connectionStatus","reviewDate","notes"];
        const safeData = Object.fromEntries(allowedFields.filter(key => d[key] !== undefined).map(key => [key, d[key]]));
        row = { ...safeData, title: cleanText(d.title || d.accountName, 180), status: "Draft", createdByUid: claims.user_id, createdByEmail: actorEmail, createdAt: now, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail, recordOrigin: String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").toLowerCase() === "staging" ? "STAGING" : "PRODUCTION" };
        if (!row.title) return json({ error: "A title or account name is required." }, 400, corsHeaders(request));
      } else if (action === "update" || action === "submit") {
        if (existing.createdByUid !== claims.user_id && !roles.includes("Administrator")) return json({ error: "Only the record author or an administrator can edit or submit this draft." }, 403, corsHeaders(request));
        if (action === "submit" && collectionName !== "communicationMediaItems") return json({ error: "Only public communications items can be submitted for approval." }, 400, corsHeaders(request));
        if (action === "submit" && !["Draft", "Returned"].includes(String(existing.status || "Draft"))) return json({ error: "Only draft or returned items can be submitted." }, 409, corsHeaders(request));
        const d = input.data || {};
        if (action === "submit") row = { status: "Pending Approval", submittedAt: now, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail };
        else {
          const updateFields = collectionName === "communicationMediaItems" ? ["title","type","channel","summary","body","scheduledAt","tags","assetUrl","slug","language","pageTemplate","hashtags"] :
            collectionName === "communicationOperations" ? ["kind","title","summary","owner","startDate","dueDate","channels","audience","objective","budgetNote","contactName","organization","email","phone","beat","consent","assetType","assetUrl","rights","version","expiryDate","severity","lead","approver","trigger","holdingStatement","nextReview","channel","sourceUrl","observedDate","reach","engagement","sentiment","evidence","tags"] :
            collectionName === "socialMediaAccounts" ? ["platform","accountName","handle","profileUrl","accountType","owner","custodian","purpose","audience","authorizationReference","connectionStatus","reviewDate","notes"] : [];
          const safeUpdate = Object.fromEntries(updateFields.filter(key => d[key] !== undefined).map(key => [key, d[key]]));
          row = { ...safeUpdate, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail };
        }
      } else if (action === "status" && ["communicationOperations", "socialMediaAccounts"].includes(collectionName)) {
        const nextStatus = cleanText(input.status, 60);
        const allowedStatuses = collectionName === "socialMediaAccounts" ? ["Pending Verification", "Connected", "Disconnected", "Archived"] : ["Draft", "Active", "Completed", "Archived", "Under Review"];
        if (!allowedStatuses.includes(nextStatus)) return json({ error: "This status is not permitted for the selected register." }, 400, corsHeaders(request));
        row = collectionName === "socialMediaAccounts" ? { connectionStatus: nextStatus, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail } : { status: nextStatus, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail };
      } else if (["approve", "return", "archive"].includes(action)) {
        if (action !== "archive" && String(existing.status || "") !== "Pending Approval") return json({ error: "Only items awaiting approval can be approved or returned." }, 409, corsHeaders(request));
        if (action !== "archive" && existing.createdByUid === claims.user_id) return json({ error: "The author cannot approve their own public item." }, 403, corsHeaders(request));
        const decisionNote = cleanText(input.decisionNote, 1000);
        if (action === "return" && !decisionNote) return json({ error: "A reason is required when returning an item." }, 400, corsHeaders(request));
        row = { status: action === "approve" ? "Approved" : action === "return" ? "Returned" : "Archived", decisionNote, reviewedAt: now, reviewedByUid: claims.user_id, reviewedByEmail: actorEmail, updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: actorEmail };
      } else return json({ error: "Unsupported communications record action." }, 400, corsHeaders(request));
      const auditFields = fields({ action: "COMMUNICATIONS_" + action.toUpperCase().replace(/-/g, "_"), category: "COMMUNICATIONS", collection: collectionName, recordId: id, actorUid: claims.user_id, actorEmail, details: { status: row.status || existing?.status || "Available", title: row.title || existing?.title || "" }, createdAt: now });
      await commitDocumentAndAudit(env, id, claims.token, fields(row), Object.keys(row), auditFields, { createOnly: ["create", "register-media-asset"].includes(action), collectionName });
      return json({ ok: true, id, collection: collectionName, action, status: row.status || "Available", message: "Record and audit event saved through the Worker." }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/site/status" && request.method === "GET") {
      const { roles } = await websiteEditorAuthorised(request, env);
      const workerEnvironment = String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "unknown").trim().toLowerCase();
      let configuredWordPressHost = "not configured";
      try { configuredWordPressHost = new URL(String(env.WORDPRESS_BASE_URL || "").trim()).hostname.toLowerCase() || "invalid"; }
      catch { if (String(env.WORDPRESS_BASE_URL || "").trim()) configuredWordPressHost = "invalid"; }
      const result = {
        website: "not_configured", cpanel: "not_configured", workerEnvironment,
        workerName: cleanText(env.IRPA_WORKER_NAME || "unknown", 100),
        configuredWordPressHost,
        websiteHostGuardBlocked: false,
        websiteDiagnosticCategory: "not_checked",
        secretChecks: {
          WORDPRESS_BASE_URL: { present: !!String(env.WORDPRESS_BASE_URL || "").trim(), length: String(env.WORDPRESS_BASE_URL || "").trim().length },
          WORDPRESS_USERNAME: { present: !!String(env.WORDPRESS_USERNAME || "").trim(), length: String(env.WORDPRESS_USERNAME || "").trim().length },
          WORDPRESS_APPLICATION_PASSWORD: { present: !!String(env.WORDPRESS_APPLICATION_PASSWORD || "").trim(), length: String(env.WORDPRESS_APPLICATION_PASSWORD || "").replace(/\s/g, "").length, containsSpaces: /\s/.test(String(env.WORDPRESS_APPLICATION_PASSWORD || "")) }
        }
      };
      const safeCode = value => String(value || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 100) || undefined;
      const authBridgeDiagnostic = value => safeCode(value) || null;
      try {
        const wp = websiteWordPressConfig(env);
        result.secretChecks = {
          ...result.secretChecks, format: wp.secretChecks,
          boundToServingWorkerEnvironment: ["production", "staging"].includes(workerEnvironment) &&
            Object.values(result.secretChecks).every(item => item.present)
        };
        const authUrl = wp.root + "/wp-json/wp/v2/users/me?context=edit";
        let response;
        try {
          response = await wordpressEditorFetch(wp, authUrl, {
            headers: wordpressHeaders(wp, { Accept: "application/json", "Cache-Control": "no-cache" }),
            signal: AbortSignal.timeout(12000)
          });
        } catch (error) {
          const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
          result.website = "unavailable";
          result.websiteDiagnosticCode = timedOut ? "timeout" : error?.name === "TypeError" ? "network_error" : "request_failed";
          result.websiteDiagnosticMessage = timedOut ? "WordPress did not respond before the probe deadline." :
            error?.name === "TypeError" ? "The Worker could not establish a WordPress response." : "The WordPress probe failed before receiving an HTTP response.";
        }
        if (response) {
          const raw = await response.clone().text().catch(() => "");
          const contentType = response.headers.get("content-type") || "unknown";
          let detail = {};
          try { detail = JSON.parse(raw); } catch {}
          const wpCode = safeCode(detail.code);
          const wpMessage = sanitizedWordPressBody(cleanText(detail.message || detail.error || "", 220), { ...wp, username: String(env.WORDPRESS_USERNAME || "").trim(), password: String(env.WORDPRESS_APPLICATION_PASSWORD || "").replace(/\s/g, "") }).replace(/[\\r\\n]/g, " ");
          const location = response.headers.get("location");
          const redirected = response.status >= 300 && response.status < 400;
          result.websiteHttpStatus = response.status;
          result.websiteFinalUrl = safeWordPressUrl(response.url, authUrl);
          result.websiteRedirectCount = redirected ? 1 : 0;
          result.websiteRedirectTarget = location ? safeWordPressUrl(new URL(location, authUrl).toString()) : null;
          result.websiteRedirectFinding = redirected ? "Authentication redirects are not followed. Configure WORDPRESS_BASE_URL to the canonical HTTPS origin; Authorization is not forwarded to another hop." : null;
          result.websiteAuthHeaderPresent = true;
          result.websiteWwwAuthenticatePresent = response.headers.has("www-authenticate");
          result.websiteAuthBridgeDiagnostic = authBridgeDiagnostic(response.headers.get("x-irpa-staging-auth-diagnostic"));
          result.websiteResponseType = String(contentType.split(";")[0] || "unknown").trim().toLowerCase().slice(0, 80);
          result.websiteCloudflareRay = safeCode(response.headers.get("cf-ray")) || undefined;
          result.websiteErrorCode = wpCode;
          result.websiteErrorMessage = wpMessage || undefined;
          result.websiteRawResponse = sanitizedWordPressBody(raw, {
            ...wp, username: String(env.WORDPRESS_USERNAME || "").trim(),
            password: String(env.WORDPRESS_APPLICATION_PASSWORD || "").replace(/\s/g, "")
          }) || "(empty response body)";
          if (response.ok) {
            let user = null;
            try { user = JSON.parse(raw); } catch {}
            if (!user || !Number.isSafeInteger(user.id) || !Array.isArray(user.roles)) {
              result.website = "unavailable";
              result.websiteDiagnosticCode = "unexpected_response";
              result.websiteDiagnosticMessage = "The authenticated endpoint returned HTTP success but not a valid WordPress user JSON object.";
            } else {
              const accountRoles = user.roles.map(role => String(role).toLowerCase());
              const isDedicatedEditor = accountRoles.includes("editor") && !accountRoles.includes("administrator");
              result.website = isDedicatedEditor ? "connected" : "wrong_account_role";
              result.websiteAccount = {
                name: cleanText(user.name, 100), role: isDedicatedEditor ? "editor" : "unverified",
                canEditPosts: user.capabilities && typeof user.capabilities === "object" ? !!user.capabilities.edit_posts : undefined,
                canEditPages: user.capabilities && typeof user.capabilities === "object" ? !!user.capabilities.edit_pages : undefined,
                canUploadFiles: user.capabilities && typeof user.capabilities === "object" ? !!user.capabilities.upload_files : undefined,
                uploadFilesCapability: user.capabilities && typeof user.capabilities === "object" ? (user.capabilities.upload_files === true ? "granted" : user.capabilities.upload_files === false ? "missing" : "unknown") : "unknown"
              };
              if (!isDedicatedEditor) result.websiteDiagnosticCode = "wrong_account_role";
            }
          } else {
            const finding = wordpressErrorFinding(response.status, wpCode, wpMessage, raw);
            result.website = response.status === 401 || response.status === 403 ? "authentication_failed" : "unavailable";
            result.websiteDiagnosticCode = redirected ? "unexpected_redirect" : finding.code;
            result.websiteDiagnosticMessage = redirected
              ? "The authenticated endpoint redirected to " + (result.websiteRedirectTarget || "an undisclosed location") + ". Configure the canonical HTTPS hostname; the Authorization header was not forwarded."
              : finding.finding;
          }
        }

        try {
          const publicUrl = wp.root + "/wp-json/";
          const publicResponse = await fetch(publicUrl, {
            method: "GET", headers: { Accept: "application/json", "Cache-Control": "no-cache" },
            redirect: "manual", signal: AbortSignal.timeout(8000)
          });
          const publicRaw = await publicResponse.clone().text().catch(() => "");
          let publicBody = {};
          try { publicBody = JSON.parse(publicRaw); } catch {}
          const publicLocation = publicResponse.headers.get("location");
          result.websitePublicRest = {
            status: publicResponse.status, finalUrl: safeWordPressUrl(publicResponse.url, publicUrl),
            redirectCount: publicResponse.status >= 300 && publicResponse.status < 400 ? 1 : 0,
            redirectTarget: publicLocation ? safeWordPressUrl(new URL(publicLocation, publicUrl).toString()) : null,
            contentType: String((publicResponse.headers.get("content-type") || "unknown").split(";")[0]).trim().toLowerCase().slice(0, 80),
            errorCode: safeCode(publicBody.code),
            errorMessage: sanitizedWordPressBody(cleanText(publicBody.message || publicBody.error || "", 220), { ...wp, username: String(env.WORDPRESS_USERNAME || "").trim(), password: String(env.WORDPRESS_APPLICATION_PASSWORD || "").replace(/\s/g, "") }) || undefined,
            wwwAuthenticatePresent: publicResponse.headers.has("www-authenticate"),
            rawResponse: sanitizedWordPressBody(publicRaw, wp) || "(empty response body)"
          };
        } catch (error) {
          result.websitePublicRest = { error: error?.name === "TimeoutError" ? "timeout" : "request_failed" };
        }
      } catch (error) {
        const message = String(error?.message || "");
        if (error?.diagnosticCode) {
          result.website = "not_configured";
          result.websiteDiagnosticCode = safeCode(error.diagnosticCode);
          result.websiteHostGuardBlocked = error.diagnosticCode === "wordpress_host_not_allowed_for_environment";
          result.websiteDiagnosticCategory = result.websiteHostGuardBlocked ? "irpa_host_guard" : "worker_configuration";
          result.websiteDiagnosticMessage = message.slice(0, 240);
          if (error.diagnosticCode === "credentials_missing") {
            result.websiteMissingSettings = ["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD"].filter(name => message.includes(name));
          }
        } else {
          result.website = "unavailable";
          result.websiteDiagnosticCategory = "worker_probe_failure";
          result.websiteDiagnosticCode = "probe_setup_failed";
          result.websiteDiagnosticMessage = "The Worker failed during WordPress diagnostic setup; inspect the safe Worker diagnostic event for the failing stage.";
        }
      }
      try {
        const cp = cpanelConfig(env);
        await cpanelCall(cp, "DomainInfo/list_domains");
        result.cpanel = "connected";
      } catch (error) {
        const message = String(error?.message || "");
        if (error?.diagnosticCode) {
          result.cpanel = error.diagnosticCode === "cpanel_credentials_missing" || error.diagnosticCode === "cpanel_base_url_missing" ? "not_configured" :
            error.diagnosticCode === "cpanel_authentication_rejected" ? "authentication_rejected" :
            error.diagnosticCode === "cpanel_permission_denied" ? "permission_denied" : "unavailable";
          result.cpanelDiagnostic = safeCode(error.diagnosticCode);
          result.cpanelDiagnosticMessage = message.slice(0, 240);
          if (Number.isInteger(error.httpStatus)) result.cpanelHttpStatus = error.httpStatus;
          if (error.uapiStatus !== undefined) result.cpanelUapiStatus = error.uapiStatus;
          if (Number.isInteger(error.errorCount)) result.cpanelApiErrorCount = error.errorCount;
        } else {
          result.cpanel = "unavailable";
          result.cpanelDiagnostic = error?.name === "TimeoutError" || error?.name === "AbortError" ? "cpanel_request_timeout" :
            error?.name === "TypeError" ? "cpanel_network_error" : "cpanel_connection_failed";
          result.cpanelDiagnosticMessage = error?.name === "TimeoutError" || error?.name === "AbortError"
            ? "The cPanel API request exceeded its 15-second deadline."
            : error?.name === "TypeError" ? "The cPanel API request failed before receiving an HTTP response." : "The cPanel API request failed.";
        }
      }
      return json({ ok: true, connections: result, permissions: { websiteEditor: true, staticFileEditing: roles.some(r => REVIEW_ROLES.has(r)) } }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/media" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      const filename = cleanText(input.filename, 180);
      const contentType = String(input.contentType || "").toLowerCase();
      const altText = cleanText(input.altText, 250), caption = cleanText(input.caption, 500);
      const title = cleanText(input.title || filename, 180);
      const encoded = String(input.dataBase64 || "");
      if (!filename || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || !title) return json({error:"A filename, title and valid base64 file are required."},400,corsHeaders(request));
      const estimate = Math.floor(encoded.length*3/4)-(encoded.endsWith("==")?2:encoded.endsWith("=")?1:0);
      const limit = Math.min(20 * 1024 * 1024,Math.max(1024,Number(env.WORDPRESS_MEDIA_MAX_BYTES||8*1024*1024)));
      if(estimate<1||estimate>limit)return json({error:"File exceeds the configured WordPress media limit of "+limit+" bytes."},413,corsHeaders(request));
      let bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      if(contentType==="image/svg+xml"){
        try{bytes=new TextEncoder().encode(sanitizeWebsiteSvg(new TextDecoder().decode(bytes)));}
        catch(error){return json({error:error.message},415,corsHeaders(request));}
      }
      let meta;
      try{meta=validateWebsiteMedia({filename,contentType,bytes});bytes=stripImageMetadata(contentType,bytes);meta={...meta,size:bytes.byteLength};}
      catch(error){return json({error:error.message},415,corsHeaders(request));}
      const destination=String(input.destination||"media-library");
      if(!["media-library","attach","featured"].includes(destination))return json({error:"Select WordPress Media Library, page/post attachment or featured image."},400,corsHeaders(request));
      if(destination!=="media-library"&&!Number.isSafeInteger(Number(input.parentId||input.postId)) )return json({error:"A valid existing page/post ID is required for attachment or featured image."},400,corsHeaders(request));
      if(["image/jpeg","image/png","image/webp","image/gif"].includes(contentType)&&!altText)return json({error:"Descriptive alt text is required for raster images."},400,corsHeaders(request));
      const wp=websiteWordPressConfig(env); const user=await verifyDedicatedWordPressEditor(wp);
      if (user?.capabilities?.upload_files !== true) return json({ error: "WordPress media upload is blocked: the configured integration account is missing the upload_files capability. Ask the WordPress administrator to grant upload_files to the dedicated Editor account, then run diagnostics again.", code: "wordpress_upload_files_capability_missing", capability: "upload_files" }, 403, corsHeaders(request));
      const endpoint=wp.root+"/wp-json/wp/v2/media";
      const response=await wordpressEditorFetch(wp,endpoint,{method:"POST",headers:wordpressHeaders(wp,{"Content-Type":contentType,"Content-Disposition":'attachment; filename="'+meta.filename.replace(/["\\\r\n]/g,"-")+'"',Accept:"application/json"}),body:bytes,signal:AbortSignal.timeout(45000)});
      const uploaded=await response.json().catch(()=>null);
      if(!response.ok||!Number.isSafeInteger(uploaded?.id)||!isAllowedWordPressLink(uploaded?.source_url,wp))return json({error:"WordPress media upload failed (HTTP "+response.status+"): "+cleanText(uploaded?.message||"media endpoint rejected the upload",240),httpStatus:response.status},response.status||502,corsHeaders(request));
      const update={title,alt_text:altText,caption};
      if(destination!=="media-library")update.post=Number(input.parentId||input.postId);
      const metadata=await wordpressEditorFetch(wp,endpoint+"/"+uploaded.id,{method:"POST",headers:wordpressHeaders(wp,{"Content-Type":"application/json",Accept:"application/json"}),body:JSON.stringify(update),signal:AbortSignal.timeout(20000)});
      const media=await metadata.json().catch(()=>null);
      if(!metadata.ok||Number(media?.id)!==uploaded.id)return json({error:"Media uploaded, but WordPress metadata/attachment verification failed (HTTP "+metadata.status+").",httpStatus:metadata.status},502,corsHeaders(request));
      if(destination==="featured"){
        const kind=String(input.parentType||"posts")==="pages"?"pages":"posts",id=Number(input.parentId||input.postId);
        const parent=await wordpressEditorFetch(wp,wp.root+"/wp-json/wp/v2/"+kind+"/"+id,{method:"POST",headers:wordpressHeaders(wp,{"Content-Type":"application/json",Accept:"application/json"}),body:JSON.stringify({featured_media:uploaded.id}),signal:AbortSignal.timeout(20000)});
        if(!parent.ok)return json({error:"Media uploaded, but featured-image assignment failed (HTTP "+parent.status+").",httpStatus:parent.status},502,corsHeaders(request));
      }
      const sha256=await websiteMediaSha256(bytes),now=new Date().toISOString(),id=crypto.randomUUID();
      const row={file:meta.filename,title,altText,caption,category:cleanText(input.category,100),tags:Array.isArray(input.tags)?input.tags.map(x=>cleanText(x,60)).slice(0,30):[],destination,url:media.source_url,uploader:claims.user_id,uploaderEmail:claims.email||"",date:now,size:bytes.byteLength,sha256,wordpressMediaId:uploaded.id,status:"Available"};
      const recordFields=fields(row),auditFields=fields({action:"COMMUNICATION_WEBSITE_MEDIA_REGISTERED",category:"COMMUNICATIONS",collection:"communicationMediaAssets",recordId:id,actorUid:claims.user_id,actorEmail:claims.email||"",details:{file:meta.filename,destination,url:media.source_url,size:bytes.byteLength,sha256},createdAt:now});
      await commitDocumentAndAudit(env,"communicationMediaAssets/"+id,claims.token,recordFields,Object.keys(row),auditFields,{createOnly:true,collectionName:"communicationMediaAssets"});
      await recordWebsiteAudit(env,claims,"COMMUNICATION_WEBSITE_MEDIA_UPLOADED","media",uploaded.id,{filename:meta.filename,contentType,size:bytes.byteLength,sha256,destination});
      return json({success:true,media:{id:uploaded.id,url:media.source_url,title,altText,caption,sha256,size:bytes.byteLength,destination,registerId:id}},200,corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/media/chunk" && request.method === "POST") {
      const {claims}=await websiteEditorAuthorised(request,env);
      if(!env.DRIVE_KV)return json({error:"Chunk storage is unavailable; no upload was started."},503,corsHeaders(request));
      const input=await request.json().catch(()=>({}));
      try{validateMediaChunk(input);}catch(error){return json({error:error.message},400,corsHeaders(request));}
      const key="irpa:website-media-chunk:"+input.uploadId+":"+input.index;
      await env.DRIVE_KV.put(key,String(input.dataBase64),{expirationTtl:3600});
      return json({success:true,uploadId:input.uploadId,index:input.index},200,corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/media/complete" && request.method === "POST") {
      const {claims}=await websiteEditorAuthorised(request,env);
      if(!env.DRIVE_KV)return json({error:"Chunk storage is unavailable; no upload was completed."},503,corsHeaders(request));
      const input=await request.json().catch(()=>({})),uploadId=String(input.uploadId||"");
      if(!/^[a-f0-9-]{36}$/i.test(uploadId)||!Number.isInteger(input.total)||input.total<1||input.total>512)return json({error:"Invalid chunk upload manifest."},400,corsHeaders(request));
      const cp=cpanelConfig(env),relative=String(input.path||"");
      const parts=relative.replace(/\\\\/g,"/").split("/");
      const filename=parts.pop();
      if(!filename||filename.startsWith(".")||parts.some(p=>!p||p==="."||p===".."||p.startsWith(".")))return json({error:"Invalid cPanel media destination path."},400,corsHeaders(request));
      const safe={dir:safeCpanelDirectory(parts.join("/"),cp.documentRoot),file:filename,relative:relative.replace(/\\\\/g,"/")};
      const chunks=[];
      for(let i=0;i<input.total;i++){const chunk=await env.DRIVE_KV.get("irpa:website-media-chunk:"+uploadId+":"+i);if(!chunk)return json({error:"Upload is incomplete; missing chunk "+i+"."},409,corsHeaders(request));chunks.push(chunk);}
      const encoded=chunks.join("");const size=Math.floor(encoded.length*3/4);
      const max=Math.min(50*1024*1024,Math.max(1,Number(env.CPANEL_MEDIA_MAX_BYTES||50*1024*1024)));
      if(size<1||size>max)return json({error:"cPanel media upload exceeds the configured maximum of "+max+" bytes."},413,corsHeaders(request));
      let bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      if(String(input.contentType||"")==="image/svg+xml")bytes=new TextEncoder().encode(sanitizeWebsiteSvg(new TextDecoder().decode(bytes)));
      const meta=validateWebsiteMedia({filename:safe.file,contentType:String(input.contentType||""),bytes});
      const form=new FormData();form.set("dir",safe.dir);form.set("file-1",new File([bytes],meta.filename,{type:meta.contentType}));
      const target=new URL(cp.root+"/Fileman/upload_files");
      const response=await fetch(target,{method:"POST",headers:{Authorization:authHeader(cp.username,cp.token),Accept:"application/json"},body:form,signal:AbortSignal.timeout(60000)});
      const result=await response.json().catch(()=>null);
      if(!response.ok||result?.status!==1)return json({error:"cPanel upload failed (HTTP "+response.status+"): "+cleanText(result?.errors?.join(" ")||"UAPI upload rejected",240),httpStatus:response.status},response.status||502,corsHeaders(request));
      const wp=websiteWordPressConfig(env),url=wp.root+"/"+safe.relative.split("/").map(encodeURIComponent).join("/");
      const sha256=await websiteMediaSha256(bytes),now=new Date().toISOString(),id=crypto.randomUUID();
      const row={file:meta.filename,title:cleanText(input.title||meta.filename,180),altText:cleanText(input.altText,250),caption:cleanText(input.caption,500),category:cleanText(input.category,100),tags:Array.isArray(input.tags)?input.tags.map(x=>cleanText(x,60)).slice(0,30):[],destination:"cpanel-folder",url,uploader:claims.user_id,uploaderEmail:claims.email||"",date:now,size:bytes.byteLength,sha256,status:"Available"};
      await commitDocumentAndAudit(env,"communicationMediaAssets/"+id,claims.token,fields(row),Object.keys(row),fields({action:"COMMUNICATION_WEBSITE_MEDIA_REGISTERED",category:"COMMUNICATIONS",collection:"communicationMediaAssets",recordId:id,actorUid:claims.user_id,actorEmail:claims.email||"",details:{file:meta.filename,destination:"cpanel-folder",url,size:bytes.byteLength,sha256},createdAt:now}),{createOnly:true,collectionName:"communicationMediaAssets"});
      for(let i=0;i<input.total;i++)await env.DRIVE_KV.delete("irpa:website-media-chunk:"+uploadId+":"+i);
      return json({success:true,url,size:bytes.byteLength,sha256,registerId:id},200,corsHeaders(request));
    }

    if (path === "/api/communications/website/taxonomies" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const readTerms = async taxonomy => {
        const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + taxonomy + "?context=edit&per_page=100&orderby=name&order=asc", {
          headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(15000)
        });
        const terms = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(terms)) throw new Error("WordPress " + taxonomy + " could not be loaded.");
        return terms.filter(term => Number.isSafeInteger(Number(term.id)) && Number(term.id) > 0)
          .map(term => ({ id: Number(term.id), name: String(term.name?.raw ?? term.name?.rendered ?? term.name ?? "") }));
      };
      const [categories, tags] = await Promise.all([readTerms("categories"), readTerms("tags")]);
      return json({ categories, tags }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/structure" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const pages = [
        ["Home", "home"], ["About IRPA", "about-irpa"], ["Programmes", "programmes"],
        ["Rangeland and Livestock", "rangeland-and-livestock"], ["Projects", "projects"],
        ["News", "news"], ["Resources", "resources"], ["Partners", "partners"],
        ["Contact", "contact"], ["Donate and Funding", "donate-and-funding"]
      ];
      const categoryTerms = [
        ["News", "news"], ["Events", "events"], ["Programmes", "programmes"],
        ["Projects", "projects"], ["Publications", "publications"], ["Resources", "resources"],
        ["Partnerships", "partnerships"], ["Funding Opportunities", "funding-opportunities"]
      ];
      const tagTerms = [
        ["IRPA", "irpa"], ["Rangeland Management", "rangeland-management"],
        ["Pastoral Communities", "pastoral-communities"], ["Livestock Development", "livestock-development"],
        ["Market Development", "market-development"], ["Climate Resilience", "climate-resilience"],
        ["Women and Youth", "women-and-youth"], ["Longido", "longido"]
      ];
      const result = { pages: [], categories: [], tags: [], menu: { status: "not_started" }, created: 0, skipped: 0 };
      const wpJson = async (endpoint, method = "GET", payload) => {
        const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + endpoint, {
          method, headers: wordpressHeaders(wp, { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) }),
          ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(20000)
        });
        const rawBody = await response.text();
        let data = null; try { data = JSON.parse(rawBody); } catch {}
        const diagnosticHeaders = {};
        for (const [name, value] of response.headers.entries()) if (/^(server|cf-ray|cf-cache-status|x-waf|x-sucuri|x-mod-security|x-firewall|x-cache)/i.test(name)) diagnosticHeaders[name] = cleanText(value, 180);
        const body = cleanText(rawBody, 300).replace(/(authorization|application.password|token|secret)\s*[:=]\s*[^,;\s]+/ig, "$1=[REDACTED]");
        return { response, data, diagnostics: { step: endpoint, status: response.status, contentType: cleanText(response.headers.get("content-type") || "", 120), body, headers: diagnosticHeaders } };
      };
      for (const [title, slug] of pages) {
        const existing = await wpJson("pages?slug=" + encodeURIComponent(slug) + "&context=edit&per_page=10");
        if (!existing.response.ok || !Array.isArray(existing.data)) throw new Error("Could not check whether the WordPress page slug '" + slug + "' already exists; no replacement was attempted.");
        if (existing.data.length) { result.pages.push({ title, slug, status: "SKIPPED_EXISTS", id: Number(existing.data[0].id) || null }); result.skipped++; continue; }
        const created = await wpJson("pages", "POST", { title, slug, status: "draft", content: "<p>DRAFT — IRPA website page structure placeholder. Replace this content through the approved editorial workflow.</p>" });
        if (!created.response.ok || !Number.isSafeInteger(created.data?.id) || created.data.status !== "draft" || !isAllowedWordPressLink(created.data.link, wp)) {
          throw new Error("WordPress did not confirm creation of page '" + title + "' as a draft. No page was published or overwritten.");
        }
        result.pages.push({ title, slug, status: "CREATED_DRAFT", id: created.data.id }); result.created++;
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_STRUCTURE_PAGE_DRAFT_CREATED", "pages", created.data.id, { title, slug, status: "draft" });
      }
      const createTerms = async (taxonomy, terms, output) => {
        for (const [name, slug] of terms) {
          const existing = await wpJson(taxonomy + "?slug=" + encodeURIComponent(slug) + "&context=edit&per_page=10");
          if (!existing.response.ok || !Array.isArray(existing.data)) throw new Error("Could not check existing WordPress " + taxonomy + " term '" + slug + "'; no replacement was attempted.");
          if (existing.data.length) { output.push({ name, slug, status: "SKIPPED_EXISTS", id: Number(existing.data[0].id) || null }); result.skipped++; continue; }
          const created = await wpJson(taxonomy, "POST", { name, slug });
          if (!created.response.ok || !Number.isSafeInteger(created.data?.id)) throw new Error("WordPress could not create " + taxonomy + " term '" + name + "'.");
          output.push({ name, slug, status: "CREATED", id: created.data.id }); result.created++;
          await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_STRUCTURE_TERM_CREATED", taxonomy, created.data.id, { name, slug });
        }
      };
      await createTerms("categories", categoryTerms, result.categories);
      await createTerms("tags", tagTerms, result.tags);
      const menuSlug = "irpa-primary-navigation-draft";
      const existingMenu = await wpJson("navigation?slug=" + menuSlug + "&context=edit&per_page=10");
      if (existingMenu.response.status === 404) {
        result.menu = { status: "UNAVAILABLE", message: "This WordPress site does not expose the core navigation REST endpoint. No live menu was changed." };
      } else if (!existingMenu.response.ok || !Array.isArray(existingMenu.data)) {
        result.menu = { status: "FAILED_READ", message: "Could not safely inspect existing draft navigation; no menu was changed." };
      } else if (existingMenu.data.length) {
        result.menu = { status: "SKIPPED_EXISTS", id: Number(existingMenu.data[0].id) || null };
        result.skipped++;
      } else {
        const navigationContent = pages.map(([label, slug]) => '<!-- wp:navigation-link {"label":' + JSON.stringify(label) + ',"type":"custom","url":' + JSON.stringify(slug === "home" ? "/" : "/" + slug + "/") + ',"kind":"custom"} /-->').join("\n");
        const created = await wpJson("navigation", "POST", { title: "IRPA Primary Navigation — DRAFT", slug: menuSlug, status: "draft", content: navigationContent });
        if (!created.response.ok || !Number.isSafeInteger(created.data?.id) || created.data.status !== "draft") {
          result.menu = { status: "FAILED_CREATE", httpStatus: created.response.status, message: "WordPress did not confirm a draft navigation record. The live menu was not touched." };
        } else {
          result.menu = { status: "CREATED_DRAFT", id: created.data.id }; result.created++;
          await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_STRUCTURE_MENU_DRAFT_CREATED", "navigation", created.data.id, { slug: menuSlug, status: "draft" });
        }
      }
      return json({ success: true, draftOnly: true, liveMenuChanged: false, result }, 200, corsHeaders(request));
    }

    if ((path === "/api/communications/website/production-acceptance-step" || path === "/api/communications/website/production-acceptance") && request.method === "POST") {
      const { claims } = await authorised(request, env, true);
      const wp = websiteWordPressConfig(env);
      const input = await request.json().catch(() => ({}));
      const step = String(input.step || "");
      const [stepKind, stepFile, stepDestination] = step.split("|");
      if (!["page-lifecycle", "post-lifecycle", "wp-media", "cpanel"].includes(stepKind)) return json({ error: "A supported independent acceptance step is required." }, 400, corsHeaders(request));
      const report = [];
      const cleanupList = [];
      const add = (label, status, httpStatus, error = "", detail = "") => report.push({ label: "TEST " + label, status, httpStatus: Number.isInteger(httpStatus) ? httpStatus : null, error: cleanText(error, 300) || null, detail: cleanText(detail, 1200) || null });
      const wpRequest = async (endpoint, method = "GET", payload, headers = {}) => {
        const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + endpoint, {
          method, headers: wordpressHeaders(wp, { Accept: "application/json", ...headers, ...(payload instanceof Uint8Array ? {} : payload ? { "Content-Type": "application/json" } : {}) }),
          ...(payload instanceof Uint8Array ? { body: payload } : payload ? { body: JSON.stringify(payload) } : {}),
          signal: AbortSignal.timeout(10000)
        });
        const rawBody = await response.text();
        let data = null; try { data = JSON.parse(rawBody); } catch {}
        const diagnosticHeaders = {};
        for (const [name, value] of response.headers.entries()) if (/^(server|cf-ray|cf-cache-status|x-waf|x-sucuri|x-mod-security|x-firewall|x-cache)/i.test(name)) diagnosticHeaders[name] = cleanText(value, 180);
        const body = cleanText(rawBody, 300).replace(/(authorization|application.password|token|secret)\\s*[:=]\\s*[^,;\\s]+/ig, "$1=[REDACTED]");
        return { response, data, diagnostics: { step: endpoint, status: response.status, contentType: cleanText(response.headers.get("content-type") || "", 120), body, headers: diagnosticHeaders } };
      };
      const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14) + "-" + crypto.randomUUID().slice(0, 8);
      let testPageId = Number(input.pageId || 0), testPostId = Number(input.postId || 0), uploadAllowed = false;
      try {
        const user = await wpRequest("users/me?context=edit");
        uploadAllowed = !!user.response.ok && user.data?.capabilities?.upload_files === true;
        add("WordPress authenticated user read", user.response.ok ? "PASS" : "FAIL", user.response.status, user.response.ok ? "" : user.data?.message || "WordPress user endpoint failed.");
        add("WordPress upload_files capability", uploadAllowed ? "PASS" : "FAIL", user.response.status, uploadAllowed ? "" : "Missing or unverified upload_files capability; TEST media uploads are blocked.");
      } catch (error) { add("WordPress authenticated user read", "FAIL", 0, error.message); add("WordPress upload_files capability", "FAIL", 0, "Capability could not be verified; uploads were not attempted."); }
      for (const type of (stepKind === "page-lifecycle" ? ["pages"] : stepKind === "post-lifecycle" ? ["posts"] : [])) {
        const title = "TEST — IRPA Production Acceptance " + stamp + " — " + type;
        const slug = "test-irpa-production-acceptance-" + stamp.toLowerCase() + "-" + type;
        try {
          const created = await wpRequest(type, "POST", { title, slug, status: "draft", content: "<p>TEST ONLY — IRPA production acceptance. This draft is intentionally retained and will not be published.</p>" });
          const id = Number(created.data?.id);
          const ok = created.response.ok && Number.isSafeInteger(id) && created.data?.status === "draft" && isAllowedWordPressLink(created.data?.link, wp);
          if (type === "pages") testPageId = ok ? id : 0; else testPostId = ok ? id : 0;
          add(type + " draft create", ok ? "PASS" : "FAIL", created.response.status, ok ? "" : created.data?.message || "WordPress did not confirm a same-host draft.");
          if (!ok) continue;
          cleanupList.push({ type, id, url: created.data.link });
          await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_ACCEPTANCE_TEST_DRAFT_CREATED", type, id, { title, slug, status: "draft", test: true });
          const edited = await wpRequest(type + "/" + id, "POST", { title: title + " — EDITED TEST", content: "<p>TEST ONLY — edited and revised by the production acceptance check. Retain as draft.</p>", status: "draft" });
          const editOk = edited.response.ok && Number(edited.data?.id) === id && edited.data?.status === "draft";
          add(type + " draft edit", editOk ? "PASS" : "FAIL", edited.response.status, editOk ? "" : edited.data?.message || "WordPress did not confirm the edited draft.");
          const revisions = await wpRequest(type + "/" + id + "/revisions?context=edit&per_page=20");
          const revisionRows = Array.isArray(revisions.data) ? revisions.data : [];
          const revisionOk = revisions.response.ok && revisionRows.length > 0;
          add(type + " revision history", revisionOk ? "PASS" : "FAIL", revisions.response.status, revisionOk ? "" : revisions.data?.message || "No WordPress revision was returned; the draft remains unchanged and retained.");
        } catch (error) { add(type + " draft lifecycle", "FAIL", 0, error.message); }
      }
      const encoder = new TextEncoder();
      const makePdfFixture = () => {
        const objects = ["1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n", "2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj\\n", "3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\\nendobj\\n"];
        let body = "%PDF-1.4\\n", offsets = [0];
        for (const object of objects) { offsets.push(encoder.encode(body).length); body += object; }
        const xref = encoder.encode(body).length;
        body += "xref\\n0 4\\n0000000000 65535 f \\n" + offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n \\n").join("") + "trailer\\n<< /Size 4 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF\\n";
        return encoder.encode(body);
      };
      const makeDocxFixture = () => {
        const entries = [
          ["[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"],
          ["_rels/.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"],
          ["word/document.xml", "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>IRPA acceptance fixture</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"]
        ];
        const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
        const u16 = (view, offset, value) => view.setUint16(offset, value, true), u32 = (view, offset, value) => view.setUint32(offset, value, true);
        const localParts = [], centralParts = []; let offset = 0;
        for (const [name, content] of entries) {
          const nameBytes = encoder.encode(name), data = encoder.encode(content), crc = crc32(data);
          const local = new Uint8Array(30 + nameBytes.length + data.length), lv = new DataView(local.buffer);
          u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u32(lv, 14, crc); u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, nameBytes.length); local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length); localParts.push(local);
          const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
          u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u32(cv, 16, crc); u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, nameBytes.length); u32(cv, 42, offset); central.set(nameBytes, 46); centralParts.push(central); offset += local.length;
        }
        const centralLength = centralParts.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
        u32(ev, 0, 0x06054b50); u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, centralLength); u32(ev, 16, offset);
        const parts = [...localParts, ...centralParts, end], output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let cursor = 0;
        for (const part of parts) { output.set(part, cursor); cursor += part.length; } return output;
      };
      const mediaTests = [
        { name: "image", filename: "png", mime: "image/png", b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==" },
        { name: "video", filename: "mp4", mime: "video/mp4", b64: "AAAAGGZ0eXBpc29tAAACAGlzb21pc28yAAAACG1kYXQ=" },
        { name: "pdf", filename: "pdf", mime: "application/pdf", bytes: makePdfFixture() },
        { name: "docx", filename: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: makeDocxFixture() }
      ];
      if (stepKind === "wp-media" && uploadAllowed && testPageId) {
        for (const file of mediaTests.filter(item => item.name === stepFile)) for (const destination of [stepDestination].filter(value => ["media-library", "attach", "featured"].includes(value))) {
          const filename = "TEST-IRPA-ACCEPTANCE-" + stamp + "-" + file.name + "-" + destination + "." + file.filename;
          try {
            const bytes = file.bytes || Uint8Array.from(atob(file.b64), char => char.charCodeAt(0));
            validateWebsiteMedia({ filename, contentType: file.mime, bytes });
            const upload = await wpRequest("media", "POST", bytes, {
              "Content-Type": file.mime,
              "Content-Disposition": 'attachment; filename="' + filename.replace(/[^A-Za-z0-9._-]/g, "_") + '"', "Accept": "application/json"
            });
            const mediaId = Number(upload.data?.id);
            if (!upload.response.ok || !Number.isSafeInteger(mediaId) || !isAllowedWordPressLink(upload.data?.source_url, wp)) {
              const firewallBlocked = [403, 406].includes(upload.response.status);
              add(file.name + " upload to WordPress " + destination, "FAIL", upload.response.status, firewallBlocked ? "FAIL: blocked by server firewall" : "WordPress media upload failed.", JSON.stringify(upload.diagnostics));
              if (firewallBlocked) {
                try {
                  const cp = cpanelConfig(env), directory = safeCpanelDirectory("wp-content/uploads", cp.documentRoot);
                  const form = new FormData(); form.set("dir", directory); form.set("file-1", new File([bytes], filename, { type: file.mime }));
                  const fallback = await fetch(new URL(cp.root + "/Fileman/upload_files"), { method: "POST", headers: { Authorization: authHeader(cp.username, cp.token), Accept: "application/json" }, body: form, signal: AbortSignal.timeout(20000) });
                  const fallbackData = await fallback.json().catch(() => null);
                  if (!fallback.ok || fallbackData?.status !== 1) throw new Error("cPanel fallback upload failed (HTTP " + fallback.status + ").");
                  const publicUrl = wp.root + "/wp-content/uploads/" + encodeURIComponent(filename), registerId = crypto.randomUUID(), now = new Date().toISOString(), sha256 = await websiteMediaSha256(bytes);
                  const mediaRow = { file: filename, title: "TEST " + file.name + " firewall fallback", altText: "TEST acceptance fallback", caption: "TEST ONLY — retained for acceptance evidence", category: "Acceptance Test", tags: ["TEST"], destination: "cpanel-folder", url: publicUrl, uploader: claims.user_id, uploaderEmail: claims.email || "", date: now, size: bytes.byteLength, sha256, status: "Available" };
                  await commitDocumentAndAudit(env, "communicationMediaAssets/" + registerId, claims.token, fields(mediaRow), Object.keys(mediaRow), fields({ action: "COMMUNICATION_WEBSITE_MEDIA_REGISTERED", category: "COMMUNICATIONS", collection: "communicationMediaAssets", recordId: registerId, actorUid: claims.user_id, actorEmail: claims.email || "", details: { file: filename, destination: "cpanel-folder", url: publicUrl, size: bytes.byteLength, sha256 }, createdAt: now }), { createOnly: true, collectionName: "communicationMediaAssets" });
                  cleanupList.push({ type: "media", id: registerId, url: publicUrl });
                  add(file.name + " cPanel media-register firewall fallback", "PASS", fallback.status, "TEST file uploaded and registered; original WordPress firewall failure remains recorded.");
                } catch (fallbackError) { add(file.name + " cPanel media-register firewall fallback", "FAIL", fallbackError.httpStatus || 0, fallbackError.message); }
              }
              continue;
            }
            cleanupList.push({ type: "media", id: mediaId, url: upload.data.source_url });
            const meta = await wpRequest("media/" + mediaId, "POST", { title: "TEST " + file.name + " " + destination, alt_text: "TEST acceptance upload", caption: "TEST ONLY — retained for acceptance evidence", ...(destination === "media-library" ? {} : { post: testPageId }) });
            if (!meta.response.ok || Number(meta.data?.id) !== mediaId) {
              add(file.name + " upload to WordPress " + destination + " metadata", "FAIL", meta.response.status, "WordPress media metadata/attachment failed.", JSON.stringify(meta.diagnostics));
              continue;
            }
            if (destination === "featured") {
              const featured = await wpRequest("pages/" + testPageId, "POST", { featured_media: mediaId, status: "draft" });
              if (!featured.response.ok) { add(file.name + " upload to WordPress featured", "FAIL", featured.response.status, "WordPress featured-media assignment failed.", JSON.stringify(featured.diagnostics)); continue; }
            }
            const opened = await wordpressEditorFetch(wp, upload.data.source_url, { headers: { Accept: "*/*" }, signal: AbortSignal.timeout(20000) });
            add(file.name + " upload to WordPress " + destination + " URL open", opened.ok ? "PASS" : "FAIL", opened.status, opened.ok ? "" : "Uploaded URL did not open successfully.");
          } catch (error) { add(file.name + " upload to WordPress " + destination, "FAIL", error.httpStatus || 0, error.message); }
        }
      } else if (stepKind === "wp-media") {
        add(stepFile + " upload to WordPress " + stepDestination, "FAIL", null, "Skipped because upload_files capability or TEST page creation was not confirmed.");
      }
      if (stepKind === "cpanel") try {
        const cp = cpanelConfig(env);
        const directory = safeCpanelDirectory("wp-content/uploads", cp.documentRoot);
        const listing = await cpanelCall(cp, "Fileman/list_files", { dir: directory });
        add("cPanel upload directory read", "PASS", listing.__httpStatus, "");
        for (const file of mediaTests.filter(item => item.name === stepFile)) {
          const filename = "TEST-IRPA-ACCEPTANCE-" + stamp + "-" + file.name + "." + file.filename;
          try {
            const bytes = file.bytes || Uint8Array.from(atob(file.b64), char => char.charCodeAt(0));
            validateWebsiteMedia({ filename, contentType: file.mime, bytes });
            const form = new FormData(); form.set("dir", directory); form.set("file-1", new File([bytes], filename, { type: file.mime }));
            const response = await fetch(new URL(cp.root + "/Fileman/upload_files"), { method: "POST", headers: { Authorization: authHeader(cp.username, cp.token), Accept: "application/json" }, body: form, signal: AbortSignal.timeout(20000) });
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.status !== 1) { add(file.name + " upload to cPanel folder", "FAIL", response.status, data?.errors?.join(" ") || "cPanel UAPI upload failed."); continue; }
            const publicUrl = wp.root + "/wp-content/uploads/" + encodeURIComponent(filename);
            const registerId = crypto.randomUUID(), now = new Date().toISOString(), sha256 = await websiteMediaSha256(bytes);
            const mediaRow = { file: filename, title: "TEST " + file.name + " cPanel acceptance", altText: "TEST acceptance upload", caption: "TEST ONLY — retained for acceptance evidence", category: "Acceptance Test", tags: ["TEST"], destination: "cpanel-folder", url: publicUrl, uploader: claims.user_id, uploaderEmail: claims.email || "", date: now, size: bytes.byteLength, sha256, status: "Available" };
            await commitDocumentAndAudit(env, "communicationMediaAssets/" + registerId, claims.token, fields(mediaRow), Object.keys(mediaRow), fields({ action: "COMMUNICATION_WEBSITE_MEDIA_REGISTERED", category: "COMMUNICATIONS", collection: "communicationMediaAssets", recordId: registerId, actorUid: claims.user_id, actorEmail: claims.email || "", details: { file: filename, destination: "cpanel-folder", url: publicUrl, size: bytes.byteLength, sha256 }, createdAt: now }), { createOnly: true, collectionName: "communicationMediaAssets" });
            cleanupList.push({ type: "media", id: registerId, url: publicUrl });
            const opened = await wordpressEditorFetch(wp, publicUrl, { headers: { Accept: "*/*" }, signal: AbortSignal.timeout(20000) });
            add(file.name + " upload to cPanel folder URL open", opened.ok ? "PASS" : "FAIL", opened.status, opened.ok ? "" : "Uploaded cPanel URL did not open successfully.");
          } catch (error) { add(file.name + " upload to cPanel folder", "FAIL", error.httpStatus || 0, error.message); }
        }
      } catch (error) {
        add("cPanel upload directory read", "FAIL", error.httpStatus || 0, error.message);
        for (const file of mediaTests.filter(item => item.name === stepFile)) add(file.name + " upload to cPanel folder", "FAIL", null, "Skipped because the existing cPanel uploads directory could not be read.");
      }
      const passCount = report.filter(row => row.status === "PASS").length;
      const failCount = report.filter(row => row.status === "FAIL").length;
      return json({ testRun: true, step, createdDrafts: { pageId: testPageId || null, postId: testPostId || null }, cleanupList, uploadsRetained: true, nothingDeleted: true, nothingPublished: true, passCount, failCount, report }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/seo-capabilities" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/posts", {
        method: "OPTIONS", headers: wordpressHeaders(wp, { Accept: "application/json" }),
        signal: AbortSignal.timeout(15000)
      });
      const schema = await response.json().catch(() => null);
      const properties = schema?.schema?.properties?.meta?.properties || {};
      const writable = key => !!properties[key] && properties[key].readonly !== true &&
        (!Array.isArray(properties[key].context) || properties[key].context.includes("edit"));
      const metaDescription = writable("_yoast_wpseo_metadesc");
      const focusKeyphrase = writable("_yoast_wpseo_focuskw");
      return json({
        source: "WordPress REST OPTIONS schema",
        verified: response.ok,
        yoast: { metaDescription, focusKeyphrase },
        writable: response.ok && (metaDescription || focusKeyphrase),
        message: response.ok && metaDescription && focusKeyphrase
          ? "Both Yoast fields are exposed as writable WordPress REST meta."
          : "One or both Yoast fields are not exposed as writable WordPress REST meta, or the REST schema could not be verified. Website Studio will not attempt to write unsupported fields."
      }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/posts" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      const allowedKeys = new Set(["title", "content", "excerpt", "categories", "tags", "featuredMedia", "slug", "seoMetaDescription", "seoFocusKeyphrase"]);
      if (Object.keys(input || {}).some(key => !allowedKeys.has(key))) {
        return json({ error: "New website updates accept content fields only; publication status is controlled by the server." }, 400, corsHeaders(request));
      }
      const title = cleanText(input.title, 180);
      const content = String(input.content || "");
      const excerpt = cleanText(String(input.excerpt || "").replace(/<[^>]*>/g, ""), 600);
      const featuredMedia = Number(input.featuredMedia || 0);
      const slug = cleanText(input.slug, 100).toLowerCase();
      const parseIds = value => Array.isArray(value) && value.length <= 100 &&
        value.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0) ? value.map(Number) : null;
      const categories = parseIds(input.categories || []);
      const tags = parseIds(input.tags || []);
      if (!title || !content || content.length > 30000 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Number.isSafeInteger(featuredMedia) || featuredMedia < 0 || !categories || !tags) {
        return json({ error: "Provide a title, content, valid excerpt, featured image ID and valid category/tag IDs." }, 400, corsHeaders(request));
      }
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const payload = { title, content: sanitizeWordPressContent(content), excerpt, slug, categories, tags, featured_media: featuredMedia, status: "draft" };
      const seoDescription = cleanText(input.seoMetaDescription, 160);
      const seoFocusKeyphrase = cleanText(input.seoFocusKeyphrase, 100);
      if (seoDescription || seoFocusKeyphrase) {
        const optionsResponse = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/posts", {
          method: "OPTIONS", headers: wordpressHeaders(wp, { Accept: "application/json" }),
          signal: AbortSignal.timeout(15000)
        });
        const options = await optionsResponse.json().catch(() => null);
        const properties = options?.schema?.properties?.meta?.properties || {};
        const writable = key => !!properties[key] && properties[key].readonly !== true &&
          (!Array.isArray(properties[key].context) || properties[key].context.includes("edit"));
        if (!optionsResponse.ok || seoDescription && !writable("_yoast_wpseo_metadesc") || seoFocusKeyphrase && !writable("_yoast_wpseo_focuskw")) {
          return json({ error: "The requested Yoast SEO field is not confirmed as writable through this site's WordPress REST API. Add it in the WordPress editor after draft creation; no plugin or site configuration was changed." }, 422, corsHeaders(request));
        }
        payload.meta = {};
        if (seoDescription) payload.meta._yoast_wpseo_metadesc = seoDescription;
        if (seoFocusKeyphrase) payload.meta._yoast_wpseo_focuskw = seoFocusKeyphrase;
      }
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/posts", {
        method: "POST", headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
      });
      const created = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(created?.id) || String(created?.status || "") !== "draft" || !isAllowedWordPressLink(created?.link, wp)) {
        throw new Error("WordPress did not confirm creation of a draft update. No publishing action was requested.");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_POST_DRAFT_CREATED", "posts", created.id, {
        title, categories, tags, featuredMedia, status: "draft", publicUrl: String(created.link || "")
      });
      const verified = await readWebsiteItem(wp, "posts", Number(created.id));
      const seoMetaVerified = !payload.meta || Object.entries(payload.meta).every(([key, value]) => verified.meta?.[key] === value);
      if (String(verified.status || "") !== "draft" || Number(verified.featured_media || 0) !== featuredMedia ||
          !sameEditorFields(verified, payload) || !seoMetaVerified) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_POST_DRAFT_VERIFICATION_FAILED", "posts", created.id, { status: String(verified.status || "") });
        throw new Error("The new WordPress update did not pass draft verification. It has not been submitted for approval.");
      }
      return json({ success: true, item: editorItem(verified, "posts"), message: "New update created and verified as a WordPress draft." }, 201, corsHeaders(request));
    }

    if (path === "/api/communications/website/content" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const type = url.searchParams.get("type") === "pages" ? "pages" : url.searchParams.get("type") === "posts" ? "posts" : "";
      if (!type) return json({ error: "Content type must be pages or posts." }, 400, corsHeaders(request));
      const listParams = new URLSearchParams({
        context: "edit", status: "any", per_page: "50", orderby: "modified", order: "desc"
      });
      const search = cleanText(url.searchParams.get("search"), 101);
      if (search) listParams.set("search", search);
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "?" + listParams.toString(), {
        headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(15000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data)) throw new Error("Could not list website content from the configured WordPress site.");
      if (data.some(item => !isAllowedWordPressLink(item.link, wp))) throw new Error("WordPress returned a URL outside the configured host allowlist; content listing was blocked.");
      return json({ items: data.map(item => ({
        id: Number(item.id), type, title: editorRaw(item, "title"), excerpt: editorRaw(item, "excerpt"),
        featuredMedia: Number(item.featured_media || 0), status: String(item.status || "draft"),
        link: String(item.link || ""), modified: String(item.modified || "")
      })) }, 200, corsHeaders(request));
    }

    const singleContentMatch = /^\/api\/communications\/website\/content\/(pages|posts)\/([1-9]\d*)$/.exec(path);
    if (singleContentMatch && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const type = singleContentMatch[1];
      const id = Number(singleContentMatch[2]);
      const item = await readWebsiteItem(wp, type, id);
      return json({ item: editorItem(item, type) }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/revisions" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const type = url.searchParams.get("type");
      const id = Number(url.searchParams.get("id"));
      if (!["pages", "posts"].includes(type) || !Number.isSafeInteger(id) || id < 1) {
        return json({ error: "A valid page/post type and ID are required." }, 400, corsHeaders(request));
      }
      await readWebsiteItem(wp, type, id);
      const native = await readWebsiteRevisions(wp, type, id);
      if (!env.DRIVE_KV || typeof env.DRIVE_KV.list !== "function" || typeof env.DRIVE_KV.get !== "function") {
        throw new Error("Website revision storage is unavailable.");
      }
      const prefix = "irpa:website-editor:snapshot:" + type + ":" + id + ":";
      const listing = await env.DRIVE_KV.list({ prefix, limit: 50 });
      const snapshots = [];
      for (const key of (listing.keys || [])) {
        const raw = await env.DRIVE_KV.get(key.name);
        if (!raw) continue;
        try {
          const snapshot = JSON.parse(raw);
          if (snapshot.type === type && Number(snapshot.itemId) === id && snapshot.snapshotId) {
            snapshots.push({
              source: "IRPA saved snapshot", snapshotId: snapshot.snapshotId,
              revisionId: snapshot.currentRevisionId, date: snapshot.createdAt,
              title: String(snapshot.title || ""), status: String(snapshot.status || "draft"),
              modified: String(snapshot.modified || "")
            });
          }
        } catch {}
      }
      const revisions = native.map(item => ({
        source: "WordPress revision", revisionId: Number(item.id),
        date: String(item.date || item.modified || ""), title: editorRaw(item, "title"),
        status: String(item.status || ""), modified: String(item.modified || "")
      }));
      revisions.push(...snapshots);
      revisions.sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""));
      return json({ type, id, revisions: revisions.slice(0, 100) }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/content" && request.method === "PUT") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      const allowedKeys = new Set(["type", "id", "title", "content", "excerpt", "featuredMedia", "status"]);
      if (Object.keys(input || {}).some(key => !allowedKeys.has(key))) {
        return json({ error: "Only title, content, excerpt, featured image and status may be changed." }, 400, corsHeaders(request));
      }
      const type = input.type;
      const id = Number(input.id);
      const title = String(input.title ?? "").trim();
      const content = String(input.content ?? "");
      const excerpt = String(input.excerpt ?? "").replace(/<[^>]*>/g, "").trim();
      const featuredMedia = Number(input.featuredMedia ?? 0);
      const status = String(input.status || "draft");
      if (!["pages", "posts"].includes(type) || !Number.isSafeInteger(id) || id < 1 ||
          !title || title.length > 180 || content.length > 30000 || excerpt.length > 600 ||
          !Number.isSafeInteger(featuredMedia) || featuredMedia < 0 || !["draft", "publish"].includes(status)) {
        return json({ error: "Provide a valid page/post ID, title, content, excerpt, featured image ID and draft/publish status." }, 400, corsHeaders(request));
      }
      if (String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").toLowerCase() === "production" && status === "publish") return json({ error: "Production publishing requires the approved communication-media workflow; save as draft and submit for approval." }, 403, corsHeaders(request));
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const current = await readWebsiteItem(wp, type, id);
      const changedFields = ["title", "content", "excerpt", "featuredMedia", "status"].filter(key => {
        const currentValue = key === "featuredMedia" ? Number(current.featured_media || 0) :
          key === "status" ? String(current.status || "draft") : editorRaw(current, key);
        const nextValue = key === "title" ? title : key === "content" ? sanitizeWordPressContent(content) :
          key === "excerpt" ? excerpt : key === "featuredMedia" ? featuredMedia : status;
        return currentValue !== nextValue;
      });
      const snapshot = await saveWebsiteSnapshot(env, claims, wp, type, id, current, changedFields);
      const payload = { title, content: sanitizeWordPressContent(content), excerpt, featured_media: featuredMedia, status };
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id, {
        method: "POST", headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(data?.id) || !isAllowedWordPressLink(data?.link, wp)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_CONTENT_UPDATE_FAILED", type, id, {
          snapshotId: snapshot.snapshotId, previousRevisionId: snapshot.currentRevisionId
        });
        const wordpressCode = typeof data?.code === "string" ? data.code.replace(/[^a-z0-9_]/gi, "").slice(0, 80) : "invalid_response";
        throw new Error("WordPress rejected the page/post update (HTTP " + response.status + ", code " + wordpressCode + "). The saved pre-edit snapshot remains available.");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_CONTENT_UPDATED", type, id, {
        snapshotId: snapshot.snapshotId, previousRevisionId: snapshot.currentRevisionId,
        changedFields, status, publicUrl: String(data.link || "")
      });
      const verified = await readWebsiteItem(wp, type, id);
      if (!sameEditorFields(verified, payload)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_CONTENT_VERIFICATION_FAILED", type, id, {
          snapshotId: snapshot.snapshotId, previousRevisionId: snapshot.currentRevisionId
        });
        throw new Error("WordPress did not verify every requested field. Use the saved revision to restore the previous version.");
      }
      const revisions = await readWebsiteRevisions(wp, type, id);
      const revisionId = revisions.length && Number.isSafeInteger(Number(revisions[0]?.id)) ? Number(revisions[0].id) : null;
      return json({
        success: true, item: editorItem(verified, type), snapshotId: snapshot.snapshotId,
        previousRevisionId: snapshot.currentRevisionId, revisionId,
        message: status === "publish" ? "Page/post published and verified." : "Draft saved and verified."
      }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/restore" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      const type = input.type;
      const id = Number(input.id);
      const snapshotId = String(input.snapshotId || "").trim();
      const revisionId = Number(input.revisionId);
      if (!["pages", "posts"].includes(type) || !Number.isSafeInteger(id) || id < 1 ||
          (!snapshotId && (!Number.isSafeInteger(revisionId) || revisionId < 1)) ||
          (snapshotId && !/^[0-9a-f-]{36}$/i.test(snapshotId))) {
        return json({ error: "A valid page/post and saved snapshot or WordPress revision are required." }, 400, corsHeaders(request));
      }
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const current = await readWebsiteItem(wp, type, id);
      const safetySnapshot = await saveWebsiteSnapshot(env, claims, wp, type, id, current, ["restore"]);
      let target;
      if (snapshotId) {
        if (!env.DRIVE_KV || typeof env.DRIVE_KV.get !== "function") throw new Error("Website revision storage is unavailable.");
        const raw = await env.DRIVE_KV.get(websiteSnapshotKey(type, id, snapshotId));
        if (!raw) throw new Error("Saved revision snapshot not found.");
        const snapshot = JSON.parse(raw);
        if (snapshot.snapshotId !== snapshotId || snapshot.type !== type || Number(snapshot.itemId) !== id) {
          throw new Error("Saved revision snapshot does not match this page/post.");
        }
        target = snapshotPayload(snapshot);
      } else {
        const revisionResponse = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id + "/revisions/" + revisionId + "?context=edit", {
          headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(15000)
        });
        const revision = await revisionResponse.json().catch(() => null);
        if (!revisionResponse.ok || !Number.isSafeInteger(revision?.id)) throw new Error("WordPress revision not found.");
        target = {
          title: editorRaw(revision, "title"),
          content: editorRaw(revision, "content"),
          excerpt: editorRaw(revision, "excerpt"),
          featured_media: Number(revision.featured_media ?? current.featured_media ?? 0),
          status: String(current.status || "draft")
        };
      }
      if (!target.title || target.title.length > 180 || target.content.length > 30000 || target.excerpt.length > 600 ||
          !Number.isSafeInteger(Number(target.featured_media)) || Number(target.featured_media) < 0) {
        throw new Error("The selected revision contains fields outside the permitted restore scope.");
      }
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id, {
        method: "POST", headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify(target), signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(data?.id) || !isAllowedWordPressLink(data?.link, wp)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_REVISION_RESTORE_FAILED", type, id, {
          requestedSnapshotId: snapshotId || null, requestedRevisionId: snapshotId ? null : revisionId,
          safetySnapshotId: safetySnapshot.snapshotId
        });
        throw new Error("WordPress rejected the revision restore. The pre-restore snapshot remains available.");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_REVISION_RESTORED", type, id, {
        requestedSnapshotId: snapshotId || null, requestedRevisionId: snapshotId ? null : revisionId,
        safetySnapshotId: safetySnapshot.snapshotId
      });
      const verified = await readWebsiteItem(wp, type, id);
      if (!sameEditorFields(verified, target)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_RESTORE_VERIFICATION_FAILED", type, id, {
          requestedSnapshotId: snapshotId || null, requestedRevisionId: snapshotId ? null : revisionId,
          safetySnapshotId: safetySnapshot.snapshotId
        });
        throw new Error("WordPress did not verify the restored revision exactly. The pre-restore snapshot remains available.");
      }
      return json({
        success: true, item: editorItem(verified, type), safetySnapshotId: safetySnapshot.snapshotId,
        message: "Website revision restored and verified."
      }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/publish" && request.method === "POST") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const itemId = String(input.itemId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(itemId)) return json({ error: "A valid communications item ID is required." }, 400, corsHeaders(request));
      const doc = await getFirestoreDocument(env, "communicationMediaItems/" + itemId, await getFirestoreAdminAccessToken(env));
      const item = firestoreDocumentToPlain(doc);
      if (!item) return json({ error: "Communications item not found." }, 404, corsHeaders(request));
      if (item.status === "Published" && item.publicUrl && item.wpPostId) return json({ success: true, alreadyPublished: true, publicUrl: item.publicUrl }, 200, corsHeaders(request));
      if (item.status !== "Approved" || !["Website Article", "Press Release", "Website Page"].includes(item.type) || !["IRPA Website", "Press / Media"].includes(item.channel)) {
        return json({ error: "Only approved website pages, articles and press releases can be published." }, 409, corsHeaders(request));
      }
      const title = cleanText(item.title, 181);
      const body = cleanText(item.body, 30001);
      if (!title || title.length > 180 || !body || body.length > 30000) return json({ error: "The approved content is incomplete or exceeds the allowed length." }, 400, corsHeaders(request));
      const wp = wordpressConfig(env);
      const isPage = item.type === "Website Page";
      const endpoint = wp.root + "/wp-json/wp/v2/" + (isPage ? "pages" : "posts");
      const requestedSlug = cleanText(item.slug, 100).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const languageSuffix = String(item.language || "English").toLowerCase().startsWith("kiswahili") ? "-sw" : "-en";
      const slug = requestedSlug ? requestedSlug + languageSuffix : "irpa-" + itemId;
      const contentHtml = /<\/?[a-z][^>]*>/i.test(body) ? sanitizeWordPressContent(body) : plainContent(body);
      const lookup = await fetch(endpoint + "?slug=" + encodeURIComponent(slug) + "&status=publish,draft,pending,private&per_page=1", {
        headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(15000)
      });
      const found = await lookup.json().catch(() => null);
      if (!lookup.ok || !Array.isArray(found)) throw new Error("Could not safely check existing website content before publishing.");
      let post = found.find(p => Number.isInteger(p.id) && typeof p.link === "string");
      const publicationContent = contentHtml + (isPage && /^https:\/\//i.test(String(item.assetUrl || "")) ? '<p><img src="' + htmlEscape(String(item.assetUrl)) + '" alt="' + htmlEscape(title) + '" /></p>' : "");
      if (!post) {
        const response = await wordpressEditorFetch(wp, endpoint, {
          method: "POST",
          headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
          body: JSON.stringify({ title, content: publicationContent, excerpt: htmlEscape(cleanText(item.summary, 600)), slug, status: "publish", comment_status: "closed", ping_status: "closed" }),
          signal: AbortSignal.timeout(30000)
        });
        post = await response.json().catch(() => null);
        if (!response.ok || !Number.isInteger(post?.id) || typeof post?.link !== "string" || String(post?.status || "") !== "publish") throw new Error("The website rejected the publishing request.");
      } else if (String(post.status || "") !== "publish") {
        const response = await wordpressEditorFetch(wp, endpoint + "/" + Number(post.id), {
          method: "POST",
          headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
          body: JSON.stringify({ title, content: publicationContent, excerpt: htmlEscape(cleanText(item.summary, 600)), slug, status: "publish" }),
          signal: AbortSignal.timeout(30000)
        });
        const promoted = await response.json().catch(() => null);
        if (!response.ok || Number(promoted?.id) !== Number(post.id) || String(promoted?.status || "") !== "publish" || !isAllowedWordPressLink(promoted?.link, wp)) {
          throw new Error("The approved WordPress draft could not be promoted to Published.");
        }
        post = promoted;
      }
      const now = new Date().toISOString();
      const documentFields = fields({ status: "Published", wpPostId: post.id, publicUrl: post.link, publishedAt: now, publishedByUid: claims.user_id, publishedByEmail: claims.email || "", updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: claims.email || "" });
      const auditFields = fields({ action: "COMMUNICATION_MEDIA_PUBLISHED", category: "COMMUNICATIONS", collection: "communicationMediaItems", recordId: itemId, actorUid: claims.user_id, actorEmail: claims.email || "", details: { type: item.type, channel: item.channel, language: item.language || null, wpPostId: post.id, publicUrl: post.link, approvedBeforePublishing: true }, createdAt: now });
      await commitDocumentAndAudit(env, itemId, claims.token, documentFields, Object.keys(documentFields), auditFields, { collectionName: "communicationMediaItems" });
      return json({ success: true, publicUrl: post.link, wpPostId: post.id, message: isPage ? "Approved IRPA website page published and recorded." : "Approved content published to the IRPA website." }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/diagnostics" && request.method === "GET") {
      await authorised(request, env, true);
      const cp = cpanelConfig(env);
      const domain = String(url.searchParams.get("domain") || "").toLowerCase();
      if (!/^[a-z0-9.-]{1,253}$/.test(domain) || domain.startsWith(".") || domain.endsWith(".")) {
        return json({ error: "A valid website domain is required for cPanel read-only diagnostics." }, 400, corsHeaders(request));
      }
      const result = { readOnly: true, domain, emailAccounts: { status: "not_checked" }, ssl: { status: "not_checked" }, phpLimits: { status: "not_checked", upload_max_filesize: null, post_max_size: null } };
      const extractRows = value => {
        const data = value?.data;
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.[0]?.data)) return data[0].data;
        if (Array.isArray(data?.data)) return data.data;
        return [];
      };
      try {
        const response = await cpanelCall(cp, "Email/list_pops", { domain });
        result.emailAccounts = { status: "PASS", httpStatus: response.__httpStatus, count: extractRows(response).length, accounts: extractRows(response).map(row => cleanText(row.email || row.login || "", 254)).filter(Boolean) };
      } catch (error) {
        result.emailAccounts = { status: "FAIL", diagnosticCode: String(error.diagnosticCode || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 100), httpStatus: error.httpStatus ?? null, error: cleanText(error.message, 240) };
      }
      try {
        const response = await cpanelCall(cp, "SSL/installed_hosts");
        const rawRows = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.certificates) ? response.data.certificates : Array.isArray(response?.certificates) ? response.certificates : extractRows(response);
        const normal = value => String(value || "").toLowerCase().replace(/^\\*\\./, "");
        const match = rawRows.find(row => [row.domain, row.host, row.servername, row.subject].some(value => normal(value).includes(normal(domain))));
        const expiry = match && (match.not_after || match.expiry || match.expires || match.notAfter || "");
        result.ssl = { status: match && expiry ? "PASS" : "FAIL", httpStatus: response.__httpStatus, hosts: match ? [{ domain: cleanText(match.domain || match.host || match.servername || match.subject || domain, 253), status: cleanText(match.status || match.certificate_status || "installed", 80), issuer: cleanText(match.issuer || "", 120), expiry: cleanText(expiry, 80) }] : [], error: match ? (!expiry ? "Matching certificate has no readable expiry field." : "") : "No matching SSL certificate was returned.", detail: match ? "" : cleanText(typeof response === "string" ? response : JSON.stringify(response), 200).replace(/(authorization|token|secret)\\s*[:=]\\s*[^,;\\s]+/ig, "$1=[REDACTED]") };
      } catch (error) {
        result.ssl = { status: "FAIL", diagnosticCode: String(error.diagnosticCode || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 100), httpStatus: error.httpStatus ?? null, error: cleanText(error.message, 240) };
      }
      try {
        const sources = [
          [".user.ini", () => cpanelCall(cp, "Fileman/get_file_content", { dir: cp.documentRoot, file: ".user.ini" })],
          ["php.ini", () => cpanelCall(cp, "Fileman/get_file_content", { dir: cp.documentRoot, file: "php.ini" })],
          ["MultiPHP INI", () => cpanelCall(cp, "LangPHP/php_ini_get_user_content", { type: "vhost", vhost: domain })]
        ];
        let upload = null, post = null, source = "", lastResponse = null;
        for (const [name, read] of sources) {
          try {
            const response = await read(); lastResponse = response;
            const data = response?.data?.content ?? response?.data?.[0]?.content ?? response?.content ?? response?.[0]?.content ?? response?.data?.data?.content ?? response;
            const iniContent = typeof data === "string" ? data : String(data?.ini || data?.php_ini || data?.content || "");
            const directive = key => iniContent.match(new RegExp("^\\s*" + key + "\\s*=\\s*([^\\s;#]+)", "im"))?.[1] || null;
            const foundUpload = directive("upload_max_filesize"), foundPost = directive("post_max_size");
            if (foundUpload || foundPost) { upload = foundUpload; post = foundPost; source = name; }
            if (upload && post) break;
          } catch {}
        }
        result.phpLimits = { status: upload && post ? "PASS" : "INFO", httpStatus: lastResponse?.__httpStatus ?? null, upload_max_filesize: cleanText(upload || "", 40) || null, post_max_size: cleanText(post || "", 40) || null, source, diagnostic: upload && post ? null : "INFO: not exposed by cPanel; check cPanel MultiPHP INI Editor" };
      } catch (error) {
        result.phpLimits = { status: "INFO", upload_max_filesize: null, post_max_size: null, diagnosticCode: String(error.diagnosticCode || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 100), diagnostic: "INFO: not exposed by cPanel; check cPanel MultiPHP INI Editor" };
      }
      return json(result, 200, corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/files" && request.method === "GET") {
      await authorised(request, env, true);
      const cp = cpanelConfig(env);
      const requestedPath = url.searchParams.get("path");
      if (requestedPath !== null) {
        const safe = safeCpanelPath(requestedPath, cp.documentRoot);
        const file = await cpanelCall(cp, "Fileman/get_file_content", { dir: safe.dir, file: safe.file });
        const content = file.data?.content ?? file.data?.[0]?.content ?? file.data?.data?.content ?? file.data?.data?.[0]?.content ?? file.data?.result?.data?.content;
        if (typeof content !== "string") throw new Error("The selected website file could not be read.");
        const truncated = new TextEncoder().encode(content).byteLength > MAX_EDIT_BYTES;
        return json({ path: safe.relative, content: truncated ? "" : content, truncated }, 200, corsHeaders(request));
      }
      const relativeDir = String(url.searchParams.get("dir") || "");
      const dir = safeCpanelDirectory(relativeDir, cp.documentRoot);
      const listing = await cpanelCall(cp, "Fileman/list_files", { dir });
      const rows = listing.data?.[0]?.data || listing.data || [];
      const entries = Array.isArray(rows) ? rows.map(row => {
        const name = String(row.file || row.name || "");
        const type = String(row.type || (row.is_dir ? "dir" : "file")).toLowerCase();
        const isDirectory = ["dir", "directory", "folder"].includes(type) || row.is_dir === true;
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
        if (!name || name.startsWith(".")) return null;
        if (isDirectory) return /^[A-Za-z0-9 _.-]{1,120}$/.test(name) && name !== "." && name !== ".." ? { name, type: "dir" } : null;
        return EDITABLE_EXTENSIONS.has(ext) ? { name, type: "file", size: Number(row.file_size || row.size || 0) } : null;
      }).filter(Boolean) : [];
      return json({ directory: relativeDir, entries }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/rollback" && request.method === "POST") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const backupId = String(input.backupId || "");
      const relative = String(input.path || "");
      if (!/^cpanel-backup:[0-9a-f-]{36}$/i.test(backupId) || !relative) return json({ error: "A valid rollback snapshot and file path are required." }, 400, corsHeaders(request));
      if (!env.DRIVE_KV) throw new Error("The existing Cloudflare rollback store is unavailable.");
      const backup = await env.DRIVE_KV.get(backupId, "json");
      if (!backup || backup.path !== relative || typeof backup.content !== "string") return json({ error: "The rollback snapshot is missing, expired or does not match this file." }, 404, corsHeaders(request));
      const cp = cpanelConfig(env);
      const safe = safeCpanelPath(relative, cp.documentRoot);
      const current = await cpanelCall(cp, "Fileman/get_file_content", { dir: safe.dir, file: safe.file });
      const currentContent = current.data?.content ?? current.data?.[0]?.content ?? current.data?.data?.content ?? current.data?.data?.[0]?.content ?? current.data?.result?.data?.content;
      if (typeof currentContent !== "string") throw new Error("The current file could not be read; rollback was not applied.");
      const safetyBackupId = "cpanel-backup:" + crypto.randomUUID();
      await env.DRIVE_KV.put(safetyBackupId, JSON.stringify({ path: safe.relative, content: currentContent }), { expirationTtl: 604800 });
      await cpanelCall(cp, "Fileman/save_file_content", { dir: safe.dir, file: safe.file, content: backup.content, charset: "utf-8" }, "POST");
      const now = new Date().toISOString();
      const auditFields = fields({ action: "CPANEL_STATIC_FILE_ROLLED_BACK", category: "COMMUNICATIONS", collection: "cpanelFiles", recordId: safe.relative, actorUid: claims.user_id, actorEmail: claims.email || "", details: { path: safe.relative, rollbackBackupId: backupId, safetyBackupId }, createdAt: now });
      await commitDocumentAndAudit(env, "cpanelFileEdits/" + crypto.randomUUID(), claims.token, fields({ path: safe.relative, updatedByUid: claims.user_id, updatedAt: now, rollbackBackupId: backupId, safetyBackupId }), ["path", "updatedByUid", "updatedAt", "rollbackBackupId", "safetyBackupId"], auditFields, { createOnly: true });
      return json({ success: true, path: safe.relative, safetyBackupId, message: "The selected rollback snapshot was restored; the pre-rollback version is also retained for seven days." }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/files" && request.method === "PUT") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const safe = safeCpanelPath(input.path, cpanelConfig(env).documentRoot);
      const content = String(input.content ?? "");
      if (new TextEncoder().encode(content).byteLength > MAX_EDIT_BYTES) return json({ error: "Website file exceeds the 512 KB edit limit." }, 413, corsHeaders(request));
      const cp = cpanelConfig(env);
      if (!env.DRIVE_KV) throw new Error("The existing Cloudflare rollback store is unavailable; the file was not changed.");
      const prior = await cpanelCall(cp, "Fileman/get_file_content", { dir: safe.dir, file: safe.file });
      const priorContent = prior.data?.content ?? prior.data?.[0]?.content ?? prior.data?.data?.content ?? prior.data?.data?.[0]?.content ?? prior.data?.result?.data?.content;
      if (typeof priorContent !== "string") throw new Error("The current file could not be read; the file was not changed.");
      const backupId = "cpanel-backup:" + crypto.randomUUID();
      await env.DRIVE_KV.put(backupId, JSON.stringify({ path: safe.relative, content: priorContent }), { expirationTtl: 604800 });
      await cpanelCall(cp, "Fileman/save_file_content", { dir: safe.dir, file: safe.file, content, charset: "utf-8" }, "POST");
      const now = new Date().toISOString();
      const auditFields = fields({ action: "CPANEL_STATIC_FILE_EDITED", category: "COMMUNICATIONS", collection: "cpanelFiles", recordId: safe.relative, actorUid: claims.user_id, actorEmail: claims.email || "", details: { path: safe.relative, bytes: new TextEncoder().encode(content).byteLength, rollbackBackupId: backupId, backupRetentionDays: 7 }, createdAt: now });
      await commitDocumentAndAudit(env, "cpanelFileEdits/" + crypto.randomUUID(), claims.token, fields({ path: safe.relative, updatedByUid: claims.user_id, updatedAt: now, rollbackBackupId: backupId }), ["path", "updatedByUid", "updatedAt", "rollbackBackupId"], auditFields, { createOnly: true });
      return json({ success: true, path: safe.relative, backupId, message: "Website file saved through cPanel. A rollback snapshot is retained for seven days; verify the public page before considering the edit complete." }, 200, corsHeaders(request));
    }
    return null;
  }

  return async (request, env) => {
    try { return await handle(request, env); }
    catch (error) {
      const status = /authentication|token/i.test(String(error.message)) ? 401 :
        /role does not permit|authorised|authorized/i.test(String(error.message)) ? 403 :
        /not found/i.test(String(error.message)) ? 404 : 502;
      return json({ error: error.message || "Website management request failed." }, status, corsHeaders(request));
    }
  };
}
