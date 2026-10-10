import { APPLICATION_PORTAL_HTML } from "./application-portal.js";

let firebaseJwkCache = { keys: [], expiresAt: 0 };
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() } });
}
function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "600" };
}
async function verifyFirebaseIdToken(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("A valid Firebase sign-in token is required.");
  let header, claims;
  try {
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), ch => ch.charCodeAt(0));
    header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  } catch { throw new Error("Firebase sign-in token is malformed."); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || !header.kid || claims.aud !== "irpa-digital-board-governance" ||
      claims.iss !== "https://securetoken.google.com/irpa-digital-board-governance" ||
      !claims.sub || claims.sub.length > 128 || !claims.exp || claims.exp <= now ||
      !claims.iat || claims.iat > now + 60 || !claims.auth_time || claims.auth_time > now + 60) {
    throw new Error("Firebase sign-in token is invalid or expired.");
  }
  let keys = firebaseJwkCache.expiresAt > now ? firebaseJwkCache.keys : null;
  if (!keys) {
    const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Identity verification service is temporarily unavailable.");
    const data = await response.json();
    const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/i)?.[1] || 300);
    keys = data.keys || [];
    firebaseJwkCache = { keys, expiresAt: now + Math.min(Math.max(maxAge, 60), 3600) };
  }
  const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) { firebaseJwkCache.expiresAt = 0; throw new Error("Firebase signing key is not recognized; retry the request."); }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4)), ch => ch.charCodeAt(0));
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]))) throw new Error("Firebase signing token signature is invalid.");
  return claims;
}
function parseRow(row) {
  let content = {};
  try { content = JSON.parse(row.content_json || "{}"); } catch {}
  return { ...content, id: row.id, name: row.name, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}
async function listDrafts(env, uid) {
  if (!env.GRANTS_DB) throw new Error("Grant application draft storage is not configured.");
  const result = await env.GRANTS_DB.prepare("SELECT id, name, status, content_json, created_at, updated_at FROM grant_application_drafts WHERE owner_uid = ? ORDER BY updated_at DESC LIMIT 100").bind(uid).all();
  return { drafts: (result.results || []).map(parseRow) };
}
async function getDraft(env, uid, id) {
  if (!env.GRANTS_DB) throw new Error("Grant application draft storage is not configured.");
  const row = await env.GRANTS_DB.prepare("SELECT id, name, status, content_json, created_at, updated_at FROM grant_application_drafts WHERE owner_uid = ? AND id = ? LIMIT 1").bind(uid, id).first();
  return row ? parseRow(row) : null;
}
async function saveDraft(request, env, uid) {
  if (!env.GRANTS_DB) return json({ error: "Grant application draft storage is not configured." }, 503);
  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 100_000) return json({ error: "Draft exceeds the 100 KB limit." }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "Draft must be valid JSON." }, 400); }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) return json({ error: "A valid draft identifier is required." }, 400);
  const opportunity = body.opportunity && typeof body.opportunity === "object" ? body.opportunity : {};
  const title = String(opportunity.title || "").trim().slice(0, 500);
  const url = String(opportunity.url || "").trim().slice(0, 1000);
  if (url) {
    try { const parsed = new URL(url); if (parsed.protocol !== "https:" || parsed.username || parsed.password) return json({ error: "Opportunity URL must be credential-free HTTPS." }, 400); }
    catch { return json({ error: "Opportunity URL must be a valid HTTPS URL." }, 400); }
  }
  const content = {
    name: String(body.name || title || "Untitled draft").trim().slice(0, 300),
    opportunity: { title, url, description: String(opportunity.description || "").slice(0, 10000), donorRequirements: String(opportunity.donorRequirements || "").slice(0, 8000) },
    applicationFields: body.applicationFields && typeof body.applicationFields === "object" ? body.applicationFields : {},
    assessment: body.assessment && typeof body.assessment === "object" ? body.assessment : null,
    finalNotes: String(body.finalNotes || "").slice(0, 10000),
    status: "draft"
  };
  const contentJson = JSON.stringify(content);
  if (contentJson.length > 100_000) return json({ error: "Saved application content exceeds the 100 KB limit." }, 413);
  await env.GRANTS_DB.prepare("INSERT INTO grant_application_drafts (id, owner_uid, name, opportunity_title, opportunity_url, status, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name, opportunity_title=excluded.opportunity_title, opportunity_url=excluded.opportunity_url, status='draft', content_json=excluded.content_json, updated_at=CURRENT_TIMESTAMP WHERE grant_application_drafts.owner_uid=excluded.owner_uid").bind(id, uid, content.name, title, url, contentJson).run();
  const saved = await getDraft(env, uid, id);
  if (!saved) return json({ error: "Draft not found or you do not own this draft." }, 403);
  return json({ draft: saved });
}
export async function handleApplicationPortal(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/application" || url.pathname === "/application/")) {
    return new Response(APPLICATION_PORTAL_HTML, { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; object-src 'none';"
    }});
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (!(url.pathname === "/application/drafts" || url.pathname.startsWith("/application/drafts/"))) return json({ error: "Not found" }, 404);
  let claims;
  try { claims = await verifyFirebaseIdToken(String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env); }
  catch (error) { return json({ error: String(error.message || "A valid sign-in is required.").slice(0, 300) }, 401); }
  if (request.method === "GET" && url.pathname === "/application/drafts") {
    try { return json(await listDrafts(env, claims.sub)); }
    catch (error) { return json({ error: String(error.message || "Unable to load drafts").slice(0, 300) }, 503); }
  }
  if (request.method === "POST" && url.pathname === "/application/drafts") {
    try { return await saveDraft(request, env, claims.sub); }
    catch (error) { return json({ error: String(error.message || "Unable to save draft").slice(0, 300) }, 503); }
  }
  const match = url.pathname.match(/^\/application\/drafts\/([A-Za-z0-9_-]{8,100})$/);
  if (request.method === "GET" && match) {
    try { const draft = await getDraft(env, claims.sub, match[1]); return draft ? json({ draft }) : json({ error: "Draft not found." }, 404); }
    catch (error) { return json({ error: String(error.message || "Unable to load draft").slice(0, 300) }, 503); }
  }
  return json({ error: "Not found" }, 404);
}
