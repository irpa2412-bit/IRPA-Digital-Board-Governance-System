const PLATFORM_CONFIG = Object.freeze({
  facebook: { label: "Facebook Pages", required: ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"], maxText: 63206, mode: "meta-api" },
  instagram: { label: "Instagram Professional", required: ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"], maxText: 2200, mode: "meta-api" },
  linkedin: { label: "LinkedIn", required: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], maxText: 3000, mode: "manual-export" },
  x: { label: "X", required: ["X_CLIENT_ID", "X_CLIENT_SECRET"], maxText: 280, mode: "manual-export" },
  youtube: { label: "YouTube", required: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], maxText: 5000, mode: "manual-export" },
  tiktok: { label: "TikTok", required: [], maxText: 2200, mode: "manual-export" },
  whatsapp: { label: "WhatsApp", required: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], maxText: 4096, mode: "manual-export" },
  telegram: { label: "Telegram", required: [], maxText: 4096, mode: "manual-export" }
});

const jsonResponse = (body, status, cors) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
});

function statusFor(env, platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return { platform, status: "unsupported", reason: "Unknown platform." };
  const missing = config.required.filter(name => !String(env?.[name] || "").trim());
  if (config.mode !== "meta-api") return { platform, label: config.label, status: "manual_export_only", reason: "No automatic publishing adapter is enabled for this platform in this release.", missingSecrets: missing, mode: config.mode, automaticPublishing: false };
  return {
    platform, label: config.label,
    status: missing.length ? "not_connected" : "credentials_configured_unverified",
    reason: missing.length ? "Required Worker secrets are not configured." : "Credentials exist but account authorization and API publishing have not been verified.",
    missingSecrets: missing,
    mode: config.mode,
    automaticPublishing: config.mode === "meta-api" && missing.length === 0
  };
}

function validateApprovedItem(item, user) {
  if (!item || typeof item !== "object") return "A content item is required.";
  if (item.status !== "Approved") return "Publishing blocked: item must be approved.";
  if (!item.approvedBy || !item.approvedAt || Number(item.approvedRevision || 0) !== Number(item.revision || 0)) return "Publishing blocked: a current approval and revision are required.";
  if (!user?.uid) return "Publishing blocked: authenticated identity is required.";
  if (item.authorUid && item.authorUid === user.uid && (!user.canApproveOwnContent || item.approvalMode !== "STAGING_ADMIN_OVERRIDE")) {
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
      status: result.mode === "meta-api" && result.automaticPublishing ? "NOT_VERIFIED" : "BLOCKED",
      reason: result.mode === "meta-api" && result.automaticPublishing ? "Meta app credentials are configured; complete staging OAuth and destination-account verification before publishing." : result.reason + " This platform remains manual-export only in this release.",
      missingSecrets: result.missingSecrets
    };
  });
}

