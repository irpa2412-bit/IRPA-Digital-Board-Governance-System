const MAX_TEXT = 240;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function shortText(value, max = MAX_TEXT) {
  if (typeof value !== "string") return "";
  return value.replace(/[\\u0000-\\u001f\\u007f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, max);
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function validateSelfTestGatewayResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_RESPONSE");
  if (value.ok !== true) fail("GATEWAY_REJECTED");
  if (!Array.isArray(value.results) || value.results.length !== 1) fail("INVALID_RESULTS");
  const raw = value.results[0];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_RESULT");
  const result = {
    classification: shortText(raw.classification, 80) || "UNKNOWN",
    status: shortText(raw.status, 40) || "unreadable",
    step: shortText(raw.step, 80),
    httpStatus: Number.isInteger(raw.httpStatus) ? raw.httpStatus : null,
    driveErrorReason: shortText(raw.driveErrorReason, 120),
    mimeType: shortText(raw.mimeType, 100),
    driveSize: Number.isFinite(raw.driveSize) ? Math.max(0, raw.driveSize) : null,
    storedSize: Number.isFinite(raw.storedSize) ? Math.max(0, raw.storedSize) : null,
    storedSha256: shortText(raw.storedSha256, 80),
    computedSha256: shortText(raw.computedSha256, 80),
    trashed: typeof raw.trashed === "boolean" ? raw.trashed : null,
    parents: Array.isArray(raw.parents) ? raw.parents.slice(0, 10).map(item => shortText(item, 100)) : [],
    createdTime: shortText(raw.createdTime, 80),
    uploadedBy: shortText(raw.uploadedBy, 100),
    uploadedAt: shortText(raw.uploadedAt, 80),
    pdfParses: typeof raw.pdfParses === "boolean" ? raw.pdfParses : null,
    pdfPageCount: Number.isInteger(raw.pdfPageCount) ? Math.max(0, raw.pdfPageCount) : null,
    storedPageCount: Number.isInteger(raw.storedPageCount) ? Math.max(0, raw.storedPageCount) : null,
    pageCountComparison: shortText(raw.pageCountComparison, 160),
    reason: shortText(raw.reason, 500),
    fileId: shortText(raw.fileId, 180),
    title: shortText(raw.title, 180),
    previousDescriptionDocumentId: shortText(raw.previousDescriptionDocumentId, 120)
  };
  return result;
}

export function validateSelfTestDownloadResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_DOWNLOAD_RESPONSE");
  if (value.ok !== true || typeof value.base64 !== "string" || !value.base64.length) fail("INVALID_PDF_CONTENT");
  if (value.base64.length > Math.ceil(MAX_PDF_BYTES * 4 / 3)) fail("PDF_TOO_LARGE");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) fail("INVALID_PDF_ENCODING");
  return value.base64;
}

export function selfTestFailureCode(error) {
  const status = Number(error?.httpStatus || error?.status);
  if (status === 403) return "GATEWAY_FORBIDDEN";
  if (status === 401) return "AUTH_REQUIRED";
  if (error?.name === "AbortError" || error?.code === "TIMEOUT" || error?.code === "DOCUMENT_TIMEOUT") return "TIMEOUT";
  const code = shortText(error?.code || error?.stageCode || "", 40);
  return /^[A-Z0-9_]+$/.test(code) ? code : "SELF_TEST_FAILED";
}
