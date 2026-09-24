import React, { useRef, useState, useEffect } from "react";
import { auth } from "../firebase/config";
import { createRecord, COLLECTIONS, getCurrentMemberProfile, getCurrentEmployeeProfile } from "../firebase/data";
import { readWorkflowContext, withWorkflowLinks } from "../firebase/workflowLinks";
import { uploadControlledDocumentRouted } from "../firebase/signatureStorage";

export default function ControlledDocumentUpload({ purpose = "Controlled Document", onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [documentType, setDocumentType] = useState("Governance Document");
  const [allowDualRoleDocumentTypes, setAllowDualRoleDocumentTypes] = useState(false);
  const [version, setVersion] = useState("1.0");
  const [archiveCategory, setArchiveCategory] = useState("Administrative Documents");
  const [classification, setClassification] = useState("Public");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [member, employee] = await Promise.all([
          getCurrentMemberProfile().catch(() => null),
          getCurrentEmployeeProfile().catch(() => null)
        ]);
        const values = [
          member?.role,
          ...(Array.isArray(member?.roles) ? member.roles : []),
          ...(Array.isArray(member?.assignedRoles) ? member.assignedRoles : []),
          ...(Array.isArray(member?.selectedRoles) ? member.selectedRoles : []),
          ...(Array.isArray(member?.roleAssignments) ? member.roleAssignments : []),
          employee?.role,
          ...(Array.isArray(employee?.roles) ? employee.roles : []),
          ...(Array.isArray(employee?.assignedRoles) ? employee.assignedRoles : []),
          ...(Array.isArray(employee?.selectedRoles) ? employee.selectedRoles : []),
          ...(Array.isArray(employee?.roleAssignments) ? employee.roleAssignments : [])
        ].flatMap(v => String(v || "").split(",").map(x => x.trim()).filter(Boolean));
        const normalized = new Set(values.map(v => v.toLowerCase()));
        const dualRole =
          normalized.has("board secretary") &&
          normalized.has("executive director");
        if (!cancelled) setAllowDualRoleDocumentTypes(dualRole);
      } catch (_) {
        if (!cancelled) setAllowDualRoleDocumentTypes(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function chooseFile() {
    setError("");
    setMessage("Opening the PDF file selector…");
    fileInputRef.current?.click();
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("Preparing PDF upload…");
    setError("");

    try {
      if (!auth.currentUser) throw new Error("You must be signed in.");
      if (!file) throw new Error("Select a PDF document to upload.");
      if (file.type !== "application/pdf") throw new Error("Only PDF documents are accepted.");
      if (file.size > 10 * 1024 * 1024) throw new Error("PDF must not exceed 10 MB.");

      const name = (title.trim() || file.name.replace(/\.pdf$/i, "")).slice(0, 160);
      const documentUid = `IRPA-DOC-${crypto.randomUUID()}`;
      setMessage("Routing the PDF into its selected archive and Board of Directors Governance archive…");
      const routed = await uploadControlledDocumentRouted({
        documentId: documentUid,
        title: name,
        reference: reference.trim() || documentUid,
        documentType,
        archiveCategory,
        classification,
        file
      });
      const archive = routed.categoryArchive;
      const governanceArchive = routed.governanceArchive;
      const now = new Date().toISOString();
      const workflowContext = readWorkflowContext();
      setMessage("Google Drive dual-channel upload complete. Registering the document…");
      const documentId = await createRecord(COLLECTIONS.documents, withWorkflowLinks({
        title: name,
        reference: reference.trim() || documentUid,
        documentType,
        version,
        documentUid,
        archiveCategory,
        classification,
        archiveFolderId: archive.folderId,
        archiveUidLink: archive.archiveUidLink,
        archivePath: archive.archivePath,
        archiveAccess: archive.archiveAccess || (classification === "Public" ? "Public" : "Restricted"),
        archiveFileId: archive.file?.fileId || null,
        archiveFileWebViewLink: archive.file?.webViewLink || null,
        governanceArchiveFolderId: governanceArchive?.folderId || null,
        governanceArchiveUidLink: governanceArchive?.archiveUidLink || null,
        governanceArchivePath: governanceArchive?.archivePath || null,
        governanceArchiveFileId: governanceArchive?.file?.fileId || null,
        governanceArchiveFileWebViewLink: governanceArchive?.file?.webViewLink || null,
        governanceArchiveStatus: governanceArchive ? "Routed" : "Not Required",
        recordOrigin: "PRODUCTION",
        fileName: file.name,
        fileId: archive.file?.fileId || null,
        storageProvider: "Google Drive",
        storagePath: `document-archives/${archiveCategory}/${classification}/${documentUid}/${file.name}`,
        webViewLink: archive.file?.webViewLink || null,
        fileUrl: archive.file?.fileId ? `drive://${archive.file.fileId}` : null,
        contentType: "application/pdf",
        fileSize: file.size,
        purpose,
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid],
        uploadedByUid: auth.currentUser.uid,
        uploadedByEmail: auth.currentUser.email || null,
        uploadedAt: now,
        uploadedAtDisplay: new Date(now).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", hour12: false })
      }, workflowContext || {}));

      const doc = {
        id: documentId,
        title: name,
        reference: reference.trim() || documentUid,
        documentType,
        version,
        fileName: file.name,
        fileId: target.fileId,
        storageProvider: "Google Drive",
        webViewLink: uploaded.metadata?.webViewLink || null,
        fileUrl: target.fileId ? `drive://${target.fileId}` : null,
        purpose,
        archiveCategory,
        classification,
        archiveFolderId: archive.folderId,
        archiveUidLink: archive.archiveUidLink,
        archivePath: archive.archivePath,
        archiveAccess: archive.archiveAccess,
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid]
      };

      setMessage(`Document uploaded successfully to Google Drive: ${name}. Primary category and Board of Directors Governance archive routing completed.`);
      setFile(null);
      setTitle("");
      setReference("");
      setDocumentType("Governance Document");
      setVersion("1.0");
      setArchiveCategory("Administrative Documents");
      setClassification("Public");
      e.target.reset();
      onUploaded?.(doc);
    } catch (x) {
      setError(x.message || "Unable to upload document to Google Drive.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel controlled-document-upload-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">CONTROLLED DOCUMENT UPLOAD</span>
          <h2>{purpose}</h2>
          <p className="panel-description">
            Upload the source PDF into the controlled IRPA document register. Files are stored in the configured IRPA Google Drive account and governance metadata remains in Firestore.
          </p>
        </div>
      </div>
      {message && <div className="success-message action-feedback">{message}</div>}
      {error && <div className="error-message action-feedback">{error}</div>}
      <div className="archive-routing-panel" style={{marginBottom:16}}>
        <strong>Google Drive Archive Routing</strong>
        <div style={{marginTop:6}}>Choose where this document will be stored:</div>
        <ul style={{margin:"6px 0 0 20px"}}>
          <li><strong>Finance Documents</strong> — finance records and supporting evidence.</li>
          <li><strong>Procurement Documents</strong> — procurement records, quotations, evaluations and purchase documentation.</li>
          <li><strong>Administrative Documents</strong> — policies, governance, HR and general administrative records.</li>
        </ul>
        <div style={{marginTop:6}}>Each archive is separated by <strong>Public, Internal, Confidential</strong> or <strong>Restricted</strong> classification. The selected route is recorded with the document UID and archive link.</div>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field"><label>Document Archive</label><select value={archiveCategory} onChange={e => setArchiveCategory(e.target.value)}><option>Finance Documents</option><option>Procurement Documents</option><option>Administrative Documents</option></select></div>
          <div className="form-field"><label>Access Classification</label><select value={classification} onChange={e => setClassification(e.target.value)}><option>Public</option><option>Internal</option><option>Confidential</option><option>Restricted</option></select></div>
          <div className="form-field">
            <label>Document Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter document title" />
          </div>
          <div className="form-field"><label>Document Reference / Identification No.</label><input value={reference} onChange={e => setReference(e.target.value)} placeholder="Enter document reference / identification number" /></div>
          <div className="form-field">
            <label>Document Type</label>
            {allowDualRoleDocumentTypes ? (
              <select
                value={documentType}
                onChange={e => setDocumentType(e.target.value)}
                aria-label="Document Type"
              >
                <option>Governance Document</option>
                <option>Administrative Document</option>
              </select>
            ) : (
              <input
                value={documentType}
                onChange={e => setDocumentType(e.target.value)}
                placeholder="e.g. Policy, Invoice, Procurement Record"
              />
            )}
            {allowDualRoleDocumentTypes && (
              <small className="muted" style={{display:"block",marginTop:6}}>
                Dual-role access: Governance and Administrative document types are available.
              </small>
            )}
          </div>
          <div className="form-field"><label>Version</label><input value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. 1.0" />
          </div>
          <div className="form-field">
            <label>PDF File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => {
                const selected = e.target.files?.[0] || null;
                setFile(selected);
                setError("");
                setMessage(selected ? `PDF selected: ${selected.name}. Click “Upload Controlled PDF” to continue.` : "No PDF selected.");
              }}
              required
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="secondary-button"
              onClick={chooseFile}
              disabled={busy}
            >
              Choose PDF from This Device
            </button>
            <div className="muted" style={{ marginTop: 8 }}>
              {file ? `Selected: ${file.name}` : "Select a PDF directly from this device."}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button
            type="submit"
            disabled={busy || !file}
            aria-busy={busy ? "true" : "false"}
          >
            {busy ? "Uploading to Google Drive…" : file ? "Upload Controlled PDF" : "Select a PDF first"}
          </button>
        </div>
      </form>
    </section>
  );
}