export function createSocialPublishingRouter({ authorize, publishMetaContent, json, corsHeaders }) {
  return async function route(request, env, pathname) {
    if (!pathname.startsWith("/api/communications/social/")) return null;
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let identity;
    try {
      identity = await authorize(request, env);
      if (!identity?.uid || !Array.isArray(identity.roles) || !identity.roles.length) throw new Error("An authorized IRPA role is required.");
      const allowed = ["Administrator", "Executive Director", "Communications Officer", "Communications Manager", "Media Officer", "Public Relations Officer"];
      if (!identity.roles.some(role => allowed.includes(role))) throw Object.assign(new Error("Your IRPA role does not permit publishing operations."), { status: 403 });
    } catch (error) {
      return jsonResponse({ ok: false, error: error.status === 403 ? error.message : "Authentication required." }, error.status || 401, cors);
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
      const platform = String(body.platform || "").toLowerCase();
      if (!["facebook", "instagram"].includes(platform)) {
        return jsonResponse({ ok: false, mode: "manual-export", error: "Automatic publishing is currently implemented only for Facebook Pages and Instagram professional accounts.", platform }, 501, cors);
      }
      const itemId = String(body.itemId || body.item?.id || "").trim();
      if (!itemId || itemId.length > 100) return jsonResponse({ ok: false, error: "A saved editorial item ID is required." }, 400, cors);
      let items = [];
      try { items = JSON.parse(await env.DRIVE_KV.get("communications:editorial:items") || "[]"); } catch {}
      const item = Array.isArray(items) ? items.find(row => row.id === itemId) : null;
      if (!item) return jsonResponse({ ok: false, error: "The saved editorial item was not found." }, 404, cors);
      const gate = validateApprovedItem(item, identity);
      if (gate) return jsonResponse({ ok: false, error: gate }, 403, cors);
      if (!Array.isArray(item.platforms) || !item.platforms.includes(platform)) return jsonResponse({ ok: false, error: "The selected platform is not included in the saved approved content item." }, 403, cors);
      if (Array.isArray(item.publishedPlatforms) && item.publishedPlatforms.includes(platform)) return jsonResponse({ ok: false, error: "This approved item has already been published to the selected platform." }, 409, cors);
      const paused = String(await env?.DRIVE_KV?.get("communications:publishing:paused") || "true") !== "false";
      if (paused) return jsonResponse({ ok: false, error: "Publishing is paused. No external post was sent." }, 423, cors);
      if (typeof publishMetaContent !== "function") return jsonResponse({ ok: false, error: "The staging Meta publisher is not wired into the Worker." }, 503, cors);
      const accountId = String(body.accountId || "").trim();
      let text;
      try { text = formatSocialContent(platform, { text: String(item.content || item.body || "").trim() }); }
      catch (error) { return jsonResponse({ ok: false, error: error.message || "The content is not valid for this platform." }, 400, cors); }
      const auditKey = "communications:publishing:audit";
      let events = [];
      try { events = JSON.parse(await env.DRIVE_KV.get(auditKey) || "[]"); } catch {}
      const priorAttempts = events.filter(event => event.itemId === itemId && event.platform === platform);
      if (priorAttempts.some(event => event.action === "PUBLISHED")) return jsonResponse({ ok: false, error: "This item already has a confirmed publication record for the selected platform." }, 409, cors);
      const terminalAttempts = new Set(priorAttempts.filter(event => ["PUBLISHED", "PUBLISH_FAILED"].includes(event.action)).map(event => event.attemptId).filter(Boolean));
      if (priorAttempts.some(event => event.action === "PUBLISH_REQUESTED" && !terminalAttempts.has(event.id))) {
        return jsonResponse({ ok: false, error: "A previous publishing attempt has no confirmed outcome. Check the publishing audit and destination before retrying." }, 409, cors);
      }
      const attemptId = crypto.randomUUID();
      events.push({ id: attemptId, action: "PUBLISH_REQUESTED", itemId, platform, accountId, actorUid: identity.uid, at: new Date().toISOString(), status: "In Progress" });
      await env.DRIVE_KV.put(auditKey, JSON.stringify(events.slice(-1000)));
      let result;
      try {
        result = await publishMetaContent(env, {
          uid: identity.uid, platform, accountId, text,
          link: String(item.link || ""), imageUrl: String(item.imageUrl || "")
        });
        if (!result?.postId) {
          events.push({ id: crypto.randomUUID(), attemptId, action: "PUBLISH_UNCONFIRMED", itemId, platform, accountId, actorUid: identity.uid, at: new Date().toISOString(), status: "Outcome Unconfirmed" });
          await env.DRIVE_KV.put(auditKey, JSON.stringify(events.slice(-1000)));
          return jsonResponse({ ok: false, published: false, outcome: "unconfirmed", error: "The platform did not return a confirmed post ID. Verify the destination before retrying." }, 502, cors);
        }
      } catch (error) {
        events.push({ id: crypto.randomUUID(), attemptId, action: "PUBLISH_FAILED", itemId, platform, accountId, actorUid: identity.uid, at: new Date().toISOString(), status: "Failed", error: String(error?.message || "Meta publishing failed.").slice(0, 300) });
        await env.DRIVE_KV.put(auditKey, JSON.stringify(events.slice(-1000)));
        return jsonResponse({ ok: false, published: false, error: error.message || "Meta publishing failed." }, error.status || 502, cors);
      }
      item.publishedPlatforms = [...new Set([...(Array.isArray(item.publishedPlatforms) ? item.publishedPlatforms : []), platform])];
      item.platformPublicationResults = [...(Array.isArray(item.platformPublicationResults) ? item.platformPublicationResults : []), { platform, accountId, postId: result.postId, publishedAt: result.publishedAt, publishedByUid: identity.uid }];
      let itemStatePersisted = false;
      try {
        await env.DRIVE_KV.put("communications:editorial:items", JSON.stringify(items));
        itemStatePersisted = true;
      } catch {}
      events.push({ id: crypto.randomUUID(), attemptId, action: "PUBLISHED", itemId, platform, accountId, postId: result.postId, actorUid: identity.uid, at: result.publishedAt, status: "Published", itemStatePersisted });
      let auditPersisted = false;
      try {
        await env.DRIVE_KV.put(auditKey, JSON.stringify(events.slice(-1000)));
        auditPersisted = true;
      } catch {}
      return jsonResponse({ ok: true, published: true, mode: "meta-api", result, itemStatePersisted, auditPersisted,
        warning: !itemStatePersisted || !auditPersisted ? "The platform confirmed publication, but one or more local audit/state writes did not complete. Do not retry; reconcile the publishing audit first." : "" }, 200, cors);
      }
    }
    return jsonResponse({ ok: false, error: "Social publishing route not found." }, 404, cors);
  };
}

export const SOCIAL_PLATFORM_CONFIG = PLATFORM_CONFIG;
