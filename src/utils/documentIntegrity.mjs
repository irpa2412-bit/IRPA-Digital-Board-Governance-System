/**
 * Shared, dependency-free document integrity policy.
 * Expected values are resolved from the envelope first, then its source document.
 */
export function resolveExpectedIntegrity(envelope = {}, sourceDocument = {}) {
  const hash = envelope.sha256 || envelope.documentHash || envelope.signedDocumentHash || envelope.originalHash ||
    envelope.hash || sourceDocument.sha256 || sourceDocument.documentHash ||
    sourceDocument.originalHash || sourceDocument.hash || null;
  const size = envelope.byteLength ?? envelope.signedDocumentSize ?? envelope.documentSize ?? envelope.originalSize ??
    envelope.fileSize ?? envelope.size ?? sourceDocument.byteLength ??
    sourceDocument.fileSize ?? sourceDocument.size ?? null;
  return {
    hash: hash == null || String(hash).trim() === "" ? null : String(hash).trim().toLowerCase(),
    size: size == null || size === "" || !Number.isFinite(Number(size)) ? null : Number(size)
  };
}

export function inspectDocumentIntegrity(bytes, expected = {}) {
  const actualSize = Number(bytes?.byteLength ?? bytes?.length ?? 0);
  return {
    actualSize,
    expectedHash: expected.hash ?? null,
    expectedSize: expected.size ?? null,
    sizeMismatch: expected.size != null && Number(expected.size) !== actualSize
  };
}

export function hasIntegrityMismatch({ expectedHash, expectedSize, actualHash, actualSize }) {
  return (expectedHash != null && String(expectedHash).toLowerCase() !== String(actualHash).toLowerCase()) ||
    (expectedSize != null && Number(expectedSize) !== Number(actualSize));
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
