const STAGING_PROJECT = "irpa-dbg-staging-a73ec";
const STAGING_GATEWAY = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
// Publishing is available only on the isolated staging gateway; no production credentials or routes are used.
export const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
const TOKEN_KEY_PREFIX = "meta:publishing:connection:";
const STATE_KEY_PREFIX = "meta:publishing:oauth-state:";
const STATE_TTL_SECONDS = 600;

function roleValues(record) {
  if (!record) return [];
  return [record.role, record.title, record.position, record.departmentalRole,
    ...(Array.isArray(record.roles) ? record.roles : []),
    ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : [])]
    .filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim()).filter(Boolean));
}
function isActive(record) {
  return !!record && (["Active", "Activated"].includes(String(record.status || "")) ||
    record.registrationStatus === "Activated" || record.employmentStatus === "Active");
}
function safeConfig(env) {
  if (env?.IRPA_ENVIRONMENT !== "staging" ||
      env?.FIREBASE_PROJECT_ID !== STAGING_PROJECT ||
      env?.IRPA_PRODUCTION_CUTOVER !== "false") {
    throw new Error("Meta integration is disabled unless the gateway is verified as isolated staging.");
  }
  const redirect = String(env.META_REDIRECT_URI || "");
  if (redirect !== STAGING_GATEWAY + "/api/communications/meta/callback") {
    throw new Error("Meta staging redirect URI is not configured to the approved staging gateway.");
  }
  const version = String(env.META_GRAPH_API_VERSION || "");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Meta Graph API version is not configured.");
  if (!String(env.META_APP_ID || "").trim() || !String(env.META_APP_SECRET || "").trim()) {
    throw new Error("Meta OAuth application configuration is incomplete.");
  }
  if (!env.DRIVE_KV || typeof env.DRIVE_KV.put !== "function") {
    throw new Error("The existing gateway KV binding is unavailable.");
  }
  if (!String(env.META_TOKEN_ENCRYPTION_KEY || "").trim()) {
    throw new Error("Meta token encryption is not configured.");
  }
  if (base64Bytes(env.META_TOKEN_ENCRYPTION_KEY).byteLength !== 32) {
    throw new Error("Meta token encryption key must decode to 32 bytes.");
  }
  return { redirect, version, appId: String(env.META_APP_ID).trim(), appSecret: String(env.META_APP_SECRET) };
}
function base64Bytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function encryptionKey(env) {
  const raw = base64Bytes(env.META_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("Meta token encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptJson(env, value) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv); combined.set(new Uint8Array(ciphertext), iv.length);
  let binary = ""; for (const byte of combined) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function decryptJson(env, value) {
  const combined = base64Bytes(value);
  if (combined.byteLength < 29) throw new Error("Stored Meta connection data is invalid.");
  const key = await encryptionKey(env);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function jsonError(json, corsHeaders, request, status, message) {
  return json({ ok: false, error: message }, status, corsHeaders(request));
}
async function graphJson(url, init = {}, appSecret = "") {
  const target = new URL(url);
  const accessToken = target.searchParams.get("access_token");
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    target.searchParams.delete("access_token");
    headers.set("Authorization", "Bearer " + accessToken);
    if (appSecret) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken)));
      target.searchParams.set("appsecret_proof", Array.from(signature, byte => byte.toString(16).padStart(2, "0")).join(""));
    }
  }
  const response = await fetch(target.toString(), { redirect: "error", signal: AbortSignal.timeout(12000), ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const code = Number(data?.error?.code || 0);
    const message = code === 190 ? "Meta access token is invalid or expired." : "Meta API access verification failed.";
    const error = new Error(message);
    error.status = response.status || 502;
    throw error;
  }
  return data;
}
function graphUrl(version, path, params = {}) {
  const url = new URL("https://graph.facebook.com/" + version + "/" + path.replace(/^\//, ""));
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return url;
}
async function authorizeUser(request, env, deps, reviewer = false) {
  const claims = await deps.authenticateFirebaseRequest(request, env);
  const adminDoc = await deps.getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token);
  const admin = deps.firestoreDocumentToPlain(adminDoc);
  if (admin?.active === true) return claims;
  const identity = await deps.getInstitutionalProfileForUser(env, claims);
  const member = deps.firestoreDocumentToPlain(identity?.memberRecord);
  const employee = deps.firestoreDocumentToPlain(identity?.employeeRecord);
  const roles = [...new Set([
    ...(Array.isArray(claims.irpaRoles) ? claims.irpaRoles : []), claims.role, claims.title, claims.position,
    ...roleValues(member), ...roleValues(employee)
  ].filter(Boolean).flatMap(v => String(v).split(",").map(s => s.trim())))];
  const active = isActive(member) || isActive(employee);
  const allowed = reviewer
    ? ["Executive Director", "Director Outreach", "Outreach Director", "Director Community Development", "Community Development Director", "Administrator"]
    : ["Executive Director", "Director Outreach", "Outreach Director", "Director Community Development", "Community Development Director", "Administrator",
       "Communication & Media", "Communications & Media", "Communication and Media", "Communications and Media",
       "Communications Officer", "Communication Officer", "Communications Manager", "Communication Manager",
       "Media Officer", "Media Manager", "Public Relations Officer", "Communications & Media Officer",
       "Communications and Media Officer", "Media and Communications Officer", "Media & Communications Officer"];
  if (!active || !roles.some(role => allowed.includes(role))) {
    const error = new Error("Your registered IRPA role does not permit Meta account connection.");
    error.status = 403; throw error;
  }
  return claims;
}
async function requirePublishingScopes(version, token, appSecret) {
  const response = await graphJson(graphUrl(version, "me/permissions", { access_token: token }).toString(), {}, appSecret);
  const granted = new Set((Array.isArray(response.data) ? response.data : [])
    .filter(item => item?.status === "granted").map(item => String(item.permission || "")));
  const missing = REQUIRED_SCOPES.filter(scope => !granted.has(scope));
  if (missing.length) throw new Error("Required Meta publishing permissions were not granted.");
}
function publicAccounts(pages) {
  return (Array.isArray(pages?.data) ? pages.data : []).map(page => ({
    facebookPageId: String(page.id || ""),
    facebookPageName: String(page.name || "").slice(0, 180),
    instagram: page.instagram_business_account ? [{
      instagramAccountId: String(page.instagram_business_account.id || ""),
      username: String(page.instagram_business_account.username || "").slice(0, 180),
      accountType: String(page.instagram_business_account.account_type || "").slice(0, 80)
    }] : []
  }));
}

export function createMetaOAuthRouter(deps) {
  const { authenticateFirebaseRequest, getFirestoreDocument, getInstitutionalProfileForUser,
    firestoreDocumentToPlain, json, corsHeaders } = deps;

  return async function metaOAuthRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!path.startsWith("/api/communications/meta/")) return null;

    if (path === "/api/communications/meta/callback" && request.method === "GET") {
      if (url.origin !== STAGING_GATEWAY || env?.IRPA_ENVIRONMENT !== "staging" ||
          env?.FIREBASE_PROJECT_ID !== STAGING_PROJECT || env?.IRPA_PRODUCTION_CUTOVER === "true") {
        return jsonError(json, corsHeaders, request, 403, "Meta OAuth callback is disabled outside isolated staging.");
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError) return jsonError(json, corsHeaders, request, 400, "Meta authorization was cancelled or denied.");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || !/^[A-Za-z0-9_-]{40,60}$/.test(state)) {
        return jsonError(json, corsHeaders, request, 400, "Meta authorization response is invalid.");
      }
      let cfg;
      try { cfg = safeConfig(env); }
      catch (error) { return jsonError(json, corsHeaders, request, 503, error.message); }
      const stateKey = STATE_KEY_PREFIX + state;
      const stateText = await env.DRIVE_KV.get(stateKey);
      if (!stateText) return jsonError(json, corsHeaders, request, 400, "Meta authorization state expired or was already used.");
      await env.DRIVE_KV.delete(stateKey);
      let stateRecord;
      try { stateRecord = JSON.parse(stateText); } catch { return jsonError(json, corsHeaders, request, 400, "Meta authorization state is invalid."); }
      if (!stateRecord.uid || Date.now() - Number(stateRecord.createdAt || 0) > STATE_TTL_SECONDS * 1000) {
        return jsonError(json, corsHeaders, request, 400, "Meta authorization state expired.");
      }
      try {
        const tokenUrl = "https://graph.facebook.com/" + cfg.version + "/oauth/access_token";
        const shortToken = await graphJson(tokenUrl, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirect, code }).toString()
        });
        if (!shortToken.access_token) throw new Error("Meta did not return an access token.");
        const longUrl = "https://graph.facebook.com/" + cfg.version + "/oauth/access_token";
        const longToken = await graphJson(longUrl, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.appId,
            client_secret: cfg.appSecret, fb_exchange_token: shortToken.access_token }).toString()
        });
        const token = longToken.access_token || shortToken.access_token;
        await requirePublishingScopes(cfg.version, token, cfg.appSecret);
        const me = await graphJson(graphUrl(cfg.version, "me", { fields: "id,name", access_token: token }).toString(), {}, cfg.appSecret);
        const pages = await graphJson(graphUrl(cfg.version, "me/accounts", {
          fields: "id,name,access_token,tasks,instagram_business_account{id,username,account_type}", limit: 100, access_token: token
        }).toString(), {}, cfg.appSecret);
        const connection = {
          userId: String(me.id || ""), userName: String(me.name || "").slice(0, 180),
          accounts: (Array.isArray(pages.data) ? pages.data : []).map(page => ({ facebookPageId: String(page.id || ""), facebookPageName: String(page.name || "").slice(0, 180), pageAccessToken: String(page.access_token || ""), tasks: Array.isArray(page.tasks) ? page.tasks.map(String) : [], instagramAccountId: String(page.instagram_business_account?.id || ""), instagramUsername: String(page.instagram_business_account?.username || ""), instagramAccountType: String(page.instagram_business_account?.account_type || "") })), connectedAt: new Date().toISOString(),
          expiresAt: Number(longToken.expires_in || shortToken.expires_in || 0) > 0
            ? new Date(Date.now() + Number(longToken.expires_in || shortToken.expires_in) * 1000).toISOString() : null,
          accessToken: token
        };
        const encrypted = await encryptJson(env, connection);
        await env.DRIVE_KV.put(TOKEN_KEY_PREFIX + stateRecord.uid, encrypted);
        return json({ ok: true, status: "verified", postingEnabled: true, message: "Meta publishing permissions verified. Publishing remains subject to approval and the global pause.",
          facebookPages: connection.accounts.map(({ facebookPageId, facebookPageName }) => ({ id: facebookPageId, name: facebookPageName })),
          instagramAccounts: connection.accounts.flatMap(a => a.instagram.map(i => ({ id: i.instagramAccountId, username: i.username, accountType: i.accountType }))),
          connectedAt: connection.connectedAt, expiresAt: connection.expiresAt, requestedScopes: REQUIRED_SCOPES
        }, 200, corsHeaders(request));
      } catch (error) {
        return jsonError(json, corsHeaders, request, error.status || 502,
          error.message === "Meta access token is invalid or expired." ? error.message : "Meta API verification failed. Check app configuration, permissions and account eligibility.");
      }
    }

    if (request.method !== "POST" && request.method !== "GET") {
      return jsonError(json, corsHeaders, request, 405, "Method not allowed.");
    }
    if (request.method === "POST" && path === "/api/communications/meta/connect") {
      let claims, cfg;
      try {
        if (url.origin !== STAGING_GATEWAY) throw new Error("Meta connection is available only on the approved staging gateway.");
        claims = await authorizeUser(request, env, deps, false);
        cfg = safeConfig(env);
      } catch (error) {
        return jsonError(json, corsHeaders, request, error.status || 403, error.message || "Meta connection is not authorized.");
      }
      const state = randomState();
      await env.DRIVE_KV.put(STATE_KEY_PREFIX + state, JSON.stringify({ uid: claims.user_id, createdAt: Date.now() }), { expirationTtl: STATE_TTL_SECONDS });
      const authUrl = new URL("https://www.facebook.com/" + cfg.version + "/dialog/oauth");
      authUrl.search = new URLSearchParams({
        client_id: cfg.appId, redirect_uri: cfg.redirect, response_type: "code",
        state, scope: REQUIRED_SCOPES.join(",")
      }).toString();
      return json({ ok: true, authorizationUrl: authUrl.toString(), requestedScopes: REQUIRED_SCOPES,
        postingEnabled: true }, 200, corsHeaders(request));
    }

    if (request.method === "GET" && path === "/api/communications/meta/status") {
      let claims, cfg;
      try {
        if (url.origin !== STAGING_GATEWAY) throw new Error("Meta status checks are available only on the approved staging gateway.");
        claims = await authorizeUser(request, env, deps, false);
        cfg = safeConfig(env);
      } catch (error) {
        return jsonError(json, corsHeaders, request, error.status || 403, error.message || "Meta status check is not authorized.");
      }
      const encrypted = await env.DRIVE_KV.get(TOKEN_KEY_PREFIX + claims.user_id);
      if (!encrypted) return json({ ok: true, status: "not_connected", postingEnabled: false }, 200, corsHeaders(request));
      try {
        const connection = await decryptJson(env, encrypted);
        await requirePublishingScopes(cfg.version, connection.accessToken, cfg.appSecret);
        const me = await graphJson(graphUrl(cfg.version, "me", { fields: "id,name", access_token: connection.accessToken }).toString(), {}, cfg.appSecret);
        const pages = await graphJson(graphUrl(cfg.version, "me/accounts", {
          fields: "id,name,instagram_business_account{id,username,account_type}", limit: 100, access_token: connection.accessToken
        }).toString(), {}, cfg.appSecret);
        const accounts = publicAccounts(pages);
        return json({ ok: true, status: "verified", user: { id: String(me.id || ""), name: String(me.name || "").slice(0, 180) },
          facebookPages: accounts.map(({ facebookPageId, facebookPageName }) => ({ id: facebookPageId, name: facebookPageName })),
          instagramAccounts: accounts.flatMap(a => a.instagram.map(i => ({ id: i.instagramAccountId, username: i.username, accountType: i.accountType }))),
          connectedAt: connection.connectedAt, expiresAt: connection.expiresAt, postingEnabled: true,
          requestedScopes: REQUIRED_SCOPES }, 200, corsHeaders(request));
      } catch (error) {
        return json({ ok: false, status: "verification_failed", postingEnabled: false,
          error: error.message === "Meta access token is invalid or expired." ? error.message : "Meta API verification failed." },
          error.status || 502, corsHeaders(request));
      }
    }

    if (request.method === "POST" && path === "/api/communications/meta/disconnect") {
      try {
        if (url.origin !== STAGING_GATEWAY) throw new Error("Meta disconnect is available only on the approved staging gateway.");
        const claims = await authorizeUser(request, env, deps, false);
        await env.DRIVE_KV.delete(TOKEN_KEY_PREFIX + claims.user_id);
        return json({ ok: true, status: "disconnected", postingEnabled: false,
          note: "The local encrypted connection was removed. Revoke the app in Meta settings to revoke platform authorization." }, 200, corsHeaders(request));
      } catch (error) {
        return jsonError(json, corsHeaders, request, error.status || 403, error.message || "Meta disconnect was not authorized.");
      }
    }

    return jsonError(json, corsHeaders, request, 404, "Meta endpoint not found.");
  };
}

 
// Server-side Meta publisher. Tokens and Page access tokens are read only from encrypted staging KV.
export async function publishMetaContent(env, { uid, platform, accountId, text, link = "", imageUrl = "" } = {}) {
  const cfg = safeConfig(env);
  const safeUid = String(uid || "").trim();
  if (!safeUid) throw Object.assign(new Error("Authenticated staging user is required."), { status: 401 });
  const encrypted = await env.DRIVE_KV.get(TOKEN_KEY_PREFIX + safeUid);
  if (!encrypted) throw Object.assign(new Error("Connect Meta in the staging portal before publishing."), { status: 409 });
  const connection = await decryptJson(env, encrypted);
  await requirePublishingScopes(cfg.version, connection.accessToken, cfg.appSecret);
  const selectedPlatform = String(platform || "").toLowerCase();
  const selectedId = String(accountId || "").trim();
  if (!selectedId) throw Object.assign(new Error("Select a connected destination account."), { status: 400 });
  const account = (Array.isArray(connection.accounts) ? connection.accounts : []).find(item =>
    selectedPlatform === "facebook" ? item.facebookPageId === selectedId :
    selectedPlatform === "instagram" ? item.instagramAccountId === selectedId : false);
  if (!account) throw Object.assign(new Error("The selected destination is not part of this user's verified Meta connection."), { status: 403 });
  const pageToken = String(account.pageAccessToken || "");
  if (!pageToken) throw Object.assign(new Error("A Page access token was not returned for this destination. Reconnect Meta and verify Page permissions."), { status: 409 });
  const post = async (path, params) => graphJson(graphUrl(cfg.version, path, { ...params, access_token: pageToken }).toString(), { method: "POST" }, cfg.appSecret);
  if (selectedPlatform === "facebook") {
    if (!account.tasks?.includes("CREATE_CONTENT") && !account.tasks?.includes("MANAGE")) {
      throw Object.assign(new Error("The connected Meta user does not have the Page CREATE_CONTENT task."), { status: 403 });
    }
    const payload = { message: String(text || "").trim() };
    if (link) payload.link = String(link);
    if (!payload.message && !payload.link) throw Object.assign(new Error("Facebook publishing requires text or a link."), { status: 400 });
    const result = await post(account.facebookPageId + "/feed", payload);
    return { platform: "facebook", accountId: selectedId, postId: String(result.id || ""), publishedAt: new Date().toISOString() };
  }
  if (selectedPlatform === "instagram") {
    if (!account.instagramAccountId) throw Object.assign(new Error("This Page has no linked Instagram professional account."), { status: 409 });
    if (!/^https:\/\//i.test(String(imageUrl || ""))) throw Object.assign(new Error("Instagram feed publishing requires a publicly accessible HTTPS image URL."), { status: 400 });
    const caption = String(text || "").trim() + (link ? (String(text || "").trim() ? "\\n\\n" : "") + String(link) : "");
    const container = await post(account.instagramAccountId + "/media", { image_url: imageUrl, caption });
    if (!container.id) throw Object.assign(new Error("Meta did not return an Instagram media container ID."), { status: 502 });
    let state = {};
    for (let attempt = 0; attempt < 6; attempt++) {
      state = await graphJson(graphUrl(cfg.version, String(container.id), { fields: "status_code,status", access_token: pageToken }).toString(), {}, cfg.appSecret);
      if (state.status_code === "FINISHED") break;
      if (state.status_code === "ERROR" || state.status_code === "EXPIRED") throw Object.assign(new Error("Instagram rejected or expired the media container before publication."), { status: 502 });
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (state.status_code !== "FINISHED") throw Object.assign(new Error("Instagram media is still processing. Retry publication after checking the container status."), { status: 409 });
    const result = await post(account.instagramAccountId + "/media_publish", { creation_id: container.id });
    if (!result.id) throw Object.assign(new Error("Meta did not confirm the Instagram publication."), { status: 502 });
    return { platform: "instagram", accountId: selectedId, postId: String(result.id), publishedAt: new Date().toISOString() };
  }
  throw Object.assign(new Error("Automatic Meta publishing supports Facebook Pages and Instagram professional accounts only."), { status: 400 });
}
