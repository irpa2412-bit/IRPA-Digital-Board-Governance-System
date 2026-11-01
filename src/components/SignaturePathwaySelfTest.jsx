import React, { useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { downloadControlledDocumentBytes, reconcileSignatureDocumentIds } from "../firebase/signatureStorage";
import { runControlledDocumentDiagnosticBatch } from "../utils/controlledDocumentDiagnosticBatch";

function driveFileId(record = {}) {
  return String(record.fileId || record.driveFileId || record.sourceFileId || record.archiveFileId || record.governanceArchiveFileId || record.primaryArchiveFileId || "").trim();
}

function diagnosticRow(item, result) {
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
    }],
    diagnostic: result
  };
}

export default function SignaturePathwaySelfTest() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready. Run the test to inspect registered controlled documents.");
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });

  async function requireAdministrator() {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("STEP administrator check failed: sign in first.");
    if (String(user.email || "").trim().toLowerCase() === "irpa2412@gmail.com") return;
    const admin = await getDoc(doc(db, "adminProfiles", user.uid));
    if (!admin.exists() || admin.data()?.active !== true) throw new Error("STEP administrator check failed: active administrator access is required.");
  }

  async function reconcile() {
    setBusy(true);
    setResults([]);
    setProgress({ completed: 0, total: 0, active: 0 });
    setMessage("Read-only diagnostic: discovering document metadata in the browser, then checking one document per authenticated Worker request. Maximum concurrency 3; transient failures retry up to 3 attempts. No changes will be made.");
    try {
      await requireAdministrator();
      const snapshot = await getDocs(collection(db, "documents"));
      const rows = snapshot.docs.map(item => ({ documentId: item.id, ...item.data() }));
      setProgress({ completed: 0, total: rows.length, active: 0 });
      const diagnostics = await runControlledDocumentDiagnosticBatch(
        rows,
        (oneDocument, options) => reconcileSignatureDocumentIds(oneDocument, options),
        { concurrency: 3, maxRetries: 3, onProgress: setProgress }
      );
      const output = rows.map((item, index) => diagnosticRow(item, diagnostics[index]));
      setResults(output);
      const failed = output.filter(row => row.checks[0].status === "FAIL").length;
      const review = output.filter(row => row.checks[0].status === "NEEDS REVIEW").length;
      setMessage("Read-only diagnostics completed. " + rows.length + " document(s) checked using exactly one document per Worker request (maximum concurrency 3; up to 3 retries (4 total attempts) per document); " + (rows.length - failed - review) + " pass, " + review + " need review, " + failed + " fail. No metadata or document was changed.");
    } catch (error) {
      setMessage("Read-only diagnostic failed: " + (error?.message || "Unknown gateway error. No success is assumed."));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">ADMINISTRATOR DIAGNOSTICS</span><h2>Signature Pathway Self-Test</h2><p className="panel-description">Read-only inspection of every registered controlled document: Drive metadata, download, SHA-256, byte size and PDF parsing. No document, Drive file or Firestore record is repaired or changed.</p></div></div>
    {progress.total > 0 && <div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:13,marginBottom:5}}><strong>Document checks</strong><span>{progress.completed} / {progress.total} · {progress.active} active (max 3)</span></div><div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} style={{height:10,borderRadius:99,overflow:"hidden",background:"var(--border)"}}><div style={{height:"100%",width:(progress.total ? progress.completed / progress.total * 100 : 0)+"%",background:"var(--accent,#2563eb)",transition:"width .2s"}} /></div></div>}
    <div className="auth-message" role="status" aria-live="polite" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginBottom:12}}>{message}</div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}><button type="button" onClick={() => reconcile()} disabled={busy}>{busy ? "Working…" : "Run Self-Test & Drive Diagnostics"}</button><button type="button" className="secondary-button" onClick={() => { const report = results.map(row => [row.title || row.documentId, "Firestore ID: " + row.documentId, ...row.checks.map(check => check.status + ": " + check.name + "\n" + check.reason)].join("\n")).join("\n\n"); navigator.clipboard.writeText(report).then(() => setMessage("Full diagnostic report copied to clipboard.")).catch(error => setMessage("Copy failed: " + (error?.message || "Clipboard access unavailable."))); }} disabled={!results.length}>Copy report</button></div>
    {results.map((row,index)=><article key={row.documentId + "-" + index} className="panel" style={{marginBottom:10,padding:12}}>
      <strong style={{display:"block",overflowWrap:"anywhere"}}>{row.title || row.documentId}</strong><small style={{display:"block",overflowWrap:"anywhere"}}>Firestore ID: {row.documentId}</small>
      {row.checks.map((check,i)=><div key={check.name + i} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
        <strong>{check.status}: {check.name}</strong><div style={{fontSize:13,whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginTop:3}}>{check.reason}</div>
      </div>)}
    </article>)}
    {!results.length && <p className="muted">No results yet. Tap Run Self-Test & Drive Diagnostics to inspect each registered document and its exact failure reason.</p>}
  </section>;
}
