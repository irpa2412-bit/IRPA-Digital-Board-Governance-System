import React, { useRef, useState } from "react";
import { SELF_TEST_RUN_LIMIT, SELF_TEST_DOCUMENT_TIMEOUT_MS, SELF_TEST_TOTAL_TIMEOUT_MS, safeGatewayText, validateSelfTestGatewayResponse, takeSelfTestBatch } from "../utils/signatureSelfTestSafety.mjs";
import { getIdToken } from "firebase/auth";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";
import { collection as firestoreCollection, doc, getDoc as firestoreGetDoc, getDocs as firestoreGetDocs } from "firebase/firestore";
import { runSignatureFirestore } from "../firebase/signatureFirestoreDiagnostics.js";
import { auth, db } from "../firebase/config";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { renderPdfPageToCanvas, describePdfPageError } from "../utils/pdfPageRendering.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const collection=(...args)=>runSignatureFirestore({operation:"collection",collectionPath:String(args[1]||"unknown"),screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreCollection(...args));
const getDoc=ref=>runSignatureFirestore({operation:"getDoc",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDoc(ref));
const getDocs=ref=>runSignatureFirestore({operation:"getDocs",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDocs(ref));


async function selfTestGatewayPost(path, payload, { signal, kind = "generic" } = {}) {
  const gateway = getGoogleDriveGatewayUrl();
  if (!gateway) throw new Error("Google Drive gateway is not configured.");
  if (!auth.currentUser) throw new Error("Authentication is required.");
  const token = await getIdToken(auth.currentUser);
  const response = await fetch(gateway + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal
  });
  const data = await response.json().catch(() => null);
  return validateSelfTestGatewayResponse(data, { kind, httpStatus: response.status });
}

async function selfTestReconcileDocument(document, options = {}) {
  return selfTestGatewayPost("/api/signature-pathway/reconcile", {
    documents: [{
      documentId: String(document.documentId || document.id || ""),
      fileId: String(document.fileId || document.driveFileId || document.archiveFileId || document.governanceArchiveFileId || document.sourceFileId || "")
    }]
  }, { ...options, kind: "reconcile" });
}

async function selfTestDownloadControlledDocument(fileId, documentId, options = {}) {
  if (!fileId || !documentId) throw new Error("Controlled document file ID or canonical Firestore document ID is missing.");
  const result = await selfTestGatewayPost("/api/download", { fileId, documentId }, { ...options, kind: "download" });
  if (!result.base64) throw new Error("Google Drive returned no controlled document content.");
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function driveFileId(record = {}) {
  return String(record.fileId || record.driveFileId || record.sourceFileId || record.archiveFileId || record.governanceArchiveFileId || record.primaryArchiveFileId || "").trim();
}

export function classifySelfTestRecord(item = {}) {
  return String(item.documentId || item.id || "").startsWith("communicationWebsiteEdits")
    ? "NON_FILE_RECORD"
    : "CONTROLLED_DOCUMENT";
}

export function summarizeSelfTestResults(rows = []) {
  const nonFileRecords = rows.filter(row => row.classification === "NON_FILE_RECORD").length;
  const documents = rows.filter(row => row.classification !== "NON_FILE_RECORD");
  const documentsUnreadable = documents.filter(row => row.checks?.some(check => check.status === "FAIL")).length;
  return {
    documentsReadable: documents.length - documentsUnreadable,
    documentsUnreadable,
    nonFileRecords
  };
}

function diagnosticRow(item, result) {
  if (classifySelfTestRecord(item) === "NON_FILE_RECORD") {
    return {
      documentId: item.documentId,
      title: item.title || item.fileName || item.reference || item.documentId,
      classification: "NON_FILE_RECORD",
      status: "NOT A DOCUMENT",
      checks: [],
      diagnostic: null
    };
  }
  const detail = [
    "Classification: " + (result.classification || result.status || "UNKNOWN"),
    "Exact failing step: " + (result.step || "(none)"),
    "HTTP status: " + (result.httpStatus ?? "(none)"),
    "Drive error reason: " + (result.driveErrorReason || "(none)"),
    "Drive mimeType: " + (result.mimeType || "(not returned)"),
    "Drive size: " + (result.driveSize ?? "(not returned)") + " bytes; stored size: " + (result.storedSize ?? "(not recorded)") + " bytes",
    "Stored SHA-256: " + (result.storedSha256 || "(not recorded)"),
    "Computed SHA-256: " + (result.computedSha256 || "(not computed)"),
    "Trashed: " + (result.trashed == null ? "(not returned)" : String(result.trashed)),
    "Parents: " + (Array.isArray(result.parents) ? result.parents.join(", ") : "(not returned)"),
    "Drive created: " + (result.createdTime || "(not returned)"),
    "Uploaded by: " + (result.uploadedBy || "(not recorded)"),
    "Uploaded at: " + (result.uploadedAt || "(not recorded)"),
    "PDF parses: " + (result.pdfParses == null ? "(not checked)" : String(result.pdfParses)),
    "PDF pages: " + (result.pdfPageCount ?? "(not parsed)") + "; stored page count: " + (result.storedPageCount ?? "(not recorded)"),
    result.pageCountComparison || "",
    "PDF page check: " + (result.pdfPageCheck?.status || "NOT RUN"),
    "PDF page count: " + (result.pdfPageCheck?.pageCount ?? "(not parsed)"),
    ...(result.pdfPageCheck?.pages || []).map(page => "Page " + page.pageNumber + ": " + page.textCharacters + " text characters; non-blank pixel ratio " + (page.nonBlankPixelRatio ?? "unavailable") + "; render " + (page.rendered ? "PASS" : "FAIL") + (page.error ? "; error " + page.error.name + ": " + page.error.message : "")),
    "Page check note: " + (result.pdfPageCheck?.pageCheckNote || result.pdfPageCheck?.lastPageFlag || "NOT RUN"),
    "Drive description.documentId: " + (result.previousDescriptionDocumentId || "(not checked)"),
    "Reason: " + (result.reason || "(no reason returned)")
  ].filter(Boolean).join("\n");
  return {
    documentId: item.documentId,
    title: result.title || item.title || item.fileName || item.reference || item.documentId,
    checks: [{
      name: (result.status || "unreadable") + " · " + (result.fileId || driveFileId(item) || "no file ID"),
      status: result.status === "match" ? "PASS" : result.status === "mismatch" ? "NEEDS REVIEW" : "FAIL",
      reason: "Firestore ID: " + item.documentId + "; file ID: " + (result.fileId || driveFileId(item) || "(none)") + "\n" + detail
    }, {
      name: "PDF page check",
      status: result.pdfPageCheck?.status === "PASS" ? "PASS" : "FAIL",
      reason: result.pdfPageCheck ? "Page count: " + result.pdfPageCheck.pageCount + "\n" + (result.pdfPageCheck.pages || []).map(page => "Page " + page.pageNumber + ": " + page.textCharacters + " text characters; non-blank pixel ratio " + (page.nonBlankPixelRatio ?? "unavailable") + "; " + (page.rendered ? "render PASS" : "render FAIL") + (page.error ? " — " + page.error.name + ": " + page.error.message : "")).join("\n") + "\nLast page: " + result.pdfPageCheck.lastPageFlag : "PDF page check did not complete."
    }],
    diagnostic: result
  };
}

function SignaturePathwaySelfTestPanel() {
  const cancelController = useRef(null);
  const [busy, setBusy] = useState(false);
  const [documentQueue, setDocumentQueue] = useState([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [message, setMessage] = useState("Ready. Run the test to inspect registered controlled documents.");
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState("");
  const [discovery, setDiscovery] = useState(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [driveHealth, setDriveHealth] = useState({ statusClass: "not_run", classification: "not_run" });

  async function requireAdministrator() {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("STEP administrator check failed: sign in first.");
    if (String(user.email || "").trim().toLowerCase() === "irpa2412@gmail.com") return;
    const admin = await getDoc(doc(db, "adminProfiles", user.uid));
    if (!admin.exists() || admin.data()?.active !== true) throw new Error("STEP administrator check failed: active administrator access is required.");
  }

  async function emergencyStorageRequest(payload) {
    const gateway = getGoogleDriveGatewayUrl();
    if (!gateway) throw new Error("Google Drive gateway is not configured.");
    if (!auth.currentUser) throw new Error("Authentication is required.");
    const token = await getIdToken(auth.currentUser);
    const response = await fetch(gateway + "/api/signature-pathway/emergency-storage", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      redirect: "error"
    });
    const data = await response.json().catch(() => null);
    const validated = validateSelfTestGatewayResponse(data, { httpStatus: response.status });
    if (validated.ok !== true) throw new Error(safeGatewayText(validated.error, "Emergency-storage discovery request failed."));
    return validated;
  }

  async function findEmergencyStorage() {
    setDiscoveryBusy(true);
    setDiscovery(null);
    setDiscoveryError("");
    setDiscoveryProgress("Listing root Firestore collections…");
    const runId = window.crypto?.randomUUID ? window.crypto.randomUUID() : "emergency-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const scannedCollectionIds = [];
    const hits = [];
    let authorized = false;
    let completed = false;
    let auditTime = null;
    let blobInspections = [];
    try {
      await requireAdministrator();
      authorized = true;
      const collectionIds = [];
      let rootCursor = null;
      do {
        const page = await emergencyStorageRequest({ action: "collections", pageToken: rootCursor });
        collectionIds.push(...(page.collectionIds || []));
        rootCursor = page.nextPageToken || null;
      } while (rootCursor);
      const uniqueCollectionIds = [...new Set(collectionIds)];
      for (let index = 0; index < uniqueCollectionIds.length; index += 1) {
        const collectionId = uniqueCollectionIds[index];
        setDiscoveryProgress("Collection " + (index + 1) + " of " + uniqueCollectionIds.length + ": " + collectionId);
        let cursor = null;
        do {
          const page = await emergencyStorageRequest({ action: "scan", collectionId, pageToken: cursor });
          hits.push(...(page.hits || []));
          cursor = page.nextPageToken || null;
        } while (cursor);
        scannedCollectionIds.push(collectionId);
      }
      for (let index = 0; index < hits.length; index += 1) {
        const hit = hits[index];
        setDiscoveryProgress("Record " + (index + 1) + " of " + hits.length + ": inspecting one emergency blob");
        const detail = await emergencyStorageRequest({ action: "inspectBlob", collectionPath: hit.collectionPath, documentId: hit.documentId });
        blobInspections.push(detail);
      }
      completed = true;
      setDiscoveryProgress("Record " + hits.length + " of " + hits.length + " inspected.");
    } catch (error) {
      setDiscoveryError(error?.message || "Emergency-storage discovery failed.");
    } finally {
      if (authorized) {
        try {
          const audit = await emergencyStorageRequest({
            action: "audit", runId, hitCount: hits.length,
            collectionCount: scannedCollectionIds.length, scannedCollectionIds, completed
          });
          auditTime = audit.auditTime || null;
        } catch (error) {
          setDiscoveryError(previous => [previous, "Audit event could not be confirmed: " + (error?.message || "unknown error")].filter(Boolean).join(" "));
        }
      }
      setDiscovery({ hits, scannedCollectionIds, collectionCount: scannedCollectionIds.length, auditTime, completed, blobInspections });
      setDiscoveryProgress(completed
        ? "Discovery complete. " + scannedCollectionIds.length + " collections scanned; " + hits.length + " hit(s)."
        : "Scan incomplete. " + scannedCollectionIds.length + " collection(s) completed; no negative conclusion can be drawn.");
      setDiscoveryBusy(false);
    }
  }

  function copyEmergencyStorageReport() {
    if (!discovery) return;
    const lines = discovery.hits.length
      ? discovery.hits.map(hit => [
          "Collection path: " + hit.collectionPath,
          "Document ID: " + hit.documentId,
          "Fields: " + hit.fields.map(field => field.name + " (" + field.type + ", " + field.sizeBytes + " bytes)").join("; "),
          "Bytes field: " + (hit.hasBytesField ? "yes" : "no"),
          "Base64 field: " + (hit.hasBase64Field ? "yes" : "no"),
          "Chunks field: " + (hit.hasChunksField ? "yes" : "no"),
          "Chunk count: " + hit.chunkCount
        ].join("\n")).join("\n\n") + "\n\nBlob measurements: " + JSON.stringify(discovery.blobInspections || [])
      : (discovery.completed ? "no emergency storage found in " + discovery.collectionCount + " collections scanned" : "Scan incomplete; no conclusion about emergency storage can be drawn") + "\nCollections scanned: " + discovery.scannedCollectionIds.join(", ");
    const report = "Emergency storage discovery report\n" + lines + "\n\nAudit time: " + (discovery.auditTime || "not returned");
    navigator.clipboard.writeText(report).then(() => setDiscoveryProgress("Emergency-storage report copied to clipboard.")).catch(error => setDiscoveryError("Copy failed: " + (error?.message || "Clipboard access unavailable.")));
  }

  async function checkDriveHealth() {
    setDriveHealth({ statusClass: "checking", classification: "checking" });
    try {
      await requireAdministrator();
      const gateway = getGoogleDriveGatewayUrl();
      if (!gateway || !auth.currentUser) throw new Error("Gateway unavailable");
      const token = await getIdToken(auth.currentUser);
      const response = await fetch(gateway + "/api/signature-pathway/drive-health", {
        method: "GET",
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
        redirect: "error"
      });
      const data = validateSelfTestGatewayResponse(await response.json().catch(() => null), { httpStatus: response.status });
      setDriveHealth({
        statusClass: safeGatewayText(data.statusClass || "ok", "error"),
        classification: safeGatewayText(data.classification || "unknown", "unknown")
      });
    } catch {
      setDriveHealth({ statusClass: "error", classification: "gateway_redirect_blocked_or_network_or_authentication" });
    }
  }

  async function reconcile({ startNew = false } = {}) {
    if (busy) return;
    const controller = new AbortController();
    cancelController.current = controller;
    setBusy(true);
    setMessage("Read-only diagnostic: one document at a time; maximum 20 documents in this run.");
    const startedAt = Date.now();
    const totalTimeout = setTimeout(() => controller.abort(), SELF_TEST_TOTAL_TIMEOUT_MS);
    try {
      let rows = documentQueue;
      if (startNew || !rows.length) {
        await requireAdministrator();
        const snapshot = await getDocs(collection(db, "documents"));
        rows = snapshot.docs.map(item => ({ documentId: item.id, ...item.data() }));
        setDocumentQueue(rows);
        setResults(rows.filter(item => classifySelfTestRecord(item) === "NON_FILE_RECORD").map(item => diagnosticRow(item, null)));
        setNextOffset(0);
      }
      const documentRows = rows.filter(item => classifySelfTestRecord(item) !== "NON_FILE_RECORD");
      const offset = startNew ? 0 : nextOffset;
      const batch = takeSelfTestBatch(documentRows, offset, SELF_TEST_RUN_LIMIT);
      setProgress({ completed: 0, total: batch.length, active: 0 });
      const diagnostics = [];
      for (let index = 0; index < batch.length; index += 1) {
        if (controller.signal.aborted) throw new Error("Diagnostic cancelled.");
        if (Date.now() - startedAt >= SELF_TEST_TOTAL_TIMEOUT_MS) throw new Error("Diagnostic stopped at the 60-second run limit. Select Run next 20 to continue.");
        const item = batch[index];
        setProgress({ completed: index, total: batch.length, active: 1 });
        const documentController = new AbortController();
        const abortOnCancel = () => documentController.abort();
        controller.signal.addEventListener("abort", abortOnCancel, { once: true });
        const timeout = setTimeout(() => documentController.abort(), SELF_TEST_DOCUMENT_TIMEOUT_MS);
        let diagnostic;
        let pdf = null;
        let pdfLoadingTask = null;
        let bytes = null;
        try {
          const work = (async () => {
            const response = await selfTestReconcileDocument(item, { signal: documentController.signal });
            const result = response.results[0];
            let pdfPageCheck = { status: "FAIL", pageCount: 0, pages: [], pageCheckNote: "PDF check not completed." };
            const fileId = result.fileId || driveFileId(item);
            if (!fileId || !item.documentId) throw new Error("Controlled document file ID or canonical Firestore document ID is missing.");
            bytes = await selfTestDownloadControlledDocument(fileId, item.documentId, { signal: documentController.signal });
            pdfLoadingTask = pdfjsLib.getDocument({ data: bytes });
            pdf = await pdfLoadingTask.promise;
            const canvas = document.createElement("canvas");
            try {
              const page = await pdf.getPage(1);
              const metrics = await renderPdfPageToCanvas(pdf, 1, canvas, { maxWidth: 420, maxPixels: 1000000, zoom: 0.65, signal: documentController.signal });
              pdfPageCheck = { status: metrics.textCharacters > 0 && metrics.nonBlankPixelRatio > 0 ? "PASS" : "FAIL", pageCount: pdf.numPages, pages: [{ pageNumber: 1, textCharacters: metrics.textCharacters, nonBlankPixelRatio: metrics.nonBlankPixelRatio, rendered: true, error: null }], pageCheckNote: "First-page-only check; remaining pages were not rendered." };
            } finally { canvas.width = 1; canvas.height = 1; }
            return { ...result, pdfPageCheck };
          })();
          const result = await Promise.race([work, new Promise((_, reject) => {
            documentController.signal.addEventListener("abort", () => reject(new Error("Document diagnostic timed out or was cancelled.")), { once: true });
          })]);
          diagnostic = diagnosticRow(item, result);
        } catch (error) {
          diagnostic = diagnosticRow(item, { status: "unreadable", reason: safeGatewayText(error?.message, "Diagnostic failed."), pdfPageCheck: { status: "FAIL", pageCount: 0, pages: [], pageCheckNote: safeGatewayText(error?.message, "Diagnostic failed.") } });
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abortOnCancel);
          try {
            if (pdf) await pdf.destroy();
            else if (pdfLoadingTask) await pdfLoadingTask.destroy();
          } catch {}
          if (bytes) bytes.fill(0);
          bytes = null;
          pdf = null;
          documentController.abort();
        }
        diagnostics.push(diagnostic);
        setResults(previous => [...previous, diagnostic]);
        setNextOffset(offset + index + 1);
        setProgress({ completed: index + 1, total: batch.length, active: 0 });
      }
      const next = offset + batch.length;
      setNextOffset(next);
      setMessage(next < documentRows.length
        ? "Checked " + next + " of " + documentRows.length + " documents. Select Run next 20 to continue."
        : "Read-only diagnostics complete. " + documentRows.length + " document(s) checked; no metadata or document was changed.");
    } catch (error) {
      setMessage("Read-only diagnostic stopped: " + safeGatewayText(error?.message, "Unknown diagnostic error."));
    } finally {
      clearTimeout(totalTimeout);
      cancelController.current = null;
      setBusy(false);
    }
  }

  function cancelReconcile() {
    cancelController.current?.abort();
    setMessage("Cancellation requested. The active document will be released before the run stops.");
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">ADMINISTRATOR DIAGNOSTICS</span><h2>Signature Pathway Self-Test</h2><p className="panel-description">Read-only inspection of every registered controlled document: Drive metadata, controlled-route download, SHA-256, byte size, PDF page count, per-page extractable text and non-blank rendering. Flags a final page with zero text or a render failure. No document, Drive file or Firestore record is repaired or changed.</p></div></div>
    <div className="panel" style={{padding:12,marginBottom:14}}>
      <div><strong>Google Drive token refresh health</strong><p className="panel-description">Read-only administrator check through the existing Gateway. Only status class and error classification are displayed; no token or credential details are returned.</p><div role="status">Status: {driveHealth.statusClass} · Classification: {driveHealth.classification}</div></div>
      <button type="button" onClick={checkDriveHealth} disabled={busy}>Check Drive refresh</button>
    </div>
    <div className="panel" style={{padding:12,marginBottom:14}}>
      <div><strong>Find emergency storage</strong><p className="panel-description">Administrator-only inspection of one emergency blob per Worker request. Chunk payloads are reconstructed in Worker memory only; responses contain metadata and measurements, never file bytes.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <button type="button" onClick={findEmergencyStorage} disabled={discoveryBusy}>{discoveryBusy ? "Scanning…" : "Find emergency storage"}</button>
        <button type="button" className="secondary-button" onClick={copyEmergencyStorageReport} disabled={!discovery}>Copy Report</button>
      </div>
      {discoveryProgress && <p role="status" aria-live="polite" style={{margin:"10px 0 0",fontSize:13}}>{discoveryProgress}</p>}
      {discoveryError && <div className="auth-message" role="alert" style={{marginTop:8}}>{discoveryError}</div>}
      {discovery && (discovery.hits.length ? <div style={{overflowX:"auto",marginTop:12}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr><th style={{textAlign:"left",padding:7}}>Collection path</th><th style={{textAlign:"left",padding:7}}>Document ID</th><th style={{textAlign:"left",padding:7}}>Field metadata</th><th style={{textAlign:"left",padding:7}}>Bytes / Base64 / Chunks</th></tr></thead>
          <tbody>{discovery.hits.map((hit,index)=><tr key={hit.collectionPath + "/" + hit.documentId + index}>
            <td style={{padding:7,verticalAlign:"top",overflowWrap:"anywhere"}}>{hit.collectionPath}</td>
            <td style={{padding:7,verticalAlign:"top",overflowWrap:"anywhere"}}>{hit.documentId}</td>
            <td style={{padding:7,verticalAlign:"top"}}>{hit.fields.map((field,i)=><div key={field.name + i}>{field.name} · {field.type} · {field.sizeBytes} bytes</div>)}</td>
            <td style={{padding:7,verticalAlign:"top"}}>Bytes: {hit.hasBytesField ? "yes" : "no"}<br/>Base64: {hit.hasBase64Field ? "yes" : "no"}<br/>Chunks: {hit.hasChunksField ? "yes" : "no"} · count {hit.chunkCount}</td>
          </tr>)}</tbody>
        </table>
      </div> : <div style={{marginTop:10}}>
        <strong>{discovery.completed ? "no emergency storage found in " + discovery.collectionCount + " collections scanned" : "Scan incomplete; no conclusion about emergency storage can be drawn"}</strong>
        <div style={{fontSize:13,marginTop:5}}>Collections scanned: {discovery.scannedCollectionIds.length ? discovery.scannedCollectionIds.join(", ") : "(none)"}</div>
      </div>)}
      {discovery.blobInspections?.length > 0 && <div style={{overflowX:"auto",marginTop:12}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr><th style={{textAlign:"left",padding:7}}>Blob record</th><th style={{textAlign:"left",padding:7}}>Subcollection</th><th style={{textAlign:"left",padding:7}}>Chunks / indexes</th><th style={{textAlign:"left",padding:7}}>Reconstruction measurements</th></tr></thead>
          <tbody>{discovery.blobInspections.flatMap(record => (record.subcollections || []).map(sub => <tr key={record.documentId + "/" + sub.collectionId}>
            <td style={{padding:7,verticalAlign:"top"}}>{record.documentId}</td>
            <td style={{padding:7,verticalAlign:"top"}}>{sub.collectionId}</td>
            <td style={{padding:7,verticalAlign:"top"}}>{sub.chunkDocumentCount} · contiguous: {sub.indexesContiguous ? "yes" : "no"} · parent totalChunks: {sub.totalChunksParent ?? "not set"}</td>
            <td style={{padding:7,verticalAlign:"top"}}>{sub.byteLength} bytes · PDF: {sub.startsWithPdfHeader ? "yes" : "no"} · SHA-256: {sub.sha256} · pages: {sub.pdfPageCount ?? "not parsed"} · parent size match: {sub.parentSizeMatches === null ? "unknown" : sub.parentSizeMatches ? "yes" : "no"}</td>
          </tr>))}</tbody>
        </table>
      </div>}
    </div>
    <div aria-label="Self-test totals" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8,marginBottom:14}}>
      <div className="panel" style={{padding:10}}><strong>{summarizeSelfTestResults(results).documentsReadable}</strong><div className="muted" style={{fontSize:12}}>Documents readable</div></div>
      <div className="panel" style={{padding:10}}><strong>{summarizeSelfTestResults(results).documentsUnreadable}</strong><div className="muted" style={{fontSize:12}}>Documents unreadable</div></div>
      <div className="panel" style={{padding:10}}><strong>{summarizeSelfTestResults(results).nonFileRecords}</strong><div className="muted" style={{fontSize:12}}>Non-file records</div></div>
    </div>
    {progress.total > 0 && <div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:13,marginBottom:5}}><strong>Document checks</strong><span>{progress.completed} / {progress.total} · {progress.active} active (sequential)</span></div><div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} style={{height:10,borderRadius:99,overflow:"hidden",background:"var(--border)"}}><div style={{height:"100%",width:(progress.total ? progress.completed / progress.total * 100 : 0)+"%",background:"var(--accent,#2563eb)",transition:"width .2s"}} /></div></div>}
    <div className="auth-message" role="status" aria-live="polite" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginBottom:12}}>{message}</div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}><button type="button" onClick={() => reconcile({ startNew: true })} disabled={busy}>{busy ? "Working…" : "Run Self-Test"}</button><button type="button" className="secondary-button" onClick={() => reconcile()} disabled={busy || !documentQueue.length || nextOffset >= documentQueue.filter(item => classifySelfTestRecord(item) !== "NON_FILE_RECORD").length}>Run next 20</button><button type="button" className="secondary-button" onClick={cancelReconcile} disabled={!busy}>Cancel</button><button type="button" className="secondary-button" onClick={() => { const report = results.map(row => [row.title || row.documentId, "Firestore ID: " + row.documentId, ...row.checks.map(check => check.status + ": " + check.name + "\n" + check.reason)].join("\n")).join("\n\n"); navigator.clipboard.writeText(report).then(() => setMessage("Full diagnostic report copied to clipboard.")).catch(error => setMessage("Copy failed: " + (error?.message || "Clipboard access unavailable."))); }} disabled={!results.length}>Copy report</button></div>
    {results.map((row,index)=><article key={row.documentId + "-" + index} className="panel" style={{marginBottom:10,padding:12}}>
      <strong style={{display:"block",overflowWrap:"anywhere"}}>{row.title || row.documentId}</strong><small style={{display:"block",overflowWrap:"anywhere"}}>Firestore ID: {row.documentId}</small>
      {row.classification === "NON_FILE_RECORD" ? <div style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8,color:"var(--muted)"}}><strong>NOT A DOCUMENT</strong><div style={{fontSize:13,marginTop:3}}>Edit record (no file)</div></div> : row.checks.map((check,i)=><div key={check.name + i} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
        <strong>{check.status}: {check.name}</strong><div style={{fontSize:13,whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginTop:3}}>{check.reason}</div>
      </div>)}
    </article>)}
    {!results.length && <p className="muted">No results yet. Run the self-test to inspect up to 20 documents per run.</p>}
  </section>;
}


class SignaturePathwaySelfTestBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="panel" role="alert"><h2>Signature self-test unavailable</h2><p>The diagnostic panel encountered an error. The rest of the Signature Portal remains available. Reload the panel before running another diagnostic.</p><button type="button" onClick={() => this.setState({ failed: false })}>Retry self-test panel</button></section>;
    return this.props.children;
  }
}

export default function SignaturePathwaySelfTest() {
  return <SignaturePathwaySelfTestBoundary><SignaturePathwaySelfTestPanel /></SignaturePathwaySelfTestBoundary>;
}
