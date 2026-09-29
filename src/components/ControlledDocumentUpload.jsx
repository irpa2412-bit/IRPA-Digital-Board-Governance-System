import React, { useRef, useState, useEffect } from "react";
import { auth } from "../firebase/config";
import { createRecord, getRecord, COLLECTIONS, getCurrentMemberProfile, getCurrentEmployeeProfile, nextDocumentReference } from "../firebase/data";
import { readWorkflowContext, withWorkflowLinks } from "../firebase/workflowLinks";
import { uploadControlledDocumentRouted, buildDocumentArchiveDestination } from "../firebase/signatureStorage";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DOCUMENT_TYPES = ["Governance", "Administrative", "Finance", "Procurement", "Administrator"];
const ARCHIVE_CATEGORIES = { Governance: "Governance Documents", Administrative: "Administrative Documents", Finance: "Finance Documents", Procurement: "Procurement Documents", Administrator: "Administrator Documents" };
const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.tsv,.md,.html,.epub,.json,.xml,.jpg,.jpeg,.png,.webp,.svg";
const MIME_BY_EXTENSION = { pdf:"application/pdf", doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation", odt:"application/vnd.oasis.opendocument.text", ods:"application/vnd.oasis.opendocument.spreadsheet", odp:"application/vnd.oasis.opendocument.presentation", rtf:"application/rtf", txt:"text/plain", csv:"text/csv", tsv:"text/tab-separated-values", md:"text/markdown", html:"text/html", epub:"application/epub+zip", json:"application/json", xml:"application/xml", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", svg:"image/svg+xml" };

function resolveContentType(file) {
  const reported = String(file?.type || "").trim().toLowerCase();
  if (reported) return reported;
  const ext = String(file?.name || "").split(".").pop()?.toLowerCase();
  return MIME_BY_EXTENSION[ext] || "application/octet-stream";
}

