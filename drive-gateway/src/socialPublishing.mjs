const PLATFORM_CONFIG = Object.freeze({
  facebook: { label: "Facebook Pages", required: ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"], maxText: 63206, mode: "manual-export" },
  instagram: { label: "Instagram", required: ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"], maxText: 2200, mode: "manual-export" },
  linkedin: { label: "LinkedIn", required: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], maxText: 3000, mode: "manual-export" },
  x: { label: "X", required: ["X_CLIENT_ID", "X_CLIENT_SECRET"], maxText: 280, mode: "manual-export" },
  youtube: { label: "YouTube", required: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], maxText: 5000, mode: "manual-export" },
  whatsapp: { label: "WhatsApp", required: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], maxText: 4096, mode: "manual-export" }
});

const jsonResponse = (body, status, cors) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
});

function statusFor(env, platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return { platform, status: "unsupported", reason: "Unknown platform." };
  const missing = config.required.filter(name => !String(env?.[name] || "").trim());
  return {
    platform, label: config.label,
    status: missing.length ? "not_connected" : "credentials_configured_unverified",
    reason: missing.length ? "Required Worker secrets are not configured." : "Credentials exist but account authorization and API publishing have not been verified.",
    missingSecrets: missing,
    mode: "manual-export",
    automaticPublishing: false
  };
}

function validateApprovedItem(item, user) {
  if (!item || typeof item !== "object") return "A content item is required.";
  if (item.status !== "Approved") return "Publishing blocked: item must be approved.";
  if (!item.approvedBy || !item.approvedAt) return "Publishing blocked: approver and approval time are required.";
  if (!user?.uid) return "Publishing blocked: authenticated identity is required.";
  if (item.authorUid && item.authorUid === user.uid && !user.canApproveOwnContent) {
    return "Publishing blocked: the author cannot approve their own content.";
  }
  return "";
}

export function formatSocialContent(platform, { text = "", url = "", hashtags = [] } = {}) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) throw new Error("Unsupported social platform.");
  const tags = Array.isArray(hashtags) ? hashtags.map(v => String(v).trim()).filter(v => /^#[\p{L}\p{N}_]{1,80}$/u.test(v)) : [];
  const normalized = [String(text).trim(), tags.join(" "), String(url).trim()].filter(Boolean).join("\n\n");
  if (normalized.length > config.maxText) throw new Error(config.label + " text exceeds the " + config.maxText + "-character limit.");
  return normalized;
}

export function getSocialPublishingSelfTest(env = {}) {
  return Object.keys(PLATFORM_CONFIG).map(platform => {
    const result = statusFor(env, platform);
    return {
      name: result.label + " adapter",
      status: "FAIL",
      reason: result.reason + " No automatic publishing adapter is enabled in this release.",
      missingSecrets: result.missingSecrets
    };
  });
}

export function createSocialPublishingRouter({ authenticateFirebaseRequest, json, corsHeaders }) {
  return async function route(request, env, pathname) {
    if (!pathname.startsWith("/api/communications/social/")) return null;
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let identity;
    try {
      identity = await authenticateFirebaseRequest(request, env);
      // The shared Worker verifier returns Firebase claims as user_id (and token),
      // not uid. Normalize the identity here instead of rejecting valid sessions.
      const uid = String(identity?.uid || identity?.user_id || identity?.sub || "").trim();
      if (!uid) throw new Error("Authenticated identity required.");
      identity = { ...identity, uid };
    } catch {
      return jsonResponse({ ok: false, error: "Authentication required." }, 401, cors);
    }

    if (request.method === "GET" && pathname === "/api/communications/social/status") {
      const platforms = Object.keys(PLATFORM_CONFIG).map(key => statusFor(env, key));
      const pause = String(await env?.DRIVE_KV?.get("communications:publishing:paused") || "true") !== "false";
      return jsonResponse({
        ok: true, pauseAllPublishing: pause, platforms,
        selfTest: [
          { name: "authentication", status: "PASS", reason: "Firebase identity verified." },
          { name: "approval gate", status: "PASS", reason: "Publishing requires approved content with approver and timestamp." },
          { name: "global pause", status: "PASS", reason: "Publishing defaults to paused unless an authorized operator explicitly enables it." },
          ...getSocialPublishingSelfTest(env)
        ]
      }, 200, cors);
    }

    if (request.method === "POST" && pathname === "/api/communications/social/export") {
      let body;
      try { body = await request.json(); } catch {
        return jsonResponse({ ok: false, error: "A JSON request body is required." }, 400, cors);
      }
      const platform = String(body.platform || "").toLowerCase();
      try {
        const text = formatSocialContent(platform, body.content || {});
        return jsonResponse({
          ok: true, mode: "manual-export", platform, text,
          reason: "Manual export only. No post was sent to a social platform."
        }, 200, cors);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message || "Unable to format content." }, 400, cors);
      }
    }

    if (request.method === "POST" && pathname === "/api/communications/social/publish") {
      let body;
      try { body = await request.json(); } catch {
        return jsonResponse({ ok: false, error: "A JSON request body is required." }, 400, cors);
      }
      const gate = validateApprovedItem(body.item, identity);
      if (gate) return jsonResponse({ ok: false, error: gate }, 403, cors);
      const paused = String(await env?.DRIVE_KV?.get("communications:publishing:paused") || "true") !== "false";
      if (paused) return jsonResponse({ ok: false, error: "Publishing is paused. No external post was sent." }, 423, cors);
      return jsonResponse({
        ok: false, mode: "manual-export",
        error: "Automatic publishing is disabled until a verified platform adapter and account connection are implemented.",
        platform: String(body.platform || "")
      }, 501, cors);
    }

    return jsonResponse({ ok: false, error: "Social publishing route not found." }, 404, cors);
  };
}

export const SOCIAL_PLATFORM_CONFIG = PLATFORM_CONFIG;
