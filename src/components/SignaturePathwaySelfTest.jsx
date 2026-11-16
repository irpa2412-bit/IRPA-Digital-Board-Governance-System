import React, { useState } from "react";
import { getIdToken } from "firebase/auth";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";
import { collection, doc, getDoc as firestoreGetDoc, getDocs as firestoreGetDocs } from "firebase/firestore";
import { runSignatureFirestore } from "../firebase/signatureFirestoreDiagnostics.js";
import { auth, db } from "../firebase/config";
import { reconcileSignatureDocumentIds } from "../firebase/signatureStorage";
import { runControlledDocumentDiagnosticBatch } from "../utils/controlledDocumentDiagnosticBatch";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { downloadControlledDocumentBytes } from "../firebase/signatureStorage";
import { renderPdfPageToCanvas, describePdfPageError } from "../utils/pdfPageRendering.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const getDoc=ref=>runSignatureFirestore({operation:"getDoc",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDoc(ref));
const getDocs=ref=>runSignatureFirestore({operation:"getDocs",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDocs(ref));

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
    "Last-page check: " + (result.pdfPageCheck?.lastPageFlag || "NOT RUN"),
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

export default function SignaturePathwaySelfTest() {
  const [busy, setBusy] = useState(false);
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
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error || "Emergency-storage discovery request failed (HTTP " + response.status + ").");
    return data;
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
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      setDriveHealth({
        statusClass: String(data.statusClass || (response.ok ? "ok" : "error")),
        classification: String(data.classification || "unknown")
      });
    } catch {
      setDriveHealth({ statusClass: "error", classification: "network_or_authentication" });
    }
  }

  async function reconcile() {
    setBusy(true);
    setResults([]);
    setProgress({ completed: 0, total: 0, active: 0 });
    setMessage("Read-only diagnostic: discovering document metadata in the browser, then checking one document per authenticated Worker request. Maximum concurrency 3; transient failures retry up to 3 times (4 total attempts). No changes will be made.");
    try {
      await requireAdministrator();
      await checkDriveHealth();
      const snapshot = await getDocs(collection(db, "documents"));
      const rows = snapshot.docs.map(item => ({ documentId: item.id, ...item.data() }));
      const documentRows = rows.filter(item => classifySelfTestRecord(item) !== "NON_FILE_RECORD");
      setProgress({ completed: 0, total: documentRows.length, active: 0 });
      const diagnostics = await runControlledDocumentDiagnosticBatch(
        documentRows,
        async (oneDocument, options) => {
          const response = await reconcileSignatureDocumentIds(oneDocument, options);
          const item = oneDocument[0];
          const result = response.results[0];
          let pdfPageCheck;
          try {
            const fileId = result.fileId || driveFileId(item);
            if (!fileId || !item.documentId) throw new Error("Controlled document file ID or canonical Firestore document ID is missing.");
            const bytes = await downloadControlledDocumentBytes(fileId, item.documentId);
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            const pages = [];
            try {
              for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                const canvas = document.createElement("canvas");
                try {
                  const metrics = await renderPdfPageToCanvas(pdf, pageNumber, canvas, { maxWidth: 640, maxPixels: 2500000 });
                  pages.push({ pageNumber, textCharacters: metrics.textCharacters, nonBlankPixelRatio: metrics.nonBlankPixelRatio, rendered: true, error: null });
                } catch (error) {
                  console.error("Signature Pathway Self-Test PDF page check failed", { documentId: item.documentId, pageNumber, error });
                  let textCharacters = 0;
                  try { const page = await pdf.getPage(pageNumber); const content = await page.getTextContent(); textCharacters = (content.items || []).reduce((sum, entry) => sum + String(entry.str || "").length, 0); } catch {}
                  pages.push({ pageNumber, textCharacters, nonBlankPixelRatio: 0, rendered: false, error: describePdfPageError(error) });
                } finally { canvas.width = 1; canvas.height = 1; }
              }
            } finally { await pdf.destroy(); }
            const last = pages[pages.length - 1];
            const lastPageFlag = !last ? "FAIL: no pages parsed" : last.textCharacters === 0 ? "FLAG: last page has zero extractable text" : !last.rendered ? "FLAG: last page failed to render" : "PASS";
            pdfPageCheck = { status: last && last.textCharacters > 0 && pages.length === pdf.numPages && pages.every(page => page.rendered) ? "PASS" : "FAIL", pageCount: pages.length, pages, lastPageFlag };
          } catch (error) {
            console.error("Signature Pathway Self-Test controlled PDF check failed", { documentId: item.documentId, error });
            pdfPageCheck = { status: "FAIL", pageCount: 0, pages: [], lastPageFlag: "FAIL: " + (error?.name || "Error") + ": " + (error?.message || String(error)), error: describePdfPageError(error) };
          }
          return { ...response, results: [{ ...result, pdfPageCheck }] };
        },
        { concurrency: 3, maxRetries: 3, onProgress: setProgress }
      );
      const documentResults = new Map(documentRows.map((item, index) => [item.documentId, diagnostics[index]]));
      const output = rows.map(item => diagnosticRow(item, documentResults.get(item.documentId)));
      setResults(output);
      const totals = summarizeSelfTestResults(output);
      const review = output.filter(row => row.classification !== "NON_FILE_RECORD" && row.checks[0]?.status === "NEEDS REVIEW" && !row.checks.some(check => check.status === "FAIL")).length;
      setMessage("Read-only diagnostics completed. " + documentRows.length + " document(s) checked using exactly one document per Worker request (maximum concurrency 3; up to 3 retries (4 total attempts) per document); " + totals.documentsReadable + " readable, " + totals.documentsUnreadable + " unreadable, " + totals.nonFileRecords + " non-file record(s)" + (review ? "; " + review + " need review" : "") + ". No metadata or document was changed.");
    } catch (error) {
      setMessage("Read-only diagnostic failed: " + (error?.message || "Unknown gateway error. No success is assumed."));
    } finally {
      setBusy(false);
    }
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
    {progress.total > 0 && <div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:13,marginBottom:5}}><strong>Document checks</strong><span>{progress.completed} / {progress.total} · {progress.active} active (max 3)</span></div><div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} style={{height:10,borderRadius:99,overflow:"hidden",background:"var(--border)"}}><div style={{height:"100%",width:(progress.total ? progress.completed / progress.total * 100 : 0)+"%",background:"var(--accent,#2563eb)",transition:"width .2s"}} /></div></div>}
    <div className="auth-message" role="status" aria-live="polite" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginBottom:12}}>{message}</div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}><button type="button" onClick={() => reconcile()} disabled={busy}>{busy ? "Working…" : "Run Self-Test & Drive Diagnostics"}</button><button type="button" className="secondary-button" onClick={() => { const report = results.map(row => [row.title || row.documentId, "Firestore ID: " + row.documentId, ...row.checks.map(check => check.status + ": " + check.name + "\n" + check.reason)].join("\n")).join("\n\n"); navigator.clipboard.writeText(report).then(() => setMessage("Full diagnostic report copied to clipboard.")).catch(error => setMessage("Copy failed: " + (error?.message || "Clipboard access unavailable."))); }} disabled={!results.length}>Copy report</button></div>
    {results.map((row,index)=><article key={row.documentId + "-" + index} className="panel" style={{marginBottom:10,padding:12}}>
      <strong style={{display:"block",overflowWrap:"anywhere"}}>{row.title || row.documentId}</strong><small style={{display:"block",overflowWrap:"anywhere"}}>Firestore ID: {row.documentId}</small>
      {row.classification === "NON_FILE_RECORD" ? <div style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8,color:"var(--muted)"}}><strong>NOT A DOCUMENT</strong><div style={{fontSize:13,marginTop:3}}>Edit record (no file)</div></div> : row.checks.map((check,i)=><div key={check.name + i} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
        <strong>{check.status}: {check.name}</strong><div style={{fontSize:13,whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginTop:3}}>{check.reason}</div>
      </div>)}
    </article>)}
    {!results.length && <p className="muted">No results yet. Tap Run Self-Test & Drive Diagnostics to inspect each registered document and its exact failure reason.</p>}
  </section>;
}
