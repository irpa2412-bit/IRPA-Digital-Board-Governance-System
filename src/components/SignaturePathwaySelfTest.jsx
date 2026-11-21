import React, { Component, useRef, useState } from "react";
import { getIdToken } from "firebase/auth";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";
import { collection as firestoreCollection, doc, getDoc as firestoreGetDoc, getDocs as firestoreGetDocs } from "firebase/firestore";
import { runSignatureFirestore } from "../firebase/signatureFirestoreDiagnostics.js";
import { auth, db } from "../firebase/config";
import { sanitizeGatewayResponse, validateReconcileGatewayResponse, withTimeout, takeDocumentChunk } from "../utils/signatureSelfTestSafety.mjs";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { renderPdfPageToCanvas, describePdfPageError } from "../utils/pdfPageRendering.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Clear legacy persisted self-test data before React mounts this eagerly imported module.
try { for (const storage of [window.localStorage, window.sessionStorage]) for (const key of Object.keys(storage)) if (/signature.*self.?test|self.?test.*signature/i.test(key)) storage.removeItem(key); } catch (error) { console.warn("IRPA self-test cache cleanup was unavailable:", error); }

const collection=(...args)=>runSignatureFirestore({operation:"collection",collectionPath:String(args[1]||"unknown"),screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreCollection(...args));
const getDoc=ref=>runSignatureFirestore({operation:"getDoc",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDoc(ref));
const getDocs=ref=>runSignatureFirestore({operation:"getDocs",target:ref,screen:"Signature Pathway Self-Test",userType:"logged-in administrator"},()=>firestoreGetDocs(ref));

async function selfTestGatewayPost(path, payload, requestOptions = {}) {
  const gateway = getGoogleDriveGatewayUrl();
  if (!gateway) throw new Error("Google Drive gateway is not configured.");
  if (!auth.currentUser) throw new Error("Authentication is required.");
  const token = await getIdToken(auth.currentUser);
  const response = await fetch(gateway + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: requestOptions.signal
  });
  const data = sanitizeGatewayResponse(await response.json().catch(() => null));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Gateway returned an invalid response object.");
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Gateway request failed (HTTP " + response.status + ").");
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

async function selfTestReconcileDocument(document, options = {}, requestOptions = {}) {
  return selfTestGatewayPost("/api/signature-pathway/reconcile", {
    ...options,
    documents: [{
      documentId: String(document.documentId || document.id || ""),
      fileId: String(document.fileId || document.driveFileId || document.archiveFileId || document.governanceArchiveFileId || document.sourceFileId || "")
    }]
  }, requestOptions);
}

async function selfTestDownloadControlledDocument(fileId, documentId, requestOptions = {}) {
  if (!fileId || !documentId) throw new Error("Controlled document file ID or canonical Firestore document ID is missing.");
  const result = await selfTestGatewayPost("/api/download", { fileId, documentId }, requestOptions);
  if (typeof result.base64 !== "string" || result.base64.length > 28000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64)) throw new Error("Google Drive returned invalid controlled document content.");
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

function SignaturePathwaySelfTestPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready. Run the test to inspect registered controlled documents.");
  const [results, setResults] = useState([]);
  const [documentQueue, setDocumentQueue] = useState([]);
  const [queueOffset, setQueueOffset] = useState(0);
  const cancelRequested = useRef(false);
  const activeController = useRef(null);
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
    const data = sanitizeGatewayResponse(await response.json().catch(() => null));
    if (!data || typeof data !== "object" || Array.isArray(data) || !response.ok || data.ok !== true) throw new Error(typeof data?.error === "string" ? data.error.slice(0, 300) : "Emergency-storage discovery request failed (HTTP " + response.status + ").");
    if (payload.action === "collections" && (!Array.isArray(data.collectionIds) || data.collectionIds.some(value => typeof value !== "string"))) throw new Error("Gateway returned invalid collection metadata.");
    if (payload.action === "scan" && (!Array.isArray(data.hits) || data.hits.some(hit => !hit || typeof hit !== "object" || typeof hit.documentId !== "string" || typeof hit.collectionPath !== "string"))) throw new Error("Gateway returned invalid scan metadata.");
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
        cache: "no-store",
        redirect: "error"
      });
      const data = sanitizeGatewayResponse(await response.json().catch(() => null));
      if (!response.ok || !data || typeof data !== "object" || Array.isArray(data) || typeof data.statusClass !== "string" || typeof data.classification !== "string") throw new Error("Gateway returned an invalid Drive-health response.");
      setDriveHealth({ statusClass: data.statusClass.slice(0, 80), classification: data.classification.slice(0, 120) });
    } catch {
      setDriveHealth({ statusClass: "error", classification: "gateway_redirect_blocked_or_network_or_authentication" });
    }
  }

  async function runDocumentChunk(rows, offset) {
    const chunkStarted = Date.now(), chunk = takeDocumentChunk(rows, offset, 20), chunkResults = [];
    cancelRequested.current = false; setBusy(true);
    setMessage("Read-only diagnostic: one document at a time, maximum 20 documents and 60 seconds per run; 15 seconds per document. Only the first PDF page is checked at reduced scale.");
    setProgress({ completed: offset, total: rows.length, active: 0 });
    try {
      for (let localIndex=0; localIndex<chunk.length; localIndex+=1) {
        if (cancelRequested.current || Date.now()-chunkStarted>=60000) break;
        const index=offset+localIndex,item=chunk[localIndex],controller=new AbortController();
        activeController.current=controller;setProgress({completed:index,total:rows.length,active:1});
        try {
          const remainingMs=Math.max(1,60000-(Date.now()-chunkStarted));
          const diagnostic=await withTimeout(async()=>{
            const response=validateReconcileGatewayResponse(await selfTestReconcileDocument(item,{}, {signal:controller.signal}));
            const result=response.results[0];let pdfPageCheck,bytes=null,pdf=null,canvas=null;
            try {
              const fileId=result.fileId||driveFileId(item);if(!fileId||!item.documentId)throw new Error("Controlled document file ID or canonical Firestore document ID is missing.");
              bytes=await selfTestDownloadControlledDocument(fileId,item.documentId,{signal:controller.signal});
              pdf=await pdfjsLib.getDocument({data:bytes}).promise;canvas=document.createElement("canvas");
              const metrics=await renderPdfPageToCanvas(pdf,1,canvas,{maxWidth:420,maxPixels:600000});let textCharacters=0;
              try{const page=await pdf.getPage(1);const content=await page.getTextContent();textCharacters=(content.items||[]).reduce((sum,entry)=>sum+String(entry.str||"").length,0);page.cleanup?.();}catch{}
              pdfPageCheck={status:metrics&&textCharacters>0?"PASS":"FAIL",pageCount:pdf.numPages,pages:[{pageNumber:1,textCharacters,nonBlankPixelRatio:metrics.nonBlankPixelRatio,rendered:true,error:null}],lastPageFlag:"FIRST PAGE ONLY"};
            }catch(error){pdfPageCheck={status:"FAIL",pageCount:0,pages:[],lastPageFlag:"FAIL: "+(error?.name||"Error")+": "+(error?.message||String(error)),error:describePdfPageError(error)};}
            finally{if(pdf){try{await pdf.destroy();}catch{}}if(bytes instanceof Uint8Array)bytes.fill(0);if(canvas){canvas.width=1;canvas.height=1;}}
            return {...response,results:[{...result,pdfPageCheck}]};
          },Math.min(15000,remainingMs),"Document diagnostic exceeded its time limit.",()=>controller.abort());
          chunkResults.push(diagnosticRow(item,diagnostic.results[0]));
        }catch(error){if(!cancelRequested.current)chunkResults.push({documentId:item.documentId,title:item.title||item.fileName||item.documentId,classification:"CONTROLLED_DOCUMENT",checks:[{name:"Controlled document diagnostic",status:"FAIL",reason:error?.message||"Diagnostic failed."}],diagnostic:null});}
        finally{activeController.current=null;}
        if(chunkResults.length>localIndex)setResults(previous=>[...previous,chunkResults[chunkResults.length-1]]);
        setProgress({completed:index+1,total:rows.length,active:0});if(cancelRequested.current)break;
      }
      const nextOffset=offset+chunkResults.length;setQueueOffset(nextOffset);
      if(cancelRequested.current)setMessage("Self-test cancelled. Completed results remain in this panel only; no diagnostic results are persisted.");
      else if(Date.now()-chunkStarted>=60000&&nextOffset<rows.length)setMessage("The 60-second run limit was reached. Select Run next 20 to continue.");
      else setMessage("Completed "+chunkResults.length+" document(s) in this run. Results remain in this panel only and are not saved to browser storage.");
    }finally{activeController.current=null;setBusy(false);}
  }
  async function reconcile(){
    setBusy(true);setResults([]);setQueueOffset(0);setMessage("Preparing a read-only document list…");
    try{await requireAdministrator();const snapshot=await getDocs(collection(db,"documents"));const rows=snapshot.docs.map(item=>({documentId:item.id,...item.data()}));const documentRows=rows.filter(item=>classifySelfTestRecord(item)!=="NON_FILE_RECORD");setDocumentQueue(documentRows);setProgress({completed:0,total:documentRows.length,active:0});await runDocumentChunk(documentRows,0);}
    catch(error){setMessage("Read-only diagnostic failed: "+(error?.message||"Unknown gateway error. No success is assumed."));setBusy(false);}
  }
  async function runNextChunk(){if(!documentQueue.length||queueOffset>=documentQueue.length||busy)return;await runDocumentChunk(documentQueue,queueOffset);}
  function cancelRun(){cancelRequested.current=true;activeController.current?.abort();setMessage("Cancelling the current document safely…");}

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
    {progress.total > 0 && <div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:13,marginBottom:5}}><strong>Document checks</strong><span>{progress.completed} / {progress.total} · {progress.active} active (one at a time)</span></div><div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} style={{height:10,borderRadius:99,overflow:"hidden",background:"var(--border)"}}><div style={{height:"100%",width:(progress.total ? progress.completed / progress.total * 100 : 0)+"%",background:"var(--accent,#2563eb)",transition:"width .2s"}} /></div></div>}
    <div className="auth-message" role="status" aria-live="polite" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginBottom:12}}>{message}</div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}><button type="button" onClick={() => reconcile()} disabled={busy}>{busy ? "Working…" : "Run Self-Test & Drive Diagnostics"}</button>
      {busy && <button type="button" className="secondary-button" onClick={cancelRun}>Cancel</button>}
      {!busy && documentQueue.length > 0 && queueOffset < documentQueue.length && <button type="button" onClick={runNextChunk}>Run next 20</button>}
      <button type="button" className="secondary-button" onClick={() => { const report = results.map(row => [row.title || row.documentId, "Firestore ID: " + row.documentId, ...row.checks.map(check => check.status + ": " + check.name + "\n" + check.reason)].join("\n")).join("\n\n"); navigator.clipboard.writeText(report).then(() => setMessage("Full diagnostic report copied to clipboard.")).catch(error => setMessage("Copy failed: " + (error?.message || "Clipboard access unavailable."))); }} disabled={!results.length}>Copy report</button></div>
    {results.map((row,index)=><article key={row.documentId + "-" + index} className="panel" style={{marginBottom:10,padding:12}}>
      <strong style={{display:"block",overflowWrap:"anywhere"}}>{row.title || row.documentId}</strong><small style={{display:"block",overflowWrap:"anywhere"}}>Firestore ID: {row.documentId}</small>
      {row.classification === "NON_FILE_RECORD" ? <div style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8,color:"var(--muted)"}}><strong>NOT A DOCUMENT</strong><div style={{fontSize:13,marginTop:3}}>Edit record (no file)</div></div> : row.checks.map((check,i)=><div key={check.name + i} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
        <strong>{check.status}: {check.name}</strong><div style={{fontSize:13,whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginTop:3}}>{check.reason}</div>
      </div>)}
    </article>)}
    {!results.length && <p className="muted">No results yet. Tap Run Self-Test & Drive Diagnostics to inspect the first 20 registered controlled documents.</p>}
  </section>;
}

export default class SignaturePathwaySelfTest extends Component {
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(error){console.error("Signature Pathway Self-Test panel isolated failure",error);}
 render(){if(this.state.failed)return <section className="panel" role="alert"><h2>Self-Test panel unavailable</h2><p>The diagnostic panel encountered an error. The rest of the Signature workspace remains available. Reopen the Signature Portal to retry.</p></section>;return <SignaturePathwaySelfTestPanel/>;}
}
