import React, { Suspense, useEffect, useId, useRef, useState } from "react";
import ControlledDocumentUpload from "./ControlledDocumentUpload";

const DocumentReader = React.lazy(() => import("./DocumentReader"));

export default function PortalDocumentAccessPoint({
  portal = "Current Portal",
  allowRestrictedUpload = false
}) {
  const [open, setOpen] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const label = String(portal || "Current Portal").trim() || "Current Portal";
  const uploadRegionId = useId();
  const uploadRegionRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      uploadRegionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function toggleUpload() {
    setOpen(current => !current);
  }

  return (
    <section
      className="portal-document-access-point"
      aria-label={`Document access for ${label}`}
      style={{ marginBottom: 16 }}
    >
      <div
        className="panel portal-document-access-point-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          position: "relative"
        }}
      >
        <div>
          <span className="eyebrow">DOCUMENT ACCESS POINT</span>
          <h3 style={{ margin: "4px 0" }}>{label} — Upload Documents</h3>
          <p className="panel-description" style={{ margin: 0 }}>
            Upload PDF or another supported document in its native format. Select the document type before upload so IRPA-DBGS records the final archive destination at upload time.
          </p>
        </div>
        <button
          type="button"
          className="portal-document-access-point-trigger"
          aria-expanded={open}
          aria-controls={uploadRegionId}
          onClick={toggleUpload}
        >
          {open ? "Close Document Upload" : "Upload Document"}
        </button>
      </div>

      {open && (
        <div
          id={uploadRegionId}
          ref={uploadRegionRef}
          className="portal-document-access-point-form"
          style={{ marginTop: 12, position: "relative" }}
        >
          <ControlledDocumentUpload
            purpose={`${label} — Document Upload`}
            allowRestrictedUpload={allowRestrictedUpload}
            onUploaded={doc => setUploaded(doc)}
          />
        </div>
      )}

      {uploaded && (
        <>
          <div className="success-message action-feedback" role="status" style={{ marginTop: 12 }}>
            Document ready in the IRPA controlled-document register: <strong>{uploaded.title || uploaded.fileName}</strong> · {uploaded.reference || "Reference assigned"}.
          </div>
          <div className="form-actions" style={{ marginTop: 8 }}>
            {uploaded.fileId && (
              <button type="button" onClick={() => setReaderOpen(true)}>
                Open in IRPA Reader
              </button>
            )}
          </div>
        </>
      )}

      {readerOpen && (
        <Suspense fallback={<div className="panel" role="status">Opening IRPA Document Reader…</div>}>
          <DocumentReader document={uploaded} onClose={() => setReaderOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
