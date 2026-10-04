export const MAX_MAIL_RETRIES = 3;
export const RETRY_BACKOFF_MS = [250, 500];

export function normalizeRecipientEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.includes("\r") || email.includes("\n") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid recipient email address is required.");
  }
  return email;
}
export function validateMailHeader(value, label) {
  const text = String(value ?? "");
  if (text.includes("\r") || text.includes("\n")) throw new Error(String(label) + " contains invalid newline characters.");
  return text;
}
export function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function recipientDomain(email) { try { return normalizeRecipientEmail(email).split("@")[1]; } catch { return "invalid"; } }
export function safeMailError(error) {
  return String(error?.message || "Mail delivery failed.").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[recipient]").slice(0, 500);
}
export function isAuthorizedInviteCaller(claims, record) {
  const uid = String(claims?.user_id || "");
  return Boolean(uid && record && String(record.senderUid || record.ownerUid || "") === uid);
}
export async function sendWithRetry(sendOnce, { maxAttempts = MAX_MAIL_RETRIES, backoffMs = RETRY_BACKOFF_MS, onFailure = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await sendOnce(attempt); }
    catch (error) {
      lastError = error;
      await onFailure(error, attempt);
      if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, backoffMs[attempt - 1] || 0));
    }
  }
  throw lastError || new Error("Mail delivery failed.");
}
