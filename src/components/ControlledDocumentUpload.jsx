import React, { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { auth } from "../firebase/config";
import { functions } from "../firebase/functions";

const uploadDocumentToGoogleDrive = httpsCallable(functions, "uploadDocumentToGoogleDrive");

export default function ControlledDocumentUpload({ purpose = "Controlled Document", onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");

    try {
      if (!auth.currentUser) throw new Error("You must be signed in.");
      if (!file) throw new Error("Select a PDF document to upload.");
      if (file.type !== "application/pdf") throw new Error("Only PDF documents are accepted.");
      if (file.size > 10 * 1024 * 1024) throw new Error("PDF must not exceed 10 MB.");

      const name = (title.trim() || file.name.replace(/\.pdf$/i, "")).slice(0, 160);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
      }
      const base64 = btoa(binary);

      const result = await uploadDocumentToGoogleDrive({
        fileName: file.name,
        title: name,
        purpose,
        contentType: "application/pdf",
        fileSize: file.size,
        base64
      });

      const doc = result.data?.document;
      if (!doc) throw new Error("Google Drive upload completed without a document record.");

      setMessage(`Document uploaded successfully to Google Drive: ${name}.`);
      setFile(null);
      setTitle("");
      e.target.reset();
      onUploaded?.(doc);
    } catch (x) {
      setError(x.message || "Unable to upload document to Google Drive.");
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
            Upload the source PDF into the controlled IRPA document register. Files are stored in the configured IRPA Google Drive account and the governance metadata remains in Firestore.
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
            <input type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} required />
          </div>
        </div>
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Uploading to Google Drive…" : "Upload Controlled PDF"}</button>
        </div>
      </form>
    </section>
  );
}
