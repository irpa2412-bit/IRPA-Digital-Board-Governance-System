const ROUTE_PATH = "/api/signature-pathway/emergency-storage";
const PAGE_SIZE = 25;
const MATCH_TERMS = [
  "firestore-emergency://",
  "IRPA-EMG-DOC",
  "IRPA-DOC-2026-MUKF0WMY-DQSQXXO2-9DF470D8",
  "k8M9oVewTBEv5WfgpQU5",
  "fAGDKKhypGGR6F7PRcLe",
  "h3ynycNR7Zqyl9GBoCLk"
];

function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function utf8Size(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function base64Size(value) {
  const normalized = String(value || "").replace(/\s/g, "");
  if (!normalized) return 0;
  try { return atob(normalized).length; } catch { return utf8Size(normalized); }
}

function firestoreValueType(value) {
  if (!value || typeof value !== "object") return "unknown";
  return Object.keys(value).find(key => key.endsWith("Value"))?.replace(/Value$/, "") || "unknown";
}

function inspectFields(fields = {}) {
  const metadata = [];
  let hasBytesField = false;
  let hasBase64Field = false;
  let hasChunksField = false;
  let chunkCount = 0;
  let matched = false;

  function visit(name, value) {
    const type = firestoreValueType(value);
    const fieldName = String(name || "");
    const lowerName = fieldName.toLowerCase();
    if (lowerName.includes("bytes")) hasBytesField = true;
    if (lowerName.includes("base64")) hasBase64Field = true;
    if (lowerName.includes("chunk")) {
      hasChunksField = true;
      const array = value?.arrayValue?.values;
      if (Array.isArray(array)) chunkCount += array.length;
    }
    let sizeBytes = 0;
    if (value && Object.prototype.hasOwnProperty.call(value, "stringValue")) {
      const text = String(value.stringValue || "");
      sizeBytes = utf8Size(text);
      if (MATCH_TERMS.some(term => text.includes(term))) matched = true;
    } else if (value && Object.prototype.hasOwnProperty.call(value, "bytesValue")) {
      sizeBytes = base64Size(value.bytesValue);
    } else if (value && Object.prototype.hasOwnProperty.call(value, "mapValue")) {
      const nested = value.mapValue?.fields || {};
      for (const [childName, childValue] of Object.entries(nested)) visit(fieldName ? fieldName + "." + childName : childName, childValue);
      sizeBytes = utf8Size(JSON.stringify(Object.keys(nested)));
    } else if (value && Object.prototype.hasOwnProperty.call(value, "arrayValue")) {
      const entries = value.arrayValue?.values || [];
      entries.forEach((entry, index) => visit(fieldName + "[" + index + "]", entry));
      sizeBytes = utf8Size(JSON.stringify({ itemCount: entries.length }));
    } else if (value && Object.prototype.hasOwnProperty.call(value, "integerValue")) {
      sizeBytes = utf8Size(value.integerValue);
    } else if (value && Object.prototype.hasOwnProperty.call(value, "doubleValue")) {
      sizeBytes = utf8Size(value.doubleValue);
    } else if (value && Object.prototype.hasOwnProperty.call(value, "booleanValue")) {
      sizeBytes = utf8Size(value.booleanValue);
    } else if (value && Object.prototype.hasOwnProperty.call(value, "timestampValue")) {
      sizeBytes = utf8Size(value.timestampValue);
    }
    metadata.push({ name: fieldName, type, sizeBytes });
  }

  for (const [name, value] of Object.entries(fields || {})) visit(name, value);
  return { matched, fields: metadata, hasBytesField, hasBase64Field, hasChunksField, chunkCount };
}


const AFFECTED_DOCUMENT_IDS = [
  "IRPA-DOC-2026-MUKF0WMY-DQSQXXO2-9DF470D8",
  "k8M9oVewTBEv5WfgpQU5",
  "fAGDKKhypGGR6F7PRcLe",
  "h3ynycNR7Zqyl9GBoCLk"
];

function scalar(fields, names) {
  for (const name of names) {
    const value = fields?.[name];
    if (!value) continue;
    for (const key of ["stringValue", "integerValue", "doubleValue", "booleanValue", "timestampValue"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    }
  }
  return null;
}

function chunkIndex(document, fallback) {
  const fields = document.fields || {};
  const value = scalar(fields, ["index", "chunkIndex", "sequence", "chunkNumber", "part"]);
  if (value !== null && Number.isInteger(Number(value)) && Number(value) >= 0) return Number(value);
  const id = String(document.name || "").split("/").pop();
  const match = id.match(/(?:chunk[-_]?|part[-_]?)(\d+)$/i) || id.match(/(\d+)$/);
  return match ? Number(match[1]) : fallback;
}

function chunkPayload(fields) {
  for (const [name, value] of Object.entries(fields || {})) {
    if (/^(data|bytes|chunk|content|payload|dataBase64|chunkData|contentBase64)$/i.test(name)) {
      if (typeof value?.bytesValue === "string") return Uint8Array.from(atob(value.bytesValue), char => char.charCodeAt(0));
      if (typeof value?.stringValue === "string") {
        if (/base64/i.test(name)) {
          const raw = value.stringValue.replace(/\s/g, "");
          try { return Uint8Array.from(atob(raw), char => char.charCodeAt(0)); } catch { return new Uint8Array(); }
        }
        return new TextEncoder().encode(value.stringValue);
      }
    }
  }
  return new Uint8Array();
}

function pdfPageCount(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page(?!s)\b/g);
  return matches ? matches.length : null;
}

async function inspectBlobRecord(deps, base, token, collectionPath, documentId) {
  const pathParts = String(collectionPath || "").split("/").filter(Boolean);
  if (!pathParts.length || pathParts.length > 8 || pathParts.some(part => !/^[A-Za-z0-9_-]{1,150}$/.test(part))) {
    throw new Error("A valid blob collection path is required.");
  }
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(String(documentId || ""))) throw new Error("A valid blob record ID is required.");
  const parentPath = pathParts.join("/") + "/" + documentId;
  const parentUrl = base + "/" + parentPath.split("/").map(encodeURIComponent).join("/");
  const headers = { Authorization: "Bearer " + token };
  const parent = await firestoreRequest(deps, parentUrl, { method: "GET", headers });
  const parentFields = parent.fields || {};
  const collections = await firestoreRequest(deps, parentUrl + ":listCollectionIds?pageSize=100", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ pageSize: 100 })
  });
  const subcollections = [];
  for (const collectionId of (collections.collectionIds || []).filter(safeCollectionId)) {
    const childUrl = parentUrl + "/" + encodeURIComponent(collectionId) + "?pageSize=1000";
    const childResult = await firestoreRequest(deps, childUrl, { method: "GET", headers });
    if (childResult.nextPageToken) throw new Error("Chunk subcollection exceeds the 1,000-document per-record inspection limit; no partial reconstruction was reported.");
    const documents = childResult.documents || [];
    const indexed = documents.map((doc, position) => ({
      index: chunkIndex(doc, position),
      fields: Object.entries(doc.fields || {}).map(([name, value]) => ({
        name, type: firestoreValueType(value),
        sizeBytes: value?.bytesValue ? base64Size(value.bytesValue) : value?.stringValue ? (/base64/i.test(name) ? base64Size(value.stringValue) : utf8Size(value.stringValue)) : 0
      })),
      payload: chunkPayload(doc.fields || {})
    })).sort((a, b) => a.index - b.index);
    const indexes = indexed.map(item => item.index);
    const contiguous = indexes.length > 0 && indexes.every((value, index) => value === index);
    const totalChunks = scalar(parentFields, ["totalChunks"]);
    const expectedSize = scalar(parentFields, ["fileSize", "size", "byteLength", "expectedSize"]);
    const chunks = indexed.map(item => item.payload);
    const joinedLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const joined = new Uint8Array(joinedLength);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await crypto.subtle.digest("SHA-256", joined);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const header = new TextDecoder("latin1").decode(joined.subarray(0, 5)) === "%PDF-";
    const linkedDocuments = [];
    for (const linkedId of AFFECTED_DOCUMENT_IDS) {
      const linkedUrl = base + "/documents/" + encodeURIComponent(linkedId);
      try {
        const linked = await firestoreRequest(deps, linkedUrl, { method: "GET", headers });
        const reference = scalar(linked.fields || {}, ["emergencyArchiveRef", "emergencyReference", "emergencyStorageRef", "fileId", "storageUri"]);
        const linkedSize = scalar(linked.fields || {}, ["fileSize"]);
        linkedDocuments.push({
          documentReference: linkedId,
          hasBlob: reference !== null && String(reference).includes(documentId),
          emergencyReferencePresent: reference !== null,
          expectedFileSize: linkedSize,
          byteLengthMatches: linkedSize === null ? null : Number(linkedSize) === joinedLength
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        linkedDocuments.push({ documentReference: linkedId, hasBlob: false, recordFound: false });
      }
    }
    subcollections.push({
      collectionId, chunkDocumentCount: documents.length,
      chunks: indexed.map(({ index, fields }) => ({ index, fields })),
      indexesContiguous: contiguous, totalChunksParent: totalChunks,
      totalChunksMatchesActual: totalChunks === null ? null : Number(totalChunks) === documents.length,
      byteLength: joinedLength, startsWithPdfHeader: header,
      mimeTypeImplied: header ? "application/pdf" : "application/octet-stream",
      sha256, pdfPageCount: header ? pdfPageCount(joined) : null,
      expectedParentSize: expectedSize,
      parentSizeMatches: expectedSize === null ? null : Number(expectedSize) === joinedLength,
      linkedDocuments
    });
  }
  return {
    ok: true, collectionPath: pathParts.join("/"), documentId,
    parentFields: Object.entries(parentFields).map(([name, value]) => ({ name, type: firestoreValueType(value) })),
    subcollectionIds: (collections.collectionIds || []).filter(safeCollectionId),
    subcollections
  };
}
\nfunction safeCollectionId(value) {
  const id = String(value || "");
  return /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(id) ? id : "";
}

async function firestoreRequest(deps, url, init) {
  const response = await deps.firestoreFetch(url, init);
  if (!response.ok) {
    const error = new Error("Firestore emergency-storage discovery request failed (HTTP " + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function createEmergencyStorageDiscoveryRoute(deps) {
  return async function emergencyStorageDiscoveryRoute(request, env) {
    if (new URL(request.url).pathname.replace(/\/+$/, "") !== ROUTE_PATH) return null;
    const cors = deps.corsHeaders?.(request) || {};
    if (request.method !== "POST") return json({ ok: false, error: "Use POST for administrator-only emergency-storage discovery." }, 405, cors);

    let claims;
    try {
      claims = await deps.authenticateFirebaseRequest(request, env);
      const uid = String(claims?.user_id || "");
      if (!uid) return json({ ok: false, error: "Authentication required." }, 401, cors);
      const email = String(claims?.email || "").trim().toLowerCase();
      const profile = await deps.getFirestoreDocument(env, "adminProfiles/" + uid, claims.token);
      const admin = email === "irpa2412@gmail.com" ||
        (profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "Administrator");
      if (!admin) return json({ ok: false, error: "Administrator authorization is required." }, 403, cors);
    } catch (error) {
      return json({ ok: false, error: "Administrator authentication failed: " + String(error?.message || error).slice(0, 180) }, 401, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "A valid JSON request is required." }, 400, cors); }
    const action = String(body?.action || "");
    if (!["collections", "scan", "inspectBlob", "audit"].includes(action)) return json({ ok: false, error: "Unsupported emergency-storage discovery action." }, 400, cors);

    try {
      const token = await deps.getFirestoreAdminAccessToken(env);
      const base = "https://firestore.googleapis.com/v1/projects/" + deps.getFirebaseProjectId(env) + "/databases/(default)/documents";
      if (action === "collections") {
        const pageToken = String(body.pageToken || "");
        const url = base + ":listCollectionIds?pageSize=" + PAGE_SIZE + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        const result = await firestoreRequest(deps, url, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) })
        });
        return json({ ok: true, collectionIds: Array.isArray(result.collectionIds) ? result.collectionIds.filter(safeCollectionId) : [], nextPageToken: result.nextPageToken || null }, 200, cors);
      }

      if (action === "inspectBlob") {
        const collectionPath = String(body.collectionPath || "");
        const documentId = String(body.documentId || "");
        const result = await inspectBlobRecord(deps, base, token, collectionPath, documentId);
        return json(result, 200, cors);
      }

      if (action === "scan") {
        const collectionId = safeCollectionId(body.collectionId);
        if (!collectionId) return json({ ok: false, error: "A valid root collection ID is required." }, 400, cors);
        const pageToken = String(body.pageToken || "");
        const url = base + "/" + encodeURIComponent(collectionId) + "?pageSize=" + PAGE_SIZE + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        const result = await firestoreRequest(deps, url, {
          method: "GET",
          headers: { Authorization: "Bearer " + token }
        });
        const hits = [];
        for (const document of Array.isArray(result.documents) ? result.documents : []) {
          const documentId = String(document.name || "").split("/").pop() || "";
          const inspected = inspectFields(document.fields || {});
          if (!inspected.matched && MATCH_TERMS.some(term => documentId.includes(term))) inspected.matched = true;
          if (!inspected.matched) continue;
          hits.push({
            collectionPath: String(document.name || "").split("/documents/")[1]?.split("/").slice(0, -1).join("/") || collectionId,
            documentId,
            fields: inspected.fields,
            hasBytesField: inspected.hasBytesField,
            hasBase64Field: inspected.hasBase64Field,
            hasChunksField: inspected.hasChunksField,
            chunkCount: inspected.chunkCount
          });
        }
        return json({ ok: true, collectionId, hits, nextPageToken: result.nextPageToken || null }, 200, cors);
      }

      const runId = String(body.runId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      if (!runId) return json({ ok: false, error: "A discovery run ID is required for audit." }, 400, cors);
      const hitCount = Math.max(0, Math.min(1000000, Number(body.hitCount) || 0));
      const collectionCount = Math.max(0, Math.min(1000000, Number(body.collectionCount) || 0));
      const completed = body.completed === true;
      const scannedCollectionIds = Array.isArray(body.scannedCollectionIds) ? body.scannedCollectionIds.filter(safeCollectionId).slice(0, 1000) : [];
      const auditId = "emergency-storage-discovery-" + runId;
      const fields = {
        action: { stringValue: "EMERGENCY_STORAGE_DISCOVERY" },
        runId: { stringValue: runId },
        actorUid: { stringValue: String(claims.user_id) },
        actorEmail: { stringValue: String(claims.email || "") },
        hitCount: { integerValue: String(hitCount) },
        collectionCount: { integerValue: String(collectionCount) },
        completed: { booleanValue: completed },
        scannedCollectionIds: { arrayValue: { values: scannedCollectionIds.map(id => ({ stringValue: id })) } },
        createdAt: { timestampValue: new Date().toISOString() }
      };
      const auditUrl = base + ":commit";
      const auditResult = await firestoreRequest(deps, auditUrl, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ writes: [{
          update: { name: base + "/audit/" + auditId, fields },
          currentDocument: { exists: false }
        }] })
      });
      return json({ ok: true, audited: true, auditTime: auditResult.commitTime || fields.createdAt.timestampValue, hitCount, collectionCount }, 200, cors);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || "Emergency-storage discovery failed.").slice(0, 220) }, Number(error?.status) >= 400 && Number(error?.status) < 600 ? error.status : 502, cors);
    }
  };
}
