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
    const identity = await getInstitutionalProfileForUser(env, claims);
    const member = firestoreDocumentToPlain(identity?.memberRecord);
    const employee = firestoreDocumentToPlain(identity?.employeeRecord);
    const tokenRoles = [
      ...(Array.isArray(claims.irpaRoles) ? claims.irpaRoles : []),
      claims.role, claims.title, claims.position
    ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()));
    const roles = [...new Set([...tokenRoles, ...values(member), ...values(employee)])];
    const isActive = active(member) || active(employee);
    const hasRole = [...(reviewer ? REVIEW_ROLES : AUTHOR_ROLES)].some(r => roles.includes(r));
    if (!hasRole || (!isActive && !roles.includes("Administrator"))) {
      throw new Error("Your registered IRPA role does not permit this website-management action.");
    }
    return { claims, roles };
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
    return { root: base.toString().replace(/\/$/, ""), auth: "Basic " + btoa(unescape(encodeURIComponent(username + ":" + password))) };
  }

  function cpanelConfig(env) {
    let base;
    try { base = new URL(String(env.CPANEL_BASE_URL || "")); }
    catch { throw new Error("cPanel integration is not configured."); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.port && base.port !== "2083") {
      throw new Error("cPanel endpoint configuration is invalid.");
    }
    const username = String(env.CPANEL_USERNAME || "").trim();
    const token = String(env.CPANEL_API_TOKEN || "").trim();
    if (!username || !token) throw new Error("cPanel API credentials are not configured.");
    return { root: base.origin + "/execute", username, token, documentRoot: String(env.CPANEL_DOCUMENT_ROOT || "public_html").replace(/^\/+|\/+$/g, "") };
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
    if (!response.ok || !data || data.status !== 1) throw new Error("cPanel rejected the requested operation.");
    return data;
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/api/communications/site/status" && request.method === "GET") {
      const { roles } = await authorised(request, env, true);
      const result = { website: "not_configured", cpanel: "not_configured" };
      try {
        const wp = wordpressConfig(env);
        const response = await fetch(wp.root + "/wp-json/wp/v2/users/me?context=edit", {
          headers: { Authorization: wp.auth, Accept: "application/json" }, signal: AbortSignal.timeout(12000)
        });
        if (response.ok) {
          const user = await response.json();
          result.website = "connected";
          result.websiteAccount = { name: cleanText(user.name, 100), canEditPosts: Array.isArray(user.capabilities) ? !!user.capabilities.edit_posts : undefined };
        } else result.website = "authentication_failed";
      } catch (error) { result.website = error.message.includes("not configured") ? "not_configured" : "unavailable"; }
      try {
        const cp = cpanelConfig(env);
        await cpanelCall(cp, "DomainInfo/list_domains");
        result.cpanel = "connected";
      } catch (error) { result.cpanel = error.message.includes("not configured") ? "not_configured" : "unavailable_or_denied"; }
      return json({ ok: true, connections: result, permissions: { reviewer: roles.some(r => REVIEW_ROLES.has(r)), staticFileEditing: true } }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/content" && request.method === "GET") {
      await authorised(request, env, true);
      const wp = wordpressConfig(env);
      const type = url.searchParams.get("type") === "pages" ? "pages" : "posts";
      const response = await fetch(wp.root + "/wp-json/wp/v2/" + type + "?context=edit&per_page=50&orderby=modified&order=desc", {
        headers: { Authorization: wp.auth, Accept: "application/json" }, signal: AbortSignal.timeout(15000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data)) throw new Error("Could not read website content. Verify the WordPress account's edit permissions.");
      return json({ items: data.map(item => ({
        id: item.id, type, title: String(item.title?.rendered || ""), status: item.status,
        link: item.link, modified: item.modified, content: String(item.content?.raw || "")
      })) }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/website/content" && request.method === "PUT") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const type = input.type === "pages" ? "pages" : input.type === "posts" ? "posts" : "";
      const id = Number(input.id);
      const title = cleanText(input.title, 181);
      const body = cleanText(input.content, 30001);
      if (!type || !Number.isSafeInteger(id) || id < 1 || !title || title.length > 180 || !body || body.length > 30000) {
        return json({ error: "A valid page/post ID, title and content (up to 30,000 characters) are required." }, 400, corsHeaders(request));
      }
      const wp = wordpressConfig(env);
      const response = await fetch(wp.root + "/wp-json/wp/v2/" + type + "/" + id, {
        method: "POST", headers: { Authorization: wp.auth, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ title, content: plainContent(body) }), signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(data?.id) || typeof data?.link !== "string") throw new Error("WordPress rejected the content update. Confirm that the integration account can edit this item.");
      const auditFields = fields({ action: "COMMUNICATION_WEBSITE_CONTENT_UPDATED", category: "COMMUNICATIONS", collection: type, recordId: id, actorUid: claims.user_id, actorEmail: claims.email || "", details: { title, publicUrl: data.link }, createdAt: new Date().toISOString() });
      await commitDocumentAndAudit(env, "communicationWebsiteEdits/" + crypto.randomUUID(), claims.token, fields({ itemId: id, type, title, publicUrl: data.link, updatedByUid: claims.user_id, updatedAt: new Date().toISOString() }), ["itemId", "type", "title", "publicUrl", "updatedByUid", "updatedAt"], auditFields, { createOnly: true });
      return json({ success: true, id: data.id, title: String(data.title?.rendered || title), publicUrl: data.link, message: "Website content updated." }, 200, corsHeaders(request));
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
        headers: { Authorization: wp.auth, Accept: "application/json" }, signal: AbortSignal.timeout(15000)
      });
      const found = await lookup.json().catch(() => null);
      if (!lookup.ok || !Array.isArray(found)) throw new Error("Could not safely check existing website content before publishing.");
      let post = found.find(p => Number.isInteger(p.id) && typeof p.link === "string");
      if (!post) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: wp.auth, "Content-Type": "application/json", Accept: "application/json" },
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
      const relative = String(url.searchParams.get("path") || "");
      if (!relative) {
        const listing = await cpanelCall(cp, "Fileman/list_files", { dir: cp.documentRoot });
        const rows = listing.data?.[0]?.data || listing.data || [];
        const files = Array.isArray(rows) ? rows.filter(row => {
          const name = String(row.file || row.name || "");
          const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
          return EDITABLE_EXTENSIONS.has(ext) && !name.startsWith(".");
        }).map(row => ({ name: String(row.file || row.name || ""), type: row.type || "file", size: Number(row.file_size || row.size || 0) })) : [];
        return json({ files }, 200, corsHeaders(request));
      }
      const safe = safeCpanelPath(relative, cp.documentRoot);
      const data = await cpanelCall(cp, "Fileman/get_file_content", { dir: safe.dir, file: safe.file });
      const content = data.data?.content ?? data.data?.[0]?.content;
      if (typeof content !== "string") throw new Error("cPanel did not return file content.");
      return json({ path: safe.relative, content: content.slice(0, MAX_EDIT_BYTES), truncated: content.length > MAX_EDIT_BYTES }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/cpanel/files" && request.method === "PUT") {
      const { claims } = await authorised(request, env, true);
      const input = await request.json().catch(() => ({}));
      const safe = safeCpanelPath(input.path, cpanelConfig(env).documentRoot);
      const content = String(input.content ?? "");
      if (new TextEncoder().encode(content).byteLength > MAX_EDIT_BYTES) return json({ error: "Website file exceeds the 512 KB edit limit." }, 413, corsHeaders(request));
      const cp = cpanelConfig(env);
      await cpanelCall(cp, "Fileman/save_file_content", { dir: safe.dir, file: safe.file, content, charset: "utf-8" }, "POST");
      const auditFields = fields({ action: "CPANEL_STATIC_FILE_EDITED", category: "COMMUNICATIONS", collection: "cpanelFiles", recordId: safe.relative, actorUid: claims.user_id, actorEmail: claims.email || "", details: { path: safe.relative, bytes: new TextEncoder().encode(content).byteLength }, createdAt: new Date().toISOString() });
      await commitDocumentAndAudit(env, "cpanelFileEdits/" + crypto.randomUUID(), claims.token, fields({ path: safe.relative, updatedByUid: claims.user_id, updatedAt: new Date().toISOString() }), ["path", "updatedByUid", "updatedAt"], auditFields, { createOnly: true });
      return json({ success: true, path: safe.relative, message: "Website file saved through cPanel. Verify the public page before considering the edit complete." }, 200, corsHeaders(request));
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
