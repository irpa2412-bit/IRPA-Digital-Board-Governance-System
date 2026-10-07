import { sha256Hex, canonicalJson } from "./util.mjs";

export const CRYPTOGRAPHIC_GATE_VERSION = "1.0.0";
export const CRYPTO_SIGNATURE_ALGORITHM = Object.freeze({
  name: "ECDSA",
  namedCurve: "P-256",
  hash: "SHA-256",
});
export const CRYPTO_EVIDENCE_SCHEMA = "IRPA-CRYPTOGRAPHIC-EVIDENCE-1";

const enc = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const s = String(value || "");
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("Invalid base64url value.");
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function requireHexHash(value, field) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ""))) {
    throw new Error(field + " must be a lowercase SHA-256 hash.");
  }
  return String(value);
}

function requireIdentity(value) {
  const uid = String(value || "").trim();
  if (!uid) throw new Error("Cryptographic signing requires an authenticated signer UID.");
  return uid;
}


export async function generateSignerKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
}

export async function importPublicKeyJwk(jwk) {
  if (!jwk?.kty || !jwk?.crv || !jwk?.x || !jwk?.y) {
    throw new Error("Persisted public signing key is invalid.");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error("Persisted public signing key algorithm is invalid.");
  }
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function exportPublicKeyJwk(publicKey) {
  if (!publicKey) throw new Error("Public signing key is required.");
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return Object.freeze({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    ext: true,
  });
}

export function buildCanonicalSigningPayload({
  envelopeId,
  signerId,
  signerUid,
  documentHash,
  signatureHash,
  signatureType,
  signedAt,
  chainHead,
  keyId,
} = {}) {
  const payload = {
    schema: CRYPTO_EVIDENCE_SCHEMA,
    gateVersion: CRYPTOGRAPHIC_GATE_VERSION,
    algorithm: "ECDSA-P256-SHA256",
    envelopeId: String(envelopeId || ""),
    signerId: String(signerId || ""),
    signerUid: requireIdentity(signerUid),
    documentHash: requireHexHash(documentHash, "documentHash"),
    signatureHash: requireHexHash(signatureHash, "signatureHash"),
    signatureType: String(signatureType || ""),
    signedAt: new Date(signedAt || "").toISOString(),
    chainHead: requireHexHash(chainHead, "chainHead"),
    keyId: String(keyId || ""),
  };
  if (!payload.envelopeId || !payload.signerId || !payload.signatureType || !payload.keyId) {
    throw new Error("Cryptographic signing payload is incomplete.");
  }
  return canonicalJson(payload);
}

export async function signCanonicalPayload(privateKey, canonicalPayload) {
  if (!privateKey) throw new Error("Private signing key is required.");
  const payloadBytes = enc.encode(String(canonicalPayload));
  const signature = await crypto.subtle.sign(
    CRYPTO_SIGNATURE_ALGORITHM,
    privateKey,
    payloadBytes,
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyCanonicalPayload(publicKey, canonicalPayload, signature) {
  if (!publicKey) throw new Error("Public signing key is required.");
  const signatureBytes = base64UrlToBytes(signature);
  return crypto.subtle.verify(
    CRYPTO_SIGNATURE_ALGORITHM,
    publicKey,
    signatureBytes,
    enc.encode(String(canonicalPayload)),
  );
}

export async function createCryptographicEvidence({
  keyId,
  signer,
  documentHash,
  chainHead,
  signedAt,
} = {}) {
  const signerUid = requireIdentity(signer?.uid);
  const publicKey = signer?.publicKey;
  const privateKey = signer?.privateKey;
  const signatureHash = requireHexHash(signer?.signatureHash, "signatureHash");
  if (!publicKey || !privateKey) throw new Error("Signer cryptographic key material is unavailable.");
  const publicKeyJwk = await exportPublicKeyJwk(publicKey);
  const canonicalPayload = buildCanonicalSigningPayload({
    envelopeId: signer.envelopeId,
    signerId: signer.signerId || signer.id,
    signerUid,
    documentHash,
    signatureHash,
    signatureType: signer.signatureType,
    signedAt,
    chainHead,
    keyId,
  });
  const payloadHash = await sha256Hex(canonicalPayload);
  const signature = await signCanonicalPayload(privateKey, canonicalPayload);
  const evidenceId = "CRYPTO-" + payloadHash;
  return Object.freeze({
    evidenceId,
    schema: CRYPTO_EVIDENCE_SCHEMA,
    gateVersion: CRYPTOGRAPHIC_GATE_VERSION,
    algorithm: "ECDSA-P256-SHA256",
    keyId,
    signerUid,
    signerId: signer.signerId,
    envelopeId: signer.envelopeId,
    documentHash,
    signatureHash,
    signatureType: signer.signatureType,
    signedAt: new Date(signedAt).toISOString(),
    chainHead,
    payloadHash,
    canonicalPayload,
    signature,
    publicKeyJwk,
    status: "SEALED",
  });
}

export async function verifyCryptographicEvidence(evidence, {
  documentHash,
  signerUid,
  publicKey,
} = {}) {
  if (!evidence || evidence.schema !== CRYPTO_EVIDENCE_SCHEMA) return false;
  if (evidence.status !== "SEALED") return false;
  if (documentHash !== evidence.documentHash) return false;
  if (signerUid !== evidence.signerUid) return false;
  if (await sha256Hex(evidence.canonicalPayload) !== evidence.payloadHash) return false;

  let parsed;
  try {
    parsed = JSON.parse(evidence.canonicalPayload);
  } catch {
    return false;
  }
  if (parsed.documentHash !== evidence.documentHash ||
      parsed.signerUid !== evidence.signerUid ||
      parsed.keyId !== evidence.keyId ||
      parsed.envelopeId !== evidence.envelopeId ||
      parsed.signerId !== evidence.signerId) return false;

  return verifyCanonicalPayload(publicKey, evidence.canonicalPayload, evidence.signature);
}

export function buildCryptographicAuditEvent(evidence) {
  if (!evidence?.evidenceId || evidence.status !== "SEALED") {
    throw new Error("Only sealed cryptographic evidence can produce an audit event.");
  }
  return Object.freeze({
    type: "cryptographic.signature.created",
    at: evidence.signedAt,
    evidenceId: evidence.evidenceId,
    signerUid: evidence.signerUid,
    signerId: evidence.signerId,
    envelopeId: evidence.envelopeId,
    documentHash: evidence.documentHash,
    payloadHash: evidence.payloadHash,
    keyId: evidence.keyId,
    algorithm: evidence.algorithm,
  });
}

export function createSignerKeyProvider(records = new Map()) {
  if (typeof records === "function") {
    return Object.freeze({
      async getSignerKey(signerUid) {
        const record = await records(String(signerUid || ""));
        if (!record) throw new Error("No cryptographic signing key is provisioned for this signer.");
        return record;
      },
    });
  }
  return Object.freeze({
    async getSignerKey(signerUid) {
      const record = records.get(String(signerUid || ""));
      if (!record) throw new Error("No cryptographic signing key is provisioned for this signer.");
      return record;
    },
  });
}

export async function sealAndPersist({
  meta,
  storage,
  keyProvider,
  envelope,
  document,
  auditEventAppender,
  statusStore,
} = {}) {
  if (!meta || !storage || !keyProvider) throw new Error("Cryptographic persistence boundary is incomplete.");
  if (!envelope?.id || !document?.id || !document?.bytes) throw new Error("Cryptographic document context is incomplete.");

  const documentHash = await sha256Hex(document.bytes);
  const evidenceIds = [];
  const storedEvidence = [];
  const artifacts = [];
  try {
    for (const signer of envelope.signers || []) {
      const keyRecord = await keyProvider.getSignerKey(signer.uid);
      const evidence = await createCryptographicEvidence({
        keyId: keyRecord.keyId,
        signer: {
          uid: signer.uid,
          signerId: signer.id,
          envelopeId: envelope.id,
          signatureHash: await sha256Hex(String(signer.signatureValue || "")),
          signatureType: signer.signatureType,
          privateKey: keyRecord.privateKey,
          publicKey: keyRecord.publicKey,
        },
        documentHash,
        chainHead: envelope.chainHead,
        signedAt: signer.signedAt,
      });

      const existing = await meta.get("cryptographicEvidence", evidence.evidenceId);
      if (existing) {
        const valid = await verifyCryptographicEvidence(existing, {
          documentHash,
          signerUid: signer.uid,
          publicKey: keyRecord.publicKey,
        });
        if (!valid) throw new Error("Existing cryptographic evidence failed verification.");
        storedEvidence.push(existing);
      } else {
        await meta.create("cryptographicEvidence", evidence.evidenceId, evidence);
        storedEvidence.push(evidence);
      }
      evidenceIds.push(evidence.evidenceId);
      artifacts.push(buildCryptographicAuditEvent(evidence));
    }

    for (const event of artifacts) {
      if (auditEventAppender) await auditEventAppender(event);
    }

    if (statusStore?.set) await statusStore.set("CRYPTOGRAPHICALLY_SEALED");

    return {
      sealed: true,
      documentHash,
      evidenceIds,
      evidence: storedEvidence,
      auditEvents: artifacts,
    };
  } catch (error) {
    if (statusStore?.set) {
      try { await statusStore.set("FULLY_SIGNED"); } catch {}
    }
    for (const evidence of storedEvidence) {
      try {
        await meta.delete("cryptographicEvidence", evidence.evidenceId);
      } catch {}
    }
    throw error;
  }
}
