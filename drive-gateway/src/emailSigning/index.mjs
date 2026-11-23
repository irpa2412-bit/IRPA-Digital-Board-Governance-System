import { HttpError, randomHex, safeEqual, sha256Hex } from "../util.mjs";

export const EMAIL_SIGNING_REBUILD_ENABLED = false;
export const EMAIL_SIGNING_ALREADY_SIGNED = "This document is already signed.";
export const EMAIL_SIGNING_RESEND_STATUSES = Object.freeze([
  "invited", "opened", "expired", "replaced", "revoked", "send failed", "signing interrupted"
]);
const CLOSED_ENVELOPES = new Set(["Completed", "Voided", "Declined", "Cancelled", "Canceled"]);
const normalizeEmail = value => String(value || "").trim().toLowerCase();

export async function issueEmailSigningLink({ envelopeId, signerId, email, now = new Date(), secret = randomHex(32) }) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, "A valid signer email is required.");
  if (!/^[0-9a-f]{64}$/i.test(String(secret))) throw new HttpError(400, "Email signing links require a 256-bit secret.");
  const createdAt = new Date(now).toISOString();
  return {
    token: String(secret).toLowerCase(),
    record: {
      tokenHash: await sha256Hex(String(secret).toLowerCase()),
      emailHash: await sha256Hex(normalized),
      envelopeId: String(envelopeId),
      signerId: String(signerId),
      createdAt,
      // Invitation tokens remain valid until signer/envelope state revokes them.
      status: "issued",
      attemptCount: 0,
      openCount: 0,
      ipAttempts: {},
      lastIpHash: null,
      usedAt: null,
      revokedAt: null
    }
  };
}

export async function inspectEmailSigningLink({ token, envelope, signer, now = new Date() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== String(envelope?.id || "") || parts[1] !== String(signer?.id || "") || !/^[0-9a-f]{64}$/i.test(parts[2])) {
    throw new HttpError(401, "This signing link is unavailable. Contact the document owner for a new invitation.");
  }
  const suppliedHash = await sha256Hex(parts[2].toLowerCase());
  const currentHash = String(signer?.tokenHash || "");
  const knownHashes = [
    currentHash,
    ...(Array.isArray(signer?.emailLinkTokenHistory) ? signer.emailLinkTokenHistory.map(item => item?.tokenHash) : []),
    ...(Array.isArray(signer?.tokenHistory) ? signer.tokenHistory.map(item => item?.tokenHash) : [])
  ].filter(Boolean).map(String);
  const matchesKnown = knownHashes.some(hash => safeEqual(suppliedHash, hash));
  const matchesCurrent = Boolean(currentHash) && safeEqual(suppliedHash, currentHash);
  const sessionMatch = Boolean(signer?.emailLinkSessionHash) && safeEqual(suppliedHash, String(signer.emailLinkSessionHash));

  const completedReadOnly = signer?.status === "Signed" && envelope?.status === "Completed" && matchesKnown;
  if (!matchesCurrent && !sessionMatch) {
    const replaced = (signer?.emailLinkTokenHistory || []).some(item => item?.status === "replaced" && safeEqual(suppliedHash, String(item.tokenHash || "")));
    if (replaced) throw new HttpError(410, "This link was replaced. Please use the newest email.");
    throw new HttpError(401, "This signing link is unavailable. Contact the document owner for a new invitation.");
  }
  const tokenKind = sessionMatch ? "session" : "invitation";
  const status = String(tokenKind === "session" ? signer.emailLinkSessionStatus : signer.emailLinkStatus || "");
  const completedSession = tokenKind === "session" && envelope.status === "Completed" && signer.status === "Signed" && status === "used";
  if (CLOSED_ENVELOPES.has(String(envelope?.status || "")) && !completedSession && !completedReadOnly) {
    throw new HttpError(410, "This signing envelope is no longer active.");
  }
  const permitted = tokenKind === "session"
    ? status === "active" || completedSession
    : ["issued", "opened", "expired"].includes(status) || completedReadOnly;
  if (!permitted) {
    if (signer?.status === "Signed" && tokenKind === "invitation" && !completedReadOnly) throw new HttpError(410, EMAIL_SIGNING_ALREADY_SIGNED);
    throw new HttpError(410, "This signing link has expired or is no longer active.");
  }
  const expiry = tokenKind === "session" ? signer.emailLinkSessionExpiresAt : null;
  const expiryMs = Date.parse(String(expiry || ""));
  if (tokenKind === "session" && (!Number.isFinite(expiryMs) || new Date(now).getTime() > expiryMs)) {
    throw new HttpError(410, "This signing session has expired. Reopen the original email invitation.");
  }
  return { ok: true, tokenKind, suppliedHash, expiry: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null };
}
export function createFreshSigningSession({ envelopeId, signerId, now = new Date(), durationMinutes = 30 }) {
  const secret = randomHex(32);
  const nowMs = new Date(now).getTime();
  const sessionExpiry = nowMs + durationMinutes * 60000;
  return {
    token: `${envelopeId}.${signerId}.${secret}`,
    secret,
    expiresAt: new Date(sessionExpiry).toISOString()
  };
}

