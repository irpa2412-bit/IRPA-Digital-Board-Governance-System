import fs from "node:fs";
import { execFileSync } from "node:child_process";

const HOURS_72 = 72 * 60 * 60 * 1000;
const WARNING_12 = 12 * 60 * 60 * 1000;
const BREAK_GLASS_24 = 24 * 60 * 60 * 1000;
const isWithin = (file, path) => file === path || (path.endsWith("/") && file.startsWith(path));
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

export function parseActivityTimestamps(history) {
  return String(history || "").split(/\r?\n/).filter(Boolean);
}

export function parseGitHubJobEvidence(value) {
  const match = String(value ?? "").match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)/);
  return match ? { repository: match[1], runId: Number(match[2]), jobId: Number(match[3]) } : null;
}

export const MAINTENANCE_APPROVAL_QUOTE = "Guard-core (#853): evaluate the guard-maintenance exception first, but only as a classification: it applies only when EVERY changed file is a protection file (scripts/portal-*, protection workflows and their tests, docs, per-portal window and record files, the register, the PR template), no portal source file, no Worker route, no Firestore rule and no deploy workflow is touched, and my approval is quoted by the owner account. If any file falls outside that list, the multi-portal rejection applies as before. Add and show four tests: a guard-only PR across seven portals passes with approval, the same PR fails without approval, a PR touching two portals' SOURCE files fails even with approval, and a PR mixing one protection file with one portal source file across two portals fails.";

export function isProtectionFile(path) {
  return [
    /^scripts\/portal-[^/]+\.mjs$/,
    /^scripts\/meeting-portal-fixture-isolation-guard\.sh$/,
    /^tests\/portal-(?:protection|repair-window)[^/]*\.test\.mjs$/,
    /^tests\/meeting-isolation-guard\.test\.mjs$/,
    /^docs\/(?:approvals\.md|implementation-status\.md)$/,
    /^docs\/portal-protection\/.+$/,
    /^\.github\/pull_request_template\.md$/,
    /^\.github\/workflows\/(?:portal-protection-guard-only|portal-repair-window-renewal|security-baseline|readability-release-gate|functions-entrypoint-integrity-test)\.yml$/
  ].some(pattern => pattern.test(path));
}

export function classifyProtectionOnlyChange(changedFiles, approval = null) {
  const files = [...new Set(changedFiles ?? [])];
  const hasPortalSource = files.some(path => /^(?:src|drive-gateway)\/.*\.(?:jsx?|mjs|cjs|ts|tsx)$/.test(path));
  const hasWorkerRoute = files.some(path => /^drive-gateway\/src\//.test(path));
  const hasFirestoreRule = files.some(path => /(?:^|\/)firestore\.rules$/.test(path));
  const hasDeployWorkflow = files.some(path => /^\.github\/workflows\/.*(?:deploy|publish|production)/i.test(path));
  const allProtectionFiles = files.length > 0 && files.every(isProtectionFile);
  const eligible = allProtectionFiles && !hasPortalSource && !hasWorkerRoute && !hasFirestoreRule && !hasDeployWorkflow;
  const ownerApproved = approval?.authorLogin && approval.authorLogin === approval.ownerLogin &&
    String(approval.body ?? "").includes(MAINTENANCE_APPROVAL_QUOTE);
  return {
    eligible,
    ownerApproved: Boolean(ownerApproved),
    ok: eligible && Boolean(ownerApproved),
    reason: !eligible
      ? "Maintenance exception rejected: every changed file must be an allowlisted protection file and no portal source, Worker route, Firestore rule or deploy workflow may change."
      : !ownerApproved
        ? "Protection-only maintenance requires the exact quoted approval from the repository owner account."
        : "Protection-only maintenance exception applies as classification only; no portal-source or deployment change is exempted."
  };
}

async function findOwnerMaintenanceApproval() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository || !eventPath || !fs.existsSync(eventPath)) return null;
  const event = readJson(eventPath);
  const pullNumber = event.pull_request?.number;
  if (!pullNumber) return null;
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const [repoResponse, commentsResponse] = await Promise.all([
    fetch(`${api}/repos/${repository}`, { headers }),
    fetch(`${api}/repos/${repository}/issues/${pullNumber}/comments?per_page=100`, { headers })
  ]);
  if (!repoResponse.ok || !commentsResponse.ok) return null;
  const ownerLogin = (await repoResponse.json()).owner?.login;
  const comments = await commentsResponse.json();
  const ownerComment = comments.find(comment =>
    comment.user?.login === ownerLogin && String(comment.body ?? "").includes(MAINTENANCE_APPROVAL_QUOTE)
  );
  return ownerComment ? { authorLogin: ownerComment.user.login, ownerLogin, body: ownerComment.body } : null;
}

