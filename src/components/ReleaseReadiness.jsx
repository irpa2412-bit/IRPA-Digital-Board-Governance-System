import React, { useState } from "react";
import { getIdToken } from "firebase/auth";
import { auth } from "../firebase/config";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";

const webCommit = String(import.meta.env.VITE_BUILD_COMMIT || "unavailable");
const SECTIONS = [
  ["core", "Core"],
  ["signing", "Signing"],
  ["communications", "Communications"],
  ["website", "Website integrations"]
];

export default function ReleaseReadiness({ admin = false }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  if (!admin) return <section className="panel" role="status"><h2 id="release-readiness-title">Release Readiness</h2><p>Required role: Administrator. Your account is not authorized to run release diagnostics.</p></section>;

  async function runAllChecks() {
    setBusy(true);
    setCopyMessage("");
    const lines = [];
    const add = (name, status, reason) => lines.push(status + " | " + name + " | " + String(reason || ""));
    const publish = () => setReport(lines.join("\n"));
    try {
      const user = auth.currentUser;
      if (!user) {
        add("Administrator session", "FAIL", "Sign in with an authorized IRPA Administrator account.");
        publish();
        return;
      }
      const token = await getIdToken(user, true);
      const gateway = String(getGoogleDriveGatewayUrl() || "").replace(/\/+$/, "");
      add("Web build stamp", webCommit !== "unavailable" ? "PASS" : "FAIL", "Web build commit: " + webCommit + ".");
      if (!gateway) {
        add("Worker diagnostics endpoint", "FAIL", "Worker URL is missing from this web build.");
        publish();
        return;
      }
      publish();
      for (const [section, label] of SECTIONS) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          let response;
          try {
            response = await fetch(gateway + "/api/system/release-readiness?section=" + encodeURIComponent(section), {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ section, webBuildCommit: webCommit }),
              signal: controller.signal
            });
          } finally { clearTimeout(timer); }
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            add(label + " section", "FAIL", "HTTP " + response.status + ": " + String(payload.error || "Worker returned no diagnostic detail."));
          } else {
            const commit = String(payload.workerCommit || "unknown");
            add(label + " section", "PASS", "Section completed; Worker commit: " + commit + ".");
            if (section === "core") {
              add("Web/Worker commit match", webCommit !== "unavailable" && commit !== "unknown" && webCommit === commit ? "PASS" : "FAIL",
                "Web: " + webCommit + "; Worker: " + commit + ".");
            }
            for (const item of Array.isArray(payload.checks) ? payload.checks : []) {
              const status = item.status === "NEEDS CONFIGURATION" ? "NEEDS CONFIGURATION" : item.status === "PASS" ? "PASS" : "FAIL";
              const extra = item.integrationStatus ? " [" + item.integrationStatus + (item.credentialBinding ? "; credentials " + item.credentialBinding : "") + (item.errorCode ? "; code " + item.errorCode : "") + (item.httpStatus ? "; HTTP " + item.httpStatus : "") + "]" : "";
              add(item.name || label + " check", status, String(item.reason || "No diagnostic reason returned.") + extra);
            }
          }
        } catch (error) {
          add(label + " section", "FAIL", (error?.name === "AbortError" ? "Browser request timed out after 10000ms." : String(error?.message || error)) + " Other sections will still run.");
        }
        publish();
      }
      const pass = lines.filter(line => line.startsWith("PASS |")).length;
      const config = lines.filter(line => line.startsWith("NEEDS CONFIGURATION |")).length;
      const fail = lines.filter(line => line.startsWith("FAIL |")).length;
      lines.unshift(pass + " PASS, " + config + " NEEDS CONFIGURATION, " + fail + " FAIL");
      publish();
    } catch (error) {
      add("Release Readiness execution", "FAIL", String(error?.message || error));
      publish();
    } finally {
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
          <p className="panel-description">Administrator-only, read-only checks run as four separate short requests. A slow website integration cannot block Core, Signing, or Communications results. Credential values are never displayed.</p>
        </div>
      </div>
      <div className="form-actions">
        <button type="button" onClick={runAllChecks} disabled={busy}>{busy ? "Running section checks…" : "Run all checks"}</button>
        <button type="button" className="secondary-button" onClick={copyReport} disabled={!report}>Copy report</button>
      </div>
      {copyMessage && <p role="status" aria-live="polite">{copyMessage}</p>}
      {report && <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.5, padding: 12, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", maxHeight: "65vh", overflow: "auto" }}>{report}</pre>}
    </section>
  );
}
