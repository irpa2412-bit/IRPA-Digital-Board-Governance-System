const REQUIRED_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "instagram_basic"];
const AUTHORIZED_ROLES = new Set([
  "Administrator", "Executive Director", "Director Outreach", "Outreach Director",
  "Director Community Development", "Community Development Director",
  "Communications Officer", "Communication Officer", "Communications Manager",
  "Communication Manager", "Media Officer", "Media Manager", "Public Relations Officer",
  "Communication & Media", "Communications & Media", "Communication and Media",
  "Communications and Media", "Communications & Media Officer",
  "Communications and Media Officer", "Media and Communications Officer", "Media & Communications Officer"
]);

function active(record) {
  return !!record && (["Active", "Activated"].includes(String(record.status || "")) ||
    record.registrationStatus === "Activated" || record.employmentStatus === "Active");
}
function roleValues(record) {
  if (!record) return [];
  return [record.role, record.title, record.position, record.departmentalRole,
    ...(Array.isArray(record.roles) ? record.roles : []),
    ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : [])]
    .filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()).filter(Boolean));
}
function graphVersion(env) {
  const value = String(env.META_GRAPH_API_VERSION || "v26.0");
  if (!/^v\d+\.\d+$/.test(value)) throw new Error("Meta Graph API version configuration is invalid.");
  return value;
}
function config(env) {
  if (String(env.IRPA_ENVIRONMENT || "").toLowerCase() !== "staging") {
    throw new Error("Meta API integration is disabled outside the staging gateway.");
  }
  if (String(env.FIREBASE_PROJECT_ID || "") !== "irpa-dbg-staging-a73ec" ||
      String(env.IRPA_PRODUCTION_CUTOVER || "").toLowerCase() !== "false") {
    throw new Error("Meta API integration requires the isolated staging Firebase project and a disabled production cutover.");
  }
  const appId = String(env.META_APP_ID || "").trim();
  const appSecret = String(env.META_APP_SECRET || "").trim();
  const redirectUri = String(env.META_REDIRECT_URI || "").trim();
  if (!/^\d{4,30}$/.test(appId) || !appSecret) throw new Error("Staging Meta application configuration is incomplete.");
  let redirect;
  try { redirect = new URL(redirectUri); } catch { throw new Error("Staging Meta callback configuration is invalid."); }
  const expectedRedirect = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev/api/communications/meta/callback";
  if (redirect.toString() !== expectedRedirect || redirect.protocol !== "https:" ||
      redirect.hostname !== "irpa-google-drive-gateway-staging.irpa-governance.workers.dev" ||
      redirect.username || redirect.password || redirect.search || redirect.hash) {
    throw new Error("Meta callback must use the exact approved staging Cloudflare gateway URL.");
  }
  if (!env.DRIVE_KV) throw new Error("The existing staging Cloudflare KV binding is unavailable.");
  return { appId, appSecret, redirectUri: redirect.toString(), version: graphVersion(env) };
}
function keyBytes(value) {
  try {
    const key = Uint8Array.from(atob(String(value || "")), c => c.charCodeAt(0));
    if (key.byteLength !== 32) throw new Error("bad key");
    return key;
  } catch {
    throw new Error("Staging Meta token-encryption configuration is invalid.");
  }
}
async function encryptToken(token, secret) {
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(token);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  return JSON.stringify({ iv: b64(iv), ciphertext: b64(encrypted), version: 1 });
}
async function decryptToken(value, secret) {
  let item;
  try { item = JSON.parse(value); } catch { throw new Error("Stored Meta connection is unreadable; reconnect in staging."); }
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), "AES-GCM", false, ["decrypt"]);
  try {
    const fromB64 = v => Uint8Array.from(atob(v), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(item.iv) }, key, fromB64(item.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Stored Meta connection could not be decrypted; reconnect in staging.");
  }
}
function htmlPage(title, message, status = 200) {
  const escape = value => String(value).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
    escape(title) + "</title><main style=\"font:16px system-ui;max-width:38rem;margin:10vh auto;padding:1.5rem\"><h1>" +
    escape(title) + "</h1><p>" + escape(message) + "</p><p>You may close this page and return to the IRPA staging Social Accounts workspace.</p></main></html>", {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }
  });
}
async function graphGet(version, path, token) {
  const target = new URL("https://graph.facebook.com/" + version + "/" + path.replace(/^\//, ""));
  const response = await fetch(target.toString(), {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const code = Number(body?.error?.code || 0);
    if (code === 190) throw new Error("Meta access token is expired or invalid; reconnect in staging.");
    if (code === 10 || code === 200) throw new Error("Meta denied a required read permission; review app mode and granted permissions.");
    throw new Error("Meta API access verification failed.");
  }
  return body;
}
function publicConnection(value) {
  return {
    status: "verified",
    connected: true,
    verifiedAt: value.verifiedAt,
    expiresAt: value.expiresAt || null,
    user: value.metaUser,
    metaUser: value.metaUser,
    facebookPages: value.facebookPages || [],
    instagramAccounts: value.instagramAccounts || [],
    grantedPermissions: value.grantedPermissions || [],
    requiredPermissions: REQUIRED_PERMISSIONS,
    missingPermissions: REQUIRED_PERMISSIONS.filter(p => !(value.grantedPermissions || []).includes(p)),
    postingEnabled: false
  };
}
export function createMetaSocialApiRouter(deps) {
  const { authenticateFirebaseRequest, getFirestoreDocument, getInstitutionalProfileForUser,
    firestoreDocumentToPlain, json, corsHeaders } = deps;

  async function authorize(request, env) {
    const claims = await authenticateFirebaseRequest(request, env);
    const adminDoc = await getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token);
    const admin = firestoreDocumentToPlain(adminDoc);
    if (admin?.active === true) return claims;
    const identity = await getInstitutionalProfileForUser(env, claims);
    const member = firestoreDocumentToPlain(identity?.memberRecord);
    const employee = firestoreDocumentToPlain(identity?.employeeRecord);
    const roles = [...new Set([
      ...(Array.isArray(claims.irpaRoles) ? claims.irpaRoles : []),
      claims.role, claims.title, claims.position, ...roleValues(member), ...roleValues(employee)
    ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim())))];
    if (!(active(member) || active(employee)) || !roles.some(r => AUTHORIZED_ROLES.has(r))) {
      throw new Error("Your active IRPA role does not permit Meta account connection or verification.");
    }
    return claims;
  }

  async function status(request, env) {
    const claims = await authorize(request, env);
    const cfg = config(env);
    if (!env.META_TOKEN_ENCRYPTION_KEY) throw new Error("Staging Meta token-encryption secret is not configured.");
    const saved = await env.DRIVE_KV.get("meta:connection:" + claims.user_id, "json");
    if (!saved?.encryptedToken) return json({ status: "not_connected", connected: false, postingEnabled: false, requiredPermissions: REQUIRED_PERMISSIONS }, 200, corsHeaders(request));
    const token = await decryptToken(saved.encryptedToken, env.META_TOKEN_ENCRYPTION_KEY);
    const [me, permissions, pages] = await Promise.all([
      graphGet(cfg.version, "me?fields=id,name", token),
      graphGet(cfg.version, "me/permissions", token),
      graphGet(cfg.version, "me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100", token)
    ]);
    const granted = (Array.isArray(permissions.data) ? permissions.data : [])
      .filter(p => p.status === "granted" && REQUIRED_PERMISSIONS.includes(p.permission))
      .map(p => p.permission);
    const facebookPages = (Array.isArray(pages.data) ? pages.data : []).map(p => ({
      id: String(p.id || ""), name: String(p.name || "").slice(0, 180),
      instagramLinked: !!p.instagram_business_account
    })).filter(p => p.id && p.name);
    const instagramAccounts = (Array.isArray(pages.data) ? pages.data : [])
      .filter(p => p.instagram_business_account?.id)
      .map(p => ({ id: String(p.instagram_business_account.id), username: String(p.instagram_business_account.username || "").slice(0, 120), accountType: "Professional", linkedFacebookPage: String(p.name || "").slice(0, 180) }));
    const result = publicConnection({
      verifiedAt: new Date().toISOString(),
      metaUser: { id: String(me.id || ""), name: String(me.name || "").slice(0, 180) },
      facebookPages, instagramAccounts, grantedPermissions: granted
    });
    result.status = result.missingPermissions.length ? "needs_permissions" : "verified";
    await env.DRIVE_KV.put("meta:connection:" + claims.user_id, JSON.stringify({
      ...saved, metaUser: result.metaUser, facebookPages: result.facebookPages,
      instagramAccounts: result.instagramAccounts, grantedPermissions: result.grantedPermissions,
      verifiedAt: result.verifiedAt
    }));
    return json(result, 200, corsHeaders(request));
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/api/communications/meta/callback" && request.method === "GET") {
      let cfg;
      try { cfg = config(env); }
      catch { return htmlPage("Meta connection not configured", "The staging Meta callback is not configured. No account was connected.", 503); }
      const state = String(url.searchParams.get("state") || "");
      if (!/^[A-Za-z0-9_-]{40,80}$/.test(state)) return htmlPage("Meta connection rejected", "The authorization state was missing or invalid. Start again from the staging portal.", 400);
      const stateKey = "meta:oauth-state:" + state;
      const pending = await env.DRIVE_KV.get(stateKey, "json");
      await env.DRIVE_KV.delete(stateKey);
      if (!pending || pending.environment !== "staging" || !pending.uid || Date.now() - pending.createdAt > 600000) {
        return htmlPage("Meta connection expired", "The one-time authorization request expired or was already used. Start again from the staging portal.", 400);
      }
      if (url.searchParams.has("error") || !url.searchParams.get("code")) {
        return htmlPage("Meta authorization not completed", "Meta authorization was cancelled or denied. No account was connected.", 400);
      }
      if (!env.META_TOKEN_ENCRYPTION_KEY) return htmlPage("Meta connection not configured", "The staging token-encryption secret is missing. No account was connected.", 503);
      try {
        const code = String(url.searchParams.get("code"));
        const exchangeUrl = new URL("https://graph.facebook.com/" + cfg.version + "/oauth/access_token");
        const exchange = await fetch(exchangeUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirectUri, code }),
          redirect: "error", signal: AbortSignal.timeout(12000)
        });
        const shortToken = await exchange.json().catch(() => null);
        if (!exchange.ok || !shortToken?.access_token) throw new Error("authorization exchange failed");
        const longUrl = new URL("https://graph.facebook.com/" + cfg.version + "/oauth/access_token");
        const longResponse = await fetch(longUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: shortToken.access_token }),
          redirect: "error", signal: AbortSignal.timeout(12000)
        });
        const longToken = await longResponse.json().catch(() => null);
        if (!longResponse.ok || !longToken?.access_token) throw new Error("long-lived token exchange failed");
        const token = longToken.access_token;
        const [me, permissions, pages] = await Promise.all([
          graphGet(cfg.version, "me?fields=id,name", token),
          graphGet(cfg.version, "me/permissions", token),
          graphGet(cfg.version, "me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100", token)
        ]);
        const grantedPermissions = (Array.isArray(permissions.data) ? permissions.data : [])
          .filter(p => p.status === "granted" && REQUIRED_PERMISSIONS.includes(p.permission))
          .map(p => p.permission);
        const missing = REQUIRED_PERMISSIONS.filter(p => !grantedPermissions.includes(p));
        if (missing.length) {
          return htmlPage("Meta permissions incomplete", "Required read permissions were not granted: " + missing.join(", ") + ". No connection token was stored. Review the Meta app and retry authorization.", 400);
        }
        const encryptedToken = await encryptToken(token, env.META_TOKEN_ENCRYPTION_KEY);
        const verifiedAt = new Date().toISOString();
        const facebookPages = (Array.isArray(pages.data) ? pages.data : []).map(p => ({
          id: String(p.id || ""), name: String(p.name || "").slice(0, 180), instagramLinked: !!p.instagram_business_account
        })).filter(p => p.id && p.name);
        const instagramAccounts = (Array.isArray(pages.data) ? pages.data : [])
          .filter(p => p.instagram_business_account?.id)