export function newPortalWarningUntil(entry) {
  if (entry?.guardMode !== "warning") return null;
  const registeredAt = Date.parse(entry.registeredAt);
  return Number.isFinite(registeredAt) ? registeredAt + 7 * 24 * 60 * 60 * 1000 : null;
}

async function verifyRealRunEvidence(record, affected) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return { ok: false, reason: "GitHub Actions token/repository context is required to verify real baseline runs." };
  const labels = ["baseline smoke", "full regression", ...affected.map(portal => portal + " portal smoke")];
  const evidence = record.validation?.evidence ?? [];
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  for (const label of labels) {
    const candidates = evidence.filter(item => String(item).toLowerCase().includes(label.toLowerCase()) && String(item).includes(record.baseline.commit));
    let verified = false;
    for (const item of candidates) {
      const ref = parseGitHubJobEvidence(item);
      if (!ref || ref.repository.toLowerCase() !== repository.toLowerCase()) continue;
      const [jobResponse, logsResponse] = await Promise.all([
        fetch(`${api}/repos/${repository}/actions/jobs/${ref.jobId}`, { headers }),
        fetch(`${api}/repos/${repository}/actions/jobs/${ref.jobId}/logs`, { headers })
      ]);
      if (!jobResponse.ok || !logsResponse.ok) continue;
      const job = await jobResponse.json();
      const logs = await logsResponse.text();
      const checkedOutBaseline = logs.includes(`git checkout --progress --force ${record.baseline.commit}`) ||
        logs.includes(`HEAD is now at ${record.baseline.commit.slice(0, 8)}`);
      if (job.run_id === ref.runId && job.status === "completed" && job.conclusion === "success" && checkedOutBaseline) {
        verified = true;
        break;
      }
    }
    if (!verified) return { ok: false, reason: `No completed successful GitHub Actions job verifies ${label} on baseline ${record.baseline.commit}.` };
  }
  return { ok: true };
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

