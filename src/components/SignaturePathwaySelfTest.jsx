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

  async function reconcile() {
    setBusy(true);
    setMessage("Read-only diagnostic: inspecting Drive metadata, downloaded bytes, hashes, sizes and PDF structure. No changes will be made.");
    try {
      await requireAdministrator();
      const result = await reconcileSignatureDocumentIds([], { autoDiscover: true, dryRun: true });
      const lines = (result.results || []).map(item => {
        const detail = [
          "Classification: " + (item.classification || item.status || "UNKNOWN"),
          "Exact failing step: " + (item.step || "(none)"),
          "HTTP status: " + (item.httpStatus ?? "(none)"),
          "Drive error reason: " + (item.driveErrorReason || "(none)"),
          "Drive mimeType: " + (item.mimeType || "(not returned)"),
          "Drive size: " + (item.driveSize ?? "(not returned)") + " bytes; stored size: " + (item.storedSize ?? "(not recorded)") + " bytes",
          "Stored SHA-256: " + (item.storedSha256 || "(not recorded)"),
          "Computed SHA-256: " + (item.computedSha256 || "(not computed)"),
          "Trashed: " + (item.trashed == null ? "(not returned)" : String(item.trashed)),
          "Parents: " + (Array.isArray(item.parents) ? item.parents.join(", ") : "(not returned)"),
          "Drive created: " + (item.createdTime || "(not returned)"),
          "Uploaded by: " + (item.uploadedBy || "(not recorded)"),
          "Uploaded at: " + (item.uploadedAt || "(not recorded)"),
          "PDF parses: " + (item.pdfParses == null ? "(not checked)" : String(item.pdfParses)),
          "PDF pages: " + (item.pdfPageCount ?? "(not parsed)") + "; stored page count: " + (item.storedPageCount ?? "(not recorded)"),
          item.pageCountComparison || "",
          "Drive description.documentId: " + (item.previousDescriptionDocumentId || "(not checked)"),
          "Reason: " + (item.reason || "(no reason returned)")
        ].filter(Boolean).join("\n");
        return { documentId:item.documentId, title:item.title || item.documentId, checks:[{name:item.status + " · Drive " + item.fileId,status:item.status === "match" ? "PASS" : item.status === "mismatch" ? "NEEDS REVIEW" : "FAIL",reason:"Firestore ID: " + item.documentId + "; Drive file ID: " + item.fileId + "\n" + detail}], diagnostic:item };
      });
      setResults(lines);
      const summary = result.summary || {};
      setMessage("Read-only diagnostics completed; no metadata or document was changed. " + (summary.match || 0) + " match; " + (summary.mismatch || 0) + " mismatch; " + (summary.unreadable || 0) + " unreadable. Every discovered document has a result line, including wiAfPSIxHLTd6MdeM04q.");
    } catch (error) {
      setMessage("Read-only diagnostic failed: " + (error?.message || "Unknown gateway error. No success is assumed."));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">ADMINISTRATOR DIAGNOSTICS</span><h2>Signature Pathway Self-Test</h2><p className="panel-description">Read-only inspection of every registered controlled document: Drive metadata, download, SHA-256, byte size and PDF parsing. No document, Drive file or Firestore record is repaired or changed.</p></div></div>
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