.map(p => ({ id: String(p.instagram_business_account.id), username: String(p.instagram_business_account.username || "").slice(0, 120), accountType: "Professional", linkedFacebookPage: String(p.name || "").slice(0, 180) }));
        const connection = {
          encryptedToken, metaUser: { id: String(me.id || ""), name: String(me.name || "").slice(0, 180) },
          facebookPages, instagramAccounts, grantedPermissions, verifiedAt,
          connectedAt: verifiedAt, expiresAt: Number.isFinite(Number(longToken.expires_in)) ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString() : null, environment: "staging"
        };
        await env.DRIVE_KV.put("meta:connection:" + pending.uid, JSON.stringify(connection));
        return htmlPage("Meta account connection verified",
          "Staging authorization completed. Facebook Pages found: " + facebookPages.length +
          ". Linked Instagram professional accounts found: " + instagramAccounts.length +
          ". All required read permissions are present. Social posting remains disabled.");
      } catch {
        return htmlPage("Meta API verification failed", "The staging connection could not be verified. No access token was displayed. Check the staging Worker configuration and Meta app permissions, then retry.", 502);
      }
    }

    if (path === "/api/communications/meta/connect" && request.method === "POST") {
      const claims = await authorize(request, env);
      const cfg = config(env);
      const state = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      await env.DRIVE_KV.put("meta:oauth-state:" + state, JSON.stringify({
        uid: claims.user_id, email: String(claims.email || "").slice(0, 254),
        createdAt: Date.now(), environment: "staging"
      }), { expirationTtl: 600 });
      const authorizeUrl = new URL("https://www.facebook.com/" + cfg.version + "/dialog/oauth");
      authorizeUrl.searchParams.set("client_id", cfg.appId);
      authorizeUrl.searchParams.set("redirect_uri", cfg.redirectUri);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", REQUIRED_PERMISSIONS.join(","));
      return json({ authorizationUrl: authorizeUrl.toString(), expiresInSeconds: 600, requestedPermissions: REQUIRED_PERMISSIONS, postingEnabled: false }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/meta/disconnect" && request.method === "POST") {
      const claims = await authorize(request, env);
      if (String(env.IRPA_ENVIRONMENT || "").toLowerCase() !== "staging" || !env.DRIVE_KV) {
        throw new Error("Local Meta disconnection is available only in the staging gateway.");
      }
      await env.DRIVE_KV.delete("meta:connection:" + claims.user_id);
      return json({ status: "not_connected", connected: false, postingEnabled: false, message: "The local staging token was removed. Revoke app authorization separately in Meta settings if required." }, 200, corsHeaders(request));
    }

    if (path === "/api/communications/meta/status" && request.method === "GET") {
      try { return await status(request, env); }
      catch (error) {
        const message = String(error?.message || "");
        const code = /authentication|token/i.test(message) ? 401 : /role does not permit|authorised|authorized|active IRPA role|outside the staging gateway|requires the isolated staging Firebase project|production cutover|exact approved staging Cloudflare gateway URL/i.test(message) ? 403 : /not configured|configuration|unavailable/i.test(message) ? 503 : 502;
        return json({ error: message || "Meta connection verification failed.", postingEnabled: false }, code, corsHeaders(request));
      }
    }
    return null;
  }

  return async (request, env) => {
    try { return await handle(request, env); }
    catch (error) {
      const message = String(error?.message || "");
      const status = /authentication|token/i.test(message) ? 401 :
        /role does not permit|authorised|authorized|active IRPA role|outside the staging gateway|requires the isolated staging Firebase project|production cutover|exact approved staging Cloudflare gateway URL/i.test(message) ? 403 :
        /not configured|configuration|unavailable/i.test(message) ? 503 : 502;
      return json({ error: message || "Meta API request failed.", postingEnabled: false }, status, corsHeaders(request));
    }
  };
}