export function canResendEmailSigningLink(envelope, signer) {
  return Boolean(envelope && signer && signer.status !== "Signed" && !CLOSED_ENVELOPES.has(String(envelope.status || "")));
}

export function assertCanResendEmailSigningLink(envelope, signer) {
  if (!envelope || !signer) throw new HttpError(404, "Signer assignment not found.");
  if (!canResendEmailSigningLink(envelope, signer)) {
    if (signer.status === "Signed") throw new HttpError(409, "A signer who has completed signing cannot receive another link.");
    throw new HttpError(409, "A completed or cancelled signing envelope cannot send another link.");
  }
}

export function reserveEmailSigningResend(signer, attemptId, now = new Date()) {
  const attempts = Array.isArray(signer?.resendAttempts) ? signer.resendAttempts : [];
  return { ...signer, resendAttempts: [...attempts, { id: String(attemptId), startedAt: new Date(now).toISOString() }] };
}

export function rollbackEmailSigningResend(signer, attemptId) {
  const attempts = Array.isArray(signer?.resendAttempts) ? signer.resendAttempts : [];
  return { ...signer, resendAttempts: attempts.filter(item => item?.id !== String(attemptId)) };
}

export async function commitEmailSigningResend(signer, { attemptId, tokenHash, now = new Date(), emailHash = null }) {
  if (!signer || signer.status === "Signed" || !(Array.isArray(signer.resendAttempts) && signer.resendAttempts.some(item => item?.id === String(attemptId)))) {
    throw new HttpError(409, "The invitation was sent but its signer reservation changed; refresh delivery status before another resend.");
  }
  const at = new Date(now).toISOString();
  const oldHash = String(signer.tokenHash || "");
  const priorHistory = signer.emailLinkTokenHistory || [];
  const alreadyRecorded = oldHash && priorHistory.some(item => item?.tokenHash === oldHash);
  const history = [...priorHistory, ...(oldHash && !alreadyRecorded ? [{ tokenHash: oldHash, status: "replaced", replacedAt: at }] : [])].slice(-20);
  const next = {
    ...signer,
    tokenHash: String(tokenHash),
    emailHash: emailHash || signer.emailHash || null,
    emailLinkStatus: "issued",
    emailLinkSessionStatus: "revoked",
    emailLinkSessionHash: null,
    emailLinkSessionExpiresAt: null,
    emailLinkExpiresAt: null,
    tokenExpiresAt: null,
    emailLinkAttemptCount: 0,
    emailLinkOpenCount: 0,
    emailLinkIpAttempts: {},
    emailLinkLastIpHash: null,
    emailLinkOpenedAt: null,
    emailLinkTokenHistory: history,
    invitation: "Sent"
  };
  next.resendAttempts = (Array.isArray(next.resendAttempts) ? next.resendAttempts : []).filter(item => item?.id !== String(attemptId));
  return next;
}

export async function updateEmailSignerContact(signer, { email, name, now = new Date() }) {
  if (!signer || signer.status === "Signed") throw new HttpError(409, "Signer details cannot be changed after signing.");
  const normalizedEmail = normalizeEmail(email ?? signer.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new HttpError(400, "A valid signer email is required.");
  const normalizedName = String(name ?? signer.name ?? "").trim();
  if (!normalizedName || normalizedName.length > 160) throw new HttpError(400, "A valid signer name is required.");
  return {
    signer: {
      ...signer,
      email: normalizedEmail,
      emailHash: await sha256Hex(normalizedEmail),
      name: normalizedName,
      declaredParticulars: { ...(signer.declaredParticulars || {}), name: normalizedName }
    },
    audit: {
      type: "email_link.signer_contact_updated",
      signerId: signer.id,
      at: new Date(now).toISOString(),
      previousEmailHash: signer.emailHash || await sha256Hex(normalizeEmail(signer.email)),
      nextEmailHash: await sha256Hex(normalizedEmail),
      previousName: String(signer.name || ""),
      nextName: normalizedName,
      fieldsPreserved: true
    }
  };
}

export function markEmailSignerSigned(signer, at = new Date()) {
  return {
    ...signer,
    status: "Signed",
    emailLinkStatus: "used",
    emailLinkSessionStatus: "used",
    emailLinkSessionConsumedAt: new Date(at).toISOString()
  };
}

export function maskEmailForConfirmation(email) {
  const value = normalizeEmail(email);
  const [local, domain] = value.split("@");
  if (!local || !domain) return "recipient";
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

export function formatEmailLinkExpiryEAT(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "expiry unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date) + " EAT";
}
