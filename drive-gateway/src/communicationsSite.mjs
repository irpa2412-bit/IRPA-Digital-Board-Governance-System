const AUTHOR_ROLES = new Set([
  "Communications Officer", "Communications Manager", "Media Officer",
  "Public Relations Officer", "Director Outreach", "Outreach Director",
  "Director Community Development", "Community Development Director",
  "Executive Director", "Administrator"
]);
const REVIEW_ROLES = new Set([
  "Executive Director", "Director Outreach", "Outreach Director",
  "Director Community Development", "Community Development Director", "Administrator"
]);
const EDITABLE_EXTENSIONS = new Set([".html", ".htm", ".css", ".txt", ".json"]);
const MAX_EDIT_BYTES = 512 * 1024;
const WEBSITE_EDITOR_ROLES = new Set([
  "Communication & Media", "Communications & Media", "Communication and Media", "Communications and Media",
  "Communication & Media Chair", "Communications & Media Chair", "Communication and Media Chair", "Communications and Media Chair",
  "Communications Officer", "Communication Officer", "Communications Manager", "Communication Manager",
  "Media Officer", "Media Manager", "Public Relations Officer", "Communications & Media Officer",
  "Communications and Media Officer", "Media and Communications Officer", "Media & Communications Officer"
]);
const MAX_WEBSITE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
import { assertAllowedWebsiteMutation, assertStagingWebsiteHost, editorialWordPressStatus, mayPublish, validateMediaUpload } from "./communicationsWebsitePolicy.mjs";

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
    authenticateFirebaseRequest, getFirestoreDocument, getInstitutionalProfileForUser,
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
    const roles = [...new Set([...tokenRoles, ...values(member), ...values(employee)])];
    const isActive = active(member) || active(employee);
    if (!isActive || !roles.some(role => WEBSITE_EDITOR_ROLES.has(role))) {
      throw new Error("Your registered Communication & Media role does not permit this website-editing action.");
    }
    return { claims, roles, admin: false };
  }

  function wordpressConfig(env) {
    let base;
    try { base = new URL(String(env.WORDPRESS_BASE_URL || "")); }
    catch { throw new Error("Website publishing is not configured."); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      throw new Error("Website endpoint configuration is invalid.");
    }
    const username = String(env.WORDPRESS_USERNAME || "").trim();
    const password = String(env.WORDPRESS_APPLICATION_PASSWORD || "").replace(/\s/g, "");
    if (!username || !password) throw new Error("Website publishing credentials are not configured.");
    return { root: base.toString().replace(/\/$/, ""), auth: "Basic " + btoa(unescape(encodeURIComponent(username + ":" + password))), stagingAuthHeader: base.hostname.toLowerCase() === "staging.irpa.or.tz" };
  }

  function wordpressHeaders(wp, extra = {}) {
    const headers = { Authorization: wp.auth, ...extra };
    // Staging nginx/FastCGI strips Authorization before PHP; forward it under a
    // staging-only header validated by the isolated staging MU-plugin.
    if (wp.stagingAuthHeader) headers["X-IRPA-Staging-Authorization"] = wp.auth;
    return headers;
  }

  function stagingWordPressConfig(env) {
    if (String(env.IRPA_ENVIRONMENT || "").toLowerCase() !== "staging") {
      throw new Error("WordPress page/post editing is disabled outside the staging Worker.");
    }
    const wp = wordpressConfig(env);
    assertStagingWebsiteHost(wp.root);
    return wp;
  }

  async function wordpressEditorFetch(wp, endpoint, init = {}) {
    const target = new URL(endpoint);
    if (target.protocol !== "https:" || target.hostname.toLowerCase() !== "staging.irpa.or.tz") {
      throw new Error("WordPress editor requests are restricted to the dedicated staging hostname.");
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
      throw new Error("Staging WordPress authentication failed; the integration account was not verified.");
    }
    const roles = Array.isArray(user.roles) ? user.roles.map(role => String(role).toLowerCase()) : [];
    if (!roles.includes("editor") || roles.includes("administrator")) {
      throw new Error("The staging WordPress integration account must have the Editor role and must not be an Administrator.");
    }
    return user;
  }

  function cpanelConfig(env) {
    let base;
    try { base = new URL(String(env.CPANEL_BASE_URL || "")); }
    catch { throw new Error("cPanel integration is not configured."); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || base.port !== "2083") {
      throw new Error("cPanel endpoint configuration is invalid.");
    }
    const username = String(env.CPANEL_USERNAME || "").trim();
    const token = String(env.CPANEL_API_TOKEN || "").trim();
    if (!username || !token) throw new Error("cPanel API credentials are not configured.");
    const configuredRoot = String(env.CPANEL_DOCUMENT_ROOT || "public_html/staging").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
    const absoluteStagingRoot = "/home/" + username + "/public_html/staging";
    const homeRelativeStagingRoot = "home/" + username + "/public_html/staging";
    let documentRoot;
    if (configuredRoot === absoluteStagingRoot || configuredRoot === homeRelativeStagingRoot || configuredRoot === "public_html/staging") {
      documentRoot = "public_html/staging";
    } else {
      throw new Error("cPanel document root must resolve to the exact staging directory.");
    }
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
    if (!response.ok || !data || data.status !== 1) {
      const status = Number.isInteger(response.status) ? response.status : 0;
      const uapiStatus = data && Number.isInteger(data.status) ? data.status : "unknown";
      const errorCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      const errorText = Array.isArray(data?.errors) ? data.errors.join(" ").toLowerCase() : "";
      const category = /permission|access denied|not authorized|not allowed/.test(errorText) ? "permission_denied" :
        /not found|does not exist|no such file|cannot find/.test(errorText) ? "not_found" :
        /invalid|unsupported|unknown function|unknown api/.test(errorText) ? "invalid_operation" :
        /auth|token|login/.test(errorText) ? "authentication_rejected" : "uapi_error";
      throw new Error("cPanel operation failed (" + operation.replace(/[^A-Za-z0-9_/-]/g, "").slice(0, 80) +
        "; HTTP " + status + "; UAPI status " + uapiStatus + "; error_count " + errorCount + "; category " + category + ").");
    }
    return data;
  }

  function isStagingPublicLink(value) {
    try {
      const link = new URL(String(value || ""));
      return link.protocol === "https:" && link.hostname.toLowerCase() === "staging.irpa.or.tz";
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
      modified: String(item.modified || ""),
      seoTitle: String(item.meta?.["_yoast_wpseo_title"] || item.meta?.["rank_math_title"] || ""),
      seoDescription: String(item.meta?.["_yoast_wpseo_metadesc"] || item.meta?.["rank_math_description"] || "")
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
    if (!isStagingPublicLink(data.link)) throw new Error("WordPress returned a non-staging page URL; the edit was blocked.");
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
        throw new Error("Staging revision storage is unavailable; no edit was made.");
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
          message === "Staging revision storage is unavailable; no edit was made." ||
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
      throw new Error("Staging website snapshot failed at stage " + stage + " (" + category + "); no page edit was made.");
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
    if (path === "/api/communications/site/status" && request.method === "GET") {
      const { roles } = await websiteEditorAuthorised(request, env);
      const result = { website: "not_configured", cpanel: "not_configured" };
      try {
        const wp = stagingWordPressConfig(env);
        const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/users/me?context=edit", {
          headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(12000)
        });
        result.websiteHttpStatus = response.status;
        result.websiteAuthBridgeDiagnostic = response.headers.get("x-irpa-staging-auth-diagnostic") || null;
        if (response.ok) {
          const user = await response.json();
          const roles = Array.isArray(user.roles) ? user.roles.map(role => String(role).toLowerCase()) : [];
          const isDedicatedEditor = roles.includes("editor") && !roles.includes("administrator");
          result.website = isDedicatedEditor ? "connected" : "wrong_account_role";
          result.websiteAccount = { name: cleanText(user.name, 100), role: isDedicatedEditor ? "editor" : "unverified", canEditPosts: user.capabilities && typeof user.capabilities === "object" ? !!user.capabilities.edit_posts : undefined, canEditPages: user.capabilities && typeof user.capabilities === "object" ? !!user.capabilities.edit_pages : undefined };
        } else { const contentType = response.headers.get("content-type") || ""; const server = response.headers.get("server") || ""; const cfRay = response.headers.get("cf-ray") || ""; const raw = await response.text().catch(() => ""); let detail = {}; if (contentType.includes("json")) { try { detail = JSON.parse(raw); } catch {} } result.website = response.status === 401 || response.status === 403 ? "authentication_failed" : "unavailable"; result.websiteHttpStatus = response.status; result.websiteErrorCode = typeof detail.code === "string" ? detail.code.slice(0, 100) : undefined; result.websiteResponseType = contentType.slice(0, 100); result.websiteResponseServer = server.slice(0, 80); result.websiteCloudflareRay = cfRay.slice(0, 100); }
      } catch (error) { result.website = error.message.includes("not configured") ? "not_configured" : "unavailable"; }
      try {
        const cp = cpanelConfig(env);
        await cpanelCall(cp, "DomainInfo/list_domains");
        result.cpanel = "connected";
      } catch (error) {
        const message = String(error?.message || "");
        result.cpanel = message.includes("not configured") ? "not_configured" : "unavailable_or_denied";
        // Safe diagnostics only: never return hostnames, usernames, tokens, or raw UAPI errors.
        result.cpanelDiagnostic = message.includes("endpoint configuration is invalid") ? "endpoint_invalid" :
          message.includes("credentials are not configured") ? "credentials_missing" :
          /category authentication_rejected/.test(message) ? "authentication_rejected" :
          /category permission_denied/.test(message) ? "permission_denied" :
          /category invalid_operation/.test(message) ? "invalid_operation" :
          /category not_found/.test(message) ? "resource_not_found" :
          /category uapi_error/.test(message) ? "uapi_error" :
          /category/.test(message) ? "request_failed" :
          message.includes("not configured") ? "configuration_missing" : "connection_failed";
      }
      return json({ ok: true, connections: result, permissions: { websiteEditor: true, staticFileEditing: roles.some(r => REVIEW_ROLES.has(r)) } }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/content" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = stagingWordPressConfig(env);
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
      if (!response.ok || !Array.isArray(data)) throw new Error("Could not list staging website content.");
      if (data.some(item => !isStagingPublicLink(item.link))) throw new Error("WordPress returned a non-staging page URL; content listing was blocked.");
      return json({ items: data.map(item => ({
        id: Number(item.id), type, title: editorRaw(item, "title"), excerpt: editorRaw(item, "excerpt"),
        featuredMedia: Number(item.featured_media || 0), status: String(item.status || "draft"),
        seoTitle: String(item.meta?.["_yoast_wpseo_title"] || item.meta?.["rank_math_title"] || ""),
        seoDescription: String(item.meta?.["_yoast_wpseo_metadesc"] || item.meta?.["rank_math_description"] || ""),
        link: String(item.link || ""), modified: String(item.modified || "")
      })) }, 200, corsHeaders(request));
    }

    const singleContentMatch = /^\/api\/communications\/website\/content\/(pages|posts)\/([1-9]\d*)$/.exec(path);
    if (singleContentMatch && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = stagingWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const type = singleContentMatch[1];
      const id = Number(singleContentMatch[2]);
      const item = await readWebsiteItem(wp, type, id);
      return json({ item: editorItem(item, type) }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/media" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const wp = stagingWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      let form;
      try { form = await request.formData(); } catch { return json({ error: "Upload must use multipart form data." }, 400, corsHeaders(request)); }
      const file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Select one media file to upload." }, 400, corsHeaders(request));
      try { validateMediaUpload({ filename: file.name, contentType: file.type, size: file.size }); }
      catch (error) { return json({ error: error.message }, 400, corsHeaders(request)); }
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength !== file.size) return json({ error: "Media upload size validation failed." }, 400, corsHeaders(request));
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/media", {
        method: "POST",
        headers: wordpressHeaders(wp, {
          "Content-Type": file.type,
          "Content-Disposition": 'attachment; filename="' + String(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) + '"',
          Accept: "application/json"
        }),
        body: bytes,
        signal: AbortSignal.timeout(30000)
      });
      const media = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(media?.id) || !isStagingPublicLink(media?.source_url)) {
        throw new Error("Staging WordPress rejected the media upload (HTTP " + response.status + ").");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_MEDIA_UPLOADED", "media", Number(media.id), {
        filename: String(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120),
        contentType: file.type, bytes: file.size
      });
      return json({ success: true, media: { id: media.id, title: editorRaw(media, "title"), url: media.source_url, mimeType: media.mime_type, bytes: file.size } }, 201, corsHeaders(request));
    }

    if (path === "/api/communications/website/revisions" && request.method === "GET") {
      await websiteEditorAuthorised(request, env);
      const wp = stagingWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const type = url.searchParams.get("type");
      const id = Number(url.searchParams.get("id"));
      if (!["pages", "posts"].includes(type) || !Number.isSafeInteger(id) || id < 1) {
        return json({ error: "A valid page/post type and ID are required." }, 400, corsHeaders(request));
      }
      await readWebsiteItem(wp, type, id);
      const native = await readWebsiteRevisions(wp, type, id);
      if (!env.DRIVE_KV || typeof env.DRIVE_KV.list !== "function" || typeof env.DRIVE_KV.get !== "function") {
        throw new Error("Staging revision storage is unavailable.");
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
      const { claims, roles, admin } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      try { assertAllowedWebsiteMutation(input); } catch (error) { return json({ error: error.message }, 400, corsHeaders(request)); }
      const workflow = input.workflow || (input.status === "publish" ? "Publish" : "Draft");
      let status;
      try { status = editorialWordPressStatus(workflow); } catch (error) { return json({ error: error.message }, 400, corsHeaders(request)); }
      if (status === "publish" && !mayPublish({ admin, active: true, roles })) return json({ error: "Only the active Communication & Media Chair or an active administrator may publish website content." }, 403, corsHeaders(request));
      const type = input.type;
      const id = Number(input.id);
      const title = String(input.title ?? "").trim();
      const content = String(input.content ?? "");
      const excerpt = String(input.excerpt ?? "").replace(/<[^>]*>/g, "").trim();
      const seoTitle = String(input.seoTitle ?? "").trim().slice(0, 180);
      const seoDescription = String(input.seoDescription ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 320);
      const featuredMedia = Number(input.featuredMedia ?? 0);
      const requestedStatus = status;
      if (!["pages", "posts"].includes(type) || !Number.isSafeInteger(id) || id < 1 ||
          !title || title.length > 180 || content.length > 30000 || excerpt.length > 600 || seoTitle.length > 180 || seoDescription.length > 320 ||
          !Number.isSafeInteger(featuredMedia) || featuredMedia < 0 || !["draft", "pending", "publish"].includes(requestedStatus)) {
        return json({ error: "Provide a valid page/post ID, title, content, excerpt, featured image ID and draft/publish status." }, 400, corsHeaders(request));
      }
      const wp = stagingWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const current = await readWebsiteItem(wp, type, id);
      const changedFields = ["title", "content", "excerpt", "featuredMedia", "status", "seoTitle", "seoDescription"].filter(key => {
        const currentValue = key === "featuredMedia" ? Number(current.featured_media || 0) :
          key === "status" ? String(current.status || "draft") : key === "seoTitle" ? String(current.meta?.["_yoast_wpseo_title"] || current.meta?.["rank_math_title"] || "") : key === "seoDescription" ? String(current.meta?.["_yoast_wpseo_metadesc"] || current.meta?.["rank_math_description"] || "") : editorRaw(current, key);
        const nextValue = key === "title" ? title : key === "content" ? sanitizeWordPressContent(content) :
          key === "excerpt" ? excerpt : key === "featuredMedia" ? featuredMedia : key === "seoTitle" ? seoTitle : key === "seoDescription" ? seoDescription : requestedStatus;
        return currentValue !== nextValue;
      });
      const snapshot = await saveWebsiteSnapshot(env, claims, wp, type, id, current, changedFields);
      const payload = { title, content: sanitizeWordPressContent(content), excerpt, featured_media: featuredMedia, status: requestedStatus, meta: { _yoast_wpseo_title: seoTitle, _yoast_wpseo_metadesc: seoDescription, rank_math_title: seoTitle, rank_math_description: seoDescription } };
      const response = await wordpressEditorFetch(wp, wp.root + "/wp-json/wp/v2/" + type + "/" + id, {
        method: "POST", headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(data?.id) || !isStagingPublicLink(data?.link)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_CONTENT_UPDATE_FAILED", type, id, {
          snapshotId: snapshot.snapshotId, previousRevisionId: snapshot.currentRevisionId
        });
        const wordpressCode = typeof data?.code === "string" ? data.code.replace(/[^a-z0-9_]/gi, "").slice(0, 80) : "invalid_response";
        throw new Error("WordPress rejected the staging page/post update (HTTP " + response.status + ", code " + wordpressCode + "). The saved pre-edit snapshot remains available.");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_CONTENT_UPDATED", type, id, {
        snapshotId: snapshot.snapshotId, previousRevisionId: snapshot.currentRevisionId,
        changedFields, status: requestedStatus, workflow, publicUrl: String(data.link || "")
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
        message: workflow === "Publish" ? "Staging page/post published and verified." : workflow === "Review" ? "Staging page/post submitted for review and verified." : "Staging draft saved and verified."
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
      const wp = stagingWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const current = await readWebsiteItem(wp, type, id);
      const safetySnapshot = await saveWebsiteSnapshot(env, claims, wp, type, id, current, ["restore"]);
      let target;
      if (snapshotId) {
        if (!env.DRIVE_KV || typeof env.DRIVE_KV.get !== "function") throw new Error("Staging revision storage is unavailable.");
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
      if (!response.ok || !Number.isSafeInteger(data?.id) || !isStagingPublicLink(data?.link)) {
        await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_REVISION_RESTORE_FAILED", type, id, {
          requestedSnapshotId: snapshotId || null, requestedRevisionId: snapshotId ? null : revisionId,
          safetySnapshotId: safetySnapshot.snapshotId
        });
        throw new Error("WordPress rejected the staging revision restore. The pre-restore snapshot remains available.");
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
        message: "Staging revision restored and verified."
      }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/publish" && request.method === "POST") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const itemId = String(input.itemId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,150}$/.test(itemId)) return json({ error: "A valid communications item ID is required." }, 400, corsHeaders(request));
      const doc = await getFirestoreDocument(env, "communicationMediaItems/" + itemId, claims.token);
      const item = firestoreDocumentToPlain(doc);
      if (!item) return json({ error: "Communications item not found." }, 404, corsHeaders(request));
      if (item.status === "Published" && item.publicUrl && item.wpPostId) return json({ success: true, alreadyPublished: true, publicUrl: item.publicUrl }, 200, corsHeaders(request));
      if (item.status !== "Approved" || !["Website Article", "Press Release"].includes(item.type) || !["IRPA Website", "Press / Media"].includes(item.channel)) {
        return json({ error: "Only approved website articles and press releases can be published." }, 409, corsHeaders(request));
      }
      const title = cleanText(item.title, 181);
      const body = cleanText(item.body, 30001);
      if (!title || title.length > 180 || !body || body.length > 30000) return json({ error: "The approved content is incomplete or exceeds the allowed length." }, 400, corsHeaders(request));
      const wp = wordpressConfig(env);
      const endpoint = wp.root + "/wp-json/wp/v2/posts";
      const slug = "irpa-" + itemId;
      const lookup = await fetch(endpoint + "?slug=" + encodeURIComponent(slug) + "&status=publish,draft,pending,private&per_page=1", {
        headers: wordpressHeaders(wp, { Accept: "application/json" }), signal: AbortSignal.timeout(15000)
      });
      const found = await lookup.json().catch(() => null);
      if (!lookup.ok || !Array.isArray(found)) throw new Error("Could not safely check existing website content before publishing.");
      let post = found.find(p => Number.isInteger(p.id) && typeof p.link === "string");
      if (!post) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: wordpressHeaders(wp, { "Content-Type": "application/json", Accept: "application/json" }),
          body: JSON.stringify({ title, content: plainContent(body), excerpt: htmlEscape(cleanText(item.summary, 600)), slug, status: "publish", comment_status: "closed", ping_status: "closed" }),
          signal: AbortSignal.timeout(30000)
        });
        post = await response.json().catch(() => null);
        if (!response.ok || !Number.isInteger(post?.id) || typeof post?.link !== "string") throw new Error("The website rejected the publishing request.");
      }
      const now = new Date().toISOString();
      const documentFields = fields({ status: "Published", wpPostId: post.id, publicUrl: post.link, publishedAt: now, publishedByUid: claims.user_id, publishedByEmail: claims.email || "", updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: claims.email || "" });
      const auditFields = fields({ action: "COMMUNICATION_MEDIA_PUBLISHED", category: "COMMUNICATIONS", collection: "communicationMediaItems", recordId: itemId, actorUid: claims.user_id, actorEmail: claims.email || "", details: { type: item.type, channel: item.channel, wpPostId: post.id, publicUrl: post.link, approvedBeforePublishing: true }, createdAt: now });
      await commitDocumentAndAudit(env, "communicationMediaItems/" + itemId, claims.token, documentFields, Object.keys(documentFields), auditFields);
      return json({ success: true, publicUrl: post.link, wpPostId: post.id, message: "Approved content published to the IRPA website." }, 200, corsHeaders(request));
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
