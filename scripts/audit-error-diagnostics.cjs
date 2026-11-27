"use strict";

const SENSITIVE_FIELDS = new Set([
  "id", "uid", "userid", "authuid", "accountid", "documentid",
  "email", "clientemail", "displayname", "name", "firstname",
  "middlename", "lastname", "fullname", "givenname", "familyname",
  "surname", "preferredname", "membername", "signername", "ownername",
  "createdbyname", "updatedbyname", "phonenumber", "mobile", "telephone"
]);

const ACCOUNT_COLLECTIONS = [
  "members", "invitations", "adminProfiles", "employees",
  "auditorProfiles", "signatureProfiles", "signerIdentities", "users"
];

function normalizeKey(value) {
  return String(value || "").replace(/[_-]/g, "").toLowerCase();
}

function escapeRegExp(value) {
  const special = "\\^$.*+?()[]{}|";
  return value.split("").map(character =>
    special.includes(character) ? "\\" + character : character
  ).join("");
}

function createAuditErrorDiagnostics() {
  const sensitiveValues = new Set();

  function registerSensitiveValue(value) {
    if (value === undefined || value === null || typeof value === "object") return;
    const normalized = String(value).trim();
    if (normalized) sensitiveValues.add(normalized);
  }

  function registerIdentity(value) {
    const visited = new WeakSet();

    function visit(node, key) {
      if (node === null || node === undefined || typeof node !== "object") {
        if (SENSITIVE_FIELDS.has(normalizeKey(key))) registerSensitiveValue(node);
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        for (const item of node) visit(item, key);
        return;
      }
      for (const [childKey, childValue] of Object.entries(node)) {
        visit(childValue, childKey);
      }
    }

    visit(value, "");
  }

  function redactDiagnostic(value) {
    let output = String(value === undefined || value === null ? "" : value);

    for (const sensitive of [...sensitiveValues].sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(
        "(^|[^A-Za-z0-9_])" + escapeRegExp(sensitive) + "(?=$|[^A-Za-z0-9_])",
        "gi"
      );
      output = output.replace(pattern, "$1[REDACTED]");
    }

    for (const collection of ACCOUNT_COLLECTIONS) {
      const pathPattern = new RegExp("\\b" + collection + "/[^/\\s?#\"'),]+", "gi");
      output = output.replace(pathPattern, collection + "/[REDACTED_ID]");
    }

    output = output
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
      .replace(
        /\b(uid|user_?id|auth_?uid|account_?id|document_?id|email)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
        "$1=[REDACTED]"
      )
      .replace(
        /\b(display_?name|first_?name|middle_?name|last_?name|full_?name|given_?name|family_?name|member_?name|signer_?name)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
        "$1=[REDACTED]"
      )
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[REDACTED_ID]")
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(
        /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
        "$1[REDACTED]$2"
      );

    return output;
  }

  function safeLabel(value, fallback) {
    const redacted = redactDiagnostic(value || fallback);
    const label = redacted.replace(/[^A-Z0-9_:/.-]/gi, "_").slice(0, 100);
    return label || fallback;
  }

  function formatFailure(error) {
    const errorObject = error && (typeof error === "object" || typeof error === "function")
      ? error
      : null;
    const name = safeLabel(errorObject && errorObject.name, "Error");
    const code = safeLabel(errorObject && errorObject.code, name || "UNCLASSIFIED");
    const rawMessage = errorObject && errorObject.message !== undefined
      ? errorObject.message
      : String(error);
    const message = redactDiagnostic(rawMessage) || "[No error message provided]";
    const rawStack = errorObject && typeof errorObject.stack === "string"
      ? errorObject.stack
      : name + ": " + message;
    const stackParts = [rawStack];
    let cause = errorObject && errorObject.cause;
    const seen = new Set(errorObject ? [errorObject] : []);
    while (cause && !seen.has(cause)) {
      seen.add(cause);
      const causeStack = cause && typeof cause.stack === "string"
        ? cause.stack
        : cause && cause.message !== undefined
          ? String(cause.message)
          : String(cause);
      stackParts.push("Caused by: " + causeStack);
      cause = cause && cause.cause;
    }
    return {
      name,
      code,
      message,
      stack: redactDiagnostic(stackParts.join("\n"))
    };
  }

  return {
    registerSensitiveValue,
    registerIdentity,
    redactDiagnostic,
    formatFailure
  };
}

module.exports = { createAuditErrorDiagnostics };
