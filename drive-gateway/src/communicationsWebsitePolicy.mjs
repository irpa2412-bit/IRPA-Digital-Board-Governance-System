const PUBLISH_ROLES = new Set(["Communication & Media Chair", "Communications & Media Chair", "Communication and Media Chair", "Communications and Media Chair"]);
const ALLOWED_MEDIA = new Map([
  [".jpg", new Set(["image/jpeg"])], [".jpeg", new Set(["image/jpeg"])], [".png", new Set(["image/png"])],
  [".webp", new Set(["image/webp"])], [".gif", new Set(["image/gif"])], [".pdf", new Set(["application/pdf"])],
  [".mp4", new Set(["video/mp4"])], [".webm", new Set(["video/webm"])], [".mp3", new Set(["audio/mpeg"])],
  [".wav", new Set(["audio/wav", "audio/x-wav"])], [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])]
]);
export const MAX_WORDPRESS_MEDIA_BYTES = 10 * 1024 * 1024;
export const WEBSITE_EDITABLE_FIELDS = Object.freeze(["title", "content", "excerpt", "seoTitle", "seoDescription"]);
export function mayPublish({ admin = false, active = false, roles = [] } = {}) {
  return Boolean(admin || (active && roles.some(role => PUBLISH_ROLES.has(String(role).trim()))));
}
export function editorialWordPressStatus(workflow) {
  if (workflow === "Draft" || workflow === "Review") return "draft";
  if (workflow === "Publish") return "publish";
  throw new Error("Workflow must be Draft, Review, or Publish.");
}
export function validateMediaUpload({ filename, contentType, size } = {}) {
  const name = String(filename || "").trim();
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot).toLowerCase();
  const allowed = ALLOWED_MEDIA.get(ext);
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".") || !allowed || !allowed.has(String(contentType || "").toLowerCase())) {
    throw new Error("Media file type is not allowed.");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_WORDPRESS_MEDIA_BYTES) {
    throw new Error("Media file must be between 1 byte and 10 MiB.");
  }
  return { filename: name, contentType: String(contentType).toLowerCase(), size };
}
export function assertStagingWebsiteHost(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("A valid staging website URL is required."); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "staging.irpa.or.tz" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("Communication website acceptance is staging-only; production hostnames are forbidden.");
  }
  return url;
}
export function redactSecrets(value, secrets = []) {
  let result = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) result = result.split(String(secret)).join("[REDACTED]");
  return result
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|application[_ -]?password|cpanel[_ -]?api[_ -]?token|token|secret|password)(["=: ]+)\S+/gi, "$1$2[REDACTED]");
}
export function auditEntry({ actorUid, actorEmail, action, objectType, objectId, changedFields = [], at = new Date().toISOString() } = {}) {
  if (!actorUid || !action || !objectType || !objectId) throw new Error("Audit actor, action and object are required.");
  return { actorUid: String(actorUid), actorEmail: String(actorEmail || ""), action: String(action), objectType: String(objectType), objectId: String(objectId), changedFields: [...new Set(changedFields.filter(f => WEBSITE_EDITABLE_FIELDS.includes(f)))], at: new Date(at).toISOString() };
}
export function assertAllowedWebsiteMutation(input = {}) {
  const allowed = new Set(["type", "id", "title", "content", "excerpt", "seoTitle", "seoDescription", "featuredMedia", "status", "workflow"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("Website portal cannot change plugins, themes, users, or settings.");
  return true;
}
