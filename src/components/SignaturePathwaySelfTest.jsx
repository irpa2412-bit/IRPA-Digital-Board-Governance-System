import React, { useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { downloadControlledDocumentBytes, reconcileSignatureDocumentIds } from "../firebase/signatureStorage";

function driveFileId(record = {}) {
  return String(record.fileId || record.driveFileId || record.sourceFileId || record.archiveFileId || record.governanceArchiveFileId || record.primaryArchiveFileId || "").trim();
}

export default function SignaturePathwaySelfTest() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready. Run the test to inspect registered controlled documents.");
  const [results, setResults] = useState([]);
  const [documents, setDocuments] = useState([]);

  async function requireAdministrator() {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("STEP administrator check failed: sign in first.");
    if (String(user.email || "").trim().toLowerCase() === "irpa2412@gmail.com") return;
    const admin = await getDoc(doc(db, "adminProfiles", user.uid));
    if (!admin.exists() || admin.data()?.active !== true) throw new Error("STEP administrator check failed: active administrator access is required.");
  }

  async function runChecks() {
    setBusy(true);
    setMessage("Running Signature Pathway Self-Test…");
    setResults([]);
    try {
      await requireAdministrator();
      const snapshot = await getDocs(collection(db, "documents"));
      const rows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      setDocuments(rows);
      const output = [];
      for (const item of rows) {
        const row = { documentId: item.id, title: item.title || item.fileName || item.reference || item.id, checks: [] };
        row.checks.push({ name: "Firestore document found", status: "PASS", reason: "documents/" + item.id + " was returned by Firestore." });
        const storedId = String(item.documentId || "").trim();
        row.checks.push({ name: "ID contract", status: !storedId || storedId === item.id ? "PASS" : "FAIL", reason: !storedId ? "Firestore key documents/" + item.id + " is canonical; no conflicting documentId field is stored." : storedId === item.id ? "Firestore key and documentId field both equal " + item.id + "." : "Mismatch: Firestore key=" + item.id + "; stored documentId field=" + storedId + "." });
        const fileId = driveFileId(item);
        if (!fileId) {
          row.checks.push({ name: "Drive reachability / gateway route", status: "FAIL", reason: "No registered Drive file ID was found on this document." });
        } else {
          try {
            await downloadControlledDocumentBytes(fileId, item.id);
            row.checks.push({ name: "Drive reachability / gateway route", status: "PASS", reason: "Gateway returned the controlled PDF bytes for Drive file " + fileId + "." });
          } catch (error) {
            row.checks.push({ name: "Drive reachability / gateway route", status: "FAIL", reason: "STEP controlled download failed for documentId=" + item.id + ", fileId=" + fileId + ": " + (error?.message || "Unknown gateway error") });
          }
        }
        row.checks.push({ name: "Add-signer write", status: "NOT RUN", reason: "No real envelope or signer was written by the self-test. Use the explicit Add Signer action to verify its write without creating hidden test records." });
        output.push(row);
        setResults([...output]);
      }
      setMessage("Self-test finished. " + rows.length + " document(s) checked. Read each FAIL reason; Add-signer write is explicitly marked NOT RUN.");
    } catch (error) {
      setMessage(error?.message || "STEP self-test failed without a returned reason.");
    } finally {
      setBusy(false);
    }
  }

  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  async function reconcile() {
    setBusy(true);
    setResults([]);
    setProgress({ completed: 0, total: 0, active: 0 });
    setMessage("Read-only diagnostic: discovering document metadata in the browser, then checking one document per Worker request. No changes will be made.");
    try {
      await requireAdministrator();
      const snapshot = await getDocs(collection(db, "documents"));
      const rows = snapshot.docs.map(item => ({ documentId: item.id, ...item.data() }));
      setDocuments(rows);
      const output = [];
      setProgress({ completed: 0, total: rows.length, active: 0 });
      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= rows.length) return;
          const item = rows[index];
          setProgress(current => ({ ...current, active: Math.min(3, current.active + 1) }));
          let result;
          let lastError;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const response = await reconcileSignatureDocumentIds([item], { dryRun: true, autoDiscover: false });
              result = response.results?.[0];
              if (!result) throw new Error("Worker returned no diagnostic result for " + item.documentId + ".");
              break;
            } catch (error) {
              lastError = error;
              if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * attempt));
            }
          }
          if (!result) {
            result = {
              documentId: item.documentId,
              title: item.title || item.fileName || item.reference || item.documentId,
              fileId: driveFileId(item),
              status: "unreadable",
              classification: "REQUEST_FAILED",
              step: "Worker request",
              reason: "Three attempts failed: " + (lastError?.message || "Unknown gateway error"),
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
            "Drive description.documentId: " + (result.previousDescriptionDocumentId || "(not checked)"),
            "Reason: " + (result.reason || "(no reason returned)")
          ].filter(Boolean).join("\n");
          const row = {
            documentId: item.documentId,
            title: result.title || item.title || item.fileName || item.reference || item.documentId,
            checks: [{
              name: (result.status || "unreadable") + " · " + (result.fileId || driveFileId(item) || "no file ID"),
              status: result.status === "match" ? "PASS" : result.status === "mismatch" ? "NEEDS REVIEW" : "FAIL",
              reason: "Firestore ID: " + item.documentId + "; file ID: " + (result.fileId || driveFileId(item) || "(none)") + "\n" + detail
            }],
            diagnostic: result
          };
          output[index] = row;
          setResults(output.filter(Boolean));
          setProgress(current => ({ ...current, completed: current.completed + 1, active: Math.max(0, current.active - 1) }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, () => worker()));
      const failed = output.filter(Boolean).filter(row => row.checks[0].status === "FAIL").length;
      const review = output.filter(Boolean).filter(row => row.checks[0].status === "NEEDS REVIEW").length;
      setMessage("Read-only diagnostics completed. " + rows.length + " document(s) checked using one document per Worker request (maximum concurrency 3); " + (rows.length - failed - review) + " pass, " + review + " need review, " + failed + " fail. No metadata or document was changed.");
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
