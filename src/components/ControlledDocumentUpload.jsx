import React, { useRef, useState } from "react";
import { auth } from "../firebase/config";
import { createRecord, COLLECTIONS } from "../firebase/data";
import { readWorkflowContext, withWorkflowLinks } from "../firebase/workflowLinks";
import { uploadBytes, ref } from "../firebase/signatureStorage";

export default function ControlledDocumentUpload({ purpose = "Controlled Document", onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

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
      const target = ref(null, `controlled-documents/${purpose}/${name}.pdf`);
      setMessage("Uploading PDF to Google Drive…");
      const uploaded = await uploadBytes(target, file, {
        contentType: "application/pdf",
        purpose
      });

      const now = new Date().toISOString();
      const workflowContext = readWorkflowContext();
      setMessage("Google Drive upload complete. Registering the document…");
      const documentId = await createRecord(COLLECTIONS.documents, withWorkflowLinks({
        title: name,
        recordOrigin: "PRODUCTION",
        fileName: file.name,
        fileId: target.fileId,
        storageProvider: "Google Drive",
        storagePath: target.path,
        webViewLink: uploaded.metadata?.webViewLink || null,
        fileUrl: target.fileId ? `drive://${target.fileId}` : null,
        contentType: "application/pdf",
        fileSize: file.size,
        purpose,
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid],
        uploadedByUid: auth.currentUser.uid,
        uploadedByEmail: auth.currentUser.email || null,
        uploadedAt: now
      }, workflowContext || {}));

      const doc = {
        id: documentId,
        title: name,
        fileName: file.name,
        fileId: target.fileId,
        storageProvider: "Google Drive",
        webViewLink: uploaded.metadata?.webViewLink || null,
        fileUrl: target.fileId ? `drive://${target.fileId}` : null,
        purpose,
        status: "Draft",
        authorizationStatus: "Draft",
        authorizedUids: [auth.currentUser.uid]
      };

      setMessage(`Document uploaded successfully to Google Drive: ${name}.`);
      setFile(null);
      setTitle("");
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
    <section className="panel">
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
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field">
            <label>Document Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter document title" />
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