export default function ControlledDocumentUpload({ purpose = "Controlled Document", onUploaded, allowRestrictedUpload = false, submitLabel = "Upload Document", compact = false, deferSave = false }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [generatedReference, setGeneratedReference] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [allowDualRoleDocumentTypes, setAllowDualRoleDocumentTypes] = useState(false);
  const [version, setVersion] = useState("1.0");
  const [archiveCategory, setArchiveCategory] = useState("");
  const [classification, setClassification] = useState("Public");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingDocument, setPendingDocument] = useState(null);
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
    setMessage("Opening the document file selector…");
    fileInputRef.current?.click();
  }

  async function savePendingDocument() {
    if (!pendingDocument) return;
    setBusy(true);
    setError("");
    setMessage("Saving document to the IRPA controlled-document register…");
    try {
      if (!auth.currentUser) throw new Error("You must be signed in.");
      let documentId = "";
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          documentId = await createRecord(COLLECTIONS.documents, pendingDocument.documentPayload);
          const persisted = await getRecord(COLLECTIONS.documents, documentId);
          if (!persisted) throw new Error("The controlled-document register record could not be verified after creation.");
          break;
        } catch (error) {
          if (attempt === 2) throw new Error(`Document upload completed, but the document could not be saved to the IRPA controlled-document register: ${error?.message || "Firestore registration failed."}`);
        }
      }
      const doc = {...pendingDocument.doc, id: documentId};
      setGeneratedReference(pendingDocument.documentReference);
      setMessage(`Document saved successfully. System reference ${pendingDocument.documentReference} is now registered in the IRPA controlled-document register.`);
      setPendingDocument(null);
      setFile(null);
      setTitle("");
      setDocumentType("");
      setVersion("1.0");
      setArchiveCategory("");
      setClassification("Public");
      fileInputRef.current?.form?.reset?.();
      onUploaded?.(doc);
    } catch (x) {
      setError(x.message || "Unable to save document.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("Preparing document upload…");
    setError("");
    setGeneratedReference("");

    try {
      if (!auth.currentUser) throw new Error("You must be signed in.");
      if (!file) throw new Error("Select a document file to upload.");
      if (file.size <= 0) throw new Error("The selected document is empty.");
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("Documents must not exceed 10 MB.");
      const contentType = resolveContentType(file);
      if (contentType === "application/octet-stream") throw new Error("The selected file format is not supported. Choose PDF, Word, Excel, PowerPoint, OpenDocument, text/CSV, or an image document.");

      const name = (title.trim() || file.name.replace(/\.pdf$/i, "")).slice(0, 160);
      const documentReference = await nextDocumentReference();
      const documentUid = documentReference;
      const uploadedAt = new Date().toISOString();
      const effectiveArchiveCategory = ARCHIVE_CATEGORIES[documentType] || documentType;
      const effectiveClassification = documentType === "Administrator" ? "Restricted" : classification;
      if (effectiveClassification === "Restricted" && !allowRestrictedUpload) throw new Error("Restricted document upload requires special permission.");
      const destination = buildDocumentArchiveDestination({documentType,uploadedAt,archiveCategory:effectiveArchiveCategory,classification:effectiveClassification});
      setMessage("Routing the document into its selected document-type and upload-time destination…");
      const routed = await uploadControlledDocumentRouted({
        documentId: documentUid,
        title: name,
        reference: documentReference,
        documentReference,
        documentReferenceType: "Controlled Document",
        documentType,
        contentType,
        archiveCategory: effectiveArchiveCategory,
        classification: effectiveClassification,
        uploadedAt,
        file
      });
      const archive = routed.categoryArchive;
      const governanceArchive = routed.governanceArchive;
      const now = new Date().toISOString();
      const workflowContext = readWorkflowContext();
      const documentPayload = withWorkflowLinks({
        title: name,
        reference: documentReference,
        documentReference,
        documentType,
        documentTypeSelectedAt: uploadedAt,
        documentUploadDestinationKey: destination.destinationKey,
        documentUploadArchiveCategory: effectiveArchiveCategory,
        documentUploadYear: destination.uploadYear,
        documentUploadMonth: destination.uploadMonth,
        documentUploadDay: destination.uploadDay,
        version,
        documentUid,
        archiveCategory: effectiveArchiveCategory,
        classification: effectiveClassification,
        archiveFolderId: archive.folderId,
        archiveUidLink: archive.archiveUidLink,
        archivePath: archive.archivePath,
        archiveAccess: archive.archiveAccess || (effectiveClassification === "Public" ? "Public" : "Restricted"),
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
        storagePath: `document-archives/${effectiveArchiveCategory}/${effectiveClassification}/${documentUid}/${file.name}`,
        webViewLink: archive.file?.webViewLink || null,
        fileUrl: archive.file?.fileId ? `drive://${archive.file.fileId}` : null,
        contentType,
        fileSize: file.size,
        purpose,
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid],
        uploadedByUid: auth.currentUser.uid,
        uploadedByEmail: auth.currentUser.email || null,
        uploadedAt: uploadedAt,
        uploadedAtDisplay: new Date(now).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", hour12: false })
      }, workflowContext || {});
      const doc = {
        id: null,
        title: name,
        reference: documentReference,
        documentType,
        documentTypeSelectedAt: uploadedAt,
        documentUploadDestinationKey: destination.destinationKey,
        documentUploadArchiveCategory: effectiveArchiveCategory,
        documentUploadYear: destination.uploadYear,
        documentUploadMonth: destination.uploadMonth,
        documentUploadDay: destination.uploadDay,
        uploadedAt,
        version,
        fileName: file.name,
        fileId: archive.file?.fileId || null,
        storageProvider: "Google Drive",
        webViewLink: archive.file?.webViewLink || null,
        fileUrl: archive.file?.fileId ? `drive://${archive.file.fileId}` : null,
        purpose,
        archiveCategory: effectiveArchiveCategory,
        classification: effectiveClassification,
        archiveFolderId: archive.folderId,
        archiveUidLink: archive.archiveUidLink,
        archivePath: archive.archivePath,
        archiveAccess: archive.archiveAccess || (effectiveClassification === "Public" ? "Public" : "Restricted"),
        governanceArchiveFolderId: governanceArchive?.folderId || null,
        governanceArchiveUidLink: governanceArchive?.archiveUidLink || null,
        governanceArchivePath: governanceArchive?.archivePath || null,
        governanceArchiveFileId: governanceArchive?.file?.fileId || null,
        governanceArchiveFileWebViewLink: governanceArchive?.file?.webViewLink || null,
        governanceArchiveStatus: governanceArchive ? "Routed" : "Not Required",
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid]
      };
      if (deferSave) {
        setPendingDocument({documentPayload,doc,documentReference});
        setGeneratedReference(documentReference);
        setMessage(`Document uploaded successfully to Google Drive: ${name}. Click “Save Document” to register it in the IRPA controlled-document archive.`);
      } else {
        let documentId = "";
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            documentId = await createRecord(COLLECTIONS.documents, documentPayload);
            const persisted = await getRecord(COLLECTIONS.documents, documentId);
            if (!persisted) throw new Error("The controlled-document register record could not be verified after creation.");
            break;
          } catch (error) {
            if (attempt === 2) throw new Error(`Document archive upload completed, but the document could not be saved to the IRPA controlled-document register: ${error?.message || "Firestore registration failed."}`);
          }
        }
        setGeneratedReference(documentReference);
        setMessage(`Document uploaded successfully to Google Drive: ${name}. System reference ${documentReference} assigned. Archive routing completed.`);
        setFile(null);
        setTitle("");
        setDocumentType("");
        setVersion("1.0");
        setArchiveCategory("");
        setClassification("Public");
        e.target.reset();
        onUploaded?.({...doc,id:documentId});
      }
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
            Upload PDF and other supported document formats into the controlled IRPA document register. Files retain their native format in the configured IRPA Google Drive account and governance metadata remains in Firestore.
          </p>
        </div>
      </div>
      {message && <div className="success-message action-feedback">{message}</div>}
      {error && <div className="error-message action-feedback">{error}</div>}
      {!compact && <div className="archive-routing-panel" style={{marginBottom:16}}>
        <strong>Google Drive Archive Routing</strong>
        <div style={{marginTop:6}}>Choose where this document will be stored:</div>
        <ul style={{margin:"6px 0 0 20px"}}>
          <li><strong>Finance Documents</strong> — finance records and supporting evidence.</li>
          <li><strong>Procurement Documents</strong> — procurement records, quotations, evaluations and purchase documentation.</li>
          <li><strong>Governance Documents</strong> — Board, committee, resolutions, decisions and other governance records.</li>
          <li><strong>Administrative Documents</strong> — policies, governance, HR and general administrative records.</li>
          <li><strong>Administrator Documents</strong> — restricted administrator records (special permission required).</li>
        </ul>
        <div style={{marginTop:6}}>Each archive is separated by <strong>Public, Internal, Confidential</strong> or <strong>Restricted</strong> classification. The selected route is recorded with the document UID and archive link.</div>
      </div>}
      {compact && <div className="identity-card" style={{marginBottom:14}}><span>Archive is selected before Save</span><small>Choose the document type and access classification, then select the file. The Save action commits the document to the selected archive.</small></div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field">
            <label>Document Routing</label>
            <div className="auth-message" role="status"><strong>{documentType ? `Final destination: ${documentType}` : "Select a document type first"}</strong><small style={{display:"block",marginTop:6}}>The selected document type determines the final archive destination at upload time.</small></div>
          </div>
          <div className="form-field">
            <label>Access Classification</label>
            {documentType === "Administrator" ? <div className="auth-message" role="status"><strong>Restricted</strong><small style={{display:"block",marginTop:6}}>{allowRestrictedUpload ? "Special permission active: Administrator/restricted documents may be uploaded." : "Administrator/restricted documents require special permission and are locked for this uploader."}</small></div> : <select value={classification} onChange={e => { const value=e.target.value; if(value === "Restricted" && !allowRestrictedUpload){setError("Restricted document upload requires special permission."); return;} setClassification(value); }}><option>Public</option><option>Internal</option><option>Confidential</option><option value="Restricted" disabled={!allowRestrictedUpload}>Restricted</option></select>}
            {documentType !== "Administrator" && !allowRestrictedUpload && <small className="muted" style={{display:"block",marginTop:6}}>Restricted classification is locked. Special permission is required to upload Restricted documents.</small>}
            {documentType !== "Administrator" && allowRestrictedUpload && <small className="muted" style={{display:"block",marginTop:6}}>Special permission active: Restricted classification is available for this authorized uploader.</small>}
          </div>
          <div className="form-field">
            <label>Document Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter document title" />
          </div>
          <div className="form-field"><label>Document Reference / Identification No.</label><div className="auth-message" role="status" aria-live="polite"><strong>{generatedReference || "Assigned automatically at upload"}</strong><small style={{display:"block",marginTop:6}}>The identifier is generated transactionally by IRPA-DBGS. There is no manual reference-entry field.</small></div></div>
          <div className="form-field">
            <label>Document Type</label>
            <select value={documentType} onChange={e => { const value=e.target.value; setDocumentType(value); setArchiveCategory(ARCHIVE_CATEGORIES[value] || value); }} aria-label="Document Type" required>
              <option value="">Select document type</option>
              {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{type}{type === "Governance" ? " — Sensitive" : type === "Administrator" ? " — Restricted" : ""}</option>)}
            </select>
            <small className="muted" style={{display:"block",marginTop:6}}>Five canonical document types only. Governance is sensitive; Administrator is restricted.</small>
          </div>
<div className="form-field"><label>Version</label><input value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. 1.0" />
          </div>
          <div className="form-field">
            <label>Document File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={e => {
                const selected = e.target.files?.[0] || null;
                setFile(selected);
                setError("");
                setMessage(selected ? `${selected.name} selected. Click “Upload Document” to continue.` : "No document selected.");
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
              Select a file
            </button>
            <div className="muted" style={{ marginTop: 8 }}>
              {file ? `Selected: ${file.name} (${resolveContentType(file)})` : "Select a PDF or another supported document format directly from this device."}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button
            type={deferSave && pendingDocument ? "button" : "submit"}
            onClick={deferSave && pendingDocument ? savePendingDocument : undefined}
            disabled={busy || (!pendingDocument && (!file || !documentType || (documentType === "Administrator" && !allowRestrictedUpload)))}
            aria-busy={busy ? "true" : "false"}
          >
            {busy ? "Saving…" : (deferSave && pendingDocument ? "Save Document" : submitLabel)}
          </button>
        </div>
      </form>
    </section>
  );
}
