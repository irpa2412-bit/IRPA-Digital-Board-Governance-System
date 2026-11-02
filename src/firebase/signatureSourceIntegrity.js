function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || []);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve integrity metadata from the controlled-document record.
 * Legacy records are backfilled in-memory from source bytes when a Drive file
 * identifier is available. Missing optional integrity metadata never blocks
 * signer assignment; the envelope stores null until bytes can be verified.
 */
export async function resolveSourceDocumentIntegrity(
  sourceDocumentData,
  documentUrl,
  documentId,
  downloadBytes
) {
  const record = sourceDocumentData && typeof sourceDocumentData === "object"
    ? sourceDocumentData
    : {};
  let sourceSha256 = record.sha256 || record.hash || null;
  let sourceByteLength = record.fileSize ?? record.byteLength ?? record.size ?? null;
  const sourceFileId = record.fileId || record.driveFileId || record.archiveFileId ||
    record.sourceFileId || (String(documentUrl || "").startsWith("drive://")
      ? String(documentUrl).slice(8)
      : "");

  if ((!sourceSha256 || sourceByteLength == null) && sourceFileId && typeof downloadBytes === "function") {
    try {
      const sourceBytes = toBytes(await downloadBytes(sourceFileId, documentId));
      const actualHash = await sha256(sourceBytes);
      if (sourceSha256 && String(sourceSha256).toLowerCase() !== actualHash) {
        throw new Error("The source document SHA-256 does not match its registered integrity metadata.");
      }
      if (sourceByteLength != null && Number(sourceByteLength) !== sourceBytes.byteLength) {
        throw new Error("The source document byte length does not match its registered integrity metadata.");
      }
      sourceSha256 = sourceSha256 || actualHash;
      sourceByteLength = sourceByteLength ?? sourceBytes.byteLength;
    } catch (error) {
      if (/does not match its registered integrity metadata/.test(error?.message || "")) throw error;
      // Integrity metadata is supplementary during signer assignment. A
      // temporarily unavailable legacy download must not block Add Signer.
    }
  }

  return {
    sha256: sourceSha256 ? String(sourceSha256).toLowerCase() : null,
    byteLength: sourceByteLength == null ? null : Number(sourceByteLength)
  };
}
