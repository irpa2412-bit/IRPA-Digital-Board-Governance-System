import React, { useState } from "react";
import { getIdToken } from "firebase/auth";
import { auth } from "../firebase/config";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";

const webCommit = String(import.meta.env.VITE_BUILD_COMMIT || "unavailable");

export default function ReleaseReadiness() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  async function runAllChecks() {
    setBusy(true);
    setCopyMessage("");
    const lines = [];
    const add = (name, ok, reason) => lines.push((ok ? "PASS" : "FAIL") + " | " + name + " | " + String(reason || (ok ? "Check passed." : "Check failed.")));
    try {
      const user = auth.currentUser;
      if (!user) {
        add("Administrator session", false, "Sign in with an authorized IRPA Administrator account, then run the checks again.");
        setReport(lines.join("\n"));
        return;
      }
      const token = await getIdToken(user, true);
      const gateway = String(getGoogleDriveGatewayUrl() || "").replace(/\/+$/, "");
      add("Web build stamp", webCommit !== "unavailable", webCommit === "unavailable" ? "VITE_BUILD_COMMIT is missing from this web build." : "Web build commit is " + webCommit + ".");
      if (!gateway) {
        add("Worker diagnostics endpoint", false, "Worker URL is missing from this web build.");
        setReport(lines.join("\n"));
        return;
      }
      const response = await fetch(gateway + "/api/system/release-readiness", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ webBuildCommit: webCommit })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        add("Worker Release Readiness route", false, "HTTP " + response.status + ": " + String(payload.error || "Worker did not return a diagnostic report."));
        setReport(lines.join("\n"));
        return;
      }
      const workerCommit = String(payload.workerCommit || "unknown");
      add("Worker commit from /health", workerCommit !== "unknown", workerCommit === "unknown" ? "Worker did not report GIT_SHA." : "Worker commit is " + workerCommit + ".");
      add("Web build stamp matches Worker commit", webCommit !== "unavailable" && workerCommit !== "unknown" && webCommit === workerCommit,
        webCommit === workerCommit ? "Both report " + webCommit + "." : "Web reports " + webCommit + "; Worker reports " + workerCommit + ".");
      for (const item of Array.isArray(payload.checks) ? payload.checks : []) {
        add(item.name || "Unnamed Worker check", item.status === "PASS", item.reason || "Worker returned no reason.");
      }
      add("Overall Release Readiness", lines.every(line => line.startsWith("PASS |")), lines.every(line => line.startsWith("PASS |")) ? "Every executed check passed." : "One or more checks failed or remain blocked; review every line above.");
    } catch (error) {
      add("Release Readiness execution", false, String(error?.message || error));
    } finally {
      setReport(lines.join("\n"));
      setBusy(false);
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyMessage("Report copied.");
    } catch {
      setCopyMessage("Clipboard access was blocked. Select and copy the plain-text report below.");
    }
  }

  return (
    <section className="panel" aria-labelledby="release-readiness-title">
      <div className="panel-header">
        <div>
          <span className="eyebrow">PRODUCTION RELEASE GATE</span>
          <h2 id="release-readiness-title">Release Readiness</h2>
          <p className="panel-description">Administrator-only, read-only diagnostics. Drive reconciliation is dry-run; add-signer is never submitted as a live write. A FAIL or blocked probe must be resolved before release.</p>
        </div>
      </div>
      <div className="form-actions">
        <button type="button" onClick={runAllChecks} disabled={busy}>{busy ? "Running all checks…" : "Run all checks"}</button>
        <button type="button" className="secondary-button" onClick={copyReport} disabled={!report}>Copy report</button>
      </div>
      {copyMessage && <p role="status" aria-live="polite">{copyMessage}</p>}
      {report && <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.5, padding: 12, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", maxHeight: "65vh", overflow: "auto" }}>{report}</pre>}
    </section>
  );
}
