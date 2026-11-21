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

export const MAX_MAIL_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function attachmentBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  const encoded = btoa(binary);
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

export function buildMailMimeMessage({from, to, subject, text, html, attachments = []}) {
  const cleanFrom = validateMailHeader(from, "From");
  const cleanTo = normalizeRecipientEmail(to);
  const cleanSubject = validateMailHeader(subject, "Subject");
  if (!Array.isArray(attachments) || attachments.length > 1) throw new Error("At most one completed PDF attachment is supported.");
  const seed = crypto.randomUUID().replace(/-/g, "");
  const alternativeBoundary = "IRPA-ALT-" + seed;
  const alternative = [
    "--" + alternativeBoundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(text || ""),
    "",
    "--" + alternativeBoundary,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(html || ""),
    "",
    "--" + alternativeBoundary + "--",
    ""
  ].join("\r\n");
  const headers = [
    "From: " + cleanFrom,
    "To: <" + cleanTo + ">",
    "Subject: " + cleanSubject,
    "MIME-Version: 1.0"
  ];
  if (!attachments.length) {
    return [
      ...headers,
      "Content-Type: multipart/alternative; boundary=\"" + alternativeBoundary + "\"",
      "",
      alternative
    ].join("\r\n");
  }
  const attachment = attachments[0] || {};
  const bytes = attachment.bytes instanceof Uint8Array
    ? attachment.bytes
    : attachment.bytes instanceof ArrayBuffer
      ? new Uint8Array(attachment.bytes)
      : null;
  if (!bytes || !bytes.length || bytes.length > MAX_MAIL_ATTACHMENT_BYTES) {
    throw new Error("Completed PDF attachment must be a non-empty file of at most 12 MB.");
  }
  if (String(attachment.contentType || "") !== "application/pdf") {
    throw new Error("Only completed PDF attachments are permitted.");
  }
  const filename = validateMailHeader(attachment.filename || "completed-signed-document.pdf", "Attachment filename")
    .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "completed-signed-document.pdf";
  const mixedBoundary = "IRPA-MIXED-" + seed;
  return [
    ...headers,
    "Content-Type: multipart/mixed; boundary=\"" + mixedBoundary + "\"",
    "",
    "--" + mixedBoundary,
    "Content-Type: multipart/alternative; boundary=\"" + alternativeBoundary + "\"",
    "",
    alternative,
    "--" + mixedBoundary,
    "Content-Type: application/pdf; name=\"" + filename + "\"",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment; filename=\"" + filename + "\"",
    "",
    attachmentBase64(bytes),
    "",
    "--" + mixedBoundary + "--",
    ""
  ].join("\r\n");
}


export function buildSmtpRecipientEnvelope({from,to,subject,text,html,attachments=[]}) {
  const typedRecipient = String(to || "").trim().toLowerCase();
  if (!/^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]+$/.test(typedRecipient)) {
    throw new Error("A single signer recipient email address is required.");
  }
  const recipient = normalizeRecipientEmail(typedRecipient);
  const mime = buildMailMimeMessage({from,to:recipient,subject,text,html,attachments});
  return {
    recipient,
    rcptCommand: "RCPT TO:<" + recipient + ">",
    mime
  };
}
