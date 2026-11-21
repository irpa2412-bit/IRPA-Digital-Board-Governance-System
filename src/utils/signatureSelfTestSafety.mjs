export const SELF_TEST_RUN_LIMIT = 20;
export const SELF_TEST_DOCUMENT_TIMEOUT_MS = 15000;
export const SELF_TEST_TOTAL_TIMEOUT_MS = 60000;
export const SELF_TEST_TEXT_LIMIT = 500;

export function safeGatewayText(value, fallback = "Gateway request failed.") {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, SELF_TEST_TEXT_LIMIT)
    : fallback;
}

export function validateSelfTestGatewayResponse(data, { kind = "generic", httpStatus = 200 } = {}) {
  if (httpStatus === 403) throw Object.assign(new Error("Gateway denied this diagnostic request (HTTP 403)."), { httpStatus });
  if (httpStatus < 200 || httpStatus >= 300) throw Object.assign(new Error("Gateway request failed (HTTP " + httpStatus + ")."), { httpStatus });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Gateway returned an invalid response object.");
  if (data.ok === false) throw new Error(safeGatewayText(data.error));
  if (kind === "reconcile") {
    if (!Array.isArray(data.results) || !data.results[0] || typeof data.results[0] !== "object" || Array.isArray(data.results[0])) {
      throw new Error("Gateway returned no valid result for this document.");
    }
    return { ...data, results: [{ ...data.results[0], title: safeGatewayText(data.results[0].title, ""), reason: safeGatewayText(data.results[0].reason, "") }] };
  }
  if (kind === "download" && (typeof data.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))) {
    throw new Error("Gateway returned invalid controlled-document content.");
  }
  return data;
}

export function takeSelfTestBatch(documents, offset = 0, limit = SELF_TEST_RUN_LIMIT) {
  if (!Array.isArray(documents)) throw new TypeError("Self-test document queue must be an array.");
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.min(SELF_TEST_RUN_LIMIT, Math.max(1, Math.floor(Number(limit) || SELF_TEST_RUN_LIMIT)));
  return documents.slice(start, start + size);
}
