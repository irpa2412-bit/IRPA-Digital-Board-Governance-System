import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function createSignatureInvite({ envelopeId, documentId, recipientUid, recipientEmail, baseUrl, now = Date.now(), ttlMs = 72 * 60 * 60 * 1000 }) {
  if (!envelopeId || !documentId || !recipientUid || !recipientEmail) throw new Error("Envelope, document and recipient identity are required.");
  const secret = randomBytes(32).toString("base64url");
  const token = [envelopeId, documentId, recipientUid, secret].map(encodeURIComponent).join(".");
  const tokenHash = sha256(secret);
  const expiresAt = new Date(now + ttlMs).toISOString();
  const url = `${String(baseUrl).replace(/\/$/, "")}/signature-invite?token=${encodeURIComponent(token)}`;
  return { token, tokenHash, expiresAt, url, envelopeId, documentId, recipientUid, recipientEmail: String(recipientEmail).trim().toLowerCase() };
}

export function verifySignatureInvite({ token, expected, now = Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return { ok:false, status:401, error:"Invalid invitation token." };
  const [envelopeId, documentId, recipientUid, secret] = parts.map(decodeURIComponent);
  if (!envelopeId || !documentId || !recipientUid || !secret) return { ok:false, status:401, error:"Invalid invitation token." };
  if (!expected || expected.envelopeId !== envelopeId || expected.documentId !== documentId || expected.recipientUid !== recipientUid) {
    return { ok:false, status:403, error:"This invitation token is not valid for this document or signer." };
  }
  const expectedHash = String(expected.tokenHash || "");
  const suppliedHash = sha256(secret);
  if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(Buffer.from(expectedHash), Buffer.from(suppliedHash))) {
    return { ok:false, status:403, error:"Invalid invitation token." };
  }
  if (new Date(expected.expiresAt).getTime() <= now) return { ok:false, status:403, error:"This invitation token has expired." };
  return { ok:true, envelopeId, documentId, recipientUid, recipientEmail:expected.recipientEmail };
}

export async function sendWithRetry(provider, payload, { attempts = 3, delayMs = 250, logger = console } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await provider(payload, attempt);
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      logger.error("signature invitation provider failure", { attempt, attempts, error: String(error?.message || error) });
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
