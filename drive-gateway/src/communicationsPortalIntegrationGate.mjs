// Fail-closed policy primitives for the Communication & Media Portal.
// Publishing remains OFF unless a deployment explicitly opts in.
export const COMMUNICATIONS_PUBLISHING_DEFAULTS = Object.freeze({
  publishingEnabled: false,
  pauseAll: true,
  schedulerEnabled: false,
  websitePublishingEnabled: false,
  socialPublishingEnabled: false
});
export function publishingGate({ env = {}, item, actor, now = Date.now(), scheduled = false } = {}) {
  if (String(env.COMMUNICATIONS_PUBLISHING_ENABLED || "false") !== "true") return { ok:false, reason:"Publishing feature flag is disabled." };
  if (String(env.COMMUNICATIONS_PAUSE_ALL || "true") !== "false") return { ok:false, reason:"Global publishing pause is active." };
  if (!actor?.uid) return { ok:false, reason:"Authenticated actor is required." };
  if (!item || item.status !== "Approved" || !item.approvedBy || !item.approvedAt) return { ok:false, reason:"Content must be independently approved with approver and timestamp." };
  if (item.authorUid && item.authorUid === actor.uid && actor.canApproveOwnContent !== true) return { ok:false, reason:"Author cannot approve their own content." };
  if (scheduled && (!item.scheduledAt || Date.parse(item.scheduledAt) > now)) return { ok:false, reason:"Item is not due for scheduled publishing." };
  return { ok:true, reason:"Policy gates passed; provider-specific connection verification is still required." };
}
export function requiredSecretStatus(env = {}, names = []) {
  const missing = names.filter(name => !String(env[name] || "").trim());
  return { status:missing.length ? "not_connected" : "credentials_configured_unverified", missingSecrets:missing };
}
