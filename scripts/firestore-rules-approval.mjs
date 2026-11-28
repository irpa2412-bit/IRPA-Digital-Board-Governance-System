import { execFileSync } from "node:child_process";

const LABEL = "firestore-rules-approved";

function latestByTime(items) {
  return [...items].sort((a, b) => {
    const timeOrder = Date.parse(a.created_at) - Date.parse(b.created_at);
    return timeOrder || Number(a.id || 0) - Number(b.id || 0);
  }).at(-1);
}

// Retained as an offline decision fixture for the timeline-based policy contract.
export function evaluateApproval({ changedFiles, labels, labelEvents, timeline, rulesCommitIds, allowedActors, apiError }) {
  if (apiError) return { pass: false, reason: "GitHub API verification failed; failing closed: " + apiError };
  if (!Array.isArray(changedFiles) || !Array.isArray(labels) || !Array.isArray(labelEvents) ||
      !Array.isArray(timeline) || !Array.isArray(rulesCommitIds) || !Array.isArray(allowedActors)) {
    return { pass: false, reason: "Required approval evidence is incomplete; failing closed." };
  }
  if (!changedFiles.includes("firestore.rules")) return { pass: true, reason: "firestore.rules unchanged." };
  if (!labels.includes(LABEL)) return { pass: false, reason: "firestore.rules changed but the required approval label is absent." };

  const relevant = labelEvents.filter(e => e.label?.name === LABEL && ["labeled", "unlabeled"].includes(e.event));
  const latestLabelEvent = latestByTime(relevant);
  if (!latestLabelEvent || latestLabelEvent.event !== "labeled") {
    return { pass: false, reason: "The approval label is not currently backed by a latest label-applied event." };
  }
  const actor = latestLabelEvent.actor?.login;
  if (!actor || !allowedActors.includes(actor)) {
    return { pass: false, reason: "Approval label was applied by unauthorized actor: " + (actor || "unknown") + "." };
  }
  if (!latestLabelEvent.id || rulesCommitIds.length === 0) {
    return { pass: false, reason: "Cannot establish the PR event order for the approval and rules commits; failing closed." };
  }
  const labelIndex = timeline.findIndex(event => event.id === latestLabelEvent.id && event.event === "labeled");
  const rulesCommitIndexes = rulesCommitIds.map(sha => timeline.findIndex(event => event.event === "committed" && event.sha === sha));
  if (labelIndex < 0 || rulesCommitIndexes.some(index => index < 0)) {
    return { pass: false, reason: "GitHub timeline is missing the approval event or a rules-changing commit; failing closed." };
  }
  if (labelIndex <= Math.max(...rulesCommitIndexes)) {
    return { pass: false, reason: "approval is stale; re-apply the label after reviewing the latest diff" };
  }
  return { pass: true, reason: "Valid approval by @" + actor + " after the latest firestore.rules commit." };
}

// Event-bound approval: the label event is tied to the exact PR head.
// Any later synchronize event requires the owner to re-apply the label.
export function evaluateLabelEventApproval({ action, actor, labelName, labels, changedFiles, rulesCommitIds, allowedActors, headSha, checkoutSha }) {
  if (!Array.isArray(labels) || !Array.isArray(changedFiles) || !Array.isArray(rulesCommitIds) || !Array.isArray(allowedActors)) {
    return { pass: false, reason: "Required approval event evidence is incomplete; failing closed." };
  }
  if (!changedFiles.includes("firestore.rules")) return { pass: true, reason: "firestore.rules unchanged." };
  if (rulesCommitIds.length === 0) return { pass: false, reason: "No rules-changing commit was found in the checked-out PR history; failing closed." };
  if (!labels.includes(LABEL)) return { pass: false, reason: "firestore.rules changed but the required approval label is absent." };
  if (action !== "labeled" || labelName !== LABEL) {
    return { pass: false, reason: "Owner approval must be applied or re-applied after the latest PR commit; failing closed." };
  }
  if (!actor || !allowedActors.includes(actor)) {
    return { pass: false, reason: "Approval label was applied by unauthorized actor: " + (actor || "unknown") + "." };
  }
  if (!headSha || !checkoutSha || headSha !== checkoutSha) {
    return { pass: false, reason: "Approval event does not match the exact checked-out PR head; failing closed." };
  }
  return { pass: true, reason: "Valid current-head Firestore rules approval by @" + actor + "." };
}

function loadApprovers(baseSha) {
  const raw = execFileSync("git", ["show", baseSha + ":.github/firestore-rules-approvers.txt"], { encoding: "utf8" });
  const logins = raw.split(/\r?\n/).map(line => line.replace(/#.*$/, "").trim()).filter(Boolean);
  if (!logins.includes("irpa2412-bit")) throw new Error("Approver allow-list must include repository owner irpa2412-bit.");
  return [...new Set(logins)];
}

async function main() {
  const action = process.env.PR_ACTION || "";
  const actor = process.env.PR_ACTOR || "";
  const labelName = process.env.EVENT_LABEL_NAME || "";
  const headSha = process.env.PR_HEAD_SHA || "";
  const baseSha = process.env.BASE_SHA || "";
  let labels;
  try {
    labels = JSON.parse(process.env.PR_LABELS || "[]").map(label => label.name).filter(Boolean);
  } catch {
    throw new Error("PR_LABELS must be a JSON array supplied by the pull_request event.");
  }
  if (!/^[0-9a-f]{40}$/i.test(baseSha) || !/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error("Exact BASE_SHA and PR_HEAD_SHA values are required.");
  }
  try {
    execFileSync("git", ["cat-file", "-e", baseSha + "^{commit}"], { stdio: "ignore" });
    const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const changedRaw = execFileSync("git", ["diff", "--name-only", baseSha + "...HEAD"], { encoding: "utf8" }).trim();
    const changedFiles = changedRaw ? changedRaw.split(/\r?\n/).filter(Boolean) : [];
    if (!changedFiles.includes("firestore.rules")) {
      console.log("PASS: firestore.rules unchanged.");
      return;
    }
    const rulesRaw = execFileSync("git", ["log", "--format=%H", baseSha + "..HEAD", "--", "firestore.rules"], { encoding: "utf8" }).trim();
    const rulesCommitIds = rulesRaw ? rulesRaw.split(/\r?\n/).filter(Boolean) : [];
    const allowedActors = loadApprovers(baseSha);
    const result = evaluateLabelEventApproval({
      action, actor, labelName, labels, changedFiles, rulesCommitIds, allowedActors, headSha, checkoutSha
    });
    if (result.pass) {
      console.log("PASS: " + result.reason);
      return;
    }
    console.error("FAIL: " + result.reason);
    process.exitCode = 1;
  } catch (error) {
    const reason = "Local PR evidence error; fail closed. " + error.message;
    console.error("::error::" + reason);
    process.exitCode = 1;
  }
}

if (import.meta.url === "file://" + process.argv[1]) await main();
