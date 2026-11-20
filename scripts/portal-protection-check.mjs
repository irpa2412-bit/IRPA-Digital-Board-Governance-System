import fs from "node:fs";
import { execFileSync } from "node:child_process";

const HOURS_24 = 24 * 60 * 60 * 1000;
const isWithin = (file, path) => file === path || (path.endsWith("/") && file.startsWith(path));
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

export function parseActivityTimestamps(history) {
  return String(history || "").split(/\r?\n/).filter(Boolean);
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
  const activeAmendment = record.activeAmendment?.status === "open" ? record.activeAmendment : null;
  const declaration = activeAmendment ?? record.declaration;
  const validation = activeAmendment?.validation ?? record.validation;
  const declaredFiles = declaration?.files ?? [];
  const missingDeclarations = protectedFiles.filter((file) => !declaredFiles.some((p) => isWithin(file, p)));
  if (missingDeclarations.length) return fail("Change Record omits changed files: " + missingDeclarations.join(", "));
  const declaredPortals = new Set(declaration?.affectedPortals ?? []);
  const missingPortals = [...affected].filter((portal) => !declaredPortals.has(portal));
  if (missingPortals.length) return fail("Change Record omits affected portals: " + missingPortals.join(", "));
  if (!declaration?.reason || !declaration?.expectedEffect || !Array.isArray(declaration?.prohibitedChanges) || !declaration.prohibitedChanges.length) return fail("Change Record must state reason, expected effect and prohibited changes.");
  const rollbackCommit = activeAmendment?.repairWindow?.rollbackCommit ?? record.baseline?.rollbackCommit;
  if (!record.baseline?.commit || !rollbackCommit) return fail("Baseline and rollback commits are mandatory.");
  if (validation?.baselineSmoke !== "PASS" || validation?.fullRegression !== "PASS") return fail("Baseline smoke and full regression must both be recorded as PASS.");
  const smoke = validation?.portalSmoke ?? {};
  const missingSmoke = [...affected].filter((portal) => smoke[portal] !== "PASS");
  if (missingSmoke.length) return fail("Missing passing smoke evidence for: " + missingSmoke.join(", "));
  if (!Array.isArray(validation?.behaviourDifferences)) return fail("Baseline comparison must list behaviour differences (use an empty array when none).");
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
  const windowState = readJson("docs/portal-protection/repair-window.json");
  const recordPath = "docs/portal-protection/change-record.json";
  const record = fs.existsSync(recordPath) ? readJson(recordPath) : null;
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
