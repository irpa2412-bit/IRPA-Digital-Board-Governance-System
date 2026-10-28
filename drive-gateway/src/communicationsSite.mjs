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
const WEBSITE_EDITOR_ROLES = new Set([
  "Communication & Media", "Communications & Media", "Communication and Media", "Communications and Media",
  "Communications Officer", "Communication Officer", "Communications Manager", "Communication Manager",
  "Media Officer", "Media Manager", "Public Relations Officer", "Communications & Media Officer",
  "Communications and Media Officer", "Media and Communications Officer", "Media & Communications Officer"
]);
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
    const roles = [...new Set([...tokenRoles, ...values(member), ...values(employee)])];
    const isActive = active(member) || active(employee);
    if (!isActive || !roles.some(role => WEBSITE_EDITOR_ROLES.has(role))) {
      throw new Error("Your registered Communication & Media role does not permit this website-editing action.");
    }
    return { claims, roles, admin: false };
  }

  function wordpressConfig(env) {
    const missing = ["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD"].filter(name => !String(env?.[name] || "").trim());
    if (missing.length) throw Object.assign(new Error("Missing required Worker secrets: " + missing.join(", ") + "."), { status: 503 });
    let base;
    try { base = new URL(String(env.WORDPRESS_BASE_URL)); }
    catch { throw new Error("Website endpoint configuration is invalid."); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      throw new Error("Website endpoint configuration is invalid.");
    }
    const environment = String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").toLowerCase();
    const host = base.hostname.toLowerCase();
    if (environment === "production" && !["irpa.or.tz", "www.irpa.or.tz"].includes(host)) {
      throw new Error("Production WordPress editing is restricted to irpa.or.tz or www.irpa.or.tz.");
    }
    if (environment === "staging" && host !== "staging.irpa.or.tz") {
      throw new Error("Staging WordPress editing is restricted to staging.irpa.or.tz.");
    }
    if (!["production", "staging"].includes(environment)) throw new Error("Website editing requires an explicit staging or production Worker environment.");
    const username = String(env.WORDPRESS_USERNAME).trim();
    const password = String(env.WORDPRESS_APPLICATION_PASSWORD).replace(/\s/g, "");
    return { root: base.toString().replace(/\/$/, ""), hostname: host, environment, auth: "Basic " + btoa(unescape(encodeURIComponent(username + ":" + password))), stagingAuthHeader: host === "staging.irpa.or.tz" };
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
    if (base.protocol !== "https:" || base.pathname !== "/" || base.hostname.toLowerCase() !== wp.hostname) {
      throw new Error("WordPress endpoint must be an HTTPS origin without a path.");
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
      throw new Error("Staging WordPress authentication failed; the integration account was not verified.");
    }
    const roles = Array.isArray(user.roles) ? user.roles.map(role => String(role).toLowerCase()) : [];
    if (!roles.includes("editor") || roles.includes("administrator")) {
      throw new Error("The staging WordPress integration account must have the Editor role and must not be an Administrator.");
    }
    return user;
  }

  function cpanelConfig(env) {
    const configuredEndpoint = String(env.CPANEL_BASE_URL || "").trim();
    let base;
    try {
      // Accept a bare hostname or an explicit URL, but enforce HTTPS and the
      // dedicated cPanel port below before making any outbound request.
      const endpoint = /^[a-z0-9.-]+$/i.test(configuredEndpoint)
        ? "https://" + configuredEndpoint
        : configuredEndpoint;
      base = new URL(endpoint);
    } catch {
      throw Object.assign(new Error("Missing or invalid required Worker setting: CPANEL_BASE_URL."), { status: 503 });
    }
    // cPanel's HTTPS service is on port 2083. Normalize only an omitted port,
    // never an explicitly different port or a path that could bypass checks.
    if (base.protocol === "https:" && !base.port) base.port = "2083";
    if (base.protocol !== "https:" || !base.hostname ||
        base.username || base.password || base.search || base.hash || base.pathname !== "/" || base.port !== "2083") {
      throw new Error("cPanel endpoint configuration is invalid.");
    }
    const username = String(env.CPANEL_USERNAME || "").trim();
    const token = String(env.CPANEL_API_TOKEN || "").trim();
    if (!username || !token) throw Object.assign(new Error("Missing required Worker secrets: " + [!username && "CPANEL_USERNAME", !token && "CPANEL_API_TOKEN"].filter(Boolean).join(", ") + "."), { status: 503 });
    const environment = String(env.IRPA_WORKER_ENVIRONMENT || env.IRPA_ENVIRONMENT || "").toLowerCase();
    const configuredRoot = String(env.CPANEL_DOCUMENT_ROOT || (environment === "production" ? "public_html" : "public_html/staging")).trim().replace(/\\/g, "/").replace(/\/+$/g, "");
    const allowedRoots = environment === "production" ? ["public_html", "home/" + username + "/public_html", "/home/" + username + "/public_html"] :
      environment === "staging" ? ["public_html/staging", "home/" + username + "/public_html/staging", "/home/" + username + "/public_html/staging"] : [];
    if (!allowedRoots.includes(configuredRoot)) throw new Error("cPanel document root must match the configured staging or production public_html directory.");
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
      const result = { website: "not_configured", cpanel: "not_configured" };
      try {
        const wp = websiteWordPressConfig(env);
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

    if (path === "/api/communications/website/media" && request.method === "POST") {
      const { claims } = await websiteEditorAuthorised(request, env);
      const input = await request.json().catch(() => ({}));
      const filename = cleanText(input.filename, 160).replace(/[\\/:*?"<>|]/g, "-");
      const contentType = String(input.contentType || "").toLowerCase();
      const encoded = String(input.dataBase64 || "");
      const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
      if (!filename || !allowedTypes.has(contentType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        return json({ error: "Choose a JPEG, PNG, WebP or GIF image." }, 400, corsHeaders(request));
      }
      const estimatedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
      if (estimatedBytes < 1 || estimatedBytes > 8 * 1024 * 1024) return json({ error: "Images must be no larger than 8 MiB." }, 413, corsHeaders(request));
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const wp = websiteWordPressConfig(env);
      await verifyDedicatedWordPressEditor(wp);
      const endpoint = wp.root + "/wp-json/wp/v2/media";
      const response = await wordpressEditorFetch(wp, endpoint, {
        method: "POST",
        headers: wordpressHeaders(wp, {
          "Content-Type": contentType,
          "Content-Disposition": 'attachment; filename="' + filename.replace(/["\\\r\n]/g, "-") + '"',
          Accept: "application/json"
        }),
        body: bytes,
        signal: AbortSignal.timeout(30000)
      });
      const media = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(media?.id) || typeof media?.source_url !== "string" || !isAllowedWordPressLink(media.source_url, wp)) {
        throw new Error("WordPress image upload failed; check the staging media permissions and try again.");
      }
      await recordWebsiteAudit(env, claims, "COMMUNICATION_WEBSITE_IMAGE_UPLOADED", "media", media.id, {
        filename, contentType, fileSize: bytes.byteLength, mediaId: media.id
      });
      return json({ success: true, media: { id: media.id, url: media.source_url, title: editorRaw(media, "title") || filename, altText: String(media.alt_text || "") }, message: "Image uploaded to the configured WordPress environment." }, 200, corsHeaders(request));
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
      if (!response.ok || !Array.isArray(data)) throw new Error("Could not list staging website content.");
      if (data.some(item => !isAllowedWordPressLink(item.link, wp))) throw new Error("WordPress returned a non-staging page URL; content listing was blocked.");
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
        throw new Error("WordPress rejected the staging page/post update (HTTP " + response.status + ", code " + wordpressCode + "). The saved pre-edit snapshot remains available.");
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
        message: status === "publish" ? "Staging page/post published and verified." : "Staging draft saved and verified."
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
      if (!response.ok || !Number.isSafeInteger(data?.id) || !isAllowedWordPressLink(data?.link, wp)) {
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
          body: JSON.stringify({ title, content: plainContent(body) + (isPage && /^https:\/\//i.test(String(item.assetUrl || "")) ? '<p><img src="' + htmlEscape(String(item.assetUrl)) + '" alt="' + htmlEscape(title) + '" /></p>' : ""), excerpt: htmlEscape(cleanText(item.summary, 600)), slug, status: "publish", comment_status: "closed", ping_status: "closed" }),
          signal: AbortSignal.timeout(30000)
        });
        post = await response.json().catch(() => null);
        if (!response.ok || !Number.isInteger(post?.id) || typeof post?.link !== "string") throw new Error("The website rejected the publishing request.");
      }
      const now = new Date().toISOString();
      const documentFields = fields({ status: "Published", wpPostId: post.id, publicUrl: post.link, publishedAt: now, publishedByUid: claims.user_id, publishedByEmail: claims.email || "", updatedAt: now, updatedByUid: claims.user_id, updatedByEmail: claims.email || "" });
      const auditFields = fields({ action: "COMMUNICATION_MEDIA_PUBLISHED", category: "COMMUNICATIONS", collection: "communicationMediaItems", recordId: itemId, actorUid: claims.user_id, actorEmail: claims.email || "", details: { type: item.type, channel: item.channel, language: item.language || null, wpPostId: post.id, publicUrl: post.link, approvedBeforePublishing: true }, createdAt: now });
      await commitDocumentAndAudit(env, itemId, claims.token, documentFields, Object.keys(documentFields), auditFields, { collectionName: "communicationMediaItems" });
      return json({ success: true, publicUrl: post.link, wpPostId: post.id, message: isPage ? "Approved IRPA website page published and recorded." : "Approved content published to the IRPA website." }, 200, corsHeaders(request));
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