export function evaluatePolicy({ changedFiles, registry, windowState, record, ownerPolicies = null, now = Date.now(), latestActivityAt = null, activityTimestamps = [] }) {
  const sharedMatches = new Map();
  const specificAffected = new Set();
  const protectedFiles = [];
  for (const file of changedFiles) {
    const owners = new Set();
    for (const shared of registry.shared ?? []) {
      if (isWithin(file, shared.path)) {
        shared.portals.forEach(portal => owners.add(portal));
      }
    }
    if (owners.size) {
      sharedMatches.set(file, [...owners].sort());
      protectedFiles.push(file);
      continue;
    }
    const portalPolicyFile = file.match(/^docs\/portal-protection\/(?:windows|records)\/([a-z0-9-]+)\.json$/);
    if (portalPolicyFile) {
      const owner = Object.keys(registry.portals).find(name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === portalPolicyFile[1]);
      if (owner) {
        specificAffected.add(owner);
        protectedFiles.push(file);
        continue;
      }
    }
    if (isProtectionFile(file)) {
      Object.keys(registry.portals).forEach(portal => specificAffected.add(portal));
      protectedFiles.push(file);
      continue;
    }
    let matched = false;
    for (const [portal, entry] of Object.entries(registry.portals)) {
      if (entry.paths.some(path => isWithin(file, path))) {
        specificAffected.add(portal);
        matched = true;
      }
    }
    if (matched) protectedFiles.push(file);
  }

  const fail = (reason, affected = [...specificAffected].sort(), files = protectedFiles) =>
    ({ ok: false, affected, protectedFiles: files, reason });
  if (!protectedFiles.length) return { ok: true, affected: [], protectedFiles: [], sharedFiles: [], reason: "No protected portal or shared dependency changed." };

  if (sharedMatches.size) {
    if (specificAffected.size) {
      return fail("A shared-file change cannot be combined with portal-specific source changes; split the shared change into its own PR.");
    }
    const owners = [...new Set([...sharedMatches.values()].flat())].sort();
    const sharedFiles = [...sharedMatches.keys()].sort();
    if (!ownerPolicies) return { ok: true, affected: owners, protectedFiles: sharedFiles, sharedFiles, needsOwnerPolicies: true, reason: "Shared-file classification requires independent owner policies." };
    const ownerResults = [];
    for (const portal of owners) {
      const policy = ownerPolicies?.[portal] ?? (owners.length === 1 ? { windowState, record, activityTimestamps, latestActivityAt } : null);
      if (!policy?.windowState || !policy?.record) {
        return fail("Shared-file change is missing the dedicated repair window or Change Record for owner: " + portal, owners, sharedFiles);
      }
      const lockTests = registry.portals[portal]?.lockTests ?? registry.portals[portal]?.tests ?? [];
      if (!Array.isArray(lockTests) || !lockTests.length) {
        return fail("Shared-file owner has no registered lock tests: " + portal, owners, sharedFiles);
      }
      const ownedSharedFiles = sharedFiles.filter(file => sharedMatches.get(file).includes(portal));
      const scopedRegistry = {
        portals: {
          [portal]: {
            ...registry.portals[portal],
            paths: [...new Set([...(registry.portals[portal].paths ?? []), ...ownedSharedFiles])]
          }
        },
        shared: []
      };
      const result = evaluatePolicy({
        changedFiles: ownedSharedFiles,
        registry: scopedRegistry,
        windowState: policy.windowState,
        record: policy.record,
        now,
        latestActivityAt: policy.latestActivityAt ?? latestActivityAt,
        activityTimestamps: policy.activityTimestamps ?? []
      });
      if (!result.ok) return fail("Shared-file owner " + portal + " failed its own protection checks: " + result.reason, owners, sharedFiles);
      ownerResults.push({ portal, lockTests });
    }
    return {
      ok: true,
      affected: owners,
      protectedFiles: sharedFiles,
      sharedFiles,
      ownerResults,
      reason: "Shared-file change passed each owning portal's independent window, Change Record, scope, declaration and baseline-evidence checks."
    };
  }

  const affected = [...specificAffected].sort();
  if (affected.length > 1) return fail("Protected changes must be split into one-portal PRs; multi-portal changes are blocked.", affected);
  const portal = affected[0];
  if (!record || record.status !== "complete") return fail("A completed Change Record is required.", affected);
  if (!windowState || windowState.status !== "open") return fail("No repair window is open; closed windows require a new declaration.", affected);
  const openedAt = Date.parse(windowState.openedAt);
  const expiresAt = Date.parse(windowState.expiresAt);
  if (!Number.isFinite(openedAt) || !Number.isFinite(expiresAt) || expiresAt - openedAt !== HOURS_72) return fail("A valid 72-hour repair-window expiry is mandatory.", affected);
  if (now >= expiresAt) return fail("Repair window expired after 72 hours; an owner-approved renewal is required.", affected);
  const activities = [...new Set([...(activityTimestamps ?? []), ...(latestActivityAt ? [latestActivityAt] : [])])]
    .map(Date.parse).filter(time => Number.isFinite(time) && time >= openedAt).sort((a, b) => a - b);
  if (!activities.length) return fail("No repair activity is recorded after the current window declaration.", affected);
  let previousActivity = openedAt;
  for (const activityTime of activities) {
    if (activityTime - previousActivity >= HOURS_72) return fail("Repair window automatically closed after a 72-hour inactivity gap; a new owner-approved renewal is required.", affected);
    previousActivity = activityTime;
  }
  if (now - previousActivity >= HOURS_72) return fail("Repair window automatically closed after 72 consecutive hours without activity.", affected);
  if (windowState.emergency === true) {
    const emergencyExpiresAt = Date.parse(windowState.emergencyExpiresAt);
    if (!Number.isFinite(emergencyExpiresAt) || emergencyExpiresAt - openedAt > BREAK_GLASS_24 || now >= emergencyExpiresAt) return fail("The 24-hour break-glass window is expired or invalid.", affected);
  }
  const scope = windowState.scope ?? [];
  const outOfScope = protectedFiles.filter(file => !scope.some(path => isWithin(file, path)));
  if (outOfScope.length) return fail("Out-of-scope protected files: " + outOfScope.join(", "), affected);
  const declaredFiles = [...(record.declaration?.files ?? []), ...(record.activeAmendment?.files ?? [])];
  const missingDeclarations = protectedFiles.filter(file => !declaredFiles.some(path => isWithin(file, path)));
  if (missingDeclarations.length) return fail("Change Record omits changed files: " + missingDeclarations.join(", "), affected);
  const declaredPortals = new Set(record.declaration?.affectedPortals ?? []);
  const missingPortals = affected.filter(portalName => !declaredPortals.has(portalName));
  if (missingPortals.length) return fail("Change Record omits affected portals: " + missingPortals.join(", "), affected);
  if (!record.declaration?.reason || !record.declaration?.expectedEffect || !Array.isArray(record.declaration?.prohibitedChanges) || !record.declaration.prohibitedChanges.length) return fail("Change Record must state reason, expected effect and prohibited changes.", affected);
  if (!record.baseline?.commit || !record.baseline?.rollbackCommit) return fail("Baseline and rollback commits are mandatory.", affected);
  if (record.validation?.baselineSmoke !== "PASS" || record.validation?.fullRegression !== "PASS") return fail("Baseline smoke and full regression must both be recorded as PASS.", affected);
  const evidence = record.validation?.evidence;
  const runLink = /https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/job\/\d+/;
  const hasRunEvidence = label => Array.isArray(evidence) && evidence.some(item =>
    String(item).toLowerCase().includes(label.toLowerCase()) &&
    String(item).includes(record.baseline.commit) &&
    runLink.test(String(item))
  );
  if (!hasRunEvidence("baseline smoke") || !hasRunEvidence("full regression")) return fail("Baseline smoke and full regression require real-run links tied to this portal baseline commit.", affected);
  const smoke = record.validation?.portalSmoke ?? {};
  const missingSmoke = affected.filter(portalName => smoke[portalName] !== "PASS");
  if (missingSmoke.length) return fail("Missing passing smoke evidence for: " + missingSmoke.join(", "), affected);
  const missingPortalRunEvidence = affected.filter(portalName => !Array.isArray(evidence) || !evidence.some(item =>
    String(item).includes(portalName) && /portal smoke/i.test(String(item)) &&
    String(item).includes(record.baseline.commit) && runLink.test(String(item))
  ));
  if (missingPortalRunEvidence.length) return fail("Missing portal-specific real-run smoke links for: " + missingPortalRunEvidence.join(", "), affected);
  if (!Array.isArray(record.validation?.behaviourDifferences)) return fail("Baseline comparison must list behaviour differences (use an empty array when none).", affected);
  const remainingMs = expiresAt - now;
  const warning = remainingMs < WARNING_12 ? `Repair window expires in less than 12 hours (expires at ${windowState.expiresAt}); obtain owner renewal before expiry.` : null;
  return { ok: true, affected, protectedFiles, warning, reason: "Protected changes are declared and within the active 72-hour repair window." };
}

