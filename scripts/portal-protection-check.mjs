import fs from "node:fs";
import { execFileSync } from "node:child_process";

const HOURS_24 = 24 * 60 * 60 * 1000;
const isWithin = (file, path) => file === path || (path.endsWith("/") && file.startsWith(path));
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

export function parseActivityTimestamps(history) {
  return String(history || "").split(/\r?\n/).filter(Boolean);
}

export function portalPolicyPaths(affectedPortals) {
  if (!Array.isArray(affectedPortals) || affectedPortals.length !== 1) return null;
  const slug = affectedPortals[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    windowPath: `docs/portal-protection/windows/${slug}.json`,
    recordPath: `docs/portal-protection/records/${slug}.json`
  };
}


export function resolvePortalPolicyPaths(affectedPortals, exists = fs.existsSync) {
  const paths = portalPolicyPaths(affectedPortals);
  if (!paths) {
    return { ok: false, reason: "Protected changes must be split into one-portal PRs; multi-portal changes are blocked." };
  }
  if (!exists(paths.windowPath) || !exists(paths.recordPath)) {
    return { ok: false, reason: "A dedicated, portal-specific repair window and Change Record are required; shared records cannot substitute." };
  }
  return { ok: true, ...paths };
}

export function evaluatePolicy({ changedFiles, registry, windowState, record, now = Date.now(), latestActivityAt = null, activityTimestamps = [] }) {
  const affected = new Set();
  const protectedFiles = [];
  for (const file of changedFiles) {
    let matched = false;
    for (const [portal, entry] of Object.entries(registry.portals)) {
      if (entry.paths.some((p) => isWithin(file, p))) { affected.add(portal); matched = true; }
    }
    for (const shared of registry.shared ?? []) {
      if (isWithin(file, shared.path)) {
        for (const portal of shared.portals) affected.add(portal);
        matched = true;
      }
    }
    if (matched) protectedFiles.push(file);
  }
  if (!protectedFiles.length) return { ok: true, affected: [], protectedFiles: [], reason: "No protected portal or shared dependency changed." };

  const fail = (reason) => ({ ok: false, affected: [...affected].sort(), protectedFiles, reason });
  if (affected.size > 1) return fail("Protected changes must be split into one-portal PRs; multi-portal changes are blocked.");
  if (!record || record.status !== "complete") return fail("A completed Change Record is required.");
  if (!windowState || windowState.status !== "open") return fail("No repair window is open; closed windows require a new declaration.");
  const openedAt = Date.parse(windowState.openedAt);
  const activities = [...new Set([...(activityTimestamps ?? []), ...(latestActivityAt ? [latestActivityAt] : [])])]
    .map(Date.parse).filter((time) => Number.isFinite(time) && time >= openedAt).sort((a, b) => a - b);
  if (!Number.isFinite(openedAt) || !activities.length) return fail("No repair activity is recorded after the current window declaration.");
  let previousActivity = openedAt;
  for (const activityTime of activities) {
    if (activityTime - previousActivity >= HOURS_24) return fail("Repair window automatically closed after a 24-hour inactivity gap; a new declaration is required.");
    previousActivity = activityTime;
  }
  if (now - previousActivity >= HOURS_24) return fail("Repair window automatically closed after 24 consecutive hours without activity.");
  const scope = windowState.scope ?? [];
  const outOfScope = protectedFiles.filter((file) => !scope.some((p) => isWithin(file, p)));
  if (outOfScope.length) return fail("Out-of-scope protected files: " + outOfScope.join(", "));
  const declaredFiles = [...(record.declaration?.files ?? []), ...(record.activeAmendment?.files ?? [])];
  const missingDeclarations = protectedFiles.filter((file) => !declaredFiles.some((p) => isWithin(file, p)));
  if (missingDeclarations.length) return fail("Change Record omits changed files: " + missingDeclarations.join(", "));
  const declaredPortals = new Set(record.declaration?.affectedPortals ?? []);
  const missingPortals = [...affected].filter((portal) => !declaredPortals.has(portal));
  if (missingPortals.length) return fail("Change Record omits affected portals: " + missingPortals.join(", "));
  if (!record.declaration?.reason || !record.declaration?.expectedEffect || !Array.isArray(record.declaration?.prohibitedChanges) || !record.declaration.prohibitedChanges.length) return fail("Change Record must state reason, expected effect and prohibited changes.");
  if (!record.baseline?.commit || !record.baseline?.rollbackCommit) return fail("Baseline and rollback commits are mandatory.");
  if (record.validation?.baselineSmoke !== "PASS" || record.validation?.fullRegression !== "PASS") return fail("Baseline smoke and full regression must both be recorded as PASS.");
  const evidence = record.validation?.evidence;
  const runLink = /https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/job\/\d+/;
  const hasRunEvidence = label => Array.isArray(evidence) && evidence.some(item =>
    String(item).toLowerCase().includes(label.toLowerCase()) &&
    String(item).includes(record.baseline.commit) &&
    runLink.test(String(item))
  );
  if (!hasRunEvidence("baseline smoke") || !hasRunEvidence("full regression")) {
    return fail("Baseline smoke and full regression require real-run links tied to this portal baseline commit.");
  }
  const smoke = record.validation?.portalSmoke ?? {};
  const missingSmoke = [...affected].filter((portal) => smoke[portal] !== "PASS");
  if (missingSmoke.length) return fail("Missing passing smoke evidence for: " + missingSmoke.join(", "));
  const missingPortalRunEvidence = [...affected].filter(portal => !Array.isArray(evidence) || !evidence.some(item =>
    String(item).includes(portal) &&
    /portal smoke/i.test(String(item)) &&
    String(item).includes(record.baseline.commit) &&
    runLink.test(String(item))
  ));
  if (missingPortalRunEvidence.length) return fail("Missing portal-specific real-run smoke links for: " + missingPortalRunEvidence.join(", "));
  if (!Array.isArray(record.validation?.behaviourDifferences)) return fail("Baseline comparison must list behaviour differences (use an empty array when none).");
  return { ok: true, affected: [...affected].sort(), protectedFiles, reason: "Protected changes are declared and within the active repair window." };
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? "pull_request";
  const base = process.env.GITHUB_BASE_REF || "main";
  let changedFiles;
  if (event === "pull_request" || event === "pull_request_target") {
    execFileSync("git", ["fetch", "origin", base, "--depth=1"], { stdio: "inherit" });
    changedFiles = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } else {
    changedFiles = execFileSync("git", ["diff", "--name-only", "HEAD^...HEAD"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  }
  const registry = readJson("docs/portal-protection/portal-register.json");
  const discovery = evaluatePolicy({ changedFiles, registry, windowState: null, record: null });
  if (!discovery.protectedFiles.length) {
    console.log(JSON.stringify(discovery, null, 2));
    return;
  }
  const portalSelection = resolvePortalPolicyPaths(discovery.affected);
  if (!portalSelection.ok) {
    console.log(JSON.stringify({ ...discovery, ok: false, reason: portalSelection.reason }, null, 2));
    process.exitCode = 1;
    return;
  }
  const windowState = readJson(portalSelection.windowPath);
  const record = readJson(portalSelection.recordPath);
  const initial = evaluatePolicy({ changedFiles, registry, windowState, record });
  if (!initial.protectedFiles.length) {
    console.log(JSON.stringify(initial, null, 2));
    return;
  }
  const history = execFileSync("git", ["log", "--format=%cI", "--", ...initial.protectedFiles], { encoding: "utf8" }).trim();
  const activityTimestamps = parseActivityTimestamps(history);
  const result = evaluatePolicy({ changedFiles, registry, windowState, record, activityTimestamps });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  if (result.ok && result.protectedFiles.length) {
    const tests = [...new Set(result.affected.flatMap((p) => registry.portals[p].tests ?? []))];
    if (tests.length) {
      console.log("PORTAL_REGRESSION_TESTS_DEFERRED_TO_DEPENDENCY_READY_CI: " + tests.join(", "));
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
