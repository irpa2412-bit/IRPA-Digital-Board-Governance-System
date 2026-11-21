const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveSignerRecipientEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("The selected participant must have a valid email address before they can be assigned.");
  return email;
}

export function findRegisteredSignerDuplicate(recipients = [], registeredUid) {
  if (!registeredUid) return null;
  return recipients.find((recipient) => recipient.uid === registeredUid) || null;
}

export function hasSignerResponsibility(assignments = [], assignment = {}) {
  return assignments.some((item) =>
    String(item.role || "").trim().toLowerCase() === String(assignment.role || "").trim().toLowerCase() &&
    String(item.title || "").trim().toLowerCase() === String(assignment.title || "").trim().toLowerCase() &&
    String(item.capacity || "").trim().toLowerCase() === String(assignment.capacity || "").trim().toLowerCase()
  );
}

export function signerDeliveryLabel(item = {}) {
  const delivery = item.delivery || {};
  if (delivery.state === "Failed") return "Failed (" + String(delivery.failureStageCode || item.deliveryStageCode || "SUBMIT") + ")";
  if (delivery.state === "Accepted by the mail server") {
    const category = String(delivery.smtpReplyCategory || "UNKNOWN");
    const acceptedAt = delivery.acceptedAt || delivery.at;
    const acceptedTime = acceptedAt
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(acceptedAt)) + " EAT"
      : "time not recorded";
    return "Accepted by the mail server (" + category + " · " + acceptedTime + ")";
  }
  if (delivery.state === "Sent" || delivery.state === "Not sent") return delivery.state;
  const legacy = String(item.invitation || "").trim();
  if (/^failed(?:\s|$)/i.test(legacy)) return "Failed (" + String(item.deliveryStageCode || legacy.match(/\(([^)]+)\)/)?.[1] || "SUBMIT") + ")";
  if (/^accepted by the mail server/i.test(legacy)) return legacy;
  if (/^sent$/i.test(legacy)) return "Sent";
  return "Not sent";
}

export function signerLinkStatusLabel(item = {}) {
  return item.linkExpired ? "Expired" : item.emailLinkStatus || "—";
}

function validateSignerInvitationLink(signingLink) {
  const link = String(signingLink || "");
  const parsed = new URL(link);
  if (parsed.protocol !== "https:" || (!parsed.searchParams.has("emailSignToken") && !parsed.searchParams.has("gatewayToken"))) {
    throw new Error("The Gateway did not return a valid signer-specific invitation link.");
  }
  return link;
}

export async function copySignerInvitationLink(signingLink, clipboard) {
  const link = validateSignerInvitationLink(signingLink);
  if (!clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
  await clipboard.writeText(link);
  return link;
}

export function buildSignerWhatsAppInvitationUrl(signingLink) {
  const link = validateSignerInvitationLink(signingLink);
  return "https://wa.me/?text=" + encodeURIComponent("IRPA signing invitation: " + link);
}