async function main() {
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
  const maintenanceApproval = await findOwnerMaintenanceApproval();
  const maintenanceClassification = classifyProtectionOnlyChange(changedFiles, maintenanceApproval);
  if (maintenanceClassification.eligible) {
    console.log(JSON.stringify({ ...maintenanceClassification, classificationOnly: true, changedFiles }, null, 2));
    if (!maintenanceClassification.ok) process.exitCode = 1;
    return;
  }
  const discovery = evaluatePolicy({ changedFiles, registry, windowState: null, record: null });
  if (!discovery.protectedFiles.length) {
    console.log(JSON.stringify(discovery, null, 2));
    return;
  }
  if (discovery.sharedFiles?.length) {
    const ownerPolicies = {};
    for (const portal of discovery.affected) {
      const paths = portalPolicyPaths([portal]);
      if (!paths || !fs.existsSync(paths.windowPath) || !fs.existsSync(paths.recordPath)) {
        console.log(JSON.stringify({ ...discovery, ok: false, reason: "Shared-file change is missing the dedicated window or Change Record for owner: " + portal }, null, 2));
        process.exitCode = 1;
        return;
      }
      ownerPolicies[portal] = {
        windowState: readJson(paths.windowPath),
        record: readJson(paths.recordPath)
      };
    }
    const history = execFileSync("git", ["log", "--format=%cI", "--", ...discovery.sharedFiles], { encoding: "utf8" }).trim();
    const activityTimestamps = parseActivityTimestamps(history);
    for (const policy of Object.values(ownerPolicies)) policy.activityTimestamps = activityTimestamps;
    const result = evaluatePolicy({ changedFiles, registry, ownerPolicies });
    if (!result.ok) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    for (const portal of result.affected) {
      const evidenceCheck = await verifyRealRunEvidence(ownerPolicies[portal].record, [portal]);
      if (!evidenceCheck.ok) {
        console.log(JSON.stringify({ ...result, ok: false, reason: "Shared-file owner " + portal + " baseline evidence failed: " + evidenceCheck.reason }, null, 2));
        process.exitCode = 1;
        return;
      }
    }
    const lockTests = [...new Set(result.affected.flatMap(portal => registry.portals[portal].lockTests ?? registry.portals[portal].tests ?? []))];
    if (!lockTests.length) {
      console.log(JSON.stringify({ ...result, ok: false, reason: "Shared-file change has no registered owner lock tests." }, null, 2));
      process.exitCode = 1;
      return;
    }
    try {
      execFileSync("node", ["--test", ...lockTests], { stdio: "inherit" });
    } catch (error) {
      console.log(JSON.stringify({ ...result, ok: false, reason: "One or more owning portal lock tests failed: " + (error.message || error) }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ...result, lockTestsExecuted: lockTests }, null, 2));
    return;
  }
  const registeredPortal = discovery.affected.length === 1 ? registry.portals[discovery.affected[0]] : null;
  const warningUntil = newPortalWarningUntil(registeredPortal);
  if (Number.isFinite(warningUntil) && Date.now() < warningUntil) {
    console.warn(`::warning::New portal ${discovery.affected[0]} is in its seven-day protection warning period until ${new Date(warningUntil).toISOString()}; create its dedicated window, Change Record and lock tests.`);
    console.log(JSON.stringify({ ...discovery, ok: true, warning: "New portal seven-day warning period; no protection exemption after expiry." }, null, 2));
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
  let result = evaluatePolicy({ changedFiles, registry, windowState, record, activityTimestamps });
  if (result.ok && result.protectedFiles.length) {
    const evidenceCheck = await verifyRealRunEvidence(record, result.affected);
    if (!evidenceCheck.ok) result = { ...result, ok: false, reason: evidenceCheck.reason };
  }
  if (result.warning) console.warn(`::warning::${result.warning}`);
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
