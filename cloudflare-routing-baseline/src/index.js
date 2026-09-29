const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const MUTATING_PREFIXES = [
  "/api/document/",
  "/api/signature/",
  "/api/transaction/",
  "/api/audit/",
  "/api/email/"
];

const ROUTES = new Set([
  "/api/document/reference",
  "/api/document/upload",
  "/api/document/save",
  "/api/document/archive",
  "/api/document/classify",
  "/api/document/download",
  "/api/document/restore",
  "/api/signature/prepare",
  "/api/signature/sign",
  "/api/signature/verify",
  "/api/signature/code",
  "/api/signature/certificate",
  "/api/signature/archive",
  "/api/signature/pdf-transfer",
  "/api/transaction/start",
  "/api/transaction/commit",
  "/api/transaction/rollback",
  "/api/transaction/status",
  "/api/audit/event",
  "/api/email/transaction",
  "/api/email/notification"
]);

function id(prefix) {
  return prefix + "-" + crypto.randomUUID();
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra }
  });
}

function errorResponse(status, code, message, requestId, transactionId) {
  return json(status, {
    success: false,
    code,
    transactionId,
    requestId,
    message
  });
}

function isMutation(path, method) {
  return method !== "GET" && MUTATING_PREFIXES.some(prefix => path.startsWith(prefix));
}

function hasBearer(request) {
  return /^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "");
}

function targetUrl(origin, request) {
  const incoming = new URL(request.url);
  const base = new URL(origin.endsWith("/") ? origin : origin + "/");
  const path = incoming.pathname.replace(/^\/+/, "");
  return new URL(path + incoming.search, base);
}

function forwardedHeaders(request, requestId, transactionId) {
  const headers = new Headers(request.headers);
  headers.set("x-irpa-request-id", requestId);
  headers.set("x-irpa-transaction-id", transactionId);
  headers.set("x-irpa-routing-layer", "cloudflare-baseline");
  headers.delete("host");
  headers.delete("content-length");
  return headers;
}

function validatePdfEnvelope(payload) {
  if (!payload || typeof payload !== "object") return "A JSON transaction envelope is required.";
  if (!payload.documentReference) return "documentReference is required.";
  if (!payload.signerIdentity) return "signerIdentity is required.";
  if (!payload.signingAuthority) return "signingAuthority is required.";
  if (!payload.pdfBase64) return "pdfBase64 is required.";
  const raw = String(payload.pdfBase64);
  const compact = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  try {
    const bytes = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    if (header !== "%PDF-") return "The signature transfer payload is not a PDF.";
    if (bytes.length > 25 * 1024 * 1024) return "The signed PDF exceeds the 25 MB baseline limit.";
  } catch {
    return "The signed PDF payload is not valid base64.";
  }
  return null;
}

async function handlePdfTransfer(request, requestId, transactionId) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "INVALID_TRANSACTION_PAYLOAD", "The signature PDF transaction payload is invalid.", requestId, transactionId);
  }
  const validationError = validatePdfEnvelope(payload);
  if (validationError) {
    return errorResponse(400, "INVALID_SIGNATURE_PDF", validationError, requestId, transactionId);
  }
  const compact = String(payload.pdfBase64).startsWith("data:")
    ? String(payload.pdfBase64).slice(String(payload.pdfBase64).indexOf(",") + 1)
    : String(payload.pdfBase64);
  const bytes = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  return json(200, {
    success: true,
    mode: "baseline",
    requestId,
    transactionId,
    documentReference: String(payload.documentReference),
    sha256: hash,
    pdfValidated: true,
    storage: "existing-authoritative-service",
    message: "Signed PDF validated and prepared for controlled routing. Production storage was not migrated."
  });
}

export default {
  async fetch(request, env) {
    const requestId = request.headers.get("x-request-id") || id("req");
    const transactionId = request.headers.get("x-transaction-id") || id("txn");
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(200, {
        ok: true,
        service: "irpa-dbgs-cloudflare-transaction-routing-baseline",
        mode: "routing-only",
        productionMigration: false,
        firebaseAuthenticationAuthoritative: true,
        firestoreAuthoritative: true,
        requestId
      });
    }

    if (!ROUTES.has(url.pathname)) {
      return errorResponse(404, "ROUTE_NOT_FOUND", "The requested IRPA-DBGS transaction route is not configured.", requestId, transactionId);
    }

    if (!hasBearer(request)) {
      return errorResponse(401, "AUTHENTICATION_REQUIRED", "Firebase Authentication is required.", requestId, transactionId);
    }

    if (isMutation(url.pathname, request.method) && request.method === "POST") {
      if (!request.headers.get("idempotency-key")) {
        return errorResponse(400, "IDEMPOTENCY_KEY_REQUIRED", "A transaction idempotency key is required for this operation.", requestId, transactionId);
      }
    }

    if (url.pathname === "/api/signature/pdf-transfer") {
      return handlePdfTransfer(request, requestId, transactionId);
    }

    const origin = String(env.IRPA_FIREBASE_ORIGIN || "").trim().replace(/\/$/, "");
    if (!origin) {
      return errorResponse(503, "ROUTING_ORIGIN_NOT_CONFIGURED", "The Firebase/authoritative routing origin is not configured. No production path was changed.", requestId, transactionId);
    }

    const headers = forwardedHeaders(request, requestId, transactionId);
    const upstream = new Request(targetUrl(origin, request), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });

    try {
      const response = await fetch(upstream);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("x-irpa-request-id", requestId);
      responseHeaders.set("x-irpa-transaction-id", transactionId);
      responseHeaders.set("x-irpa-routing-layer", "cloudflare-baseline");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      console.error("IRPA-DBGS Cloudflare routing failure", {
        requestId,
        transactionId,
        path: url.pathname,
        error: String(error?.message || error)
      });
      return errorResponse(502, "AUTHORITATIVE_SERVICE_UNAVAILABLE", "The authoritative Firebase service could not complete the transaction.", requestId, transactionId);
    }
  }
};
