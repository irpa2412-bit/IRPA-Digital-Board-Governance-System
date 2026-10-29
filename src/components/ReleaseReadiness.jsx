import React, { useState } from "react";
import { getIdToken } from "firebase/auth";
import { auth } from "../firebase/config";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";

const webCommit = String(import.meta.env.VITE_BUILD_COMMIT || "unavailable");

export default function ReleaseReadiness({ admin = false }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [integrationSecrets, setIntegrationSecrets] = useState([]);

  if (!admin) return <section className="panel" role="status"><h2 id="release-readiness-title">Release Readiness</h2><p>Required role: Administrator. Your account is not authorized to run release diagnostics.</p></section>;

  async function runAllChecks() {
    setBusy(true);
    setCopyMessage("");
    const lines = [];
    const add = (name, result, reason) => { const status = result === "NEEDS CONFIGURATION" ? "NEEDS CONFIGURATION" : (result === true || result === "PASS") ? "PASS" : "FAIL"; lines.push(status + " | " + name + " | " + String(reason || (status === "PASS" ? "Check passed." : status === "NEEDS CONFIGURATION" ? "Required configuration is missing." : "Check failed."))); };
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
      const startedAt = Date.now();
      let response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try { response = await fetch(gateway + "/api/system/release-readiness", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ webBuildCommit: webCommit }),
          signal: controller.signal
        }); } finally { clearTimeout(timer); }
      } catch (networkError) {
        const elapsedMs = Date.now() - startedAt;
        add("Worker Release Readiness route", false, "could not reach the Worker (network or timeout); elapsed " + elapsedMs + " ms. " + String(networkError?.message || "No HTTP response."));
        setReport(lines.join("\n"));
        return;
      }
      const payload = await response.json().catch(() => ({}));
      setIntegrationSecrets(Array.isArray(payload.integrationSecrets) ? payload.integrationSecrets : []);
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
        add(item.name || "Unnamed Worker check", item.status === "NEEDS CONFIGURATION" ? "NEEDS CONFIGURATION" : item.status === "PASS", item.reason || "Worker returned no reason.");
      }
      const portalProbes = [
        ["Worker health", "/health", "GET", null, [200]],
        ["Editorial posts/items list", "/api/communications/editorial/items", "GET", null, [200]],
        ["Editorial post creation validation (no content created)", "/api/communications/editorial/items", "POST", {}, [400, 403]],
        ["Editorial update route (missing test ID)", "/api/communications/editorial/items/__irpa_self_test_missing_item__", "PATCH", { title: "validation probe" }, [404, 403]],
        ["Submit-for-approval route (missing test ID)", "/api/communications/editorial/items/__irpa_self_test_missing_item__/submit", "POST", {}, [404, 403]],
        ["Approve route (missing test ID)", "/api/communications/editorial/items/__irpa_self_test_missing_item__/approve", "POST", {}, [404, 403]],
        ["Reject route (missing test ID)", "/api/communications/editorial/items/__irpa_self_test_missing_item__/reject", "POST", {}, [404, 403]],
        ["Pause-all status", "/api/communications/publishing/pause", "GET", null, [200]],
        ["Pause-all change route (empty body; no change)", "/api/communications/publishing/pause", "POST", null, [400, 403]],
        ["Editorial audit log", "/api/communications/editorial/audit", "GET", null, [200, 403]],
        ["Social connection status", "/api/communications/social/status", "GET", null, [200]],
        ["Add-signer dry-run validation (empty body; no write)", "/api/signature-workflow/add-signer-dry-run", "POST", {}, [400]],
        ["WordPress connection status", "/api/communications/site/status", "GET", null, [200, 503]],
        ["WordPress pages list", "/api/communications/website/content?type=pages", "GET", null, [200, 503]],
        ["WordPress posts list", "/api/communications/website/content?type=posts", "GET", null, [200, 503]],
        ["WordPress page update validation (empty body)", "/api/communications/website/content", "PUT", {}, [400, 503]],
        ["WordPress publish validation (empty body; no publish)", "/api/communications/website/publish", "POST", {}, [400, 503]],
        ["WordPress revision history", "/api/communications/website/revisions?type=pages&id=__irpa_self_test_missing_item__", "GET", null, [200, 400, 404, 503]],
        ["Media library records", "/api/communications/records?collection=communicationMediaItems", "GET", null, [200]],
        ["Media/story write validation (invalid collection; no record created)", "/api/communications/records", "POST", { collection: "__irpa_self_test_invalid_collection__", action: "create" }, [400, 403]],
        ["Monthly funder report source data", "/api/communications/records?collection=communicationMediaItems", "GET", null, [200]],
        ["cPanel files GET route", "/api/communications/cpanel/files", "GET", null, [200, 503]],
        ["cPanel file PUT validation route", "/api/communications/cpanel/files", "PUT", {}, [400, 503]],
        ["cPanel rollback validation route", "/api/communications/cpanel/rollback", "POST", {}, [400, 503]]
      ];
      for (const [name, path, method, body, expected] of portalProbes) {
        try {
          const probeStartedAt = Date.now();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          let probeResponse;
          try { probeResponse = await fetch(gateway + path, {
            method,
            headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal
          }); } finally { clearTimeout(timer); }
          const responseText = await probeResponse.text();
          let responseData = {};
          try { responseData = JSON.parse(responseText); } catch {}
          const detail = String(responseData.error || responseData.message || (responseText ? responseText.slice(0, 140) : "No response body"));
          const needsConfiguration = probeResponse.status === 503 && /Missing required Worker secrets:/i.test(detail);
          const passed = expected.includes(probeResponse.status) && !needsConfiguration;
          add("Portal Self-Test: " + name, needsConfiguration ? "NEEDS CONFIGURATION" : passed, "HTTP " + probeResponse.status + "; expected " + expected.join("/") + ". " + detail);
          if (name === "WordPress connection status" && probeResponse.ok) {
            const websiteState = String(responseData.website || "unknown");
            const diagnosticCode = String(responseData.websiteDiagnosticCode || "");
            const diagnosticMessage = String(responseData.websiteDiagnosticMessage || "");
            const missing = Array.isArray(responseData.websiteMissingSettings) ? responseData.websiteMissingSettings : [];
            if (websiteState === "not_configured" || missing.length) {
              add("WordPress connection configuration", "NEEDS CONFIGURATION",
                missing.length ? "Missing Worker setting names: " + missing.join(", ") + "." : diagnosticCode + (diagnosticMessage ? ": " + diagnosticMessage : "."));
            } else {
              const httpStatus = Number(responseData.websiteHttpStatus || 0);
              const reason = diagnosticMessage || diagnosticCode || websiteState;
              add("WordPress connection diagnosis", websiteState === "connected" ? "PASS" : false,
                "State: " + websiteState + (httpStatus ? "; HTTP " + httpStatus : "") + "; " + reason + ".");
            }
          }
        } catch (probeError) {
          add("Portal Self-Test: " + name, false, "could not reach the Worker (network or timeout); elapsed " + (Date.now() - (typeof probeStartedAt === "number" ? probeStartedAt : Date.now())) + " ms. " + String(probeError?.message || probeError));
        }
      }
            const passCount = lines.filter(line => line.startsWith("PASS |")).length;
      const configCount = lines.filter(line => line.startsWith("NEEDS CONFIGURATION |")).length;
      const failCount = lines.filter(line => line.startsWith("FAIL |")).length;
      lines.unshift(passCount + " PASS, " + configCount + " NEEDS CONFIGURATION, " + failCount + " FAIL");
      add("Overall Release Readiness", failCount === 0, failCount === 0 ? "No failed checks; configuration gaps are listed separately." : "One or more checks failed; review each FAIL line above.");
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
      {integrationSecrets.length > 0 && <section aria-labelledby="integration-secrets-title" style={{ marginTop: 16 }}><h3 id="integration-secrets-title">NEEDS CONFIGURATION — Production Worker integration secrets</h3><p>Names and binding status only. Secret values are never returned or displayed.</p><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr><th scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Integration</th><th scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Expected secret/variable NAME</th><th scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Bound</th></tr></thead><tbody>{integrationSecrets.map(item => <tr key={item.integration + "-" + item.name}><td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{item.integration}</td><td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontFamily: "monospace", overflowWrap: "anywhere" }}>{item.name}</td><td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontWeight: 700 }}>{String(item.bound)}</td></tr>)}</tbody></table></div></section>}
      <div className="form-actions">
        <button type="button" onClick={runAllChecks} disabled={busy}>{busy ? "Running all checks…" : "Run all checks"}</button>
        <button type="button" className="secondary-button" onClick={copyReport} disabled={!report}>Copy report</button>
      </div>
      {copyMessage && <p role="status" aria-live="polite">{copyMessage}</p>}
      {report && <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.5, padding: 12, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", maxHeight: "65vh", overflow: "auto" }}>{report}</pre>}
    </section>
  );
}
