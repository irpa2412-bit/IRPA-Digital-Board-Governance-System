import { PDFDocument } from "pdf-lib";

const text = value => value == null || value === "" ? "(not recorded)" : String(value);
const bytesOf = value => value instanceof Uint8Array ? value : new Uint8Array(value || []);
const reasonOf = error => {
  const status = Number(error?.httpStatus || error?.status || 0);
  const reason = String(error?.driveReason || error?.reason || error?.code || "").toLowerCase();
  const message = String(error?.message || "");
  if (status === 404 || /notfound|file not found/i.test(reason + " " + message)) return "notFound";
  if (/quota|ratelimitexceeded|userratelimitexceeded/i.test(reason + " " + message)) return "quota";
  if (status === 429 || /ratelimit|rate limit/i.test(reason + " " + message)) return "rate limit";
  if (status === 408 || status >= 500 || /timeout|timed out|temporar/i.test(message)) return "timeout";
  if (status === 403 || /forbidden|insufficientfilepermissions|permission/i.test(reason + " " + message)) return "forbidden";
  return reason || "unknown";
};
const transient = error => [408,429,500,502,503,504].includes(Number(error?.httpStatus || error?.status)) || /quota|rate.?limit|timeout|temporar/i.test(reasonOf(error) + " " + String(error?.message || ""));
async function retry(operation, attempts = 4) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return { value: await operation(), attempts: attempt }; }
    catch (error) { last = error; if (!transient(error) || attempt === attempts) break; }
  }
  throw last;
}
function classifyFailure(step, error, metadata = {}) {
  const status = Number(error?.httpStatus || error?.status || 0) || null;
  const reason = reasonOf(error);
  let classification = "UNKNOWN";
  if (status === 404 || metadata.trashed === true || reason === "notFound") classification = "FILE_MISSING";
  else if (/quota|ratelimit|rate limit|timeout/i.test(reason + " " + String(error?.message || "")) || transient(error)) classification = "TRANSIENT";
  else if (status === 403 || reason === "forbidden") classification = "NO_ACCESS";
  return { classification, step, httpStatus: status, driveErrorReason: reason, error: String(error?.message || "Unknown Drive error") };
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
export async function diagnoseControlledDocument({ item, record = {}, getMetadata, downloadBytes, maxAttempts = 4 }) {
  const diagnostic = {
    title: text(item?.title || record.title || record.fileName || item?.documentId),
    documentId: text(item?.documentId),
    fileId: text(item?.fileId),
    step: "Drive metadata call",
    httpStatus: null,
    driveErrorReason: "(none)",
    mimeType: "(not returned)",
    driveSize: null,
    storedSize: record.size ?? record.fileSize ?? record.fileSizeBytes ?? record.uploadedSize ?? null,
    storedSha256: record.sha256 || record.checksumSha256 || record.fileSha256 || record.contentHash || null,
    computedSha256: null,
    trashed: null,
    parents: [],
    createdTime: null,
    uploadedBy: record.uploadedBy || record.uploadedByEmail || record.uploadedByUid || record.createdByEmail || record.createdByUid || record.createdBy || null,
    uploadedAt: record.uploadedAt || record.createdAt || record.createdDate || null,
    storedPageCount: record.pageCount ?? record.pages ?? record.pdfPageCount ?? null,
    pdfParses: null,
    pdfPageCount: null,
    attempts: 0
  };
  let metadata;
  try {
    const result = await retry(() => getMetadata(item.fileId), maxAttempts);
    metadata = result.value;
    diagnostic.attempts += result.attempts;
    diagnostic.httpStatus = 200;
    diagnostic.mimeType = metadata.mimeType || "(not returned)";
    diagnostic.driveSize = metadata.size == null ? null : Number(metadata.size);
    diagnostic.trashed = Boolean(metadata.trashed);
    diagnostic.parents = Array.isArray(metadata.parents) ? metadata.parents : [];
    diagnostic.createdTime = metadata.createdTime || null;
    if (metadata.trashed) return { ...diagnostic, classification: "FILE_MISSING", step: "Drive metadata call", driveErrorReason: "trashed", reason: "Drive metadata reports trashed=true." };
  } catch (error) {
    const failure = classifyFailure("Drive metadata call", error);
    diagnostic.attempts = maxAttempts && transient(error) ? maxAttempts : 1;
    return { ...diagnostic, ...failure, reason: failure.error };
  }
  if (!item?.fileId) return { ...diagnostic, classification: "FILE_MISSING", step: "Drive metadata call", driveErrorReason: "notFound", reason: "No Drive file ID is registered on the Firestore document." };
  let bytes;
  diagnostic.step = "Content download";
  try {
    const result = await retry(() => downloadBytes(item.fileId), maxAttempts);
    bytes = bytesOf(result.value);
    diagnostic.attempts += result.attempts;
    diagnostic.httpStatus = 200;
  } catch (error) {
    const failure = classifyFailure("Content download", error, metadata);
    diagnostic.attempts += maxAttempts && transient(error) ? maxAttempts : 1;
    return { ...diagnostic, ...failure, mimeType: metadata.mimeType || diagnostic.mimeType, driveSize: metadata.size == null ? null : Number(metadata.size), trashed: Boolean(metadata.trashed), parents: metadata.parents || [], createdTime: metadata.createdTime || null, reason: failure.error };
  }
  diagnostic.step = "Hash check";
  diagnostic.computedSha256 = await sha256(bytes);
  const storedHash = String(diagnostic.storedSha256 || "").trim().toLowerCase();
  const storedSize = Number(diagnostic.storedSize);
  const driveSize = Number(metadata.size);
  const hashMismatch = Boolean(storedHash && storedHash !== diagnostic.computedSha256);
  const sizeMismatch = Number.isFinite(storedSize) && storedSize > 0 && storedSize !== bytes.byteLength || Number.isFinite(driveSize) && driveSize >= 0 && driveSize !== bytes.byteLength;
  let pdfError = null;
  if (String(metadata.mimeType || "").toLowerCase() !== "application/pdf" || !bytesOf(bytes).slice(0, 5).every((v, i) => v === [0x25,0x50,0x44,0x46,0x2d][i])) {
    diagnostic.classification = "NOT_A_PDF";
    diagnostic.step = "PDF parse";
    diagnostic.reason = "Drive mimeType is " + text(metadata.mimeType) + " and downloaded bytes do not begin with the PDF signature.";
    return diagnostic;
  }
  diagnostic.step = "PDF parse";
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    diagnostic.pdfParses = true;
    diagnostic.pdfPageCount = pdf.getPageCount();
  } catch (error) {
    pdfError = error;
    diagnostic.pdfParses = false;
    diagnostic.pdfParseError = String(error?.message || error);
  }
  if (hashMismatch) {
    diagnostic.classification = "HASH_MISMATCH";
    diagnostic.step = "Hash check";
    diagnostic.reason = "Downloaded SHA-256 differs from the SHA-256 recorded at upload.";
  } else if (sizeMismatch) {
    diagnostic.classification = "SIZE_MISMATCH";
    diagnostic.step = "Size check";
    diagnostic.reason = "Downloaded byte count does not match Drive metadata size or the size recorded at upload.";
  } else if (pdfError) {
    diagnostic.classification = "PDF_PARSE_FAILED";
    diagnostic.reason = "Downloaded bytes are identified as PDF but PDF parsing failed: " + diagnostic.pdfParseError;
  } else {
    diagnostic.classification = "OK";
    diagnostic.reason = "Drive metadata, downloaded bytes, stored size/hash and PDF parsing checks passed.";
  }
  diagnostic.pageCountComparison = diagnostic.classification === "HASH_MISMATCH" || diagnostic.classification === "SIZE_MISMATCH"
    ? "PDF parses: " + (diagnostic.pdfParses ? "yes" : "no") + "; pages: " + text(diagnostic.pdfPageCount) + "; stored at upload: " + text(diagnostic.storedPageCount)
    : null;
  return diagnostic;
}
