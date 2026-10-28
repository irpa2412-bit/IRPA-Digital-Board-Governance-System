/**
 * Fail-closed maintenance orchestration for the isolated staging WordPress site.
 *
 * Requires a separately installed hosting adapter implementing the documented
 * IRPA maintenance API. No WordPress mutation is attempted when the adapter,
 * token, restorable backup, staging checks, or pinned update manifest is absent.
 */
const STAGING_HOST = "staging.irpa.or.tz";
const API_PATH = "/wp-json/irpa-maintenance/v1";
const ALLOWED_REPAIRS = new Set(["cache.clear", "service.restart"]);
const ALLOWED_UPDATE_TYPES = new Set(["core", "plugin", "theme"]);
const env = process.env;

function assertAdapterUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("Maintenance adapter URL is missing or invalid."); }
  if (url.protocol !== "https:" || url.hostname !== STAGING_HOST ||
      url.pathname.replace(/\/+$/, "") !== API_PATH || url.username || url.password || url.search || url.hash) {
    throw new Error("Refusing maintenance adapter outside the exact HTTPS staging endpoint.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function classifyFault(fault = {}) {
  const kind = String(fault.kind || "").toLowerCase();
  const code = String(fault.code || "").toLowerCase();
  if (["timeout", "network", "http_429", "http_502", "http_503", "http_504"].includes(code)) {
    return { classification: "transient", action: "retry", automatic: true };
  }
  if (kind === "cache" && fault.safeToClear === true) {
    return { classification: "recoverable", action: "cache.clear", automatic: true };
  }
  if (kind === "service" && fault.serviceRestartApproved === true && /^[a-z0-9-]{1,48}$/.test(String(fault.service || ""))) {
    return { classification: "recoverable", action: "service.restart", automatic: true, service: fault.service };
  }
  if (["wordpress_update", "plugin_update", "theme_update", "core_update"].includes(kind)) {
    return { classification: "maintenance", action: "staging.update", automatic: true };
  }
  return { classification: "manual_review", action: "report_only", automatic: false };
}

export function validateUpdateManifest(manifest = {}) {
  if (manifest.environment !== "staging" || !Array.isArray(manifest.updates)) {
    throw new Error("Update manifest must explicitly target staging and contain an updates array.");
  }
  const seen = new Set();
  for (const update of manifest.updates) {
    if (!ALLOWED_UPDATE_TYPES.has(update?.type) || typeof update?.version !== "string" ||
        !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(update.version)) {
      throw new Error("Every update must specify an allowlisted type and an exact pinned version.");
    }
    if (update.type !== "core" && !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(String(update.slug || ""))) {
      throw new Error("Plugin and theme updates require a valid exact slug.");
    }
    const key = update.type + ":" + (update.slug || "wordpress") ;
    if (seen.has(key)) throw new Error("Update manifest contains a duplicate package.");
    seen.add(key);
  }
  return manifest.updates.map(item => ({ type: item.type, slug: item.slug || null, version: item.version }));
}

export async function runMaintenance({ adapterUrl, token, manifest, fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const result = { startedAt: now(), target: "staging", actions: [], status: "blocked" };
  if (!adapterUrl || !token) {
    result.status = "disabled";
    result.actions.push({ action: "none", outcome: "skipped", detail: "Restricted staging maintenance adapter and token are not configured." });
    return result;
  }
  const base = assertAdapterUrl(adapterUrl);
  const updates = validateUpdateManifest(manifest);
  const call = async (path, method = "GET", body) => {
    const response = await fetchImpl(base + path, {
      method,
      headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Maintenance adapter request failed with HTTP " + response.status + ".");
    return data;
  };
  let backup;
  try {
    const status = await call("/health");
    if (status.environment !== "staging" || status.siteHost !== STAGING_HOST || status.healthy !== true) {
      throw new Error("Staging preflight did not verify a healthy staging WordPress site.");
    }
    backup = await call("/backups/latest");
    if (backup.restorable !== true || !backup.id || !backup.createdAt ||
        Date.parse(backup.createdAt) < Date.now() - 24 * 60 * 60 * 1000) {
      throw new Error("A verified, restorable backup from the last 24 hours is required.");
    }
    result.backupId = String(backup.id);
    result.actions.push({ action: "preflight", outcome: "passed", detail: "Staging host, health, and recent restorable backup verified." });

    const faults = Array.isArray(status.faults) ? status.faults : [];
    for (const fault of faults) {
      const decision = classifyFault(fault);
      if (!decision.automatic || decision.action === "retry" || !ALLOWED_REPAIRS.has(decision.action)) {
        result.actions.push({ action: decision.action, outcome: "reported", classification: decision.classification, detail: String(fault.code || fault.kind || "unclassified fault").slice(0, 120) });
        continue;
      }
      if (decision.action === "service.restart" && status.allowedRestartServices?.includes(decision.service) !== true) {
        result.actions.push({ action: decision.action, outcome: "blocked", detail: "Service is not on the host adapter's restart allowlist." });
        continue;
      }
      const repair = await call("/repairs", "POST", { action: decision.action, ...(decision.service ? { service: decision.service } : {}) });
      const verify = await call("/health");
      const recovered = repair.success === true && verify.healthy === true &&
        !(Array.isArray(verify.faults) && verify.faults.some(item => item.code === fault.code && item.kind === fault.kind));
      result.actions.push({ action: decision.action, outcome: recovered ? "verified" : "failed", fault: String(fault.code || fault.kind || "unknown").slice(0, 120) });
      if (!recovered) throw new Error("Automatic repair did not pass post-repair health verification.");
    }

    if (updates.length) {
      // Adapter must run a dry-run compatibility plan before applying pinned updates.
      const plan = await call("/updates/plan", "POST", { updates });
      if (plan.compatible !== true || plan.environment !== "staging") {
        throw new Error("Staging compatibility plan did not approve the pinned updates.");
      }
      const applied = await call("/updates/apply", "POST", { updates, backupId: result.backupId });
      const verified = applied.success === true && (await call("/health")).healthy === true;
      if (!verified) throw new Error("Update verification failed; rollback will be attempted.");
      result.actions.push({ action: "pinned_updates", outcome: "verified", count: updates.length });
    }

    result.status = "passed";
  } catch (error) {
    result.error = String(error?.message || "Maintenance failed").slice(0, 240);
    if (backup?.id) {
      try {
        const rollback = await call("/rollback", "POST", { backupId: String(backup.id), reason: "automatic-maintenance-failure" });
        const health = await call("/health");
        const ok = rollback.success === true && health.healthy === true;
        result.actions.push({ action: "rollback", outcome: ok ? "verified" : "failed", backupId: String(backup.id) });
        result.status = ok ? "rolled_back" : "manual_intervention_required";
      } catch (rollbackError) {
        result.actions.push({ action: "rollback", outcome: "failed", detail: String(rollbackError?.message || "Rollback request failed").slice(0, 160) });
        result.status = "manual_intervention_required";
      }
    } else {
      result.status = "blocked";
    }
  }
  result.finishedAt = now();
  return result;
}

async function main() {
  let manifest = { environment: "staging", updates: [] };
  try {
    const raw = await (await import("node:fs/promises")).readFile(new URL("../maintenance/approved-updates.staging.json", import.meta.url), "utf8");
    manifest = JSON.parse(raw);
  } catch (error) {
    console.error("Could not read staging update manifest:", String(error?.message || error).slice(0, 160));
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runMaintenance({
      adapterUrl: env.STAGING_MAINTENANCE_API_URL,
      token: env.STAGING_MAINTENANCE_API_TOKEN,
      manifest
    });
    console.log(JSON.stringify(result, null, 2));
    if (["blocked", "manual_intervention_required"].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.error("Maintenance engine refused to run:", String(error?.message || error).slice(0, 240));
    process.exitCode = 1;
  }
}
if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
